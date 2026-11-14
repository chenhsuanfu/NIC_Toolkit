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

export class StockTrackerUI {
  constructor() {
    this.activeTab = 'holdings'; // 'holdings' | 'rebalance' | 'watchlist' | 'history'
    this.filterMarket = 'ALL';
    this.filterType = 'ALL';
    this.searchQuery = '';
    this.showAddForm = false;
    this.selectedSymbol = null; // Currently inspected stock ticker for lot-level inventory
    this.selectedLotId = null;  // Specific lot ID selected for exit/selling
    this.showBuyForSelected = false; // Quick add buy lot for selectedSymbol
    this.showClosedLots = false;
    this.rebalancePool = '進攻型'; // '進攻型' | '防禦型' | '樂透型'
    this.rebalanceCalcMode = 'TOP_DOWN'; // 'TOP_DOWN' | 'POOL_ONLY'
    this.rebalanceQuery = '';
    this.valParams = {
      symbol: '2330.TW',
      isTwStock: true,
      baseRevenue: 28943,
      growthRatePct: 24,
      netMarginPct: 42.5,
      shareCapital: 259.3,
      targetPe: 22
    };
  }

  render(container, state, store, showToast) {
    const summary = StockCore.getSummary(state);
    const options = StockCore.getOptions(state);
    const holdings = StockCore.filterHoldings(state, {
      market: this.filterMarket,
      type: this.filterType,
      query: this.searchQuery
    });

    const pnlClass = summary.unrealizedTwd >= 0 ? 'text-emerald' : 'text-rose';
    const pnlSign = summary.unrealizedTwd >= 0 ? '+' : '';

    container.innerHTML = `
      <!-- KPI Row -->
      <div class="grid-kpi">
        <div class="card">
          <div class="kpi-label">
            <span>股票總市值 (TWD)</span>
            <span class="pill pill-blue">${summary.holdingCount} 檔持倉</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(summary.totalMarketTwd)}</div>
          <div class="kpi-sub mask-amount">約 US$${fmtDec(summary.totalMarketUsd)} (匯率 ${fmtDec(summary.usdTwd, 2)})</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>未實現總損益</span>
            <span class="pill ${summary.unrealizedTwd >= 0 ? 'pill-emerald' : 'pill-rose'}">${pnlSign}${fmtPct(summary.returnRate)}</span>
          </div>
          <div class="kpi-value mask-amount ${pnlClass}">${pnlSign}$${fmtInt(summary.unrealizedTwd)}</div>
          <div class="kpi-sub mask-amount ${pnlClass}">${pnlSign}US$${fmtDec(summary.unrealizedUsd)}</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>持倉總成本 (TWD)</span>
            <span class="pill pill-purple">投入本金</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(summary.totalCostTwd)}</div>
          <div class="kpi-sub mask-amount">US$${fmtDec(summary.totalCostUsd)}</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>累計已實現損益</span>
            <span class="pill pill-emerald">歷史落袋</span>
          </div>
          <div class="kpi-value mask-amount text-emerald">+$${fmtInt(summary.realizedTwd)}</div>
          <div class="kpi-sub mask-amount">US$${fmtDec(summary.realizedUsd)}</div>
        </div>
      </div>

      <!-- Sub-navigation & Quick Add Button -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
        <div class="sub-tabs" style="margin-bottom:0; border-bottom:none;">
          <button class="sub-tab ${this.activeTab === 'holdings' ? 'active' : ''}" data-tab="holdings">📊 持倉總覽 (${holdings.length})</button>
          <button class="sub-tab ${this.activeTab === 'rebalance' ? 'active' : ''}" data-tab="rebalance">⚖️ 權重配置比較</button>
          <button class="sub-tab ${this.activeTab === 'watchlist' ? 'active' : ''}" data-tab="watchlist">🎯 觀察清單 & 好股價估值</button>
          <button class="sub-tab ${this.activeTab === 'history' ? 'active' : ''}" data-tab="history">🛡️ 風控配置 & 進出場紀錄</button>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-primary" id="btn-toggle-trade-form">
            ${this.showAddForm ? '✕ 收起新股買進表單' : '＋ 新增買進紀錄'}
          </button>
        </div>
      </div>

      <!-- Quick Trade Form (Optimistic 0.01s Entry) -->
      ${this.showAddForm ? this._renderTradeForm(options) : ''}

      <!-- Tab Content -->
      <div id="stock-tab-body">
        ${this.activeTab === 'holdings' ? this._renderHoldingsTab(holdings, options, state) : ''}
        ${this.activeTab === 'rebalance' ? this._renderRebalanceTab(state) : ''}
        ${this.activeTab === 'watchlist' ? this._renderWatchlistTab(state, options) : ''}
        ${this.activeTab === 'history' ? this._renderHistoryTab(state, summary) : ''}
      </div>
    `;

    this._bindEvents(container, state, store, showToast);
  }

