import { GoodStockCore } from './core.js';
import { GoodStockData } from './data.js';

const fmtNum = (n, d = 2) => {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '-';
  return Number(n).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const fmtInt = (n) => {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '-';
  return Math.round(Number(n)).toLocaleString('zh-TW');
};

export class GoodStockUI {
  constructor() {
    this.mainTab = 'screener'; // 'screener' | 'stock_info' | 'pk'
    this.screenerMode = 'six_indicators'; // 'six_indicators' | 'strong' | 'financial' | 'trend' | 'newhigh'
    this.selectedCode = '2330';
    this.infoSection = 'all'; // 'all' | 'report' | 'health' | 'target1y' | 'target3y'
    this.healthTab = 'six'; // 'landmines' | 'six' | 'growth'
    this.pkCodeA = '5274';
    this.pkCodeB = '2059';
    this.customPeBands = null;
    this.isFetchingLive = false;
    this.isSyncingAllPrices = false;
    this.isSyncingAllFinancials = false;
    this.syncFinProgress = null; // { done, total, successCount, failCount, lastCode }
    this.showAdvancedFilters = false; // Collapsed by default for clean mobile & desktop layout

    // Universal table sort state across all 5 screeners
    this.tableSort = {
      six_indicators: { col: 'avgScore', dir: 'desc' },
      strong: { col: 'gain', dir: 'desc' },
      financial: { col: 'doubleArrow', dir: 'desc' },
      trend: { col: 'change10dPct', dir: 'desc' },
      newhigh: { col: 'avgScore', dir: 'desc' }
    };

    this.sixFilters = {
      scope: 'ALL',
      industry: 'ALL',
      minAvgScore: 0,
      maxLandmines: '',
      momDeltaMode: 'ALL',
      qoqDeltaMode: 'ALL',
      improvedItem: 'ALL',
      minRevScore: 0,
      minOpScore: 0,
      minProfitScore: 0,
      minEpsScore: 0,
      minInvScore: 0,
      minFcfScore: 0,
      sortBy: 'avgScore'
    };

    this.strongFilters = {
      scope: 'ALL',
      minPrice: 50,
      minVolumeLots: 100,
      lookbackDays: 5,
      minGainPct: 6,
      requireVolSurge: true,
      minVolSurgePct: 25
    };

    this.finFilters = {
      scope: 'ALL',
      industry: 'ALL',
      minOpMargin: 10,
      maxOpMargin: '',
      minEps: 1,
      maxEps: '',
      minRevYoY: 20,
      maxRevYoY: '',
      minCumYoY: 20,
      maxCumYoY: '',
      minDoubleArrow: '',
      maxDoubleArrow: '',
      minPrice: '',
      maxPrice: '',
      minPe: '',
      maxPe: '',
      minChange1m: '',
      maxChange1m: '',
      minVolume: '',
      maxVolume: '',
      sortBy: 'doubleArrow'
    };

    this.trendFilters = {
      scope: 'ALL',
      trendDays: 10,
      minMovePct: 10,
      breakLowDays: 0
    };

    this.newHighFilters = {
      scope: 'ALL',
      revHighMonths: 12,
      opHighQuarters: 4,
      epsHighQuarters: 4,
      priceHighDays: 60,
      volHighDays: 0
    };
  }

  openStockInfo(rawCode, subView = 'all') {
    const clean = String(rawCode || '2330').replace(/\.TW$/i, '').trim();
    this.selectedCode = clean || '2330';
    this.mainTab = 'stock_info';
    this.infoSection = subView || 'all';
    this.customPeBands = null;
  }

  _toggleSort(mode, col, defaultDir = 'desc') {
    const cur = this.tableSort[mode] || { col, dir: defaultDir };
    if (cur.col === col) {
      cur.dir = cur.dir === 'desc' ? 'asc' : 'desc';
    } else {
      cur.col = col;
      cur.dir = defaultDir;
    }
    this.tableSort[mode] = cur;
  }

  _sortTh(mode, col, label, defaultDir = 'desc', align = 'right') {
    const cur = this.tableSort[mode] || {};
    const isAct = cur.col === col;
    const arrow = isAct ? (cur.dir === 'desc' ? '▼' : '▲') : '↕';
    const alignCss = align === 'right' ? 'text-align:right;' : '';
    return `<th class="sortable ${isAct ? 'sort-active' : ''}" data-gs-sort-mode="${mode}" data-gs-sort-col="${col}" data-gs-sort-def="${defaultDir}" style="${alignCss}">${label}<span class="sort-indicator">${arrow}</span></th>`;
  }

  _sortResults(mode, list, lookbackDays = 5) {
    const cfg = this.tableSort[mode] || { col: 'avgScore', dir: 'desc' };
    const mul = cfg.dir === 'asc' ? 1 : -1;
    const col = cfg.col;
    return [...list].sort((a, b) => {
      if (col === 'code') return String(a.code || '').localeCompare(String(b.code || '')) * mul;
      if (col === 'industry') return String(a.industry || '').localeCompare(String(b.industry || '')) * mul;
      if (col === 'price') return ((a.price || 0) - (b.price || 0)) * mul;
      if (col === 'pe') return ((a.pe || 999) - (b.pe || 999)) * mul;
      if (col === 'avgScore') return ((a.sixEval?.current?.avgScore || 0) - (b.sixEval?.current?.avgScore || 0)) * mul;
      if (col === 'deltaMoM') return ((a.sixEval?.deltaMoM || 0) - (b.sixEval?.deltaMoM || 0)) * mul;
      if (col === 'deltaQoQ') return ((a.sixEval?.deltaQoQ || 0) - (b.sixEval?.deltaQoQ || 0)) * mul;
      if (col === 's0') return ((a.sixEval?.itemComparisons?.[0]?.score ?? -1) - (b.sixEval?.itemComparisons?.[0]?.score ?? -1)) * mul;
      if (col === 's1') return ((a.sixEval?.itemComparisons?.[1]?.score ?? -1) - (b.sixEval?.itemComparisons?.[1]?.score ?? -1)) * mul;
      if (col === 's2') return ((a.sixEval?.itemComparisons?.[2]?.score ?? -1) - (b.sixEval?.itemComparisons?.[2]?.score ?? -1)) * mul;
      if (col === 's3') return ((a.sixEval?.itemComparisons?.[3]?.score ?? -1) - (b.sixEval?.itemComparisons?.[3]?.score ?? -1)) * mul;
      if (col === 's4') return ((a.sixEval?.itemComparisons?.[4]?.score ?? -1) - (b.sixEval?.itemComparisons?.[4]?.score ?? -1)) * mul;
      if (col === 's5') return ((a.sixEval?.itemComparisons?.[5]?.score ?? -1) - (b.sixEval?.itemComparisons?.[5]?.score ?? -1)) * mul;
      if (col === 'landmines') return ((a.landmines?.hitCount || 0) - (b.landmines?.hitCount || 0)) * mul;
      if (col === 'doubleArrow') return ((a.doubleArrow || 0) - (b.doubleArrow || 0)) * mul;
      if (col === 'gain') {
        const gA = lookbackDays >= 10 ? a.change10dPct : a.change5dPct;
        const gB = lookbackDays >= 10 ? b.change10dPct : b.change5dPct;
        return ((gA || 0) - (gB || 0)) * mul;
      }
      if (col === 'change1mPct') return ((a.change1mPct || 0) - (b.change1mPct || 0)) * mul;
      if (col === 'change5dPct') return ((a.change5dPct || 0) - (b.change5dPct || 0)) * mul;
      if (col === 'change10dPct') return ((a.change10dPct || 0) - (b.change10dPct || 0)) * mul;
      if (col === 'change20dPct') return ((a.change20dPct || 0) - (b.change20dPct || 0)) * mul;
      if (col === 'volumeLots') return ((a.volumeLots || 0) - (b.volumeLots || 0)) * mul;
      if (col === 'latestOpMargin') return ((a.latestOpMargin || 0) - (b.latestOpMargin || 0)) * mul;
      if (col === 'latestEps') return ((a.latestEps || 0) - (b.latestEps || 0)) * mul;
      if (col === 'latestNetMargin') return ((a.latestNetMargin || 0) - (b.latestNetMargin || 0)) * mul;
      if (col === 'latestRevYoY') return ((a.latestRevYoY || 0) - (b.latestRevYoY || 0)) * mul;
      if (col === 'latestCumYoY') return ((a.latestCumYoY || 0) - (b.latestCumYoY || 0)) * mul;
      if (col === 'revNewHighMonths') return ((a.revNewHighMonths || 0) - (b.revNewHighMonths || 0)) * mul;
      return 0;
    });
  }

  render(container, state, store, showToast) {
    if (!this._universeTriggered) {
      this._universeTriggered = true;
      GoodStockCore.loadUniverseIndex().then((idx) => {
        if (idx && idx.stocks?.length) {
          this.render(container, store.getState(), store, showToast);
        }
      });
    }
    const universe = GoodStockCore.getEnrichedUniverse(state);
    const industries = Array.from(new Set(universe.map((s) => s.industry))).filter(Boolean);

    container.innerHTML = `
      <!-- Clean Compact Top Toolbar -->
      <div class="action-toolbar">
        <div class="action-toolbar-group">
          <button class="btn ${this.mainTab === 'screener' ? 'btn-primary' : 'btn-ghost'}" data-gs-main="screener">
            ① 選股功能 (5大引擎)
          </button>
          <button class="btn ${this.mainTab === 'stock_info' ? 'btn-primary' : 'btn-ghost'}" data-gs-main="stock_info">
            ② 股票資訊 (${this.selectedCode})
          </button>
          <button class="btn ${this.mainTab === 'pk' ? 'btn-primary' : 'btn-ghost'}" data-gs-main="pk">
            ③ 雙股PK (${this.pkCodeA} vs ${this.pkCodeB})
          </button>
        </div>

        <div class="action-toolbar-group">
          <input type="text" class="form-control font-mono" id="gs-quick-jump-input" placeholder="輸入代號/名稱 (如 3037)" style="width:148px; padding:5px 9px;" />
          <button class="btn btn-ghost btn-sm" id="btn-gs-quick-jump">查詢</button>
          <button class="btn ${this.isSyncingAllFinancials ? 'btn-primary' : 'btn-ghost'} btn-sm" id="btn-gs-sync-all-financials" ${this.isSyncingAllFinancials ? 'disabled' : ''}>
            ${this.isSyncingAllFinancials && this.syncFinProgress
              ? `同步財報 (${this.syncFinProgress.done}/${this.syncFinProgress.total})`
              : `同步真實財報 (${universe.filter((s) => s.dataSource === 'finmind-live').length}/${universe.length})`}
          </button>
          <button class="btn btn-ghost btn-sm" id="btn-gs-sync-all-prices" ${this.isSyncingAllPrices ? 'disabled' : ''}>
            ${this.isSyncingAllPrices ? '同步中...' : `同步最新股價 (${universe.length}檔)`}
          </button>
          <a class="btn btn-ghost btn-sm" href="https://github.com/chenhsuanfu/NIC_Toolkit/actions/workflows/update-goodstock-universe.yml" target="_blank" rel="noopener" title="前往 GitHub Actions 立即觸發上市＋上櫃全市場抓取">
            ⚡ 觸發全市場更新
          </a>
          <button class="btn btn-ghost btn-sm" id="btn-gs-reload-universe" title="重新讀取最新 tw-universe-index.json">
            🔄 重載全市場索引
          </button>
        </div>
      </div>

      <div id="goodstock-main-body">
        ${this.mainTab === 'screener' ? this._renderScreenerMain(state, universe, industries) : ''}
        ${this.mainTab === 'stock_info' ? this._renderStockInfoMain(state, universe) : ''}
        ${this.mainTab === 'pk' ? this._renderPkMain(state, universe) : ''}
      </div>
    `;

    this._bindEvents(container, state, store, showToast);
  }

  _renderScreenerMain(state, universe, industries) {
    return `
      <div class="sub-tabs">
        <button class="sub-tab ${this.screenerMode === 'six_indicators' ? 'active' : ''}" data-gs-screen="six_indicators">
          六大指標選股 (含前月/前季比較)
        </button>
        <button class="sub-tab ${this.screenerMode === 'strong' ? 'active' : ''}" data-gs-screen="strong">
          近期強勢股
        </button>
        <button class="sub-tab ${this.screenerMode === 'financial' ? 'active' : ''}" data-gs-screen="financial">
          財務選股 (雙箭頭)
        </button>
        <button class="sub-tab ${this.screenerMode === 'trend' ? 'active' : ''}" data-gs-screen="trend">
          趨勢選股
        </button>
        <button class="sub-tab ${this.screenerMode === 'newhigh' ? 'active' : ''}" data-gs-screen="newhigh">
          創新高選股
        </button>
      </div>

      ${this.screenerMode === 'six_indicators' ? this._renderSixIndicatorsScreener(state, industries) : ''}
      ${this.screenerMode === 'strong' ? this._renderStrongScreener(state) : ''}
      ${this.screenerMode === 'financial' ? this._renderFinancialScreener(state, industries) : ''}
      ${this.screenerMode === 'trend' ? this._renderTrendScreener(state) : ''}
      ${this.screenerMode === 'newhigh' ? this._renderNewHighScreener(state) : ''}
    `;
  }

  _renderDeltaBadge(delta, prefix = '') {
    const d = Number(delta || 0);
    if (d > 0) {
      return `<span class="pill pill-emerald">${prefix}▲ +${d.toFixed(2)}</span>`;
    }
    if (d < 0) {
      return `<span class="pill pill-rose">${prefix}▼ ${d.toFixed(2)}</span>`;
    }
    return `<span class="pill">${prefix}0.00</span>`;
  }

  _renderItemScoreCell(itemComp) {
    if (!itemComp || itemComp.score === null) {
      return `<span class="text-muted" style="font-size:11px;">-</span>`;
    }
    const s = itemComp.score;
    const cls = s >= 3.5 ? 'text-emerald' : s < 2.0 ? 'text-rose' : '';
    const arrows = [];
    if (itemComp.deltaMoM > 0) arrows.push(`<span class="text-emerald" title="較前月 +${itemComp.deltaMoM}">月▲</span>`);
    else if (itemComp.deltaMoM < 0) arrows.push(`<span class="text-rose" title="較前月 ${itemComp.deltaMoM}">月▼</span>`);

    if (itemComp.deltaQoQ > 0) arrows.push(`<span class="text-emerald" title="較前季 +${itemComp.deltaQoQ}">季▲</span>`);
    else if (itemComp.deltaQoQ < 0) arrows.push(`<span class="text-rose" title="較前季 ${itemComp.deltaQoQ}">季▼</span>`);

    return `
      <div class="font-mono ${cls}" style="font-weight:700;">${s.toFixed(1)}</div>
      ${arrows.length ? `<div style="font-size:10px; line-height:1.1;">${arrows.join(' ')}</div>` : ''}
    `;
  }

  _renderSixIndicatorsScreener(state, industries) {
    const f = this.sixFilters;
    const rawResults = GoodStockCore.screenStocks(state, 'six_indicators', f);
    const results = this._sortResults('six_indicators', rawResults);

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="action-toolbar" style="margin-bottom:0;">
          <div class="action-toolbar-group">
            <button class="btn btn-ghost btn-sm" data-six-preset="ETF_0050">0050 成分股 (50檔)</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="ALL_HIGH">資優高分 (≥3.0分)</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="MOM_UP">較前月轉強 (MoM ▲)</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="QOQ_UP">較前季躍進 (QoQ ▲)</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="DUAL_UP">雙重成長</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="MY_HOLDINGS">我的庫存台股</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="WEAKENING">評分轉弱 (▼)</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="RESET">↺ 重設</button>
          </div>
          <button class="btn ${this.showAdvancedFilters ? 'btn-primary' : 'btn-ghost'} btn-sm" id="btn-toggle-gs-filters">
            ${this.showAdvancedFilters ? '▲ 收起進階篩選' : '▾ 進階篩選條件'}
          </button>
        </div>

        ${this.showAdvancedFilters ? `
          <div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border-color);">
            <div class="form-grid" style="margin-bottom:10px;">
              <div class="form-group">
                <label class="form-label">篩選範圍</label>
                <select class="form-select" id="six-scope">
                  <option value="ALL" ${f.scope === 'ALL' ? 'selected' : ''}>全股票池 (${GoodStockData.getAllStocks().length} 檔)</option>
                  <option value="ETF_0050" ${f.scope === 'ETF_0050' ? 'selected' : ''}>0050 台灣50成分股 (50 檔)</option>
                  <option value="HOLDINGS" ${f.scope === 'HOLDINGS' ? 'selected' : ''}>僅看我的庫存持股</option>
                  <option value="WATCHLIST" ${f.scope === 'WATCHLIST' ? 'selected' : ''}>僅看我的觀察清單</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">產業別</label>
                <select class="form-select" id="six-industry">
                  <option value="ALL">全部產業</option>
                  ${industries.map((ind) => `<option value="${ind}" ${f.industry === ind ? 'selected' : ''}>${ind}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">當期平均分區間 (0.0 ~ 4.0)</label>
                <div style="display:flex; align-items:center; gap:6px;">
                  <input class="form-control font-mono" id="six-min-avg" type="number" step="0.1" min="0" max="4" value="${f.minAvgScore ?? 0}" style="width:76px; padding:6px 8px;" />
                  <span class="text-muted">~</span>
                  <input class="form-control font-mono" id="six-max-avg" type="number" step="0.1" min="0" max="4" value="${f.maxAvgScore ?? 4}" style="width:76px; padding:6px 8px;" />
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">財務地雷上限 (共7項)</label>
                <select class="form-select" id="six-max-landmines">
                  <option value="" ${f.maxLandmines === '' ? 'selected' : ''}>不限</option>
                  <option value="0" ${String(f.maxLandmines) === '0' ? 'selected' : ''}>0 項地雷</option>
                  <option value="1" ${String(f.maxLandmines) === '1' ? 'selected' : ''}>≤ 1 項地雷</option>
                  <option value="2" ${String(f.maxLandmines) === '2' ? 'selected' : ''}>≤ 2 項地雷</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">與前一個月比較 (ΔMoM)</label>
                <select class="form-select" id="six-mom-mode">
                  <option value="ALL" ${f.momDeltaMode === 'ALL' ? 'selected' : ''}>不限</option>
                  <option value="UP" ${f.momDeltaMode === 'UP' ? 'selected' : ''}>▲ 較前月上升 (&gt; 0)</option>
                  <option value="UP_015" ${f.momDeltaMode === 'UP_015' ? 'selected' : ''}>▲ 較前月明顯上升 (≥ +0.15)</option>
                  <option value="NON_DEC" ${f.momDeltaMode === 'NON_DEC' ? 'selected' : ''}>持平或上升 (≥ 0)</option>
                  <option value="DOWN" ${f.momDeltaMode === 'DOWN' ? 'selected' : ''}>▼ 較前月下降 (&lt; 0)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">與前一季比較 (ΔQoQ)</label>
                <select class="form-select" id="six-qoq-mode">
                  <option value="ALL" ${f.qoqDeltaMode === 'ALL' ? 'selected' : ''}>不限</option>
                  <option value="UP" ${f.qoqDeltaMode === 'UP' ? 'selected' : ''}>▲ 較前季上升 (&gt; 0)</option>
                  <option value="UP_030" ${f.qoqDeltaMode === 'UP_030' ? 'selected' : ''}>▲ 較前季躍進 (≥ +0.30)</option>
                  <option value="UP_050" ${f.qoqDeltaMode === 'UP_050' ? 'selected' : ''}>▲ 較前季大躍進 (≥ +0.50)</option>
                  <option value="NON_DEC" ${f.qoqDeltaMode === 'NON_DEC' ? 'selected' : ''}>持平或上升 (≥ 0)</option>
                  <option value="DOWN" ${f.qoqDeltaMode === 'DOWN' ? 'selected' : ''}>▼ 較前季下降 (&lt; 0)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">單項指標升等過濾</label>
                <select class="form-select" id="six-improved-item">
                  <option value="ALL" ${f.improvedItem === 'ALL' ? 'selected' : ''}>不限單項</option>
                  <option value="revGrowth_MoM" ${f.improvedItem === 'revGrowth_MoM' ? 'selected' : ''}>營收成長性 較前月升等 (MoM ▲)</option>
                  <option value="revGrowth_QoQ" ${f.improvedItem === 'revGrowth_QoQ' ? 'selected' : ''}>營收成長性 較前季升等 (QoQ ▲)</option>
                  <option value="opMargin_QoQ" ${f.improvedItem === 'opMargin_QoQ' ? 'selected' : ''}>營業利益率 較前季升等 (QoQ ▲)</option>
                  <option value="profitGrowth_QoQ" ${f.improvedItem === 'profitGrowth_QoQ' ? 'selected' : ''}>獲利成長性 較前季升等 (QoQ ▲)</option>
                  <option value="eps_QoQ" ${f.improvedItem === 'eps_QoQ' ? 'selected' : ''}>獲利能力(EPS) 較前季升等 (QoQ ▲)</option>
                  <option value="invTurnover_QoQ" ${f.improvedItem === 'invTurnover_QoQ' ? 'selected' : ''}>存貨周轉率 較前季升等 (QoQ ▲)</option>
                  <option value="fcf_QoQ" ${f.improvedItem === 'fcf_QoQ' ? 'selected' : ''}>自由現金流 較前季升等 (QoQ ▲)</option>
                </select>
              </div>
            </div>

            <div class="form-grid" style="grid-template-columns:repeat(auto-fit, minmax(135px, 1fr));">
              ${[
                ['six-min-rev', '① 營收成長最低分', f.minRevScore],
                ['six-min-op', '② 營益率最低分', f.minOpScore],
                ['six-min-profit', '③ 獲利成長最低分', f.minProfitScore],
                ['six-min-eps', '④ EPS最低分', f.minEpsScore],
                ['six-min-inv', '⑤ 存貨周轉最低分', f.minInvScore],
                ['six-min-fcf', '⑥ 自由現金最低分', f.minFcfScore]
              ].map(([id, label, val]) => `
                <div class="form-group">
                  <label class="form-label">${label}</label>
                  <select class="form-select" id="${id}">
                    <option value="0" ${Number(val) === 0 ? 'selected' : ''}>不限 (0+)</option>
                    <option value="2" ${Number(val) === 2 ? 'selected' : ''}>≥ 2.0 分</option>
                    <option value="3" ${Number(val) === 3 ? 'selected' : ''}>≥ 3.0 分</option>
                    <option value="4" ${Number(val) === 4 ? 'selected' : ''}>= 4.0 滿分</option>
                  </select>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Screener Results Table -->
      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;">
          <div class="card-title">六大指標篩選結果（共 ${results.length} 檔）</div>
          <div class="text-muted" style="font-size:12px;">
            點擊任一欄位標題可切換排序；點擊股票代號進入「股票資訊」查看財報與目標價
          </div>
        </div>

        <div class="table-wrap desktop-table-only">
          <table class="data-table">
            <thead>
              <tr>
                ${this._sortTh('six_indicators', 'code', '代號 / 名稱', 'asc', 'left')}
                ${this._sortTh('six_indicators', 'industry', '產業', 'asc', 'left')}
                ${this._sortTh('six_indicators', 'price', '股價 (PE)', 'desc', 'right')}
                ${this._sortTh('six_indicators', 'avgScore', '當期總分', 'desc', 'right')}
                ${this._sortTh('six_indicators', 'deltaMoM', '較前月 (MoM)', 'desc', 'right')}
                ${this._sortTh('six_indicators', 'deltaQoQ', '較前季 (QoQ)', 'desc', 'right')}
                ${this._sortTh('six_indicators', 's0', '①營收', 'desc', 'right')}
                ${this._sortTh('six_indicators', 's1', '②營益率', 'desc', 'right')}
                ${this._sortTh('six_indicators', 's2', '③淨利成長', 'desc', 'right')}
                ${this._sortTh('six_indicators', 's3', '④EPS', 'desc', 'right')}
                ${this._sortTh('six_indicators', 's4', '⑤存貨', 'desc', 'right')}
                ${this._sortTh('six_indicators', 's5', '⑥現金流', 'desc', 'right')}
                ${this._sortTh('six_indicators', 'landmines', '地雷', 'asc', 'right')}
                ${this._sortTh('six_indicators', 'doubleArrow', '雙箭頭', 'desc', 'right')}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${results.map((s) => {
                const ev = s.sixEval;
                const cur = ev.current;
                const comps = ev.itemComparisons;
                return `
                  <tr>
                    <td>
                      <div style="display:flex; align-items:center; gap:5px;">
                        <a href="javascript:void(0)" data-open-stock="${s.code}" class="font-mono" style="font-weight:700; color:var(--accent-blue); text-decoration:none;">
                          ${s.code} ${s.name}
                        </a>
                        ${s.isHolding ? '<span class="pill" style="font-size:10px;">庫存</span>' : ''}
                        ${s.dataSource === 'finmind-live' ? '<span class="pill pill-emerald" style="font-size:9.5px;" title="已同步 FinMind 真實財報">實</span>' : ''}
                      </div>
                    </td>
                    <td class="text-muted">${s.industry}</td>
                    <td class="font-mono" style="text-align:right;">
                      <div style="font-weight:700;">${fmtNum(s.price, 1)}</div>
                      <div class="text-muted" style="font-size:11px;">PE ${s.pe ?? '-'}</div>
                    </td>
                    <td class="font-mono" style="text-align:right;">
                      <div style="font-weight:700;" class="${cur.avgScore >= 3.2 ? 'text-emerald' : ''}">${cur.avgScore.toFixed(2)}</div>
                      <span class="pill" style="font-size:10px;">${cur.grade}</span>
                    </td>
                    <td class="font-mono" style="text-align:right;">
                      <div class="text-muted" style="font-size:11px;">前月 ${ev.prevMonth.avgScore.toFixed(2)}</div>
                      <div>${this._renderDeltaBadge(ev.deltaMoM)}</div>
                    </td>
                    <td class="font-mono" style="text-align:right;">
                      <div class="text-muted" style="font-size:11px;">前季 ${ev.prevQuarter.avgScore.toFixed(2)}</div>
                      <div>${this._renderDeltaBadge(ev.deltaQoQ)}</div>
                    </td>
                    <td style="text-align:right;">${this._renderItemScoreCell(comps[0])}</td>
                    <td style="text-align:right;">${this._renderItemScoreCell(comps[1])}</td>
                    <td style="text-align:right;">${this._renderItemScoreCell(comps[2])}</td>
                    <td style="text-align:right;">${this._renderItemScoreCell(comps[3])}</td>
                    <td style="text-align:right;">${this._renderItemScoreCell(comps[4])}</td>
                    <td style="text-align:right;">${this._renderItemScoreCell(comps[5])}</td>
                    <td style="text-align:right;">
                      <span class="pill ${s.landmines.hitCount === 0 ? 'pill-emerald' : s.landmines.hitCount >= 2 ? 'pill-rose' : ''}">
                        ${s.landmines.hitCount}/7
                      </span>
                    </td>
                    <td class="font-mono" style="text-align:right; font-weight:700;">${fmtNum(s.doubleArrow, 1)}%</td>
                    <td>
                      <div style="display:flex; gap:4px;">
                        <button class="btn btn-ghost btn-sm" data-open-stock="${s.code}">健診</button>
                        <button class="btn btn-ghost btn-sm" data-pk-select="${s.code}">PK</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
              ${results.length === 0 ? `<tr><td colspan="15" class="text-muted" style="text-align:center; padding:20px;">無符合篩選條件的股票</td></tr>` : ''}
            </tbody>
          </table>
        </div>

        <div class="mobile-card-list">
          ${results.length ? results.map((s) => {
            const ev = s.sixEval;
            const cur = ev.current;
            return `
              <details class="m-stock-card">
                <summary>
                  <div class="m-stock-row1">
                    <div style="display:flex; align-items:center; gap:5px; min-width:0;">
                      <span class="font-mono" style="font-weight:700; font-size:14px; color:var(--accent-blue);">${s.code} ${s.name}</span>
                      ${s.isHolding ? '<span class="pill" style="font-size:9.5px;">庫存</span>' : ''}
                    </div>
                    <span class="pill ${cur.avgScore >= 3.2 ? 'pill-emerald' : ''}">${cur.avgScore.toFixed(2)} (${cur.grade})</span>
                  </div>
                  <div class="m-stock-row2">
                    <span class="font-mono" style="font-weight:600;">$${fmtNum(s.price, 1)} <span class="text-muted">PE ${s.pe ?? '-'}</span></span>
                    <span class="font-mono">雙箭頭 <b>${fmtNum(s.doubleArrow, 1)}%</b> · 地雷 ${s.landmines.hitCount}/7</span>
                  </div>
                </summary>
                <div class="m-stock-detail">
                  <div><span class="text-muted">產業：</span><span>${s.industry}</span></div>
                  <div><span class="text-muted">較前月：</span>${this._renderDeltaBadge(ev.deltaMoM)}</div>
                  <div><span class="text-muted">較前季：</span>${this._renderDeltaBadge(ev.deltaQoQ)}</div>
                  <div><span class="text-muted">來源：</span><span>${s.dataSource === 'finmind-live' ? 'FinMind 即時' : '內建財報'}</span></div>
                  <div style="grid-column: span 2; display:flex; gap:6px; margin-top:4px;">
                    <button type="button" class="btn btn-primary btn-sm" data-open-stock="${s.code}" style="flex:1;">詳細健診</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-pk-select="${s.code}" style="flex:1;">加入 PK</button>
                  </div>
                </div>
              </details>
            `;
          }).join('') : `<div class="text-muted" style="text-align:center; padding:18px;">無符合篩選條件的股票</div>`}
        </div>
      </div>
    `;
  }

  _renderStrongScreener(state) {
    const f = this.strongFilters;
    const rawResults = GoodStockCore.screenStocks(state, 'strong', f);
    const results = this._sortResults('strong', rawResults, f.lookbackDays);

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">觀察交易日數</label>
            <select class="form-select" id="strong-days">
              <option value="5" ${Number(f.lookbackDays) === 5 ? 'selected' : ''}>過去 5 個交易日</option>
              <option value="10" ${Number(f.lookbackDays) === 10 ? 'selected' : ''}>過去 10 個交易日</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">區間漲幅超過 (%)</label>
            <input type="number" class="form-input font-mono" id="strong-min-gain" value="${f.minGainPct}" step="1" />
          </div>
          <div class="form-group">
            <label class="form-label">5日均量較30日均量放大 (%)</label>
            <input type="number" class="form-input font-mono" id="strong-vol-surge" value="${f.minVolSurgePct}" step="5" />
          </div>
          <div class="form-group">
            <label class="form-label">最低股價門檻 (元)</label>
            <input type="number" class="form-input font-mono" id="strong-min-price" value="${f.minPrice}" step="10" />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">近期強勢股結果（共 ${results.length} 檔）</div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${this._sortTh('strong', 'code', '代號 / 名稱', 'asc', 'left')}
                ${this._sortTh('strong', 'industry', '產業', 'asc', 'left')}
                ${this._sortTh('strong', 'gain', `${f.lookbackDays}日漲幅`, 'desc', 'right')}
                ${this._sortTh('strong', 'price', '股價', 'desc', 'right')}
                ${this._sortTh('strong', 'pe', '本益比', 'asc', 'right')}
                ${this._sortTh('strong', 'change1mPct', '月漲幅', 'desc', 'right')}
                ${this._sortTh('strong', 'volumeLots', '成交量(張)', 'desc', 'right')}
                ${this._sortTh('strong', 'latestOpMargin', '營益率', 'desc', 'right')}
                ${this._sortTh('strong', 'latestEps', 'EPS', 'desc', 'right')}
                ${this._sortTh('strong', 'latestRevYoY', '營收年增', 'desc', 'right')}
                ${this._sortTh('strong', 'doubleArrow', '雙箭頭', 'desc', 'right')}
                ${this._sortTh('strong', 'avgScore', '六大總分', 'desc', 'right')}
              </tr>
            </thead>
            <tbody>
              ${results.map((s) => {
                const gain = f.lookbackDays >= 10 ? s.change10dPct : s.change5dPct;
                return `
                  <tr>
                    <td><a href="javascript:void(0)" data-open-stock="${s.code}" class="font-mono" style="color:var(--accent-blue); font-weight:700; text-decoration:none;">${s.code} ${s.name}</a></td>
                    <td class="text-muted">${s.industry}</td>
                    <td class="font-mono ${gain >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right; font-weight:700;">${gain >= 0 ? '▲ +' : '▼ '}${gain.toFixed(2)}%</td>
                    <td class="font-mono" style="text-align:right; font-weight:700;">${fmtNum(s.price, 1)}</td>
                    <td class="font-mono" style="text-align:right;">${s.pe ?? '-'}</td>
                    <td class="font-mono ${s.change1mPct >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${s.change1mPct >= 0 ? '+' : ''}${s.change1mPct.toFixed(2)}%</td>
                    <td class="font-mono" style="text-align:right;">${fmtInt(s.volumeLots)}</td>
                    <td class="font-mono" style="text-align:right;">${s.latestOpMargin.toFixed(2)}%</td>
                    <td class="font-mono" style="text-align:right;">${s.latestEps.toFixed(2)}</td>
                    <td class="font-mono ${s.latestRevYoY >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${s.latestRevYoY >= 0 ? '+' : ''}${s.latestRevYoY.toFixed(2)}%</td>
                    <td class="font-mono" style="text-align:right; font-weight:700;">${s.doubleArrow.toFixed(1)}%</td>
                    <td class="font-mono" style="text-align:right; font-weight:700;">${s.sixEval.current.avgScore.toFixed(2)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderFinancialScreener(state) {
    const f = this.finFilters;
    const rawResults = GoodStockCore.screenStocks(state, 'financial', f);
    const results = this._sortResults('financial', rawResults);

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="action-toolbar" style="margin-bottom:10px;">
          <div class="action-toolbar-group">
            <button class="btn btn-ghost btn-sm" data-fin-preset="DEFAULT">預設 (營益≥10、EPS≥1、年增≥20)</button>
            <button class="btn btn-ghost btn-sm" data-fin-preset="DOUBLE_ARROW">財務雙箭頭 ≥ 65%</button>
            <button class="btn btn-ghost btn-sm" data-fin-preset="HIGH_PRICE">千金股排行 (股價≥1000)</button>
            <button class="btn btn-ghost btn-sm" data-fin-preset="CLEAR">清除條件</button>
          </div>
        </div>

        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">營業利益率 (%) Min ~ Max</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="form-input font-mono" id="fin-min-op" placeholder="最小" value="${f.minOpMargin}" />
              <input type="number" class="form-input font-mono" id="fin-max-op" placeholder="最大" value="${f.maxOpMargin}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">最新季 EPS (元) Min ~ Max</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="form-input font-mono" id="fin-min-eps" placeholder="最小" value="${f.minEps}" />
              <input type="number" class="form-input font-mono" id="fin-max-eps" placeholder="最大" value="${f.maxEps}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">營收年增率 (%) Min ~ Max</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="form-input font-mono" id="fin-min-revyoy" placeholder="最小" value="${f.minRevYoY}" />
              <input type="number" class="form-input font-mono" id="fin-max-revyoy" placeholder="最大" value="${f.maxRevYoY}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">財務雙箭頭 (營收年增+營益率%)</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="form-input font-mono" id="fin-min-arrow" placeholder="最小" value="${f.minDoubleArrow}" />
              <input type="number" class="form-input font-mono" id="fin-max-arrow" placeholder="最大" value="${f.maxDoubleArrow}" />
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">財務選股結果（共 ${results.length} 檔）</div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${this._sortTh('financial', 'code', '代號 / 名稱', 'asc', 'left')}
                ${this._sortTh('financial', 'industry', '產業', 'asc', 'left')}
                ${this._sortTh('financial', 'price', '股價', 'desc', 'right')}
                ${this._sortTh('financial', 'pe', '本益比', 'asc', 'right')}
                ${this._sortTh('financial', 'change1mPct', '月漲幅', 'desc', 'right')}
                ${this._sortTh('financial', 'latestOpMargin', '營益率', 'desc', 'right')}
                ${this._sortTh('financial', 'latestEps', 'EPS', 'desc', 'right')}
                ${this._sortTh('financial', 'latestNetMargin', '淨利率', 'desc', 'right')}
                ${this._sortTh('financial', 'latestRevYoY', '營收年增', 'desc', 'right')}
                ${this._sortTh('financial', 'latestCumYoY', '累計年增', 'desc', 'right')}
                ${this._sortTh('financial', 'doubleArrow', '雙箭頭', 'desc', 'right')}
                ${this._sortTh('financial', 'avgScore', '六大總分', 'desc', 'right')}
              </tr>
            </thead>
            <tbody>
              ${results.map((s) => `
                <tr>
                  <td><a href="javascript:void(0)" data-open-stock="${s.code}" class="font-mono" style="color:var(--accent-blue); font-weight:700; text-decoration:none;">${s.code} ${s.name}</a></td>
                  <td class="text-muted">${s.industry}</td>
                  <td class="font-mono" style="text-align:right; font-weight:700;">${fmtNum(s.price, 1)}</td>
                  <td class="font-mono" style="text-align:right;">${s.pe ?? '-'}</td>
                  <td class="font-mono ${s.change1mPct >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${s.change1mPct >= 0 ? '+' : ''}${s.change1mPct.toFixed(2)}%</td>
                  <td class="font-mono" style="text-align:right; font-weight:700;">${s.latestOpMargin.toFixed(2)}%</td>
                  <td class="font-mono" style="text-align:right;">${s.latestEps.toFixed(2)}</td>
                  <td class="font-mono" style="text-align:right;">${s.latestNetMargin.toFixed(2)}%</td>
                  <td class="font-mono ${s.latestRevYoY >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${s.latestRevYoY >= 0 ? '+' : ''}${s.latestRevYoY.toFixed(2)}%</td>
                  <td class="font-mono ${s.latestCumYoY >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${s.latestCumYoY >= 0 ? '+' : ''}${s.latestCumYoY.toFixed(2)}%</td>
                  <td class="font-mono" style="text-align:right; font-weight:700;">${s.doubleArrow.toFixed(2)}%</td>
                  <td class="font-mono" style="text-align:right; font-weight:700;">${s.sixEval.current.avgScore.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderTrendScreener(state) {
    const f = this.trendFilters;
    const rawResults = GoodStockCore.screenStocks(state, 'trend', f);
    const results = this._sortResults('trend', rawResults);

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">觀察交易日數 (N 日)</label>
            <select class="form-select" id="trend-days">
              <option value="5" ${Number(f.trendDays) === 5 ? 'selected' : ''}>近 5 個交易日</option>
              <option value="10" ${Number(f.trendDays) === 10 ? 'selected' : ''}>近 10 個交易日</option>
              <option value="20" ${Number(f.trendDays) === 20 ? 'selected' : ''}>近 20 個交易日</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">區間漲跌幅超過 X (%)</label>
            <input type="number" class="form-input font-mono" id="trend-move" value="${f.minMovePct}" />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${this._sortTh('trend', 'code', '代號 / 名稱', 'asc', 'left')}
                ${this._sortTh('trend', 'industry', '產業', 'asc', 'left')}
                ${this._sortTh('trend', 'price', '股價', 'desc', 'right')}
                ${this._sortTh('trend', 'change5dPct', '5日漲幅', 'desc', 'right')}
                ${this._sortTh('trend', 'change10dPct', '10日漲幅', 'desc', 'right')}
                ${this._sortTh('trend', 'change20dPct', '20日漲幅', 'desc', 'right')}
                ${this._sortTh('trend', 'latestOpMargin', '營益率', 'desc', 'right')}
                ${this._sortTh('trend', 'latestEps', 'EPS', 'desc', 'right')}
                ${this._sortTh('trend', 'latestRevYoY', '營收年增', 'desc', 'right')}
                ${this._sortTh('trend', 'avgScore', '六大總分 (較前季)', 'desc', 'right')}
              </tr>
            </thead>
            <tbody>
              ${results.map((s) => `
                <tr>
                  <td><a href="javascript:void(0)" data-open-stock="${s.code}" class="font-mono" style="color:var(--accent-blue); font-weight:700; text-decoration:none;">${s.code} ${s.name}</a></td>
                  <td class="text-muted">${s.industry}</td>
                  <td class="font-mono" style="text-align:right; font-weight:700;">${fmtNum(s.price, 1)}</td>
                  <td class="font-mono ${s.change5dPct >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${s.change5dPct >= 0 ? '+' : ''}${s.change5dPct.toFixed(2)}%</td>
                  <td class="font-mono ${s.change10dPct >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right; font-weight:700;">${s.change10dPct >= 0 ? '+' : ''}${s.change10dPct.toFixed(2)}%</td>
                  <td class="font-mono ${s.change20dPct >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${s.change20dPct >= 0 ? '+' : ''}${s.change20dPct.toFixed(2)}%</td>
                  <td class="font-mono" style="text-align:right;">${s.latestOpMargin.toFixed(2)}%</td>
                  <td class="font-mono" style="text-align:right;">${s.latestEps.toFixed(2)}</td>
                  <td class="font-mono ${s.latestRevYoY >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${s.latestRevYoY >= 0 ? '+' : ''}${s.latestRevYoY.toFixed(2)}%</td>
                  <td class="font-mono" style="text-align:right;">
                    <span style="font-weight:700;">${s.sixEval.current.avgScore.toFixed(2)}</span>
                    ${this._renderDeltaBadge(s.sixEval.deltaQoQ)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderNewHighScreener(state) {
    const f = this.newHighFilters;
    const rawResults = GoodStockCore.screenStocks(state, 'newhigh', f);
    const results = this._sortResults('newhigh', rawResults);

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">營收創 N 個月新高</label>
            <input type="number" class="form-input font-mono" id="nh-rev" value="${f.revHighMonths}" />
          </div>
          <div class="form-group">
            <label class="form-label">營業利益率創 N 季新高</label>
            <input type="number" class="form-input font-mono" id="nh-op" value="${f.opHighQuarters}" />
          </div>
          <div class="form-group">
            <label class="form-label">EPS 創 N 季新高</label>
            <input type="number" class="form-input font-mono" id="nh-eps" value="${f.epsHighQuarters}" />
          </div>
          <div class="form-group">
            <label class="form-label">股價創 N 日新高</label>
            <input type="number" class="form-input font-mono" id="nh-price" value="${f.priceHighDays}" />
          </div>
          <div class="form-group">
            <label class="form-label">成交量創 N 日新高</label>
            <input type="number" class="form-input font-mono" id="nh-vol" value="${f.volHighDays}" />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${this._sortTh('newhigh', 'code', '代號 / 名稱', 'asc', 'left')}
                ${this._sortTh('newhigh', 'industry', '產業', 'asc', 'left')}
                ${this._sortTh('newhigh', 'price', '股價', 'desc', 'right')}
                ${this._sortTh('newhigh', 'revNewHighMonths', '營收創高(月)', 'desc', 'right')}
                <th style="text-align:right;">營益率創高(季)</th>
                <th style="text-align:right;">EPS創高(季)</th>
                <th style="text-align:right;">股價創高(日)</th>
                ${this._sortTh('newhigh', 'doubleArrow', '雙箭頭', 'desc', 'right')}
                ${this._sortTh('newhigh', 'avgScore', '六大總分', 'desc', 'right')}
              </tr>
            </thead>
            <tbody>
              ${results.map((s) => `
                <tr>
                  <td><a href="javascript:void(0)" data-open-stock="${s.code}" class="font-mono" style="color:var(--accent-blue); font-weight:700; text-decoration:none;">${s.code} ${s.name}</a></td>
                  <td class="text-muted">${s.industry}</td>
                  <td class="font-mono" style="text-align:right; font-weight:700;">${fmtNum(s.price, 1)}</td>
                  <td style="text-align:right;"><span class="pill pill-emerald">${s.revNewHighMonths} 個月新高</span></td>
                  <td style="text-align:right;"><span class="pill">${s.opMarginNewHighQuarters} 季新高</span></td>
                  <td style="text-align:right;"><span class="pill">${s.epsNewHighQuarters} 季新高</span></td>
                  <td style="text-align:right;"><span class="pill">${s.priceNewHighDays} 日新高</span></td>
                  <td class="font-mono" style="text-align:right; font-weight:700;">${s.doubleArrow.toFixed(1)}%</td>
                  <td class="font-mono" style="text-align:right; font-weight:700;">${s.sixEval.current.avgScore.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderStockInfoMain(state, universe) {
    const stock = universe.find((s) => s.code === this.selectedCode || s.name === this.selectedCode) || universe[0];
    const q8 = (stock.quarters || []).slice(-8);
    const q8Desc = [...q8].reverse();
    const m36 = (stock.monthlyRevenues || []).slice(-36);
    const m12Desc = [...m36.slice(-12)].reverse();

    const landmines = stock.landmines;
    const sixEval = stock.sixEval;
    const growth = GoodStockCore.computeGrowthAnalysis(stock);
    const horizon = this.infoSection === 'target3y' ? 3 : 1;
    const targetData = GoodStockCore.estimateTargetPrices(stock, {
      horizon,
      peBands: this.customPeBands || stock.peBands
    });

    return `
      <div class="card" style="margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <input type="text" class="form-input font-mono" id="gs-stock-search-input" value="${stock.code}" placeholder="代號或名稱 (如 2330)" style="width:150px;" />
            <button class="btn btn-primary btn-sm" id="btn-gs-search-stock">查詢個股</button>
            <button class="btn btn-ghost btn-sm" id="btn-gs-fetch-live" ${this.isFetchingLive ? 'disabled' : ''}>
              ${this.isFetchingLive ? '連線中...' : '即時抓取 FinMind'}
            </button>
          </div>

          <div style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">
            ${universe.slice(0, 12).map((s) => `
              <button class="btn ${s.code === stock.code ? 'btn-primary' : 'btn-ghost'} btn-sm" data-open-stock="${s.code}" style="padding:3px 7px; font-size:11.5px;">
                ${s.code} ${s.name}
              </button>
            `).join('')}
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-top:12px; padding-top:12px; border-top:1px solid var(--border-color);">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="font-size:18px; font-weight:800;">${stock.code} ${stock.name}</span>
            <span class="pill">${stock.market} · ${stock.industry}</span>
            <span class="pill ${stock.dataSource === 'finmind-live' ? 'pill-emerald' : ''}">
              ${stock.dataSource === 'finmind-live' ? '✓ FinMind 真實財報' : '預設快取 (點右側即時抓取)'}
            </span>
            <span class="text-muted" style="font-size:12px;">財報:${stock.latestQuarter} ｜ 營收:${stock.latestMonth}</span>
            <span class="pill ${landmines.hitCount === 0 ? 'pill-emerald' : 'pill-rose'}">
              地雷 ${landmines.hitCount}/${landmines.totalCount}
            </span>
            <span class="pill pill-emerald">
              六大指標 ${sixEval.current.avgScore.toFixed(2)} 分 (${sixEval.current.grade})
            </span>
          </div>
          <div style="display:flex; gap:16px; align-items:baseline; flex-wrap:wrap;">
            <div>
              <span class="text-muted" style="font-size:12px;">收盤價</span>
              <span class="font-mono" style="font-size:18px; font-weight:800; margin-left:4px;">${fmtNum(stock.price, 1)} 元</span>
            </div>
            <div>
              <span class="text-muted" style="font-size:12px;">近四季EPS</span>
              <span class="font-mono" style="font-weight:700; margin-left:4px;">${stock.ttmEps.toFixed(2)} 元 (PE ${stock.pe ?? '-'})</span>
            </div>
            <div>
              <span class="text-muted" style="font-size:12px;">雙箭頭</span>
              <span class="font-mono" style="font-weight:700; margin-left:4px;">${stock.doubleArrow.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        <div class="sub-tabs" style="margin-top:10px; margin-bottom:0;">
          <button class="sub-tab ${this.infoSection === 'all' ? 'active' : ''}" data-gs-info-sec="all">全部總覽</button>
          <button class="sub-tab ${this.infoSection === 'report' ? 'active' : ''}" data-gs-info-sec="report">財報查詢 (8季+36月)</button>
          <button class="sub-tab ${this.infoSection === 'health' ? 'active' : ''}" data-gs-info-sec="health">財務健診 (地雷/六大指標/成長力)</button>
          <button class="sub-tab ${this.infoSection === 'target1y' ? 'active' : ''}" data-gs-info-sec="target1y">推估今年目標價</button>
          <button class="sub-tab ${this.infoSection === 'target3y' ? 'active' : ''}" data-gs-info-sec="target3y">推估三年目標價</button>
        </div>
      </div>

      ${(this.infoSection === 'all' || this.infoSection === 'health') ? this._renderHealthCheckBlock(stock, landmines, sixEval, growth) : ''}
      ${(this.infoSection === 'all' || this.infoSection === 'report') ? this._renderFinancialReportBlock(stock, q8, q8Desc, m36, m12Desc) : ''}
      ${(this.infoSection === 'all' || this.infoSection === 'target1y' || this.infoSection === 'target3y') ? this._renderTargetPriceBlock(stock, targetData) : ''}
    `;
  }

  _renderHealthCheckBlock(stock, landmines, sixEval, growth) {
    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="flex-wrap:wrap; gap:8px;">
          <div class="card-title">財務健診 — ${stock.code} ${stock.name}</div>
          <div class="sub-tabs" style="margin-bottom:0; border-bottom:none;">
            <button class="sub-tab ${this.healthTab === 'landmines' ? 'active' : ''}" data-gs-health-tab="landmines">財務地雷 (${landmines.hitCount}/7)</button>
            <button class="sub-tab ${this.healthTab === 'six' ? 'active' : ''}" data-gs-health-tab="six">六大指標 (${sixEval.current.avgScore.toFixed(2)}分)</button>
            <button class="sub-tab ${this.healthTab === 'growth' ? 'active' : ''}" data-gs-health-tab="growth">成長力分析 (QoQ/YoY)</button>
          </div>
        </div>

        ${this.healthTab === 'landmines' ? `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>財務地雷指標</th>
                  <th>狀態</th>
                  <th>說明</th>
                </tr>
              </thead>
              <tbody>
                ${landmines.items.map((item) => `
                  <tr>
                    <td style="font-weight:700;">${item.label}</td>
                    <td>
                      ${item.hit
                        ? '<span class="pill pill-rose">▼ 命中</span>'
                        : '<span class="pill pill-emerald">✓ 正常</span>'}
                    </td>
                    <td>${item.detail}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${this._renderSixHistoryCharts(sixEval.monthlySeries || [])}
        ` : ''}

        ${this.healthTab === 'six' ? `
          <div class="grid-kpi" style="margin-bottom:14px;">
            <div class="card">
              <div class="kpi-label">
                <span>當期六大指標總均分 (${sixEval.current.refQuarter})</span>
                <span class="pill pill-emerald">${sixEval.current.grade} 級</span>
              </div>
              <div class="kpi-value">${sixEval.current.avgScore.toFixed(2)} <span style="font-size:13px; font-weight:500;">/ 4.00</span></div>
              <div class="kpi-sub">總分 ${sixEval.current.totalScore} / ${sixEval.current.maxTotalScore}</div>
            </div>

            <div class="card">
              <div class="kpi-label">
                <span>與前一個月比較 (${sixEval.prevMonth.refMonth})</span>
                ${this._renderDeltaBadge(sixEval.deltaMoM, 'MoM ')}
              </div>
              <div class="kpi-value" style="font-size:17px;">前月 ${sixEval.prevMonth.avgScore.toFixed(2)} → 當期 ${sixEval.current.avgScore.toFixed(2)}</div>
              <div class="kpi-sub">反映最新月營收對營收成長性之拉動</div>
            </div>

            <div class="card">
              <div class="kpi-label">
                <span>與前一季比較 (${sixEval.prevQuarter.refQuarter})</span>
                ${this._renderDeltaBadge(sixEval.deltaQoQ, 'QoQ ')}
              </div>
              <div class="kpi-value" style="font-size:17px;">前季 ${sixEval.prevQuarter.avgScore.toFixed(2)} → 當期 ${sixEval.current.avgScore.toFixed(2)}</div>
              <div class="kpi-sub">反映最新一季財報整體體質升降</div>
            </div>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>六大指標項目</th>
                  <th style="text-align:right;">當期得分</th>
                  <th style="text-align:right;">前月得分 (月變化)</th>
                  <th style="text-align:right;">前季得分 (季變化)</th>
                  <th>評分標準與當期數值依據</th>
                </tr>
              </thead>
              <tbody>
                ${sixEval.itemComparisons.map((it) => `
                  <tr>
                    <td style="font-weight:700;">${it.label}</td>
                    <td class="font-mono" style="text-align:right; font-weight:700;">
                      ${it.score === null ? '<span class="pill">不評分</span>' : `${it.score.toFixed(1)} 分`}
                    </td>
                    <td class="font-mono" style="text-align:right;">
                      ${it.prevMonthScore === null ? '-' : `${it.prevMonthScore.toFixed(1)} ${this._renderDeltaBadge(it.deltaMoM)}`}
                    </td>
                    <td class="font-mono" style="text-align:right;">
                      ${it.prevQuarterScore === null ? '-' : `${it.prevQuarterScore.toFixed(1)} ${this._renderDeltaBadge(it.deltaQoQ)}`}
                    </td>
                    <td class="text-muted">${it.reason}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${this._renderSixHistoryCharts(sixEval.monthlySeries || [])}
        ` : ''}

        ${this.healthTab === 'growth' ? `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>項目</th>
                  <th style="text-align:right;">最近一季 (${growth.latestQ})</th>
                  <th style="text-align:right;">QoQ (對上一季 ${growth.prevQ})</th>
                  <th style="text-align:right;">YoY (對去年同季 ${growth.prevYearQ})</th>
                </tr>
              </thead>
              <tbody>
                ${growth.rows.map((r) => `
                  <tr>
                    <td style="font-weight:700;">${r.label}</td>
                    <td class="font-mono" style="text-align:right; font-weight:700;">${r.latestVal}</td>
                    <td class="font-mono ${r.qoq >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right; font-weight:700;">
                      ${r.qoq >= 0 ? '▲ +' : '▼ '}${r.qoq.toFixed(2)}${r.unit}
                    </td>
                    <td class="font-mono ${r.yoy >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right; font-weight:700;">
                      ${r.yoy >= 0 ? '▲ +' : '▼ '}${r.yoy.toFixed(2)}${r.unit}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${this._renderSixHistoryCharts(sixEval.monthlySeries || [])}
        ` : ''}
      </div>
    `;
  }

  _renderFinancialReportBlock(stock, q8, q8Desc, m36, m12Desc) {
    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">最近八季財報 — ${stock.code} ${stock.name}</div>
          <div class="text-muted" style="font-size:12px;">單位：百萬新台幣 / % / 元</div>
        </div>

        <div class="table-wrap" style="margin-bottom:14px;">
          <table class="data-table">
            <thead>
              <tr>
                <th>項目 \\ 季度</th>
                ${q8Desc.map((q) => `<th style="text-align:right;">${q.q}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight:700;">營收年增率</td>
                ${q8Desc.map((q) => `<td class="font-mono ${q.revYoY >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${q.revYoY >= 0 ? '+' : ''}${q.revYoY.toFixed(2)}%</td>`).join('')}
              </tr>
              <tr>
                <td style="font-weight:700;">營業利益率</td>
                ${q8Desc.map((q) => `<td class="font-mono" style="text-align:right; font-weight:700;">${q.opMargin.toFixed(2)}%</td>`).join('')}
              </tr>
              <tr>
                <td style="font-weight:700;">淨利率(歸母)</td>
                ${q8Desc.map((q) => `<td class="font-mono" style="text-align:right;">${q.netMargin.toFixed(2)}%</td>`).join('')}
              </tr>
              <tr>
                <td style="font-weight:700;">EPS (元)</td>
                ${q8Desc.map((q) => `<td class="font-mono" style="text-align:right; font-weight:700;">${q.eps.toFixed(2)}</td>`).join('')}
              </tr>
              <tr>
                <td style="font-weight:700;">存貨周轉率</td>
                ${q8Desc.map((q) => `<td class="font-mono" style="text-align:right;">${q.invTurnover !== null && q.invTurnover !== undefined ? q.invTurnover.toFixed(2) : '-'}</td>`).join('')}
              </tr>
              <tr>
                <td style="font-weight:700;">自由現金流量(百萬)</td>
                ${q8Desc.map((q) => `<td class="font-mono" style="text-align:right;">${fmtInt(q.fcfM)}</td>`).join('')}
              </tr>
            </tbody>
          </table>
        </div>

        <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:8px; padding:12px;">
          <div style="text-align:center; font-weight:700; margin-bottom:8px; font-size:13px;">八季財報趨勢（柱＝EPS(元) 右軸；藍線＝營業利益率(%)、綠線＝淨利率(%) 左軸）</div>
          ${this._renderSvg8QuarterChart(q8)}
        </div>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">最近一年營收 & 三年營收趨勢 — ${stock.code} ${stock.name}</div>
        </div>

        <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:8px; padding:12px; margin-bottom:14px;">
          <div style="text-align:center; font-weight:700; margin-bottom:8px; font-size:13px;">三年（36個月）營收趨勢（藍柱＝當月營收(百萬) 左軸；綠線＝年增率(%) 右軸）</div>
          ${this._renderSvg36MonthRevChart(m36)}
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>月份</th>
                <th style="text-align:right;">當月營收(百萬)</th>
                <th style="text-align:right;">月增率 (MoM)</th>
                <th style="text-align:right;">年增率 (YoY)</th>
                <th style="text-align:right;">累計營收年增率</th>
              </tr>
            </thead>
            <tbody>
              ${m12Desc.map((m) => `
                <tr>
                  <td class="font-mono" style="font-weight:700;">${m.ym}</td>
                  <td class="font-mono" style="text-align:right; font-weight:700;">${fmtInt(m.revM)}</td>
                  <td class="font-mono ${m.mom >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${m.mom >= 0 ? '+' : ''}${m.mom.toFixed(2)}%</td>
                  <td class="font-mono ${m.yoy >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right; font-weight:700;">${m.yoy >= 0 ? '+' : ''}${m.yoy.toFixed(2)}%</td>
                  <td class="font-mono ${m.cumYoY >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right;">${m.cumYoY >= 0 ? '+' : ''}${m.cumYoY.toFixed(2)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderTargetPriceBlock(stock, targetData) {
    const peBands = targetData.peBands;
    const sc = targetData.scenarios;

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="flex-wrap:wrap; gap:8px;">
          <div>
            <div class="card-title">股價走勢 vs 目標價（${targetData.horizon === 3 ? '推估三年目標價' : '推估今年目標價'} · 9 條情境目標線）</div>
            <div class="text-muted" style="font-size:12px; margin-top:2px;">
              近四季 EPS ${targetData.ttmEps} 元 ｜ 預估${targetData.horizon}年後 EPS：樂觀 ${sc.optimistic.eps} 元 · 中性 ${sc.neutral.eps} 元 · 悲觀 ${sc.pessimistic.eps} 元
            </div>
          </div>

          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <span class="text-muted" style="font-size:12px;">自訂 PE：</span>
            <input type="number" class="form-input font-mono" id="gs-pe-1" value="${peBands[0]}" style="width:64px; padding:4px 8px;" />
            <input type="number" class="form-input font-mono" id="gs-pe-2" value="${peBands[1]}" style="width:64px; padding:4px 8px;" />
            <input type="number" class="form-input font-mono" id="gs-pe-3" value="${peBands[2]}" style="width:64px; padding:4px 8px;" />
            <button class="btn btn-primary btn-sm" id="btn-gs-apply-pe">套用 PE</button>
          </div>
        </div>

        <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:8px; padding:12px; margin-bottom:12px;">
          ${this._renderSvgTargetPriceChart(stock, targetData)}
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(185px, 1fr)); gap:8px;">
          ${targetData.lines.map((ln) => {
            const diffPct = (((ln.targetPrice - stock.price) / stock.price) * 100).toFixed(1);
            return `
              <div style="background:var(--bg-subtle); border-left:3px solid ${ln.color}; border-radius:6px; padding:8px 10px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div class="text-muted" style="font-size:11.5px;">PE=${ln.pe} ${ln.scenario}</div>
                  <div class="font-mono" style="font-size:15px; font-weight:700;">${fmtInt(ln.targetPrice)} 元</div>
                </div>
                <span class="pill ${Number(diffPct) >= 0 ? 'pill-emerald' : 'pill-rose'}">
                  ${Number(diffPct) >= 0 ? '▲ +' : '▼ '}${diffPct}%
                </span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  _renderPkMain(state, universe) {
    const pk = GoodStockCore.compareDualStocks(state, this.pkCodeA, this.pkCodeB);
    const { stockA, stockB, priceSeries, quarterSeries, revenueSeries } = pk;

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="flex-wrap:wrap; gap:10px;">
          <div class="card-title">雙股 PK 對比 — ① ${stockA.code} ${stockA.name} vs ② ${stockB.code} ${stockB.name}</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-ghost btn-sm" data-pk-pair="5274,2059">信驊 vs 川湖</button>
            <button class="btn btn-ghost btn-sm" data-pk-pair="3037,8046">欣興 vs 南電</button>
            <button class="btn btn-ghost btn-sm" data-pk-pair="2330,2454">台積電 vs 聯發科</button>
            <button class="btn btn-ghost btn-sm" data-pk-pair="3017,3324">奇鋐 vs 雙鴻</button>
            <button class="btn btn-ghost btn-sm" data-pk-pair="2382,6669">廣達 vs 緯穎</button>
          </div>
        </div>

        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">股票 ① (藍線 / 藍柱)</label>
            <select class="form-select" id="pk-select-a">
              ${universe.map((s) => `<option value="${s.code}" ${s.code === stockA.code ? 'selected' : ''}>${s.code} ${s.name} (${s.industry} · $${s.price})</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">股票 ② (橘線 / 橘柱)</label>
            <select class="form-select" id="pk-select-b">
              ${universe.map((s) => `<option value="${s.code}" ${s.code === stockB.code ? 'selected' : ''}>${s.code} ${s.name} (${s.industry} · $${s.price})</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">${stockA.code} ${stockA.name} vs ${stockB.code} ${stockB.name} — 股價與價差對比</div>
        </div>
        <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:8px; padding:12px;">
          ${this._renderSvgPkPriceChart(stockA, stockB, priceSeries)}
        </div>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">八季財報趨勢對比（柱＝EPS(元) 右軸；線＝營業利益率(%) 左軸）</div>
        </div>
        <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:8px; padding:12px;">
          ${this._renderSvgPkQuarterChart(stockA, stockB, quarterSeries)}
        </div>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">三年營收趨勢對比（柱＝當月營收(百萬) 左軸；線＝營收年增率(%) 右軸）</div>
        </div>
        <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:8px; padding:12px;">
          ${this._renderSvgPkRevenueChart(stockA, stockB, revenueSeries)}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">財務六大指標 & 估值正面對決</div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>比較維度</th>
                <th style="text-align:right;">① ${stockA.code} ${stockA.name}</th>
                <th style="text-align:right;">② ${stockB.code} ${stockB.name}</th>
                <th>勝出方</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight:700;">六大指標當期總均分</td>
                <td class="font-mono" style="text-align:right; font-weight:700;">${stockA.sixEval.current.avgScore.toFixed(2)} (${stockA.sixEval.current.grade})</td>
                <td class="font-mono" style="text-align:right; font-weight:700;">${stockB.sixEval.current.avgScore.toFixed(2)} (${stockB.sixEval.current.grade})</td>
                <td>${stockA.sixEval.current.avgScore >= stockB.sixEval.current.avgScore ? stockA.name : stockB.name}</td>
              </tr>
              <tr>
                <td style="font-weight:700;">較前月評分變化 (ΔMoM)</td>
                <td style="text-align:right;">${this._renderDeltaBadge(stockA.sixEval.deltaMoM)}</td>
                <td style="text-align:right;">${this._renderDeltaBadge(stockB.sixEval.deltaMoM)}</td>
                <td>${stockA.sixEval.deltaMoM >= stockB.sixEval.deltaMoM ? stockA.name : stockB.name}</td>
              </tr>
              <tr>
                <td style="font-weight:700;">較前季評分變化 (ΔQoQ)</td>
                <td style="text-align:right;">${this._renderDeltaBadge(stockA.sixEval.deltaQoQ)}</td>
                <td style="text-align:right;">${this._renderDeltaBadge(stockB.sixEval.deltaQoQ)}</td>
                <td>${stockA.sixEval.deltaQoQ >= stockB.sixEval.deltaQoQ ? stockA.name : stockB.name}</td>
              </tr>
              ${stockA.sixEval.current.items.map((itA, idx) => {
                const itB = stockB.sixEval.current.items[idx];
                const sA = itA.score ?? -1;
                const sB = itB.score ?? -1;
                return `
                  <tr>
                    <td>${itA.label}</td>
                    <td class="font-mono" style="text-align:right;">${itA.score !== null ? `${itA.score.toFixed(1)} 分` : '-'}</td>
                    <td class="font-mono" style="text-align:right;">${itB.score !== null ? `${itB.score.toFixed(1)} 分` : '-'}</td>
                    <td>${sA === sB ? '平手' : sA > sB ? stockA.name : stockB.name}</td>
                  </tr>
                `;
              }).join('')}
              <tr>
                <td style="font-weight:700;">財務地雷命中數 (越少越好)</td>
                <td class="font-mono" style="text-align:right;">${stockA.landmines.hitCount} / 7</td>
                <td class="font-mono" style="text-align:right;">${stockB.landmines.hitCount} / 7</td>
                <td>${stockA.landmines.hitCount <= stockB.landmines.hitCount ? stockA.name : stockB.name}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderSvg8QuarterChart(q8) {
    const W = 760, H = 250, padL = 48, padR = 48, padT = 20, padB = 38;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const margins = q8.flatMap((q) => [q.opMargin, q.netMargin]);
    const minM = Math.min(0, Math.floor(Math.min(...margins) / 5) * 5);
    const maxM = Math.max(20, Math.ceil(Math.max(...margins) / 5) * 5 + 5);
    const maxEps = Math.max(5, Math.ceil(Math.max(...q8.map((q) => Math.max(0, q.eps))) * 1.15));

    const xAt = (i) => padL + (i + 0.5) * (plotW / q8.length);
    const yMargin = (v) => padT + plotH - ((v - minM) / Math.max(1, maxM - minM)) * plotH;
    const yEps = (v) => padT + plotH - (Math.max(0, v) / maxEps) * plotH;

    const opPoints = q8.map((q, i) => `${xAt(i)},${yMargin(q.opMargin)}`).join(' ');
    const netPoints = q8.map((q, i) => `${xAt(i)},${yMargin(q.netMargin)}`).join(' ');

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:260px; display:block;">
        ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + plotH * (1 - t);
          const mVal = (minM + (maxM - minM) * t).toFixed(0);
          const eVal = (maxEps * t).toFixed(1);
          return `
            <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border-color)" stroke-dasharray="3,3" />
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="10">${mVal}%</text>
            <text x="${W - padR + 6}" y="${y + 4}" text-anchor="start" fill="var(--text-muted)" font-size="10">${eVal}元</text>
          `;
        }).join('')}

        ${q8.map((q, i) => {
          const cx = xAt(i);
          const bw = Math.min(36, (plotW / q8.length) * 0.5);
          const yTop = yEps(q.eps);
          const bh = Math.max(2, padT + plotH - yTop);
          return `
            <rect x="${cx - bw / 2}" y="${yTop}" width="${bw}" height="${bh}" fill="var(--accent-blue-soft)" stroke="var(--accent-blue)" stroke-width="1.2" rx="2" />
            <text x="${cx}" y="${padT + plotH + 16}" text-anchor="middle" fill="var(--text-secondary)" font-size="10.5">${q.q}</text>
          `;
        }).join('')}

        <polyline fill="none" stroke="var(--accent-blue)" stroke-width="2.4" points="${opPoints}" />
        <polyline fill="none" stroke="var(--accent-emerald)" stroke-width="2.4" points="${netPoints}" />
      </svg>
    `;
  }

  _renderSvg36MonthRevChart(m36) {
    const W = 760, H = 230, padL = 54, padR = 46, padT = 18, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxRev = Math.max(100, ...m36.map((m) => m.revM)) * 1.1;
    const yoys = m36.map((m) => m.yoy);
    const minY = Math.min(-10, Math.floor(Math.min(...yoys) / 10) * 10);
    const maxY = Math.max(40, Math.ceil(Math.max(...yoys) / 10) * 10);

    const xAt = (i) => padL + (i + 0.5) * (plotW / m36.length);
    const yRev = (v) => padT + plotH - (Math.max(0, v) / maxRev) * plotH;
    const yYoY = (v) => padT + plotH - ((v - minY) / Math.max(1, maxY - minY)) * plotH;

    const yoyPoints = m36.map((m, i) => `${xAt(i)},${yYoY(m.yoy)}`).join(' ');

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:240px; display:block;">
        ${[0, 0.5, 1].map((t) => {
          const y = padT + plotH * (1 - t);
          return `
            <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border-color)" stroke-dasharray="3,3" />
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="10">${Math.round(maxRev * t).toLocaleString()}</text>
            <text x="${W - padR + 6}" y="${y + 4}" text-anchor="start" fill="var(--text-muted)" font-size="10">${Math.round(minY + (maxY - minY) * t)}%</text>
          `;
        }).join('')}

        ${m36.map((m, i) => {
          const cx = xAt(i);
          const bw = Math.max(4, (plotW / m36.length) * 0.62);
          const yTop = yRev(m.revM);
          const bh = Math.max(2, padT + plotH - yTop);
          const showLabel = i % 6 === 0 || i === m36.length - 1;
          return `
            <rect x="${cx - bw / 2}" y="${yTop}" width="${bw}" height="${bh}" fill="var(--accent-blue)" opacity="0.45" />
            ${showLabel ? `<text x="${cx}" y="${padT + plotH + 16}" text-anchor="middle" fill="var(--text-secondary)" font-size="10">${m.ym}</text>` : ''}
          `;
        }).join('')}

        <polyline fill="none" stroke="var(--accent-emerald)" stroke-width="2" points="${yoyPoints}" />
      </svg>
    `;
  }

  _renderSvgTargetPriceChart(stock, targetData) {
    const W = 780, H = 290, padL = 52, padR = 90, padT = 18, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const prices = stock.monthlyPrices || [];
    const allVals = [
      ...prices.map((p) => p.close),
      ...targetData.lines.map((l) => l.targetPrice)
    ];
    const minP = Math.max(0, Math.floor(Math.min(...allVals) * 0.85));
    const maxP = Math.ceil(Math.max(...allVals) * 1.08);

    const xAt = (i) => padL + (i / Math.max(1, prices.length - 1)) * plotW;
    const yAt = (v) => padT + plotH - ((v - minP) / Math.max(1, maxP - minP)) * plotH;

    const closePoints = prices.map((p, i) => `${xAt(i)},${yAt(p.close)}`).join(' ');

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:300px; display:block;">
        ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const v = Math.round(minP + (maxP - minP) * t);
          const y = yAt(v);
          return `
            <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border-color)" />
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="10">${v}</text>
          `;
        }).join('')}

        ${targetData.lines.map((ln) => {
          const y = yAt(ln.targetPrice);
          return `
            <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${ln.color}" stroke-width="1.4" stroke-dasharray="5,4" />
            <text x="${W - padR + 4}" y="${y + 3}" fill="${ln.color}" font-size="9.5" font-weight="600">PE${ln.pe}${ln.scenario} ${ln.targetPrice}</text>
          `;
        }).join('')}

        <polyline fill="none" stroke="var(--text-primary)" stroke-width="2.4" points="${closePoints}" />

        ${prices.map((p, i) => (i % 6 === 0 || i === prices.length - 1) ? `
          <text x="${xAt(i)}" y="${padT + plotH + 16}" text-anchor="middle" fill="var(--text-secondary)" font-size="10">${p.ym}</text>
        ` : '').join('')}
      </svg>
    `;
  }

  _renderSvgPkPriceChart(stockA, stockB, priceSeries) {
    const W = 780, H = 260, padL = 56, padR = 56, padT = 18, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxSpread = Math.max(50, ...priceSeries.map((p) => Math.abs(p.spread))) * 1.12;
    const maxClose = Math.max(50, ...priceSeries.flatMap((p) => [p.closeA, p.closeB])) * 1.1;

    const xAt = (i) => padL + (i + 0.5) * (plotW / priceSeries.length);
    const ySpread = (v) => padT + plotH - (Math.abs(v) / maxSpread) * plotH;
    const yClose = (v) => padT + plotH - (v / maxClose) * plotH;

    const ptsA = priceSeries.map((p, i) => `${xAt(i)},${yClose(p.closeA)}`).join(' ');
    const ptsB = priceSeries.map((p, i) => `${xAt(i)},${yClose(p.closeB)}`).join(' ');

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:270px; display:block;">
        ${[0, 0.5, 1].map((t) => {
          const y = padT + plotH * (1 - t);
          return `
            <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border-color)" stroke-dasharray="3,3" />
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="10">${Math.round(maxSpread * t).toLocaleString()}</text>
            <text x="${W - padR + 6}" y="${y + 4}" text-anchor="start" fill="var(--text-muted)" font-size="10">${Math.round(maxClose * t).toLocaleString()}</text>
          `;
        }).join('')}

        ${priceSeries.map((p, i) => {
          const cx = xAt(i);
          const bw = Math.max(6, (plotW / priceSeries.length) * 0.62);
          const yTop = ySpread(p.spread);
          const bh = Math.max(2, padT + plotH - yTop);
          const isAHigher = p.spread >= 0;
          const fill = isAHigher ? 'var(--accent-emerald-soft)' : 'var(--accent-rose-soft)';
          const stroke = isAHigher ? 'var(--accent-emerald)' : 'var(--accent-rose)';
          const showLabel = i % 5 === 0 || i === priceSeries.length - 1;
          return `
            <rect x="${cx - bw / 2}" y="${yTop}" width="${bw}" height="${bh}" fill="${fill}" stroke="${stroke}" stroke-width="1" />
            ${showLabel ? `<text x="${cx}" y="${padT + plotH + 16}" text-anchor="middle" fill="var(--text-secondary)" font-size="10">${p.ym}</text>` : ''}
          `;
        }).join('')}

        <polyline fill="none" stroke="#2563eb" stroke-width="2.4" points="${ptsA}" />
        <polyline fill="none" stroke="#ea580c" stroke-width="2.4" points="${ptsB}" />
      </svg>
    `;
  }

  _renderSvgPkQuarterChart(stockA, stockB, quarterSeries) {
    const W = 760, H = 240, padL = 48, padR = 48, padT = 18, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const allM = quarterSeries.flatMap((q) => [q.opMarginA, q.opMarginB]);
    const minM = Math.min(-5, Math.floor(Math.min(...allM) / 5) * 5);
    const maxM = Math.max(20, Math.ceil(Math.max(...allM) / 5) * 5 + 5);
    const maxE = Math.max(5, ...quarterSeries.flatMap((q) => [Math.max(0, q.epsA), Math.max(0, q.epsB)])) * 1.15;

    const xAt = (i) => padL + (i + 0.5) * (plotW / quarterSeries.length);
    const yM = (v) => padT + plotH - ((v - minM) / Math.max(1, maxM - minM)) * plotH;
    const yE = (v) => padT + plotH - (Math.max(0, v) / maxE) * plotH;

    const opPtsA = quarterSeries.map((q, i) => `${xAt(i)},${yM(q.opMarginA)}`).join(' ');
    const opPtsB = quarterSeries.map((q, i) => `${xAt(i)},${yM(q.opMarginB)}`).join(' ');

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:250px; display:block;">
        ${quarterSeries.map((q, i) => {
          const cx = xAt(i);
          const bw = 15;
          const yEA = yE(q.epsA);
          const yEB = yE(q.epsB);
          return `
            <rect x="${cx - bw - 2}" y="${yEA}" width="${bw}" height="${Math.max(2, padT + plotH - yEA)}" fill="rgba(59,130,246,0.35)" stroke="#3b82f6" />
            <rect x="${cx + 2}" y="${yEB}" width="${bw}" height="${Math.max(2, padT + plotH - yEB)}" fill="rgba(249,115,22,0.35)" stroke="#f97316" />
            <text x="${cx}" y="${padT + plotH + 16}" text-anchor="middle" fill="var(--text-secondary)" font-size="10.5">${q.q}</text>
          `;
        }).join('')}

        <polyline fill="none" stroke="#3b82f6" stroke-width="2.4" points="${opPtsA}" />
        <polyline fill="none" stroke="#f97316" stroke-width="2.4" points="${opPtsB}" />
      </svg>
    `;
  }

  _renderSvgPkRevenueChart(stockA, stockB, revenueSeries) {
    const W = 760, H = 230, padL = 54, padR = 48, padT = 18, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxRev = Math.max(100, ...revenueSeries.flatMap((r) => [r.revMA, r.revMB])) * 1.1;
    const allY = revenueSeries.flatMap((r) => [r.yoyA, r.yoyB]);
    const minY = Math.min(-20, Math.floor(Math.min(...allY) / 10) * 10);
    const maxY = Math.max(40, Math.ceil(Math.max(...allY) / 10) * 10);

    const xAt = (i) => padL + (i + 0.5) * (plotW / revenueSeries.length);
    const yRev = (v) => padT + plotH - (Math.max(0, v) / maxRev) * plotH;
    const yYoY = (v) => padT + plotH - ((v - minY) / Math.max(1, maxY - minY)) * plotH;

    const ptsYA = revenueSeries.map((r, i) => `${xAt(i)},${yYoY(r.yoyA)}`).join(' ');
    const ptsYB = revenueSeries.map((r, i) => `${xAt(i)},${yYoY(r.yoyB)}`).join(' ');

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:240px; display:block;">
        ${revenueSeries.map((r, i) => {
          const cx = xAt(i);
          const bw = 5;
          const yA = yRev(r.revMA);
          const yB = yRev(r.revMB);
          const showLbl = i % 6 === 0 || i === revenueSeries.length - 1;
          return `
            <rect x="${cx - bw}" y="${yA}" width="${bw}" height="${Math.max(2, padT + plotH - yA)}" fill="rgba(59,130,246,0.38)" />
            <rect x="${cx}" y="${yB}" width="${bw}" height="${Math.max(2, padT + plotH - yB)}" fill="rgba(249,115,22,0.38)" />
            ${showLbl ? `<text x="${cx}" y="${padT + plotH + 16}" text-anchor="middle" fill="var(--text-secondary)" font-size="10">${r.ym}</text>` : ''}
          `;
        }).join('')}

        <polyline fill="none" stroke="#3b82f6" stroke-width="2" points="${ptsYA}" />
        <polyline fill="none" stroke="#f97316" stroke-width="2" points="${ptsYB}" />
      </svg>
    `;
  }

  _bindEvents(container, state, store, showToast) {
    const rerender = () => this.render(container, store.getState(), store, showToast);

    container.querySelectorAll('[data-gs-main]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mainTab = btn.getAttribute('data-gs-main');
        rerender();
      });
    });

    container.querySelectorAll('[data-gs-screen]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.screenerMode = btn.getAttribute('data-gs-screen');
        rerender();
      });
    });

    // Toggle advanced filters drawer
    const advBtn = container.querySelector('#btn-toggle-gs-filters');
    if (advBtn) {
      advBtn.addEventListener('click', () => {
        this.showAdvancedFilters = !this.showAdvancedFilters;
        rerender();
      });
    }

    // Universal column sorting across all 5 screeners
    container.querySelectorAll('th[data-gs-sort-mode]').forEach((th) => {
      th.addEventListener('click', () => {
        const mode = th.getAttribute('data-gs-sort-mode');
        const col = th.getAttribute('data-gs-sort-col');
        const def = th.getAttribute('data-gs-sort-def') || 'desc';
        this._toggleSort(mode, col, def);
        rerender();
      });
    });

    // Quick Jump Input in Top Toolbar
    const qJumpBtn = container.querySelector('#btn-gs-quick-jump');
    const qJumpInp = container.querySelector('#gs-quick-jump-input');
    if (qJumpBtn && qJumpInp) {
      const doJump = () => {
        const v = qJumpInp.value.trim();
        if (v) {
          this.openStockInfo(v, 'all');
          rerender();
        }
      };
      qJumpBtn.addEventListener('click', doJump);
      qJumpInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doJump();
      });
    }

    container.querySelectorAll('[data-open-stock]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = btn.getAttribute('data-open-stock');
        this.openStockInfo(code, 'all');
        rerender();
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
      });
    });

    container.querySelectorAll('[data-pk-select]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-pk-select');
        if (this.pkCodeA !== code) {
          this.pkCodeB = this.pkCodeA;
          this.pkCodeA = code;
        }
        this.mainTab = 'pk';
        rerender();
      });
    });

    container.querySelectorAll('[data-six-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-six-preset');
        this.sixFilters = {
          scope: 'ALL', industry: 'ALL', minAvgScore: 0, maxLandmines: '',
          momDeltaMode: 'ALL', qoqDeltaMode: 'ALL', improvedItem: 'ALL',
          minRevScore: 0, minOpScore: 0, minProfitScore: 0, minEpsScore: 0, minInvScore: 0, minFcfScore: 0,
          sortBy: 'avgScore'
        };
        if (p === 'ETF_0050') {
          this.sixFilters.scope = 'ETF_0050';
        } else if (p === 'ALL_HIGH') {
          this.sixFilters.minAvgScore = 3.0;
          this.sixFilters.maxLandmines = '1';
        } else if (p === 'MOM_UP') {
          this.sixFilters.momDeltaMode = 'UP';
          this.tableSort.six_indicators = { col: 'deltaMoM', dir: 'desc' };
        } else if (p === 'QOQ_UP') {
          this.sixFilters.qoqDeltaMode = 'UP';
          this.tableSort.six_indicators = { col: 'deltaQoQ', dir: 'desc' };
        } else if (p === 'DUAL_UP') {
          this.sixFilters.minAvgScore = 3.0;
          this.sixFilters.momDeltaMode = 'NON_DEC';
          this.sixFilters.qoqDeltaMode = 'UP';
          this.tableSort.six_indicators = { col: 'deltaQoQ', dir: 'desc' };
        } else if (p === 'MY_HOLDINGS') {
          this.sixFilters.scope = 'HOLDINGS';
        } else if (p === 'WEAKENING') {
          this.sixFilters.momDeltaMode = 'DOWN';
        }
        rerender();
      });
    });

    const bindSelect = (id, targetObj, key) => {
      const el = container.querySelector(`#${id}`);
      if (el) {
        el.addEventListener('change', () => {
          targetObj[key] = el.value;
          rerender();
        });
      }
    };

    bindSelect('six-scope', this.sixFilters, 'scope');
    bindSelect('six-industry', this.sixFilters, 'industry');
    bindSelect('six-min-avg', this.sixFilters, 'minAvgScore');
    bindSelect('six-max-avg', this.sixFilters, 'maxAvgScore');
    bindSelect('six-max-landmines', this.sixFilters, 'maxLandmines');
    bindSelect('six-mom-mode', this.sixFilters, 'momDeltaMode');
    bindSelect('six-qoq-mode', this.sixFilters, 'qoqDeltaMode');
    bindSelect('six-improved-item', this.sixFilters, 'improvedItem');
    bindSelect('six-min-rev', this.sixFilters, 'minRevScore');
    bindSelect('six-min-op', this.sixFilters, 'minOpScore');
    bindSelect('six-min-profit', this.sixFilters, 'minProfitScore');
    bindSelect('six-min-eps', this.sixFilters, 'minEpsScore');
    bindSelect('six-min-inv', this.sixFilters, 'minInvScore');
    bindSelect('six-min-fcf', this.sixFilters, 'minFcfScore');

    bindSelect('strong-days', this.strongFilters, 'lookbackDays');
    bindSelect('strong-min-gain', this.strongFilters, 'minGainPct');
    bindSelect('strong-vol-surge', this.strongFilters, 'minVolSurgePct');
    bindSelect('strong-min-price', this.strongFilters, 'minPrice');

    container.querySelectorAll('[data-fin-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-fin-preset');
        if (p === 'CLEAR') {
          Object.assign(this.finFilters, {
            minOpMargin: '', maxOpMargin: '', minEps: '', maxEps: '',
            minRevYoY: '', maxRevYoY: '', minCumYoY: '', maxCumYoY: '',
            minDoubleArrow: '', maxDoubleArrow: '', minPrice: '', maxPrice: '', minPe: '', maxPe: ''
          });
        } else if (p === 'DEFAULT') {
          Object.assign(this.finFilters, {
            minOpMargin: 10, minEps: 1, minRevYoY: 20, minCumYoY: 20, minDoubleArrow: '', minPrice: ''
          });
        } else if (p === 'DOUBLE_ARROW') {
          Object.assign(this.finFilters, {
            minOpMargin: 15, minEps: 2, minRevYoY: 25, minCumYoY: 20, minDoubleArrow: 65
          });
          this.tableSort.financial = { col: 'doubleArrow', dir: 'desc' };
        } else if (p === 'HIGH_PRICE') {
          Object.assign(this.finFilters, {
            minOpMargin: 10, minEps: 5, minRevYoY: 15, minCumYoY: 15, minPrice: 1000
          });
          this.tableSort.financial = { col: 'latestOpMargin', dir: 'desc' };
        }
        rerender();
      });
    });

    bindSelect('fin-min-op', this.finFilters, 'minOpMargin');
    bindSelect('fin-max-op', this.finFilters, 'maxOpMargin');
    bindSelect('fin-min-eps', this.finFilters, 'minEps');
    bindSelect('fin-max-eps', this.finFilters, 'maxEps');
    bindSelect('fin-min-revyoy', this.finFilters, 'minRevYoY');
    bindSelect('fin-max-revyoy', this.finFilters, 'maxRevYoY');
    bindSelect('fin-min-arrow', this.finFilters, 'minDoubleArrow');
    bindSelect('fin-max-arrow', this.finFilters, 'maxDoubleArrow');

    bindSelect('trend-days', this.trendFilters, 'trendDays');
    bindSelect('trend-move', this.trendFilters, 'minMovePct');
    bindSelect('nh-rev', this.newHighFilters, 'revHighMonths');
    bindSelect('nh-op', this.newHighFilters, 'opHighQuarters');
    bindSelect('nh-eps', this.newHighFilters, 'epsHighQuarters');
    bindSelect('nh-price', this.newHighFilters, 'priceHighDays');
    bindSelect('nh-vol', this.newHighFilters, 'volHighDays');

    container.querySelectorAll('[data-gs-info-sec]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.infoSection = btn.getAttribute('data-gs-info-sec');
        rerender();
      });
    });

    container.querySelectorAll('[data-gs-health-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.healthTab = btn.getAttribute('data-gs-health-tab');
        rerender();
      });
    });

    const searchBtn = container.querySelector('#btn-gs-search-stock');
    const searchInput = container.querySelector('#gs-stock-search-input');
    if (searchBtn && searchInput) {
      const doSearch = () => {
        const val = searchInput.value.trim();
        if (val) {
          this.openStockInfo(val, this.infoSection);
          rerender();
        }
      };
      searchBtn.addEventListener('click', doSearch);
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
      });
    }

    const liveBtn = container.querySelector('#btn-gs-fetch-live');
    if (liveBtn) {
      liveBtn.addEventListener('click', async () => {
        const code = searchInput && searchInput.value.trim() ? searchInput.value.trim() : this.selectedCode;
        this.isFetchingLive = true;
        rerender();
        try {
          const res = await GoodStockData.fetchLiveFinMindStock(code);
          this.selectedCode = res.stock.code;
          if (showToast) {
            showToast(res.source === 'finmind-live'
              ? `已從 FinMind 更新 ${res.stock.code} ${res.stock.name} 最新收盤價 (${res.stock.price})`
              : `已載入 ${res.stock.code} ${res.stock.name} 內建財報快取 (${res.stock.price})`);
          }
        } catch (err) {
          if (showToast) showToast(`錯誤：${err.message}`);
        } finally {
          this.isFetchingLive = false;
          rerender();
        }
      });
    }

    const syncAllFinBtn = container.querySelector('#btn-gs-sync-all-financials');
    if (syncAllFinBtn) {
      syncAllFinBtn.addEventListener('click', async () => {
        if (this.isSyncingAllFinancials) return;
        // Auto-include any newly added TW stock holdings & watchlist into GoodStockData
        const curState = store.getState();
        const existingCodes = new Set(GoodStockData.getAllStocks().map((s) => s.code));
        const extraTwCodes = new Set();
        for (const r of (curState?.stock?.overview || [])) {
          const c = String(r['代號'] || '').replace(/\.TW$/i, '').trim();
          if (/^\d{4}$/.test(c) && !existingCodes.has(c)) extraTwCodes.add(c);
        }
        for (const w of (curState?.stock?.watchlist || [])) {
          const c = String(w['代號'] || '').replace(/\.TW$/i, '').trim();
          if (/^\d{4}$/.test(c) && !existingCodes.has(c)) extraTwCodes.add(c);
        }
        for (const c of extraTwCodes) {
          const uMatch = GoodStockCore._universeIndex?.stocks?.find((u) => u.code === c);
          GoodStockData.saveCustomStock({
            code: c,
            name: uMatch?.name || c,
            industry: uMatch?.industry || '上市櫃',
            price: uMatch?.price || 0,
            peBands: [12, 16, 20],
            monthlyRevenues: uMatch?.monthlyRevenues || [],
            quarters: [],
            annualDividends: [],
            priceHistory: [],
            inUserPortfolio: true
          });
        }

        const allStocks = GoodStockData.getAllStocks();
        const unsyncedCount = allStocks.filter((s) => s.dataSource !== 'finmind-live').length;
        const onlyUnsynced = unsyncedCount > 0 && unsyncedCount < allStocks.length;
        this.isSyncingAllFinancials = true;
        this.syncFinProgress = { done: 0, total: onlyUnsynced ? unsyncedCount : allStocks.length, successCount: 0, failCount: 0 };
        if (showToast) {
          showToast(`開始從 FinMind 批次抓取 ${this.syncFinProgress.total} 檔真實季報與月營收，請稍候...`);
        }
        rerender();
        try {
          const res = await GoodStockData.syncAllFinMindFinancials((prog) => {
            this.syncFinProgress = prog;
            const btn = container.querySelector('#btn-gs-sync-all-financials');
            if (btn) btn.textContent = `同步財報 (${prog.done}/${prog.total})`;
          }, { onlyUnsynced });
          if (showToast) {
            showToast(res.successCount > 0
              ? `真實財報同步完成！成功 ${res.successCount} 檔${res.failCount > 0 ? `，略過/失敗 ${res.failCount} 檔` : ''}`
              : '無法連線 FinMind API 或已達免費額度上限，請稍後再試');
          }
        } catch (err) {
          if (showToast) showToast(`同步真實財報失敗：${err.message}`);
        } finally {
          this.isSyncingAllFinancials = false;
          this.syncFinProgress = null;
          rerender();
        }
      });
    }

    const syncAllBtn = container.querySelector('#btn-gs-sync-all-prices');
    if (syncAllBtn) {
      syncAllBtn.addEventListener('click', async () => {
        if (this.isSyncingAllPrices) return;
        this.isSyncingAllPrices = true;
        rerender();
        try {
          const res = await GoodStockData.syncAllLatestPrices();
          if (showToast) {
            showToast(res.updatedCount > 0
              ? `已同步證交所最新收盤價（共更新 ${res.updatedCount} 檔）`
              : `目前全股票池 (${GoodStockData.getAllStocks().length} 檔) 已是最新收盤價`);
          }
        } catch (err) {
          if (showToast) showToast(`同步報價失敗：${err.message}`);
        } finally {
          this.isSyncingAllPrices = false;
          rerender();
        }
      });
    }

    const applyPeBtn = container.querySelector('#btn-gs-apply-pe');
    if (applyPeBtn) {
      applyPeBtn.addEventListener('click', () => {
        const p1 = Number(container.querySelector('#gs-pe-1')?.value) || 20;
        const p2 = Number(container.querySelector('#gs-pe-2')?.value) || 30;
        const p3 = Number(container.querySelector('#gs-pe-3')?.value) || 40;
        this.customPeBands = [p1, p2, p3];
        rerender();
      });
    }

    container.querySelectorAll('[data-pk-pair]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [a, b] = btn.getAttribute('data-pk-pair').split(',');
        this.pkCodeA = a;
        this.pkCodeB = b;
        rerender();
      });
    });

    const selA = container.querySelector('#pk-select-a');
    const selB = container.querySelector('#pk-select-b');
    if (selA) {
      selA.addEventListener('change', () => {
        this.pkCodeA = selA.value;
        rerender();
      });
    }
    if (selB) {
      selB.addEventListener('change', () => {
        this.pkCodeB = selB.value;
        rerender();
      });
    }

    const reloadUniBtn = container.querySelector('#btn-gs-reload-universe');
    if (reloadUniBtn) {
      reloadUniBtn.addEventListener('click', async () => {
        reloadUniBtn.disabled = true;
        reloadUniBtn.textContent = '⏳ 載入中...';
        const idx = await GoodStockCore.loadUniverseIndex(true);
        if (idx && idx.stocks?.length) {
          showToast(`✅ 已載入全市場索引：${idx.stocks.length} 檔（更新時間：${idx.updatedAt || '最新'}）`);
        } else {
          showToast('⚠️ 尚未產生全市場索引檔，請先點擊「⚡ 觸發全市場更新」跑一次 GitHub Actions');
        }
        rerender();
      });
    }
  }

  _renderSixHistoryCharts(series) {
    if (!Array.isArray(series) || series.length === 0) return '';
    const W = 720;
    const H1 = 210;
    const L = 42, R = 14, T = 16, B = 32;
    const pw = W - L - R;
    const ph = H1 - T - B;
    const n = series.length;
    const step = pw / n;
    const barW = Math.max(12, step * 0.68);
    const scoreColor = (v) => {
      if (v === null || v === undefined || !isFinite(v)) return 'transparent';
      if (v >= 3.8) return '#dc143c';
      if (v >= 2.8) return '#f59e0b';
      if (v >= 1.8) return '#facc15';
      if (v >= 0.8) return '#22c55e';
      return '#64748b';
    };

    const avgSvg = `
      <svg viewBox="0 0 ${W} ${H1}" style="width:100%; height:auto; display:block;">
        ${[0, 1, 2, 3, 4].map((tick) => {
          const y = T + ph - (tick / 4) * ph;
          return `
            <line x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}" stroke="${tick === 3 ? '#dc143c' : 'var(--border)'}" stroke-dasharray="${tick === 3 ? '4 3' : ''}" stroke-width="${tick === 3 ? '1.2' : '1'}" opacity="${tick === 3 ? '0.65' : '0.5'}" />
            <text x="${L - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="10">${tick.toFixed(1)}</text>
          `;
        }).join('')}
        ${series.map((pt, i) => {
          const val = Math.max(0, Math.min(4, Number(pt.avgScore) || 0));
          const bh = (val / 4) * ph;
          const x = L + i * step + (step - barW) / 2;
          const y = T + ph - bh;
          const fill = val >= 3.0 ? '#dc143c' : '#22c55e';
          return `
            <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${fill}">
              <title>${pt.label}：平均 ${val.toFixed(2)} 分</title>
            </rect>
            <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" fill="var(--text-main)" font-size="9.5" font-weight="600">${val.toFixed(1)}</text>
            <text x="${(x + barW / 2).toFixed(1)}" y="${H1 - 10}" text-anchor="middle" fill="var(--text-muted)" font-size="9">${pt.label.slice(2)}</text>
          `;
        }).join('')}
      </svg>
    `;

    const subMetrics = [
      { key: 'revGrowth', label: '營收' },
      { key: 'opMargin', label: '營業利益' },
      { key: 'profitGrowth', label: '稅後淨利' },
      { key: 'eps', label: 'EPS' },
      { key: 'invTurnover', label: '存貨周轉率' },
      { key: 'fcf', label: '自由現金' }
    ];

    const rowH = 56;
    const H2 = subMetrics.length * rowH + 26;
    const L2 = 68;
    const pw2 = W - L2 - R;
    const step2 = pw2 / n;
    const barW2 = Math.max(12, step2 * 0.68);

    const subSvg = `
      <svg viewBox="0 0 ${W} ${H2}" style="width:100%; height:auto; display:block;">
        ${subMetrics.map((m, rIdx) => {
          const top = rIdx * rowH + 8;
          const innerH = rowH - 14;
          const baseLine = top + innerH;
          return `
            <rect x="${L2}" y="${top}" width="${pw2}" height="${innerH}" fill="none" stroke="var(--border)" stroke-width="1" opacity="0.6" />
            <text x="${L2 - 8}" y="${(top + innerH / 2 + 4).toFixed(1)}" text-anchor="end" fill="var(--text-main)" font-size="10.5" font-weight="600">${m.label}</text>
            ${series.map((pt, i) => {
              const raw = pt.byKey ? pt.byKey[m.key] : null;
              if (raw === null || raw === undefined || !isFinite(raw)) return '';
              const val = Math.max(0, Math.min(4, Number(raw)));
              const bh = (val / 4) * (innerH - 4);
              const x = L2 + i * step2 + (step2 - barW2) / 2;
              const y = baseLine - bh;
              return `
                <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW2.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${scoreColor(val)}">
                  <title>${pt.label} ${m.label}：${val} 分</title>
                </rect>
              `;
            }).join('')}
          `;
        }).join('')}
        ${series.map((pt, i) => {
          const x = L2 + i * step2 + step2 / 2;
          return `<text x="${x.toFixed(1)}" y="${H2 - 6}" text-anchor="middle" fill="var(--text-muted)" font-size="9">${pt.label.slice(2)}</text>`;
        }).join('')}
      </svg>
    `;

    return `
      <div style="margin-top:16px; display:flex; flex-direction:column; gap:14px;">
        <div style="padding:12px; border-radius:10px; border:1px solid var(--border); background:var(--bg-elevated, rgba(255,255,255,0.02));">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
            <span style="font-size:13px; font-weight:700;">近 12 個月六大指標平均分走勢 (≥ 3.0 紅柱轉強)</span>
            <span class="text-muted" style="font-size:11px;">紅 ≥ 3.0 ｜ 綠 &lt; 3.0</span>
          </div>
          ${avgSvg}
        </div>
        <div style="padding:12px; border-radius:10px; border:1px solid var(--border); background:var(--bg-elevated, rgba(255,255,255,0.02));">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
            <span style="font-size:13px; font-weight:700;">六大指標分項 12 個月評分細覽 (0 ~ 4 分)</span>
            <span class="text-muted" style="font-size:11px;">4分紅 ｜ 3分橘 ｜ 2分黃 ｜ 1分綠</span>
          </div>
          ${subSvg}
        </div>
      </div>
    `;
  }
}
