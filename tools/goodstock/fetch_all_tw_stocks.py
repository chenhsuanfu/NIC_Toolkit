"""
fetch_all_tw_stocks.py
雙引擎全市場台股 (TWSE + TPEx) 財報與行情更新器：
1. 免費官方 OpenAPI：每日快速更新全部 ~1,981 檔上市櫃收盤價、PE / PB / 殖利率、產業別（零 FinMind 額度）。
2. 漸進式輪巡補齊：每次最多從 FinMind 補抓 BATCH_SIZE (預設 100) 檔最久未更新個股的完整 8~10 季財報
   （損益表、資產負債表、現金流量表）與 18 個月營收，累積保存於 tools/goodstock/tw-universe-index.json。
   若遇 FinMind 額度上限 (HTTP 402/429) 會安全提早存檔退出，絕不影響其他工具額度。
"""
import json
import os
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NICToolkit/1.0",
    "Accept": "application/json"
}
FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"
FINMIND_TOKEN = os.environ.get("FINMIND_TOKEN", "").strip()
BATCH_SIZE = int(os.environ.get("GOODSTOCK_BATCH_SIZE", "100"))
OUT_PATH = Path(__file__).resolve().parent / "tw-universe-index.json"


class RateLimitError(Exception):
    pass


def fetch_json(url: str) -> list:
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


def fetch_finmind(dataset: str, data_id: str, start_date: str) -> list:
    params = {"dataset": dataset, "data_id": data_id, "start_date": start_date}
    if FINMIND_TOKEN:
        params["token"] = FINMIND_TOKEN
    resp = requests.get(FINMIND_URL, params=params, timeout=30)
    if resp.status_code in (402, 429):
        raise RateLimitError(f"FinMind rate limit (HTTP {resp.status_code})")
    resp.raise_for_status()
    payload = resp.json()
    status = payload.get("status")
    if status in (402, 429):
        raise RateLimitError(f"FinMind rate limit ({payload.get('msg')})")
    if status != 200:
        return []
    return payload.get("data", []) or []


def date_to_q(d_str: str) -> str:
    if not d_str or len(d_str) < 7:
        return ""
    y = int(d_str[:4])
    m = int(d_str[5:7])
    q = (m - 1) // 3 + 1
    return f"{y}Q{q}"


