import { StockCore } from './core.js';

const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const cleaned = String(v).replace(/(?:NT\$|US\$|[$,%\s,])/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
};
const toRatio = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  const num = toNum(s, 0);
  return s.includes('%') ? num / 100 : num;
};
const fmtInt = (n) => toNum(n, 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const fmtDec = (n, d = 2) => toNum(n, 0).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => `${(toRatio(n) * 100).toFixed(2)}%`;

const NBDC_SHEET_URL = 'https://docs.google.com/spreadsheets/d/18zTY4jjQ8Q1BRmqp_meYS24OOLE0GOkbn_56DWdwQrM/edit';

export class StockTrackerUI {
  constructor() {
    this.activeTab = 'holdings'; // 'holdings' | 'rebalance' | 'watchlist' | 'history'
    this.filterMarket = 'ALL';
    this.filterType = 'ALL';
    this.searchQuery = '';
    this.showAddForm = false;

    // Rebalance state
    this.rebalancePool = '進攻型';
    this.rebalanceCalcMode = 'TOP_DOWN';
    this.rebalanceQuery = '';

    // Lot-level drilldown state
    this.selectedSymbol = null;
    this.selectedLotId = null;
    this.showBuyForSelected = false;
    this.showClosedLots = false;

    // Universal table sorting state
    this.sortState = {
      holdings: { col: 'market', dir: 'desc' },
      lots: { col: 'date', dir: 'desc' },
      rebalance: { col: 'targetPct', dir: 'desc' },
      watchlist: { col: 'gap', dir: 'asc' },
      history: { col: 'date', dir: 'desc' }
    };
  }

  _toggleSort(tableKey, col, defaultDir = 'desc') {
    const cur = this.sortState[tableKey] || { col, dir: defaultDir };
    if (cur.col === col) {
      cur.dir = cur.dir === 'desc' ? 'asc' : 'desc';
    } else {
      cur.col = col;
      cur.dir = defaultDir;
    }
    this.sortState[tableKey] = cur;
  }

  _sortTh(tableKey, col, label, defaultDir = 'desc', align = 'left', extraStyle = '') {
    const cur = this.sortState[tableKey] || {};
    const isAct = cur.col === col;
    const arrow = isAct ? (cur.dir === 'desc' ? '▼' : '▲') : '↕';
    const alignCss = align === 'right' ? 'text-align:right;' : '';
    return `<th class="sortable ${isAct ? 'sort-active' : ''}" data-st-sort-table="${tableKey}" data-st-sort-col="${col}" data-st-sort-def="${defaultDir}" style="${alignCss}${extraStyle}">${label}<span class="sort-indicator">${arrow}</span></th>`;
  }

  render(container, state, store, showToast) {
    const summary = StockCore.getSummary(state);
    const options = StockCore.getFormOptions(state);
    const holdings = StockCore.filterHoldings(state, {
      market: this.filterMarket,
      type: this.filterType,
      query: this.searchQuery
    });

    const cfg = store.getConfig();
    const updatedTs = state?.stock?.priceUpdatedAt || cfg.lastSyncAt;
    const lastSyncText = updatedTs
      ? new Date(updatedTs).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      : '尚未同步';

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <div class="text-muted" style="font-size:12px;">
          最後更新：<strong class="font-mono">${lastSyncText}</strong>${state?.stock?.priceUpdatedAt ? '（已套用 FinMind 最新收盤價）' : '（Google Sheets 快照）'}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-force-refresh-prices">
          🔄 強制刷新現價
        </button>
      </div>

      <!-- Clean Minimalist KPI Cards -->
      <div class="grid-kpi">
        <div class="card">
          <div class="kpi-label">
            <span>總持倉市值 (TWD)</span>
            <span class="pill">${summary.holdingCount} 檔</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(summary.totalMarketTwd)}</div>
          <div class="kpi-sub mask-amount">總投入成本 $${fmtInt(summary.totalCostTwd)}</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>未實現總損益</span>
            <span class="pill ${summary.unrealizedTwd >= 0 ? 'pill-emerald' : 'pill-rose'}">
              ${summary.unrealizedTwd >= 0 ? '▲ ' : '▼ '}${fmtPct(summary.returnRate)}
            </span>
          </div>
          <div class="kpi-value mask-amount ${summary.unrealizedTwd >= 0 ? 'text-emerald' : 'text-rose'}">
            ${summary.unrealizedTwd >= 0 ? '+' : ''}$${fmtInt(summary.unrealizedTwd)}
          </div>
          <div class="kpi-sub mask-amount">已實現累計 $${fmtInt(summary.realizedTwd)}</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>台股部位 (TW)</span>
            <span class="pill">TWD 計價</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(summary.twMarketTwd)}</div>
          <div class="kpi-sub">佔總持倉 ${summary.totalMarketTwd ? ((summary.twMarketTwd / summary.totalMarketTwd) * 100).toFixed(1) : 0}%</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>美股部位 (US)</span>
            <span class="pill">USD 折合 TWD</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(summary.usMarketTwd)}</div>
          <div class="kpi-sub">佔總持倉 ${summary.totalMarketTwd ? ((summary.usMarketTwd / summary.totalMarketTwd) * 100).toFixed(1) : 0}%</div>
        </div>
      </div>

      <!-- Sub-navigation & Quick Action Toolbar -->
      <div class="action-toolbar">
        <div class="tabs-bar" style="margin-bottom:0; border-bottom:none;">
          <button class="tab-btn ${this.activeTab === 'holdings' ? 'active' : ''}" data-tab="holdings">持倉總覽 (${holdings.length})</button>
          <button class="tab-btn ${this.activeTab === 'rebalance' ? 'active' : ''}" data-tab="rebalance">權重配置與再平衡</button>
          <button class="tab-btn ${this.activeTab === 'watchlist' ? 'active' : ''}" data-tab="watchlist">觀察清單與目標價</button>
          <button class="tab-btn ${this.activeTab === 'history' ? 'active' : ''}" data-tab="history">風控與進場紀錄</button>
        </div>
        <div class="action-toolbar-group">
          <button class="btn ${this.showAddForm ? 'btn-primary' : 'btn-ghost'}" id="btn-toggle-trade-form">
            ${this.showAddForm ? '✕ 收起新股進場' : '＋ 新增買進交易'}
          </button>
          <a class="btn btn-ghost btn-sm" href="${NBDC_SHEET_URL}" target="_blank" rel="noopener">
            ↗ 開啟 N_BD_C 試算表
          </a>
        </div>
      </div>

      <!-- Collapsible New Stock Entry Form -->
      ${this.showAddForm ? this._renderAddTradeModal(options) : ''}

      <!-- Active Tab View -->
      <div id="stock-tab-body">
        ${this.activeTab === 'holdings' ? this._renderHoldingsTab(holdings, options, state) : ''}
        ${this.activeTab === 'rebalance' ? this._renderRebalanceTab(state) : ''}
        ${this.activeTab === 'watchlist' ? this._renderWatchlistTab(state) : ''}
        ${this.activeTab === 'history' ? this._renderHistoryTab(state, summary) : ''}
      </div>
    `;

    this._bindEvents(container, state, store, showToast);
  }

  _renderAddTradeModal(options, prefillSymbol = '', prefillType = '進攻型', prefillBroker = '') {
    const today = new Date().toISOString().slice(0, 10);
    return `
      <div class="card" style="margin-bottom:16px; border-color:var(--accent-blue);">
        <div class="card-header">
          <div class="card-title">
            ${prefillSymbol ? `加碼買進【${prefillSymbol}】新批次` : '新增股票進場紀錄 (N_BD_C)'}
          </div>
          <span class="text-muted" style="font-size:12px;">手續費將自動折算併入「進場價」寫入 Google Sheet</span>
        </div>
        <form id="form-add-trade">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">股票代號</label>
              <input class="form-control font-mono" name="symbol" list="dl-symbols" placeholder="如 AAPL 或 2330.TW" value="${prefillSymbol}" required />
              <datalist id="dl-symbols">
                ${options.symbols.map((s) => `<option value="${s}"></option>`).join('')}
              </datalist>
            </div>
            <div class="form-group">
              <label class="form-label">進場日期</label>
              <input class="form-control" type="date" name="date" value="${today}" required />
            </div>
            <div class="form-group">
              <label class="form-label">策略類型</label>
              <select class="form-control" name="type">
                ${options.types.map((t) => `<option value="${t}" ${t === prefillType ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">交易券商</label>
              <select class="form-control" name="broker">
                ${options.brokers.map((b) => `<option value="${b}" ${b === prefillBroker ? 'selected' : ''}>${b}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">進場成交單價 (原幣)</label>
              <input class="form-control font-mono" type="number" step="any" min="0.0001" name="price" id="trade-input-price" placeholder="如 185.5" required />
            </div>
            <div class="form-group">
              <label class="form-label">買進股數</label>
              <input class="form-control font-mono" type="number" step="any" min="0.0001" name="shares" id="trade-input-shares" placeholder="如 100 或 1000" required />
            </div>
            <div class="form-group">
              <label class="form-label">手續費 (原幣，自動併入進場價)</label>
              <input class="form-control font-mono" type="number" step="any" min="0" name="fee" id="trade-input-fee" placeholder="0 (選填)" value="0" />
            </div>
            <div class="form-group">
              <label class="form-label">進場理由 / 備註</label>
              <input class="form-control" name="note" placeholder="選填" />
            </div>
          </div>
          <div style="margin-top:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div id="trade-fee-preview" class="text-muted font-mono" style="font-size:12.5px;">
              輸入成交單價、股數與手續費後，將即時預覽折算後之含手續費進場價
            </div>
            <button type="submit" class="btn btn-primary">儲存進場並重算均價</button>
          </div>
        </form>
      </div>
    `;
  }

  _renderSelectedSymbolLotsPanel(state, options) {
    if (!this.selectedSymbol) return '';

    const lotSort = this.sortState.lots || { col: 'date', dir: 'desc' };
    const detail = StockCore.getLotsForSymbol(state, this.selectedSymbol, {
      sortBy: lotSort.col,
      sortDir: lotSort.dir
    });
    const openLots = detail.openLots || [];
    const closedLots = detail.closedLots || [];
    const selectedLot = openLots.find((l) => l.id === this.selectedLotId) || null;
    const today = new Date().toISOString().slice(0, 10);
    const curLabel = detail.market === 'TW' ? 'TWD' : 'USD';
    const defaultType = openLots[0]?.type || '進攻型';
    const defaultBroker = openLots[0]?.broker || options.brokers[0] || 'F';
    const isDateSort = lotSort.col === 'date';
    const isAmtSort = lotSort.col === 'amount';

    return `
      <div class="card" id="lot-drilldown-panel" style="margin-bottom:16px; border-color:var(--accent-blue);">
        <div class="card-header" style="flex-wrap:wrap; gap:8px;">
          <div>
            <div class="card-title">
              【${detail.symbol}】分批庫存明細與指定出場
              <span class="pill">${openLots.length} 筆持有中</span>
              <span class="pill">現價 ${curLabel} ${fmtDec(detail.currentPrice)}</span>
            </div>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
            <span class="text-muted" style="font-size:12px;">排序：</span>
            <button type="button" class="btn ${isDateSort ? 'btn-primary' : 'btn-ghost'} btn-sm" data-lot-sort="date">
              依日期 ${isDateSort ? (lotSort.dir === 'desc' ? '▼ 最新' : '▲ 最舊') : ''}
            </button>
            <button type="button" class="btn ${isAmtSort ? 'btn-primary' : 'btn-ghost'} btn-sm" data-lot-sort="amount">
              依投入金額 ${isAmtSort ? (lotSort.dir === 'desc' ? '▼ 大→小' : '▲ 小→大') : ''}
            </button>
            ${detail.market === 'TW' ? `
              <button type="button" class="btn btn-ghost btn-sm" id="btn-open-goodstock-for-symbol" data-gs-symbol="${detail.symbol}">
                好股價財報與目標價
              </button>
            ` : ''}
            <button type="button" class="btn btn-primary btn-sm" id="btn-buy-same-symbol">
              ${this.showBuyForSelected ? '✕ 收起加碼' : `＋ 加碼買進 ${detail.symbol}`}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-close-lots-panel">
              ✕ 收起明細
            </button>
          </div>
        </div>

        ${this.showBuyForSelected ? this._renderAddTradeModal(options, detail.symbol, defaultType, defaultBroker) : ''}

        ${selectedLot ? `
          <div style="margin-bottom:12px; padding:12px; background:var(--bg-subtle); border:1px solid var(--accent-blue); border-radius:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
              <div style="font-weight:700; font-size:13px;">
                指定賣出批次：進場日 <span class="font-mono">${selectedLot.entryDate}</span> ｜ 券商 <span class="font-mono">${selectedLot.broker}</span> ｜ 進場價 <span class="font-mono">${fmtDec(selectedLot.entryPrice)}</span> ｜ 剩餘可賣 <span class="font-mono">${selectedLot.remainingShares} 股</span> ｜ 該批成本 <span class="font-mono">${curLabel} ${fmtDec(selectedLot.costAmountNative)}</span>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" id="btn-cancel-lot-exit">✕ 取消指定</button>
            </div>
            <form id="form-lot-exit" class="form-grid" style="align-items:end;">
              <input type="hidden" name="tradeId" value="${selectedLot.id}" />
              <input type="hidden" name="lotId" value="${selectedLot.id}" />
              <input type="hidden" name="symbol" value="${detail.symbol}" />
              <div class="form-group">
                <label class="form-label">賣出股數 (上限 ${selectedLot.remainingShares})</label>
                <input class="form-control font-mono" type="number" step="any" min="0.0001" max="${selectedLot.remainingShares}" name="exitShares" value="${selectedLot.remainingShares}" required />
              </div>
              <div class="form-group">
                <label class="form-label">出場成交價 (${curLabel})</label>
                <input class="form-control font-mono" type="number" step="any" min="0.0001" name="exitPrice" value="${detail.currentPrice || selectedLot.entryPrice}" required />
              </div>
              <div class="form-group">
                <label class="form-label">出場日期</label>
                <input class="form-control" type="date" name="date" value="${today}" required />
              </div>
              <div class="form-group">
                <label class="form-label">出場備註</label>
                <input class="form-control" name="note" placeholder="停利 / 停損 / 減碼" />
              </div>
              <div class="form-group">
                <button type="submit" class="btn btn-primary" style="width:100%;">確認從此批賣出</button>
              </div>
            </form>
          </div>
        ` : ''}

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>操作</th>
                ${this._sortTh('lots', 'date', '進場日', 'desc')}
                <th>券商</th>
                <th>類型</th>
                ${this._sortTh('lots', 'price', '進場單價', 'desc', 'right')}
                ${this._sortTh('lots', 'shares', '剩餘股數', 'desc', 'right')}
                ${this._sortTh('lots', 'amount', `投入成本 (${curLabel})`, 'desc', 'right')}
                ${this._sortTh('lots', 'pnl', `單批損益 (${curLabel})`, 'desc', 'right')}
                ${this._sortTh('lots', 'roi', '報酬率', 'desc', 'right')}
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              ${openLots.length === 0 ? `
                <tr><td colspan="10" class="text-muted" style="text-align:center; padding:16px;">無未出場批次明細</td></tr>
              ` : openLots.map((lot) => {
                const isSelected = lot.id === this.selectedLotId;
                const pnlCls = lot.unrealizedNative >= 0 ? 'text-emerald' : 'text-rose';
                const sign = lot.unrealizedNative >= 0 ? '+' : '';
                return `
                  <tr style="${isSelected ? 'background:var(--accent-blue-soft);' : ''}">
                    <td>
                      <button type="button" class="btn ${isSelected ? 'btn-primary' : 'btn-ghost'} btn-sm" data-select-lot="${lot.id}">
                        ${isSelected ? '✓ 已指定' : '指定賣出'}
                      </button>
                    </td>
                    <td class="font-mono ${lot.hasEntryDate ? '' : 'text-muted'}">${lot.entryDate}</td>
                    <td class="font-mono">${lot.broker}</td>
                    <td><span class="pill">${lot.type}</span></td>
                    <td class="font-mono" style="text-align:right;">${fmtDec(lot.entryPrice)}</td>
                    <td class="font-mono" style="text-align:right;">
                      <strong>${lot.remainingShares}</strong>
                      ${lot.exitedShares > 0 ? `<span class="text-muted" style="font-size:11px;"> (原 ${lot.entryShares})</span>` : ''}
                    </td>
                    <td class="font-mono mask-amount" style="text-align:right; font-weight:700;">
                      ${curLabel === 'TWD' ? `$${fmtInt(lot.costAmountNative)}` : fmtDec(lot.costAmountNative)}
                    </td>
                    <td class="font-mono mask-amount ${pnlCls}" style="text-align:right; font-weight:700;">${sign}${fmtDec(lot.unrealizedNative)}</td>
                    <td style="text-align:right;"><span class="pill ${lot.unrealizedNative >= 0 ? 'pill-emerald' : 'pill-rose'}">${lot.unrealizedNative >= 0 ? '▲ ' : '▼ '}${fmtPct(lot.roi)}</span></td>
                    <td class="text-muted">${lot.note || '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        ${closedLots.length > 0 ? `
          <div style="margin-top:10px;">
            <button type="button" class="btn btn-ghost btn-sm" id="btn-toggle-closed-lots">
              ${this.showClosedLots ? '▲ 隱藏已出場完畢批次' : `▼ 查看已全數出場批次 (${closedLots.length} 筆)`}
            </button>
            ${this.showClosedLots ? `
              <div class="table-wrap" style="margin-top:8px;">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>進場日</th>
                      <th>券商</th>
                      <th style="text-align:right;">進場價</th>
                      <th style="text-align:right;">原股數</th>
                      <th style="text-align:right;">原投入成本 (${curLabel})</th>
                      <th>狀態</th>
                      <th>備註</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${closedLots.map((c) => `
                      <tr>
                        <td class="font-mono">${c.entryDate}</td>
                        <td class="font-mono">${c.broker}</td>
                        <td class="font-mono" style="text-align:right;">${fmtDec(c.entryPrice)}</td>
                        <td class="font-mono" style="text-align:right;">${c.entryShares}</td>
                        <td class="font-mono mask-amount" style="text-align:right;">${curLabel === 'TWD' ? `$${fmtInt(c.entryCostNative)}` : fmtDec(c.entryCostNative)}</td>
                        <td><span class="pill">已出場 (${c.exitedShares} 股)</span></td>
                        <td class="text-muted">${c.note || '-'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderHoldingsTab(rawHoldings, options, state) {
    const holdings = [...rawHoldings];
    const sortCfg = this.sortState.holdings || { col: 'market', dir: 'desc' };
    const dirMul = sortCfg.dir === 'asc' ? 1 : -1;

    holdings.sort((a, b) => {
      if (sortCfg.col === 'code') return String(a['代號'] || '').localeCompare(String(b['代號'] || '')) * dirMul;
      if (sortCfg.col === 'type') return String(a['類型'] || '').localeCompare(String(b['類型'] || '')) * dirMul;
      if (sortCfg.col === 'shares') return (toNum(a['剩餘股數'], 0) - toNum(b['剩餘股數'], 0)) * dirMul;
      if (sortCfg.col === 'avgCost') return (toNum(a['平均成本(原幣)'], 0) - toNum(b['平均成本(原幣)'], 0)) * dirMul;
      if (sortCfg.col === 'price') return (toNum(a['現價(原幣)'], 0) - toNum(b['現價(原幣)'], 0)) * dirMul;
      if (sortCfg.col === 'pnl') return (toNum(a['未實現(TWD)'], 0) - toNum(b['未實現(TWD)'], 0)) * dirMul;
      if (sortCfg.col === 'roi') return (toRatio(a['報酬率']) - toRatio(b['報酬率'])) * dirMul;
      return (toNum(a['市值(TWD)'], 0) - toNum(b['市值(TWD)'], 0)) * dirMul;
    });

    return `
      ${this._renderSelectedSymbolLotsPanel(state, options)}

      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;">
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <select id="filter-market" class="form-control" style="width:auto; padding:5px 10px;">
              <option value="ALL" ${this.filterMarket === 'ALL' ? 'selected' : ''}>全部市場 (US+TW)</option>
              ${options.markets.map((m) => `<option value="${m}" ${this.filterMarket === m ? 'selected' : ''}>${m} 市場</option>`).join('')}
            </select>
            <select id="filter-type" class="form-control" style="width:auto; padding:5px 10px;">
              <option value="ALL" ${this.filterType === 'ALL' ? 'selected' : ''}>全部策略類型</option>
              ${options.types.map((t) => `<option value="${t}" ${this.filterType === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <input id="filter-query" class="form-control" style="width:150px; padding:5px 10px;" placeholder="搜尋代號..." value="${this.searchQuery}" />
          </div>
          <div class="text-muted" style="font-size:12px;">
            點擊任一欄位標題可排序；點擊「代號」可展開該股分批庫存並指定出場
          </div>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${this._sortTh('holdings', 'code', '代號 (點擊看批次)', 'asc')}
                ${this._sortTh('holdings', 'type', '類型', 'asc')}
                ${this._sortTh('holdings', 'shares', '股數', 'desc', 'right')}
                ${this._sortTh('holdings', 'avgCost', '均價 (原幣)', 'desc', 'right')}
                ${this._sortTh('holdings', 'price', '現價 (原幣)', 'desc', 'right')}
                ${this._sortTh('holdings', 'market', '市值 (TWD)', 'desc', 'right')}
                ${this._sortTh('holdings', 'pnl', '未實現 (TWD)', 'desc', 'right')}
                ${this._sortTh('holdings', 'roi', '報酬率', 'desc', 'right')}
                <th>券商</th>
              </tr>
            </thead>
            <tbody>
              ${holdings.map((r) => {
                const sym = r['代號'];
                const isSelected = this.selectedSymbol === sym;
                const pnl = toNum(r['未實現(TWD)'], 0);
                const roi = toRatio(r['報酬率']);
                const cls = pnl >= 0 ? 'text-emerald' : 'text-rose';
                const sign = pnl >= 0 ? '+' : '';
                return `
                  <tr data-click-symbol="${sym}" style="cursor:pointer; ${isSelected ? 'background:var(--accent-blue-soft);' : ''}">
                    <td>
                      <div style="display:flex; align-items:center; gap:6px;">
                        <span class="font-mono" style="font-weight:700; color:var(--accent-blue);">${sym}</span>
                        <span class="pill" style="font-size:10px;">${r['市場']}</span>
                      </div>
                    </td>
                    <td><span class="pill">${r['類型'] || '-'}</span></td>
                    <td class="font-mono" style="text-align:right;">${fmtDec(r['剩餘股數'], 0)}</td>
                    <td class="font-mono text-muted" style="text-align:right;">${fmtDec(r['平均成本(原幣)'])}</td>
                    <td class="font-mono" style="text-align:right; font-weight:600;">${fmtDec(r['現價(原幣)'])}</td>
                    <td class="font-mono mask-amount" style="text-align:right; font-weight:700;">$${fmtInt(r['市值(TWD)'])}</td>
                    <td class="font-mono mask-amount ${cls}" style="text-align:right; font-weight:700;">${sign}$${fmtInt(pnl)}</td>
                    <td style="text-align:right;"><span class="pill ${pnl >= 0 ? 'pill-emerald' : 'pill-rose'}">${pnl >= 0 ? '▲ ' : '▼ '}${fmtPct(roi)}</span></td>
                    <td class="text-muted">${r['券商分佈'] || '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderRebalanceTab(state) {
    const reb = StockCore.getRebalanceComparison(state, {
      activePool: this.rebalancePool,
      calcMode: this.rebalanceCalcMode,
      query: this.rebalanceQuery
    });

    const renderDiffBadge = (diffPct, targetPct) => {
      if (targetPct <= 0 && Math.abs(diffPct) < 0.05) return '<span class="text-muted">-</span>';
      const sign = diffPct > 0 ? '+' : '';
      if (Math.abs(diffPct) < 0.1) {
        return `<span class="pill pill-emerald">0.0% 達標</span>`;
      }
      return `<span class="pill">${sign}${diffPct.toFixed(1)}% (${diffPct < 0 ? '不足' : '超標'})</span>`;
    };

    const renderActionCell = (actionTwd, actionShares, targetPct, currentTwd) => {
      if (targetPct <= 0 && currentTwd <= 0) return '<span class="text-muted">-</span>';
      if (Math.abs(actionTwd) < 500) {
        return `<span class="text-emerald" style="font-size:12px; font-weight:600;">✓ 達標</span>`;
      }
      const isBuy = actionTwd > 0;
      const absTwd = Math.abs(actionTwd);
      const absShares = Math.abs(actionShares);
      return `
        <div class="${isBuy ? 'text-emerald' : 'text-rose'} font-mono" style="font-weight:700;">
          ${isBuy ? '▲ 買入' : '▼ 賣出'} $${fmtInt(absTwd)}
        </div>
        ${absShares !== undefined ? `<div class="text-muted font-mono" style="font-size:11px;">約 ${fmtDec(absShares, 1)} 股</div>` : ''}
      `;
    };

    const t1SumOk = Math.abs(reb.tier1TotalTargetPct - 100) < 0.1;
    const t2SumOk = Math.abs(reb.tier2TotalTargetPct - 100) < 0.1;

    // Sort tier2Rows
    const sortCfg = this.sortState.rebalance || { col: 'targetPct', dir: 'desc' };
    const dirMul = sortCfg.dir === 'asc' ? 1 : -1;
    const sortedTier2 = [...reb.tier2Rows].sort((a, b) => {
      if (sortCfg.col === 'symbol') return String(a.symbol || '').localeCompare(String(b.symbol || '')) * dirMul;
      if (sortCfg.col === 'costTwd') return (a.costTwd - b.costTwd) * dirMul;
      if (sortCfg.col === 'costWeightPct') return (a.costWeightPct - b.costWeightPct) * dirMul;
      if (sortCfg.col === 'marketTwd') return (a.marketTwd - b.marketTwd) * dirMul;
      if (sortCfg.col === 'marketWeightPct') return (a.marketWeightPct - b.marketWeightPct) * dirMul;
      return (a.targetPct - b.targetPct) * dirMul;
    });

    return `
      <!-- Tier 1: Strategy Pools Allocation -->
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header" style="flex-wrap:wrap;">
          <div>
            <div class="card-title">第一層（Tier 1）：三大策略池權重配置（進攻型｜防禦型｜樂透型）</div>
            <div class="text-muted" style="font-size:12px; margin-top:2px;">
              持倉總成本 <strong class="font-mono">$${fmtInt(reb.portfolioCostTwd)}</strong> ｜ 持倉總現值 <strong class="font-mono">$${fmtInt(reb.portfolioMarketTwd)}</strong>（點擊策略列可切換下方個股池）
            </div>
          </div>
          <span class="pill ${t1SumOk ? 'pill-emerald' : ''}">
            第一層目標合計：${reb.tier1TotalTargetPct.toFixed(1)}%
          </span>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>策略類型</th>
                <th>第一層目標 %</th>
                <th style="text-align:right; border-left:1px solid var(--border-color);">目前總成本</th>
                <th style="text-align:right;">成本佔比</th>
                <th>成本差距</th>
                <th>成本法建議</th>
                <th style="text-align:right; border-left:1px solid var(--border-color);">目前總現值</th>
                <th style="text-align:right;">現值佔比</th>
                <th>現值差距</th>
                <th>現值法建議</th>
              </tr>
            </thead>
            <tbody>
              ${reb.tier1Rows.map((r) => {
                const isSelected = this.rebalancePool === r.type;
                return `
                  <tr style="${isSelected ? 'background:var(--accent-blue-soft);' : ''}">
                    <td data-select-pool="${r.type}" style="cursor:pointer; font-weight:700;">
                      ${r.type} (${r.count} 檔) ${isSelected ? '<span style="color:var(--accent-blue); font-size:11px;">●</span>' : ''}
                    </td>
                    <td>
                      <div style="display:flex; align-items:center; gap:4px;">
                        <input type="number" step="0.5" min="0" max="100" class="form-control font-mono" style="width:76px; padding:4px 7px;" data-type-weight="${r.type}" value="${r.targetPct}" />
                        <span class="font-mono">%</span>
                      </div>
                    </td>
                    <td class="font-mono mask-amount" style="text-align:right; border-left:1px solid var(--border-color);">$${fmtInt(r.costTwd)}</td>
                    <td class="font-mono" style="text-align:right;">${r.costWeightPct.toFixed(1)}%</td>
                    <td>${renderDiffBadge(r.costDiffPct, r.targetPct)}</td>
                    <td class="mask-amount">${renderActionCell(r.costActionTwd, undefined, r.targetPct, r.costTwd)}</td>
                    <td class="font-mono mask-amount" style="text-align:right; border-left:1px solid var(--border-color);">$${fmtInt(r.marketTwd)}</td>
                    <td class="font-mono" style="text-align:right;">${r.marketWeightPct.toFixed(1)}%</td>
                    <td>${renderDiffBadge(r.marketDiffPct, r.targetPct)}</td>
                    <td class="mask-amount">${renderActionCell(r.marketActionTwd, undefined, r.targetPct, r.marketTwd)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Tier 2: Individual Stock Weights -->
      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;">
          <div>
            <div class="card-title">第二層（Tier 2）：【${this.rebalancePool}】池內個股權重與買賣建議</div>
            <div class="text-muted" style="font-size:12px; margin-top:2px;">
              成本分母 <strong class="font-mono">$${fmtInt(reb.denomCostTwd)}</strong> ｜ 現值分母 <strong class="font-mono">$${fmtInt(reb.denomMarketTwd)}</strong>
            </div>
          </div>
          <span class="pill ${t2SumOk ? 'pill-emerald' : ''}">
            【${this.rebalancePool}】目標合計：${reb.tier2TotalTargetPct.toFixed(1)}%
          </span>
        </div>

        <div class="action-toolbar" style="padding-bottom:10px; border-bottom:1px solid var(--border-color);">
          <div class="action-toolbar-group">
            ${['進攻型', '防禦型', '樂透型'].map((tp) => `
              <button type="button" class="btn ${this.rebalancePool === tp ? 'btn-primary' : 'btn-ghost'} btn-sm" data-select-pool="${tp}">${tp}</button>
            `).join('')}
            <input id="rebalance-query" class="form-control" style="width:130px; padding:4px 8px;" placeholder="篩選代號..." value="${this.rebalanceQuery}" />
          </div>
          <div class="action-toolbar-group">
            <button type="button" class="btn ${this.rebalanceCalcMode === 'TOP_DOWN' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-calc-mode="TOP_DOWN">連動第一層資金</button>
            <button type="button" class="btn ${this.rebalanceCalcMode === 'POOL_ONLY' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-calc-mode="POOL_ONLY">僅依本池現有資金</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-autofill-pool-cost">帶入成本%</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-autofill-pool-mkt">帶入現值%</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-clear-pool-weights">清空%</button>
          </div>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${this._sortTh('rebalance', 'symbol', '代號', 'asc')}
                ${this._sortTh('rebalance', 'targetPct', '池內目標 %', 'desc')}
                ${this._sortTh('rebalance', 'costTwd', '持有成本 (TWD)', 'desc', 'right', 'border-left:1px solid var(--border-color);')}
                ${this._sortTh('rebalance', 'costWeightPct', '池內成本%', 'desc', 'right')}
                <th>成本差距</th>
                <th>成本法建議</th>
                ${this._sortTh('rebalance', 'marketTwd', '目前現值 (TWD)', 'desc', 'right', 'border-left:1px solid var(--border-color);')}
                ${this._sortTh('rebalance', 'marketWeightPct', '池內現值%', 'desc', 'right')}
                <th>現值差距</th>
                <th>現值法建議</th>
              </tr>
            </thead>
            <tbody>
              ${sortedTier2.map((r) => `
                <tr>
                  <td data-jump-symbol="${r.symbol}" style="cursor:pointer;">
                    <div class="font-mono" style="font-weight:700; color:var(--accent-blue);">${r.symbol}</div>
                    <div class="text-muted font-mono" style="font-size:11px;">${r.shares} 股 @ ${fmtDec(r.currentPriceNative)}</div>
                  </td>
                  <td>
                    <div style="display:flex; align-items:center; gap:4px;">
                      <input type="number" step="0.1" min="0" max="100" class="form-control font-mono" style="width:76px; padding:4px 7px;" data-stock-weight="${r.symbol}" placeholder="0" value="${r.targetPct > 0 ? r.targetPct : ''}" />
                      <span class="font-mono">%</span>
                    </div>
                  </td>
                  <td class="font-mono mask-amount" style="text-align:right; border-left:1px solid var(--border-color);">$${fmtInt(r.costTwd)}</td>
                  <td class="font-mono" style="text-align:right;">${r.costWeightPct.toFixed(1)}%</td>
                  <td>${renderDiffBadge(r.costDiffPct, r.targetPct)}</td>
                  <td class="mask-amount">${renderActionCell(r.costActionTwd, r.costActionShares, r.targetPct, r.costTwd)}</td>
                  <td class="font-mono mask-amount" style="text-align:right; border-left:1px solid var(--border-color);">$${fmtInt(r.marketTwd)}</td>
                  <td class="font-mono" style="text-align:right;">${r.marketWeightPct.toFixed(1)}%</td>
                  <td>${renderDiffBadge(r.marketDiffPct, r.targetPct)}</td>
                  <td class="mask-amount">${renderActionCell(r.marketActionTwd, r.marketActionShares, r.targetPct, r.marketTwd)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderWatchlistTab(state) {
    const rawWatchlist = [...(state?.stock?.watchlist || [])];

    const sortCfg = this.sortState.watchlist || { col: 'gap', dir: 'asc' };
    const dirMul = sortCfg.dir === 'asc' ? 1 : -1;
    rawWatchlist.sort((a, b) => {
      const fairA = toNum(a['公允價格'], 0), curA = toNum(a['採用價'] || a['自動價'], 0);
      const fairB = toNum(b['公允價格'], 0), curB = toNum(b['採用價'] || b['自動價'], 0);
      const gapA = (fairA > 0 && curA > 0) ? (curA - fairA) / fairA : 999;
      const gapB = (fairB > 0 && curB > 0) ? (curB - fairB) / fairB : 999;
      if (sortCfg.col === 'symbol') return String(a['代號'] || '').localeCompare(String(b['代號'] || '')) * dirMul;
      if (sortCfg.col === 'fair') return (fairA - fairB) * dirMul;
      if (sortCfg.col === 'cur') return (curA - curB) * dirMul;
      return (gapA - gapB) * dirMul;
    });

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">觀察清單（公允價值雷達）</div>
        </div>
        <form id="form-watchlist" class="form-grid" style="margin-bottom:12px;">
          <input class="form-control font-mono" name="symbol" placeholder="代號 (如 NVDA)" required />
          <input class="form-control font-mono" type="number" step="any" name="fairPrice" placeholder="目標公允價" required />
          <button type="submit" class="btn btn-primary">＋ 存入觀察清單</button>
        </form>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${this._sortTh('watchlist', 'symbol', '代號', 'asc')}
                <th>市場</th>
                ${this._sortTh('watchlist', 'fair', '公允價格', 'desc', 'right')}
                ${this._sortTh('watchlist', 'cur', '目前採用價', 'desc', 'right')}
                ${this._sortTh('watchlist', 'gap', '折溢價邊際', 'asc', 'right')}
              </tr>
            </thead>
            <tbody>
              ${rawWatchlist.map((w) => {
                const fair = toNum(w['公允價格'], 0);
                const cur = toNum(w['採用價'] || w['自動價'], 0);
                const diffPct = (fair > 0 && cur > 0) ? ((cur - fair) / fair) : null;
                const isUndervalued = diffPct !== null && diffPct <= 0;
                return `
                  <tr>
                    <td class="font-mono" style="font-weight:700;">${w['代號']}</td>
                    <td><span class="pill">${w['市場'] || 'US'}</span></td>
                    <td class="font-mono" style="text-align:right; font-weight:700;">${fmtDec(fair)}</td>
                    <td class="font-mono" style="text-align:right;">${cur > 0 ? fmtDec(cur) : '-'}</td>
                    <td style="text-align:right;">
                      ${diffPct !== null
                        ? `<span class="pill ${isUndervalued ? 'pill-emerald' : 'pill-rose'}">
                             ${isUndervalued ? '低於公允 ' : '高於公允 +'}${(diffPct * 100).toFixed(1)}%
                           </span>`
                        : '<span class="text-muted">-</span>'}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderHistoryTab(state, summary) {
    const sortCfg = this.sortState.history || { col: 'date', dir: 'desc' };
    const trades = StockCore.getSortedTrades(state, { col: sortCfg.col, dir: sortCfg.dir, limit: 100 });
    const totalCount = Array.isArray(state?.stock?.recentTrades) ? state.stock.recentTrades.length : trades.length;

    return `
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div class="card-title">風控策略配置比例 (防禦 / 進攻 / 樂透)</div>
          </div>
          <div style="display:flex; flex-direction:column; gap:14px;">
            ${summary.riskBreakdown.map((r) => `
              <div>
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:5px;">
                  <span><strong>${r.type}</strong> (${r.count} 檔)</span>
                  <span class="font-mono mask-amount">$${fmtInt(r.marketTwd)} (${fmtPct(r.weight)} ｜ <span class="${r.roi >= 0 ? 'text-emerald' : 'text-rose'}">${r.roi >= 0 ? '▲ ' : '▼ '}${fmtPct(r.roi)}</span>)</span>
                </div>
                <div style="height:8px; background:var(--bg-subtle); border-radius:999px; overflow:hidden; border:1px solid var(--border-color);">
                  <div style="height:100%; width:${Math.min(100, Math.max(2, r.weight * 100))}%; background:var(--accent-blue);"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">進場交易明細 (最新 ${trades.length} 筆 / 共 ${totalCount} 筆)</div>
          </div>
          <div class="table-wrap" style="max-height:420px; overflow-y:auto;">
            <table class="data-table">
              <thead>
                <tr>
                  ${this._sortTh('history', 'date', '進場日', 'desc')}
                  ${this._sortTh('history', 'symbol', '代號', 'asc')}
                  <th>類型</th>
                  <th>券商</th>
                  ${this._sortTh('history', 'price', '進場價', 'desc', 'right')}
                  ${this._sortTh('history', 'shares', '股數', 'desc', 'right')}
                  ${this._sortTh('history', 'amount', '投入成本', 'desc', 'right')}
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                ${trades.map((t) => `
                  <tr>
                    <td class="font-mono ${t.hasEntryDate ? '' : 'text-muted'}">${t.displayDate || t['進場日'] || t['建立時間'] || '-'}</td>
                    <td class="font-mono" style="font-weight:700;">${t['代號']}</td>
                    <td><span class="pill">${t['類型']}</span></td>
                    <td class="font-mono">${t['券商']}</td>
                    <td class="font-mono" style="text-align:right;">${fmtDec(t['進場價'])}</td>
                    <td class="font-mono" style="text-align:right;">${fmtDec(t['進場股數'], 0)}</td>
                    <td class="font-mono mask-amount" style="text-align:right; font-weight:700;">${fmtDec(t.costNative)}</td>
                    <td class="text-muted">${t['備註'] || ''}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  _bindEvents(container, state, store, showToast) {
    container.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.getAttribute('data-tab');
        this.render(container, store.getState(), store, showToast);
      });
    });

    // Universal column sorting
    container.querySelectorAll('th[data-st-sort-table]').forEach((th) => {
      th.addEventListener('click', () => {
        const tbl = th.getAttribute('data-st-sort-table');
        const col = th.getAttribute('data-st-sort-col');
        const def = th.getAttribute('data-st-sort-def') || 'desc';
        this._toggleSort(tbl, col, def);
        this.render(container, store.getState(), store, showToast);
      });
    });

    // Quick toggle buttons for Lot sorting (by Date vs by Cost Amount)
    container.querySelectorAll('[data-lot-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const col = btn.getAttribute('data-lot-sort');
        this._toggleSort('lots', col, 'desc');
        this.render(container, store.getState(), store, showToast);
      });
    });

    const toggleBtn = container.querySelector('#btn-toggle-trade-form');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.showAddForm = !this.showAddForm;
        this.render(container, store.getState(), store, showToast);
      });
    }

    container.querySelectorAll('[data-click-symbol]').forEach((row) => {
      row.addEventListener('click', () => {
        const sym = row.getAttribute('data-click-symbol');
        if (this.selectedSymbol === sym) {
          this.selectedSymbol = null;
          this.selectedLotId = null;
        } else {
          this.selectedSymbol = sym;
          this.selectedLotId = null;
          this.showBuyForSelected = false;
          this.showClosedLots = false;
        }
        this.render(container, store.getState(), store, showToast);
        if (this.selectedSymbol) {
          const panel = container.querySelector('#lot-drilldown-panel');
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });

    const closePanelBtn = container.querySelector('#btn-close-lots-panel');
    if (closePanelBtn) {
      closePanelBtn.addEventListener('click', () => {
        this.selectedSymbol = null;
        this.selectedLotId = null;
        this.render(container, store.getState(), store, showToast);
      });
    }

    const buySameBtn = container.querySelector('#btn-buy-same-symbol');
    if (buySameBtn) {
      buySameBtn.addEventListener('click', () => {
        this.showBuyForSelected = !this.showBuyForSelected;
        this.render(container, store.getState(), store, showToast);
      });
    }

    const openGsBtn = container.querySelector('#btn-open-goodstock-for-symbol');
    if (openGsBtn) {
      openGsBtn.addEventListener('click', () => {
        const sym = openGsBtn.getAttribute('data-gs-symbol') || this.selectedSymbol;
        if (window.NIC_OpenGoodStock) window.NIC_OpenGoodStock(sym, 'all');
      });
    }

    const toggleClosedBtn = container.querySelector('#btn-toggle-closed-lots');
    if (toggleClosedBtn) {
      toggleClosedBtn.addEventListener('click', () => {
        this.showClosedLots = !this.showClosedLots;
        this.render(container, store.getState(), store, showToast);
      });
    }

    container.querySelectorAll('[data-select-lot]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lotId = btn.getAttribute('data-select-lot');
        this.selectedLotId = this.selectedLotId === lotId ? null : lotId;
        this.render(container, store.getState(), store, showToast);
      });
    });

    const cancelLotBtn = container.querySelector('#btn-cancel-lot-exit');
    if (cancelLotBtn) {
      cancelLotBtn.addEventListener('click', () => {
        this.selectedLotId = null;
        this.render(container, store.getState(), store, showToast);
      });
    }

    const lotExitForm = container.querySelector('#form-lot-exit');
    if (lotExitForm) {
      lotExitForm.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const fd = new FormData(lotExitForm);
          const rec = StockCore.addExit(store.getState(), Object.fromEntries(fd.entries()), store);
          showToast(`已從指定批次賣出 ${rec['出場股數']} 股 @ ${rec['出場價']}`);
          this.selectedLotId = null;
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`錯誤：${err.message}`);
        }
      });
    }

    const mktEl = container.querySelector('#filter-market');
    if (mktEl) {
      mktEl.addEventListener('change', (e) => {
        this.filterMarket = e.target.value;
        this.render(container, store.getState(), store, showToast);
      });
    }

    const typeEl = container.querySelector('#filter-type');
    if (typeEl) {
      typeEl.addEventListener('change', (e) => {
        this.filterType = e.target.value;
        this.render(container, store.getState(), store, showToast);
      });
    }

    const qEl = container.querySelector('#filter-query');
    if (qEl) {
      qEl.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        this.render(container, store.getState(), store, showToast);
        const input = container.querySelector('#filter-query');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
    }

    const addTradeForm = container.querySelector('#form-add-trade');
    if (addTradeForm) {
      const priceInp = addTradeForm.querySelector('#trade-input-price');
      const sharesInp = addTradeForm.querySelector('#trade-input-shares');
      const feeInp = addTradeForm.querySelector('#trade-input-fee');
      const previewEl = addTradeForm.querySelector('#trade-fee-preview');

      const updateFeePreview = () => {
        if (!previewEl) return;
        const p = toNum(priceInp?.value, 0);
        const s = toNum(sharesInp?.value, 0);
        const f = Math.max(0, toNum(feeInp?.value, 0));
        if (p > 0 && s > 0) {
          const rawTotal = p * s;
          const total = rawTotal + f;
          const effPrice = Math.round((total / s) * 10000) / 10000;
          previewEl.innerHTML = f > 0
            ? `試算：成交 <strong>${fmtDec(rawTotal)}</strong> + 手續費 <strong>${fmtDec(f)}</strong> = 總成本 <strong>${fmtDec(total)}</strong> ｜ 寫入進場單價：<strong style="color:var(--accent-blue);">${effPrice}</strong>`
            : `試算：總成本 <strong>${fmtDec(rawTotal)}</strong>（手續費 0）｜ 寫入進場單價：<strong style="color:var(--accent-blue);">${p}</strong>`;
        } else {
          previewEl.textContent = '輸入成交單價、股數與手續費後，將即時預覽折算後之含手續費進場價';
        }
      };

      [priceInp, sharesInp, feeInp].forEach((inp) => {
        if (inp) inp.addEventListener('input', updateFeePreview);
      });

      addTradeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const fd = new FormData(addTradeForm);
          const rec = StockCore.addTrade(store.getState(), Object.fromEntries(fd.entries()), store);
          const feeMsg = rec.fee > 0 ? ` (含手續費 ${rec.fee}，折算進場價 ${rec['進場價']})` : '';
          showToast(`已新增買進 ${rec['代號']}：${rec['進場股數']} 股 @ ${rec['進場價']}${feeMsg}`);
          this.showAddForm = false;
          this.showBuyForSelected = false;
          this.selectedSymbol = rec['代號'];
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`錯誤：${err.message}`);
        }
      });
    }

    const wlForm = container.querySelector('#form-watchlist');
    if (wlForm) {
      wlForm.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const fd = new FormData(wlForm);
          const rec = StockCore.upsertWatchlist(store.getState(), Object.fromEntries(fd.entries()), store);
          showToast(`已更新觀察清單：${rec['代號']} 公允價 ${rec['公允價格']}`);
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`錯誤：${err.message}`);
        }
      });
    }

    container.querySelectorAll('[data-select-pool]').forEach((el) => {
      el.addEventListener('click', () => {
        this.rebalancePool = el.getAttribute('data-select-pool');
        this.render(container, store.getState(), store, showToast);
      });
    });

    container.querySelectorAll('[data-calc-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.rebalanceCalcMode = btn.getAttribute('data-calc-mode');
        this.render(container, store.getState(), store, showToast);
      });
    });

    container.querySelectorAll('[data-type-weight]').forEach((input) => {
      input.addEventListener('change', (e) => {
        const type = input.getAttribute('data-type-weight');
        const targetPct = e.target.value;
        StockCore.setTypeTargetWeight(store.getState(), { type, targetPct }, store);
        showToast(`已更新【${type}】第一層目標比例為 ${targetPct || 0}%`);
        this.render(container, store.getState(), store, showToast);
      });
    });

    container.querySelectorAll('[data-stock-weight]').forEach((input) => {
      input.addEventListener('change', (e) => {
        const symbol = input.getAttribute('data-stock-weight');
        const targetPct = e.target.value;
        StockCore.setStockTargetWeight(store.getState(), { symbol, targetPct }, store);
        this.render(container, store.getState(), store, showToast);
      });
    });

    const autoCostBtn = container.querySelector('#btn-autofill-pool-cost');
    if (autoCostBtn) {
      autoCostBtn.addEventListener('click', () => {
        StockCore.autoFillPoolWeights(store.getState(), { poolType: this.rebalancePool, basis: 'cost' }, store);
        showToast(`已依【${this.rebalancePool}】目前成本佔比帶入目標%`);
        this.render(container, store.getState(), store, showToast);
      });
    }

    const autoMktBtn = container.querySelector('#btn-autofill-pool-mkt');
    if (autoMktBtn) {
      autoMktBtn.addEventListener('click', () => {
        StockCore.autoFillPoolWeights(store.getState(), { poolType: this.rebalancePool, basis: 'market' }, store);
        showToast(`已依【${this.rebalancePool}】目前現值佔比帶入目標%`);
        this.render(container, store.getState(), store, showToast);
      });
    }

    const clearPoolBtn = container.querySelector('#btn-clear-pool-weights');
    if (clearPoolBtn) {
      clearPoolBtn.addEventListener('click', () => {
        StockCore.autoFillPoolWeights(store.getState(), { poolType: this.rebalancePool, basis: 'clear' }, store);
        showToast(`已清空【${this.rebalancePool}】池內目標%`);
        this.render(container, store.getState(), store, showToast);
      });
    }

    const rebQ = container.querySelector('#rebalance-query');
    if (rebQ) {
      rebQ.addEventListener('input', (e) => {
        this.rebalanceQuery = e.target.value;
        this.render(container, store.getState(), store, showToast);
        const inp = container.querySelector('#rebalance-query');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(inp.value.length, inp.value.length);
        }
      });
    }

    const refreshPriceBtn = container.querySelector('#btn-force-refresh-prices');
    if (refreshPriceBtn) {
      refreshPriceBtn.addEventListener('click', async () => {
        refreshPriceBtn.disabled = true;
        refreshPriceBtn.textContent = '⏳ 正在抓取最新收盤價...';
        try {
          await store.syncWithCloud({ forceRefresh: true, pushFirst: true, silent: true });
          const res = await StockCore.refreshLivePrices(store.getState(), store);
          if (res.updatedCount > 0) {
            const failNote = res.failedSymbols.length ? `（${res.failedSymbols.length} 檔維持原價）` : '';
            const sheetNote = res.sheetSynced
              ? '，並已同步寫回 Google Sheets (N_BD_C)！'
              : (res.sheetError ? `（N_BD_C 未寫回：${res.sheetError}）` : '');
            showToast(`✅ 已更新 ${res.updatedCount}/${res.totalCount} 檔最新市價${failNote}${sheetNote}`);
          } else {
            showToast('⚠️ 無法從行情 API 取得新價格，請稍後再試或檢查網路');
          }
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`⚠️ 刷新失敗：${err?.message || err}`);
          refreshPriceBtn.disabled = false;
          refreshPriceBtn.textContent = '🔄 強制刷新現價';
        }
      });
    }

    container.querySelectorAll('[data-jump-symbol]').forEach((cell) => {
      cell.addEventListener('click', () => {
        const sym = cell.getAttribute('data-jump-symbol');
        this.activeTab = 'holdings';
        this.selectedSymbol = sym;
        this.selectedLotId = null;
        this.render(container, store.getState(), store, showToast);
      });
    });
  }
}
