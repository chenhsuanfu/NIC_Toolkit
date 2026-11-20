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

    container.innerHTML = `
      <div class="grid-kpi">
        <div class="card">
          <div class="kpi-label"><span>金融資金總額</span><span class="pill">${sum.accountCount} 帳戶</span></div>
          <div class="kpi-value mask-amount">$${fmtInt(sum.totalFinancialAssetsTwd)}</div>
          <div class="kpi-sub mask-amount">目標 $${fmtInt(sum.targetTotalAssetTwd)} (${(sum.goalProgress * 100).toFixed(1)}%)</div>
          <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, sum.goalProgress * 100)}%;"></div></div>
        </div>
        <div class="card">
          <div class="kpi-label"><span>流動儲蓄 + 保障資金</span></div>
          <div class="kpi-value mask-amount">$${fmtInt(sum.liquidSavingsTwd + sum.protectionTwd)}</div>
          <div class="kpi-sub mask-amount">儲蓄 $${fmtInt(sum.liquidSavingsTwd)} ｜ 保障 $${fmtInt(sum.protectionTwd)}</div>
        </div>
        <div class="card">
          <div class="kpi-label"><span>台美股帳戶總額</span></div>
          <div class="kpi-value mask-amount">$${fmtInt(sum.twStockTwd + sum.usStockTwd)}</div>
          <div class="kpi-sub mask-amount">台股 $${fmtInt(sum.twStockTwd)} ｜ 海外 $${fmtInt(sum.usStockTwd)}</div>
        </div>
        <div class="card">
          <div class="kpi-label"><span>總淨值 (含不動產扣負債)</span></div>
          <div class="kpi-value mask-amount">$${fmtInt(sum.netWorthTwd)}</div>
          <div class="kpi-sub mask-amount">總資產 $${fmtInt(sum.grossAssetsWithRealEstateTwd)} ｜ 負債 $${fmtInt(sum.totalDebtTwd)}</div>
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
        <button class="sub-tab ${this.activeTab === 'analytics' ? 'active' : ''}" data-tab="analytics">分析圖</button>
        <button class="sub-tab ${this.activeTab === 'salary' ? 'active' : ''}" data-tab="salary">薪資 (N_薪資)</button>
        <button class="sub-tab ${this.activeTab === 'logs' ? 'active' : ''}" data-tab="logs">開銷與流水</button>
        <button class="sub-tab ${this.activeTab === 'debts' ? 'active' : ''}" data-tab="debts">負債</button>
      </div>

      ${this.activeTab === 'accounts' ? this._renderAccountsTab(state, opts, sum) : ''}
      ${this.activeTab === 'analytics' ? this._renderAnalyticsTab(state) : ''}
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
          <div class="card-header"><div class="card-title">開銷結構 (${eb.count} 筆，$${fmtInt(eb.totalExpenseSample)})</div></div>
          <div style="display:flex; flex-direction:column; gap:9px;">
            ${eb.byCategory.slice(0, 8).map((c) => `
              <div>
                <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:3px;">
                  <span>${c.name}</span><span class="font-mono mask-amount">$${fmtInt(c.amount)} <span class="text-muted">${(c.ratio * 100).toFixed(1)}%</span></span>
                </div>
                <div class="progress-track" style="margin-top:0; height:6px;"><div class="progress-fill" style="width:${Math.max(1, c.ratio * 100)}%;"></div></div>
              </div>`).join('')}
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
              ${eb.byPayer.map((p) => `<span class="pill">${p.name} ${(p.ratio * 100).toFixed(0)}%</span>`).join('')}
              <span class="pill">固定 $${fmtInt(eb.fixedAmount)}</span>
              <span class="pill">變動 $${fmtInt(eb.variableAmount)}</span>
            </div>
          </div>
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
}