def fetch_stock_full_financials(code: str, start_q: str, start_m: str) -> tuple:
    # 1. Monthly revenues (18+ months for YoY & MoM)
    rev_rows = fetch_finmind("TaiwanStockMonthRevenue", code, start_m)
    ym_map = {}
    for r in rev_rows:
        y = r.get("revenue_year")
        m = r.get("revenue_month")
        if not y or not m:
            continue
        ym = f"{int(y)}-{int(m):02d}"
        ym_map[ym] = round(float(r.get("revenue", 0) or 0) / 1e6, 2)

    sorted_yms = sorted(ym_map.keys())
    monthly_revs = []
    for ym in sorted_yms[-15:]:
        y, m = int(ym[:4]), int(ym[5:7])
        cur = ym_map[ym]
        prev_y_ym = f"{y - 1}-{m:02d}"
        prev_m_y, prev_m = (y - 1, 12) if m == 1 else (y, m - 1)
        prev_m_ym = f"{prev_m_y}-{prev_m:02d}"
        py = ym_map.get(prev_y_ym, 0)
        pm = ym_map.get(prev_m_ym, 0)
        yoy = round(((cur - py) / py) * 100, 2) if py > 0 else 0.0
        mom = round(((cur - pm) / pm) * 100, 2) if pm > 0 else 0.0
        monthly_revs.append({"ym": ym, "month": ym, "revM": cur, "mom": mom, "yoy": yoy, "cumYoY": yoy})

    # 2. Quarterly income statements
    fin_rows = fetch_finmind("TaiwanStockFinancialStatements", code, start_q)
    q_data = {}
    for r in fin_rows:
        q = date_to_q(str(r.get("date", "")))
        if not q:
            continue
        b = q_data.setdefault(q, {})
        t = str(r.get("type", ""))
        v = to_float(r.get("value"), 0.0) or 0.0
        if t in ("Revenue", "TotalOperatingRevenue"):
            b["rev"] = v
        elif t in ("OperatingIncome", "OperatingProfit"):
            b["op"] = v
        elif t in ("IncomeAfterTaxes", "EquityAttributableToOwnersOfParent", "NetIncome"):
            b["net"] = v
        elif t == "EPS":
            b["eps"] = v

    # 3. Cash flow statements (FCF = Operating CF - CapEx)
    cf_rows = fetch_finmind("TaiwanStockCashFlowsStatement", code, start_q)
    for r in cf_rows:
        q = date_to_q(str(r.get("date", "")))
        if not q:
            continue
        b = q_data.setdefault(q, {})
        t = str(r.get("type", ""))
        v = to_float(r.get("value"), 0.0) or 0.0
        if t == "CashFlowsFromOperatingActivities":
            b["ocf"] = v
        elif t in ("PropertyAndPlantAndEquipment", "AcquisitionOfPropertyPlantAndEquipment"):
            b["capex"] = v

    # 4. Balance sheet (Inventory for turnover)
    bs_rows = fetch_finmind("TaiwanStockBalanceSheet", code, start_q)
    for r in bs_rows:
        q = date_to_q(str(r.get("date", "")))
        if not q:
            continue
        b = q_data.setdefault(q, {})
        t = str(r.get("type", ""))
        v = to_float(r.get("value"), 0.0) or 0.0
        if t in ("Inventories", "Inventory"):
            b["inv"] = v

    sorted_qs = sorted(q_data.keys())
    quarters = []
    for q in sorted_qs[-10:]:
        b = q_data[q]
        rev = b.get("rev", 0.0)
        op = b.get("op", 0.0)
        net = b.get("net", 0.0)
        eps = b.get("eps", 0.0)
        ocf = b.get("ocf", 0.0)
        capex = b.get("capex", 0.0)
        inv = b.get("inv", 0.0)
        fcf_m = round((ocf + capex) / 1e6, 2) if capex < 0 else round((ocf - capex) / 1e6, 2)
        op_margin = round((op / rev) * 100, 2) if rev > 0 else 0.0
        net_margin = round((net / rev) * 100, 2) if rev > 0 else 0.0
        inv_turn = round((rev * 0.7) / inv, 2) if inv > 0 and rev > 0 else 0.0

        prev_y_q = f"{int(q[:4]) - 1}{q[4:]}"
        prev_b = q_data.get(prev_y_q, {})
        prev_rev = prev_b.get("rev", 0.0)
        prev_net = prev_b.get("net", 0.0)
        rev_yoy = round(((rev - prev_rev) / prev_rev) * 100, 2) if prev_rev > 0 else 0.0
        net_yoy = round(((net - prev_net) / abs(prev_net)) * 100, 2) if prev_net != 0 else 0.0

        quarters.append({
            "q": q,
            "revM": round(rev / 1e6, 2),
            "opMargin": op_margin,
            "netMargin": net_margin,
            "eps": round(eps, 2),
            "revYoY": rev_yoy,
            "netProfitYoY": net_yoy,
            "invTurnover": inv_turn,
            "fcfM": fcf_m
        })

    return monthly_revs, quarters


