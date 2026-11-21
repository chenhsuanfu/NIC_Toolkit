"""
fetch_all_tw_stocks.py
批次抓取台灣全部上市 (TWSE) + 上櫃 (TPEx) 普通股的股價、PE/PB/殖利率與近月營收，
輸出輕量索引檔 tools/goodstock/tw-universe-index.json 供好股價全市場選股使用。
"""
import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
import requests

API_URL = "https://api.finmindtrade.com/api/v4/data"
FINMIND_TOKEN = os.environ.get("FINMIND_TOKEN", "").strip()


def fetch_finmind(dataset: str, start_date: str = None, end_date: str = None) -> list:
    params = {"dataset": dataset}
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date
    if FINMIND_TOKEN:
        params["token"] = FINMIND_TOKEN
    print(f"[FinMind] Fetching {dataset} ({start_date or ''} ~ {end_date or ''})...")
    resp = requests.get(API_URL, params=params, timeout=60)
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("status") != 200:
        raise RuntimeError(f"FinMind error ({dataset}): {payload.get('msg')}")
    return payload.get("data", []) or []


def main():
    today = datetime.now()
    end_str = today.strftime("%Y-%m-%d")
    price_start = (today - timedelta(days=7)).strftime("%Y-%m-%d")

    # 1. All TWSE + TPEx common stocks (4-digit codes)
    info_rows = fetch_finmind("TaiwanStockInfo")
    stocks_map = {}
    for r in info_rows:
        code = str(r.get("stock_id", "")).strip()
        mkt = str(r.get("type", "")).strip().lower()
        if not re.match(r"^\d{4}$", code):
            continue
        if mkt not in ("twse", "tpex"):
            continue
        stocks_map[code] = {
            "code": code,
            "name": str(r.get("stock_name", "")).strip(),
            "market": "TWSE" if mkt == "twse" else "TPEx",
            "industry": str(r.get("industry_category", "其他")).strip() or "其他",
            "price": 0,
            "pe": None,
            "pb": None,
            "yield": None,
            "monthlyRevenues": []
        }

    # 2. Latest closing prices (market-wide)
    price_rows = fetch_finmind("TaiwanStockPrice", start_date=price_start, end_date=end_str)
    for r in price_rows:
        code = str(r.get("stock_id", "")).strip()
        if code not in stocks_map:
            continue
        close_val = r.get("close")
        if close_val and float(close_val) > 0:
            stocks_map[code]["price"] = round(float(close_val), 2)

    # 3. Latest PE / PB / Dividend Yield (market-wide)
    try:
        per_rows = fetch_finmind("TaiwanStockPER", start_date=price_start, end_date=end_str)
        for r in per_rows:
            code = str(r.get("stock_id", "")).strip()
            if code not in stocks_map:
                continue
            if r.get("PER") is not None:
                stocks_map[code]["pe"] = round(float(r["PER"]), 2)
            if r.get("PBR") is not None:
                stocks_map[code]["pb"] = round(float(r["PBR"]), 2)
            if r.get("dividend_yield") is not None:
                stocks_map[code]["yield"] = round(float(r["dividend_yield"]), 2)
    except Exception as exc:
        print(f"[Warn] TaiwanStockPER skipped: {exc}")

    # 4. Recent 15 months of monthly revenues (market-wide, fetched in 3-month chunks)
    rev_by_stock = {}
    for offset_m in range(0, 15, 3):
        chunk_end = today - timedelta(days=offset_m * 30)
        chunk_start = today - timedelta(days=(offset_m + 3) * 30)
        try:
            rev_rows = fetch_finmind(
                "TaiwanStockMonthRevenue",
                start_date=chunk_start.strftime("%Y-%m-01"),
                end_date=chunk_end.strftime("%Y-%m-%d")
            )
            for r in rev_rows:
                code = str(r.get("stock_id", "")).strip()
                if code not in stocks_map:
                    continue
                ym = f"{r.get('revenue_year')}-{str(r.get('revenue_month')).zfill(2)}"
                rev_m = round(float(r.get("revenue", 0) or 0) / 1e6, 2)
                rev_by_stock.setdefault(code, {})[ym] = rev_m
        except Exception as exc:
            print(f"[Warn] Revenue chunk skipped ({offset_m}m): {exc}")

    # Compute YoY for latest 4 months per stock
    final_list = []
    for code, s in sorted(stocks_map.items()):
        if s["price"] <= 0:
            continue
        ym_map = rev_by_stock.get(code, {})
        sorted_yms = sorted(ym_map.keys())
        recent_revs = []
        for ym in sorted_yms[-4:]:
            y, m = ym.split("-")
            prev_ym = f"{int(y) - 1}-{m}"
            cur_v = ym_map[ym]
            prev_v = ym_map.get(prev_ym, 0)
            yoy = round(((cur_v - prev_v) / prev_v) * 100, 2) if prev_v > 0 else 0
            recent_revs.append({"month": ym, "revM": cur_v, "yoy": yoy})
        s["monthlyRevenues"] = recent_revs
        final_list.append(s)

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
