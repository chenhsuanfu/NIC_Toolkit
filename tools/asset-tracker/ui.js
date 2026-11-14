import { AssetCore } from './core.js';

const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const cleaned = String(v).replace(/(?:NT\$|US\$|[$,%\s,])/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
};
const fmtInt = (n) => toNum(n, 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const fmtDec = (n, d = 2) => toNum(n, 0).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });

export class AssetTrackerUI {
  constructor() {
    this.activeTab = 'accounts'; // 'accounts' | 'logs' | 'debts'
    this.selectedMainCat = '交通費';
    this.selectedNature = '支出';
    this.filterAttr = 'ALL';
  }

  render(container, state, store, showToast) {
    const summary = AssetCore.getSummary(state);
    const opts = AssetCore.getConfigOptions(state);

    if (!opts.expenseMainCategories.includes(this.selectedMainCat)) {
      this.selectedMainCat = opts.expenseMainCategories[0] || '餐費';
    }
    const subCats = opts.expenseSubCategories[this.selectedMainCat] || [];
    const ledgerCats = opts.ledgerCategories[this.selectedNature] || ['其他'];
    const today = new Date().toISOString().slice(0, 10);

    container.innerHTML = `
      <!-- KPI Row -->
      <div class="grid-kpi">
        <div class="card">
          <div class="kpi-label">
            <span>金融資金總額 (TWD)</span>
            <span class="pill pill-blue">${summary.accountCount} 個帳戶</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(summary.totalFinancialAssetsTwd)}</div>
          <div class="kpi-sub mask-amount">
            目標 $${fmtInt(summary.targetTotalAssetTwd)} (${(summary.goalProgress * 100).toFixed(1)}%)
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${Math.min(100, summary.goalProgress * 100)}%;"></div>
          </div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>流動儲蓄 + 保障資金</span>
            <span class="pill pill-emerald">現金與防禦</span>
          </div>
          <div class="kpi-value mask-amount text-emerald">$${fmtInt(summary.liquidSavingsTwd + summary.protectionTwd)}</div>
          <div class="kpi-sub mask-amount">儲蓄 $${fmtInt(summary.liquidSavingsTwd)} ｜ 保障 $${fmtInt(summary.protectionTwd)}</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>台美股帳戶總額</span>
            <span class="pill pill-purple">投資部位</span>
          </div>
          <div class="kpi-value mask-amount text-blue">$${fmtInt(summary.twStockTwd + summary.usStockTwd)}</div>
          <div class="kpi-sub mask-amount">台股 $${fmtInt(summary.twStockTwd)} ｜ 海外 $${fmtInt(summary.usStockTwd)}</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>總淨值 (含不動產扣負債)</span>
            <span class="pill pill-amber">負債 $${fmtInt(summary.totalDebtTwd)}</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(summary.netWorthTwd)}</div>
          <div class="kpi-sub mask-amount">總資產 $${fmtInt(summary.grossAssetsWithRealEstateTwd)} ｜ 月還款 $${fmtInt(summary.monthlyDebtPaymentTwd)}</div>
        </div>
      </div>

      <!-- Dual Quick Entry Forms (Cascading Dropdowns from 設定 tab) -->
      <div class="grid-2">
        <!-- Form 1: Daily Expense (開銷明細) -->
        <div class="card" style="border-color: rgba(56, 189, 248, 0.35);">
          <div class="card-header">
            <div class="card-title">🧾 快速記開銷（寫入「開銷明細」・主子類別自動連動）</div>
          </div>
          <form id="form-add-expense" style="display:flex; flex-direction:column; gap:12px;">
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label">消費大類</label>
                <select class="form-control" name="category" id="select-exp-main">
                  ${opts.expenseMainCategories.map((c) => `<option value="${c}" ${c === this.selectedMainCat ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">消費子類別 (自動連動)</label>
                <select class="form-control" name="subCategory" id="select-exp-sub">
                  <option value="">(無子類別 / 一般)</option>
                  ${subCats.map((sc) => `<option value="${sc}">${sc}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">金額 (TWD)</label>
                <input class="form-control" type="number" step="any" name="amount" placeholder="例如 1200" required />
              </div>
              <div class="form-group">
                <label class="form-label">消費名目</label>
                <input class="form-control" name="title" placeholder="例如 餐費 / TPASS / 電費" required />
              </div>
              <div class="form-group">
                <label class="form-label">固定 / 變動</label>
                <select class="form-control" name="fixedVar">
                  ${opts.fixedVar.map((fv) => `<option value="${fv}" ${fv === '變動' ? 'selected' : ''}>${fv}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">負擔人</label>
                <select class="form-control" name="payer">
                  ${opts.payers.map((p) => `<option value="${p}">${p}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">日期</label>
                <input class="form-control" type="date" name="date" value="${today}" />
              </div>
            </div>
            <button type="submit" class="btn btn-primary" style="align-self:flex-start;">✓ 立即記一筆開銷</button>
          </form>
        </div>

        <!-- Form 2: Account Ledger Log (log_V2) -->
        <div class="card" style="border-color: rgba(16, 185, 129, 0.35);">
          <div class="card-header">
            <div class="card-title">🏦 帳戶收支 / 轉帳 / 對帳校正（寫入「log_V2」）</div>
          </div>
          <form id="form-add-log" style="display:flex; flex-direction:column; gap:12px;">
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label">性質</label>
                <select class="form-control" name="nature" id="select-log-nature">
                  ${opts.natures.map((n) => `<option value="${n}" ${n === this.selectedNature ? 'selected' : ''}>${n}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">類別 (依性質連動)</label>
                <select class="form-control" name="category">
                  ${ledgerCats.map((c) => `<option value="${c}">${c}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">目標帳戶</label>
                <select class="form-control" name="account">
                  ${opts.accountNames.map((a) => `<option value="${a}">${a}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">幣別</label>
                <select class="form-control" name="currency">
                  ${opts.currencies.map((cur) => `<option value="${cur}">${cur}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">金額</label>
                <input class="form-control" type="number" step="any" name="amount" placeholder="輸入金額" required />
              </div>
              <div class="form-group">
                <label class="form-label">日期</label>
                <input class="form-control" type="date" name="date" value="${today}" />
              </div>
              <div class="form-group" style="grid-column: span 2;">
                <label class="form-label">備註</label>
                <input class="form-control" name="note" placeholder="選填備註 (如 薪資入帳 / 對帳校正)" />
              </div>
            </div>
            <button type="submit" class="btn btn-emerald" style="align-self:flex-start;">✓ 寫入帳戶流水</button>
          </form>
        </div>
      </div>

      <!-- Sub-tabs -->
      <div class="sub-tabs">
        <button class="sub-tab ${this.activeTab === 'accounts' ? 'active' : ''}" data-tab="accounts">🏦 銀行與投資帳戶 (${summary.accountCount})</button>
        <button class="sub-tab ${this.activeTab === 'logs' ? 'active' : ''}" data-tab="logs">📋 近期開銷 & 帳戶流水</button>
        <button class="sub-tab ${this.activeTab === 'debts' ? 'active' : ''}" data-tab="debts">🏠 債務處置表 & 薪資軌跡</button>
      </div>

      ${this.activeTab === 'accounts' ? this._renderAccountsTab(state, opts) : ''}
      ${this.activeTab === 'logs' ? this._renderLogsTab(state) : ''}
      ${this.activeTab === 'debts' ? this._renderDebtsTab(state) : ''}
    `;

    this._bindEvents(container, state, store, showToast);
  }

  _renderAccountsTab(state, opts) {
    const accounts = (state?.asset?.accounts || []).filter((a) => {
      if (!a['帳戶名']) return false;
      if (this.filterAttr !== 'ALL' && a['屬性'] !== this.filterAttr) return false;
      return true;
    });

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">🏦 各帳戶即時餘額一覽</div>
          <div style="display:flex; gap:6px;">
            ${['ALL', '儲蓄', '保障', '股票', '保險'].map((attr) => `
              <button class="btn ${this.filterAttr === attr ? 'btn-primary' : 'btn-ghost'} btn-sm" data-attr="${attr}">
                ${attr === 'ALL' ? '全部' : attr}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>屬性</th>
                <th>帳戶名稱</th>
                <th>幣別</th>
                <th>原幣餘額</th>
                <th>折合台幣 (TWD)</th>
              </tr>
            </thead>
            <tbody>
              ${accounts.map((acc) => {
                const cur = acc['幣別'] || 'TWD';
                const bal = toNum(acc['目前餘額(自動)'], 0);
                const rate = opts.fxMap[cur] || 1;
                const twd = Math.round(bal * rate);
                const badge = acc['屬性'] === '儲蓄' ? 'pill-emerald' : acc['屬性'] === '股票' ? 'pill-blue' : 'pill-amber';
                return `
                  <tr>
                    <td><span class="pill ${badge}">${acc['屬性'] || '-'}</span></td>
                    <td style="font-weight:700;">${acc['帳戶名']}</td>
                    <td class="font-mono">${cur}</td>
                    <td class="font-mono mask-amount">${cur === 'USD' ? fmtDec(bal) : fmtInt(bal)}</td>
                    <td class="font-mono mask-amount" style="font-weight:700;">$${fmtInt(twd)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderLogsTab(state) {
    const expenses = (state?.asset?.recentExpenses || []).slice().reverse().slice(0, 30);
    const logs = (state?.asset?.recentLogs || []).slice().reverse().slice(0, 30);

    return `
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div class="card-title">🧾 近期開銷明細 (最新 30 筆)</div>
          </div>
          <div class="table-wrap" style="max-height:380px; overflow-y:auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>大類 / 子類</th>
                  <th>名目</th>
                  <th>金額</th>
                  <th>負擔人</th>
                </tr>
              </thead>
              <tbody>
                ${expenses.map((e) => `
                  <tr>
                    <td class="font-mono" style="font-size:12px;">${e['日期'] || '-'}</td>
                    <td>
                      <span class="pill pill-blue">${e['類別'] || '-'}</span>
                      ${e['子類別'] ? `<span class="text-muted" style="font-size:11px;"> / ${e['子類別']}</span>` : ''}
                    </td>
                    <td style="font-weight:600;">${e['名目'] || '-'}</td>
                    <td class="font-mono mask-amount text-rose" style="font-weight:700;">$${fmtInt(e['金額'])}</td>
                    <td class="text-muted">${e['負擔人'] || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">📒 近期帳戶流水 log_V2 (最新 30 筆)</div>
          </div>
          <div class="table-wrap" style="max-height:380px; overflow-y:auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>性質</th>
                  <th>類別</th>
                  <th>帳戶</th>
                  <th>金額</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                ${logs.map((l) => {
                  const nat = l['性質'] || '';
                  const cls = nat === '收入' ? 'pill-emerald' : nat === '支出' ? 'pill-rose' : 'pill-amber';
                  return `
                    <tr>
                      <td class="font-mono" style="font-size:12px;">${l['日期'] || '-'}</td>
                      <td><span class="pill ${cls}">${nat}</span></td>
                      <td>${l['類別'] || '-'}</td>
                      <td style="font-weight:600;">${l['帳戶'] || '-'}</td>
                      <td class="font-mono mask-amount">${l['幣別'] || 'TWD'} ${fmtInt(l['金額'])}</td>
                      <td class="text-muted">${l['備註'] || ''}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  _renderDebtsTab(state) {
    const debts = state?.asset?.debts || [];
    const salaries = state?.asset?.salaryHistory || [];

    return `
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div class="card-title">🏠 債務處置表 (房貸 / 信貸追蹤)</div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>債務名稱</th>
                  <th>性質</th>
                  <th>利率%</th>
                  <th>目前餘額</th>
                  <th>每月還款</th>
                  <th>剩餘期數</th>
                </tr>
              </thead>
              <tbody>
                ${debts.map((d) => `
                  <tr>
                    <td style="font-weight:700;">${d['債務名稱']}</td>
                    <td><span class="pill pill-blue">${d['性質'] || '一般'}</span></td>
                    <td class="font-mono">${d['利率%']}%</td>
                    <td class="font-mono mask-amount text-amber" style="font-weight:700;">$${fmtInt(d['目前餘額(自動)'])}</td>
                    <td class="font-mono mask-amount">$${fmtInt(d['每月還款'])}</td>
                    <td class="font-mono">${fmtInt(d['剩餘期數(自動)'])} 期</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">📈 歷年年薪成長軌跡</div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>年度</th>
                  <th>實領年薪總計 (TWD)</th>
                  <th>月均實領</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                ${salaries.map((s) => {
                  const annual = toNum(s['年薪'], 0);
                  return `
                    <tr>
                      <td class="font-mono" style="font-weight:700;">${fmtInt(s['年'])} 年</td>
                      <td class="font-mono mask-amount text-emerald" style="font-weight:700;">$${fmtInt(annual)}</td>
                      <td class="font-mono mask-amount">$${fmtInt(annual / 12)}</td>
                      <td class="text-muted">${s['備註'] || ''}</td>
                    </tr>
                  `;
                }).join('')}
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

    container.querySelectorAll('[data-attr]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.filterAttr = btn.getAttribute('data-attr');
        this.render(container, store.getState(), store, showToast);
      });
    });

    const expMainSelect = container.querySelector('#select-exp-main');
    if (expMainSelect) {
      expMainSelect.addEventListener('change', (e) => {
        this.selectedMainCat = e.target.value;
        this.render(container, store.getState(), store, showToast);
      });
    }

    const logNatureSelect = container.querySelector('#select-log-nature');
    if (logNatureSelect) {
      logNatureSelect.addEventListener('change', (e) => {
        this.selectedNature = e.target.value;
        this.render(container, store.getState(), store, showToast);
      });
    }

    const expForm = container.querySelector('#form-add-expense');
    if (expForm) {
      expForm.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const fd = new FormData(expForm);
          const rec = AssetCore.addExpense(store.getState(), Object.fromEntries(fd.entries()), store);
          showToast(`🧾 已記開銷：${rec['類別']} - ${rec['名目']} ($${rec['金額']})`);
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
      });
    }

    const logForm = container.querySelector('#form-add-log');
    if (logForm) {
      logForm.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const fd = new FormData(logForm);
          const rec = AssetCore.addLedgerLog(store.getState(), Object.fromEntries(fd.entries()), store);
          showToast(`🏦 已寫入帳戶流水：${rec['帳戶']} [${rec['性質']}] ${rec['幣別']} ${rec['金額']}`);
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
      });
    }
  }
}
