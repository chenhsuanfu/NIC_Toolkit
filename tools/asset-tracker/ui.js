import { AssetCore, EXPENSE_CATEGORIES, FS_SHEET_URL } from './core.js';

const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const cleaned = String(v).replace(/(?:NT\$|US\$|[$,%\s,])/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
};
const fmtInt = (n) => toNum(n, 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });

export class AssetTrackerUI {
  constructor() {
    this.activeTab = 'accounts'; // 'accounts' | 'analytics' | 'salary' | 'logs' | 'debts'
    this.activeForm = null; // null | 'expense' | 'account_log' | 'salary'
    this.selectedCat = '餐費';
    this.reconcilingAccount = null; // account name currently inline-editing balance

    // Salary filters
    this.salaryYearFilter = 'ALL';
    this.salaryTypeFilter = 'ALL';

    // Universal table sorting state per table
    this.sortState = {
      accounts: { col: 'twd', dir: 'desc' },
      salary: { col: 'date', dir: 'desc' },
      expenses: { col: 'date', dir: 'desc' },
      logs: { col: 'date', dir: 'desc' },
      debts: { col: 'remain', dir: 'desc' }
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

  _sortHeaderHtml(tableKey, col, label, defaultDir = 'desc', align = 'left') {
    const cur = this.sortState[tableKey] || {};
    const isActive = cur.col === col;
    const arrow = isActive ? (cur.dir === 'desc' ? '▼' : '▲') : '↕';
    const style = align === 'right' ? 'text-align:right;' : '';
    return `<th class="sortable ${isActive ? 'sort-active' : ''}" data-sort-table="${tableKey}" data-sort-col="${col}" data-sort-default="${defaultDir}" style="${style}">${label}<span class="sort-indicator">${arrow}</span></th>`;
  }

  render(container, state, store, showToast) {
    const sum = AssetCore.getSummary(state);
    const accounts = state?.asset?.accounts || [];
    const subCats = EXPENSE_CATEGORIES[this.selectedCat] || [];
    const today = new Date().toISOString().slice(0, 10);

    container.innerHTML = `
      <!-- Clean Minimalist KPI Row -->
      <div class="grid-kpi">
        <div class="card">
          <div class="kpi-label">
            <span>個人總淨值 (含不動產扣負債)</span>
            <span class="pill">淨值</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(sum.netWorthTwd)}</div>
          <div class="kpi-sub mask-amount">毛資產 $${fmtInt(sum.grossAssetsTwd)} ｜ 負債 $${fmtInt(sum.totalDebtRemainingTwd)}</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>金融總資產 (現金 + 投資)</span>
            <span class="pill ${(sum.goalProgress * 100) >= 100 ? 'pill-emerald' : ''}">目標 ${(sum.goalProgress * 100).toFixed(1)}%</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(sum.totalFinancialAssetsTwd)}</div>
          <div class="kpi-sub mask-amount">目標 $${fmtInt(sum.targetGoalTwd)} ｜ 差額 $${fmtInt(Math.max(0, sum.targetGoalTwd - sum.totalFinancialAssetsTwd))}</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>流動儲蓄 + 保障預備金</span>
            <span class="pill">${sum.accountCount} 帳戶</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(sum.liquidSavingsTwd + sum.protectionTwd)}</div>
          <div class="kpi-sub mask-amount">流動 $${fmtInt(sum.liquidSavingsTwd)} ｜ 保障 $${fmtInt(sum.protectionTwd)}</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>海內外股票部位 (F&S 帳列)</span>
            <span class="pill">投資配置</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(sum.twStockTwd + sum.usStockTwd)}</div>
          <div class="kpi-sub mask-amount">國內 $${fmtInt(sum.twStockTwd)} ｜ 海外 $${fmtInt(sum.usStockTwd)}</div>
        </div>
      </div>

      <!-- Compact Action Toolbar (Forms collapsed into buttons by default) -->
      <div class="action-toolbar">
        <div class="action-toolbar-group">
          <button class="btn ${this.activeForm === 'expense' ? 'btn-primary' : 'btn-ghost'}" data-toggle-form="expense">
            ${this.activeForm === 'expense' ? '✕ 收起記開銷' : '＋ 記開銷'}
          </button>
          <button class="btn ${this.activeForm === 'account_log' ? 'btn-primary' : 'btn-ghost'}" data-toggle-form="account_log">
            ${this.activeForm === 'account_log' ? '✕ 收起帳戶收支' : '＋ 帳戶收支 / 對帳'}
          </button>
          <button class="btn ${this.activeForm === 'salary' ? 'btn-primary' : 'btn-ghost'}" data-toggle-form="salary">
            ${this.activeForm === 'salary' ? '✕ 收起記薪資' : '＋ 記薪資 (N_薪資)'}
          </button>
        </div>
        <div class="action-toolbar-group">
          <a class="btn btn-ghost btn-sm" href="${FS_SHEET_URL}" target="_blank" rel="noopener">
            ↗ 開啟 F&S Google Sheet 試算表
          </a>
        </div>
      </div>

      <!-- Collapsible Drawer Forms (Only rendered when user clicks an action button) -->
      ${this.activeForm === 'expense' ? this._renderExpenseForm(today, subCats) : ''}
      ${this.activeForm === 'account_log' ? this._renderAccountLogForm(today, accounts) : ''}
      ${this.activeForm === 'salary' ? this._renderSalaryForm(today) : ''}

      <!-- Sub-navigation Tabs -->
      <div class="tabs-bar">
        <button class="tab-btn ${this.activeTab === 'accounts' ? 'active' : ''}" data-tab="accounts">帳戶清單 (${accounts.length})</button>
        <button class="tab-btn ${this.activeTab === 'analytics' ? 'active' : ''}" data-tab="analytics">資產與收支分析圖</button>
        <button class="tab-btn ${this.activeTab === 'salary' ? 'active' : ''}" data-tab="salary">薪資紀錄 (N_薪資)</button>
        <button class="tab-btn ${this.activeTab === 'logs' ? 'active' : ''}" data-tab="logs">開銷與收支明細</button>
        <button class="tab-btn ${this.activeTab === 'debts' ? 'active' : ''}" data-tab="debts">負債與房貸</button>
      </div>

      <div id="asset-tab-content">
        ${this._renderTabContent(state, sum)}
      </div>
    `;

    this._bindEvents(container, state, store, showToast);
  }

  _renderExpenseForm(today, subCats) {
    return `
      <div class="card" style="margin-bottom:16px; border-color:var(--accent-blue);">
        <div class="card-header">
          <div class="card-title">新增日常開銷紀錄</div>
          <button type="button" class="btn btn-ghost btn-sm" data-toggle-form="expense">✕ 關閉</button>
        </div>
        <form id="form-add-expense">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">日期</label>
              <input class="form-control" type="date" name="date" value="${today}" required />
            </div>
            <div class="form-group">
              <label class="form-label">主類別</label>
              <select class="form-control" name="category" id="exp-cat-select">
                ${Object.keys(EXPENSE_CATEGORIES).map((c) => `
                  <option value="${c}" ${c === this.selectedCat ? 'selected' : ''}>${c}</option>
                `).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">子類別</label>
              <select class="form-control" name="subCategory">
                ${subCats.map((sc) => `<option value="${sc}">${sc}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">金額 (TWD)</label>
              <input class="form-control font-mono" type="number" step="1" name="amount" placeholder="例如 180" required />
            </div>
            <div class="form-group">
              <label class="form-label">項目說明</label>
              <input class="form-control" name="title" placeholder="選填，預設帶入子類別" />
            </div>
            <div class="form-group">
              <label class="form-label">支付人 / 歸屬</label>
              <select class="form-control" name="payer">
                <option value="炫甫">炫甫</option>
                <option value="垠宣">垠宣</option>
                <option value="FS">FS 共同</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">支付方式</label>
              <select class="form-control" name="paymentMethod">
                <option value="信用卡">信用卡</option>
                <option value="現金">現金</option>
                <option value="LinePay/街口">行動支付</option>
                <option value="匯款扣款">銀行轉帳</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">性質</label>
              <select class="form-control" name="isFixed">
                <option value="變動">變動支出</option>
                <option value="固定">固定支出</option>
              </select>
            </div>
          </div>
          <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
            <button type="submit" class="btn btn-primary">儲存開銷</button>
          </div>
        </form>
      </div>
    `;
  }

  _renderAccountLogForm(today, accounts) {
    return `
      <div class="card" style="margin-bottom:16px; border-color:var(--accent-blue);">
        <div class="card-header">
          <div>
            <div class="card-title">帳戶收支 / 轉帳 / 餘額校正 (log_V2)</div>
            <div class="text-muted" style="font-size:11.5px; margin-top:2px;">
              提示：若只需快速校正銀行實盤餘額，也可直接在下方「帳戶清單」點擊該列右側的「對帳校正」按鈕。
            </div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-toggle-form="account_log">✕ 關閉</button>
        </div>
        <form id="form-add-log">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">日期</label>
              <input class="form-control" type="date" name="date" value="${today}" required />
            </div>
            <div class="form-group">
              <label class="form-label">目標帳戶</label>
              <select class="form-control" name="account">
                ${accounts.map((a) => `
                  <option value="${a['帳戶名稱']}">${a['帳戶名稱']} (${a['幣別']} $${fmtInt(a['原幣金額'])})</option>
                `).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">變動類型</label>
              <select class="form-control" name="type">
                <option value="存入">存入 (+增加餘額)</option>
                <option value="轉出">轉出 (-減少餘額)</option>
                <option value="校正">餘額盤點校正 (=直接覆寫為新餘額)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">幣別</label>
              <select class="form-control" name="currency">
                <option value="TWD">TWD 台幣</option>
                <option value="USD">USD 美金</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">原幣金額</label>
              <input class="form-control font-mono" type="number" step="any" name="amount" placeholder="輸入變動或校正後餘額" required />
            </div>
            <div class="form-group">
              <label class="form-label">備註說明</label>
              <input class="form-control" name="note" placeholder="如：薪資入帳 / 對帳校正" />
            </div>
          </div>
          <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
            <button type="submit" class="btn btn-primary">寫入帳戶流水</button>
          </div>
        </form>
      </div>
    `;
  }

  _renderSalaryForm(today) {
    return `
      <div class="card" style="margin-bottom:16px; border-color:var(--accent-blue);">
        <div class="card-header">
          <div class="card-title">新增個人薪資 / 獎金紀錄 (N_薪資)</div>
          <button type="button" class="btn btn-ghost btn-sm" data-toggle-form="salary">✕ 關閉</button>
        </div>
        <form id="form-add-salary">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">入帳日期</label>
              <input class="form-control" type="date" name="date" value="${today}" required />
            </div>
            <div class="form-group">
              <label class="form-label">項目名稱</label>
              <input class="form-control" name="item" placeholder="如：11月薪水 / 績效獎金 / 年終" required />
            </div>
            <div class="form-group">
              <label class="form-label">實領金額 (TWD)</label>
              <input class="form-control font-mono" type="number" step="1" name="amount" placeholder="例如 69777" required />
            </div>
            <div class="form-group">
              <label class="form-label">明細 (如員工持股)</label>
              <input class="form-control" name="detail" placeholder="如：員工持股4000+4000" />
            </div>
            <div class="form-group">
              <label class="form-label">當期大筆花費項目</label>
              <input class="form-control" name="bigSpend" placeholder="選填" />
            </div>
            <div class="form-group">
              <label class="form-label">備註 / 銀行明細</label>
              <input class="form-control" name="note" placeholder="選填" />
            </div>
          </div>
          <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
            <button type="submit" class="btn btn-primary">儲存薪資紀錄</button>
          </div>
        </form>
      </div>
    `;
  }

  _renderTabContent(state, sum) {
    if (this.activeTab === 'accounts') {
      return this._renderAccountsTab(state, sum);
    }
    if (this.activeTab === 'analytics') {
      return this._renderAnalyticsTab(state);
    }
    if (this.activeTab === 'salary') {
      return this._renderSalaryTab(state);
    }
    if (this.activeTab === 'logs') {
      return this._renderLogsTab(state);
    }
    if (this.activeTab === 'debts') {
      return this._renderDebtsTab(state);
    }
    return '';
  }

  // ============================================================================
  // Tab 1: 帳戶清單 (含一鍵行內對帳校正 + 全欄位點擊排序)
  // ============================================================================
  _renderAccountsTab(state, sum) {
    const rawAccounts = [...(state?.asset?.accounts || [])];
    const sortCfg = this.sortState.accounts || { col: 'twd', dir: 'desc' };
    const dirMul = sortCfg.dir === 'asc' ? 1 : -1;

    rawAccounts.sort((a, b) => {
      if (sortCfg.col === 'name') return String(a['帳戶名稱'] || '').localeCompare(String(b['帳戶名稱'] || '')) * dirMul;
      if (sortCfg.col === 'attr') return String(a['資產屬性'] || '').localeCompare(String(b['資產屬性'] || '')) * dirMul;
      if (sortCfg.col === 'currency') return String(a['幣別'] || '').localeCompare(String(b['幣別'] || '')) * dirMul;
      if (sortCfg.col === 'orig') return (toNum(a['原幣金額'], 0) - toNum(b['原幣金額'], 0)) * dirMul;
      return (toNum(a['台幣金額'], 0) - toNum(b['台幣金額'], 0)) * dirMul;
    });

    return `
      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;">
          <div>
            <div class="card-title">跨幣別銀行與投資帳戶清單 (${rawAccounts.length} 戶)</div>
            <div class="text-muted" style="font-size:11.5px; margin-top:2px;">
              點擊任一欄位標題可切換排序；點擊右側「對帳校正」可直接輸入最新銀行餘額，系統自動計算差額並寫入 log_V2。
            </div>
          </div>
          <a class="btn btn-ghost btn-sm" href="${FS_SHEET_URL}" target="_blank" rel="noopener">↗ 在 Google Sheet 批次編輯</a>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${this._sortHeaderHtml('accounts', 'name', '帳戶名稱', 'asc')}
                ${this._sortHeaderHtml('accounts', 'attr', '資產屬性', 'asc')}
                ${this._sortHeaderHtml('accounts', 'currency', '幣別', 'asc')}
                ${this._sortHeaderHtml('accounts', 'orig', '原幣餘額', 'desc', 'right')}
                ${this._sortHeaderHtml('accounts', 'twd', '折合台幣 (TWD)', 'desc', 'right')}
                ${this._sortHeaderHtml('accounts', 'twd', '佔金融資產%', 'desc', 'right')}
                <th style="text-align:right;">快速對帳校正</th>
              </tr>
            </thead>
            <tbody>
              ${rawAccounts.map((acc) => {
                const name = acc['帳戶名稱'];
                const orig = toNum(acc['原幣金額'], 0);
                const twd = toNum(acc['台幣金額'], 0);
                const ratio = sum.totalFinancialAssetsTwd > 0 ? (twd / sum.totalFinancialAssetsTwd) * 100 : 0;
                const isEditing = this.reconcilingAccount === name;

                return `
                  <tr>
                    <td style="font-weight:700;">${name}</td>
                    <td><span class="pill">${acc['資產屬性'] || '一般'}</span></td>
                    <td class="font-mono">${acc['幣別'] || 'TWD'}</td>
                    <td class="font-mono mask-amount" style="text-align:right;">$${fmtInt(orig)}</td>
                    <td class="font-mono mask-amount" style="font-weight:700; text-align:right;">$${fmtInt(twd)}</td>
                    <td class="font-mono text-muted" style="text-align:right;">${ratio.toFixed(1)}%</td>
                    <td style="text-align:right;">
                      ${isEditing ? `
                        <div style="display:inline-flex; align-items:center; gap:4px;">
                          <input type="number" step="any" class="form-control font-mono" id="reconcile-input" value="${orig}" style="width:115px; padding:4px 7px; font-size:12px;" />
                          <button type="button" class="btn btn-primary btn-sm" data-confirm-reconcile="${name}">確認</button>
                          <button type="button" class="btn btn-ghost btn-sm" data-cancel-reconcile="1">取消</button>
                        </div>
                      ` : `
                        <button type="button" class="btn btn-ghost btn-sm" data-start-reconcile="${name}">對帳校正</button>
                      `}
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

  // ============================================================================
  // Tab 2: 資產與收支分析圖 (F&S 原生分析圖完整重現)
  // ============================================================================
  _renderAnalyticsTab(state) {
    const data = AssetCore.getAnalyticsData(state);
    const { snapshots, allocation, cashflowHistory, expenseBreakdown, summary } = data;

    return `
      <!-- Row 1: Long-Term Asset & Net Worth Growth Chart + Allocation Breakdown -->
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">長期資產與個人淨值成長趨勢 (${snapshots.length ? `${snapshots[0].date.slice(0, 7)} ~ ${snapshots[snapshots.length - 1].date.slice(0, 7)}` : '歷史趨勢'})</div>
              <div class="text-muted" style="font-size:11.5px;">包含毛資產 (含不動產)、個人淨值 (扣房貸信貸) 與金融總資產趨勢</div>
            </div>
          </div>
          ${this._renderNetWorthSvgChart(snapshots, summary.targetGoalTwd)}
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">金融資產配置結構 ($${fmtInt(summary.totalFinancialAssetsTwd)})</div>
              <div class="text-muted" style="font-size:11.5px;">目標達成率 ${(summary.goalProgress * 100).toFixed(1)}%（目標 $${fmtInt(summary.targetGoalTwd)}）</div>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:14px; margin-top:8px;">
            ${allocation.map((item) => {
              const pct = (item.ratio * 100).toFixed(1);
              return `
                <div>
                  <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:5px;">
                    <span style="font-weight:600;">${item.label}</span>
                    <span class="font-mono mask-amount">$${fmtInt(item.amount)} <span class="text-muted">(${pct}%)</span></span>
                  </div>
                  <div style="height:8px; background:var(--bg-subtle); border-radius:999px; overflow:hidden; border:1px solid var(--border-color);">
                    <div style="height:100%; width:${Math.min(100, Math.max(2, item.ratio * 100))}%; background:var(--accent-blue); border-radius:999px;"></div>
                  </div>
                </div>
              `;
            }).join('')}

            <div style="margin-top:8px; padding-top:12px; border-top:1px solid var(--border-color); display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; text-align:center;">
              <div style="padding:8px; background:var(--bg-subtle); border-radius:8px;">
                <div class="text-muted" style="font-size:11px;">不動產估值</div>
                <div class="font-mono mask-amount" style="font-weight:700; margin-top:2px;">$${fmtInt(summary.realEstateTwd)}</div>
              </div>
              <div style="padding:8px; background:var(--bg-subtle); border-radius:8px;">
                <div class="text-muted" style="font-size:11px;">剩餘總負債</div>
                <div class="font-mono mask-amount text-rose" style="font-weight:700; margin-top:2px;">-$${fmtInt(summary.totalDebtRemainingTwd)}</div>
              </div>
              <div style="padding:8px; background:var(--bg-subtle); border-radius:8px;">
                <div class="text-muted" style="font-size:11px;">淨值 / 毛資產比</div>
                <div class="font-mono" style="font-weight:700; margin-top:2px;">${summary.grossAssetsTwd > 0 ? ((summary.netWorthTwd / summary.grossAssetsTwd) * 100).toFixed(1) : '0.0'}%</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Row 2: Monthly Income vs Expense Cashflow Chart + Expense Category/Payer Breakdown -->
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">月度收入 vs 支出與淨儲蓄趨勢 (美股綠漲紅跌：綠=收入 / 紅=支出)</div>
              <div class="text-muted" style="font-size:11.5px;">源自 F&S 試算表月度收支統計 (${cashflowHistory.length} 個月份紀錄)</div>
            </div>
          </div>
          ${this._renderCashflowSvgChart(cashflowHistory)}
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">近期日常開銷結構分析 (${expenseBreakdown.count} 筆樣本，共 $${fmtInt(expenseBreakdown.totalExpenseSample)})</div>
              <div class="text-muted" style="font-size:11.5px;">依消費主類別、支付人 (炫甫 / 垠宣 / FS) 與固定/變動比例統計</div>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${expenseBreakdown.byCategory.slice(0, 6).map((cat) => {
              const pct = (cat.ratio * 100).toFixed(1);
              return `
                <div>
                  <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:3px;">
                    <span>${cat.name}</span>
                    <span class="font-mono mask-amount">$${fmtInt(cat.amount)} (${pct}%)</span>
                  </div>
                  <div style="height:6px; background:var(--bg-subtle); border-radius:999px; overflow:hidden;">
                    <div style="height:100%; width:${Math.min(100, Math.max(2, cat.ratio * 100))}%; background:var(--accent-blue);"></div>
                  </div>
                </div>
              `;
            }).join('')}

            <div style="margin-top:8px; padding-top:10px; border-top:1px solid var(--border-color); display:flex; flex-wrap:wrap; gap:8px; justify-content:space-between;">
              <div style="font-size:12px;">
                <span class="text-muted">支付人分佈：</span>
                ${expenseBreakdown.byPayer.map((p) => `<span class="pill" style="margin-right:4px;">${p.name} ${(p.ratio * 100).toFixed(0)}%</span>`).join('')}
              </div>
              <div style="font-size:12px;">
                <span class="text-muted">性質：</span>
                <span class="pill">變動 $${fmtInt(expenseBreakdown.variableAmount)}</span>
                <span class="pill">固定 $${fmtInt(expenseBreakdown.fixedAmount)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderNetWorthSvgChart(snapshots, targetGoalTwd) {
    if (!snapshots || snapshots.length < 2) {
      return `<div class="text-muted" style="padding:24px; text-align:center;">尚無足夠歷史快照資料</div>`;
    }
    const W = 560;
    const H = 220;
    const padL = 52;
    const padR = 16;
    const padT = 16;
    const padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxVal = Math.max(
      targetGoalTwd || 7000000,
      ...snapshots.map((s) => Math.max(s.grossAssetsTwd, s.netWorthTwd, s.financialAssetsTwd))
    ) * 1.05;
    const minVal = 0;

    const xOf = (i) => padL + (i / (snapshots.length - 1)) * plotW;
    const yOf = (v) => padT + plotH - ((Math.max(minVal, v) - minVal) / (maxVal - minVal || 1)) * plotH;

    const buildPath = (key) => snapshots
      .map((s, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(s[key]).toFixed(1)}`)
      .join(' ');

    const goalY = yOf(targetGoalTwd || 7000000);
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round((maxVal * r) / 10000)); // unit: 萬

    const xLabelIndices = [0, Math.floor(snapshots.length * 0.25), Math.floor(snapshots.length * 0.5), Math.floor(snapshots.length * 0.75), snapshots.length - 1];

    return `
      <div>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
          <!-- Horizontal grid lines -->
          ${yTicks.map((wan) => {
            const y = yOf(wan * 10000);
            return `
              <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border-color)" stroke-dasharray="3,3" />
              <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">${wan}萬</text>
            `;
          }).join('')}

          <!-- 700萬 Financial Goal Line -->
          <line x1="${padL}" y1="${goalY}" x2="${W - padR}" y2="${goalY}" stroke="var(--accent-amber)" stroke-width="1.2" stroke-dasharray="4,4" />
          <text x="${padL + 6}" y="${goalY - 4}" font-size="9.5" fill="var(--text-secondary)">金融目標 ${(targetGoalTwd / 10000).toFixed(0)}萬</text>

          <!-- Lines: Gross Assets (muted), Net Worth (emerald green), Financial Assets (primary blue) -->
          <path d="${buildPath('grossAssetsTwd')}" fill="none" stroke="var(--text-muted)" stroke-width="1.6" opacity="0.65" />
          <path d="${buildPath('netWorthTwd')}" fill="none" stroke="var(--accent-emerald)" stroke-width="2.2" />
          <path d="${buildPath('financialAssetsTwd')}" fill="none" stroke="var(--accent-blue)" stroke-width="2.2" />

          <!-- X-axis date labels -->
          ${xLabelIndices.map((idx) => {
            const item = snapshots[idx];
            if (!item) return '';
            return `<text x="${xOf(idx)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${item.date.slice(0, 7)}</text>`;
          }).join('')}
        </svg>
        <div style="display:flex; gap:14px; justify-content:center; font-size:11.5px; color:var(--text-secondary); margin-top:4px; flex-wrap:wrap;">
          <span><strong style="color:var(--accent-emerald);">●</strong> 個人淨值</span>
          <span><strong style="color:var(--accent-blue);">●</strong> 金融總資產</span>
          <span><strong style="color:var(--text-muted);">●</strong> 毛資產 (含不動產)</span>
        </div>
      </div>
    `;
  }

  _renderCashflowSvgChart(cashflowHistory) {
    const recent = cashflowHistory.slice(-18); // show up to last 18 active months for clarity
    if (recent.length === 0) {
      return `<div class="text-muted" style="padding:24px; text-align:center;">尚無月度收支統計資料</div>`;
    }

    const W = 560;
    const H = 220;
    const padL = 48;
    const padR = 14;
    const padT = 16;
    const padB = 32;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxVal = Math.max(...recent.map((c) => Math.max(c.income, c.expense)), 100000) * 1.08;
    const yOf = (v) => padT + plotH - (Math.max(0, v) / maxVal) * plotH;
    const groupW = plotW / recent.length;
    const barW = Math.max(4, Math.min(11, groupW * 0.34));

    const yTicks = [0, 0.5, 1].map((r) => Math.round((maxVal * r) / 10000));

    return `
      <div>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
          ${yTicks.map((wan) => {
            const y = yOf(wan * 10000);
            return `
              <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border-color)" stroke-dasharray="3,3" />
              <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">${wan}萬</text>
            `;
          }).join('')}

          ${recent.map((c, idx) => {
            const cx = padL + idx * groupW + groupW / 2;
            const incY = yOf(c.income);
            const incH = padT + plotH - incY;
            const expY = yOf(c.expense);
            const expH = padT + plotH - expY;
            const showLabel = idx % 3 === 0 || idx === recent.length - 1;
            return `
              <rect x="${(cx - barW - 1).toFixed(1)}" y="${incY.toFixed(1)}" width="${barW}" height="${Math.max(1, incH).toFixed(1)}" fill="var(--accent-emerald)" rx="2" />
              <rect x="${(cx + 1).toFixed(1)}" y="${expY.toFixed(1)}" width="${barW}" height="${Math.max(1, expH).toFixed(1)}" fill="var(--accent-rose)" rx="2" />
              ${showLabel ? `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="var(--text-muted)">${c.yearMonth}</text>` : ''}
            `;
          }).join('')}
        </svg>
        <div style="display:flex; gap:16px; justify-content:center; font-size:11.5px; color:var(--text-secondary); margin-top:4px;">
          <span><strong class="text-emerald">■</strong> 月收入 (Income)</span>
          <span><strong class="text-rose">■</strong> 月支出 (Expense)</span>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // Tab 3: 薪資紀錄 (N_薪資) — 2021~2026 歷年年薪分析圖 + 105 筆完整明細表
  // ============================================================================
  _renderSalaryTab(state) {
    const sal = AssetCore.getSalaryData(state, {
      year: this.salaryYearFilter,
      type: this.salaryTypeFilter
    });

    const { annualList, records, latestAnnual, firstAnnual, totalGrowthMultiple } = sal;

    // Sort records according to sortState.salary
    const sortCfg = this.sortState.salary || { col: 'date', dir: 'desc' };
    const dirMul = sortCfg.dir === 'asc' ? 1 : -1;
    const sortedRecords = [...records].sort((a, b) => {
      if (sortCfg.col === 'year') return ((a.year || 0) - (b.year || 0)) * dirMul;
      if (sortCfg.col === 'item') return String(a.item || '').localeCompare(String(b.item || '')) * dirMul;
      if (sortCfg.col === 'amount') return (toNum(a.amount, 0) - toNum(b.amount, 0)) * dirMul;
      if (sortCfg.col === 'spend') return (toNum(a.spendAmount, 0) - toNum(b.spendAmount, 0)) * dirMul;
      return String(a.date || '').localeCompare(String(b.date || '')) * dirMul;
    });

    const filteredSum = sortedRecords.reduce((acc, r) => acc + toNum(r.amount, 0), 0);

    return `
      <!-- Top Summary KPIs for N_薪資 -->
      <div class="grid-kpi">
        <div class="card">
          <div class="kpi-label">
            <span>${latestAnnual ? latestAnnual.year : 2026} 年度累計實領年薪</span>
            <span class="pill pill-emerald">最新年度</span>
          </div>
          <div class="kpi-value mask-amount text-emerald">$${fmtInt(latestAnnual?.annualSalary || 0)}</div>
          <div class="kpi-sub mask-amount">
            預估全年 $${fmtInt(latestAnnual?.estimatedAnnual || latestAnnual?.annualSalary || 0)} ｜ 月均 $${fmtInt(latestAnnual?.monthlyAvg || 0)}
          </div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>前一年度 (2025) 實領年薪</span>
            <span class="pill">年度對比</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(annualList.find((a) => a.year === 2025)?.annualSalary || 0)}</div>
          <div class="kpi-sub mask-amount">
            2025 月均 $${fmtInt(annualList.find((a) => a.year === 2025)?.monthlyAvg || 0)}
          </div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>2021 → ${latestAnnual ? latestAnnual.year : 2026} 總年薪成長倍數</span>
            <span class="pill pill-emerald">▲ +${((totalGrowthMultiple - 1) * 100).toFixed(0)}%</span>
          </div>
          <div class="kpi-value text-emerald">${totalGrowthMultiple.toFixed(2)}x</div>
          <div class="kpi-sub mask-amount">
            由 ${firstAnnual?.year || 2021} 年 $${fmtInt(firstAnnual?.annualSalary || 0)} 躍升
          </div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>目前篩選範圍合計 (${sortedRecords.length} 筆)</span>
            <span class="pill">N_薪資明細</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(filteredSum)}</div>
          <div class="kpi-sub">
            點擊上方「＋ 記薪資 (N_薪資)」可隨時新增
          </div>
        </div>
      </div>

      <!-- Annual Salary Chart + Annual Summary Table -->
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">2021 ~ 2026 歷年年薪與獎金結構趨勢圖</div>
              <div class="text-muted" style="font-size:11.5px;">區分「經常性月薪」與「績效獎金 / 年終 / 三節禮金」貢獻</div>
            </div>
          </div>
          ${this._renderSalaryAnnualSvgChart(annualList)}
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">歷年年薪與月均薪資總表 (F&S N_薪資)</div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>年度</th>
                  <th style="text-align:right;">實領年薪</th>
                  <th style="text-align:right;">月均實領</th>
                  <th style="text-align:right;">年成長 (YoY)</th>
                  <th style="text-align:right;">獎金佔比</th>
                  <th style="text-align:right;">年薪預估</th>
                </tr>
              </thead>
              <tbody>
                ${annualList.slice().reverse().map((a) => {
                  const yoy = a.yoyPct;
                  const yoyClass = yoy === null ? 'text-muted' : (yoy >= 0 ? 'text-emerald' : 'text-rose');
                  const yoyText = yoy === null ? '-' : `${yoy >= 0 ? '▲ +' : '▼ '}${yoy.toFixed(1)}%`;
                  return `
                    <tr>
                      <td class="font-mono" style="font-weight:700;">${a.year}</td>
                      <td class="font-mono mask-amount" style="text-align:right; font-weight:700;">$${fmtInt(a.annualSalary)}</td>
                      <td class="font-mono mask-amount" style="text-align:right;">$${fmtInt(a.monthlyAvg)}</td>
                      <td class="font-mono ${yoyClass}" style="text-align:right; font-weight:600;">${yoyText}</td>
                      <td class="font-mono text-muted" style="text-align:right;">${(a.bonusRatio * 100).toFixed(1)}%</td>
                      <td class="font-mono mask-amount text-muted" style="text-align:right;">${a.estimatedAnnual > 0 ? `$${fmtInt(a.estimatedAnnual)}` : '-'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Detailed N_薪資 Records Table with Year/Type Filters & Sortable Headers -->
      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;">
          <div class="card-title">N_薪資 歷年入帳明細 (${sortedRecords.length} 筆)</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <select class="form-select" id="salary-filter-year" style="width:auto; padding:5px 10px; font-size:12px;">
              <option value="ALL" ${this.salaryYearFilter === 'ALL' ? 'selected' : ''}>全部年度 (2021~2026)</option>
              ${annualList.slice().reverse().map((a) => `
                <option value="${a.year}" ${String(this.salaryYearFilter) === String(a.year) ? 'selected' : ''}>${a.year} 年</option>
              `).join('')}
            </select>
            <select class="form-select" id="salary-filter-type" style="width:auto; padding:5px 10px; font-size:12px;">
              <option value="ALL" ${this.salaryTypeFilter === 'ALL' ? 'selected' : ''}>全部項目 (月薪 + 獎金)</option>
              <option value="BASE" ${this.salaryTypeFilter === 'BASE' ? 'selected' : ''}>僅看經常性月薪</option>
              <option value="BONUS" ${this.salaryTypeFilter === 'BONUS' ? 'selected' : ''}>僅看績效獎金 / 年終 / 禮金</option>
            </select>
          </div>
        </div>

        <div class="table-wrap" style="max-height:520px; overflow-y:auto;">
          <table class="data-table">
            <thead>
              <tr>
                ${this._sortHeaderHtml('salary', 'date', '入帳日期', 'desc')}
                ${this._sortHeaderHtml('salary', 'year', '年度標籤', 'desc')}
                ${this._sortHeaderHtml('salary', 'item', '薪資/獎金項目', 'asc')}
                ${this._sortHeaderHtml('salary', 'amount', '實領金額 (TWD)', 'desc', 'right')}
                <th>明細 (如員工持股)</th>
                <th>當期大筆花費</th>
                ${this._sortHeaderHtml('salary', 'spend', '花費金額', 'desc', 'right')}
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              ${sortedRecords.map((r) => {
                const isBonus = String(r.item || '').includes('獎金') || String(r.item || '').includes('年終') || String(r.item || '').includes('禮金') || String(r.yearTag || '').includes('年終');
                return `
                  <tr>
                    <td class="font-mono">${r.date || '-'}</td>
                    <td class="font-mono">${r.yearTag || r.year || '-'}</td>
                    <td>
                      <span class="pill ${isBonus ? 'pill-emerald' : ''}">${r.item || '-'}</span>
                    </td>
                    <td class="font-mono mask-amount ${isBonus ? 'text-emerald' : ''}" style="text-align:right; font-weight:700;">
                      $${fmtInt(r.amount)}
                    </td>
                    <td class="text-muted">${r.detail || ''}</td>
                    <td class="text-muted">${r.bigSpend || ''}</td>
                    <td class="font-mono mask-amount text-muted" style="text-align:right;">
                      ${r.spendAmount > 0 ? `$${fmtInt(r.spendAmount)}` : ''}
                    </td>
                    <td class="text-muted">${r.note || r.bankDetail || ''}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderSalaryAnnualSvgChart(annualList) {
    if (!annualList || annualList.length === 0) {
      return `<div class="text-muted" style="padding:20px; text-align:center;">無年度薪資統計</div>`;
    }
    const W = 540;
    const H = 210;
    const padL = 48;
    const padR = 16;
    const padT = 22;
    const padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxSalary = Math.max(...annualList.map((a) => Math.max(a.annualSalary, a.estimatedAnnual || 0)), 1600000) * 1.1;
    const yOf = (v) => padT + plotH - (Math.max(0, v) / maxSalary) * plotH;
    const groupW = plotW / annualList.length;
    const barW = Math.min(42, groupW * 0.52);

    const yTicks = [0, 50, 100, 150];

    return `
      <div>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
          ${yTicks.map((wan) => {
            const y = yOf(wan * 10000);
            return `
              <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border-color)" stroke-dasharray="3,3" />
              <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">${wan}萬</text>
            `;
          }).join('')}

          ${annualList.map((a, idx) => {
            const cx = padL + idx * groupW + groupW / 2;
            const total = a.annualSalary;
            const bonus = Math.min(total, a.bonusTotal || 0);
            const base = Math.max(0, total - bonus);

            const baseY = yOf(base);
            const baseH = padT + plotH - baseY;
            const totalY = yOf(total);
            const bonusH = Math.max(0, baseY - totalY);

            return `
              <!-- Base Salary Segment -->
              <rect x="${(cx - barW / 2).toFixed(1)}" y="${baseY.toFixed(1)}" width="${barW}" height="${Math.max(1, baseH).toFixed(1)}" fill="var(--accent-blue)" rx="2" />
              <!-- Bonus Segment on top -->
              ${bonusH > 0 ? `<rect x="${(cx - barW / 2).toFixed(1)}" y="${totalY.toFixed(1)}" width="${barW}" height="${bonusH.toFixed(1)}" fill="var(--accent-emerald)" rx="2" />` : ''}
              <!-- Total Label -->
              <text x="${cx.toFixed(1)}" y="${(totalY - 5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text-primary)">${(total / 10000).toFixed(1)}萬</text>
              <!-- Year Label -->
              <text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text-secondary)">${a.year}</text>
            `;
          }).join('')}
        </svg>
        <div style="display:flex; gap:16px; justify-content:center; font-size:11.5px; color:var(--text-secondary); margin-top:4px;">
          <span><strong style="color:var(--accent-blue);">■</strong> 經常性月薪</span>
          <span><strong class="text-emerald">■</strong> 績效獎金 / 年終 / 三節</span>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // Tab 4: 開銷與收支明細 (Sortable Tables)
  // ============================================================================
  _renderLogsTab(state) {
    const expenses = [...(state?.asset?.recentExpenses || [])];
    const logs = [...(state?.asset?.recentLogs || [])];

    const expSort = this.sortState.expenses || { col: 'date', dir: 'desc' };
    const expMul = expSort.dir === 'asc' ? 1 : -1;
    expenses.sort((a, b) => {
      if (expSort.col === 'cat') return String(a['主類別'] || '').localeCompare(String(b['主類別'] || '')) * expMul;
      if (expSort.col === 'amount') return (toNum(a['金額'], 0) - toNum(b['金額'], 0)) * expMul;
      if (expSort.col === 'payer') return String(a['支付人'] || '').localeCompare(String(b['支付人'] || '')) * expMul;
      return String(a['日期'] || '').localeCompare(String(b['日期'] || '')) * expMul;
    });

    const logSort = this.sortState.logs || { col: 'date', dir: 'desc' };
    const logMul = logSort.dir === 'asc' ? 1 : -1;
    logs.sort((a, b) => {
      if (logSort.col === 'account') return String(a['帳戶名稱'] || '').localeCompare(String(b['帳戶名稱'] || '')) * logMul;
      if (logSort.col === 'type') return String(a['類別'] || '').localeCompare(String(b['類別'] || '')) * logMul;
      if (logSort.col === 'amount') return (toNum(a['原幣變動'], 0) - toNum(b['原幣變動'], 0)) * logMul;
      return String(a['日期'] || '').localeCompare(String(b['日期'] || '')) * logMul;
    });

    return `
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div class="card-title">日常開銷明細 (${expenses.length} 筆)</div>
          </div>
          <div class="table-wrap" style="max-height:480px; overflow-y:auto;">
            <table class="data-table">
              <thead>
                <tr>
                  ${this._sortHeaderHtml('expenses', 'date', '日期', 'desc')}
                  ${this._sortHeaderHtml('expenses', 'cat', '類別', 'asc')}
                  <th>項目</th>
                  ${this._sortHeaderHtml('expenses', 'amount', '金額', 'desc', 'right')}
                  ${this._sortHeaderHtml('expenses', 'payer', '支付人', 'asc')}
                </tr>
              </thead>
              <tbody>
                ${expenses.slice(0, 80).map((e) => `
                  <tr>
                    <td class="font-mono">${e['日期']}</td>
                    <td><span class="pill">${e['主類別']} · ${e['子類別']}</span></td>
                    <td>${e['項目']}</td>
                    <td class="font-mono mask-amount text-rose" style="text-align:right; font-weight:700;">-$${fmtInt(e['金額'])}</td>
                    <td class="text-muted">${e['支付人'] || ''} (${e['支付方式'] || ''})</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">帳戶收支與對帳流水 log_V2 (${logs.length} 筆)</div>
          </div>
          <div class="table-wrap" style="max-height:480px; overflow-y:auto;">
            <table class="data-table">
              <thead>
                <tr>
                  ${this._sortHeaderHtml('logs', 'date', '日期', 'desc')}
                  ${this._sortHeaderHtml('logs', 'account', '帳戶名稱', 'asc')}
                  ${this._sortHeaderHtml('logs', 'type', '類別', 'asc')}
                  ${this._sortHeaderHtml('logs', 'amount', '原幣變動', 'desc', 'right')}
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                ${logs.slice(0, 80).map((l) => {
                  const amt = toNum(l['原幣變動'], 0);
                  return `
                    <tr>
                      <td class="font-mono">${l['日期']}</td>
                      <td style="font-weight:600;">${l['帳戶名稱']}</td>
                      <td><span class="pill ${amt >= 0 ? 'pill-emerald' : 'pill-rose'}">${l['類別']}</span></td>
                      <td class="font-mono mask-amount ${amt >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right; font-weight:700;">
                        ${amt >= 0 ? '+' : ''}${fmtInt(amt)} ${l['幣別'] || 'TWD'}
                      </td>
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

  // ============================================================================
  // Tab 5: 負債與房貸追蹤
  // ============================================================================
  _renderDebtsTab(state) {
    const debts = [...(state?.asset?.debts || [])];
    const sortCfg = this.sortState.debts || { col: 'remain', dir: 'desc' };
    const dirMul = sortCfg.dir === 'asc' ? 1 : -1;
    debts.sort((a, b) => {
      if (sortCfg.col === 'name') return String(a['項目名稱'] || '').localeCompare(String(b['項目名稱'] || '')) * dirMul;
      if (sortCfg.col === 'orig') return (toNum(a['原始總額'], 0) - toNum(b['原始總額'], 0)) * dirMul;
      return (toNum(a['剩餘本金'], 0) - toNum(b['剩餘本金'], 0)) * dirMul;
    });

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">負債與房貸 / 信貸追蹤表</div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${this._sortHeaderHtml('debts', 'name', '貸款項目', 'asc')}
                ${this._sortHeaderHtml('debts', 'orig', '原始貸款總額', 'desc', 'right')}
                ${this._sortHeaderHtml('debts', 'remain', '目前剩餘本金', 'desc', 'right')}
                <th style="text-align:right;">已償還進度</th>
                <th style="text-align:right;">每月應繳金額</th>
                <th>狀態備註</th>
              </tr>
            </thead>
            <tbody>
              ${debts.map((d) => {
                const orig = toNum(d['原始總額'], 1);
                const rem = toNum(d['剩餘本金'], 0);
                const paidPct = Math.max(0, Math.min(100, ((orig - rem) / orig) * 100));
                return `
                  <tr>
                    <td style="font-weight:700;">${d['項目名稱']}</td>
                    <td class="font-mono mask-amount" style="text-align:right;">$${fmtInt(orig)}</td>
                    <td class="font-mono mask-amount text-rose" style="text-align:right; font-weight:700;">$${fmtInt(rem)}</td>
                    <td class="font-mono text-emerald" style="text-align:right;">${paidPct.toFixed(1)}%</td>
                    <td class="font-mono mask-amount" style="text-align:right;">$${fmtInt(d['每期應繳'])}</td>
                    <td><span class="pill">${d['備註']}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _bindEvents(container, state, store, showToast) {
    // Toggle collapsible forms
    container.querySelectorAll('[data-toggle-form]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-toggle-form');
        this.activeForm = this.activeForm === target ? null : target;
        this.render(container, store.getState(), store, showToast);
      });
    });

    // Switch sub-tabs
    container.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.getAttribute('data-tab');
        this.reconcilingAccount = null;
        this.render(container, store.getState(), store, showToast);
      });
    });

    // Universal table column sort
    container.querySelectorAll('th[data-sort-table]').forEach((th) => {
      th.addEventListener('click', () => {
        const tbl = th.getAttribute('data-sort-table');
        const col = th.getAttribute('data-sort-col');
        const def = th.getAttribute('data-sort-default') || 'desc';
        this._toggleSort(tbl, col, def);
        this.render(container, store.getState(), store, showToast);
      });
    });

    // Dynamic Sub-category selector in expense form
    const catSelect = container.querySelector('#exp-cat-select');
    if (catSelect) {
      catSelect.addEventListener('change', (e) => {
        this.selectedCat = e.target.value;
        this.render(container, store.getState(), store, showToast);
      });
    }

    // Submit Expense Form
    const expForm = container.querySelector('#form-add-expense');
    if (expForm) {
      expForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(expForm);
        try {
          const res = AssetCore.addExpense(store.getState(), Object.fromEntries(fd.entries()), store);
          showToast(`已記帳：${res.record['主類別']} - ${res.record['項目']} ($${fmtInt(res.record['金額'])})`);
          this.activeForm = null;
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`錯誤：${err.message}`);
        }
      });
    }

    // Submit Account Log Form
    const logForm = container.querySelector('#form-add-log');
    if (logForm) {
      logForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(logForm);
        try {
          const res = AssetCore.addAccountLog(store.getState(), Object.fromEntries(fd.entries()), store);
          showToast(`已更新帳戶：${res.logItem['帳戶名稱']} (${res.logItem['類別']} $${fmtInt(res.logItem['原幣變動'])})`);
          this.activeForm = null;
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`錯誤：${err.message}`);
        }
      });
    }

    // Submit Salary Form (N_薪資)
    const salForm = container.querySelector('#form-add-salary');
    if (salForm) {
      salForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(salForm);
        try {
          const res = AssetCore.addSalaryRecord(store.getState(), Object.fromEntries(fd.entries()), store);
          showToast(`已新增薪資紀錄：${res.record.item} ($${fmtInt(res.record.amount)})`);
          this.activeForm = null;
          this.activeTab = 'salary';
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`錯誤：${err.message}`);
        }
      });
    }

    // Inline Quick Account Reconciliation (對帳校正)
    container.querySelectorAll('[data-start-reconcile]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.reconcilingAccount = btn.getAttribute('data-start-reconcile');
        this.render(container, store.getState(), store, showToast);
        const inp = container.querySelector('#reconcile-input');
        if (inp) {
          inp.focus();
          inp.select();
        }
      });
    });

