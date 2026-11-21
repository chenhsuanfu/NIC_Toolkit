"""
fetch_real_twse_v4.py
一鍵抓取「TWSE 減碼行動雷達 v4.0」所需的完整 5 大台股避險因子：
  1. FinMind: 加權指數 (TAIEX)、外資現貨買賣超、外資台指期未平倉 (TX)、大盤融資餘額
  2. yfinance: 櫃買指數 (^TWOII)、美股費城半導體 (^SOX)、美股恐慌指數 (^VIX)、新台幣匯率 (TWD=X)

嚴防未來函數：美股 ^SOX 與 ^VIX 自動對齊「前一個美股收盤日 (T-1)」，確保盤前就已知！

安裝與執行：
  pip install requests pandas yfinance
  python fetch_real_twse_v4.py
"""
import requests
import pandas as pd
import yfinance as yf

START_DATE = "2019-01-01"
END_DATE = "2026-11-20"
FINMIND_TOKEN = ""  # 選填：免費註冊可提高每小時抓取額度

API_URL = "https://api.finmindtrade.com/api/v4/data"


def fetch_finmind(dataset: str, data_id: str = None) -> pd.DataFrame:
    params = {"dataset": dataset, "start_date": START_DATE, "end_date": END_DATE}
    if data_id:
        params["data_id"] = data_id
    if FINMIND_TOKEN:
        params["token"] = FINMIND_TOKEN
    print(f"[FinMind] 抓取 {dataset} ({data_id or 'ALL'})...")
    resp = requests.get(API_URL, params=params, timeout=30)
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("status") != 200:
        raise RuntimeError(f"FinMind 錯誤: {payload.get('msg')}")
    return pd.DataFrame(payload.get("data", []))


def fetch_yf_close(ticker: str, col_name: str, shift_days: int = 0) -> pd.DataFrame:
    print(f"[yfinance] 抓取 {ticker} -> {col_name}...")
    df = yf.download(ticker, start=START_DATE, end=END_DATE, progress=False, auto_adjust=False)
    if df.empty:
        return pd.DataFrame(columns=["Date", col_name])
    close_s = df["Close"].squeeze()
    if shift_days > 0:
        # 美股盤收於台灣清晨，將日期往後位移 1 個日曆日再做前向對齊，嚴防使用當晚未收盤美股
        close_s.index = pd.to_datetime(close_s.index) + pd.Timedelta(days=shift_days)
    out = close_s.reset_index()
    out.columns = ["Date", col_name]
    out["Date"] = pd.to_datetime(out["Date"]).dt.strftime("%Y-%m-%d")
    out[col_name] = pd.to_numeric(out[col_name], errors="coerce")
    return out.dropna().drop_duplicates("Date")


def main():
    # 1. TAIEX 加權指數
    df_p = fetch_finmind("TaiwanStockPrice", "TAIEX")
    df_p["Date"] = pd.to_datetime(df_p["date"]).dt.strftime("%Y-%m-%d")
    df_p["Close"] = pd.to_numeric(df_p["close"], errors="coerce")
    vol_col = "Trading_money" if "Trading_money" in df_p.columns else "Trading_Volume"
    df_p["Volume"] = pd.to_numeric(df_p[vol_col], errors="coerce") / 1e8
    base = df_p[["Date", "Close", "Volume"]].dropna().drop_duplicates("Date").sort_values("Date")

    # 2. 外資現貨買賣超 (億)
    df_inst = fetch_finmind("TaiwanStockTotalInstitutionalInvestors")
    df_f = df_inst[df_inst["name"].astype(str).str.contains("Foreign", na=False)].copy()
    df_f["Foreign_Spot_Net"] = (pd.to_numeric(df_f["buy"], errors="coerce") - pd.to_numeric(df_f["sell"], errors="coerce")) / 1e8
    spot = df_f.groupby("date", as_index=False)["Foreign_Spot_Net"].sum().rename(columns={"date": "Date"})

    # 3. 外資台指期 TX 未平倉淨口數
    df_fut = fetch_finmind("TaiwanFuturesInstitutionalInvestors", "TX")
    df_ff = df_fut[df_fut["institutional_investors"].astype(str).str.contains("外資|Foreign", na=False)].copy()
    df_ff["Foreign_Fut_OI"] = (
        pd.to_numeric(df_ff["long_open_interest_balance_volume"], errors="coerce")
        - pd.to_numeric(df_ff["short_open_interest_balance_volume"], errors="coerce")
    )
    fut = df_ff.groupby("date", as_index=False)["Foreign_Fut_OI"].sum().rename(columns={"date": "Date"})

    # 4. 大盤融資餘額 (億)
    df_m = fetch_finmind("TaiwanStockTotalMarginPurchaseShortSale")
    df_m = df_m[df_m["name"] == "MarginPurchaseMoney"].copy()
    df_m["Margin_Balance"] = pd.to_numeric(df_m["TodayBalance"], errors="coerce") / 1e8
    margin = df_m.groupby("date", as_index=False)["Margin_Balance"].last().rename(columns={"date": "Date"})

    # 5. 強化外部與廣度因子 (OTC、費半 SOX、VIX、新台幣匯率)
    otc = fetch_yf_close("^TWOII", "OTC_Close", shift_days=0)
    fx = fetch_yf_close("TWD=X", "USD_TWD", shift_days=0)
    sox = fetch_yf_close("^SOX", "SOX_Close", shift_days=1)   # T-1 美股對齊 T 台股
    vix = fetch_yf_close("^VIX", "VIX", shift_days=1)         # T-1 美股對齊 T 台股

    # 合併並用 asof 對齊休市日差
    merged = (
        base.merge(fut, on="Date", how="left")
            .merge(spot, on="Date", how="left")
            .merge(margin, on="Date", how="left")
            .merge(otc, on="Date", how="left")
            .merge(fx, on="Date", how="left")
    )
    merged["dt"] = pd.to_datetime(merged["Date"])
    merged = merged.sort_values("dt")

    for ext_df, col in [(sox, "SOX_Close"), (vix, "VIX")]:
        if not ext_df.empty:
            ext_df["dt"] = pd.to_datetime(ext_df["Date"])
            merged = pd.merge_asof(merged, ext_df[["dt", col]].sort_values("dt"), on="dt", direction="backward")

    merged = merged.drop(columns=["dt"]).reset_index(drop=True)
    for c in ["Foreign_Fut_OI", "Foreign_Spot_Net", "Margin_Balance", "OTC_Close", "USD_TWD", "SOX_Close", "VIX"]:
        if c in merged.columns:
            merged[c] = merged[c].ffill().bfill()

    # 計算 20 日年化歷史波動率
    merged["Volatility"] = (merged["Close"].pct_change().rolling(20).std() * (252 ** 0.5) * 100).bfill().round(2)

    for c, dec in [("Close", 2), ("Volume", 1), ("Foreign_Spot_Net", 1), ("Margin_Balance", 1), ("OTC_Close", 2), ("USD_TWD", 3), ("SOX_Close", 2), ("VIX", 2)]:
        if c in merged.columns:
            merged[c] = merged[c].round(dec)

    out_path = "real_twse_v4.csv"
    merged.to_csv(out_path, index=False, encoding="utf-8-sig")
    print(f"完成！共輸出 {len(merged)} 筆全 5 因子真實台股資料至 {out_path}")


if __name__ == "__main__":
    main()
