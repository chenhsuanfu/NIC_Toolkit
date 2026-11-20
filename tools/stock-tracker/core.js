import { agentBridge } from '../../core/agent-bridge.js';

const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const cleaned = String(v).replace(/(?:NT\$|US\$|[$,%\s,])/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
};

const parseDateTs = (rawDate) => {
  const s = String(rawDate || '').trim();
  if (!s || s === '-') return null;
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatNormDate = (rawDate) => {
  const s = String(rawDate || '').trim();
  if (!s || s === '-') return '';
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  return s;
};

export const StockCore = {
  getOptions(state) {
    const settings = state?.stock?.settings || [];
    const findVal = (key, def) => {
      const row = settings.find((r) => r['項目'] === key);
      return row && row['值'] ? String(row['值']).split(',').map((s) => s.trim()).filter(Boolean) : def;
    };

    const fxRows = state?.stock?.fx || [];
    const fxRow = Array.isArray(fxRows) ? fxRows[0] : fxRows;
    const usdTwd = toNum(fxRow?.['採用'] || fxRow?.['自動'], 32.89);

    const symbols = Array.from(
      new Set((state?.stock?.overview || []).map((r) => String(r['代號'] || '').trim().toUpperCase()).filter(Boolean))
    ).sort();

    return {
      types: findVal('類型清單', ['防禦型', '進攻型', '樂透型']),
      brokers: findVal('券商清單', ['B', 'S', 'F', 'C', 'T', 'Y']),
      markets: findVal('市場清單', ['US', 'TW']),
      symbols,
      usdTwd
    };
  },

  getFormOptions(state) {
    return this.getOptions(state);
  },

  getSummary(state) {
    const { usdTwd } = this.getOptions(state);
    const overview = (state?.stock?.overview || []).filter((r) => r['代號'] && toNum(r['剩餘股數']) > 0);
    const snapshots = state?.stock?.dailySnapshots || [];
    const latestSnap = snapshots[0] || {};

    let totalCostUsd = 0;
    let totalCostTwd = 0;
    let totalMarketUsd = 0;
    let totalMarketTwd = 0;
    let twMarketTwd = 0;
    let usMarketTwd = 0;

    for (const row of overview) {
      const mktVal = toNum(row['市值(TWD)']);
      totalCostUsd += toNum(row['成本(USD)']);
      totalCostTwd += toNum(row['成本(TWD)']);
      totalMarketUsd += toNum(row['市值(USD)']);
      totalMarketTwd += mktVal;
      if (String(row['市場'] || '').toUpperCase() === 'TW') twMarketTwd += mktVal;
      else usMarketTwd += mktVal;
    }

    const unrealizedUsd = totalMarketUsd - totalCostUsd;
    const unrealizedTwd = totalMarketTwd - totalCostTwd;
    const returnRate = totalCostTwd > 0 ? unrealizedTwd / totalCostTwd : 0;

    const realizedUsd = toNum(latestSnap['累計已實現(USD)'], 0);
    const realizedTwd = toNum(latestSnap['累計已實現(TWD)'], 0);

    // Risk Breakdown by Type
    const byType = {};
    for (const row of overview) {
      const t = row['類型'] || '未分類';
      if (!byType[t]) {
        byType[t] = { type: t, costTwd: 0, marketTwd: 0, pnlTwd: 0, count: 0 };
      }
      byType[t].costTwd += toNum(row['成本(TWD)']);
      byType[t].marketTwd += toNum(row['市值(TWD)']);
      byType[t].pnlTwd += toNum(row['未實現(TWD)']);
      byType[t].count += 1;
    }

    const riskBreakdown = Object.values(byType).map((item) => ({
      ...item,
      weight: totalMarketTwd > 0 ? item.marketTwd / totalMarketTwd : 0,
      roi: item.costTwd > 0 ? item.pnlTwd / item.costTwd : 0
    }));

    return {
      usdTwd,
      holdingCount: overview.length,
      totalCostUsd: Math.round(totalCostUsd * 100) / 100,
      totalCostTwd: Math.round(totalCostTwd),
      totalMarketUsd: Math.round(totalMarketUsd * 100) / 100,
      totalMarketTwd: Math.round(totalMarketTwd),
      twMarketTwd: Math.round(twMarketTwd),
      usMarketTwd: Math.round(usMarketTwd),
      unrealizedUsd: Math.round(unrealizedUsd * 100) / 100,
      unrealizedTwd: Math.round(unrealizedTwd),
      returnRate,
      realizedUsd,
      realizedTwd,
      riskBreakdown
    };
  },

  filterHoldings(state, { market = 'ALL', type = 'ALL', query = '' } = {}) {
    const list = (state?.stock?.overview || []).filter((r) => r['代號'] && toNum(r['剩餘股數']) > 0);
    const q = String(query || '').trim().toUpperCase();

    return list.filter((row) => {
      if (market !== 'ALL' && row['市場'] !== market) return false;
      if (type !== 'ALL' && row['類型'] !== type) return false;
      if (q && !String(row['代號']).toUpperCase().includes(q)) return false;
      return true;
    });
  },

  /**
   * Get sorted entry trade records for history tab & AI Agent queries.
   * Ensures trades with an explicit '進場日' sort chronologically (newest on top when dir='desc'),
   * while legacy imported trades without '進場日' are placed at the bottom with a clear display label.
   */
  getSortedTrades(state, { col = 'date', dir = 'desc', limit = 60 } = {}) {
    const raw = Array.isArray(state?.stock?.recentTrades) ? state.stock.recentTrades : [];
    const mul = dir === 'asc' ? 1 : -1;

    const indexed = raw.map((t, idx) => {
      const rawEntryDate = String(t?.['進場日'] || '').trim();
      const rawCreatedAt = String(t?.['建立時間'] || '').trim();
      const entryTs = parseDateTs(rawEntryDate);
      const createdTs = parseDateTs(rawCreatedAt);
      const hasEntryDate = entryTs !== null;
      const normEntryDate = hasEntryDate ? formatNormDate(rawEntryDate) : '';
      const normCreatedDate = createdTs !== null ? formatNormDate(rawCreatedAt) : rawCreatedAt;
      const displayDate = hasEntryDate
        ? normEntryDate
        : (normCreatedDate ? `未填 (建檔 ${normCreatedDate})` : '未填進場日');

      const price = toNum(t?.['進場價'], 0);
      const shares = toNum(t?.['進場股數'], 0);
      return {
        t,
        idx,
        hasEntryDate,
        entryTs,
        createdTs,
        displayDate,
        symbol: String(t?.['代號'] || '').trim().toUpperCase(),
        price,
        shares,
        costNative: Math.round(price * shares * 100) / 100
      };
    });

    indexed.sort((a, b) => {
      if (col === 'symbol') {
        const diff = a.symbol.localeCompare(b.symbol) * mul;
        if (diff !== 0) return diff;
      } else if (col === 'price') {
        const diff = (a.price - b.price) * mul;
        if (diff !== 0) return diff;
      } else if (col === 'shares') {
        const diff = (a.shares - b.shares) * mul;
        if (diff !== 0) return diff;
      } else if (col === 'amount' || col === 'cost') {
        const diff = (a.costNative - b.costNative) * mul;
        if (diff !== 0) return diff;
      }

      // Records with explicit '進場日' always come before missing-'進場日' legacy records
      if (a.hasEntryDate && !b.hasEntryDate) return -1;
      if (!a.hasEntryDate && b.hasEntryDate) return 1;

      if (a.hasEntryDate && b.hasEntryDate && a.entryTs !== b.entryTs) {
        return (a.entryTs - b.entryTs) * mul;
      }
      if (a.createdTs !== null && b.createdTs !== null && a.createdTs !== b.createdTs) {
        return (a.createdTs - b.createdTs) * mul;
      }
      // Same-day tie-breaker: later row index on top when desc
      return (a.idx - b.idx) * mul;
    });

    const out = indexed.map((item) => ({
      ...item.t,
      displayDate: item.displayDate,
      hasEntryDate: item.hasEntryDate,
      costNative: item.costNative
    }));

    return limit > 0 ? out.slice(0, limit) : out;
  },

  /**
   * Get all inventory lots (open & closed) for a specific stock ticker
   * Supports sorting by 'date' (進場日) or 'amount' (該批投入成本金額 = 進場價 × 剩餘股數), plus 'price', 'shares', 'pnl', 'roi'
   */
  getLotsBySymbol(state, symbol, sortOpts = {}) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return { symbol: '', openLots: [], closedLots: [], holding: null };

    const { usdTwd } = this.getOptions(state);
    const holding = (state?.stock?.overview || []).find((r) => String(r['代號']).toUpperCase() === sym) || null;
    const currentPrice = toNum(holding?.['現價(原幣)'], 0);

    const exits = state?.stock?.recentExits || [];
    const exitedSharesMap = {};
    const exitRecordsMap = {};
    for (const ex of exits) {
      const tid = String(ex['交易id'] || '').trim();
      if (!tid) continue;
      exitedSharesMap[tid] = (exitedSharesMap[tid] || 0) + toNum(ex['出場股數'], 0);
      if (!exitRecordsMap[tid]) exitRecordsMap[tid] = [];
      exitRecordsMap[tid].push(ex);
    }

    const allTrades = state?.stock?.recentTrades || [];
    const trades = [];
    allTrades.forEach((t, idx) => {
      if (String(t['代號'] || '').trim().toUpperCase() === sym) {
        trades.push({ t, idx });
      }
    });

    const openLots = [];
    const closedLots = [];

    for (const { t, idx } of trades) {
      const tid = String(t.id || '').trim();
      const entryShares = toNum(t['進場股數'], 0);
      const exitedShares = exitedSharesMap[tid] || 0;
      const remainingShares = Math.max(0, Math.round((entryShares - exitedShares) * 10000) / 10000);
      const entryPrice = toNum(t['進場價'], 0);
      const refPrice = currentPrice > 0 ? currentPrice : entryPrice;
      const mkt = String(t['市場'] || holding?.['市場'] || (sym.endsWith('.TW') || sym.endsWith('.TWO') ? 'TW' : 'US')).toUpperCase();

      // 該批投入成本金額 (進場價 × 剩餘股數)
      const costAmountNative = Math.round(entryPrice * remainingShares * 100) / 100;
      const costAmountTwd = Math.round(mkt === 'TW' ? costAmountNative : costAmountNative * usdTwd);
      // 該批原投入總成本 (給已出場完畢批次參考)
      const entryCostNative = Math.round(entryPrice * entryShares * 100) / 100;
      const marketAmountNative = Math.round(refPrice * remainingShares * 100) / 100;
      const unrealizedNative = (refPrice - entryPrice) * remainingShares;
      const roi = entryPrice > 0 ? (refPrice - entryPrice) / entryPrice : 0;

      const rawEntryDate = String(t['進場日'] || '').trim();
      const rawCreatedAt = String(t['建立時間'] || '').trim();
      const entryTs = parseDateTs(rawEntryDate);
      const createdTs = parseDateTs(rawCreatedAt);
      const hasEntryDate = entryTs !== null;
      const normEntryDate = hasEntryDate ? formatNormDate(rawEntryDate) : '';
      const normCreatedDate = createdTs !== null ? formatNormDate(rawCreatedAt) : rawCreatedAt;
      const displayEntryDate = hasEntryDate
        ? normEntryDate
        : (normCreatedDate ? `未填 (建檔 ${normCreatedDate})` : '未填進場日');

      const lotObj = {
        id: tid,
        rowIdx: idx,
        symbol: sym,
        market: mkt,
        type: t['類型'] || holding?.['類型'] || '進攻型',
        broker: t['券商'] || 'F',
        entryDate: displayEntryDate,
        rawEntryDate,
        hasEntryDate,
        entryTs,
        createdTs,
        entryPrice,
        entryShares,
        exitedShares,
        remainingShares,
        costAmountNative,
        costAmountTwd,
        entryCostNative,
        marketAmountNative,
        currentPrice: refPrice,
        unrealizedNative: Math.round(unrealizedNative * 100) / 100,
        roi,
        note: t['備註'] || '',
        exits: exitRecordsMap[tid] || []
      };

      if (remainingShares > 0) {
        openLots.push(lotObj);
      } else {
        closedLots.push(lotObj);
      }
    }

    const sortBy = sortOpts.sortBy || 'date'; // 'date' | 'amount' | 'price' | 'shares' | 'pnl' | 'roi'
    const sortDir = sortOpts.sortDir || 'desc'; // 'desc' | 'asc'
    const mul = sortDir === 'asc' ? 1 : -1;

    const lotComparator = (a, b, isClosed = false) => {
      if (sortBy === 'amount' || sortBy === 'cost') {
        const valA = isClosed ? a.entryCostNative : a.costAmountNative;
        const valB = isClosed ? b.entryCostNative : b.costAmountNative;
        if (valA !== valB) return (valA - valB) * mul;
      } else if (sortBy === 'price') {
        if (a.entryPrice !== b.entryPrice) return (a.entryPrice - b.entryPrice) * mul;
      } else if (sortBy === 'shares') {
        const shA = isClosed ? a.entryShares : a.remainingShares;
        const shB = isClosed ? b.entryShares : b.remainingShares;
        if (shA !== shB) return (shA - shB) * mul;
      } else if (sortBy === 'pnl') {
        if (a.unrealizedNative !== b.unrealizedNative) return (a.unrealizedNative - b.unrealizedNative) * mul;
      } else if (sortBy === 'roi') {
        if (a.roi !== b.roi) return (a.roi - b.roi) * mul;
      }

      // Date comparison (explicit entryDate first, missing entryDate at bottom)
      if (a.hasEntryDate && !b.hasEntryDate) return -1;
      if (!a.hasEntryDate && b.hasEntryDate) return 1;
      if (a.hasEntryDate && b.hasEntryDate && a.entryTs !== b.entryTs) {
        return (a.entryTs - b.entryTs) * mul;
      }
      if (a.createdTs !== null && b.createdTs !== null && a.createdTs !== b.createdTs) {
        return (a.createdTs - b.createdTs) * mul;
      }
      return (a.rowIdx - b.rowIdx) * mul;
    };

    openLots.sort((a, b) => lotComparator(a, b, false));
    closedLots.sort((a, b) => lotComparator(a, b, true));

    const inferredMarket = holding?.['市場'] || openLots[0]?.market || closedLots[0]?.market
      || (sym.endsWith('.TW') || sym.endsWith('.TWO') ? 'TW' : 'US');

    return {
      symbol: sym,
      market: String(inferredMarket).toUpperCase(),
      holding,
      currentPrice,
      sortBy,
      sortDir,
      openLots,
      closedLots
    };
  },

  getLotsForSymbol(state, symbol, sortOpts = {}) {
    return this.getLotsBySymbol(state, symbol, sortOpts);
  },

  addTrade(state, params, storeInstance) {
    const symbol = String(params.symbol || params['代號'] || '').trim().toUpperCase();
    const market = String(params.market || params['市場'] || (symbol.endsWith('.TW') || symbol.endsWith('.TWO') ? 'TW' : 'US')).toUpperCase();
    const type = String(params.type || params['類型'] || '進攻型');
    const broker = String(params.broker || params['券商'] || 'F').toUpperCase();
    const date = String(params.date || params['進場日'] || new Date().toISOString().slice(0, 10));
    const rawPrice = toNum(params.price ?? params['進場價'], 0);
    const shares = toNum(params.shares ?? params['進場股數'], 0);
    const fee = Math.max(0, toNum(params.fee ?? params['手續費'], 0));
    const note = String(params.note || params['備註'] || '').trim();

    if (!symbol) throw new Error('請輸入股票代號 (如 NVDA 或 2330.TW)');
    if (rawPrice <= 0 || shares <= 0) throw new Error('進場價與進場股數必須大於 0');

    // 將手續費統一折算併入「進場價」中：(成交單價 × 股數 + 手續費) ÷ 股數
    const totalCostNative = rawPrice * shares + fee;
    const price = fee > 0 ? (Math.round((totalCostNative / shares) * 10000) / 10000) : rawPrice;

    const { usdTwd } = this.getOptions(state);
    const id = crypto.randomUUID ? crypto.randomUUID() : 'tr-' + Date.now();
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 16);

    const newTrade = {
      id,
      '建立時間': nowStr,
      '類型': type,
      '市場': market,
      '券商': broker,
      '代號': symbol,
      '進場日': date,
      '進場價': String(price),
      '進場股數': String(shares),
      '備註': note
    };

    storeInstance.mutate('stock.appendTrade', newTrade, (s) => {
      s.stock.recentTrades.push(newTrade);
      // Optimistically update overview holdings
      const existing = s.stock.overview.find((r) => String(r['代號']).toUpperCase() === symbol);
      const addedCostNative = totalCostNative;
      const addedCostUsd = market === 'US' ? addedCostNative : addedCostNative / usdTwd;
      const addedCostTwd = market === 'TW' ? addedCostNative : addedCostNative * usdTwd;

      if (existing) {
        const oldShares = toNum(existing['剩餘股數']);
        const oldAvg = toNum(existing['平均成本(原幣)']);
        const curPrice = toNum(existing['現價(原幣)'], rawPrice);
        const newShares = oldShares + shares;
        const newAvg = (oldShares * oldAvg + addedCostNative) / newShares;
        const newCostUsd = toNum(existing['成本(USD)']) + addedCostUsd;
        const newCostTwd = toNum(existing['成本(TWD)']) + addedCostTwd;
        const newMktNative = newShares * curPrice;
        const newMktUsd = market === 'US' ? newMktNative : newMktNative / usdTwd;
        const newMktTwd = market === 'TW' ? newMktNative : newMktNative * usdTwd;

        existing['剩餘股數'] = String(newShares);
        existing['平均成本(原幣)'] = String(Math.round(newAvg * 100) / 100);
        existing['成本(USD)'] = String(Math.round(newCostUsd * 100) / 100);
        existing['成本(TWD)'] = String(Math.round(newCostTwd));
        existing['市值(USD)'] = String(Math.round(newMktUsd * 100) / 100);
        existing['市值(TWD)'] = String(Math.round(newMktTwd));
        existing['未實現(USD)'] = String(Math.round((newMktUsd - newCostUsd) * 100) / 100);
        existing['未實現(TWD)'] = String(Math.round(newMktTwd - newCostTwd));
        existing['報酬率'] = String(newCostTwd > 0 ? (newMktTwd - newCostTwd) / newCostTwd : 0);
      } else {
        s.stock.overview.push({
          '排名': String(s.stock.overview.length + 1),
          '代號': symbol,
          '市場': market,
          '類型': type,
          '剩餘股數': String(shares),
          '平均成本(原幣)': String(Math.round(price * 100) / 100),
          '現價(原幣)': String(rawPrice),
          '成本(USD)': String(Math.round(addedCostUsd * 100) / 100),
          '成本(TWD)': String(Math.round(addedCostTwd)),
          '市值(USD)': String(Math.round(addedCostUsd * 100) / 100),
          '市值(TWD)': String(Math.round(addedCostTwd)),
          '未實現(USD)': '0',
          '未實現(TWD)': '0',
          '報酬率': '0',
          '券商分佈': `${broker}:${shares}`
        });
      }
    });

    return {
      ...newTrade,
      rawPrice,
      fee,
      effectivePrice: price,
      totalCostNative: Math.round(totalCostNative * 100) / 100
    };
  },

  addExit(state, params, storeInstance) {
    const tradeId = String(params.tradeId || params.lotId || params['交易id'] || '').trim();
    const date = String(params.date || params['出場日'] || new Date().toISOString().slice(0, 10));
    const exitPrice = toNum(params.exitPrice ?? params.price ?? params['出場價'], 0);
    const exitShares = toNum(params.exitShares ?? params.shares ?? params['出場股數'], 0);
    const note = String(params.note || params['備註'] || '').trim();

    if (!tradeId) throw new Error('請選擇或輸入對應的進場交易 ID');
    if (exitPrice <= 0 || exitShares <= 0) throw new Error('出場價與出場股數必須大於 0');

    // Verify target lot and prevent overselling beyond remainingShares
    const targetTrade = (state?.stock?.recentTrades || []).find((t) => String(t.id || '').trim() === tradeId);
    if (targetTrade) {
      const sym = String(targetTrade['代號'] || '').trim().toUpperCase();
      const lotInfo = this.getLotsBySymbol(state, sym);
      const targetLot = (lotInfo.openLots || []).find((l) => l.id === tradeId);
      if (!targetLot) {
        throw new Error(`此批次 (${tradeId}) 已全數出場或無剩餘可賣股數`);
      }
      if (exitShares > targetLot.remainingShares + 0.0001) {
        throw new Error(`賣出股數 (${exitShares}) 不可超過此批次剩餘可賣股數 (${targetLot.remainingShares})`);
      }
    }

    const id = crypto.randomUUID ? crypto.randomUUID() : 'ex-' + Date.now();
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 16);

    const newExit = {
      id,
      '建立時間': nowStr,
      '交易id': tradeId,
      '出場日': date,
      '出場價': String(exitPrice),
      '出場股數': String(exitShares),
      '備註': note
    };

    storeInstance.mutate('stock.appendExit', newExit, (s) => {
      if (!Array.isArray(s.stock.recentExits)) s.stock.recentExits = [];
      s.stock.recentExits.push(newExit);

      // Optimistically update overview holdings when selling a specific lot
      const trade = (s.stock.recentTrades || []).find((t) => String(t.id || '').trim() === tradeId);
      if (trade) {
        const sym = String(trade['代號'] || '').trim().toUpperCase();
        const existing = (s.stock.overview || []).find((r) => String(r['代號'] || '').trim().toUpperCase() === sym);
        if (existing) {
          const { usdTwd } = this.getOptions(s);
          const market = String(existing['市場'] || trade['市場'] || 'US').toUpperCase();
          const curPrice = toNum(existing['現價(原幣)'], exitPrice);

          // Recompute exact remaining shares, weighted average cost, and broker distribution from remaining open lots
          const updatedLots = this.getLotsBySymbol(s, sym).openLots || [];
          let newShares = 0;
          let newCostNative = 0;
          const brokerMap = {};

          if (updatedLots.length > 0) {
            for (const lot of updatedLots) {
              newShares += lot.remainingShares;
              newCostNative += lot.remainingShares * lot.entryPrice;
              const br = String(lot.broker || 'F').trim().toUpperCase();
              brokerMap[br] = (brokerMap[br] || 0) + lot.remainingShares;
            }
            newShares = Math.round(newShares * 10000) / 10000;
            const avgCost = newShares > 0 ? (newCostNative / newShares) : 0;
            existing['平均成本(原幣)'] = String(Math.round(avgCost * 100) / 100);
            existing['券商分佈'] = Object.entries(brokerMap)
              .map(([b, sh]) => `${b}:${Math.round(sh * 10000) / 10000}`)
              .join(' / ');
          } else {
            const oldShares = toNum(existing['剩餘股數']);
            newShares = Math.max(0, Math.round((oldShares - exitShares) * 10000) / 10000);
            const avgCost = toNum(existing['平均成本(原幣)']);
            newCostNative = newShares * avgCost;
          }

          const newMktNative = newShares * curPrice;
          const newCostUsd = market === 'US' ? newCostNative : newCostNative / usdTwd;
          const newCostTwd = market === 'TW' ? newCostNative : newCostNative * usdTwd;
          const newMktUsd = market === 'US' ? newMktNative : newMktNative / usdTwd;
          const newMktTwd = market === 'TW' ? newMktNative : newMktNative * usdTwd;

          existing['剩餘股數'] = String(newShares);
          existing['成本(USD)'] = String(Math.round(newCostUsd * 100) / 100);
          existing['成本(TWD)'] = String(Math.round(newCostTwd));
          existing['市值(USD)'] = String(Math.round(newMktUsd * 100) / 100);
          existing['市值(TWD)'] = String(Math.round(newMktTwd));
          existing['未實現(USD)'] = String(Math.round((newMktUsd - newCostUsd) * 100) / 100);
          existing['未實現(TWD)'] = String(Math.round(newMktTwd - newCostTwd));
          existing['報酬率'] = String(newCostTwd > 0 ? (newMktTwd - newCostTwd) / newCostTwd : 0);
        }
      }
    });

    return newExit;
  },

  upsertWatchlist(state, params, storeInstance) {
    const symbol = String(params.symbol || params['代號'] || '').trim().toUpperCase();
    const market = String(params.market || params['市場'] || (symbol.endsWith('.TW') || symbol.endsWith('.TWO') ? 'TW' : 'US')).toUpperCase();
    const fairPrice = toNum(params.fairPrice ?? params['公允價格'], 0);
    const currentPrice = toNum(params.currentPrice ?? params['採用價'], 0);

    if (!symbol) throw new Error('請輸入股票代號');
    if (fairPrice <= 0) throw new Error('公允價格必須大於 0');

    const record = {
      '代號': symbol,
      '市場': market,
      '公允價格': String(fairPrice),
      '採用價': currentPrice > 0 ? String(currentPrice) : '',
      '更新時間': new Date().toISOString().slice(0, 10)
    };

    storeInstance.mutate('stock.upsertWatchlist', record, (s) => {
      const idx = s.stock.watchlist.findIndex((w) => String(w['代號']).toUpperCase() === symbol);
      if (idx >= 0) {
        s.stock.watchlist[idx] = { ...s.stock.watchlist[idx], ...record };
      } else {
        s.stock.watchlist.unshift(record);
      }
    });

    return record;
  },

  /**
   * Built-in "GoodStockPrice / MVP" Target Price & EPS Valuation Engine (Client-Side Compute)
   */
  estimateTargetPrice(_state, params) {
    const baseRevenue = toNum(params.baseRevenue, 28943); // 基準年營收 (億)
    const growthRatePct = toNum(params.growthRatePct, 24); // 預估營收年增率 %
    const netMarginPct = toNum(params.netMarginPct, 42.5); // 預估歸母稅後淨利率 %
    const sharesBillion = toNum(params.sharesBillion ?? params.shareCapital, 259.3); // 發行總股數 (億股，如 2330 為 259.3 億股)
    const targetPe = toNum(params.targetPe, 22); // 目標本益比

    const estRevenue = baseRevenue * (1 + growthRatePct / 100);
    const estNetProfit = estRevenue * (netMarginPct / 100);
    const estEps = sharesBillion > 0 ? (estNetProfit / sharesBillion) : 0;
    const targetPrice = estEps * targetPe;

    // 3x3 Matrix (Growth -5%/Base/+5% vs PE -3/Base/+3)
    const matrix = [-5, 0, 5].map((gDelta) => {
      const g = growthRatePct + gDelta;
      const rev = baseRevenue * (1 + g / 100);
      const eps = sharesBillion > 0 ? (rev * (netMarginPct / 100)) / sharesBillion : 0;
      return {
        growthPct: g,
        eps: Math.round(eps * 100) / 100,
        peLow: Math.round(eps * Math.max(5, targetPe - 3) * 10) / 10,
        peBase: Math.round(eps * targetPe * 10) / 10,
        peHigh: Math.round(eps * (targetPe + 3) * 10) / 10
      };
    });

    return {
      estRevenue: Math.round(estRevenue * 100) / 100,
      estNetProfit: Math.round(estNetProfit * 100) / 100,
      estEps: Math.round(estEps * 100) / 100,
      targetPrice: Math.round(targetPrice * 100) / 100,
      matrix
    };
  },

  /**
   * Read two-tier target weight config from state.stock.settings ('目標權重JSON')
   * Format: { types: { '進攻型': 70, '防禦型': 20, '樂透型': 10 }, stocks: { 'TSLA': 40, ... } }
   */
  getTargetConfig(state) {
    const defaultTypes = { '進攻型': 70, '防禦型': 20, '樂透型': 10 };
    const settings = state?.stock?.settings || [];
    const row = settings.find((r) => r['項目'] === '目標權重JSON');
    if (row && row['值']) {
      try {
        const parsed = JSON.parse(row['值']);
        if (parsed && typeof parsed === 'object') {
          if (parsed.types || parsed.stocks) {
            return {
              types: { ...defaultTypes, ...(parsed.types || {}) },
              stocks: { ...(parsed.stocks || {}) }
            };
          }
          // Backward compatibility if flat stock map
          return { types: defaultTypes, stocks: parsed };
        }
      } catch (_) {}
    }
    return { types: defaultTypes, stocks: {} };
  },

  saveTargetConfig(state, configObj, storeInstance) {
    const cur = this.getTargetConfig(state);
    const nextTypes = {};
    for (const [k, v] of Object.entries(configObj?.types || cur.types)) {
      const num = toNum(v, 0);
      nextTypes[String(k).trim()] = Math.max(0, Math.round(num * 100) / 100);
    }
    const nextStocks = {};
    for (const [k, v] of Object.entries(configObj?.stocks || cur.stocks)) {
      const sym = String(k || '').trim().toUpperCase();
      const num = toNum(v, 0);
      if (sym && num > 0) {
        nextStocks[sym] = Math.round(num * 100) / 100;
      }
    }
    const payloadObj = { types: nextTypes, stocks: nextStocks };
    const record = {
      '項目': '目標權重JSON',
      '值': JSON.stringify(payloadObj),
      '說明': '兩層式策略池與個股目標配置百分比(%)'
    };

    storeInstance.mutate('stock.upsertSetting', record, (s) => {
      if (!Array.isArray(s.stock.settings)) s.stock.settings = [];
      const idx = s.stock.settings.findIndex((r) => r['項目'] === '目標權重JSON');
      if (idx >= 0) {
        s.stock.settings[idx] = { ...s.stock.settings[idx], ...record };
      } else {
        s.stock.settings.push(record);
      }
    });

    return payloadObj;
  },

  setTypeTargetWeight(state, { type, targetPct }, storeInstance) {
    const cur = this.getTargetConfig(state);
    const tp = String(type || '').trim();
    if (!tp) return cur;
    cur.types[tp] = Math.max(0, Math.round(toNum(targetPct, 0) * 100) / 100);
    return this.saveTargetConfig(state, cur, storeInstance);
  },

  setStockTargetWeight(state, { symbol, targetPct }, storeInstance) {
    const cur = this.getTargetConfig(state);
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return cur;
    const val = toNum(targetPct, 0);
    if (val <= 0) {
      delete cur.stocks[sym];
    } else {
      cur.stocks[sym] = Math.round(val * 100) / 100;
    }
    return this.saveTargetConfig(state, cur, storeInstance);
  },

  /**
   * Auto-fill or clear Tier-2 stock weights inside a specific strategy pool ('進攻型' | '防禦型' | '樂透型')
   */
  autoFillPoolWeights(state, { poolType = '進攻型', basis = 'cost' }, storeInstance) {
    const cur = this.getTargetConfig(state);
    const poolHoldings = (state?.stock?.overview || []).filter(
      (r) => r['代號'] && toNum(r['剩餘股數']) > 0 && (r['類型'] || '進攻型') === poolType
    );

    if (basis === 'clear') {
      for (const r of poolHoldings) {
        const sym = String(r['代號']).trim().toUpperCase();
        delete cur.stocks[sym];
      }
      return this.saveTargetConfig(state, cur, storeInstance);
    }

    let poolTotal = 0;
    for (const r of poolHoldings) {
      poolTotal += basis === 'market' ? toNum(r['市值(TWD)']) : toNum(r['成本(TWD)']);
    }

    if (poolTotal > 0) {
      let runningSum = 0;
      poolHoldings.forEach((r, idx) => {
        const sym = String(r['代號']).trim().toUpperCase();
        const val = basis === 'market' ? toNum(r['市值(TWD)']) : toNum(r['成本(TWD)']);
        if (idx === poolHoldings.length - 1) {
          cur.stocks[sym] = Math.max(0, Math.round((100 - runningSum) * 10) / 10);
        } else {
          const w = Math.round((val / poolTotal) * 1000) / 10;
          cur.stocks[sym] = w;
          runningSum += w;
        }
      });
    }
    return this.saveTargetConfig(state, cur, storeInstance);
  },

  /**
   * Two-Tier Dual-Basis Rebalance Comparison:
   * Tier 1: Strategy Pools ('進攻型' | '防禦型' | '樂透型') vs Portfolio Total Cost & Market Value
   * Tier 2: Stocks inside selected Pool vs Pool Target (or Pool Current) Cost & Market Value
   */
  getRebalanceComparison(state, { activePool = '進攻型', calcMode = 'TOP_DOWN', query = '' } = {}) {
    const { usdTwd, types } = this.getOptions(state);
    const allHoldings = (state?.stock?.overview || []).filter((r) => r['代號'] && toNum(r['剩餘股數']) > 0);
    const cfg = this.getTargetConfig(state);

    let portfolioCostTwd = 0;
    let portfolioMarketTwd = 0;
    for (const r of allHoldings) {
      portfolioCostTwd += toNum(r['成本(TWD)']);
      portfolioMarketTwd += toNum(r['市值(TWD)']);
    }

    const poolTypes = Array.from(new Set(['進攻型', '防禦型', '樂透型', ...types]));
    let tier1TotalTargetPct = 0;

    // Tier 1: Strategy Pool Rows
    const tier1Rows = poolTypes.map((tp) => {
      const items = allHoldings.filter((r) => (r['類型'] || '進攻型') === tp);
      let poolCostTwd = 0;
      let poolMarketTwd = 0;
      for (const r of items) {
        poolCostTwd += toNum(r['成本(TWD)']);
        poolMarketTwd += toNum(r['市值(TWD)']);
      }
      const targetPct = toNum(cfg.types[tp], 0);
      tier1TotalTargetPct += targetPct;

      const costWeightPct = portfolioCostTwd > 0 ? (poolCostTwd / portfolioCostTwd) * 100 : 0;
      const costDiffPct = costWeightPct - targetPct;
      const targetCostTwd = portfolioCostTwd * (targetPct / 100);
      const costActionTwd = targetCostTwd - poolCostTwd;

      const marketWeightPct = portfolioMarketTwd > 0 ? (poolMarketTwd / portfolioMarketTwd) * 100 : 0;
      const marketDiffPct = marketWeightPct - targetPct;
      const targetMarketTwd = portfolioMarketTwd * (targetPct / 100);
      const marketActionTwd = targetMarketTwd - poolMarketTwd;

      return {
        type: tp,
        count: items.length,
        targetPct: Math.round(targetPct * 100) / 100,
        costTwd: Math.round(poolCostTwd),
        costWeightPct: Math.round(costWeightPct * 100) / 100,
        costDiffPct: Math.round(costDiffPct * 100) / 100,
        targetCostTwd: Math.round(targetCostTwd),
        costActionTwd: Math.round(costActionTwd),
        marketTwd: Math.round(poolMarketTwd),
        marketWeightPct: Math.round(marketWeightPct * 100) / 100,
        marketDiffPct: Math.round(marketDiffPct * 100) / 100,
        targetMarketTwd: Math.round(targetMarketTwd),
        marketActionTwd: Math.round(marketActionTwd)
      };
    });

    // Tier 2: Stocks inside activePool (or ALL if activePool === 'ALL')
    const activeTier1 = tier1Rows.find((r) => r.type === activePool) || tier1Rows[0];
    const poolHoldings = activePool === 'ALL'
      ? allHoldings
      : allHoldings.filter((r) => (r['類型'] || '進攻型') === activePool);

    const poolCurrentCostTwd = activePool === 'ALL' ? portfolioCostTwd : (activeTier1?.costTwd || 0);
    const poolCurrentMarketTwd = activePool === 'ALL' ? portfolioMarketTwd : (activeTier1?.marketTwd || 0);
    const poolTargetCostTwd = activePool === 'ALL' ? portfolioCostTwd : (activeTier1?.targetCostTwd || 0);
    const poolTargetMarketTwd = activePool === 'ALL' ? portfolioMarketTwd : (activeTier1?.targetMarketTwd || 0);
    const poolTypeTargetPct = activePool === 'ALL' ? 100 : (activeTier1?.targetPct || 0);

    // Choose base denominator for target $ calculation
    const denomCostTwd = (calcMode === 'TOP_DOWN' && activePool !== 'ALL' && poolTargetCostTwd > 0)
      ? poolTargetCostTwd
      : poolCurrentCostTwd;
    const denomMarketTwd = (calcMode === 'TOP_DOWN' && activePool !== 'ALL' && poolTargetMarketTwd > 0)
      ? poolTargetMarketTwd
      : poolCurrentMarketTwd;

    let tier2TotalTargetPct = 0;
    const tier2AllRows = poolHoldings.map((r) => {
      const symbol = String(r['代號'] || '').trim().toUpperCase();
      const mkt = r['市場'] || 'US';
      const tp = r['類型'] || '進攻型';
      const shares = toNum(r['剩餘股數']);
      const avgCostNative = toNum(r['平均成本(原幣)']);
      const currentPriceNative = toNum(r['現價(原幣)']);
      const costTwd = toNum(r['成本(TWD)']);
      const marketTwd = toNum(r['市值(TWD)']);

      const targetPct = toNum(cfg.stocks[symbol], 0);
      tier2TotalTargetPct += targetPct;
      const globalTargetPct = (poolTypeTargetPct * targetPct) / 100;

      // 1. 池內持有成本佔比 & 差距 (目前池內成本% - 池內目標%)
      const costWeightPct = poolCurrentCostTwd > 0 ? (costTwd / poolCurrentCostTwd) * 100 : 0;
      const costDiffPct = costWeightPct - targetPct;
      const targetCostTwd = denomCostTwd * (targetPct / 100);
      const costActionTwd = targetCostTwd - costTwd; // >0 買入, <0 賣出
      const costActionNative = mkt === 'TW' ? costActionTwd : (usdTwd > 0 ? costActionTwd / usdTwd : 0);
      const costActionShares = currentPriceNative > 0 ? costActionNative / currentPriceNative : 0;

      // 2. 池內目前現值佔比 & 差距 (目前池內現值% - 池內目標%)
      const marketWeightPct = poolCurrentMarketTwd > 0 ? (marketTwd / poolCurrentMarketTwd) * 100 : 0;
      const marketDiffPct = marketWeightPct - targetPct;
      const targetMarketTwd = denomMarketTwd * (targetPct / 100);
      const marketActionTwd = targetMarketTwd - marketTwd; // >0 買入, <0 賣出
      const marketActionNative = mkt === 'TW' ? marketActionTwd : (usdTwd > 0 ? marketActionTwd / usdTwd : 0);
      const marketActionShares = currentPriceNative > 0 ? marketActionNative / currentPriceNative : 0;

      return {
        symbol,
        market: mkt,
        type: tp,
        shares,
        avgCostNative,
        currentPriceNative,
        costTwd: Math.round(costTwd),
        marketTwd: Math.round(marketTwd),
        targetPct: Math.round(targetPct * 100) / 100,
        globalTargetPct: Math.round(globalTargetPct * 100) / 100,
        // Cost Basis
        costWeightPct: Math.round(costWeightPct * 100) / 100,
        costDiffPct: Math.round(costDiffPct * 100) / 100,
        targetCostTwd: Math.round(targetCostTwd),
        costActionTwd: Math.round(costActionTwd),
        costActionNative: Math.round(costActionNative * 100) / 100,
        costActionShares: Math.round(costActionShares * 100) / 100,
        // Market Value Basis
        marketWeightPct: Math.round(marketWeightPct * 100) / 100,
        marketDiffPct: Math.round(marketDiffPct * 100) / 100,
        targetMarketTwd: Math.round(targetMarketTwd),
        marketActionTwd: Math.round(marketActionTwd),
        marketActionNative: Math.round(marketActionNative * 100) / 100,
        marketActionShares: Math.round(marketActionShares * 100) / 100
      };
    });

    const q = String(query || '').trim().toUpperCase();
    const tier2Rows = q ? tier2AllRows.filter((item) => item.symbol.includes(q)) : tier2AllRows;

    return {
      usdTwd,
      activePool,
      calcMode,
      portfolioCostTwd: Math.round(portfolioCostTwd),
      portfolioMarketTwd: Math.round(portfolioMarketTwd),
      tier1TotalTargetPct: Math.round(tier1TotalTargetPct * 100) / 100,
      tier1UnallocatedPct: Math.round((100 - tier1TotalTargetPct) * 100) / 100,
      tier1Rows,
      poolCurrentCostTwd: Math.round(poolCurrentCostTwd),
      poolCurrentMarketTwd: Math.round(poolCurrentMarketTwd),
      poolTargetCostTwd: Math.round(poolTargetCostTwd),
      poolTargetMarketTwd: Math.round(poolTargetMarketTwd),
      denomCostTwd: Math.round(denomCostTwd),
      denomMarketTwd: Math.round(denomMarketTwd),
      tier2TotalTargetPct: Math.round(tier2TotalTargetPct * 100) / 100,
      tier2UnallocatedPct: Math.round((100 - tier2TotalTargetPct) * 100) / 100,
      tier2Rows
    };
  }
};