  _renderTradeForm(options, prefill = {}) {
    const today = new Date().toISOString().slice(0, 10);

    return `
      <div class="card" style="margin-bottom:18px; border-color: rgba(56,189,248,0.45);">
        <div class="card-header">
          <div class="card-title">📥 新增股票買進（寫入「交易明細」・0.01 秒樂觀更新）</div>
        </div>
        <form id="form-add-trade" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">股票代號</label>
              <input class="form-control" name="symbol" placeholder="如 NVDA 或 2330.TW" value="${prefill.symbol || ''}" required />
            </div>
            <div class="form-group">
              <label class="form-label">市場</label>
              <select class="form-control" name="market">
                ${options.markets.map((m) => `<option value="${m}" ${prefill.market === m ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">策略類型</label>
              <select class="form-control" name="type">
                ${options.types.map((t) => `<option value="${t}" ${(prefill.type || '進攻型') === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">券商代號</label>
              <select class="form-control" name="broker">
                ${options.brokers.map((b) => `<option value="${b}" ${prefill.broker === b ? 'selected' : ''}>${b}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">進場單價 (原幣)</label>
              <input class="form-control" type="number" step="any" name="price" placeholder="0.00" value="${prefill.price || ''}" required />
            </div>
            <div class="form-group">
              <label class="form-label">進場股數</label>
              <input class="form-control" type="number" step="any" name="shares" placeholder="1" required />
            </div>
            <div class="form-group">
              <label class="form-label">進場日</label>
              <input class="form-control" type="date" name="date" value="${today}" />
            </div>
            <div class="form-group">
              <label class="form-label">備註</label>
              <input class="form-control" name="note" placeholder="選填策略說明" />
            </div>
          </div>
          <button type="submit" class="btn btn-primary" style="align-self:flex-start;">✓ 確認新增買進庫存</button>
        </form>
      </div>
    `;
  }

  /**
   * Lot-Level Inventory Drilldown Panel when a stock ticker is clicked
   */
  _renderSelectedSymbolLotsPanel(state, options) {
    if (!this.selectedSymbol) return '';
    const detail = StockCore.getLotsBySymbol(state, this.selectedSymbol);
    const { symbol, holding, currentPrice, openLots, closedLots } = detail;
    const today = new Date().toISOString().slice(0, 10);
    const activeLot = openLots.find((l) => l.id === this.selectedLotId) || null;
    const curLabel = (holding?.['市場'] || openLots[0]?.market || 'US') === 'TW' ? 'TWD' : 'USD';

    return `
      <div class="card" id="lot-drilldown-panel" style="margin-bottom:18px; border: 2px solid var(--accent-blue); background: linear-gradient(180deg, rgba(14, 165, 233, 0.08), var(--bg-card));">
        <div class="card-header">
          <div>
            <div class="card-title" style="font-size:17px;">
              📌 【${symbol}】庫存批次明細與指定交易
              <span class="pill pill-blue">${openLots.length} 筆持有中批次</span>
              ${closedLots.length > 0 ? `<span class="pill pill-purple">${closedLots.length} 筆已出場</span>` : ''}
            </div>
            <div class="text-muted" style="font-size:12px; margin-top:4px;">
              現價：<strong class="text-primary font-mono">${curLabel} ${fmtDec(currentPrice)}</strong> ｜ 
              平均成本：<strong class="font-mono">${fmtDec(holding?.['平均成本(原幣)'] || 0)}</strong> ｜ 
              總剩餘股數：<strong class="text-emerald font-mono">${fmtDec(holding?.['剩餘股數'] || 0, 0)} 股</strong>
            </div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${curLabel === 'TWD' ? `
              <button type="button" class="btn btn-emerald btn-sm" id="btn-open-goodstock-for-symbol" data-gs-symbol="${symbol}">
                🎯 好股價財報與六大指標健診
              </button>
            ` : ''}
            <button type="button" class="btn btn-primary btn-sm" id="btn-buy-same-symbol">
              ${this.showBuyForSelected ? '✕ 收起加碼' : `📥 加碼買進 ${symbol}`}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-close-lots-panel">✕ 關閉明細</button>
          </div>
        </div>

        <!-- Inline Quick Buy for this specific ticker -->
        ${this.showBuyForSelected ? this._renderTradeForm(options, {
          symbol,
          market: holding?.['市場'] || openLots[0]?.market || 'US',
          type: holding?.['類型'] || openLots[0]?.type || '進攻型',
          broker: openLots[0]?.broker || 'F',
          price: currentPrice > 0 ? currentPrice : ''
        }) : ''}

        <!-- Inline Lot-Specific Sell / Exit Action Box (when a specific lot is clicked) -->
        ${activeLot ? `
          <div style="margin-bottom:16px; padding:14px; border-radius:12px; background:rgba(16, 185, 129, 0.12); border:1px solid rgba(16, 185, 129, 0.45);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
              <div style="font-weight:700; color:var(--accent-emerald); font-size:14px;">
                📤 指定庫存批次出場：進場日 <span class="font-mono">${activeLot.entryDate}</span> ｜ 券商 <span class="font-mono">${activeLot.broker}</span> ｜ 進場價 <span class="font-mono">${fmtDec(activeLot.entryPrice)}</span>（可賣上限：<span class="font-mono">${activeLot.remainingShares}</span> 股）
              </div>
              <button type="button" class="btn btn-ghost btn-sm" id="btn-cancel-lot-exit">✕ 取消指定</button>
            </div>
            <form id="form-lot-exit" class="form-grid" style="align-items:end;">
              <input type="hidden" name="tradeId" value="${activeLot.id}" />
              <div class="form-group">
                <label class="form-label">出場股數 (上限 ${activeLot.remainingShares})</label>
                <input class="form-control font-mono" type="number" step="any" max="${activeLot.remainingShares}" name="exitShares" value="${activeLot.remainingShares}" required />
              </div>
              <div class="form-group">
                <label class="form-label">出場單價 (${curLabel})</label>
                <input class="form-control font-mono" type="number" step="any" name="exitPrice" value="${currentPrice > 0 ? currentPrice : activeLot.entryPrice}" required />
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
                <button type="submit" class="btn btn-emerald" style="width:100%;">✓ 確認從此批庫存賣出</button>
              </div>
            </form>
          </div>
        ` : `
          <div style="margin-bottom:10px; font-size:12px; color:var(--accent-blue);">
            💡 請點擊下方任一筆庫存的 <strong>「📤 指定賣出」</strong> 按鈕，即可針對該筆進場庫存進行全部或部分出場：
          </div>
        `}

        <!-- Open Lots Table -->
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>操作</th>
                <th>進場日</th>
                <th>券商</th>
                <th>類型</th>
                <th>進場單價</th>
                <th>剩餘股數 (原股數)</th>
                <th>單批損益 (${curLabel})</th>
                <th>報酬率</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              ${openLots.length === 0 ? `
                <tr><td colspan="9" class="text-muted" style="text-align:center; padding:18px;">找不到此代號之未出場批次明細</td></tr>
              ` : openLots.map((lot) => {
                const isSelected = lot.id === this.selectedLotId;
                const pnlCls = lot.unrealizedNative >= 0 ? 'text-emerald' : 'text-rose';
                const sign = lot.unrealizedNative >= 0 ? '+' : '';
                return `
                  <tr style="${isSelected ? 'background:rgba(16, 185, 129, 0.14);' : ''}">
                    <td>
                      <button type="button" class="btn ${isSelected ? 'btn-primary' : 'btn-emerald'} btn-sm" data-select-lot="${lot.id}">
                        ${isSelected ? '✓ 已指定' : '📤 指定賣出'}
                      </button>
                    </td>
                    <td class="font-mono" style="font-size:12px;">${lot.entryDate}</td>
                    <td><span class="pill pill-blue font-mono">${lot.broker}</span></td>
                    <td>${lot.type}</td>
                    <td class="font-mono" style="font-weight:700;">${fmtDec(lot.entryPrice)}</td>
                    <td class="font-mono">
                      <strong class="text-primary">${lot.remainingShares}</strong>
                      ${lot.exitedShares > 0 ? `<span class="text-muted" style="font-size:11px;"> (原 ${lot.entryShares} / 已賣 ${lot.exitedShares})</span>` : ''}
                    </td>
                    <td class="font-mono mask-amount ${pnlCls}" style="font-weight:700;">${sign}${fmtDec(lot.unrealizedNative)}</td>
                    <td><span class="pill ${lot.unrealizedNative >= 0 ? 'pill-emerald' : 'pill-rose'}">${sign}${fmtPct(lot.roi)}</span></td>
                    <td class="text-muted" style="font-size:12px;">${lot.note || '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Optional Closed Lots Toggle -->
        ${closedLots.length > 0 ? `
          <div style="margin-top:12px; padding-top:10px; border-top:1px solid var(--border-color);">
            <button type="button" class="btn btn-ghost btn-sm" id="btn-toggle-closed-lots">
              ${this.showClosedLots ? '▲ 隱藏已全數出場批次' : `▼ 查看此標的歷史已出場完畢批次 (${closedLots.length} 筆)`}
            </button>
            ${this.showClosedLots ? `
              <div class="table-wrap" style="margin-top:10px;">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>進場日</th>
                      <th>券商</th>
                      <th>進場價</th>
                      <th>原股數</th>
                      <th>狀態</th>
                      <th>備註</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${closedLots.map((c) => `
                      <tr>
                        <td class="font-mono" style="font-size:12px;">${c.entryDate}</td>
                        <td class="font-mono">${c.broker}</td>
                        <td class="font-mono">${fmtDec(c.entryPrice)}</td>
                        <td class="font-mono">${c.entryShares}</td>
                        <td><span class="pill pill-purple">已全數出場 (${c.exitedShares} 股)</span></td>
                        <td class="text-muted" style="font-size:12px;">${c.note || '-'}</td>
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

  _renderHoldingsTab(holdings, options, state) {
    return `
      <!-- Lot-Level Inventory Drilldown Panel (Appears when clicking any stock ticker) -->
      ${this._renderSelectedSymbolLotsPanel(state, options)}

      <div class="card">
        <div class="card-header">
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <select id="filter-market" class="form-control" style="width:auto; padding:6px 10px;">
              <option value="ALL" ${this.filterMarket === 'ALL' ? 'selected' : ''}>全部市場 (US+TW)</option>
              ${options.markets.map((m) => `<option value="${m}" ${this.filterMarket === m ? 'selected' : ''}>${m} 市場</option>`).join('')}
            </select>
            <select id="filter-type" class="form-control" style="width:auto; padding:6px 10px;">
              <option value="ALL" ${this.filterType === 'ALL' ? 'selected' : ''}>全部策略類型</option>
              ${options.types.map((t) => `<option value="${t}" ${this.filterType === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <input id="filter-query" class="form-control" style="width:160px; padding:6px 10px;" placeholder="🔍 搜尋代號..." value="${this.searchQuery}" />
          </div>
          <div style="font-size:12px; color:var(--accent-blue); font-weight:600;">
            👆 點擊任一「股票代號」即可展開該股所有庫存批次並指定交易
          </div>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>代號 (點擊展開庫存)</th>
                <th>類型</th>
                <th>股數</th>
                <th>均價 (原幣)</th>
                <th>現價 (原幣)</th>
                <th>市值 (TWD)</th>
                <th>未實現 (TWD)</th>
                <th>報酬率</th>
                <th>券商分佈</th>
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
                const typeBadge = r['類型'] === '防禦型' ? 'pill-blue' : r['類型'] === '進攻型' ? 'pill-emerald' : 'pill-amber';
                return `
                  <tr data-click-symbol="${sym}" style="cursor:pointer; ${isSelected ? 'background:rgba(56, 189, 248, 0.14);' : ''}">
                    <td>
                      <div style="display:flex; align-items:center; gap:6px;">
                        <span style="font-weight:800; font-family:var(--font-mono); color:var(--accent-blue); text-decoration:underline;">${sym}</span>
                        <span class="pill" style="font-size:10px; background:rgba(255,255,255,0.06);">${r['市場']}</span>
                      </div>
                      <div style="font-size:10px; color:var(--text-secondary);">🔍 點此指定庫存交易</div>
                    </td>
                    <td><span class="pill ${typeBadge}">${r['類型'] || '-'}</span></td>
                    <td class="font-mono" style="font-weight:700;">${fmtDec(r['剩餘股數'], 0)}</td>
                    <td class="font-mono">${fmtDec(r['平均成本(原幣)'])}</td>
                    <td class="font-mono" style="font-weight:700;">${fmtDec(r['現價(原幣)'])}</td>
                    <td class="font-mono mask-amount">$${fmtInt(r['市值(TWD)'])}</td>
                    <td class="font-mono mask-amount ${cls}" style="font-weight:700;">${sign}$${fmtInt(pnl)}</td>
                    <td><span class="pill ${pnl >= 0 ? 'pill-emerald' : 'pill-rose'}">${sign}${fmtPct(roi)}</span></td>
                    <td class="text-muted" style="font-size:12px;">${r['券商分佈'] || '-'}</td>
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
        return `<span class="pill pill-emerald">0.0% (達標)</span>`;
      }
      if (diffPct < 0) {
        return `<span class="pill pill-blue">${sign}${diffPct.toFixed(1)}% (不足)</span>`;
      }
      return `<span class="pill pill-amber">${sign}${diffPct.toFixed(1)}% (超標)</span>`;
    };

    const renderActionCell = (actionTwd, actionShares, targetPct, currentTwd) => {
      if (targetPct <= 0 && currentTwd <= 0) return '<span class="text-muted">-</span>';
      if (Math.abs(actionTwd) < 500) {
        return `<span class="text-emerald" style="font-size:12px; font-weight:700;">✓ 符合目標</span>`;
      }
      const isBuy = actionTwd > 0;
      const absTwd = Math.abs(actionTwd);
      const absShares = Math.abs(actionShares);
      return `
        <div class="${isBuy ? 'text-emerald' : 'text-rose'}" style="font-weight:700; font-family:var(--font-mono);">
          ${isBuy ? '📥 買入' : '📤 賣出'} $${fmtInt(absTwd)}
        </div>
        ${absShares !== undefined ? `
          <div class="text-muted font-mono" style="font-size:11px;">
            約 ${fmtDec(absShares, 1)} 股
          </div>
        ` : ''}
      `;
    };

    const t1SumOk = Math.abs(reb.tier1TotalTargetPct - 100) < 0.1;
    const t2SumOk = Math.abs(reb.tier2TotalTargetPct - 100) < 0.1;

    return `
      <!-- Tier 1: Strategy Pools Allocation -->
      <div class="card" style="margin-bottom:18px; border-color: rgba(56, 189, 248, 0.4);">
        <div class="card-header">
          <div>
            <div class="card-title" style="font-size:16px;">
              🏛️ 第一層（Tier 1）：三大策略池權重配置（進攻型｜防禦型｜樂透型）
            </div>
            <div class="text-muted" style="font-size:12px; margin-top:4px;">
              分開比較 <strong>「持倉總成本 ($${fmtInt(reb.portfolioCostTwd)})」</strong> 與 <strong>「持倉總現值 ($${fmtInt(reb.portfolioMarketTwd)})」</strong> ｜ 點擊策略名稱可切換下方個股池
            </div>
          </div>
          <div>
            <span class="pill ${t1SumOk ? 'pill-emerald' : 'pill-amber'}" style="font-size:13px; padding:6px 12px;">
              第一層目標合計：${reb.tier1TotalTargetPct.toFixed(1)}%
              ${t1SumOk ? ' ✓' : (reb.tier1UnallocatedPct > 0 ? ` (尚餘 ${reb.tier1UnallocatedPct.toFixed(1)}%)` : ` (超出 ${Math.abs(reb.tier1UnallocatedPct).toFixed(1)}%)`)}
            </span>
          </div>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>策略類型 (點擊切換)</th>
                <th>🎯 第一層目標 %</th>
                <th style="border-left:2px solid var(--border-color);">💰 該池目前總成本</th>
                <th>成本佔比</th>
                <th>成本差距 (目前-目標)</th>
                <th>成本法建議 (買/賣)</th>
                <th style="border-left:2px solid var(--border-color);">📈 該池目前總現值</th>
                <th>現值佔比</th>
                <th>現值差距 (目前-目標)</th>
                <th>現值法建議 (買/賣)</th>
              </tr>
            </thead>
            <tbody>
              ${reb.tier1Rows.map((r) => {
                const isSelected = this.rebalancePool === r.type;
                const badge = r.type === '防禦型' ? 'pill-blue' : r.type === '進攻型' ? 'pill-emerald' : 'pill-amber';
                return `
                  <tr style="${isSelected ? 'background:rgba(56, 189, 248, 0.12);' : ''}">
                    <td data-select-pool="${r.type}" style="cursor:pointer;">
                      <span class="pill ${badge}" style="font-size:13px;">${r.type} (${r.count} 檔)</span>
                      ${isSelected ? '<span style="font-size:11px; color:var(--accent-blue); margin-left:4px;">▼ 檢視中</span>' : ''}
                    </td>
                    <td>
                      <div style="display:flex; align-items:center; gap:4px;">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          class="form-control font-mono"
                          style="width:82px; padding:5px 8px; font-weight:700;"
                          data-type-weight="${r.type}"
                          value="${r.targetPct}"
                        />
                        <span class="font-mono">%</span>
                      </div>
                    </td>
                    <td class="font-mono mask-amount" style="border-left:2px solid var(--border-color); font-weight:700;">$${fmtInt(r.costTwd)}</td>
                    <td class="font-mono">${r.costWeightPct.toFixed(1)}%</td>
                    <td>${renderDiffBadge(r.costDiffPct, r.targetPct)}</td>
                    <td class="mask-amount">${renderActionCell(r.costActionTwd, undefined, r.targetPct, r.costTwd)}</td>
                    <td class="font-mono mask-amount" style="border-left:2px solid var(--border-color); font-weight:700;">$${fmtInt(r.marketTwd)}</td>
                    <td class="font-mono">${r.marketWeightPct.toFixed(1)}%</td>
                    <td>${renderDiffBadge(r.marketDiffPct, r.targetPct)}</td>
                    <td class="mask-amount">${renderActionCell(r.marketActionTwd, undefined, r.targetPct, r.marketTwd)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="border-top:2px solid var(--border-color); font-weight:800; background:rgba(255,255,255,0.03);">
                <td>全倉總計</td>
                <td class="font-mono">${reb.tier1TotalTargetPct.toFixed(1)}%</td>
                <td class="font-mono mask-amount" style="border-left:2px solid var(--border-color);">$${fmtInt(reb.portfolioCostTwd)}</td>
                <td class="font-mono">100.0%</td>
                <td>-</td>
                <td>-</td>
                <td class="font-mono mask-amount" style="border-left:2px solid var(--border-color);">$${fmtInt(reb.portfolioMarketTwd)}</td>
                <td class="font-mono">100.0%</td>
                <td>-</td>
                <td>-</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Tier 2: Individual Stock Weights inside Selected Strategy Pool -->
      <div class="card" style="border-color: rgba(16, 185, 129, 0.4);">
        <div class="card-header" style="flex-wrap:wrap; gap:10px;">
          <div>
            <div class="card-title" style="font-size:16px;">
              🎯 第二層（Tier 2）：【${this.rebalancePool}】池內個股權重與買賣建議
            </div>
            <div class="text-muted" style="font-size:12px; margin-top:4px;">
              計算基準成本分母：<strong class="text-primary font-mono">$${fmtInt(reb.denomCostTwd)}</strong> ｜ 
              計算基準現值分母：<strong class="text-primary font-mono">$${fmtInt(reb.denomMarketTwd)}</strong>
            </div>
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <span class="pill ${t2SumOk ? 'pill-emerald' : 'pill-amber'}" style="font-size:13px; padding:6px 12px;">
              【${this.rebalancePool}】池內目標合計：${reb.tier2TotalTargetPct.toFixed(1)}%
              ${t2SumOk ? ' ✓' : (reb.tier2UnallocatedPct > 0 ? ` (尚餘 ${reb.tier2UnallocatedPct.toFixed(1)}%)` : ` (超出 ${Math.abs(reb.tier2UnallocatedPct).toFixed(1)}%)`)}
            </span>
          </div>
        </div>

        <!-- Pool Switcher + Calculation Mode + Quick Fill Toolbar -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid var(--border-color);">
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
            ${['進攻型', '防禦型', '樂透型'].map((tp) => `
              <button type="button" class="btn ${this.rebalancePool === tp ? 'btn-primary' : 'btn-ghost'} btn-sm" data-select-pool="${tp}">
                ${tp === '進攻型' ? '⚔️ ' : tp === '防禦型' ? '🛡️ ' : '🎰 '}${tp}
              </button>
            `).join('')}
            <input
              id="rebalance-query"
              class="form-control"
              style="width:140px; padding:5px 10px;"
              placeholder="🔍 篩選代號..."
              value="${this.rebalanceQuery}"
            />
          </div>

          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
            <button
              type="button"
              class="btn ${this.rebalanceCalcMode === 'TOP_DOWN' ? 'btn-emerald' : 'btn-ghost'} btn-sm"
              data-calc-mode="TOP_DOWN"
              title="個股目標金額 = 全倉總額 × 第一層策略池目標% × 第二層個股目標%"
            >
              🔗 連動第一層目標資金
            </button>
            <button
              type="button"
              class="btn ${this.rebalanceCalcMode === 'POOL_ONLY' ? 'btn-emerald' : 'btn-ghost'} btn-sm"
              data-calc-mode="POOL_ONLY"
              title="個股目標金額 = 本池目前現有總額 × 第二層個股目標%"
            >
              📦 僅依本池現有資金
            </button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-autofill-pool-cost">⚡ 帶入目前成本%</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-autofill-pool-mkt">⚡ 帶入目前現值%</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-clear-pool-weights">🗑️ 清空本池%</button>
          </div>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>代號 (點擊看批次)</th>
                <th>🎯 池內目標 %</th>
                <th style="border-left:2px solid var(--border-color);">💰 持有成本 (TWD)</th>
                <th>池內成本佔比</th>
                <th>成本差距 (目前-目標)</th>
                <th>成本法建議 (買/賣)</th>
                <th style="border-left:2px solid var(--border-color);">📈 目前現值 (TWD)</th>
                <th>池內現值佔比</th>
                <th>現值差距 (目前-目標)</th>
                <th>現值法建議 (買/賣)</th>
              </tr>
            </thead>
            <tbody>
              ${reb.tier2Rows.map((r) => `
                <tr>
                  <td data-jump-symbol="${r.symbol}" style="cursor:pointer;">
                    <div style="font-weight:800; font-family:var(--font-mono); color:var(--accent-blue); text-decoration:underline;">${r.symbol}</div>
                    <div class="text-muted font-mono" style="font-size:11px;">${r.shares} 股 ｜ 現價 ${fmtDec(r.currentPriceNative)}</div>
                  </td>
                  <td>
                    <div style="display:flex; align-items:center; gap:4px;">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        class="form-control font-mono"
                        style="width:82px; padding:5px 8px; font-weight:700;"
                        data-stock-weight="${r.symbol}"
                        placeholder="0"
                        value="${r.targetPct > 0 ? r.targetPct : ''}"
                      />
                      <span class="font-mono">%</span>
                    </div>
                    ${r.targetPct > 0 ? `<div class="text-muted" style="font-size:10px; margin-top:2px;">佔全倉 ${r.globalTargetPct.toFixed(1)}%</div>` : ''}
                  </td>
                  <td class="font-mono mask-amount" style="border-left:2px solid var(--border-color); font-weight:700;">$${fmtInt(r.costTwd)}</td>
                  <td class="font-mono" style="font-weight:700;">${r.costWeightPct.toFixed(1)}%</td>
                  <td>${renderDiffBadge(r.costDiffPct, r.targetPct)}</td>
                  <td class="mask-amount">${renderActionCell(r.costActionTwd, r.costActionShares, r.targetPct, r.costTwd)}</td>
                  <td class="font-mono mask-amount" style="border-left:2px solid var(--border-color); font-weight:700;">$${fmtInt(r.marketTwd)}</td>
                  <td class="font-mono" style="font-weight:700;">${r.marketWeightPct.toFixed(1)}%</td>
                  <td>${renderDiffBadge(r.marketDiffPct, r.targetPct)}</td>
                  <td class="mask-amount">${renderActionCell(r.marketActionTwd, r.marketActionShares, r.targetPct, r.marketTwd)}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr style="border-top:2px solid var(--border-color); font-weight:800; background:rgba(255,255,255,0.03);">
                <td>【${this.rebalancePool}】合計</td>
                <td class="font-mono">${reb.tier2TotalTargetPct.toFixed(1)}%</td>
                <td class="font-mono mask-amount" style="border-left:2px solid var(--border-color);">$${fmtInt(reb.poolCurrentCostTwd)}</td>
                <td class="font-mono">100.0%</td>
                <td>-</td>
                <td>-</td>
                <td class="font-mono mask-amount" style="border-left:2px solid var(--border-color);">$${fmtInt(reb.poolCurrentMarketTwd)}</td>
                <td class="font-mono">100.0%</td>
                <td>-</td>
                <td>-</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  }

  _renderWatchlistTab(state) {
    const watchlist = state?.stock?.watchlist || [];
    const vp = this.valParams;
    const calc = StockCore.estimateTargetPrice(state, vp);

    return `
      <div class="grid-2">
        <!-- Left: Watchlist with Fair Price Gap -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">🎯 N_BD_C 觀察清單（公允價值雷達）</div>
          </div>
          <form id="form-watchlist" class="form-grid" style="margin-bottom:14px;">
            <input class="form-control" name="symbol" placeholder="代號 (如 NVDA)" required />
            <input class="form-control" type="number" step="any" name="fairPrice" placeholder="目標公允價" required />
            <button type="submit" class="btn btn-primary">＋ 存入觀察清單</button>
          </form>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>代號</th>
                  <th>市場</th>
                  <th>公允價格</th>
                  <th>目前採用價</th>
                  <th>安全邊際 / 折溢價</th>
                </tr>
              </thead>
              <tbody>
                ${watchlist.map((w) => {
                  const fair = toNum(w['公允價格'], 0);
                  const cur = toNum(w['採用價'] || w['自動價'], 0);
                  const diffPct = (fair > 0 && cur > 0) ? ((cur - fair) / fair) : null;
                  const isUndervalued = diffPct !== null && diffPct <= 0;
                  return `
                    <tr>
                      <td style="font-weight:700; font-family:var(--font-mono);">${w['代號']}</td>
                      <td><span class="pill pill-blue">${w['市場'] || 'US'}</span></td>
                      <td class="font-mono text-amber" style="font-weight:700;">${fmtDec(fair)}</td>
                      <td class="font-mono">${cur > 0 ? fmtDec(cur) : '-'}</td>
                      <td>
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

        <!-- Right: Built-in GoodStockPrice Target Price Estimator -->
        <div class="card" style="border-color: rgba(16, 185, 129, 0.35);">
          <div class="card-header">
            <div class="card-title">🧮 好股價 EPS 目標價推估引擎（內建純前端秒算模組）</div>
            <span class="pill pill-emerald">一鍵寫入公允價</span>
          </div>
          <p class="text-muted" style="font-size:12px; margin-bottom:12px;">
            公式：預估營收 = 基準營收 × (1 + 年增率%) ｜ 預估 EPS = (預估營收 × 淨利率%) ÷ 總股數 ｜ 目標價 = EPS × 本益比
          </p>
          <form id="form-val-calc" class="form-grid" style="margin-bottom:14px;">
            <div class="form-group">
              <label class="form-label">標的代號</label>
              <input class="form-control" name="symbol" value="${vp.symbol}" />
            </div>
            <div class="form-group">
              <label class="form-label">基準年營收 (億)</label>
              <input class="form-control" type="number" step="any" name="baseRevenue" value="${vp.baseRevenue}" />
            </div>
            <div class="form-group">
              <label class="form-label">預估營收年增率 (%)</label>
              <input class="form-control" type="number" step="any" name="growthRatePct" value="${vp.growthRatePct}" />
            </div>
            <div class="form-group">
              <label class="form-label">預估歸母淨利率 (%)</label>
              <input class="form-control" type="number" step="any" name="netMarginPct" value="${vp.netMarginPct}" />
            </div>
            <div class="form-group">
              <label class="form-label">總股數 (億股，股本÷10)</label>
              <input class="form-control" type="number" step="any" name="shareCapital" value="${vp.shareCapital}" />
            </div>
            <div class="form-group">
              <label class="form-label">目標本益比 (PE)</label>
              <input class="form-control" type="number" step="any" name="targetPe" value="${vp.targetPe}" />
            </div>
          </form>

          <div style="background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:12px; padding:14px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <div class="text-muted" style="font-size:12px;">推估 EPS：<strong class="text-primary font-mono">${calc.estEps} 元</strong> ｜ 合理目標好價格：</div>
              <div style="font-size:24px; font-weight:800; color:var(--accent-emerald);" class="font-mono">${calc.targetPrice}</div>
            </div>
            <button type="button" class="btn btn-emerald" id="btn-save-val-to-watchlist" data-symbol="${vp.symbol}" data-price="${calc.targetPrice}">
              📥 將 ${calc.targetPrice} 存入「${vp.symbol}」觀察公允價
            </button>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>情境 (營收年增率)</th>
                  <th>推估 EPS</th>
                  <th>保守 PE (${Math.max(5, vp.targetPe - 3)}x)</th>
                  <th>基準 PE (${vp.targetPe}x)</th>
                  <th>樂觀 PE (${vp.targetPe + 3}x)</th>
                </tr>
              </thead>
              <tbody>
                ${calc.matrix.map((row) => `
                  <tr>
                    <td>年增 ${row.growthPct}%</td>
                    <td class="font-mono">${row.eps}</td>
                    <td class="font-mono text-muted">${row.peLow}</td>
                    <td class="font-mono text-emerald" style="font-weight:700;">${row.peBase}</td>
                    <td class="font-mono text-amber">${row.peHigh}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  _renderHistoryTab(state, summary) {
    const trades = (state?.stock?.recentTrades || []).slice().reverse().slice(0, 40);

    return `
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div class="card-title">🛡️ 風控策略配置比例 (防禦 / 進攻 / 樂透)</div>
          </div>
          <div style="display:flex; flex-direction:column; gap:14px;">
            ${summary.riskBreakdown.map((r) => `
              <div>
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
                  <span><strong>${r.type}</strong> (${r.count} 檔)</span>
                  <span class="font-mono mask-amount">$${fmtInt(r.marketTwd)} (${fmtPct(r.weight)} ｜ 報酬 ${fmtPct(r.roi)})</span>
                </div>
                <div class="progress-track">
                  <div class="progress-fill" style="width:${Math.min(100, Math.max(2, r.weight * 100))}%;"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🕒 近期進場交易明細 (最新 40 筆)</div>
          </div>
          <div class="table-wrap" style="max-height:360px; overflow-y:auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>進場日</th>
                  <th>代號</th>
                  <th>類型</th>
                  <th>券商</th>
                  <th>進場價</th>
                  <th>股數</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                ${trades.map((t) => `
                  <tr>
                    <td class="font-mono" style="font-size:12px;">${t['進場日'] || t['建立時間'] || '-'}</td>
                    <td class="font-mono" style="font-weight:700;">${t['代號']}</td>
                    <td><span class="pill pill-blue">${t['類型']}</span></td>
                    <td class="font-mono">${t['券商']}</td>
                    <td class="font-mono">${fmtDec(t['進場價'])}</td>
                    <td class="font-mono">${fmtDec(t['進場股數'], 0)}</td>
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

    const toggleBtn = container.querySelector('#btn-toggle-trade-form');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.showAddForm = !this.showAddForm;
        this.render(container, store.getState(), store, showToast);
      });
    }

    // Click any stock row in Holdings to inspect its open lots and trade against them
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

    // Select a specific lot to exit/sell
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
          showToast(`✅ 已從指定批次賣出 ${rec['出場股數']} 股 @ ${rec['出場價']}！`);
          this.selectedLotId = null;
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
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
      addTradeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const fd = new FormData(addTradeForm);
          const rec = StockCore.addTrade(store.getState(), Object.fromEntries(fd.entries()), store);
          showToast(`✅ 已新增買進 ${rec['代號']} (${rec['進場股數']} 股 @ ${rec['進場價']})`);
          this.showAddForm = false;
          this.showBuyForSelected = false;
          this.selectedSymbol = rec['代號'];
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
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
          showToast(`🎯 已更新觀察清單：${rec['代號']} 公允價 ${rec['公允價格']}`);
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
      });
    }

    const valForm = container.querySelector('#form-val-calc');
    if (valForm) {
      valForm.addEventListener('input', () => {
        const fd = new FormData(valForm);
        const sym = String(fd.get('symbol') || '').toUpperCase();
        this.valParams = {
          symbol: sym,
          isTwStock: sym.endsWith('.TW') || sym.endsWith('.TWO') || /^\d+$/.test(sym),
          baseRevenue: Number(fd.get('baseRevenue') || 0),
          growthRatePct: Number(fd.get('growthRatePct') || 0),
          netMarginPct: Number(fd.get('netMarginPct') || 0),
          shareCapital: Number(fd.get('shareCapital') || 1),
          targetPe: Number(fd.get('targetPe') || 15)
        };
        this.render(container, store.getState(), store, showToast);
      });
    }

    const saveValBtn = container.querySelector('#btn-save-val-to-watchlist');
    if (saveValBtn) {
      saveValBtn.addEventListener('click', () => {
        const symbol = saveValBtn.getAttribute('data-symbol');
        const fairPrice = Number(saveValBtn.getAttribute('data-price'));
        StockCore.upsertWatchlist(store.getState(), { symbol, fairPrice }, store);
        showToast(`🎯 已將推估好價格 ${fairPrice} 存入 ${symbol} 觀察清單！`);
        this.render(container, store.getState(), store, showToast);
      });
    }

    // Rebalance Tab Events
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
        showToast(`⚖️ 已更新【${type}】第一層目標比例為 ${targetPct || 0}%`);
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
        showToast(`⚡ 已依【${this.rebalancePool}】目前成本佔比一鍵帶入目標%`);
        this.render(container, store.getState(), store, showToast);
      });
    }

    const autoMktBtn = container.querySelector('#btn-autofill-pool-mkt');
    if (autoMktBtn) {
      autoMktBtn.addEventListener('click', () => {
        StockCore.autoFillPoolWeights(store.getState(), { poolType: this.rebalancePool, basis: 'market' }, store);
        showToast(`⚡ 已依【${this.rebalancePool}】目前現值佔比一鍵帶入目標%`);
        this.render(container, store.getState(), store, showToast);
      });
    }

    const clearPoolBtn = container.querySelector('#btn-clear-pool-weights');
    if (clearPoolBtn) {
      clearPoolBtn.addEventListener('click', () => {
        StockCore.autoFillPoolWeights(store.getState(), { poolType: this.rebalancePool, basis: 'clear' }, store);
        showToast(`🗑️ 已清空【${this.rebalancePool}】池內目標%`);
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
