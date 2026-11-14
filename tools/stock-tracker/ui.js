import { StockCore } from './core.js';

const fmtInt = (n) => Number(n || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const fmtDec = (n, d = 2) => Number(n || 0).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => `${(Number(n || 0) * 100).toFixed(2)}%`;

export class StockTrackerUI {
  constructor() {
    this.activeTab = 'holdings'; // 'holdings' | 'watchlist' | 'history'
    this.filterMarket = 'ALL';
    this.filterType = 'ALL';
    this.searchQuery = '';
    this.showAddForm = false;
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
          <button class="sub-tab ${this.activeTab === 'watchlist' ? 'active' : ''}" data-tab="watchlist">🎯 觀察清單 & 好股價估值</button>
          <button class="sub-tab ${this.activeTab === 'history' ? 'active' : ''}" data-tab="history">🛡️ 風控配置 & 進出場紀錄</button>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-primary" id="btn-toggle-trade-form">
            ${this.showAddForm ? '✕ 收起表單' : '＋ 新增買進 / 出場'}
          </button>
        </div>
      </div>

      <!-- Quick Trade Form (Optimistic 0.01s Entry) -->
      ${this.showAddForm ? this._renderTradeForm(options, state) : ''}

      <!-- Tab Content -->
      <div id="stock-tab-body">
        ${this.activeTab === 'holdings' ? this._renderHoldingsTab(holdings, options) : ''}
        ${this.activeTab === 'watchlist' ? this._renderWatchlistTab(state, options) : ''}
        ${this.activeTab === 'history' ? this._renderHistoryTab(state, summary) : ''}
      </div>
    `;

    this._bindEvents(container, state, store, showToast);
  }

  _renderTradeForm(options, state) {
    const today = new Date().toISOString().slice(0, 10);
    const recentTrades = (state?.stock?.recentTrades || []).slice().reverse().slice(0, 25);

    return `
      <div class="card" style="margin-bottom:20px; border-color: rgba(56,189,248,0.4);">
        <div class="card-header">
          <div class="card-title">⚡ 快速新增股票交易（0.01 秒本機樂觀寫入，背景同步 N_BD_C）</div>
        </div>
        <div class="grid-2" style="margin-bottom:0;">
          <!-- Buy Form -->
          <form id="form-add-trade" style="display:flex; flex-direction:column; gap:12px;">
            <div style="font-weight:700; color:var(--accent-blue); font-size:13px;">📥 新增買進（寫入「交易明細」）</div>
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label">股票代號</label>
                <input class="form-control" name="symbol" placeholder="如 NVDA 或 2330.TW" required />
              </div>
              <div class="form-group">
                <label class="form-label">市場</label>
                <select class="form-control" name="market">
                  ${options.markets.map((m) => `<option value="${m}">${m}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">策略類型</label>
                <select class="form-control" name="type">
                  ${options.types.map((t) => `<option value="${t}" ${t === '進攻型' ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">券商代號</label>
                <select class="form-control" name="broker">
                  ${options.brokers.map((b) => `<option value="${b}">${b}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">進場單價 (原幣)</label>
                <input class="form-control" type="number" step="any" name="price" placeholder="0.00" required />
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
            <button type="submit" class="btn btn-primary" style="align-self:flex-start;">✓ 確認新增買進</button>
          </form>

          <!-- Sell / Exit Form -->
          <form id="form-add-exit" style="display:flex; flex-direction:column; gap:12px; border-left:1px solid var(--border-color); padding-left:16px;">
            <div style="font-weight:700; color:var(--accent-emerald); font-size:13px;">📤 紀錄賣出出場（寫入「出場明細」）</div>
            <div class="form-grid">
              <div class="form-group" style="grid-column: span 2;">
                <label class="form-label">關聯進場交易 (交易id)</label>
                <select class="form-control" name="tradeId" required>
                  <option value="">-- 選擇近期買進紀錄 --</option>
                  ${recentTrades.map((t) => `<option value="${t.id}">${t['代號']} | 進場:${t['進場價']} (${t['進場股數']}股) [${t['進場日'] || ''}]</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">出場單價</label>
                <input class="form-control" type="number" step="any" name="exitPrice" placeholder="0.00" required />
              </div>
              <div class="form-group">
                <label class="form-label">出場股數</label>
                <input class="form-control" type="number" step="any" name="exitShares" placeholder="1" required />
              </div>
              <div class="form-group">
                <label class="form-label">出場日</label>
                <input class="form-control" type="date" name="date" value="${today}" />
              </div>
              <div class="form-group">
                <label class="form-label">出場備註</label>
                <input class="form-control" name="note" placeholder="停利 / 停損說明" />
              </div>
            </div>
            <button type="submit" class="btn btn-emerald" style="align-self:flex-start;">✓ 確認紀錄出場</button>
          </form>
        </div>
      </div>
    `;
  }

  _renderHoldingsTab(holdings, options) {
    return `
      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;">
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
          <div style="display:flex; gap:8px;">
            <a href="https://mvp-qas.com/" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="text-decoration:none;">🔗 開啟 MVP 量化</a>
            <a href="https://goodstockprice.com/" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="text-decoration:none;">🔗 開啟 好股價</a>
          </div>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>代號</th>
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
                const pnl = Number(r['未實現(TWD)'] || 0);
                const roi = Number(r['報酬率'] || 0);
                const cls = pnl >= 0 ? 'text-emerald' : 'text-rose';
                const sign = pnl >= 0 ? '+' : '';
                const typeBadge = r['類型'] === '防禦型' ? 'pill-blue' : r['類型'] === '進攻型' ? 'pill-emerald' : 'pill-amber';
                return `
                  <tr>
                    <td>
                      <div style="font-weight:700; font-family:var(--font-mono);">${r['代號']}</div>
                      <span class="pill" style="font-size:10px; background:rgba(255,255,255,0.06);">${r['市場']}</span>
                    </td>
                    <td><span class="pill ${typeBadge}">${r['類型'] || '-'}</span></td>
                    <td class="font-mono">${fmtDec(r['剩餘股數'], 0)}</td>
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
                  const fair = Number(w['公允價格'] || 0);
                  const cur = Number(w['採用價'] || w['自動價'] || 0);
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
    const trades = (state?.stock?.recentTrades || []).slice().reverse().slice(0, 30);

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
            <div class="card-title">🕒 近期進場交易明細 (最新 30 筆)</div>
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
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
      });
    }

    const addExitForm = container.querySelector('#form-add-exit');
    if (addExitForm) {
      addExitForm.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const fd = new FormData(addExitForm);
          const rec = StockCore.addExit(store.getState(), Object.fromEntries(fd.entries()), store);
          showToast(`✅ 已紀錄出場 (${rec['出場股數']} 股 @ ${rec['出場價']})`);
          this.showAddForm = false;
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
  }
}
