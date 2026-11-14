import { agentBridge } from '../../core/agent-bridge.js';

const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  const cleaned = String(v).replace(/[$,%\s,]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
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

    return {
      types: findVal('類型清單', ['防禦型', '進攻型', '樂透型']),
      brokers: findVal('券商清單', ['B', 'S', 'F', 'C', 'T', 'Y']),
      markets: findVal('市場清單', ['US', 'TW']),
      usdTwd
    };
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

    for (const row of overview) {
      totalCostUsd += toNum(row['成本(USD)']);
      totalCostTwd += toNum(row['成本(TWD)']);
      totalMarketUsd += toNum(row['市值(USD)']);
      totalMarketTwd += toNum(row['市值(TWD)']);
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

  addTrade(state, params, storeInstance) {
    const symbol = String(params.symbol || params['代號'] || '').trim().toUpperCase();
    const market = String(params.market || params['市場'] || (symbol.endsWith('.TW') || symbol.endsWith('.TWO') ? 'TW' : 'US')).toUpperCase();
    const type = String(params.type || params['類型'] || '進攻型');
    const broker = String(params.broker || params['券商'] || 'F').toUpperCase();
    const date = String(params.date || params['進場日'] || new Date().toISOString().slice(0, 10));
    const price = toNum(params.price ?? params['進場價'], 0);
    const shares = toNum(params.shares ?? params['進場股數'], 0);
    const note = String(params.note || params['備註'] || '').trim();

    if (!symbol) throw new Error('請輸入股票代號 (如 NVDA 或 2330.TW)');
    if (price <= 0 || shares <= 0) throw new Error('進場價與進場股數必須大於 0');

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
      const addedCostNative = price * shares;
      const addedCostUsd = market === 'US' ? addedCostNative : addedCostNative / usdTwd;
      const addedCostTwd = market === 'TW' ? addedCostNative : addedCostNative * usdTwd;

      if (existing) {
        const oldShares = toNum(existing['剩餘股數']);
        const oldAvg = toNum(existing['平均成本(原幣)']);
        const curPrice = toNum(existing['現價(原幣)'], price);
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
          '平均成本(原幣)': String(price),
          '現價(原幣)': String(price),
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

    return newTrade;
  },

  addExit(state, params, storeInstance) {
    const tradeId = String(params.tradeId || params['交易id'] || '').trim();
    const date = String(params.date || params['出場日'] || new Date().toISOString().slice(0, 10));
    const exitPrice = toNum(params.exitPrice ?? params['出場價'], 0);
    const exitShares = toNum(params.exitShares ?? params['出場股數'], 0);
    const note = String(params.note || params['備註'] || '').trim();

    if (!tradeId) throw new Error('請選擇或輸入對應的進場交易 ID');
    if (exitPrice <= 0 || exitShares <= 0) throw new Error('出場價與出場股數必須大於 0');

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
      s.stock.recentExits.push(newExit);
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
  }
};

// Register headless module for AI Agent & CLI usage
agentBridge.registerModule('stock-tracker', {
  description: '股票庫存與估值核心模組 (對接 N_BD_C 試算表)',
  actions: {
    getSummary: (state) => StockCore.getSummary(state),
    filterHoldings: (state, params) => StockCore.filterHoldings(state, params),
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
          price: { type: 'number', description: '進場單價（原幣）' },
          shares: { type: 'number', description: '進場股數' },
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