def main():
    # Load existing universe index to preserve accumulated 8-quarter financials
    prev_map = {}
    if OUT_PATH.exists():
        try:
            old = json.loads(OUT_PATH.read_text(encoding="utf-8"))
            for s in old.get("stocks", []):
                if s.get("code"):
                    prev_map[s["code"]] = s
        except Exception as exc:
            print(f"[Warn] Could not load existing index: {exc}")

    stocks_map = {}

    # 1. Refresh all TWSE + TPEx prices & valuation via free official OpenAPIs
    for r in fetch_json("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"):
        code = str(r.get("Code", "")).strip()
        price = to_float(r.get("ClosingPrice"), 0)
        if not re.match(r"^\d{4}$", code) or not price or price <= 0:
            continue
        prev = prev_map.get(code, {})
        stocks_map[code] = {
            **prev,
            "code": code,
            "name": str(r.get("Name", "")).strip(),
            "market": "TWSE",
            "industry": prev.get("industry") or "上市",
            "price": round(price, 2)
        }

    try:
        for r in fetch_json("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL"):
            code = str(r.get("Code", "")).strip()
            if code in stocks_map:
                stocks_map[code]["pe"] = to_float(r.get("PEratio"))
                stocks_map[code]["pb"] = to_float(r.get("PBratio"))
                stocks_map[code]["yield"] = to_float(r.get("DividendYield"))
    except Exception:
        pass

    try:
        for r in fetch_json("https://openapi.twse.com.tw/v1/opendata/t187ap05_L"):
            code = str(r.get("公司代號", "")).strip()
            if code in stocks_map and r.get("產業別"):
                stocks_map[code]["industry"] = str(r.get("產業別")).strip()
    except Exception:
        pass

    try:
        for r in fetch_json("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes"):
            code = str(r.get("SecuritiesCompanyCode", "")).strip()
            price = to_float(r.get("Close"), 0)
            if not re.match(r"^\d{4}$", code) or not price or price <= 0:
                continue
            prev = prev_map.get(code, {})
            stocks_map[code] = {
                **prev,
                "code": code,
                "name": str(r.get("CompanyName", "")).strip(),
                "market": "TPEx",
                "industry": prev.get("industry") or "上櫃",
                "price": round(price, 2)
            }
    except Exception:
        pass

    try:
        for r in fetch_json("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis"):
            code = str(r.get("SecuritiesCompanyCode", "")).strip()
            if code in stocks_map:
                stocks_map[code]["pe"] = to_float(r.get("PriceEarningRatio"))
                stocks_map[code]["pb"] = to_float(r.get("PriceBookRatio"))
                stocks_map[code]["yield"] = to_float(r.get("YieldRatio"))
    except Exception:
        pass

    try:
        for r in fetch_json("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O"):
            code = str(r.get("公司代號", "")).strip()
            if code in stocks_map and r.get("產業別"):
                stocks_map[code]["industry"] = str(r.get("產業別")).strip()
    except Exception:
        pass

    # 1b. Fetch paid-in capital (實收資本額) to compute Market Cap (億元) for large-cap-first sorting
    for cap_url in (
        "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
        "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"
    ):
        try:
            for r in fetch_json(cap_url):
                code = str(r.get("公司代號", "")).strip()
                if code not in stocks_map:
                    continue
                cap = to_float(r.get("實收資本額"), 0) or 0
                price = stocks_map[code].get("price", 0) or 0
                if cap > 0 and price > 0:
                    # 股數 = 實收資本額 / 10 (面額10元)；市值(億) = 股數 * 股價 / 1e8
                    stocks_map[code]["marketCap"] = round((cap / 10.0) * price / 1e8, 2)
        except Exception:
            pass

    # 2. Incremental FinMind 8-quarter financial backfill (up to BATCH_SIZE=100 stocks/day, largest market cap first)
    today_str = datetime.now().strftime("%Y-%m-%d")
    start_q = (datetime.now() - timedelta(days=365 * 3)).strftime("%Y-%m-%d")
    start_m = (datetime.now() - timedelta(days=365 * 2 + 90)).strftime("%Y-%m-01")

    candidates = sorted(
        stocks_map.values(),
        key=lambda s: (s.get("finSyncedAt") or "", -(s.get("marketCap") or 0), s["code"])
    )[:BATCH_SIZE]

    synced_now = 0
    for s in candidates:
        code = s["code"]
        try:
            m_revs, q_list = fetch_stock_full_financials(code, start_q, start_m)
            if m_revs:
                s["monthlyRevenues"] = m_revs
            if q_list:
                s["quarters"] = q_list
            s["finSyncedAt"] = today_str
            synced_now += 1
            if synced_now % 20 == 0:
                print(f"[FinMind] Progress: {synced_now}/{len(candidates)} stocks synced...")
            time.sleep(0.15)
        except RateLimitError as rl:
            print(f"[FinMind] Rate limit reached after {synced_now} stocks: {rl}. Saving progress safely.")
            break
        except Exception as exc:
            print(f"[Warn] Failed {code}: {exc}")

    final_list = [stocks_map[k] for k in sorted(stocks_map.keys())]
    fin_synced_total = sum(1 for s in final_list if s.get("finSyncedAt"))
    out_payload = {
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "count": len(final_list),
        "finSyncedCount": fin_synced_total,
        "stocks": final_list
    }
    OUT_PATH.write_text(json.dumps(out_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Done! {len(final_list)} stocks total, {fin_synced_total} with full 8Q financials (+{synced_now} today).")


if __name__ == "__main__":
    main()
