import { agentBridge } from '../../core/agent-bridge.js';
import { GoodStockData } from './data.js';

const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const cleaned = String(v).replace(/(?:NT\$|US\$|[$,%\s,])/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + Number(x || 0), 0) / arr.length : 0);

export const GoodStockCore = {
  _universeIndex: null,
  _universePromise: null,

  async loadUniverseIndex() {
    if (this._universeIndex) return this._universeIndex;
    if (this._universePromise) return this._universePromise;
    this._universePromise = (async () => {
      try {
        const resp = await fetch('./tools/goodstock/tw-universe-index.json', { cache: 'no-cache' });
        if (!resp.ok) return null;
        const json = await resp.json();
        if (json && Array.isArray(json.stocks) && json.stocks.length > 0) {
          this._universeIndex = json;
          return json;
        }
      } catch (_) {}
      return null;
    })();
    return this._universePromise;
  },

  /**
   * Retrieve all enriched stock objects (cross-referenced with user's holdings & watchlist in state)
   */
  getEnrichedUniverse(state) {
    const baseList = GoodStockData.getAllStocks();
    const byCode = new Map(baseList.map((s) => [s.code, s]));
    if (this._universeIndex && Array.isArray(this._universeIndex.stocks)) {
      for (const u of this._universeIndex.stocks) {
        if (!u || !u.code) continue;
        if (!byCode.has(u.code)) {
          byCode.set(u.code, {
            code: u.code,
            name: u.name || u.code,
            market: u.market || 'TWSE',
            industry: u.industry || '其他',
            price: toNum(u.price, 0),
            pe: u.pe ?? null,
            pb: u.pb ?? null,
            yield: u.yield ?? null,
            monthlyRevenues: Array.isArray(u.monthlyRevenues) ? u.monthlyRevenues : [],
            quarters: [],
            dataSource: 'universe-index'
          });
        }
      }
    }
    const rawList = Array.from(byCode.values());
    const overview = state?.stock?.overview || [];
    const watchlist = state?.stock?.watchlist || [];

    const holdingSet = new Set(
      overview
        .filter((r) => toNum(r['剩餘股數']) > 0)
        .map((r) => String(r['代號'] || '').replace(/\.TW$/i, '').trim())
    );
    const watchSet = new Set(
      watchlist.map((r) => String(r['代號'] || '').replace(/\.TW$/i, '').trim())
    );

    // Sync latest price from user's live portfolio overview if available
    const livePriceMap = new Map();
    for (const r of overview) {
      const code = String(r['代號'] || '').replace(/\.TW$/i, '').trim();
      const p = toNum(r['現價(原幣)'], 0);
      if (code && p > 0) livePriceMap.set(code, p);
    }

    return rawList.map((stock) => {
      const s = { ...stock };
      if (livePriceMap.has(s.code)) {
        s.price = livePriceMap.get(s.code);
      }
      s.isHolding = holdingSet.has(s.code) || Boolean(s.inUserPortfolio);
      s.isWatchlist = watchSet.has(s.code);

      const qList = s.quarters || [];
      const q0 = qList[qList.length - 1] || {};
      const qPrev4 = qList.slice(-4);
      const ttmEps = round2(qPrev4.reduce((sum, q) => sum + toNum(q.eps), 0));
      const pe = ttmEps > 0 ? round2(s.price / ttmEps) : (s.pe ?? null);

      const mList = s.monthlyRevenues || [];
      const m0 = mList[mList.length - 1] || {};
      const doubleArrow = round2(toNum(m0.yoy) + toNum(q0.opMargin));
      const volRatioPct = s.vol30dAvg > 0 ? round2(((s.vol5dAvg - s.vol30dAvg) / s.vol30dAvg) * 100) : 0;

      const sixEval = this.evaluateSixIndicatorsWithHistory(s);
      const landmines = this.checkSevenLandmines(s);

      return {
        ...s,
        latestQuarter: q0.q || '2026Q2',
        latestMonth: m0.ym || '2026/08',
        latestOpMargin: toNum(q0.opMargin),
        latestNetMargin: toNum(q0.netMargin),
        latestEps: toNum(q0.eps),
        latestInvTurnover: s.noInventory ? null : toNum(q0.invTurnover),
        latestFcfM: toNum(q0.fcfM),
        latestRevM: toNum(m0.revM),
        latestRevMoM: toNum(m0.mom),
        latestRevYoY: toNum(m0.yoy),
        latestCumYoY: toNum(m0.cumYoY),
        ttmEps,
        pe,
        doubleArrow,
        volRatioPct,
        sixEval,
        landmines
      };
    });
  },

  /**
   * Exact implementation of the user's "財務六大指標" spreadsheet scoring rubric (0.0 ~ 4.0)
   * Evaluated at a specific rolling window:
   * - qOffset = 0 (latest quarter Q0), qOffset = 1 (previous quarter Q-1)
   * - mOffset = 0 (latest month M0), mOffset = 1 (previous month M-1), mOffset = 3 (3 months ago M-3)
   */
  scoreSixIndicatorsAtWindow(stock, qOffset = 0, mOffset = 0) {
    const allQ = stock.quarters || [];
    const allM = stock.monthlyRevenues || [];

    const qEnd = Math.max(4, allQ.length - qOffset);
    const mEnd = Math.max(6, allM.length - mOffset);

    const qWin4 = allQ.slice(Math.max(0, qEnd - 4), qEnd);
    const qWin6 = allQ.slice(Math.max(0, qEnd - 6), qEnd);
    const mWin6 = allM.slice(Math.max(0, mEnd - 6), mEnd);

    // 1. 營收成長性 (以每個月營收年增率 YoY% 為基準) - Sheet Rows A2:C7
    const r = mWin6.map((m) => toNum(m.yoy));
    const r6 = r[r.length - 1] ?? 0;
    const r5 = r[r.length - 2] ?? 0;
    const r4 = r[r.length - 3] ?? 0;
    const rAvg6 = round2(mean(r));
    const rAllPos = r.every((v) => v > 0);
    const rDec3 = r6 < r5 && r5 < r4;
    const rLastNonDec = r6 >= r5;
    const rLastDropRatio = r5 > 0 ? (r5 - r6) / r5 : 1;

    let revScore = 2.0;
    let revReason = '';
    if (rAvg6 < 0 || r6 < 0) {
      revScore = 0.0;
      revReason = `近6月均年增 ${rAvg6}% / 最新月 ${r6}% (平均或最近一月為負數)`;
    } else if (rAvg6 > 0 && rDec3) {
      // B7 備註：若同時符合 AA or A & B，則取 B(1分)，因為連三個月遞減
      revScore = 1.0;
      revReason = `近6月均年增 ${rAvg6}% 為正，但近3月連續遞減 (${r4}%→${r5}%→${r6}%)`;
    } else if (rAllPos && rAvg6 > 25 && rLastNonDec) {
      revScore = 4.0;
      revReason = `近6月皆正且平均 ${rAvg6}% > 25%，最新月 (${r6}%) >= 上月 (${r5}%)`;
    } else if (
      (rAllPos && rAvg6 >= 10 && rAvg6 <= 25 && rLastNonDec) ||
      (rAllPos && rAvg6 > 25 && r6 < r5 && rLastDropRatio <= 0.5)
    ) {
      revScore = 3.0;
      revReason = rAvg6 > 25
        ? `近6月皆正且平均 ${rAvg6}% > 25%，最新月小幅回檔在50%內 (${r5}%→${r6}%)`
        : `近6月皆正且平均 ${rAvg6}% 介於10~25%，最新月持平或上升`;
    } else {
      revScore = 2.0;
      revReason = rAllPos
        ? `近6月平均 ${rAvg6}%，最新月 (${r6}%) 較上月 (${r5}%) 回檔`
        : `近6月內曾出現單月負成長，平均 ${rAvg6}%`;
    }

    // 2. 營業利益率評分標準 - Sheet Rows A8:C13
    const op = qWin4.map((q) => toNum(q.opMargin));
    const m1 = op[0] ?? 0, m2 = op[1] ?? 0, m3 = op[2] ?? 0, m4 = op[3] ?? 0;
    const opAvg4 = round2(mean(op));
    const dropRatio = (a, b) => (a > 0 ? (a - b) / a : b < a ? 1 : 0);
    const lastDrop20 = dropRatio(m3, m4) >= 0.20;
    const priorDrop20 = dropRatio(m1, m2) >= 0.20 || dropRatio(m2, m3) >= 0.20;
    const stableNoDrop = !lastDrop20 && !priorDrop20;
    const risingLast = m4 > m3;

    let opScore = 2.0;
    let opReason = '';
    if (opAvg4 < 0 || m4 < 0) {
      opScore = 0.0;
      opReason = `近4季平均營益率 ${opAvg4}% 或最新季 ${m4}% 為負`;
    } else if (lastDrop20 || opAvg4 < 5) {
      opScore = 1.0;
      opReason = opAvg4 < 5
        ? `近4季平均營益率 ${opAvg4}% < 5%`
        : `最新季營益率 (${m4}%) 比上季 (${m3}%) 下跌逾 20%`;
    } else if ((stableNoDrop && opAvg4 >= 15) || (stableNoDrop && opAvg4 >= 10 && opAvg4 < 15 && risingLast)) {
      opScore = 4.0;
      opReason = `近4季穩定無跌逾20%，平均營益率 ${opAvg4}% (最新季 ${m4}%)`;
    } else if ((stableNoDrop && opAvg4 >= 10 && opAvg4 < 15) || (stableNoDrop && opAvg4 >= 5 && opAvg4 < 10 && risingLast)) {
      opScore = 3.0;
      opReason = `近4季穩定無跌逾20%，平均營益率 ${opAvg4}% (最新季 ${m4}%)`;
    } else {
      opScore = 2.0;
      opReason = `近4季平均營益率 ${opAvg4}%，曾有季減逾20%但非最新一季`;
    }

    // 3. 獲利成長性評分標準 (以稅後淨利年增率 YoY% 為標準) - Sheet Rows A14:C19
    const g = qWin4.map((q) => toNum(q.netIncomeYoY));
    const g1 = g[0] ?? 0, g2 = g[1] ?? 0, g3 = g[2] ?? 0, g4 = g[3] ?? 0;
    const negCount4 = g.filter((v) => v < 0).length;
    const dec3Profit = g4 < g3 && g3 < g2;
    const lastDrop50 = g3 > 0 ? (g3 - g4) / g3 >= 0.50 : false;

    let profitScore = 2.0;
    let profitReason = '';
    if (g3 < 0 && g4 < 0) {
      profitScore = 0.0;
      profitReason = `最近兩季稅後淨利年增率皆為負 (${g3}%、${g4}%)`;
    } else if (g4 < 0 || negCount4 >= 2 || (dec3Profit && g4 < 50)) {
      profitScore = 1.0;
      profitReason = g4 < 0
        ? `最新一季稅後淨利年增率為負 (${g4}%)`
        : negCount4 >= 2
          ? `過去四季出現 ${negCount4} 季負成長`
          : `近三季連續遞減且最新季 (${g4}%) < 50%`;
    } else if ((g2 > 0 && g3 > 0 && g4 > 0 && g4 >= g3) || (g2 >= 50 && g3 >= 50 && g4 >= 50)) {
      profitScore = 4.0;
      profitReason = g2 >= 50 && g3 >= 50 && g4 >= 50
        ? `近三季稅後淨利年增率皆在 50% 以上 (${g2}% / ${g3}% / ${g4}%)`
        : `近三季皆正且最新季 (${g4}%) 較上季 (${g3}%) 成長`;
    } else if (g3 > 0 && g4 > 0 && !lastDrop50) {
      profitScore = 3.0;
      profitReason = `近兩季皆為正數 (${g3}% → ${g4}%) 且無50%以上大幅衰退`;
    } else {
      profitScore = 2.0;
      profitReason = g3 < 0 && g4 > 0
        ? `最新一季稅後淨利年增率由負轉正 (${g3}% → ${g4}%)`
        : `近兩季為正但最新一季衰退幅度較大 (${g3}% → ${g4}%)`;
    }

    // 4. 獲利能力 (EPS) 評分標準 - Sheet Rows A20:C25
    const epsArr = qWin4.map((q) => toNum(q.eps));
    const e4 = epsArr[epsArr.length - 1] ?? 0;
    const ttmEps = round2(epsArr.reduce((s, v) => s + v, 0));

    let epsScore = 2.0;
    let epsReason = '';
    if (ttmEps <= 0) {
      epsScore = 0.0;
      epsReason = `最新四季累積 EPS 虧損 (${ttmEps} 元)`;
    } else if (e4 < 0 || ttmEps <= 1) {
      epsScore = 1.0;
      epsReason = e4 < 0
        ? `最新一季出現虧損 (EPS ${e4} 元，近四季累積 ${ttmEps} 元)`
        : `最新四季累積 EPS ${ttmEps} 元 (0~1元區間)`;
    } else if (ttmEps > 5) {
      epsScore = 4.0;
      epsReason = `最新四季累積 EPS 達 ${ttmEps} 元 (> 5 元)`;
    } else if (ttmEps > 3) {
      epsScore = 3.0;
      epsReason = `最新四季累積 EPS 達 ${ttmEps} 元 (3~5 元)`;
    } else {
      epsScore = 2.0;
      epsReason = `最新四季累積 EPS 達 ${ttmEps} 元 (1~3 元)`;
    }

    // 5. 存貨 (周轉率) 評分標準 - Sheet Rows A26:C32
    let invScore = null;
    let invReason = '';
    if (stock.noInventory || qWin4.every((q) => q.invTurnover === null || q.invTurnover === undefined)) {
      invScore = null;
      invReason = '產業屬性為無庫存或低庫存者（不評分，以5項計算均分）';
    } else {
      const inv = qWin4.map((q) => toNum(q.invTurnover));
      const v1 = inv[0] || 0.01, v2 = inv[1] || 0.01, v3 = inv[2] || 0.01, v4 = inv[3] || 0.01;
      const invAvg4 = round2(mean(inv));
      const d12 = (v1 - v2) / v1;
      const d23 = (v2 - v3) / v2;
      const d34 = (v3 - v4) / v3;
      const twoConsec20 =
        (v2 < v1 && v3 < v2 && (v1 - v3) / v1 >= 0.20) ||
        (v3 < v2 && v4 < v3 && (v2 - v4) / v2 >= 0.20);

      if (d34 >= 0.20) {
        invScore = 0.0;
        invReason = `最新季存貨周轉率 (${v4}次) 較上季 (${v3}次) 下跌逾 20%`;
      } else if (d12 >= 0.20 || d23 >= 0.20) {
        invScore = 1.0;
        invReason = `近四季曾出現單季 20% 以上跌幅 (四平均 ${invAvg4} 次)`;
      } else if (twoConsec20) {
        invScore = 2.0;
        invReason = `近四季連續兩季下跌且累積跌幅逾 20% (平均 ${invAvg4} 次)`;
      } else if (invAvg4 >= 1.5) {
        invScore = 4.0;
        invReason = `近四季穩定不下跌且平均 ${invAvg4} 次 >= 1.5 次`;
      } else {
        invScore = 3.0;
        invReason = `近四季穩定不下跌，平均 ${invAvg4} 次 (< 1.5 次)`;
      }
    }

    // 6. 自由現金流量評分標準 - Sheet Rows A33:C38
    const fcf6 = qWin6.map((q) => toNum(q.fcfM));
    const fcf4 = fcf6.slice(-4);
    const all6Pos = fcf6.every((v) => v > 0);
    const sum6 = Math.round(fcf6.reduce((s, v) => s + v, 0));
    const sum4 = Math.round(fcf4.reduce((s, v) => s + v, 0));

    let fcfScore = 2.0;
    let fcfReason = '';
    if (all6Pos) {
      fcfScore = 4.0;
      fcfReason = `連續六季自由現金流皆為正數 (近6季合計 +${sum6.toLocaleString()} 百萬)`;
    } else if (sum6 > 0 && sum4 > 0) {
      fcfScore = 3.0;
      fcfReason = `近6季累積 (+${sum6.toLocaleString()}) 與近4季累積 (+${sum4.toLocaleString()}) 皆為正數`;
    } else if (sum6 <= 0 && sum4 > 0) {
      fcfScore = 2.0;
      fcfReason = `近6季累積為負 (${sum6.toLocaleString()})，但近4季轉正 (+${sum4.toLocaleString()})`;
    } else if (sum6 > 0 && sum4 <= 0) {
      fcfScore = 1.0;
      fcfReason = `近6季累積為正 (+${sum6.toLocaleString()})，但近4季轉負 (${sum4.toLocaleString()})`;
    } else {
      fcfScore = 0.0;
      fcfReason = `近6季累積 (${sum6.toLocaleString()}) 與近4季累積 (${sum4.toLocaleString()}) 皆為負數`;
    }

    const items = [
      { key: 'revGrowth', label: '營收成長性', score: revScore, reason: revReason },
      { key: 'opMargin', label: '營業利益率', score: opScore, reason: opReason },
      { key: 'profitGrowth', label: '獲利成長性', score: profitScore, reason: profitReason },
      { key: 'eps', label: '獲利能力 (EPS)', score: epsScore, reason: epsReason },
      { key: 'invTurnover', label: '存貨周轉率', score: invScore, excluded: invScore === null, reason: invReason },
      { key: 'fcf', label: '自由現金流量', score: fcfScore, reason: fcfReason }
    ];

    const scoredItems = items.filter((i) => i.score !== null);
    const totalScore = round2(scoredItems.reduce((s, i) => s + i.score, 0));
    const avgScore = round2(totalScore / Math.max(1, scoredItems.length));

    let grade = 'C';
    if (avgScore >= 3.6) grade = 'AA';
    else if (avgScore >= 3.1) grade = 'A';
    else if (avgScore >= 2.5) grade = 'BB';
    else if (avgScore >= 1.8) grade = 'B';

    const byKey = {};
    for (const it of items) byKey[it.key] = it.score;

    return {
      refQuarter: qWin4[qWin4.length - 1]?.q || '',
      refMonth: mWin6[mWin6.length - 1]?.ym || '',
      totalScore,
      maxTotalScore: scoredItems.length * 4,
      scoredCount: scoredItems.length,
      avgScore,
      grade,
      byKey,
      items
    };
  },

  /**
   * Evaluate Current (T0), Previous Month (M-1), and Previous Quarter (Q-1) Six-Indicator Scores
   * for MoM and QoQ score comparison screening and health check display.
   */
  evaluateSixIndicatorsWithHistory(stock) {
    const current = this.scoreSixIndicatorsAtWindow(stock, 0, 0);
    const prevMonth = this.scoreSixIndicatorsAtWindow(stock, 0, 1);
    const prevQuarter = this.scoreSixIndicatorsAtWindow(stock, 1, 3);

    const deltaMoM = round2(current.avgScore - prevMonth.avgScore);
    const deltaQoQ = round2(current.avgScore - prevQuarter.avgScore);

    const itemComparisons = current.items.map((curItem) => {
      const m1Score = prevMonth.byKey[curItem.key];
      const q1Score = prevQuarter.byKey[curItem.key];
      return {
        ...curItem,
        prevMonthScore: m1Score,
        prevQuarterScore: q1Score,
        deltaMoM: curItem.score !== null && m1Score !== null ? round2(curItem.score - m1Score) : 0,
        deltaQoQ: curItem.score !== null && q1Score !== null ? round2(curItem.score - q1Score) : 0
      };
    });

    const mList = stock.monthlyRevenues || [];
    const monthlySeries = [];
    for (let mOffset = 11; mOffset >= 0; mOffset--) {
      const qOffset = Math.floor(mOffset / 3);
      const win = this.scoreSixIndicatorsAtWindow(stock, qOffset, mOffset);
      const mRec = mList[mList.length - 1 - mOffset];
      let label = mRec?.month || mRec?.date || `M-${mOffset}`;
      if (label.length >= 7) label = label.slice(0, 7);
      monthlySeries.push({
        label,
        avgScore: win.avgScore,
        byKey: win.byKey
      });
    }

    return {
      current,
      prevMonth,
      prevQuarter,
      deltaMoM,
      deltaQoQ,
      itemComparisons,
      monthlySeries
    };
  },

  /**
   * 7 Financial Landmines Check (財務地雷 7 項檢查)
   * Rigorous evaluation of core operations, net profit, consecutive losses,
   * non-operating reliance, free cash flow (recent & 4Q cumulative),
   * revenue momentum (quarterly & recent 3-month YoY), and inventory turnover health.
   */
  checkSevenLandmines(stock) {
    const qList = stock.quarters || [];
    const q0 = qList[qList.length - 1] || {};
    const q1 = qList[qList.length - 2] || {};
    const q2 = qList[qList.length - 3] || {};
    const q3 = qList[qList.length - 4] || {};
    const q4 = qList[qList.length - 5] || qList[0] || {};
    const qWin4 = qList.slice(-4);

    const mList = stock.monthlyRevenues || [];
    const mWin3 = mList.slice(-3);
    const m0 = mList[mList.length - 1] || {};
    const avgRevYoY3M = mWin3.length
      ? round2(mWin3.reduce((s, m) => s + toNum(m.yoy), 0) / mWin3.length)
      : toNum(q0.revYoY);

    const opMargin0 = toNum(q0.opMargin);
    const opMargin1 = toNum(q1.opMargin);
    const netMargin0 = toNum(q0.netMargin);
    const eps0 = toNum(q0.eps);
    const eps1 = toNum(q1.eps);
    const fcf0 = toNum(q0.fcfM);
    const fcf4Sum = Math.round(qWin4.reduce((s, q) => s + toNum(q.fcfM), 0));
    const revYoY0 = toNum(q0.revYoY);
    const inv0 = toNum(q0.invTurnover);
    const inv1 = toNum(q1.invTurnover);
    const inv4 = toNum(q4.invTurnover);
    const diffMargin = round2(netMargin0 - opMargin0);
    const lossQuarters4 = qWin4.filter((q) => toNum(q.eps) < 0).length;

    // 1. 本業虧損或營益率大幅惡化
    const opDropPct = opMargin1 > 0 ? round2(((opMargin1 - opMargin0) / opMargin1) * 100) : 0;
    const hitOpLoss = opMargin0 < 0 || (opMargin1 >= 5 && opDropPct >= 30);

    // 2. 稅後虧損（最新季 EPS <= 0）
    const hitNetLoss = eps0 <= 0;

    // 3. 連續虧損或近四季 ≥2 季虧損
    const hitConsecLoss = (eps0 < 0 && eps1 < 0) || lossQuarters4 >= 2;

    // 4. 獲利靠業外（稅後淨利率高於營業利益率 > 3.0 個百分點，或本業低迷靠業外撐場）
    const hitNonOp = diffMargin > 3.0 || (opMargin0 < 3.0 && netMargin0 > opMargin0 + 1.5);

    // 5. 自由現金流為負（最新一季燒錢 < 0 或近四季累計自由現金流為負）
    const hitFcfNeg = fcf0 < 0 || fcf4Sum < 0;

    // 6. 營收動能衰退（最新季營收年增率 < 0，或最新月營收年增率 < 0，或近3月平均年增 < 0）
    const hitRevDecline = revYoY0 < 0 || toNum(m0.yoy) < 0 || avgRevYoY3M < 0;

    // 7. 存貨去化惡化（周轉率較去年同季年減 >= 5%，或較上季季減 >= 10%，或存貨周轉率過低 < 0.8 次）
    const invYoYDropPct = inv4 > 0 ? round2(((inv4 - inv0) / inv4) * 100) : 0;
    const invQoQDropPct = inv1 > 0 ? round2(((inv1 - inv0) / inv1) * 100) : 0;
    const hitInvSlow = !stock.noInventory && (invYoYDropPct >= 5.0 || invQoQDropPct >= 10.0 || (inv0 > 0 && inv0 < 0.8));

    const items = [
      {
        id: 'op_loss',
        label: '本業虧損或驟降（營益率為負或季減逾30%）',
        hit: hitOpLoss,
        detail: `${q0.q || '最新季'} 營業利益率 ${opMargin0.toFixed(2)}%（上季 ${opMargin1.toFixed(2)}%${opDropPct > 0 ? `，季減 ${opDropPct}%` : ''}）`
      },
      {
        id: 'net_loss',
        label: '稅後虧損（單季 EPS ≤ 0）',
        hit: hitNetLoss,
        detail: `${q0.q || '最新季'} EPS ${eps0.toFixed(2)} 元`
      },
      {
        id: 'consec_loss',
        label: '連續或頻繁虧損（近四季 ≥2 季虧損）',
        hit: hitConsecLoss,
        detail: lossQuarters4 > 0
          ? `近四季共有 ${lossQuarters4} 季虧損 (${qWin4.map((q) => `${q.q}:${toNum(q.eps).toFixed(2)}`).join(', ')})`
          : '近四季皆為獲利'
      },
      {
        id: 'non_op_rely',
        label: '獲利靠業外（淨利率＞營益率逾 3 個百分點）',
        hit: hitNonOp,
        detail: `淨利率(歸母) ${netMargin0.toFixed(2)}% − 營業利益率 ${opMargin0.toFixed(2)}% = ${diffMargin >= 0 ? '+' : ''}${diffMargin.toFixed(2)} pp`
      },
      {
        id: 'fcf_neg',
        label: '自由現金流為負（單季或近四季累計燒錢）',
        hit: hitFcfNeg,
        detail: `${q0.q || '最新季'} FCF ${fcf0.toLocaleString()} 百萬（近四季累計 ${fcf4Sum >= 0 ? '+' : ''}${fcf4Sum.toLocaleString()} 百萬）`
      },
      {
        id: 'rev_decline',
        label: '營收動能衰退（季營收或最新月營收年增為負）',
        hit: hitRevDecline,
        detail: `${q0.q || '最新季'} 營收年增 ${revYoY0.toFixed(1)}% ｜ 最新月(${m0.ym || '-'}) 年增 ${toNum(m0.yoy).toFixed(1)}%`
      },
      {
        id: 'inv_slowdown',
        label: '存貨去化變慢（周轉率年減≥5% / 季減≥10% / 低於0.8次）',
        hit: hitInvSlow,
        detail: stock.noInventory
          ? '無存貨產業（免檢）'
          : `最新季周轉率 ${inv0.toFixed(2)} 次（上季 ${inv1.toFixed(2)} 次，去年同季 ${inv4.toFixed(2)} 次）`
      }
    ];

    const hitCount = items.filter((i) => i.hit).length;
    return {
      hitCount,
      totalCount: items.length,
      items
    };
  },

  /**
   * Growth Power Analysis (成長力分析 QoQ vs YoY)
   * Matches screenshot: 營收(%), 營益率(pp), 淨利率(pp), EPS(%)
   */
  computeGrowthAnalysis(stock) {
    const qList = stock.quarters || [];
    const q0 = qList[qList.length - 1] || {};
    const q1 = qList[qList.length - 2] || q0;
    const q4 = qList[qList.length - 5] || qList[0] || q0;

    const pctDiff = (cur, base) => (Math.abs(base) > 0 ? round2(((cur - base) / Math.abs(base)) * 100) : 0);
    const ppDiff = (cur, base) => round2(cur - base);

    return {
      latestQ: q0.q || '2026Q2',
      prevQ: q1.q || '2026Q1',
      prevYearQ: q4.q || '2025Q2',
      rows: [
        {
          label: '營收(季,百萬)',
          latestVal: toNum(q0.revenueM).toLocaleString(),
          qoq: pctDiff(toNum(q0.revenueM), toNum(q1.revenueM)),
          yoy: pctDiff(toNum(q0.revenueM), toNum(q4.revenueM)),
          unit: '%'
        },
        {
          label: '營業利益率(%)',
          latestVal: `${toNum(q0.opMargin).toFixed(2)}%`,
          qoq: ppDiff(toNum(q0.opMargin), toNum(q1.opMargin)),
          yoy: ppDiff(toNum(q0.opMargin), toNum(q4.opMargin)),
          unit: ' pp'
        },
        {
          label: '淨利率(歸母)(%)',
          latestVal: `${toNum(q0.netMargin).toFixed(2)}%`,
          qoq: ppDiff(toNum(q0.netMargin), toNum(q1.netMargin)),
          yoy: ppDiff(toNum(q0.netMargin), toNum(q4.netMargin)),
          unit: ' pp'
        },
        {
          label: 'EPS(元)',
          latestVal: toNum(q0.eps).toFixed(2),
          qoq: pctDiff(toNum(q0.eps), toNum(q1.eps)),
          yoy: pctDiff(toNum(q0.eps), toNum(q4.eps)),
          unit: '%'
        }
      ]
    };
  },

  /**
   * Estimate 1-Year and 3-Year Target Prices (PE Bands × Optimistic/Neutral/Pessimistic Scenarios)
   * Matches screenshot: 股價走勢 vs 目標價 (PE=20/30/40 × 樂觀/中性/悲觀)
   */
  estimateTargetPrices(stock, customOpts = {}) {
    const qList = stock.quarters || [];
    const last4 = qList.slice(-4);
    const ttmEps = Math.max(0.5, round2(last4.reduce((s, q) => s + toNum(q.eps), 0)));
    const latestRevYoY = Math.max(5, Math.min(60, toNum(qList[qList.length - 1]?.revYoY, 20)));

    const horizon = customOpts.horizon === 3 ? 3 : 1; // 1-year or 3-year
    const peBands = Array.isArray(customOpts.peBands) && customOpts.peBands.length === 3
      ? customOpts.peBands.map((n) => toNum(n, 20))
      : (stock.peBands || [20, 30, 40]);

    // Growth multipliers for Optimistic / Neutral / Pessimistic
    const gOpt = Math.min(0.55, Math.max(0.18, (latestRevYoY * 0.9) / 100));
    const gNeu = Math.min(0.35, Math.max(0.10, (latestRevYoY * 0.55) / 100));
    const gPes = Math.min(0.15, Math.max(-0.05, (latestRevYoY * 0.2) / 100));

    const epsOpt = round2(ttmEps * Math.pow(1 + gOpt, horizon));
    const epsNeu = round2(ttmEps * Math.pow(1 + gNeu, horizon));
    const epsPes = round2(ttmEps * Math.pow(1 + gPes, horizon));

    const lines = [];
    const colors = [
      ['#a3e635', '#84cc16', '#4d7c0f'],
      ['#fb923c', '#eab308', '#16a34a'],
      ['#f43f5e', '#f59e0b', '#65a30d']
    ];

    peBands.forEach((pe, peIdx) => {
      lines.push({
        pe,
        scenario: '樂觀',
        eps: epsOpt,
        targetPrice: Math.round(epsOpt * pe),
        color: colors[peIdx]?.[0] || '#f43f5e'
      });
      lines.push({
        pe,
        scenario: '中性',
        eps: epsNeu,
        targetPrice: Math.round(epsNeu * pe),
        color: colors[peIdx]?.[1] || '#eab308'
      });
      lines.push({
        pe,
        scenario: '悲觀',
        eps: epsPes,
        targetPrice: Math.round(epsPes * pe),
        color: colors[peIdx]?.[2] || '#22c55e'
      });
    });

    return {
      horizon,
      ttmEps,
      peBands,
      scenarios: {
        optimistic: { label: '樂觀', growthPct: round2(gOpt * 100), eps: epsOpt },
        neutral: { label: '中性', growthPct: round2(gNeu * 100), eps: epsNeu },
        pessimistic: { label: '悲觀', growthPct: round2(gPes * 100), eps: epsPes }
      },
      lines
    };
  },

  /**
   * Dual-Stock PK Comparison (雙股 PK 對比：股價與價差、八季財報、三年營收、六大指標)
   */
  compareDualStocks(state, codeA = '5274', codeB = '2059') {
    const universe = this.getEnrichedUniverse(state);
    const cleanA = String(codeA || '5274').replace(/\.TW$/i, '').trim();
    const cleanB = String(codeB || '2059').replace(/\.TW$/i, '').trim();
    const stockA = universe.find((s) => s.code === cleanA || s.name === cleanA) || universe[1] || universe[0];
    const stockB = universe.find((s) => s.code === cleanB || s.name === cleanB) || universe[2] || universe[0];

    const priceSeries = (stockA.monthlyPrices || []).map((pA, idx) => {
      const pB = stockB.monthlyPrices?.[idx] || { ym: pA.ym, close: 0 };
      const spread = round2(toNum(pA.close) - toNum(pB.close));
      return {
        ym: pA.ym,
        closeA: toNum(pA.close),
        closeB: toNum(pB.close),
        spread
      };
    });

    const qA8 = (stockA.quarters || []).slice(-8);
    const qB8 = (stockB.quarters || []).slice(-8);
    const quarterSeries = qA8.map((qA, idx) => {
      const qB = qB8[idx] || {};
      return {
        q: qA.q,
        opMarginA: toNum(qA.opMargin),
        opMarginB: toNum(qB.opMargin),
        epsA: toNum(qA.eps),
        epsB: toNum(qB.eps),
        revYoYA: toNum(qA.revYoY),
        revYoYB: toNum(qB.revYoY)
      };
    });

    const mA36 = (stockA.monthlyRevenues || []).slice(-36);
    const mB36 = (stockB.monthlyRevenues || []).slice(-36);
    const revenueSeries = mA36.map((mA, idx) => {
      const mB = mB36[idx] || {};
      return {
        ym: mA.ym,
        revMA: toNum(mA.revM),
        revMB: toNum(mB.revM),
        yoyA: toNum(mA.yoy),
        yoyB: toNum(mB.yoy)
      };
    });

    return {
      stockA,
      stockB,
      priceSeries,
      quarterSeries,
      revenueSeries
    };
  },

  /**
   * 5-Mode Full-Market & Portfolio Screener (五大選股引擎)
   * Modes:
   * - 'six_indicators': 六大指標評分選股 (含前月 MoM / 前季 QoQ 評分比較!)
   * - 'strong': 近期強勢股
   * - 'financial': 財務選股 (含財務雙箭頭)
   * - 'trend': 趨勢選股
   * - 'newhigh': 創新高選股 (五面向共振)
   */
  screenStocks(state, mode = 'six_indicators', filters = {}) {
    let list = this.getEnrichedUniverse(state);

    // Common scope filter (ALL | ETF_0050 | HOLDINGS | WATCHLIST)
    if (filters.scope === 'ETF_0050') {
      list = list.filter((s) => s.is0050);
    } else if (filters.scope === 'HOLDINGS') {
      list = list.filter((s) => s.isHolding);
    } else if (filters.scope === 'WATCHLIST') {
      list = list.filter((s) => s.isWatchlist);
    }

    // Industry filter
    if (filters.industry && filters.industry !== 'ALL') {
      list = list.filter((s) => s.industry === filters.industry);
    }

    if (mode === 'six_indicators') {
      const minAvg = toNum(filters.minAvgScore, 0);
      const maxAvg = filters.maxAvgScore !== undefined && filters.maxAvgScore !== '' ? toNum(filters.maxAvgScore, 4) : 4;
      const maxLandmines = filters.maxLandmines !== undefined && filters.maxLandmines !== '' ? toNum(filters.maxLandmines, 7) : 7;
      const minRev = toNum(filters.minRevScore, 0);
      const minOp = toNum(filters.minOpScore, 0);
      const minProfit = toNum(filters.minProfitScore, 0);
      const minEps = toNum(filters.minEpsScore, 0);
      const minInv = toNum(filters.minInvScore, 0);
      const minFcf = toNum(filters.minFcfScore, 0);
      const momMode = filters.momDeltaMode || 'ALL'; // ALL | UP | UP_015 | NON_DEC | DOWN
      const qoqMode = filters.qoqDeltaMode || 'ALL'; // ALL | UP | UP_030 | UP_050 | NON_DEC | DOWN
      const improvedItem = filters.improvedItem || 'ALL';

      list = list.filter((s) => {
        const cur = s.sixEval.current;
        const byKey = cur.byKey;
        if (cur.avgScore < minAvg || cur.avgScore > maxAvg) return false;
        if (s.landmines.hitCount > maxLandmines) return false;
        if (byKey.revGrowth < minRev) return false;
        if (byKey.opMargin < minOp) return false;
        if (byKey.profitGrowth < minProfit) return false;
        if (byKey.eps < minEps) return false;
        if (byKey.invTurnover !== null && byKey.invTurnover < minInv) return false;
        if (byKey.fcf < minFcf) return false;

        // MoM comparison filter (與前一個月評分比較)
        const dMoM = s.sixEval.deltaMoM;
        if (momMode === 'UP' && !(dMoM > 0)) return false;
        if (momMode === 'UP_015' && !(dMoM >= 0.15)) return false;
        if (momMode === 'NON_DEC' && !(dMoM >= 0)) return false;
        if (momMode === 'DOWN' && !(dMoM < 0)) return false;

        // QoQ comparison filter (與前一季評分比較)
        const dQoQ = s.sixEval.deltaQoQ;
        if (qoqMode === 'UP' && !(dQoQ > 0)) return false;
        if (qoqMode === 'UP_030' && !(dQoQ >= 0.30)) return false;
        if (qoqMode === 'UP_050' && !(dQoQ >= 0.50)) return false;
        if (qoqMode === 'NON_DEC' && !(dQoQ >= 0)) return false;
        if (qoqMode === 'DOWN' && !(dQoQ < 0)) return false;

        // Specific single-indicator MoM / QoQ improvement filter
        if (improvedItem !== 'ALL') {
          const [itemKey, period] = improvedItem.split('_');
          const comp = s.sixEval.itemComparisons.find((c) => c.key === itemKey);
          if (!comp) return false;
          if (period === 'MoM' && !(comp.deltaMoM > 0)) return false;
          if (period === 'QoQ' && !(comp.deltaQoQ > 0)) return false;
        }

        return true;
      });

      const sortBy = filters.sortBy || 'avgScore';
      list.sort((a, b) => {
        if (sortBy === 'deltaMoM') return b.sixEval.deltaMoM - a.sixEval.deltaMoM || b.sixEval.current.avgScore - a.sixEval.current.avgScore;
        if (sortBy === 'deltaQoQ') return b.sixEval.deltaQoQ - a.sixEval.deltaQoQ || b.sixEval.current.avgScore - a.sixEval.current.avgScore;
        if (sortBy === 'doubleArrow') return b.doubleArrow - a.doubleArrow;
        if (sortBy === 'price') return b.price - a.price;
        return b.sixEval.current.avgScore - a.sixEval.current.avgScore || b.sixEval.deltaQoQ - a.sixEval.deltaQoQ;
      });
    } else if (mode === 'strong') {
      const minPrice = toNum(filters.minPrice, 50);
      const minVol = toNum(filters.minVolumeLots, 100);
      const lookbackDays = toNum(filters.lookbackDays, 5);
      const minGainPct = toNum(filters.minGainPct, 5);
      const requireVolSurge = filters.requireVolSurge !== false;
      const minVolSurgePct = toNum(filters.minVolSurgePct, 25);

      list = list.filter((s) => {
        if (s.price < minPrice) return false;
        if (s.latestOpMargin < 0) return false;
        if (s.volumeLots < minVol) return false;
        const gain = lookbackDays >= 10 ? s.change10dPct : s.change5dPct;
        if (gain < minGainPct) return false;
        if (requireVolSurge && s.volRatioPct < minVolSurgePct) return false;
        return true;
      });

      list.sort((a, b) => {
        const gA = lookbackDays >= 10 ? a.change10dPct : a.change5dPct;
        const gB = lookbackDays >= 10 ? b.change10dPct : b.change5dPct;
        return gB - gA;
      });
    } else if (mode === 'financial') {
      const inRange = (val, minV, maxV) => {
        if (minV !== '' && minV !== undefined && minV !== null && val < toNum(minV)) return false;
        if (maxV !== '' && maxV !== undefined && maxV !== null && val > toNum(maxV)) return false;
        return true;
      };
      list = list.filter((s) => {
        if (!inRange(s.latestOpMargin, filters.minOpMargin, filters.maxOpMargin)) return false;
        if (!inRange(s.latestEps, filters.minEps, filters.maxEps)) return false;
        if (!inRange(s.latestRevYoY, filters.minRevYoY, filters.maxRevYoY)) return false;
        if (!inRange(s.latestCumYoY, filters.minCumYoY, filters.maxCumYoY)) return false;
        if (!inRange(s.doubleArrow, filters.minDoubleArrow, filters.maxDoubleArrow)) return false;
        if (!inRange(s.price, filters.minPrice, filters.maxPrice)) return false;
        if (s.pe !== null && !inRange(s.pe, filters.minPe, filters.maxPe)) return false;
        if (!inRange(s.change1mPct, filters.minChange1m, filters.maxChange1m)) return false;
        if (!inRange(s.volumeLots, filters.minVolume, filters.maxVolume)) return false;
        return true;
      });

      const sortBy = filters.sortBy || 'doubleArrow';
      list.sort((a, b) => (toNum(b[sortBy]) || 0) - (toNum(a[sortBy]) || 0));
    } else if (mode === 'trend') {
      const nDays = toNum(filters.trendDays, 10);
      const minMovePct = toNum(filters.minMovePct, 8);
      const breakLowM = toNum(filters.breakLowDays, 0);

      list = list.filter((s) => {
        const gain = nDays >= 20 ? s.change20dPct : nDays >= 10 ? s.change10dPct : s.change5dPct;
        if (Math.abs(gain) < minMovePct) return false;
        if (breakLowM > 0 && s.breakLowDays < breakLowM) return false;
        return true;
      });
      list.sort((a, b) => b.change10dPct - a.change10dPct);
    } else if (mode === 'newhigh') {
      const minRevM = toNum(filters.revHighMonths, 0);
      const minOpQ = toNum(filters.opHighQuarters, 0);
      const minEpsQ = toNum(filters.epsHighQuarters, 0);
      const minPriceD = toNum(filters.priceHighDays, 0);
      const minVolD = toNum(filters.volHighDays, 0);

      list = list.filter((s) => {
        if (minRevM > 0 && s.revNewHighMonths < minRevM) return false;
        if (minOpQ > 0 && s.opMarginNewHighQuarters < minOpQ) return false;
        if (minEpsQ > 0 && s.epsNewHighQuarters < minEpsQ) return false;
        if (minPriceD > 0 && s.priceNewHighDays < minPriceD) return false;
        if (minVolD > 0 && s.volNewHighDays < minVolD) return false;
        return true;
      });
      list.sort((a, b) => b.priceNewHighDays - a.priceNewHighDays || b.doubleArrow - a.doubleArrow);
    }

    return list;
  }
};