    container.querySelectorAll('[data-cancel-reconcile]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.reconcilingAccount = null;
        this.render(container, store.getState(), store, showToast);
      });
    });

    container.querySelectorAll('[data-confirm-reconcile]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const account = btn.getAttribute('data-confirm-reconcile');
        const inp = container.querySelector('#reconcile-input');
        const actualBalance = inp ? inp.value : 0;
        try {
          const res = AssetCore.reconcileAccountBalance(store.getState(), { account, actualBalance }, store);
          const sign = res.deltaOrig >= 0 ? '+' : '';
          showToast(`對帳完成：${account} 餘額已更新為 $${fmtInt(res.newOrig)} (差額 ${sign}${fmtInt(res.deltaOrig)})`);
          this.reconcilingAccount = null;
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`錯誤：${err.message}`);
        }
      });
    });

    // Salary Filters
    const salYearSel = container.querySelector('#salary-filter-year');
    if (salYearSel) {
      salYearSel.addEventListener('change', (e) => {
        this.salaryYearFilter = e.target.value;
        this.render(container, store.getState(), store, showToast);
      });
    }
    const salTypeSel = container.querySelector('#salary-filter-type');
    if (salTypeSel) {
      salTypeSel.addEventListener('change', (e) => {
        this.salaryTypeFilter = e.target.value;
        this.render(container, store.getState(), store, showToast);
      });
    }
  }
}
