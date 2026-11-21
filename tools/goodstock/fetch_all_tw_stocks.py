"""
fetch_all_tw_stocks.py
直接透過台灣證券交易所 (TWSE) 與櫃買中心 (TPEx) 官方免費 OpenAPI，
一次抓取全部上市＋上櫃普通股的最新收盤價、PE / PB / 殖利率與最新月營收 YoY，
輸出輕量索引檔 tools/goodstock/tw-universe-index.json 供好股價全市場選股使用。
"""
import json
import re
from datetime import datetime
from pathlib import Path
import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NICToolkit/1.0",
    "Accept": "application/json"
}


def fetch_json(url: str) -> list:
    print(f"[OpenAPI] Fetching {url} ...")
    resp = requests.get(url, headers=HEADERS, timeout=45)
    resp.raise_for_status()
    data = resp.json()
    return data if isinstance(data, list) else []


def to_float(val, default=None):
    if val is None:
        return default
    s = str(val).replace(",", "").replace("%", "").strip()
    if not s or s in ("-", "--", "N/A", "NaN"):
        return default
    try:
        return float(s)
    except ValueError:
        return default


def main():
    stocks_map = {}

    # 1. TWSE 上市每日收盤行情
    for r in fetch_json("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"):
        code = str(r.get("Code", "")).strip()
        if not re.match(r"^\d{4}$", code):
            continue
        price = to_float(r.get("ClosingPrice"), 0)
        if not price or price <= 0:
            continue
        stocks_map[code] = {
            "code": code,
            "name": str(r.get("Name", "")).strip(),
            "market": "TWSE",
            "industry": "上市",
            "price": round(price, 2),
            "pe": None,
            "pb": None,
            "yield": None,
            "monthlyRevenues": []
        }

    # 2. TWSE 上市 PE / PB / 殖利率
    try:
        for r in fetch_json("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL"):
            code = str(r.get("Code", "")).strip()
            if code not in stocks_map:
                continue
            stocks_map[code]["pe"] = to_float(r.get("PEratio"))
            stocks_map[code]["pb"] = to_float(r.get("PBratio"))
            stocks_map[code]["yield"] = to_float(r.get("DividendYield"))
    except Exception as exc:
        print(f"[Warn] TWSE BWIBBU_ALL skipped: {exc}")

    # 3. TWSE 上市月營收與產業別 (t187ap05_L)
    try:
        for r in fetch_json("https://openapi.twse.com.tw/v1/opendata/t187ap05_L"):
            code = str(r.get("公司代號", "")).strip()
            if code not in stocks_map:
                continue
            ind = str(r.get("產業別", "")).strip()
            if ind:
                stocks_map[code]["industry"] = ind
            rev_k = to_float(r.get("營業收入-當月營收"), 0) or 0
            yoy = to_float(r.get("營業收入-去年同月增減(%)"), 0) or 0
            ym_raw = str(r.get("資料年月", "")).strip()
            ym = datetime.now().strftime("%Y-%m")
            if len(ym_raw) >= 5 and ym_raw.isdigit():
                roc_y = int(ym_raw[:-2])
                mm = ym_raw[-2:]
                ym = f"{roc_y + 1911}-{mm}"
            stocks_map[code]["monthlyRevenues"] = [{"month": ym, "revM": round(rev_k / 1000.0, 2), "yoy": round(yoy, 2)}]
    except Exception as exc:
        print(f"[Warn] TWSE t187ap05_L skipped: {exc}")

    # 4. TPEx 上櫃每日收盤行情
    try:
        for r in fetch_json("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes"):
            code = str(r.get("SecuritiesCompanyCode", "")).strip()
            if not re.match(r"^\d{4}$", code):
                continue
            price = to_float(r.get("Close"), 0)
            if not price or price <= 0:
                continue
            stocks_map[code] = {
                "code": code,
                "name": str(r.get("CompanyName", "")).strip(),
                "market": "TPEx",
                "industry": "上櫃",
                "price": round(price, 2),
                "pe": None,
                "pb": None,
                "yield": None,
                "monthlyRevenues": []
            }
    except Exception as exc:
        print(f"[Warn] TPEx quotes skipped: {exc}")

    # 5. TPEx 上櫃 PE / PB / 殖利率
    try:
        for r in fetch_json("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis"):
            code = str(r.get("SecuritiesCompanyCode", "")).strip()
            if code not in stocks_map:
                continue
            stocks_map[code]["pe"] = to_float(r.get("PriceEarningRatio"))
            stocks_map[code]["pb"] = to_float(r.get("PriceBookRatio"))
            stocks_map[code]["yield"] = to_float(r.get("YieldRatio"))
    except Exception as exc:
        print(f"[Warn] TPEx peratio skipped: {exc}")

    # 6. TPEx 上櫃月營收與產業別 (mopsfin_t187ap05_O)
    try:
        for r in fetch_json("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O"):
            code = str(r.get("公司代號", "")).strip()
            if code not in stocks_map:
                continue
            ind = str(r.get("產業別", "")).strip()
            if ind:
                stocks_map[code]["industry"] = ind
            rev_k = to_float(r.get("營業收入-當月營收"), 0) or 0
            yoy = to_float(r.get("營業收入-去年同月增減(%)"), 0) or 0
            ym_raw = str(r.get("資料年月", "")).strip()
            ym = datetime.now().strftime("%Y-%m")
            if len(ym_raw) >= 5 and ym_raw.isdigit():
                roc_y = int(ym_raw[:-2])
                mm = ym_raw[-2:]
                ym = f"{roc_y + 1911}-{mm}"
            stocks_map[code]["monthlyRevenues"] = [{"month": ym, "revM": round(rev_k / 1000.0, 2), "yoy": round(yoy, 2)}]
    except Exception as exc:
        print(f"[Warn] TPEx mopsfin_t187ap05_O skipped: {exc}")

    final_list = [stocks_map[k] for k in sorted(stocks_map.keys())]
    out_path = Path(__file__).resolve().parent / "tw-universe-index.json"
    out_payload = {
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "count": len(final_list),
        "stocks": final_list
    }
    out_path.write_text(json.dumps(out_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Done! Exported {len(final_list)} TWSE+TPEx stocks to {out_path}")


if __name__ == "__main__":
    main()
