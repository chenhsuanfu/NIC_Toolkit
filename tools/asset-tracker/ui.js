import { AssetCore, FS_SHEET_URL } from './core.js';

const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const cleaned = String(v).replace(/(?:NT\$|US\$|[$,%\s,])/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
};
const fmtInt = (n) => toNum(n, 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const fmtDec = (n, d = 2) => toNum(n, 0).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
const accName = (a) => a['帳戶名'] || a['帳戶名稱'] || '';
const accBal = (a) => toNum(a['目前餘額(自動)'] ?? a['原幣金額'], 0);

const FIXED_SIM_KEY = 'nic_asset_fixed_sim_v1';
const DEFAULT_FIXED_SIM = {
  monthlyIncome: 89900,
  items: [
    { id: 'f1', group: '必要成本', name: '儲蓄', type: '', p1: 5000, p2: 5000, enabled: true },
    { id: 'f2', group: '必要成本', name: '手機費', type: '通信', p1: 599, p2: 399, enabled: true },
    { id: 'f3', group: '必要成本', name: '保險', type: '保險', p1: 2701, p2: 0, enabled: true },
    { id: 'f4', group: '必要成本', name: '網路費', type: '通信', p1: 157, p2: 157, enabled: true },
    { id: 'f5', group: '必要成本', name: '機油', type: '交通', p1: 400, p2: 0, enabled: true },
    { id: 'f6', group: '必要成本', name: '機保養', type: '交通', p1: 300, p2: 0, enabled: true },
    { id: 'f7', group: '必要成本', name: '車險_5203', type: '交通', p1: 2741, p2: 0, enabled: true },
    { id: 'f8', group: '必要成本', name: '房貸', type: '房貸', p1: 11775, p2: 11775, enabled: true },
    { id: 'f9', group: '必要成本', name: '信貸', type: '信貸', p1: 10012, p2: 10012, enabled: true },
    { id: 'f10', group: '必要成本', name: '管理費', type: '房貸', p1: 1499, p2: 1499, enabled: true },
    { id: 'f11', group: '必要成本', name: '水費', type: '水', p1: 168, p2: 0, enabled: true },
    { id: 'f12', group: '必要成本', name: '電費', type: '電', p1: 648, p2: 0, enabled: true },
    { id: 'f13', group: '必要成本', name: '房屋稅', type: '房貸', p1: 300, p2: 300, enabled: true },
    { id: 'f14', group: '必要成本', name: 'TPASS', type: '交通', p1: 999, p2: 0, enabled: true },
    { id: 'f15', group: '必要成本', name: '餐費', type: '餐費', p1: 18000, p2: 0, enabled: true },
    { id: 'f16', group: '必要成本', name: '機車保管_大橋', type: '交通', p1: 400, p2: 0, enabled: true },
    { id: 'f17', group: '可調成本', name: '一寸鮮_青花椰苗', type: '其他', p1: 1504, p2: 0, enabled: true },
    { id: 'f18', group: '可調成本', name: '益生菌', type: '其他', p1: 0, p2: 0, enabled: true }
  ]
};

export class AssetTrackerUI {
  constructor() {
    this.activeTab = 'accounts'; // accounts | analytics | salary | logs | debts
    this.activeForm = null; // null | expense | account_log | salary
    this.selectedMainCat = '';
    this.selectedNature = '支出';
    this.filterAttr = 'ALL';
    this.reconcilingKey = null; // `${name}|${currency}`
    this.salaryYearFilter = 'ALL';
    this.salaryTypeFilter = 'ALL';
    this.expenseAnalysisYear = '';
    this.efMode = 'fixed'; // fixed | expense | manual
    this.efManualMonthly = 60000;
    this.fixedSim = this._loadFixedSim();
    try {
      const savedEf = JSON.parse(localStorage.getItem('nic_asset_ef_cfg_v1') || 'null');
      if (savedEf && ['fixed', 'expense', 'manual'].includes(savedEf.mode)) this.efMode = savedEf.mode;
      if (savedEf && Number(savedEf.manualMonthly) > 0) this.efManualMonthly = Number(savedEf.manualMonthly);
    } catch (_) {}
    this.sortState = {
      accounts: { col: 'twd', dir: 'desc' },
      salary: { col: 'date', dir: 'desc' },
      expenses: { col: 'date', dir: 'desc' },
      logs: { col: 'date', dir: 'desc' },
      debts: { col: 'remain', dir: 'desc' }
    };
  }

  _toggleSort(key, col, def = 'desc') {
    const cur = this.sortState[key] || { col, dir: def };
    if (cur.col === col) cur.dir = cur.dir === 'desc' ? 'asc' : 'desc';
    else { cur.col = col; cur.dir = def; }
    this.sortState[key] = cur;
  }

  _th(key, col, label, def = 'desc', right = false) {
    const cur = this.sortState[key] || {};
    const act = cur.col === col;
    const arrow = act ? (cur.dir === 'desc' ? '▼' : '▲') : '↕';
    return `<th class="sortable ${act ? 'sort-active' : ''}" data-sort-table="${key}" data-sort-col="${col}" data-sort-default="${def}" style="${right ? 'text-align:right;' : ''}">${label}<span class="sort-indicator">${arrow}</span></th>`;
  }

  _sorter(key, getters) {
    const cfg = this.sortState[key];
    const mul = cfg.dir === 'asc' ? 1 : -1;
    const g = getters[cfg.col] || Object.values(getters)[0];
    return (a, b) => {
      const va = g(a); const vb = g(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
      return String(va).localeCompare(String(vb)) * mul;
    };
  }

  render(container, state, store, showToast) {
    const sum = AssetCore.getSummary(state);
    const opts = AssetCore.getConfigOptions(state);
    if (!opts.expenseMainCategories.includes(this.selectedMainCat)) {
      this.selectedMainCat = opts.expenseMainCategories[0] || '餐費';
    }
    const today = new Date().toISOString().slice(0, 10);
    const fsData = AssetCore.getFsSharedAssets(state);
    const ef = AssetCore.getEmergencyFundMetrics(state, { mode: this.efMode, manualMonthly: this.efManualMonthly });
    const curSavings = AssetCore.getCurrentMonthSavings(state);
    const otherTwd = Math.max(0, sum.totalFinancialAssetsTwd - sum.liquidSavingsTwd - sum.protectionTwd - sum.twStockTwd - sum.usStockTwd);

    container.innerHTML = `
      <div class="grid-kpi">
        <div class="card">
          <div class="kpi-label"><span>金融資金總額</span><span class="pill">${sum.accountCount} 帳戶</span></div>
          <div class="kpi-value mask-amount">$${fmtInt(sum.totalFinancialAssetsTwd)}</div>
          <div class="kpi-sub mask-amount">目標 $${fmtInt(sum.targetTotalAssetTwd)} (${(sum.goalProgress * 100).toFixed(1)}%)</div>
          <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, sum.goalProgress * 100)}%;"></div></div>
        </div>
        <div class="card">
          <div class="kpi-label"><span>總淨值 (含不動產扣負債)</span></div>
          <div class="kpi-value mask-amount">$${fmtInt(sum.netWorthTwd)}</div>
          <div class="kpi-sub mask-amount">總資產 $${fmtInt(sum.grossAssetsWithRealEstateTwd)} ｜ 負債 $${fmtInt(sum.totalDebtTwd)}</div>
        </div>
        <div class="card">
          <div class="kpi-label" style="flex-direction:column; align-items:flex-start; gap:6px;">
            <span>緊急預備金 (保障資金)</span>
            <div style="display:flex; flex-wrap:wrap; gap:4px;">
              <button type="button" class="btn btn-sm ${this.efMode === 'fixed' ? 'btn-primary' : 'btn-ghost'}" data-ef-mode="fixed" style="padding:2px 7px; font-size:11px;">固定開銷</button>
              <button type="button" class="btn btn-sm ${this.efMode === 'expense' ? 'btn-primary' : 'btn-ghost'}" data-ef-mode="expense" style="padding:2px 7px; font-size:11px;">月支出</button>
              <button type="button" class="btn btn-sm ${this.efMode === 'manual' ? 'btn-primary' : 'btn-ghost'}" data-ef-mode="manual" style="padding:2px 7px; font-size:11px;">手動</button>
            </div>
          </div>
          <div class="kpi-value">${ef.months > 0 ? `${ef.months} 個月${ef.isPartialYear ? ' *' : ''}` : '--'}</div>
          ${this.efMode === 'manual' ? `
            <div style="display:flex; align-items:center; gap:6px; margin-top:6px;">
              <span class="text-muted" style="font-size:11.5px;">月基準 $</span>
              <input id="input-ef-manual" class="form-control font-mono" type="number" step="1000" min="1" value="${this.efManualMonthly}" style="width:110px; padding:3px 6px; font-size:12px;" />
              <button type="button" id="btn-ef-manual-apply" class="btn btn-primary btn-sm" style="padding:3px 8px; font-size:11px;">套用</button>
            </div>
          ` : `
            <div class="kpi-sub mask-amount">保障 $${fmtInt(ef.protectionTwd)} ÷ 月均 $${fmtInt(ef.monthlyBase)} (${ef.sampleMonthCount} 個完整月)</div>
          `}
          ${ef.isPartialYear ? `<div style="margin-top:6px; font-size:11px; color:#f59e0b; line-height:1.4;">* 目前只採 ${ef.sampleMonthCount} 個完整月平均（未滿 12 個月），若年繳項目尚未計入，預備金月數可能偏樂觀。</div>` : ''}
        </div>
        <div class="card">
          <div class="kpi-label"><span>本月儲蓄 (${curSavings.month})</span></div>
          <div class="kpi-value mask-amount ${curSavings.net >= 0 ? 'text-emerald' : 'text-rose'}">${curSavings.net >= 0 ? '+' : ''}${fmtInt(curSavings.net)}</div>
          <div class="kpi-sub mask-amount">收 $${fmtInt(curSavings.income)} ｜ 支 $${fmtInt(curSavings.expense)}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="margin-bottom:10px;">
          <div class="card-title">資產組成</div>
          <button type="button" id="btn-record-snapshot" class="btn btn-primary btn-sm">📸 記錄資產快照</button>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(135px, 1fr)); gap:8px;">
          <div style="padding:10px 12px; border-radius:10px; background:var(--bg-elevated, rgba(255,255,255,0.03)); border-left:3px solid #a855f7;">
            <div class="text-muted" style="font-size:11.5px;">流動資金</div>
            <div class="font-mono mask-amount" style="font-size:15px; font-weight:700; margin-top:2px;">$${fmtInt(sum.liquidSavingsTwd)}</div>
          </div>
          <div style="padding:10px 12px; border-radius:10px; background:var(--bg-elevated, rgba(255,255,255,0.03)); border-left:3px solid #10b981;">
            <div class="text-muted" style="font-size:11.5px;">保障資金</div>
            <div class="font-mono mask-amount" style="font-size:15px; font-weight:700; margin-top:2px;">$${fmtInt(sum.protectionTwd)}</div>
          </div>
          <div style="padding:10px 12px; border-radius:10px; background:var(--bg-elevated, rgba(255,255,255,0.03)); border-left:3px solid #f59e0b;">
            <div class="text-muted" style="font-size:11.5px;">國內股票</div>
            <div class="font-mono mask-amount" style="font-size:15px; font-weight:700; margin-top:2px;">$${fmtInt(sum.twStockTwd)}</div>
          </div>
          <div style="padding:10px 12px; border-radius:10px; background:var(--bg-elevated, rgba(255,255,255,0.03)); border-left:3px solid #eab308;">
            <div class="text-muted" style="font-size:11.5px;">海外股票</div>
            <div class="font-mono mask-amount" style="font-size:15px; font-weight:700; margin-top:2px;">$${fmtInt(sum.usStockTwd)}</div>
          </div>
          <div style="padding:10px 12px; border-radius:10px; background:var(--bg-elevated, rgba(255,255,255,0.03)); border-left:3px solid #64748b;">
            <div class="text-muted" style="font-size:11.5px;">其他</div>
            <div class="font-mono mask-amount" style="font-size:15px; font-weight:700; margin-top:2px;">$${fmtInt(otherTwd)}</div>
          </div>
          <div data-tab="fs_shared" style="cursor:pointer; padding:10px 12px; border-radius:10px; background:var(--bg-elevated, rgba(255,255,255,0.03)); border-left:3px solid #38bdf8;" title="點擊查看 FS共同資產明細">
            <div class="text-muted" style="font-size:11.5px;">FS共同資產 ↗</div>
            <div class="font-mono mask-amount" style="font-size:15px; font-weight:700; margin-top:2px;">$${fmtInt(fsData.totalCombinedTwd)}</div>
          </div>
        </div>
      </div>

      <div class="action-toolbar">
        <div class="action-toolbar-group">
          <button class="btn ${this.activeForm === 'expense' ? 'btn-primary' : 'btn-ghost'}" data-toggle-form="expense">${this.activeForm === 'expense' ? '✕ 收起' : '＋ 記開銷'}</button>
          <button class="btn ${this.activeForm === 'account_log' ? 'btn-primary' : 'btn-ghost'}" data-toggle-form="account_log">${this.activeForm === 'account_log' ? '✕ 收起' : '＋ 帳戶收支/轉帳'}</button>
          <button class="btn ${this.activeForm === 'salary' ? 'btn-primary' : 'btn-ghost'}" data-toggle-form="salary">${this.activeForm === 'salary' ? '✕ 收起' : '＋ 記薪資'}</button>
        </div>
        <a class="btn btn-ghost btn-sm" href="${FS_SHEET_URL}" target="_blank" rel="noopener">↗ 開啟 F&S 試算表</a>
      </div>

      ${this.activeForm === 'expense' ? this._renderExpenseForm(opts, today) : ''}
      ${this.activeForm === 'account_log' ? this._renderLogForm(opts, today) : ''}
      ${this.activeForm === 'salary' ? this._renderSalaryForm(today) : ''}

      <div class="sub-tabs">
        <button class="sub-tab ${this.activeTab === 'accounts' ? 'active' : ''}" data-tab="accounts">帳戶與對帳</button>
        <button class="sub-tab ${this.activeTab === 'monthly' ? 'active' : ''}" data-tab="monthly">每月收支</button>
        <button class="sub-tab ${this.activeTab === 'analytics' ? 'active' : ''}" data-tab="analytics">分析圖</button>
        <button class="sub-tab ${this.activeTab === 'fs_shared' ? 'active' : ''}" data-tab="fs_shared">FS共同資產</button>
        <button class="sub-tab ${this.activeTab === 'fixed_sim' ? 'active' : ''}" data-tab="fixed_sim">固定開銷模擬</button>
        <button class="sub-tab ${this.activeTab === 'salary' ? 'active' : ''}" data-tab="salary">薪資 (N_薪資)</button>
        <button class="sub-tab ${this.activeTab === 'logs' ? 'active' : ''}" data-tab="logs">開銷與流水</button>
        <button class="sub-tab ${this.activeTab === 'debts' ? 'active' : ''}" data-tab="debts">負債</button>
      </div>

      ${this.activeTab === 'accounts' ? this._renderAccountsTab(state, opts, sum) : ''}
      ${this.activeTab === 'monthly' ? this._renderMonthlyTab(state) : ''}
      ${this.activeTab === 'analytics' ? this._renderAnalyticsTab(state) : ''}
      ${this.activeTab === 'fs_shared' ? this._renderFsSharedTab(state) : ''}
      ${this.activeTab === 'fixed_sim' ? this._renderFixedSimTab() : ''}
      ${this.activeTab === 'salary' ? this._renderSalaryTab(state) : ''}
      ${this.activeTab === 'logs' ? this._renderLogsTab(state) : ''}
      ${this.activeTab === 'debts' ? this._renderDebtsTab(state) : ''}
    `;

    this._bindEvents(container, state, store, showToast);
  }

  // ---------------- Forms ----------------
  _renderExpenseForm(opts, today) {
    const subCats = opts.expenseSubCategories[this.selectedMainCat] || [];
    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header"><div class="card-title">記開銷（寫入「開銷明細」）</div></div>
        <form id="form-add-expense">
          <div class="form-grid">
            <div class="form-group"><label class="form-label">消費大類</label>
              <select class="form-control" name="category" id="select-exp-main">
                ${opts.expenseMainCategories.map((c) => `<option value="${c}" ${c === this.selectedMainCat ? 'selected' : ''}>${c}</option>`).join('')}
              </select></div>
            <div class="form-group"><label class="form-label">子類別</label>
              <select class="form-control" name="subCategory">
                <option value="">(一般)</option>
                ${subCats.map((s) => `<option value="${s}">${s}</option>`).join('')}
              </select></div>
            <div class="form-group"><label class="form-label">金額 (TWD)</label>
              <input class="form-control font-mono" type="number" step="any" name="amount" inputmode="decimal" required /></div>
            <div class="form-group"><label class="form-label">名目</label>
              <input class="form-control" name="title" placeholder="例如 午餐 / TPASS" /></div>
            <div class="form-group"><label class="form-label">固定 / 變動</label>
              <select class="form-control" name="fixedVar">
                ${opts.fixedVar.map((f) => `<option value="${f}" ${f === '變動' ? 'selected' : ''}>${f}</option>`).join('')}
              </select></div>
            <div class="form-group"><label class="form-label">負擔人</label>
              <select class="form-control" name="payer">${opts.payers.map((p) => `<option value="${p}">${p}</option>`).join('')}</select></div>
            <div class="form-group"><label class="form-label">日期</label>
              <input class="form-control" type="date" name="date" value="${today}" /></div>
          </div>
          <div style="margin-top:12px; text-align:right;"><button type="submit" class="btn btn-primary">儲存開銷</button></div>
        </form>
      </div>`;
  }

  _renderLogForm(opts, today) {
    const cats = opts.ledgerCategories[this.selectedNature] || [];
    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">帳戶收支 / 轉帳（寫入「log_V2」）</div>
          <span class="text-muted" style="font-size:12px;">對帳校正請直接在「帳戶與對帳」列表輸入實際餘額</span>
        </div>
        <form id="form-add-log">
          <div class="form-grid">
            <div class="form-group"><label class="form-label">性質</label>
              <select class="form-control" name="nature" id="select-log-nature">
                ${opts.natures.filter((n) => n !== '校正').map((n) => `<option value="${n}" ${n === this.selectedNature ? 'selected' : ''}>${n}</option>`).join('')}
              </select></div>
            <div class="form-group"><label class="form-label">類別</label>
              <select class="form-control" name="category">${(cats.length ? cats : ['其他']).map((c) => `<option value="${c}">${c}</option>`).join('')}</select></div>
            <div class="form-group"><label class="form-label">帳戶</label>
              <select class="form-control" name="account">${opts.accountNames.map((a) => `<option value="${a}">${a}</option>`).join('')}</select></div>
            <div class="form-group"><label class="form-label">幣別</label>
              <select class="form-control" name="currency">${opts.currencies.map((c) => `<option value="${c}">${c}</option>`).join('')}</select></div>
            <div class="form-group"><label class="form-label">金額</label>
              <input class="form-control font-mono" type="number" step="any" name="amount" inputmode="decimal" required /></div>
            <div class="form-group"><label class="form-label">日期</label>
              <input class="form-control" type="date" name="date" value="${today}" /></div>
            <div class="form-group"><label class="form-label">備註</label>
              <input class="form-control" name="note" /></div>
          </div>
          <div style="margin-top:12px; text-align:right;"><button type="submit" class="btn btn-primary">寫入流水</button></div>
        </form>
      </div>`;
  }

  _renderSalaryForm(today) {
    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header"><div class="card-title">記薪資 / 獎金（N_薪資）</div></div>
        <form id="form-add-salary">
          <div class="form-grid">
            <div class="form-group"><label class="form-label">入帳日期</label>
              <input class="form-control" type="date" name="date" value="${today}" required /></div>
            <div class="form-group"><label class="form-label">項目</label>
              <input class="form-control" name="item" placeholder="11月薪水 / 績效獎金" required /></div>
            <div class="form-group"><label class="form-label">實領金額</label>
              <input class="form-control font-mono" type="number" step="1" name="amount" inputmode="numeric" required /></div>
            <div class="form-group"><label class="form-label">明細</label>
              <input class="form-control" name="detail" placeholder="員工持股4000+4000" /></div>
            <div class="form-group"><label class="form-label">備註</label>
              <input class="form-control" name="note" /></div>
          </div>
          <div style="margin-top:12px; text-align:right;"><button type="submit" class="btn btn-primary">儲存薪資</button></div>
        </form>
      </div>`;
  }

  // ---------------- Tab: Accounts ----------------
  _renderAccountsTab(state, opts, sum) {
    const rows = (state?.asset?.accounts || [])
      .filter((a) => accName(a))
      .filter((a) => this.filterAttr === 'ALL' || a['屬性'] === this.filterAttr)
      .map((a) => {
        const cur = a['幣別'] || 'TWD';
        const bal = accBal(a);
        const twd = Math.round(bal * (opts.fxMap[cur] || 1));
        return { a, name: accName(a), attr: a['屬性'] || '-', cur, bal, twd };
      });
    rows.sort(this._sorter('accounts', {
      twd: (r) => r.twd, name: (r) => r.name, attr: (r) => r.attr, cur: (r) => r.cur, bal: (r) => r.bal
    }));
    const attrs = ['ALL', ...Array.from(new Set((state?.asset?.accounts || []).map((a) => a['屬性']).filter(Boolean)))];

    return `
      <div class="card">
        <div class="card-header">
          <div class="action-toolbar-group">
            ${attrs.map((t) => `<button class="btn ${this.filterAttr === t ? 'btn-primary' : 'btn-ghost'} btn-sm" data-attr="${t}">${t === 'ALL' ? '全部' : t}</button>`).join('')}
          </div>
          <span class="text-muted" style="font-size:12px;">點「對帳」輸入網銀實際餘額，自動計算差額寫入 log_V2</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              ${this._th('accounts', 'name', '帳戶', 'asc')}
              ${this._th('accounts', 'attr', '屬性', 'asc')}
              ${this._th('accounts', 'cur', '幣別', 'asc')}
              ${this._th('accounts', 'bal', '原幣餘額', 'desc', true)}
              ${this._th('accounts', 'twd', '折合台幣', 'desc', true)}
              <th style="text-align:right;">佔比</th>
              <th style="text-align:right;">對帳</th>
            </tr></thead>
            <tbody>
              ${rows.map((r) => {
                const key = `${r.name}|${r.cur}`;
                const editing = this.reconcilingKey === key;
                const ratio = sum.totalFinancialAssetsTwd > 0 ? (r.twd / sum.totalFinancialAssetsTwd) * 100 : 0;
                return `<tr>
                  <td style="font-weight:700;">${r.name}</td>
                  <td><span class="pill">${r.attr}</span></td>
                  <td class="font-mono">${r.cur}</td>
                  <td class="font-mono mask-amount" style="text-align:right;">${r.cur === 'TWD' ? fmtInt(r.bal) : fmtDec(r.bal)}</td>
                  <td class="font-mono mask-amount" style="text-align:right; font-weight:700;">$${fmtInt(r.twd)}</td>
                  <td class="font-mono text-muted" style="text-align:right;">${ratio.toFixed(1)}%</td>
                  <td style="text-align:right;">
                    ${editing ? `
                      <span style="display:inline-flex; gap:4px; align-items:center;">
                        <input type="number" step="any" inputmode="decimal" class="form-control font-mono" id="reconcile-input" value="${r.bal}" style="width:120px; padding:4px 6px;" />
                        <button class="btn btn-primary btn-sm" data-confirm-reconcile="${key}">確認</button>
                        <button class="btn btn-ghost btn-sm" data-cancel-reconcile="1">✕</button>
                      </span>` : `<button class="btn btn-ghost btn-sm" data-start-reconcile="${key}">對帳</button>`}
                  </td>
                </tr>`;
              }).join('')}
              ${rows.length === 0 ? '<tr><td colspan="7" class="text-muted" style="text-align:center; padding:18px;">尚無帳戶資料（請至設定頁從雲端拉取快照）</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // ---------------- Tab: Analytics ----------------
  _renderAnalyticsTab(state) {
    const { snapshots, allocation, cashflowHistory, cashflowStats, expenseBreakdown, summary } = AssetCore.getAnalyticsData(state);
    const eb = expenseBreakdown;
    const cfStats = cashflowStats || { monthCount: 0, avgMonthlyIncome: 0, avgMonthlyExpense: 0, avgMonthlySavings: 0, avgSavingsRate: 0 };
    return `
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">資產成長趨勢 (${snapshots[0]?.date?.slice(0, 4) || ''} ~ ${snapshots[snapshots.length - 1]?.date?.slice(0, 7) || ''})</div></div>
          ${this._svgAssetTrend(snapshots, summary.targetTotalAssetTwd)}
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">目前金融資產配置</div></div>
          <div style="display:flex; flex-direction:column; gap:12px;">
            ${allocation.map((it) => `
              <div>
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
                  <span>${it.label}</span>
                  <span class="font-mono mask-amount">$${fmtInt(it.amount)} <span class="text-muted">${(it.ratio * 100).toFixed(1)}%</span></span>
                </div>
                <div class="progress-track" style="margin-top:0;"><div class="progress-fill" style="width:${Math.max(1, it.ratio * 100)}%;"></div></div>
              </div>`).join('')}
            <div class="kpi-sub mask-amount" style="margin-top:6px;">不動產 $${fmtInt(summary.realEstateTwd)} ｜ 負債 <span class="text-rose">-$${fmtInt(summary.totalDebtTwd)}</span> ｜ 淨值 $${fmtInt(summary.netWorthTwd)}</div>
          </div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">月收入 vs 支出 (近 ${Math.min(18, cashflowHistory.length)} 個月)</div></div>
          ${this._svgCashflow(cashflowHistory.slice(-18), cfStats)}
        </div>
        <div class="card">
          <div class="card-header" style="margin-bottom:10px;">
            <div class="card-title">開銷分析（點擊類別展開明細）</div>
            <select id="select-exp-analysis-year" class="form-control" style="width:auto; padding:4px 10px; font-size:12px;">
              ${(() => {
                const ea = AssetCore.getExpenseAnalysis(state, { year: this.expenseAnalysisYear });
                return [
                  ...ea.availableYears.map((y) => `<option value="${y}" ${ea.selectedYear === y ? 'selected' : ''}>${y} 年</option>`),
                  `<option value="ALL" ${ea.selectedYear === 'ALL' ? 'selected' : ''}>全部年度</option>`
                ].join('');
              })()}
            </select>
          </div>
          ${(() => {
            const ea = AssetCore.getExpenseAnalysis(state, { year: this.expenseAnalysisYear });
            const renderGroup = (title, dotColor, grp) => `
              <div style="margin-top:12px; padding:10px 12px; border-radius:10px; background:var(--bg-elevated, rgba(255,255,255,0.025)); border:1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <span style="font-size:13px; font-weight:700;"><span style="color:${dotColor};">●</span> ${title}</span>
                  <span class="font-mono mask-amount" style="font-size:14px; font-weight:700;">$${fmtInt(grp.total)}</span>
                </div>
                ${grp.categories.length ? grp.categories.map((cat) => `
                  <details class="exp-acc">
                    <summary>
                      <div>
                        <div style="font-size:13px; font-weight:600;">${cat.name}</div>
                        <div class="text-muted" style="font-size:11px;">${cat.count} 筆 ▾</div>
                      </div>
                      <span class="font-mono mask-amount" style="font-size:13.5px; font-weight:700;">$${fmtInt(cat.total)}</span>
                    </summary>
                    <div class="exp-acc-items">
                      ${cat.items.map((it) => `
                        <div class="exp-acc-item">
                          <div>
                            <div style="font-weight:500;">${it.title}</div>
                            <div class="text-muted font-mono" style="font-size:11px;">${it.date}${it.payer ? ` · ${it.payer}` : ''}</div>
                          </div>
                          <span class="font-mono mask-amount" style="font-weight:600;">$${fmtInt(it.amount)}</span>
                        </div>
                      `).join('')}
                    </div>
                  </details>
                `).join('') : `<div class="text-muted" style="font-size:12px; padding:8px 0;">尚無${title}紀錄</div>`}
              </div>
            `;
            return `
              <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px;">
                <div style="padding:10px 12px; border-radius:10px; border:1px solid var(--border); border-left:3px solid #10b981;">
                  <div class="text-muted" style="font-size:11px;">月固定開銷（近 ${ea.completeFixedMonths} 個完整月平均）</div>
                  <div class="font-mono mask-amount" style="font-size:17px; font-weight:700; margin-top:4px;">$${fmtInt(ea.monthlyFixedAvg)}</div>
                </div>
                <div style="padding:10px 12px; border-radius:10px; border:1px solid var(--border);">
                  <div class="text-muted" style="font-size:11px;">${ea.selectedYear === 'ALL' ? '全部年度' : `${ea.selectedYear} 年`}總開銷</div>
                  <div class="font-mono mask-amount" style="font-size:17px; font-weight:700; margin-top:4px;">$${fmtInt(ea.yearTotal)}</div>
                </div>
              </div>
              ${renderGroup('固定開銷', '#10b981', ea.fixedGroup)}
              ${renderGroup('變動開銷', '#f59e0b', ea.variableGroup)}
            `;
          })()}
        </div>
      </div>`;
  }

  _svgAssetTrend(snaps, goal) {
    if (snaps.length < 2) return '<div class="text-muted" style="padding:20px; text-align:center;">尚無歷史快照</div>';
    const W = 560, H = 220, L = 50, R = 12, T = 14, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const max = Math.max(goal || 0, ...snaps.map((s) => Math.max(s.grossAssetsTwd, s.financialAssetsTwd))) * 1.05;
    const x = (i) => L + (i / (snaps.length - 1)) * pw;
    const y = (v) => T + ph - (Math.max(0, v) / max) * ph;
    const path = (k) => snaps.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join(' ');
    const ticks = [0, 0.25, 0.5, 0.75, 1];
    const labels = [0, Math.floor(snaps.length / 2), snaps.length - 1];
    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
        ${ticks.map((t) => `<line x1="${L}" y1="${y(max * t)}" x2="${W - R}" y2="${y(max * t)}" stroke="var(--border-color)" stroke-dasharray="3,3"/><text x="${L - 6}" y="${y(max * t) + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">${Math.round(max * t / 10000)}萬</text>`).join('')}
        ${goal ? `<line x1="${L}" y1="${y(goal)}" x2="${W - R}" y2="${y(goal)}" stroke="var(--text-muted)" stroke-dasharray="5,4"/><text x="${L + 4}" y="${y(goal) - 4}" font-size="10" fill="var(--text-secondary)">目標 ${Math.round(goal / 10000)}萬</text>` : ''}
        <path d="${path('grossAssetsTwd')}" fill="none" stroke="var(--text-muted)" stroke-width="1.6"/>
        <path d="${path('financialAssetsTwd')}" fill="none" stroke="var(--accent-blue)" stroke-width="2.2"/>
        ${labels.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${snaps[i].date.slice(0, 7)}</text>`).join('')}
      </svg>
      <div style="display:flex; gap:14px; justify-content:center; font-size:11.5px; color:var(--text-secondary);">
        <span><b style="color:var(--accent-blue);">●</b> 金融資金總額</span>
        <span><b style="color:var(--text-muted);">●</b> 總資產(含不動產)</span>
      </div>`;
  }

  _svgCashflow(list, cfStats = {}) {
    if (!list.length) return '<div class="text-muted" style="padding:20px; text-align:center;">尚無月度收支資料</div>';
    const W = 560, H = 220, L = 46, R = 10, T = 14, B = 28;
    const pw = W - L - R, ph = H - T - B;
    const max = Math.max(100000, ...list.map((c) => Math.max(c.income, c.expense))) * 1.08;
    const y = (v) => T + ph - (Math.max(0, v) / max) * ph;
    const gw = pw / list.length;
    const bw = Math.max(3, Math.min(11, gw * 0.35));
    const avgInc = toNum(cfStats.avgMonthlyIncome, 0);
    const avgExp = toNum(cfStats.avgMonthlyExpense, 0);
    const avgSav = toNum(cfStats.avgMonthlySavings, avgInc - avgExp);
    const savRatePct = avgInc > 0 ? ((avgSav / avgInc) * 100).toFixed(1) : '0.0';
    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
        ${[0, 0.5, 1].map((t) => `<line x1="${L}" y1="${y(max * t)}" x2="${W - R}" y2="${y(max * t)}" stroke="var(--border-color)" stroke-dasharray="3,3"/><text x="${L - 6}" y="${y(max * t) + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">${Math.round(max * t / 10000)}萬</text>`).join('')}
        ${list.map((c, i) => {
          const cx = L + i * gw + gw / 2;
          return `<rect x="${cx - bw - 1}" y="${y(c.income)}" width="${bw}" height="${Math.max(1, T + ph - y(c.income))}" fill="var(--accent-emerald)" rx="1.5"/>
            <rect x="${cx + 1}" y="${y(c.expense)}" width="${bw}" height="${Math.max(1, T + ph - y(c.expense))}" fill="var(--accent-rose)" rx="1.5"/>
            ${(i % 3 === 0 || i === list.length - 1) ? `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="var(--text-muted)">${c.yearMonth.slice(2)}</text>` : ''}`;
        }).join('')}
      </svg>
      <div style="display:flex; gap:14px; justify-content:center; font-size:11.5px; color:var(--text-secondary);">
        <span><b class="text-emerald">■</b> 收入</span><span><b class="text-rose">■</b> 支出</span>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:12px; justify-content:space-around; align-items:center; margin-top:10px; padding:9px 12px; background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:8px; font-size:12.5px;">
        <div>
          <span class="text-muted">月收入平均：</span>
          <strong class="font-mono mask-amount text-emerald">$${fmtInt(avgInc)}</strong>
        </div>
        <div>
          <span class="text-muted">月支出平均：</span>
          <strong class="font-mono mask-amount text-rose">$${fmtInt(avgExp)}</strong>
        </div>
        <div>
          <span class="text-muted">月均結餘 (儲蓄率)：</span>
          <strong class="font-mono mask-amount ${avgSav >= 0 ? 'text-emerald' : 'text-rose'}">${avgSav >= 0 ? '+' : ''}$${fmtInt(avgSav)} (${savRatePct}%)</strong>
        </div>
      </div>`;
  }

  // ---------------- Tab: Salary ----------------
  _renderSalaryTab(state) {
    const sal = AssetCore.getSalaryData(state, { year: this.salaryYearFilter, type: this.salaryTypeFilter });
    const { annualList, latestAnnual, firstAnnual, totalGrowthMultiple } = sal;
    const prev = annualList.length > 1 ? annualList[annualList.length - 2] : null;
    const records = [...sal.records].sort(this._sorter('salary', {
      date: (r) => String(r.date || ''), item: (r) => String(r.item || ''), amount: (r) => toNum(r.amount, 0)
    }));
    const filteredSum = records.reduce((s, r) => s + toNum(r.amount, 0), 0);
    const isBonus = (r) => /獎金|年終|禮金|補助|分紅/.test(String(r.item || '')) || String(r.yearTag || '').includes('年終');

    return `
      <div class="grid-kpi">
        <div class="card">
          <div class="kpi-label"><span>${latestAnnual?.year || ''} 累計實領</span>${latestAnnual?.yoyPct != null ? `<span class="pill ${latestAnnual.yoyPct >= 0 ? 'pill-emerald' : 'pill-rose'}">${latestAnnual.yoyPct >= 0 ? '▲ +' : '▼ '}${latestAnnual.yoyPct.toFixed(1)}%</span>` : ''}</div>
          <div class="kpi-value mask-amount">$${fmtInt(latestAnnual?.annualSalary)}</div>
          <div class="kpi-sub mask-amount">預估全年 $${fmtInt(latestAnnual?.estimatedAnnual)}</div>
        </div>
        <div class="card">
          <div class="kpi-label"><span>${prev?.year || ''} 年薪</span></div>
          <div class="kpi-value mask-amount">$${fmtInt(prev?.annualSalary)}</div>
          <div class="kpi-sub mask-amount">月均 $${fmtInt(prev?.monthlyAvg)}</div>
        </div>
        <div class="card">
          <div class="kpi-label"><span>${firstAnnual?.year || ''} → ${latestAnnual?.year || ''} 成長</span></div>
          <div class="kpi-value text-emerald">${totalGrowthMultiple.toFixed(2)}x</div>
          <div class="kpi-sub mask-amount">起點 $${fmtInt(firstAnnual?.annualSalary)}</div>
        </div>
        <div class="card">
          <div class="kpi-label"><span>篩選合計 (${records.length} 筆)</span></div>
          <div class="kpi-value mask-amount">$${fmtInt(filteredSum)}</div>
          <div class="kpi-sub">共 ${sal.totalRecordsCount} 筆紀錄</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">歷年年薪結構</div></div>
          ${this._svgSalary(annualList)}
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">年度彙總</div></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>年度</th><th style="text-align:right;">年薪</th><th style="text-align:right;">月均</th><th style="text-align:right;">YoY</th><th style="text-align:right;">獎金佔比</th></tr></thead>
              <tbody>
                ${annualList.slice().reverse().map((a) => `<tr>
                  <td class="font-mono" style="font-weight:700;">${a.year}</td>
                  <td class="font-mono mask-amount" style="text-align:right; font-weight:700;">$${fmtInt(a.annualSalary)}</td>
                  <td class="font-mono mask-amount" style="text-align:right;">$${fmtInt(a.monthlyAvg)}</td>
                  <td class="font-mono ${a.yoyPct == null ? 'text-muted' : a.yoyPct >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${a.yoyPct == null ? '-' : `${a.yoyPct >= 0 ? '▲ +' : '▼ '}${a.yoyPct.toFixed(1)}%`}</td>
                  <td class="font-mono text-muted" style="text-align:right;">${(a.bonusRatio * 100).toFixed(1)}%</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">N_薪資 明細</div>
          <div class="action-toolbar-group">
            <select class="form-select" id="salary-filter-year" style="width:auto; padding:5px 8px; font-size:13px;">
              <option value="ALL">全部年度</option>
              ${annualList.slice().reverse().map((a) => `<option value="${a.year}" ${String(this.salaryYearFilter) === String(a.year) ? 'selected' : ''}>${a.year}</option>`).join('')}
            </select>
            <select class="form-select" id="salary-filter-type" style="width:auto; padding:5px 8px; font-size:13px;">
              <option value="ALL" ${this.salaryTypeFilter === 'ALL' ? 'selected' : ''}>全部</option>
              <option value="BASE" ${this.salaryTypeFilter === 'BASE' ? 'selected' : ''}>月薪</option>
              <option value="BONUS" ${this.salaryTypeFilter === 'BONUS' ? 'selected' : ''}>獎金/年終</option>
            </select>
          </div>
        </div>
        <div class="table-wrap" style="max-height:480px; overflow-y:auto;">
          <table class="data-table">
            <thead><tr>
              ${this._th('salary', 'date', '日期', 'desc')}
              ${this._th('salary', 'item', '項目', 'asc')}
              ${this._th('salary', 'amount', '實領', 'desc', true)}
              <th>明細</th><th>備註</th>
            </tr></thead>
            <tbody>
              ${records.map((r) => `<tr>
                <td class="font-mono">${r.date || '-'}</td>
                <td><span class="pill ${isBonus(r) ? 'pill-emerald' : ''}">${r.item || '-'}</span></td>
                <td class="font-mono mask-amount" style="text-align:right; font-weight:700;">$${fmtInt(r.amount)}</td>
                <td class="text-muted">${r.detail || ''}</td>
                <td class="text-muted">${r.note || r.bigSpend || ''}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  _svgSalary(list) {
    if (!list.length) return '<div class="text-muted" style="padding:20px; text-align:center;">無資料</div>';
    const W = 540, H = 210, L = 46, R = 10, T = 22, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const max = Math.max(...list.map((a) => Math.max(a.annualSalary, a.estimatedAnnual || 0))) * 1.12;
    const y = (v) => T + ph - (Math.max(0, v) / max) * ph;
    const gw = pw / list.length;
    const bw = Math.min(40, gw * 0.5);
    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
        ${[0, 0.5, 1].map((t) => `<line x1="${L}" y1="${y(max * t)}" x2="${W - R}" y2="${y(max * t)}" stroke="var(--border-color)" stroke-dasharray="3,3"/><text x="${L - 6}" y="${y(max * t) + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">${Math.round(max * t / 10000)}萬</text>`).join('')}
        ${list.map((a, i) => {
          const cx = L + i * gw + gw / 2;
          const bonus = Math.min(a.annualSalary, a.bonusTotal || 0);
          const base = a.annualSalary - bonus;
          return `<rect x="${cx - bw / 2}" y="${y(base)}" width="${bw}" height="${Math.max(1, T + ph - y(base))}" fill="var(--accent-blue)" rx="2"/>
            ${bonus > 0 ? `<rect x="${cx - bw / 2}" y="${y(a.annualSalary)}" width="${bw}" height="${Math.max(0, y(base) - y(a.annualSalary))}" fill="var(--accent-emerald)" rx="2"/>` : ''}
            <text x="${cx}" y="${y(a.annualSalary) - 5}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text-primary)">${(a.annualSalary / 10000).toFixed(0)}萬</text>
            <text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">${a.year}</text>`;
        }).join('')}
      </svg>
      <div style="display:flex; gap:14px; justify-content:center; font-size:11.5px; color:var(--text-secondary);">
        <span><b style="color:var(--accent-blue);">■</b> 月薪</span><span><b class="text-emerald">■</b> 獎金/年終/禮金</span>
      </div>`;
  }

  // ---------------- Tab: Logs ----------------
  _renderLogsTab(state) {
    const expSort = this.sortState.expenses || { col: 'date', dir: 'desc' };
    const logSort = this.sortState.logs || { col: 'date', dir: 'desc' };
    const exps = AssetCore.getSortedExpenses(state, { col: expSort.col, dir: expSort.dir, limit: 100 });
    const logs = AssetCore.getSortedLogs(state, { col: logSort.col, dir: logSort.dir, limit: 100 });

    return `
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">開銷明細 (最新 100 筆)</div></div>
          <div class="table-wrap" style="max-height:460px; overflow-y:auto;">
            <table class="data-table">
              <thead><tr>
                ${this._th('expenses', 'date', '日期', 'desc')}
                ${this._th('expenses', 'cat', '類別', 'asc')}
                <th>名目</th>
                ${this._th('expenses', 'amount', '金額', 'desc', true)}
                ${this._th('expenses', 'payer', '負擔人', 'asc')}
              </tr></thead>
              <tbody>
                ${exps.map((e) => `<tr>
                  <td class="font-mono">${e['日期'] || '-'}</td>
                  <td><span class="pill">${e['類別'] || '-'}</span>${e['子類別'] ? ` <span class="text-muted" style="font-size:11px;">${e['子類別']}</span>` : ''}</td>
                  <td>${e['名目'] || '-'}</td>
                  <td class="font-mono mask-amount" style="text-align:right; font-weight:700;">$${fmtInt(e['金額'])}</td>
                  <td class="text-muted">${e['負擔人'] || '-'}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">帳戶流水 log_V2 (最新 100 筆)</div></div>
          <div class="table-wrap" style="max-height:460px; overflow-y:auto;">
            <table class="data-table">
              <thead><tr>
                ${this._th('logs', 'date', '日期', 'desc')}
                ${this._th('logs', 'nature', '性質', 'asc')}
                <th>類別</th>
                ${this._th('logs', 'account', '帳戶', 'asc')}
                ${this._th('logs', 'amount', '金額', 'desc', true)}
                <th>備註</th>
              </tr></thead>
              <tbody>
                ${logs.map((l) => {
                  const nat = l['性質'] || '';
                  const amt = toNum(l['金額'], 0);
                  const signed = nat === '支出' ? -Math.abs(amt) : nat === '收入' ? Math.abs(amt) : amt;
                  const cls = signed > 0 ? 'text-emerald' : signed < 0 ? 'text-rose' : '';
                  return `<tr>
                    <td class="font-mono">${l['日期'] || '-'}</td>
                    <td><span class="pill">${nat}</span></td>
                    <td>${l['類別'] || '-'}</td>
                    <td style="font-weight:600;">${l['帳戶'] || '-'}</td>
                    <td class="font-mono mask-amount ${cls}" style="text-align:right; font-weight:700;">${signed > 0 ? '+' : ''}${fmtInt(signed)} ${l['幣別'] && l['幣別'] !== 'TWD' ? l['幣別'] : ''}</td>
                    <td class="text-muted">${l['備註'] || ''}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  // ---------------- Tab: Debts ----------------
  _renderDebtsTab(state) {
    const debts = (state?.asset?.debts || []).filter((d) => d['債務名稱']).sort(this._sorter('debts', {
      remain: (d) => toNum(d['目前餘額(自動)'], 0), name: (d) => String(d['債務名稱']), rate: (d) => toNum(d['利率%'], 0), pay: (d) => toNum(d['每月還款'], 0)
    }));
    return `
      <div class="card">
        <div class="card-header"><div class="card-title">債務處置表 (房貸 / 信貸)</div></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              ${this._th('debts', 'name', '債務名稱', 'asc')}
              <th>性質</th>
              ${this._th('debts', 'rate', '利率%', 'desc', true)}
              ${this._th('debts', 'remain', '目前餘額', 'desc', true)}
              <th style="text-align:right;">已還進度</th>
              ${this._th('debts', 'pay', '每月還款', 'desc', true)}
              <th style="text-align:right;">剩餘期數</th>
            </tr></thead>
            <tbody>
              ${debts.map((d) => {
                const orig = toNum(d['原始總額'], 0);
                const rem = toNum(d['目前餘額(自動)'], 0);
                const paid = orig > 0 ? ((orig - rem) / orig) * 100 : 0;
                return `<tr>
                  <td style="font-weight:700;">${d['債務名稱']}</td>
                  <td><span class="pill">${d['性質'] || '-'}</span></td>
                  <td class="font-mono" style="text-align:right;">${toNum(d['利率%'], 0).toFixed(2)}%</td>
                  <td class="font-mono mask-amount" style="text-align:right; font-weight:700;">$${fmtInt(rem)}</td>
                  <td class="font-mono text-emerald" style="text-align:right;">${paid.toFixed(1)}%</td>
                  <td class="font-mono mask-amount" style="text-align:right;">$${fmtInt(d['每月還款'])}</td>
                  <td class="font-mono" style="text-align:right;">${fmtInt(d['剩餘期數(自動)'])} 期</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // ---------------- Events ----------------
  _bindEvents(container, state, store, showToast) {
    container.querySelectorAll('[data-ef-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.efMode = btn.getAttribute('data-ef-mode') || 'fixed';
        try {
          localStorage.setItem('nic_asset_ef_cfg_v1', JSON.stringify({ mode: this.efMode, manualMonthly: this.efManualMonthly }));
        } catch (_) {}
        this.render(container, store.getState(), store, showToast);
      });
    });

    const efApplyBtn = container.querySelector('#btn-ef-manual-apply');
    if (efApplyBtn) {
      efApplyBtn.addEventListener('click', () => {
        const inp = container.querySelector('#input-ef-manual');
        const val = Number(inp?.value || 0);
        if (val > 0) {
          this.efManualMonthly = val;
          try {
            localStorage.setItem('nic_asset_ef_cfg_v1', JSON.stringify({ mode: this.efMode, manualMonthly: this.efManualMonthly }));
          } catch (_) {}
          this.render(container, store.getState(), store, showToast);
        }
      });
    }

    const snapBtn = container.querySelector('#btn-record-snapshot');
    if (snapBtn) {
      snapBtn.addEventListener('click', () => {
        try {
          const rec = AssetCore.recordAssetSnapshot(store.getState(), {}, store);
          showToast(`📸 已記錄 ${rec['日期']} 資產快照（資金總額 $${fmtInt(rec['資金總額'])}），已排入雲端同步！`);
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`⚠️ 快照記錄失敗：${err?.message || err}`);
        }
      });
    }

    const expYearSel = container.querySelector('#select-exp-analysis-year');
    if (expYearSel) {
      expYearSel.addEventListener('change', (e) => {
        this.expenseAnalysisYear = e.target.value;
        this.render(container, store.getState(), store, showToast);
      });
    }

    // Fixed Expense Simulator bindings
    const simIncomeInp = container.querySelector('#input-sim-income');
    if (simIncomeInp) {
      simIncomeInp.addEventListener('change', () => {
        this.fixedSim.monthlyIncome = Math.max(0, toNum(simIncomeInp.value, 0));
        this._saveFixedSim();
        this.render(container, store.getState(), store, showToast);
      });
    }
    container.querySelectorAll('[data-sim-field]').forEach((el) => {
      el.addEventListener('change', () => {
        const id = el.getAttribute('data-sim-id');
        const field = el.getAttribute('data-sim-field');
        const item = this.fixedSim.items.find((x) => x.id === id);
        if (!item) return;
        if (field === 'enabled') item.enabled = el.checked;
        else if (field === 'p1' || field === 'p2') item[field] = Math.max(0, toNum(el.value, 0));
        else item[field] = el.value;
        this._saveFixedSim();
        this.render(container, store.getState(), store, showToast);
      });
    });
    container.querySelectorAll('[data-sim-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-sim-del');
        this.fixedSim.items = this.fixedSim.items.filter((x) => x.id !== id);
        this._saveFixedSim();
        this.render(container, store.getState(), store, showToast);
      });
    });
    const simAddForm = container.querySelector('#form-sim-add');
    if (simAddForm) {
      simAddForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(simAddForm);
        const name = String(fd.get('name') || '').trim();
        if (!name) return;
        this.fixedSim.items.push({
          id: 'f_' + Date.now(),
          group: String(fd.get('group') || '必要成本'),
          name,
          type: String(fd.get('type') || '其他').trim(),
          p1: Math.max(0, toNum(fd.get('p1'), 0)),
          p2: Math.max(0, toNum(fd.get('p2'), 0)),
          enabled: true
        });
        this._saveFixedSim();
        showToast(`✅ 已新增模擬項目「${name}」`);
        this.render(container, store.getState(), store, showToast);
      });
    }
    const simResetBtn = container.querySelector('#btn-sim-reset');
    if (simResetBtn) {
      simResetBtn.addEventListener('click', () => {
        this.fixedSim = structuredClone(DEFAULT_FIXED_SIM);
        this._saveFixedSim();
        showToast('已重設為預設固定開銷模擬表');
        this.render(container, store.getState(), store, showToast);
      });
    }
    const simApplyEfBtn = container.querySelector('#btn-sim-apply-ef');
    if (simApplyEfBtn) {
      simApplyEfBtn.addEventListener('click', () => {
        const total = this.fixedSim.items.filter((x) => x.enabled !== false).reduce((s, x) => s + toNum(x.p1, 0) + toNum(x.p2, 0), 0);
        if (total > 0) {
          this.efMode = 'manual';
          this.efManualMonthly = Math.round(total);
          try {
            localStorage.setItem('nic_asset_ef_cfg_v1', JSON.stringify({ mode: this.efMode, manualMonthly: this.efManualMonthly }));
          } catch (_) {}
          showToast(`✅ 已將每月固定開銷 $${fmtInt(total)} 套用至緊急預備金基準！`);
          this.render(container, store.getState(), store, showToast);
        }
      });
    }
    const rerender = () => this.render(container, store.getState(), store, showToast);
    const on = (sel, ev, fn) => container.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, (e) => fn(el, e)));

    on('[data-toggle-form]', 'click', (el) => { const f = el.getAttribute('data-toggle-form'); this.activeForm = this.activeForm === f ? null : f; rerender(); });
    on('[data-tab]', 'click', (el) => { this.activeTab = el.getAttribute('data-tab'); this.reconcilingKey = null; rerender(); });
    on('[data-attr]', 'click', (el) => { this.filterAttr = el.getAttribute('data-attr'); rerender(); });
    on('th[data-sort-table]', 'click', (el) => { this._toggleSort(el.getAttribute('data-sort-table'), el.getAttribute('data-sort-col'), el.getAttribute('data-sort-default')); rerender(); });
    on('#select-exp-main', 'change', (el) => { this.selectedMainCat = el.value; rerender(); });
    on('#select-log-nature', 'change', (el) => { this.selectedNature = el.value; rerender(); });
    on('#salary-filter-year', 'change', (el) => { this.salaryYearFilter = el.value; rerender(); });
    on('#salary-filter-type', 'change', (el) => { this.salaryTypeFilter = el.value; rerender(); });

    const submit = (id, fn) => {
      const form = container.querySelector(id);
      if (!form) return;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const msg = fn(Object.fromEntries(new FormData(form).entries()));
          showToast(msg);
          this.activeForm = null;
          rerender();
        } catch (err) { showToast(`錯誤：${err.message}`); }
      });
    };
    submit('#form-add-expense', (p) => { const r = AssetCore.addExpense(store.getState(), p, store); return `已記開銷：${r['類別']} ${r['名目']} $${fmtInt(r['金額'])}`; });
    submit('#form-add-log', (p) => { const r = AssetCore.addLedgerLog(store.getState(), p, store); return `已寫入流水：${r['帳戶']} ${r['性質']} ${r['金額']}`; });
    submit('#form-add-salary', (p) => { const r = AssetCore.addSalaryRecord(store.getState(), p, store).record; this.activeTab = 'salary'; return `已新增薪資：${r.item} $${fmtInt(r.amount)}`; });

    on('[data-cf-metric]', 'click', (el) => {
      this.cashflowMetric = el.getAttribute('data-cf-metric') || 'income';
      rerender();
    });
    on('[data-select-cf-month]', 'click', (el) => {
      const m = el.getAttribute('data-select-cf-month');
      this.selectedCashflowMonth = this.selectedCashflowMonth === m ? null : m;
      rerender();
    });

    on('[data-start-reconcile]', 'click', (el) => {
      this.reconcilingKey = el.getAttribute('data-start-reconcile');
      rerender();
      const inp = container.querySelector('#reconcile-input');
      if (inp) { inp.focus(); inp.select(); }
    });
    on('[data-cancel-reconcile]', 'click', () => { this.reconcilingKey = null; rerender(); });
    on('[data-confirm-reconcile]', 'click', (el) => {
      const [account, currency] = el.getAttribute('data-confirm-reconcile').split('|');
      const inp = container.querySelector('#reconcile-input');
      try {
        const res = AssetCore.reconcileAccountBalance(store.getState(), { account, currency, actualBalance: inp ? inp.value : '' }, store);
        showToast(`對帳完成：${account} → ${fmtInt(res.newOrig)}（差額 ${res.deltaOrig >= 0 ? '+' : ''}${fmtInt(res.deltaOrig)}）`);
        this.reconcilingKey = null;
        rerender();
      } catch (err) { showToast(`錯誤：${err.message}`); }
    });
  }

  _renderMonthlyTab(state) {
    const metric = this.cashflowMetric || 'income'; // 'net' | 'income' | 'expense'
    const data = AssetCore.getMonthlyCashflow(state, { year: 'ALL' });
    const rows = data.matrixByYear || [];
    const months = data.months || [];
    const activeMonth = this.selectedCashflowMonth
      ? months.find((m) => m.month === this.selectedCashflowMonth)
      : null;

    const metricLabel = metric === 'income' ? '收入' : metric === 'expense' ? '支出' : '盈餘';
    const palette = ['#3b82f6', '#ea580c', '#10b981', '#a855f7', '#ec4899', '#eab308'];

    // Build SVG Multi-Year 1..12 Month Line Chart
    const svgW = 540, svgH = 230, padL = 52, padR = 44, padT = 16, padB = 26;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;
    const allVals = [];
    rows.forEach((r) => (r[metric] || []).forEach((v) => { if (v !== null && v !== undefined) allVals.push(v); }));
    const rawMin = allVals.length ? Math.min(0, ...allVals) : 0;
    const rawMax = allVals.length ? Math.max(10000, ...allVals) : 100000;
    const span = Math.max(1, rawMax - rawMin);
    const xAt = (mIdx) => padL + (mIdx / 11) * plotW;
    const yAt = (v) => padT + plotH - ((v - rawMin) / span) * plotH;
    const fmtWan = (v) => `${(v / 10000).toFixed(1).replace(/\.0$/, '')}萬`;

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => rawMin + t * span);
    const gridSvg = yTicks.map((v) => {
      const y = yAt(v).toFixed(1);
      return `
        <line x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}" stroke="rgba(148,163,184,0.16)" stroke-dasharray="3,3" />
        <text x="${padL - 6}" y="${Number(y) + 3.5}" text-anchor="end" fill="#94a3b8" font-size="10">${fmtWan(v)}</text>
      `;
    }).join('');
    const xLabelsSvg = Array.from({ length: 12 }, (_, i) => `
      <text x="${xAt(i).toFixed(1)}" y="${svgH - 6}" text-anchor="middle" fill="#94a3b8" font-size="10">${i + 1}</text>
    `).join('');

    const seriesSvg = rows.map((r, idx) => {
      const color = palette[idx % palette.length];
      const arr = r[metric] || [];
      const pts = [];
      let lastPt = null;
      for (let i = 0; i < 12; i++) {
        if (arr[i] !== null && arr[i] !== undefined) {
          const pt = { x: xAt(i), y: yAt(arr[i]), v: arr[i], m: i + 1 };
          pts.push(pt);
          lastPt = pt;
        }
      }
      if (!pts.length) return '';
      const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" fill="${color}" />`).join('');
      const endLabel = lastPt
        ? `<text x="${(lastPt.x + 6).toFixed(1)}" y="${(lastPt.y + 3.5).toFixed(1)}" fill="${color}" font-size="10.5" font-weight="700">${r.year}</text>`
        : '';
      return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${poly}" />${dots}${endLabel}`;
    }).join('');

    const legendHtml = rows.map((r, idx) => {
      const color = palette[idx % palette.length];
      return `<span style="display:inline-flex; align-items:center; gap:5px; font-size:12px; color:var(--text-secondary);"><span style="width:9px; height:9px; border-radius:999px; background:${color}; display:inline-block;"></span>${r.year}</span>`;
    }).join('');

    return `
      <!-- Card 1: 每年每月比較折線圖 -->
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="margin-bottom:10px;">
          <div class="card-title">每年每月比較</div>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <button class="btn btn-sm ${metric === 'net' ? 'btn-primary' : 'btn-ghost'}" style="border-radius:999px; padding:6px 16px;" data-cf-metric="net">盈餘</button>
          <button class="btn btn-sm ${metric === 'income' ? 'btn-primary' : 'btn-ghost'}" style="border-radius:999px; padding:6px 16px;" data-cf-metric="income">收入</button>
          <button class="btn btn-sm ${metric === 'expense' ? 'btn-primary' : 'btn-ghost'}" style="border-radius:999px; padding:6px 16px;" data-cf-metric="expense">支出</button>
        </div>

        <div style="width:100%; overflow-x:auto;">
          <svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%; height:auto; min-height:200px; display:block;">
            ${gridSvg}
            ${xLabelsSvg}
            ${seriesSvg}
          </svg>
        </div>
        <div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:8px;">
          ${legendHtml || '<span class="text-muted" style="font-size:12px;">尚無資料</span>'}
        </div>
        <div class="text-muted" style="font-size:11.5px; margin-top:8px;">
          註：依 log_V2「性質 = 收入 / 支出」自動彙總計算（已排除轉帳與對帳校正）。
        </div>
      </div>

      <!-- Card 2: 年 × 月 橫向矩陣表 -->
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="margin-bottom:8px;">
          <div class="card-title">${metricLabel}（年 × 月）</div>
          <span class="text-muted" style="font-size:11.5px;">點擊任一月份數字可展開明細</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="position:sticky; left:0; background:var(--bg-card); z-index:2;">年</th>
                ${Array.from({ length: 12 }, (_, i) => `<th style="text-align:right; white-space:nowrap;">${i + 1}月</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map((r) => `
                <tr>
                  <td class="font-mono" style="font-weight:700; position:sticky; left:0; background:var(--bg-card); z-index:1;">${r.year}</td>
                  ${(r[metric] || []).map((v, mIdx) => {
                    if (v === null || v === undefined) {
                      return `<td class="font-mono text-muted" style="text-align:right;">-</td>`;
                    }
                    const ym = `${r.year}-${String(mIdx + 1).padStart(2, '0')}`;
                    const isSel = activeMonth && activeMonth.month === ym;
                    const cls = metric === 'income' ? 'text-emerald' : metric === 'expense' ? 'text-rose' : (v >= 0 ? 'text-emerald' : 'text-rose');
                    return `<td class="font-mono mask-amount ${cls}" data-select-cf-month="${ym}" style="text-align:right; font-weight:600; cursor:pointer; white-space:nowrap; ${isSel ? 'background:rgba(59,130,246,0.18); border-radius:6px;' : ''}">${fmtInt(v)}</td>`;
                  }).join('')}
                </tr>
              `).join('') : `<tr><td colspan="13" class="text-muted" style="text-align:center; padding:16px;">目前尚無 log_V2 收支紀錄</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      ${activeMonth ? `
        <div class="grid-2" style="margin-bottom:14px;">
          <div class="card">
            <div class="card-header">
              <div class="card-title text-emerald">${activeMonth.month} 收入明細 (${activeMonth.incomeCount} 筆)</div>
              <span class="pill pill-emerald mask-amount">+$${fmtInt(activeMonth.income)}</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>日期</th><th>類別</th><th>帳戶</th><th>備註</th><th style="text-align:right;">金額</th></tr></thead>
                <tbody>
                  ${activeMonth.incomeItems.length ? activeMonth.incomeItems.map((it) => `
                    <tr>
                      <td class="font-mono" style="white-space:nowrap;">${it.date}</td>
                      <td>${it.category}</td>
                      <td class="text-muted">${it.account}</td>
                      <td class="text-muted">${it.note || '-'}</td>
                      <td class="font-mono mask-amount text-emerald" style="text-align:right; font-weight:600;">+${fmtInt(it.twdAmount)}</td>
                    </tr>
                  `).join('') : `<tr><td colspan="5" class="text-muted" style="text-align:center; padding:14px;">本月無收入紀錄</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title text-rose">${activeMonth.month} 支出明細 (${activeMonth.expenseCount} 筆)</div>
              <span class="pill pill-rose mask-amount">-$${fmtInt(activeMonth.expense)}</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>日期</th><th>類別</th><th>帳戶</th><th>備註</th><th style="text-align:right;">金額</th></tr></thead>
                <tbody>
                  ${activeMonth.expenseItems.length ? activeMonth.expenseItems.map((it) => `
                    <tr>
                      <td class="font-mono" style="white-space:nowrap;">${it.date}</td>
                      <td>${it.category}</td>
                      <td class="text-muted">${it.account}</td>
                      <td class="text-muted">${it.note || '-'}</td>
                      <td class="font-mono mask-amount text-rose" style="text-align:right; font-weight:600;">-${fmtInt(it.twdAmount)}</td>
                    </tr>
                  `).join('') : `<tr><td colspan="5" class="text-muted" style="text-align:center; padding:14px;">本月無支出紀錄</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Card 3: 年度彙總 -->
      <div class="card">
        <div class="card-header" style="margin-bottom:8px;">
          <div class="card-title">年度彙總</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>年</th>
                <th style="text-align:right;">月數</th>
                <th style="text-align:right;">收入</th>
                <th style="text-align:right;">支出</th>
                <th style="text-align:right;">盈餘</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map((r) => `
                <tr>
                  <td class="font-mono" style="font-weight:700;">${r.year}</td>
                  <td class="font-mono" style="text-align:right;">${r.monthCount}</td>
                  <td class="font-mono mask-amount text-emerald" style="text-align:right; font-weight:600;">${fmtInt(r.incomeTotal)}</td>
                  <td class="font-mono mask-amount text-rose" style="text-align:right; font-weight:600;">${fmtInt(r.expenseTotal)}</td>
                  <td class="font-mono mask-amount ${r.netTotal >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right; font-weight:700;">${fmtInt(r.netTotal)}</td>
                </tr>
              `).join('') : `<tr><td colspan="5" class="text-muted" style="text-align:center; padding:16px;">尚無資料</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ---------------- Tab: FS共同資產 ----------------
  _renderFsSharedTab(state) {
    const fsData = AssetCore.getFsSharedAssets(state);
    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="kpi-label"><span>FS 共同資產合計（台幣）</span><span class="pill">${fsData.count} 筆紀錄</span></div>
        <div class="kpi-value mask-amount">$${fmtInt(fsData.totalCombinedTwd)}</div>
        <div class="kpi-sub mask-amount">TWD ${fmtInt(fsData.totalTwd)} · USD ${fmtDec(fsData.totalUsd, 2)}</div>
      </div>
      <div class="card">
        <div class="card-header" style="margin-bottom:8px;">
          <div class="card-title">FS 明細</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>類別</th>
                <th>帳戶</th>
                <th>備註</th>
                <th style="text-align:right;">金額</th>
              </tr>
            </thead>
            <tbody>
              ${fsData.items.length ? fsData.items.map((it) => `
                <tr>
                  <td class="font-mono" style="white-space:nowrap;">${it.date}</td>
                  <td>${it.category}</td>
                  <td class="text-muted">${it.account}</td>
                  <td class="text-muted">${it.note || '-'}</td>
                  <td class="font-mono mask-amount ${it.amount >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right; font-weight:600;">${it.amount >= 0 ? '+' : ''}${fmtInt(it.amount)} ${it.currency}</td>
                </tr>
              `).join('') : `<tr><td colspan="5" class="text-muted" style="text-align:center; padding:18px;">目前 log_V2 中尚無標籤為「FS」的紀錄</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ---------------- Tab: 固定開銷模擬 ----------------
  _loadFixedSim() {
    try {
      const raw = localStorage.getItem(FIXED_SIM_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) return parsed;
      }
    } catch (_) {}
    return structuredClone(DEFAULT_FIXED_SIM);
  }

  _saveFixedSim() {
    try {
      localStorage.setItem(FIXED_SIM_KEY, JSON.stringify(this.fixedSim));
    } catch (_) {}
  }

  _renderFixedSimTab() {
    const items = this.fixedSim.items || [];
    const activeItems = items.filter((x) => x.enabled !== false);
    const totalP1 = activeItems.reduce((s, x) => s + toNum(x.p1, 0), 0);
    const totalP2 = activeItems.reduce((s, x) => s + toNum(x.p2, 0), 0);
    const totalFixed = totalP1 + totalP2;
    const income = toNum(this.fixedSim.monthlyIncome, 0);
    const gap = income - totalFixed;

    return `
      <div class="grid-kpi" style="margin-bottom:14px;">
        <div class="card">
          <div class="kpi-label"><span>每月固定開銷</span></div>
          <div class="kpi-value mask-amount">$${fmtInt(totalFixed)}</div>
          <div class="kpi-sub mask-amount">炫甫 $${fmtInt(totalP1)} ｜ 垠宣 $${fmtInt(totalP2)}</div>
        </div>
        <div class="card">
          <div class="kpi-label"><span>每月收入 (可編輯)</span></div>
          <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
            <span class="font-mono" style="font-weight:700;">$</span>
            <input id="input-sim-income" class="form-control font-mono" type="number" step="500" value="${income}" style="font-size:17px; font-weight:700; padding:4px 8px;" />
          </div>
        </div>
        <div class="card">
          <div class="kpi-label"><span>GAP (收入 - 固定開銷)</span></div>
          <div class="kpi-value mask-amount ${gap >= 0 ? 'text-emerald' : 'text-rose'}">${gap >= 0 ? '+' : ''}$${fmtInt(gap)}</div>
          <div class="kpi-sub">${gap >= 0 ? '每月結餘空間' : '⚠️ 固定開銷超出月收入'}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div class="card-title">每月固定開銷模擬表（勾選與金額即時試算）</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" id="btn-sim-apply-ef" class="btn btn-primary btn-sm">套用至緊急預備金</button>
            <button type="button" id="btn-sim-reset" class="btn btn-ghost btn-sm">重設預設值</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width:36px;">啟用</th>
                <th>屬性</th>
                <th>項目</th>
                <th>TYPE</th>
                <th style="text-align:right;">炫甫</th>
                <th style="text-align:right;">垠宣</th>
                <th style="text-align:right;">花費</th>
                <th style="width:42px;"></th>
              </tr>
            </thead>
            <tbody>
              ${items.map((it) => {
                const rowSum = toNum(it.p1, 0) + toNum(it.p2, 0);
                const muted = it.enabled === false ? 'opacity:0.45;' : '';
                return `
                  <tr style="${muted}">
                    <td><input type="checkbox" data-sim-id="${it.id}" data-sim-field="enabled" ${it.enabled !== false ? 'checked' : ''} /></td>
                    <td><span class="pill" style="font-size:10.5px;">${it.group}</span></td>
                    <td style="font-weight:600;">${it.name}</td>
                    <td class="text-muted">${it.type || '-'}</td>
                    <td style="text-align:right;"><input class="form-control font-mono" type="number" step="1" data-sim-id="${it.id}" data-sim-field="p1" value="${toNum(it.p1, 0)}" style="width:88px; text-align:right; padding:3px 6px; font-size:12.5px;" /></td>
                    <td style="text-align:right;"><input class="form-control font-mono" type="number" step="1" data-sim-id="${it.id}" data-sim-field="p2" value="${toNum(it.p2, 0)}" style="width:88px; text-align:right; padding:3px 6px; font-size:12.5px;" /></td>
                    <td class="font-mono mask-amount" style="text-align:right; font-weight:700;">$${fmtInt(rowSum)}</td>
                    <td><button type="button" class="btn btn-ghost btn-sm" data-sim-del="${it.id}" title="刪除" style="padding:2px 6px;">✕</button></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <form id="form-sim-add" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border); display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end;">
          <div><label class="form-label" style="font-size:11px;">屬性</label>
            <select class="form-control" name="group" style="padding:5px 8px; font-size:12px;"><option value="必要成本">必要成本</option><option value="可調成本">可調成本</option></select></div>
          <div><label class="form-label" style="font-size:11px;">項目</label>
            <input class="form-control" name="name" placeholder="例如 健身房" required style="width:120px; padding:5px 8px; font-size:12px;" /></div>
          <div><label class="form-label" style="font-size:11px;">TYPE</label>
            <input class="form-control" name="type" placeholder="其他" style="width:80px; padding:5px 8px; font-size:12px;" /></div>
          <div><label class="form-label" style="font-size:11px;">炫甫</label>
            <input class="form-control font-mono" name="p1" type="number" value="0" style="width:88px; padding:5px 8px; font-size:12px;" /></div>
          <div><label class="form-label" style="font-size:11px;">垠宣</label>
            <input class="form-control font-mono" name="p2" type="number" value="0" style="width:88px; padding:5px 8px; font-size:12px;" /></div>
          <button type="submit" class="btn btn-primary btn-sm">＋ 新增項目</button>
        </form>
      </div>
    `;
  }
}