// Register headless module for AI Agent & CLI usage
agentBridge.registerModule('stock-tracker', {
  description: '股票庫存與估值核心模組 (對接 N_BD_C 試算表)',
  actions: {
    getSummary: (state) => StockCore.getSummary(state),
    filterHoldings: (state, params) => StockCore.filterHoldings(state, params),
    getLotsBySymbol: (state, params) => StockCore.getLotsBySymbol(state, params?.symbol, params),
    getSortedTrades: (state, params) => StockCore.getSortedTrades(state, params),
    getRebalanceComparison: (state, params) => StockCore.getRebalanceComparison(state, params),
    setTypeTargetWeight: (state, params, store) => StockCore.setTypeTargetWeight(state, params, store),
    setStockTargetWeight: (state, params, store) => StockCore.setStockTargetWeight(state, params, store),
    addTrade: (state, params, store) => StockCore.addTrade(state, params, store),
    addExit: (state, params, store) => StockCore.addExit(state, params, store),
    upsertWatchlist: (state, params, store) => StockCore.upsertWatchlist(state, params, store),
    estimateTargetPrice: (state, params) => StockCore.estimateTargetPrice(state, params)
  },
  schemas: [
    {
      name: 'getSummary',
      description: '取得股票持倉總成本、總市值、未實現損益、已實現損益與風控類型配置比例',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'addTrade',
      description: '新增一筆股票買進（進場）紀錄至 N_BD_C 交易明細',
      parameters: {
        type: 'object',
        required: ['symbol', 'price', 'shares'],
        properties: {
          symbol: { type: 'string', description: '股票代號，例如 NVDA 或 2330.TW' },
          market: { type: 'string', enum: ['US', 'TW'] },
          type: { type: 'string', enum: ['防禦型', '進攻型', '樂透型'] },
          broker: { type: 'string', enum: ['B', 'S', 'F', 'C', 'T', 'Y'] },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          price: { type: 'number', description: '進場成交單價（原幣）' },
          shares: { type: 'number', description: '進場股數' },
          fee: { type: 'number', description: '手續費（原幣，選填，將自動折算併入進場價）' },
          note: { type: 'string' }
        }
      }
    },
    {
      name: 'upsertWatchlist',
      description: '新增或更新觀察清單股票之公允價格（目標好價格）',
      parameters: {
        type: 'object',
        required: ['symbol', 'fairPrice'],
        properties: {
          symbol: { type: 'string' },
          market: { type: 'string', enum: ['US', 'TW'] },
          fairPrice: { type: 'number' },
          currentPrice: { type: 'number' }
        }
      }
    },
    {
      name: 'estimateTargetPrice',
      description: '依基準營收、預估營收成長率、淨利率與本益比推估 EPS 與合理目標價矩陣',
      parameters: {
        type: 'object',
        properties: {
          baseRevenue: { type: 'number' },
          growthRatePct: { type: 'number' },
          netMarginPct: { type: 'number' },
          shareCapital: { type: 'number' },
          isTwStock: { type: 'boolean' },
          targetPe: { type: 'number' }
        }
      }
    }
  ]
});