// Register Headless Actions for AI Agent & CLI Dual-Track Verification
agentBridge.registerModule('goodstock', {
  description: '好股價 (GoodStockPrice) 台股財務六大指標評分（含前月MoM/前季QoQ比較）、7大財務地雷、目標價區間、雙股PK與五大選股引擎',
  actions: {
    inspectStock: (state, params) => {
      const code = String(params?.code || '2330').replace(/\.TW$/i, '').trim();
      const list = GoodStockCore.getEnrichedUniverse(state);
      const stock = list.find((s) => s.code === code || s.name === code) || list[0];
      return {
        code: stock.code,
        name: stock.name,
        price: stock.price,
        pe: stock.pe,
        doubleArrow: stock.doubleArrow,
        sixEval: stock.sixEval,
        landmines: stock.landmines,
        growth: GoodStockCore.computeGrowthAnalysis(stock),
        target1Y: GoodStockCore.estimateTargetPrices(stock, { horizon: 1 }),
        target3Y: GoodStockCore.estimateTargetPrices(stock, { horizon: 3 })
      };
    },
    screenSixIndicators: (state, params) => {
      const results = GoodStockCore.screenStocks(state, 'six_indicators', params || {});
      return {
        count: results.length,
        items: results.map((s) => ({
          code: s.code,
          name: s.name,
          industry: s.industry,
          isHolding: s.isHolding,
          price: s.price,
          pe: s.pe,
          avgScore: s.sixEval.current.avgScore,
          grade: s.sixEval.current.grade,
          prevMonthAvg: s.sixEval.prevMonth.avgScore,
          deltaMoM: s.sixEval.deltaMoM,
          prevQuarterAvg: s.sixEval.prevQuarter.avgScore,
          deltaQoQ: s.sixEval.deltaQoQ,
          byKey: s.sixEval.current.byKey,
          landmineHits: s.landmines.hitCount,
          doubleArrow: s.doubleArrow
        }))
      };
    },
    compareDualStocks: (state, params) => {
      return GoodStockCore.compareDualStocks(state, params?.codeA || '5274', params?.codeB || '2059');
    }
  },
  schemas: [
    {
      name: 'inspectStock',
      description: '查詢單一股票的近8季財報、36個月營收、7大財務地雷、六大指標評分(含較前月MoM與較前季QoQ變化)、成長力分析與目標價區間',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '股票代號或名稱，例如 2330 或 台積電' } }
      }
    },
    {
      name: 'screenSixIndicators',
      description: '以財務六大指標評分及較前一個月(MoM)/較前一季(QoQ)評分變化篩選股票',
      parameters: {
        type: 'object',
        properties: {
          minAvgScore: { type: 'number' },
          momDeltaMode: { type: 'string', enum: ['ALL', 'UP', 'UP_015', 'NON_DEC', 'DOWN'] },
          qoqDeltaMode: { type: 'string', enum: ['ALL', 'UP', 'UP_030', 'UP_050', 'NON_DEC', 'DOWN'] },
          scope: { type: 'string', enum: ['ALL', 'HOLDINGS', 'WATCHLIST'] }
        }
      }
    },
    {
      name: 'compareDualStocks',
      description: '雙股 PK 對比：比較兩檔股票的月收盤價與價差、八季財報、三年營收與六大指標得分',
      parameters: {
        type: 'object',
        properties: {
          codeA: { type: 'string' },
          codeB: { type: 'string' }
        }
      }
    }
  ]
});
