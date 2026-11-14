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

  /**
   * Allow external modules (e.g. StockTrackerUI) to jump directly to a stock's GoodStock workbench
   */
  openStockInfo(rawCode, subView = 'all') {
    const clean = String(rawCode || '2330').replace(/\.TW$/i, '').trim();
    this.selectedCode = clean || '2330';
    this.mainTab = 'stock_info';
    this.infoSection = subView || 'all';
    this.customPeBands = null;
  }

  render(container, state, store, showToast) {
    const universe = GoodStockCore.getEnrichedUniverse(state);
    const industries = Array.from(new Set(universe.map((s) => s.industry))).filter(Boolean);

    container.innerHTML = `
      <!-- Top Hero & Main Module Switcher -->
      <div class="card" style="margin-bottom:14px; background:linear-gradient(135deg, rgba(30,41,59,0.92), rgba(15,23,42,0.96)); border:1px solid rgba(56,189,248,0.28);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="pill pill-emerald">🎯 好股價 GoodStockPrice 完整旗艦版</span>
              <span class="pill pill-blue">🔓 金卡功能全解鎖 · 六大指標前月/前季比較</span>
            </div>
            <div style="font-size:1.05rem; font-weight:700; margin-top:6px;">
              用 8 季財報、36 個月營收、財務六大指標與目標價區間，把選股與持股體檢標準化
            </div>
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn ${this.mainTab === 'screener' ? 'btn-primary' : 'btn-ghost'}" data-gs-main="screener">
              ① 選股功能 (5大引擎)
            </button>
            <button class="btn ${this.mainTab === 'stock_info' ? 'btn-primary' : 'btn-ghost'}" data-gs-main="stock_info">
              ② 股票資訊 (${this.selectedCode})
            </button>
            <button class="btn ${this.mainTab === 'pk' ? 'btn-primary' : 'btn-ghost'}" data-gs-main="pk">
              ③ 雙股PK對比 (${this.pkCodeA} vs ${this.pkCodeB})
            </button>
          </div>
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

  // ============================================================================
  // ① 選股功能 (5 Sub-Tabs: 六大指標選股 / 近期強勢股 / 財務選股 / 趨勢選股 / 創新高選股)
  // ============================================================================
  _renderScreenerMain(state, universe, industries) {
    return `
      <div class="sub-tabs" style="margin-bottom:14px;">
        <button class="sub-tab ${this.screenerMode === 'six_indicators' ? 'active' : ''}" data-gs-screen="six_indicators">
          🌟 六大指標選股 (含前月/前季比較)
        </button>
        <button class="sub-tab ${this.screenerMode === 'strong' ? 'active' : ''}" data-gs-screen="strong">
          🔥 近期強勢股
        </button>
        <button class="sub-tab ${this.screenerMode === 'financial' ? 'active' : ''}" data-gs-screen="financial">
          📊 財務選股 (雙箭頭)
        </button>
        <button class="sub-tab ${this.screenerMode === 'trend' ? 'active' : ''}" data-gs-screen="trend">
          📈 趨勢選股
        </button>
        <button class="sub-tab ${this.screenerMode === 'newhigh' ? 'active' : ''}" data-gs-screen="newhigh">
          🚀 創新高選股
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
      return `<span class="pill pill-emerald" style="font-weight:700;">${prefix}▲ +${d.toFixed(2)}</span>`;
    }
    if (d < 0) {
      return `<span class="pill pill-rose" style="font-weight:700;">${prefix}▼ ${d.toFixed(2)}</span>`;
    }
    return `<span class="pill" style="background:rgba(148,163,184,0.14); color:var(--text-muted);">${prefix}持平 0.00</span>`;
  }

  _renderItemScoreCell(itemComp) {
    if (!itemComp || itemComp.score === null) {
      return `<span class="text-muted" style="font-size:0.78rem;">不評分</span>`;
    }
    const s = itemComp.score;
    const cls = s >= 3.5 ? 'text-emerald' : s >= 2.5 ? 'text-sky' : s >= 1.5 ? 'text-amber' : 'text-rose';
    const arrows = [];
    if (itemComp.deltaMoM > 0) arrows.push(`<span class="text-emerald" title="較前月 +${itemComp.deltaMoM}">月▲</span>`);
    else if (itemComp.deltaMoM < 0) arrows.push(`<span class="text-rose" title="較前月 ${itemComp.deltaMoM}">月▼</span>`);

    if (itemComp.deltaQoQ > 0) arrows.push(`<span class="text-emerald" title="較前季 +${itemComp.deltaQoQ}">季▲</span>`);
    else if (itemComp.deltaQoQ < 0) arrows.push(`<span class="text-rose" title="較前季 ${itemComp.deltaQoQ}">季▼</span>`);

    return `
      <div style="font-weight:700;" class="${cls}">${s.toFixed(1)}</div>
      ${arrows.length ? `<div style="font-size:0.7rem; line-height:1.1;">${arrows.join(' ')}</div>` : ''}
    `;
  }

  _renderSixIndicatorsScreener(state, industries) {
    const f = this.sixFilters;
    const results = GoodStockCore.screenStocks(state, 'six_indicators', f);

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="flex-wrap:wrap; gap:8px;">
          <div>
            <div class="card-title">🌟 財務六大指標評分選股（支援「與前一個月 MoM」及「與前一季 QoQ」評分比較）</div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">
              依據《財務六大指標》試算表規則（0~4分制）自動評算當期 ($T_0$)、前一個月 ($M_{-1}$)、前一季 ($Q_{-1}$) 總均分與單項升降變化
            </div>
          </div>
          <!-- Quick Strategy Preset Buttons -->
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-ghost btn-sm" data-six-preset="ALL_HIGH">🏆 資優高分 (≥3.2分)</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="MOM_UP">🚀 較前月轉強 (MoM &gt; 0)</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="QOQ_UP">🔥 較前季躍進 (QoQ &gt; 0)</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="DUAL_UP">💎 雙重成長 (當期≥3.0 + 季/月進步)</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="MY_HOLDINGS">💼 我的庫存台股 (${state?.stock?.overview?.filter(r => String(r['代號']||'').includes('.TW') || r['市場']==='TW').length || 10}檔)</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="WEAKENING">⚠️ 評分轉弱 (&lt; 0)</button>
            <button class="btn btn-ghost btn-sm" data-six-preset="RESET">↺ 重設條件</button>
          </div>
        </div>

        <!-- Row 1: Scope, Current Score, Landmine Filter, Sort -->
        <div class="form-grid" style="margin-bottom:12px;">
          <div class="form-group">
            <label class="form-label">篩選範圍</label>
            <select class="form-select" id="six-scope">
              <option value="ALL" ${f.scope === 'ALL' ? 'selected' : ''}>全市場指標股 (${GoodStockData.getAllStocks().length} 檔)</option>
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
            <label class="form-label">🌟 當期總平均分門檻 (0~4)</label>
            <select class="form-select" id="six-min-avg">
              <option value="0" ${Number(f.minAvgScore) === 0 ? 'selected' : ''}>不限 (0.0+)</option>
              <option value="2.5" ${Number(f.minAvgScore) === 2.5 ? 'selected' : ''}>≥ 2.5 分 (BB 穩健以上)</option>
              <option value="3.0" ${Number(f.minAvgScore) === 3.0 ? 'selected' : ''}>≥ 3.0 分 (A 優良以上)</option>
              <option value="3.5" ${Number(f.minAvgScore) === 3.5 ? 'selected' : ''}>≥ 3.5 分 (AA 頂級績優)</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">⚠️ 財務地雷上限 (共7項)</label>
            <select class="form-select" id="six-max-landmines">
              <option value="" ${f.maxLandmines === '' ? 'selected' : ''}>不限</option>
              <option value="0" ${String(f.maxLandmines) === '0' ? 'selected' : ''}>0 項地雷 (完全無地雷)</option>
              <option value="1" ${String(f.maxLandmines) === '1' ? 'selected' : ''}>≤ 1 項地雷</option>
              <option value="2" ${String(f.maxLandmines) === '2' ? 'selected' : ''}>≤ 2 項地雷</option>
            </select>
          </div>
        </div>

        <!-- Row 2: MoM & QoQ Historical Score Comparison Filters -->
        <div style="background:rgba(14,165,233,0.08); border:1px solid rgba(56,189,248,0.25); border-radius:10px; padding:12px; margin-bottom:12px;">
          <div style="font-size:0.84rem; font-weight:700; color:#38bdf8; margin-bottom:8px;">
            📈 歷史評分動態比較篩選（與前一個月 MoM ／ 與前一季 QoQ 評分比較）
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">📅 與前一個月評分比較 (ΔMoM)</label>
              <select class="form-select" id="six-mom-mode">
                <option value="ALL" ${f.momDeltaMode === 'ALL' ? 'selected' : ''}>不限</option>
                <option value="UP" ${f.momDeltaMode === 'UP' ? 'selected' : ''}>▲ 較前月上升 (&gt; 0 分)</option>
                <option value="UP_015" ${f.momDeltaMode === 'UP_015' ? 'selected' : ''}>🚀 較前月明顯上升 (≥ +0.15 分)</option>
                <option value="NON_DEC" ${f.momDeltaMode === 'NON_DEC' ? 'selected' : ''}>✅ 較前月持平或上升 (≥ 0 分)</option>
                <option value="DOWN" ${f.momDeltaMode === 'DOWN' ? 'selected' : ''}>▼ 較前月下降 (&lt; 0 分)</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">📊 與前一季評分比較 (ΔQoQ)</label>
              <select class="form-select" id="six-qoq-mode">
                <option value="ALL" ${f.qoqDeltaMode === 'ALL' ? 'selected' : ''}>不限</option>
                <option value="UP" ${f.qoqDeltaMode === 'UP' ? 'selected' : ''}>▲ 較前季上升 (&gt; 0 分)</option>
                <option value="UP_030" ${f.qoqDeltaMode === 'UP_030' ? 'selected' : ''}>🔥 較前季躍進 (≥ +0.30 分)</option>
                <option value="UP_050" ${f.qoqDeltaMode === 'UP_050' ? 'selected' : ''}>💎 較前季大躍進 (≥ +0.50 分)</option>
                <option value="NON_DEC" ${f.qoqDeltaMode === 'NON_DEC' ? 'selected' : ''}>✅ 較前季持平或上升 (≥ 0 分)</option>
                <option value="DOWN" ${f.qoqDeltaMode === 'DOWN' ? 'selected' : ''}>▼ 較前季下降 (&lt; 0 分)</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">🎯 指定單項指標升等過濾</label>
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

            <div class="form-group">
              <label class="form-label">🔃 排序依據</label>
              <select class="form-select" id="six-sort-by">
                <option value="avgScore" ${f.sortBy === 'avgScore' ? 'selected' : ''}>🌟 當期總平均分 (高→低)</option>
                <option value="deltaMoM" ${f.sortBy === 'deltaMoM' ? 'selected' : ''}>📅 較前月進步幅度 ΔMoM (高→低)</option>
                <option value="deltaQoQ" ${f.sortBy === 'deltaQoQ' ? 'selected' : ''}>📊 較前季進步幅度 ΔQoQ (高→低)</option>
                <option value="doubleArrow" ${f.sortBy === 'doubleArrow' ? 'selected' : ''}>🏹 財務雙箭頭 (高→低)</option>
                <option value="price" ${f.sortBy === 'price' ? 'selected' : ''}>💰 股價 (高→低)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Row 3: Individual 6 Indicator Minimum Score Filters -->
        <div class="form-grid" style="grid-template-columns:repeat(auto-fit, minmax(135px, 1fr));">
          ${[
            ['six-min-rev', '① 營收成長性最低分', f.minRevScore],
            ['six-min-op', '② 營業利益率最低分', f.minOpScore],
            ['six-min-profit', '③ 獲利成長性最低分', f.minProfitScore],
            ['six-min-eps', '④ 獲利能力EPS最低分', f.minEpsScore],
            ['six-min-inv', '⑤ 存貨周轉率最低分', f.minInvScore],
            ['six-min-fcf', '⑥ 自由現金流最低分', f.minFcfScore]
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

      <!-- Screener Results Table -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">📋 六大指標篩選結果（共符合 <span class="text-sky">${results.length}</span> 檔）</div>
          <div style="font-size:0.78rem; color:var(--text-muted);">
            點擊股票代號可進入「股票資訊」查看完整 8 季財報、六大指標明細與目標價區間圖
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>代號 / 名稱</th>
                <th>產業</th>
                <th class="num">股價 (PE)</th>
                <th class="num">🌟 當期總分</th>
                <th class="num">📅 前月總分 (較前月 MoM)</th>
                <th class="num">📊 前季總分 (較前季 QoQ)</th>
                <th class="num">①營收</th>
                <th class="num">②營益率</th>
                <th class="num">③淨利成長</th>
                <th class="num">④EPS</th>
                <th class="num">⑤存貨</th>
                <th class="num">⑥現金流</th>
                <th class="num">⚠️地雷</th>
                <th class="num">雙箭頭</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${results.map((s) => {
                const ev = s.sixEval;
                const cur = ev.current;
                const comps = ev.itemComparisons;
                const gradeCls = cur.grade === 'AA' || cur.grade === 'A' ? 'pill-emerald' : cur.grade === 'BB' ? 'pill-blue' : 'pill-amber';
                return `
                  <tr>
                    <td>
                      <div style="display:flex; align-items:center; gap:6px;">
                        <button class="btn btn-ghost btn-sm" data-open-stock="${s.code}" style="font-weight:700; color:#38bdf8; padding:2px 7px;">
                          ${s.code} ${s.name}
                        </button>
                        ${s.isHolding ? '<span class="pill pill-purple" style="font-size:0.68rem;">庫存</span>' : ''}
                      </div>
                    </td>
                    <td><span style="font-size:0.8rem; color:var(--text-muted);">${s.industry}</span></td>
                    <td class="num">
                      <div style="font-weight:700;">${fmtNum(s.price, 1)}</div>
                      <div style="font-size:0.72rem; color:var(--text-muted);">PE ${s.pe ?? '-'}</div>
                    </td>
                    <td class="num">
                      <div style="font-size:1.02rem; font-weight:800; color:#38bdf8;">${cur.avgScore.toFixed(2)}</div>
                      <span class="pill ${gradeCls}" style="font-size:0.68rem;">${cur.grade} (${cur.totalScore}/${cur.maxTotalScore})</span>
                    </td>
                    <td class="num">
                      <div style="font-size:0.82rem; color:var(--text-muted);">前月 ${ev.prevMonth.avgScore.toFixed(2)}</div>
                      <div style="margin-top:2px;">${this._renderDeltaBadge(ev.deltaMoM)}</div>
                    </td>
                    <td class="num">
                      <div style="font-size:0.82rem; color:var(--text-muted);">前季 ${ev.prevQuarter.avgScore.toFixed(2)}</div>
                      <div style="margin-top:2px;">${this._renderDeltaBadge(ev.deltaQoQ)}</div>
                    </td>
                    <td class="num">${this._renderItemScoreCell(comps[0])}</td>
                    <td class="num">${this._renderItemScoreCell(comps[1])}</td>
                    <td class="num">${this._renderItemScoreCell(comps[2])}</td>
                    <td class="num">${this._renderItemScoreCell(comps[3])}</td>
                    <td class="num">${this._renderItemScoreCell(comps[4])}</td>
                    <td class="num">${this._renderItemScoreCell(comps[5])}</td>
                    <td class="num">
                      <span class="pill ${s.landmines.hitCount === 0 ? 'pill-emerald' : s.landmines.hitCount <= 1 ? 'pill-amber' : 'pill-rose'}">
                        ${s.landmines.hitCount}/7
                      </span>
                    </td>
                    <td class="num" style="font-weight:700; color:#f59e0b;">${fmtNum(s.doubleArrow, 1)}%</td>
                    <td>
                      <div style="display:flex; gap:4px;">
                        <button class="btn btn-ghost btn-sm" data-open-stock="${s.code}" title="查看財報與健診">🔍 健診</button>
                        <button class="btn btn-ghost btn-sm" data-pk-select="${s.code}" title="設為雙股PK主角">⚔️ PK</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
              ${results.length === 0 ? `<tr><td colspan="15" style="text-align:center; padding:24px; color:var(--text-muted);">無符合篩選條件的股票，請放寬篩選門檻或點選上方「↺ 重設條件」</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderStrongScreener(state) {
    const f = this.strongFilters;
    const results = GoodStockCore.screenStocks(state, 'strong', f);
    const maxGain = Math.max(10, ...results.map((s) => (f.lookbackDays >= 10 ? s.change10dPct : s.change5dPct)));

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">🔥 近期強勢股篩選（基本面過濾：股價≥${f.minPrice}、最新季營益率≥0%、成交量≥${f.minVolumeLots}張）</div>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">條件1：過去 N 個交易日</label>
            <select class="form-select" id="strong-days">
              <option value="5" ${Number(f.lookbackDays) === 5 ? 'selected' : ''}>過去 5 個交易日</option>
              <option value="10" ${Number(f.lookbackDays) === 10 ? 'selected' : ''}>過去 10 個交易日</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">區間漲幅超過 (%)</label>
            <input type="number" class="form-input" id="strong-min-gain" value="${f.minGainPct}" step="1" />
          </div>
          <div class="form-group">
            <label class="form-label">條件2：5日均量較30日均量放大 (%)</label>
            <input type="number" class="form-input" id="strong-vol-surge" value="${f.minVolSurgePct}" step="5" />
          </div>
          <div class="form-group">
            <label class="form-label">最低股價門檻 (元)</label>
            <input type="number" class="form-input" id="strong-min-price" value="${f.minPrice}" step="10" />
          </div>
        </div>
      </div>

      <!-- Horizontal Bar Chart matching Screenshot -->
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">📊 ${f.lookbackDays}日漲幅排名（符合條件共 ${results.length} 檔）</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; padding:4px 0;">
          ${results.slice(0, 12).map((s) => {
            const gain = f.lookbackDays >= 10 ? s.change10dPct : s.change5dPct;
            const widthPct = Math.max(6, Math.min(100, (gain / maxGain) * 100));
            return `
              <div style="display:grid; grid-template-columns:115px 1fr 70px; align-items:center; gap:10px; font-size:0.84rem;">
                <a href="javascript:void(0)" data-open-stock="${s.code}" style="color:#38bdf8; font-weight:700; text-decoration:none;">
                  ${s.code} ${s.name}
                </a>
                <div style="background:rgba(148,163,184,0.12); height:18px; border-radius:4px; overflow:hidden;">
                  <div style="width:${widthPct.toFixed(1)}%; height:100%; background:linear-gradient(90deg, #ef4444, #f97316); border-radius:4px;"></div>
                </div>
                <div class="num text-rose" style="font-weight:700;">+${gain.toFixed(2)}%</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>代號</th>
                <th>名稱</th>
                <th>市場</th>
                <th>產業</th>
                <th class="num">${f.lookbackDays}日漲幅</th>
                <th class="num">股價</th>
                <th class="num">本益比</th>
                <th class="num">月漲幅</th>
                <th class="num">成交量(張)</th>
                <th class="num">營益率</th>
                <th class="num">EPS</th>
                <th class="num">淨利率</th>
                <th class="num">存貨周轉</th>
                <th class="num">自由現金(百萬)</th>
                <th class="num">營收(百萬)</th>
                <th class="num">營收年增</th>
                <th class="num">雙箭頭</th>
                <th class="num">🌟六大總分</th>
              </tr>
            </thead>
            <tbody>
              ${results.map((s) => {
                const gain = f.lookbackDays >= 10 ? s.change10dPct : s.change5dPct;
                return `
                  <tr>
                    <td><button class="btn btn-ghost btn-sm" data-open-stock="${s.code}" style="color:#38bdf8; font-weight:700;">${s.code}</button></td>
                    <td style="font-weight:700;">${s.name}</td>
                    <td>${s.market}</td>
                    <td>${s.industry}</td>
                    <td class="num text-rose" style="font-weight:700;">+${gain.toFixed(2)}%</td>
                    <td class="num" style="font-weight:700;">${fmtNum(s.price, 1)}</td>
                    <td class="num">${s.pe ?? '-'}</td>
                    <td class="num text-rose">+${s.change1mPct.toFixed(2)}%</td>
                    <td class="num">${fmtInt(s.volumeLots)}</td>
                    <td class="num">${s.latestOpMargin.toFixed(2)}%</td>
                    <td class="num">${s.latestEps.toFixed(2)}</td>
                    <td class="num">${s.latestNetMargin.toFixed(2)}%</td>
                    <td class="num">${s.latestInvTurnover ?? '-'}</td>
                    <td class="num">${fmtInt(s.latestFcfM)}</td>
                    <td class="num">${fmtInt(s.latestRevM)}</td>
                    <td class="num text-rose">+${s.latestRevYoY.toFixed(2)}%</td>
                    <td class="num" style="color:#f59e0b; font-weight:700;">${s.doubleArrow.toFixed(1)}%</td>
                    <td class="num" style="color:#38bdf8; font-weight:700;">${s.sixEval.current.avgScore.toFixed(2)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderFinancialScreener(state, industries) {
    const f = this.finFilters;
    const results = GoodStockCore.screenStocks(state, 'financial', f);

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="flex-wrap:wrap; gap:8px;">
          <div class="card-title">📊 財務選股（季報指標 + 月營收年增率 + 🔓 財務雙箭頭 & 千金股排序）</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-ghost btn-sm" data-fin-preset="DEFAULT">預設條件 (營益≥10、EPS≥1、年增≥20)</button>
            <button class="btn btn-ghost btn-sm" data-fin-preset="DOUBLE_ARROW">🏹 財務雙箭頭 ≥ 65%</button>
            <button class="btn btn-ghost btn-sm" data-fin-preset="HIGH_PRICE">👑 千金股營益率排行 (股價≥1000)</button>
            <button class="btn btn-ghost btn-sm" data-fin-preset="CLEAR">清除條件</button>
          </div>
        </div>

        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">營業利益率 (%) Min ~ Max</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="form-input" id="fin-min-op" placeholder="最小" value="${f.minOpMargin}" />
              <input type="number" class="form-input" id="fin-max-op" placeholder="最大" value="${f.maxOpMargin}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">最新季 EPS (元) Min ~ Max</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="form-input" id="fin-min-eps" placeholder="最小" value="${f.minEps}" />
              <input type="number" class="form-input" id="fin-max-eps" placeholder="最大" value="${f.maxEps}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">營收年增率 (%) Min ~ Max</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="form-input" id="fin-min-revyoy" placeholder="最小" value="${f.minRevYoY}" />
              <input type="number" class="form-input" id="fin-max-revyoy" placeholder="最大" value="${f.maxRevYoY}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">累計營收年增率 (%) Min ~ Max</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="form-input" id="fin-min-cumyoy" placeholder="最小" value="${f.minCumYoY}" />
              <input type="number" class="form-input" id="fin-max-cumyoy" placeholder="最大" value="${f.maxCumYoY}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">🔓 財務雙箭頭 (營收年增+營益率%)</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="form-input" id="fin-min-arrow" placeholder="最小" value="${f.minDoubleArrow}" />
              <input type="number" class="form-input" id="fin-max-arrow" placeholder="最大" value="${f.maxDoubleArrow}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">🔓 股價 (元，最新收盤)</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="form-input" id="fin-min-price" placeholder="最小" value="${f.minPrice}" />
              <input type="number" class="form-input" id="fin-max-price" placeholder="最大" value="${f.maxPrice}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">🔓 本益比 (最新股價÷近四季EPS)</label>
            <div style="display:flex; gap:6px;">
              <input type="number" class="form-input" id="fin-min-pe" placeholder="最小" value="${f.minPe}" />
              <input type="number" class="form-input" id="fin-max-pe" placeholder="最大" value="${f.maxPe}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">排序欄位</label>
            <select class="form-select" id="fin-sort-by">
              <option value="doubleArrow" ${f.sortBy === 'doubleArrow' ? 'selected' : ''}>財務雙箭頭 (高→低)</option>
              <option value="latestOpMargin" ${f.sortBy === 'latestOpMargin' ? 'selected' : ''}>營業利益率 (高→低)</option>
              <option value="price" ${f.sortBy === 'price' ? 'selected' : ''}>股價 (高→低)</option>
              <option value="latestEps" ${f.sortBy === 'latestEps' ? 'selected' : ''}>最新季 EPS (高→低)</option>
            </select>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">篩選結果（共 ${results.length} 檔）</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>代號</th>
                <th>名稱</th>
                <th>產業</th>
                <th class="num">股價</th>
                <th class="num">本益比</th>
                <th class="num">月漲幅</th>
                <th class="num">成交量</th>
                <th class="num">營益率 ▲</th>
                <th class="num">EPS</th>
                <th class="num">淨利率</th>
                <th class="num">存貨周轉</th>
                <th class="num">自由現金</th>
                <th class="num">月營收</th>
                <th class="num">營收年增</th>
                <th class="num">累計年增</th>
                <th class="num">🏹 雙箭頭</th>
                <th class="num">🌟 六大總分</th>
              </tr>
            </thead>
            <tbody>
              ${results.map((s) => `
                <tr>
                  <td><button class="btn btn-ghost btn-sm" data-open-stock="${s.code}" style="color:#38bdf8; font-weight:700;">${s.code}</button></td>
                  <td style="font-weight:700;">${s.name}</td>
                  <td>${s.industry}</td>
                  <td class="num" style="font-weight:700;">${fmtNum(s.price, 1)}</td>
                  <td class="num">${s.pe ?? '-'}</td>
                  <td class="num text-rose">+${s.change1mPct.toFixed(2)}%</td>
                  <td class="num">${fmtInt(s.volumeLots)}</td>
                  <td class="num" style="font-weight:700;">${s.latestOpMargin.toFixed(2)}%</td>
                  <td class="num">${s.latestEps.toFixed(2)}</td>
                  <td class="num">${s.latestNetMargin.toFixed(2)}%</td>
                  <td class="num">${s.latestInvTurnover ?? '-'}</td>
                  <td class="num">${fmtInt(s.latestFcfM)}</td>
                  <td class="num">${fmtInt(s.latestRevM)}</td>
                  <td class="num text-rose">+${s.latestRevYoY.toFixed(2)}%</td>
                  <td class="num text-rose">+${s.latestCumYoY.toFixed(2)}%</td>
                  <td class="num" style="color:#f59e0b; font-weight:800;">${s.doubleArrow.toFixed(2)}%</td>
                  <td class="num" style="color:#38bdf8; font-weight:700;">${s.sixEval.current.avgScore.toFixed(2)}</td>
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
    const results = GoodStockCore.screenStocks(state, 'trend', f);

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">📈 趨勢選股（🔓 金卡會員功能：設定 N 日內漲跌幅超過 X% 與跌破前 M 日低點）</div>
        </div>
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
            <input type="number" class="form-input" id="trend-move" value="${f.minMovePct}" />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>代號</th>
                <th>名稱</th>
                <th>產業</th>
                <th class="num">股價</th>
                <th class="num">5日漲幅</th>
                <th class="num">10日漲幅</th>
                <th class="num">20日漲幅</th>
                <th class="num">營益率</th>
                <th class="num">EPS</th>
                <th class="num">營收年增</th>
                <th class="num">🌟 六大總分 (較前季)</th>
              </tr>
            </thead>
            <tbody>
              ${results.map((s) => `
                <tr>
                  <td><button class="btn btn-ghost btn-sm" data-open-stock="${s.code}" style="color:#38bdf8; font-weight:700;">${s.code}</button></td>
                  <td style="font-weight:700;">${s.name}</td>
                  <td>${s.industry}</td>
                  <td class="num" style="font-weight:700;">${fmtNum(s.price, 1)}</td>
                  <td class="num text-rose">+${s.change5dPct.toFixed(2)}%</td>
                  <td class="num text-rose">+${s.change10dPct.toFixed(2)}%</td>
                  <td class="num text-rose">+${s.change20dPct.toFixed(2)}%</td>
                  <td class="num">${s.latestOpMargin.toFixed(2)}%</td>
                  <td class="num">${s.latestEps.toFixed(2)}</td>
                  <td class="num">+${s.latestRevYoY.toFixed(2)}%</td>
                  <td class="num">
                    <span style="font-weight:700; color:#38bdf8;">${s.sixEval.current.avgScore.toFixed(2)}</span>
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
    const results = GoodStockCore.screenStocks(state, 'newhigh', f);

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">🚀 創新高選股（🔓 同時盯五個面向的「創新高」，找出基本面與量價同步轉強的股票）</div>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">營收創 N 個月新高 (0=留空)</label>
            <input type="number" class="form-input" id="nh-rev" value="${f.revHighMonths}" />
          </div>
          <div class="form-group">
            <label class="form-label">營業利益率創 N 季新高</label>
            <input type="number" class="form-input" id="nh-op" value="${f.opHighQuarters}" />
          </div>
          <div class="form-group">
            <label class="form-label">EPS 創 N 季新高</label>
            <input type="number" class="form-input" id="nh-eps" value="${f.epsHighQuarters}" />
          </div>
          <div class="form-group">
            <label class="form-label">股價創 N 日新高</label>
            <input type="number" class="form-input" id="nh-price" value="${f.priceHighDays}" />
          </div>
          <div class="form-group">
            <label class="form-label">成交量創 N 日新高</label>
            <input type="number" class="form-input" id="nh-vol" value="${f.volHighDays}" />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>代號</th>
                <th>名稱</th>
                <th>產業</th>
                <th class="num">股價</th>
                <th class="num">營收創高(月)</th>
                <th class="num">營益率創高(季)</th>
                <th class="num">EPS創高(季)</th>
                <th class="num">股價創高(日)</th>
                <th class="num">量創高(日)</th>
                <th class="num">雙箭頭</th>
                <th class="num">🌟 六大總分</th>
              </tr>
            </thead>
            <tbody>
              ${results.map((s) => `
                <tr>
                  <td><button class="btn btn-ghost btn-sm" data-open-stock="${s.code}" style="color:#38bdf8; font-weight:700;">${s.code}</button></td>
                  <td style="font-weight:700;">${s.name}</td>
                  <td>${s.industry}</td>
                  <td class="num" style="font-weight:700;">${fmtNum(s.price, 1)}</td>
                  <td class="num"><span class="pill pill-emerald">${s.revNewHighMonths} 個月新高</span></td>
                  <td class="num"><span class="pill pill-blue">${s.opMarginNewHighQuarters} 季新高</span></td>
                  <td class="num"><span class="pill pill-blue">${s.epsNewHighQuarters} 季新高</span></td>
                  <td class="num"><span class="pill pill-amber">${s.priceNewHighDays} 日新高</span></td>
                  <td class="num">${s.volNewHighDays} 日新高</td>
                  <td class="num" style="font-weight:700; color:#f59e0b;">${s.doubleArrow.toFixed(1)}%</td>
                  <td class="num" style="font-weight:700; color:#38bdf8;">${s.sixEval.current.avgScore.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // ② 股票資訊 (Single Stock Workbench: 財報查詢 / 財務健診 / 推估今年與三年目標價)
  // ============================================================================
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
      <!-- Stock Search & Quick Portfolio Switcher Bar -->
      <div class="card" style="margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <input type="text" class="form-input" id="gs-stock-search-input" value="${stock.code}" placeholder="輸入台股代號或名稱 (如 2330)" style="width:170px;" />
            <button class="btn btn-primary btn-sm" id="btn-gs-search-stock">🔍 查詢個股</button>
            <button class="btn btn-ghost btn-sm" id="btn-gs-fetch-live" ${this.isFetchingLive ? 'disabled' : ''}>
              ${this.isFetchingLive ? '⏳ 連線 FinMind 中...' : '🌐 即時抓取 FinMind 最新公開資料'}
            </button>
          </div>

          <div style="display:flex; gap:5px; flex-wrap:wrap; align-items:center;">
            <span style="font-size:0.76rem; color:var(--text-muted);">快速切換：</span>
            ${universe.slice(0, 14).map((s) => `
              <button class="btn ${s.code === stock.code ? 'btn-primary' : 'btn-ghost'} btn-sm" data-open-stock="${s.code}" style="padding:3px 8px; font-size:0.76rem;">
                ${s.code} ${s.name}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Stock Header Summary matching screenshot -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-top:14px; padding-top:12px; border-top:1px solid var(--border);">
          <div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <span style="font-size:1.35rem; font-weight:800;">${stock.code} ${stock.name}</span>
              <span class="pill pill-blue">${stock.market} · ${stock.industry}</span>
              <span style="font-size:0.86rem; color:var(--text-muted);">財報:${stock.latestQuarter} ｜ 營收:${stock.latestMonth}</span>
              <span class="pill ${landmines.hitCount === 0 ? 'pill-emerald' : 'pill-amber'}" style="font-weight:700;">
                留意 ${landmines.hitCount}/${landmines.totalCount} 項地雷
              </span>
              <span class="pill pill-emerald" style="font-weight:700;">
                🌟 六大指標 ${sixEval.current.avgScore.toFixed(2)} 分 (${sixEval.current.grade})
              </span>
            </div>
          </div>
          <div style="display:flex; gap:18px; align-items:baseline;">
            <div>
              <span style="font-size:0.78rem; color:var(--text-muted);">最新收盤價</span>
              <span style="font-size:1.35rem; font-weight:800; color:#38bdf8; margin-left:6px;">${fmtNum(stock.price, 1)} 元</span>
            </div>
            <div>
              <span style="font-size:0.78rem; color:var(--text-muted);">近四季EPS</span>
              <span style="font-weight:700; margin-left:4px;">${stock.ttmEps.toFixed(2)} 元 (PE ${stock.pe ?? '-'})</span>
            </div>
            <div>
              <span style="font-size:0.78rem; color:var(--text-muted);">財務雙箭頭</span>
              <span style="font-weight:700; color:#f59e0b; margin-left:4px;">${stock.doubleArrow.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        <!-- Section Navigation Tabs matching screenshot -->
        <div class="sub-tabs" style="margin-top:12px; margin-bottom:0;">
          <button class="sub-tab ${this.infoSection === 'all' ? 'active' : ''}" data-gs-info-sec="all">📋 全部同頁總覽</button>
          <button class="sub-tab ${this.infoSection === 'report' ? 'active' : ''}" data-gs-info-sec="report">📊 財報查詢 (8季+36月)</button>
          <button class="sub-tab ${this.infoSection === 'health' ? 'active' : ''}" data-gs-info-sec="health">🩺 財務健診 (地雷/六大指標/成長力)</button>
          <button class="sub-tab ${this.infoSection === 'target1y' ? 'active' : ''}" data-gs-info-sec="target1y">🔓 推估今年目標價</button>
          <button class="sub-tab ${this.infoSection === 'target3y' ? 'active' : ''}" data-gs-info-sec="target3y">🔓 推估三年目標價</button>
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
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <div class="card-title">🩺 財務健診 — ${stock.code} ${stock.name}</div>
            <span class="pill ${landmines.hitCount === 0 ? 'pill-emerald' : 'pill-amber'}">留意 ${landmines.hitCount}/7 項地雷</span>
          </div>
          <div class="sub-tabs" style="margin-bottom:0; border-bottom:none;">
            <button class="sub-tab ${this.healthTab === 'landmines' ? 'active' : ''}" data-gs-health-tab="landmines">⚠️ 財務地雷 (${landmines.hitCount}/7)</button>
            <button class="sub-tab ${this.healthTab === 'six' ? 'active' : ''}" data-gs-health-tab="six">🔓 六大指標 (${sixEval.current.avgScore.toFixed(2)}分 · 含前月/前季比較)</button>
            <button class="sub-tab ${this.healthTab === 'growth' ? 'active' : ''}" data-gs-health-tab="growth">📈 成長力分析 (QoQ/YoY)</button>
          </div>
        </div>

        ${this.healthTab === 'landmines' ? `
          <div class="table-wrap">
            <table>
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
                        ? '<span style="color:#f59e0b; font-weight:800;">⚠️ 命中</span>'
                        : '<span style="color:#10b981; font-weight:800;">✅ 正常</span>'}
                    </td>
                    <td>${item.detail}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div style="font-size:0.76rem; color:var(--text-muted); margin-top:8px;">
            註：命中越多代表財務體質越需留意；本健診僅為機械式指標篩檢，非投資建議。
          </div>
        ` : ''}

        ${this.healthTab === 'six' ? `
          <!-- Summary Comparison Banner (Current vs Prev Month vs Prev Quarter) -->
          <div class="grid-kpi" style="margin-bottom:14px;">
            <div class="card" style="background:rgba(15,23,42,0.55);">
              <div class="kpi-label">
                <span>🌟 當期六大指標總均分 (${sixEval.current.refQuarter} / ${sixEval.current.refMonth})</span>
                <span class="pill pill-emerald">${sixEval.current.grade} 級</span>
              </div>
              <div class="kpi-value" style="color:#38bdf8;">${sixEval.current.avgScore.toFixed(2)} <span style="font-size:0.9rem; font-weight:500;">/ 4.00 分</span></div>
              <div class="kpi-sub">總分 ${sixEval.current.totalScore} / ${sixEval.current.maxTotalScore} (評算 ${sixEval.current.scoredCount} 項)</div>
            </div>

            <div class="card" style="background:rgba(15,23,42,0.55);">
              <div class="kpi-label">
                <span>📅 與前一個月比較 (${sixEval.prevMonth.refMonth})</span>
                ${this._renderDeltaBadge(sixEval.deltaMoM, 'MoM ')}
              </div>
              <div class="kpi-value" style="font-size:1.35rem;">前月 ${sixEval.prevMonth.avgScore.toFixed(2)} 分 → 當期 ${sixEval.current.avgScore.toFixed(2)} 分</div>
              <div class="kpi-sub">反映最新月營收公佈後對「營收成長性」與總均分之拉動</div>
            </div>

            <div class="card" style="background:rgba(15,23,42,0.55);">
              <div class="kpi-label">
                <span>📊 與前一季比較 (${sixEval.prevQuarter.refQuarter})</span>
                ${this._renderDeltaBadge(sixEval.deltaQoQ, 'QoQ ')}
              </div>
              <div class="kpi-value" style="font-size:1.35rem;">前季 ${sixEval.prevQuarter.avgScore.toFixed(2)} 分 → 當期 ${sixEval.current.avgScore.toFixed(2)} 分</div>
              <div class="kpi-sub">反映最新一季財報出爐後六大指標整體體質升降</div>
            </div>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>六大指標項目</th>
                  <th class="num">🌟 當期得分</th>
                  <th class="num">📅 前月得分 (月變化)</th>
                  <th class="num">📊 前季得分 (季變化)</th>
                  <th>《財務六大指標》試算表評分標準與當期數值依據</th>
                </tr>
              </thead>
              <tbody>
                ${sixEval.itemComparisons.map((it) => `
                  <tr>
                    <td style="font-weight:700;">${it.label}</td>
                    <td class="num">
                      ${it.score === null
                        ? '<span class="pill">不評分</span>'
                        : `<span style="font-size:1.05rem; font-weight:800; color:${it.score >= 3.5 ? '#10b981' : it.score >= 2.5 ? '#38bdf8' : '#f59e0b'};">${it.score.toFixed(1)} 分</span>`}
                    </td>
                    <td class="num">
                      ${it.prevMonthScore === null
                        ? '-'
                        : `<span>${it.prevMonthScore.toFixed(1)}</span> ${this._renderDeltaBadge(it.deltaMoM)}`}
                    </td>
                    <td class="num">
                      ${it.prevQuarterScore === null
                        ? '-'
                        : `<span>${it.prevQuarterScore.toFixed(1)}</span> ${this._renderDeltaBadge(it.deltaQoQ)}`}
                    </td>
                    <td style="font-size:0.84rem; color:var(--text-main);">${it.reason}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}

        ${this.healthTab === 'growth' ? `
          <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:10px;">
            最近一季 <strong>${growth.latestQ}</strong> ｜ QoQ＝對上一季 <strong>${growth.prevQ}</strong> ｜ YoY＝對去年同季 <strong>${growth.prevYearQ}</strong>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>項目</th>
                  <th class="num">最近一季 (${growth.latestQ})</th>
                  <th class="num">QoQ (對上一季)</th>
                  <th class="num">YoY (對去年同季)</th>
                </tr>
              </thead>
              <tbody>
                ${growth.rows.map((r) => `
                  <tr>
                    <td style="font-weight:700;">${r.label}</td>
                    <td class="num" style="font-weight:700;">${r.latestVal}</td>
                    <td class="num ${r.qoq >= 0 ? 'text-emerald' : 'text-rose'}" style="font-weight:700;">
                      ${r.qoq >= 0 ? '▲ +' : '▼ '}${r.qoq.toFixed(2)}${r.unit}
                    </td>
                    <td class="num ${r.yoy >= 0 ? 'text-emerald' : 'text-rose'}" style="font-weight:700;">
                      ${r.yoy >= 0 ? '▲ +' : '▼ '}${r.yoy.toFixed(2)}${r.unit}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div style="font-size:0.78rem; color:var(--text-muted); margin-top:8px;">
            利益率 / 淨利率以百分點(pp)變化表示，營收 / EPS 以百分比變化表示；<span class="text-emerald">綠 ▲ 成長</span>、<span class="text-rose">紅 ▼ 衰退</span>。<br/>
            註：淨利率(歸母)計算方式為 歸屬母公司稅後淨利 ÷ 營收
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderFinancialReportBlock(stock, q8, q8Desc, m36, m12Desc) {
    return `
      <!-- 8-Quarter Financial Table & Combo Chart -->
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">📊 最近八季財報 — ${stock.code} ${stock.name}</div>
          <div style="font-size:0.78rem; color:var(--text-muted);">單位：百萬新台幣 / % / 元</div>
        </div>

        <div class="table-wrap" style="margin-bottom:16px;">
          <table>
            <thead>
              <tr>
                <th>項目 \\ 季度</th>
                ${q8Desc.map((q) => `<th class="num">${q.q}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight:700;">營收年增率</td>
                ${q8Desc.map((q) => `<td class="num ${q.revYoY >= 0 ? 'text-rose' : 'text-emerald'}">${q.revYoY.toFixed(2)}%</td>`).join('')}
              </tr>
              <tr>
                <td style="font-weight:700;">營業利益率</td>
                ${q8Desc.map((q) => `<td class="num" style="font-weight:700;">${q.opMargin.toFixed(2)}%</td>`).join('')}
              </tr>
              <tr>
                <td style="font-weight:700;">淨利率(歸母)</td>
                ${q8Desc.map((q) => `<td class="num">${q.netMargin.toFixed(2)}%</td>`).join('')}
              </tr>
              <tr>
                <td style="font-weight:700;">EPS (元)</td>
                ${q8Desc.map((q) => `<td class="num" style="font-weight:700; color:#38bdf8;">${q.eps.toFixed(2)}</td>`).join('')}
              </tr>
              <tr>
                <td style="font-weight:700;">存貨周轉率</td>
                ${q8Desc.map((q) => `<td class="num">${q.invTurnover !== null && q.invTurnover !== undefined ? q.invTurnover.toFixed(2) : '-'}</td>`).join('')}
              </tr>
              <tr>
                <td style="font-weight:700;">自由現金流量(百萬)</td>
                ${q8Desc.map((q) => `<td class="num">${fmtInt(q.fcfM)}</td>`).join('')}
              </tr>
            </tbody>
          </table>
        </div>

        <!-- SVG 8-Quarter Combo Chart (Bars=EPS, Red Line=OpMargin, Green Line=NetMargin) -->
        <div style="background:rgba(15,23,42,0.55); border:1px solid var(--border); border-radius:10px; padding:12px;">
          <div style="text-align:center; font-weight:700; margin-bottom:8px;">八季財報趨勢（柱＝EPS(元) 右軸；紅線＝營業利益率(%)、綠線＝淨利率(歸母)(%) 左軸）</div>
          ${this._renderSvg8QuarterChart(q8)}
        </div>
      </div>

      <!-- 12-Month Revenue Table & 36-Month Revenue Trend Chart -->
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">📈 最近一年營收 & 三年營收趨勢 — ${stock.code} ${stock.name}</div>
        </div>

        <div style="background:rgba(15,23,42,0.55); border:1px solid var(--border); border-radius:10px; padding:12px; margin-bottom:14px;">
          <div style="text-align:center; font-weight:700; margin-bottom:8px;">三年（36個月）營收趨勢（藍柱＝當月營收(百萬) 左軸；紅線＝年增率(%) 右軸）</div>
          ${this._renderSvg36MonthRevChart(m36)}
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>月份</th>
                <th class="num">當月營收(百萬)</th>
                <th class="num">月增率 (MoM)</th>
                <th class="num">年增率 (YoY)</th>
                <th class="num">累計營收年增率</th>
              </tr>
            </thead>
            <tbody>
              ${m12Desc.map((m) => `
                <tr>
                  <td style="font-weight:700;">${m.ym}</td>
                  <td class="num" style="font-weight:700;">${fmtInt(m.revM)}</td>
                  <td class="num ${m.mom >= 0 ? 'text-rose' : 'text-emerald'}">${m.mom >= 0 ? '+' : ''}${m.mom.toFixed(2)}%</td>
                  <td class="num ${m.yoy >= 0 ? 'text-rose' : 'text-emerald'}" style="font-weight:700;">${m.yoy >= 0 ? '+' : ''}${m.yoy.toFixed(2)}%</td>
                  <td class="num ${m.cumYoY >= 0 ? 'text-rose' : 'text-emerald'}">${m.cumYoY >= 0 ? '+' : ''}${m.cumYoY.toFixed(2)}%</td>
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
            <div class="card-title">🎯 股價走勢 vs 目標價（${targetData.horizon === 3 ? '推估三年目標價' : '推估今年目標價'} · 9 條情境目標線）</div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">
              近四季累積 EPS ${targetData.ttmEps} 元 ｜ 預估${targetData.horizon}年後 EPS：樂觀 ${sc.optimistic.eps} 元 (+${sc.optimistic.growthPct}%/年) · 中性 ${sc.neutral.eps} 元 (+${sc.neutral.growthPct}%/年) · 悲觀 ${sc.pessimistic.eps} 元 (${sc.pessimistic.growthPct}%/年)
            </div>
          </div>

          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <span style="font-size:0.78rem; color:var(--text-muted);">自訂三組本益比 (PE)：</span>
            <input type="number" class="form-input" id="gs-pe-1" value="${peBands[0]}" style="width:68px; padding:4px 8px;" />
            <input type="number" class="form-input" id="gs-pe-2" value="${peBands[1]}" style="width:68px; padding:4px 8px;" />
            <input type="number" class="form-input" id="gs-pe-3" value="${peBands[2]}" style="width:68px; padding:4px 8px;" />
            <button class="btn btn-primary btn-sm" id="btn-gs-apply-pe">套用 PE</button>
          </div>
        </div>

        <!-- SVG Price vs 9 Target Price Lines Chart matching screenshot -->
        <div style="background:rgba(15,23,42,0.58); border:1px solid var(--border); border-radius:10px; padding:14px; margin-bottom:12px;">
          <div style="text-align:center; font-weight:700; margin-bottom:8px;">
            ${stock.code} ${stock.name} 近年股價走勢 vs ${targetData.horizon === 3 ? '三年' : '今年'}目標價
          </div>
          ${this._renderSvgTargetPriceChart(stock, targetData)}
        </div>

        <!-- 9 Target Price Legend Matrix -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(185px, 1fr)); gap:8px;">
          ${targetData.lines.map((ln) => {
            const diffPct = (((ln.targetPrice - stock.price) / stock.price) * 100).toFixed(1);
            return `
              <div style="background:rgba(30,41,59,0.65); border-left:4px solid ${ln.color}; border-radius:6px; padding:8px 10px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-size:0.78rem; color:var(--text-muted);">PE=${ln.pe} ${ln.scenario}</div>
                  <div style="font-size:1rem; font-weight:800;">${fmtInt(ln.targetPrice)} 元</div>
                </div>
                <span class="pill ${Number(diffPct) >= 0 ? 'pill-emerald' : 'pill-rose'}" style="font-size:0.72rem;">
                  潛在 ${Number(diffPct) >= 0 ? '+' : ''}${diffPct}%
                </span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ============================================================================
  // ③ 雙股 PK 對比 (Stock-vs-Stock Comparison: 股價與價差、八季財報、三年營收、六大指標對決)
  // ============================================================================
  _renderPkMain(state, universe) {
    const pk = GoodStockCore.compareDualStocks(state, this.pkCodeA, this.pkCodeB);
    const { stockA, stockB, priceSeries, quarterSeries, revenueSeries } = pk;

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="flex-wrap:wrap; gap:10px;">
          <div>
            <div class="card-title">⚔️ 雙股 PK 對比 — <span style="color:#3b82f6;">① ${stockA.code} ${stockA.name}</span> vs <span style="color:#f97316;">② ${stockB.code} ${stockB.name}</span></div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">
              同畫面比較兩家公司的月收盤價與價差、近八季營業利益率與 EPS、近三年月營收與財務六大指標評分
            </div>
          </div>

          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-ghost btn-sm" data-pk-pair="5274,2059">👑 信驊 vs 川湖</button>
            <button class="btn btn-ghost btn-sm" data-pk-pair="3037,8046">🔬 欣興 vs 南電</button>
            <button class="btn btn-ghost btn-sm" data-pk-pair="2330,2454">💎 台積電 vs 聯發科</button>
            <button class="btn btn-ghost btn-sm" data-pk-pair="3017,3324">❄️ 奇鋐 vs 雙鴻</button>
            <button class="btn btn-ghost btn-sm" data-pk-pair="2382,6669">🖥️ 廣達 vs 緯穎</button>
          </div>
        </div>

        <div class="form-grid">
          <div class="form-group">
            <label class="form-label" style="color:#60a5fa; font-weight:700;">🔵 股票 ① (藍線 / 藍柱)</label>
            <select class="form-select" id="pk-select-a">
              ${universe.map((s) => `<option value="${s.code}" ${s.code === stockA.code ? 'selected' : ''}>${s.code} ${s.name} (${s.industry} · $${s.price})</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" style="color:#fb923c; font-weight:700;">🟠 股票 ② (橘線 / 橘柱)</label>
            <select class="form-select" id="pk-select-b">
              ${universe.map((s) => `<option value="${s.code}" ${s.code === stockB.code ? 'selected' : ''}>${s.code} ${s.name} (${s.industry} · $${s.price})</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Chart 1: Price & Spread Comparison (Matches 5274 信驊 vs 2059 川湖 screenshot) -->
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">${stockA.code} ${stockA.name} ⚖️ ${stockB.code} ${stockB.name} — 股價與價差對比</div>
        </div>
        <div style="background:rgba(15,23,42,0.58); border:1px solid var(--border); border-radius:10px; padding:14px;">
          <div style="text-align:center; font-weight:700; margin-bottom:8px;">
            股價對比（柱＝①−②價差，紅＝①較高／綠＝②較高；線＝月收盤價）
          </div>
          ${this._renderSvgPkPriceChart(stockA, stockB, priceSeries)}
        </div>
      </div>

      <!-- Chart 2: 8-Quarter Financials Comparison (Matches 3037 欣興 vs 8046 南電 screenshot) -->
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">📊 八季財報趨勢對比（柱＝EPS(元) 右軸；線＝營業利益率(%) 左軸）</div>
        </div>
        <div style="background:rgba(15,23,42,0.58); border:1px solid var(--border); border-radius:10px; padding:14px;">
          ${this._renderSvgPkQuarterChart(stockA, stockB, quarterSeries)}
        </div>
      </div>

      <!-- Chart 3: 3-Year Monthly Revenue Comparison -->
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">📈 三年營收趨勢對比（柱＝當月營收(百萬) 左軸；線＝營收年增率(%) 右軸）</div>
        </div>
        <div style="background:rgba(15,23,42,0.58); border:1px solid var(--border); border-radius:10px; padding:14px;">
          ${this._renderSvgPkRevenueChart(stockA, stockB, revenueSeries)}
        </div>
      </div>

      <!-- Table 4: Six Indicators Head-to-Head Table -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">🏆 財務六大指標 & 估值正面對決</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>比較維度</th>
                <th class="num" style="color:#60a5fa;">🔵 ① ${stockA.code} ${stockA.name}</th>
                <th class="num" style="color:#fb923c;">🟠 ② ${stockB.code} ${stockB.name}</th>
                <th>勝出方</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight:700;">🌟 六大指標當期總均分</td>
                <td class="num" style="font-weight:800; color:#38bdf8;">${stockA.sixEval.current.avgScore.toFixed(2)} (${stockA.sixEval.current.grade})</td>
                <td class="num" style="font-weight:800; color:#38bdf8;">${stockB.sixEval.current.avgScore.toFixed(2)} (${stockB.sixEval.current.grade})</td>
                <td>${stockA.sixEval.current.avgScore >= stockB.sixEval.current.avgScore ? `🔵 ${stockA.name}` : `🟠 ${stockB.name}`}</td>
              </tr>
              <tr>
                <td style="font-weight:700;">📅 較前月評分變化 (ΔMoM)</td>
                <td class="num">${this._renderDeltaBadge(stockA.sixEval.deltaMoM)}</td>
                <td class="num">${this._renderDeltaBadge(stockB.sixEval.deltaMoM)}</td>
                <td>${stockA.sixEval.deltaMoM >= stockB.sixEval.deltaMoM ? `🔵 ${stockA.name}` : `🟠 ${stockB.name}`}</td>
              </tr>
              <tr>
                <td style="font-weight:700;">📊 較前季評分變化 (ΔQoQ)</td>
                <td class="num">${this._renderDeltaBadge(stockA.sixEval.deltaQoQ)}</td>
                <td class="num">${this._renderDeltaBadge(stockB.sixEval.deltaQoQ)}</td>
                <td>${stockA.sixEval.deltaQoQ >= stockB.sixEval.deltaQoQ ? `🔵 ${stockA.name}` : `🟠 ${stockB.name}`}</td>
              </tr>
              ${stockA.sixEval.current.items.map((itA, idx) => {
                const itB = stockB.sixEval.current.items[idx];
                const sA = itA.score ?? -1;
                const sB = itB.score ?? -1;
                return `
                  <tr>
                    <td>${itA.label}</td>
                    <td class="num" style="font-weight:700;">${itA.score !== null ? `${itA.score.toFixed(1)} 分` : '不評分'}</td>
                    <td class="num" style="font-weight:700;">${itB.score !== null ? `${itB.score.toFixed(1)} 分` : '不評分'}</td>
                    <td>${sA === sB ? '🤝 平手' : sA > sB ? `🔵 ${stockA.name}` : `🟠 ${stockB.name}`}</td>
                  </tr>
                `;
              }).join('')}
              <tr>
                <td style="font-weight:700;">⚠️ 財務地雷命中數 (越少越好)</td>
                <td class="num">${stockA.landmines.hitCount} / 7 項</td>
                <td class="num">${stockB.landmines.hitCount} / 7 項</td>
                <td>${stockA.landmines.hitCount <= stockB.landmines.hitCount ? `🔵 ${stockA.name}` : `🟠 ${stockB.name}`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // Pure SVG Chart Renderers (Zero external library dependencies, crisp on Retina)
  // ============================================================================
  _renderSvg8QuarterChart(q8) {
    const W = 760, H = 260, padL = 48, padR = 48, padT = 20, padB = 42;
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
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:280px; display:block;">
        <!-- Horizontal Grid Lines -->
        ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + plotH * (1 - t);
          const mVal = (minM + (maxM - minM) * t).toFixed(0);
          const eVal = (maxEps * t).toFixed(1);
          return `
            <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(148,163,184,0.16)" stroke-dasharray="3,3" />
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="11">${mVal}%</text>
            <text x="${W - padR + 6}" y="${y + 4}" text-anchor="start" fill="#60a5fa" font-size="11">${eVal}元</text>
          `;
        }).join('')}

        <!-- EPS Bars -->
        ${q8.map((q, i) => {
          const cx = xAt(i);
          const bw = Math.min(38, (plotW / q8.length) * 0.52);
          const yTop = yEps(q.eps);
          const bh = Math.max(2, padT + plotH - yTop);
          return `
            <rect x="${cx - bw / 2}" y="${yTop}" width="${bw}" height="${bh}" fill="rgba(96,165,250,0.35)" stroke="#60a5fa" stroke-width="1.2" rx="3" />
            <text x="${cx}" y="${padT + plotH + 18}" text-anchor="middle" fill="#cbd5e1" font-size="11">${q.q}</text>
          `;
        }).join('')}

        <!-- Operating Margin Line (Red) & Net Margin Line (Green) -->
        <polyline fill="none" stroke="#ef4444" stroke-width="2.6" points="${opPoints}" />
        <polyline fill="none" stroke="#10b981" stroke-width="2.6" points="${netPoints}" />

        ${q8.map((q, i) => `
          <circle cx="${xAt(i)}" cy="${yMargin(q.opMargin)}" r="4" fill="#ef4444" />
          <circle cx="${xAt(i)}" cy="${yMargin(q.netMargin)}" r="4" fill="#10b981" />
        `).join('')}
      </svg>
      <div style="display:flex; justify-content:center; gap:18px; font-size:0.78rem; margin-top:4px;">
        <span><span style="display:inline-block;width:12px;height:10px;background:#ef4444;margin-right:4px;"></span>營業利益率(%)</span>
        <span><span style="display:inline-block;width:12px;height:10px;background:#10b981;margin-right:4px;"></span>淨利率(歸母)(%)</span>
        <span><span style="display:inline-block;width:12px;height:10px;background:rgba(96,165,250,0.5);border:1px solid #60a5fa;margin-right:4px;"></span>EPS(元)</span>
      </div>
    `;
  }

  _renderSvg36MonthRevChart(m36) {
    const W = 760, H = 240, padL = 54, padR = 46, padT = 18, padB = 38;
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
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:250px; display:block;">
        ${[0, 0.5, 1].map((t) => {
          const y = padT + plotH * (1 - t);
          return `
            <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(148,163,184,0.15)" stroke-dasharray="3,3" />
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="10">${Math.round(maxRev * t).toLocaleString()}</text>
            <text x="${W - padR + 6}" y="${y + 4}" text-anchor="start" fill="#f87171" font-size="10">${Math.round(minY + (maxY - minY) * t)}%</text>
          `;
        }).join('')}

        ${m36.map((m, i) => {
          const cx = xAt(i);
          const bw = Math.max(4, (plotW / m36.length) * 0.62);
          const yTop = yRev(m.revM);
          const bh = Math.max(2, padT + plotH - yTop);
          const showLabel = i % 6 === 0 || i === m36.length - 1;
          return `
            <rect x="${cx - bw / 2}" y="${yTop}" width="${bw}" height="${bh}" fill="rgba(56,189,248,0.38)" />
            ${showLabel ? `<text x="${cx}" y="${padT + plotH + 16}" text-anchor="middle" fill="#cbd5e1" font-size="10">${m.ym}</text>` : ''}
          `;
        }).join('')}

        <polyline fill="none" stroke="#ef4444" stroke-width="2.2" points="${yoyPoints}" />
      </svg>
    `;
  }

  _renderSvgTargetPriceChart(stock, targetData) {
    const W = 780, H = 300, padL = 52, padR = 90, padT = 18, padB = 38;
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
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:320px; display:block;">
        <!-- Y Axis Grid -->
        ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const v = Math.round(minP + (maxP - minP) * t);
          const y = yAt(v);
          return `
            <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(148,163,184,0.12)" />
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="10">${v}</text>
          `;
        }).join('')}

        <!-- 9 Horizontal Dashed Target Price Lines -->
        ${targetData.lines.map((ln) => {
          const y = yAt(ln.targetPrice);
          return `
            <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${ln.color}" stroke-width="1.5" stroke-dasharray="5,4" />
            <text x="${W - padR + 4}" y="${y + 3}" fill="${ln.color}" font-size="9.5" font-weight="600">PE${ln.pe}${ln.scenario} ${ln.targetPrice}</text>
          `;
        }).join('')}

        <!-- Closing Price Solid Line -->
        <polyline fill="none" stroke="#f8fafc" stroke-width="2.6" points="${closePoints}" />

        <!-- X Axis Date Labels -->
        ${prices.map((p, i) => (i % 6 === 0 || i === prices.length - 1) ? `
          <text x="${xAt(i)}" y="${padT + plotH + 18}" text-anchor="middle" fill="#cbd5e1" font-size="10">${p.ym}</text>
        ` : '').join('')}
      </svg>
    `;
  }

  _renderSvgPkPriceChart(stockA, stockB, priceSeries) {
    const W = 780, H = 270, padL = 56, padR = 56, padT = 18, padB = 38;
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
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:285px; display:block;">
        ${[0, 0.5, 1].map((t) => {
          const y = padT + plotH * (1 - t);
          return `
            <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(148,163,184,0.14)" stroke-dasharray="3,3" />
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="#f87171" font-size="10">${Math.round(maxSpread * t).toLocaleString()}</text>
            <text x="${W - padR + 6}" y="${y + 4}" text-anchor="start" fill="#94a3b8" font-size="10">${Math.round(maxClose * t).toLocaleString()}</text>
          `;
        }).join('')}

        <!-- Spread Bars (Red if A >= B, Green if B > A) -->
        ${priceSeries.map((p, i) => {
          const cx = xAt(i);
          const bw = Math.max(6, (plotW / priceSeries.length) * 0.64);
          const yTop = ySpread(p.spread);
          const bh = Math.max(2, padT + plotH - yTop);
          const isAHigher = p.spread >= 0;
          const fill = isAHigher ? 'rgba(248,113,113,0.48)' : 'rgba(52,211,153,0.48)';
          const stroke = isAHigher ? '#ef4444' : '#10b981';
          const showLabel = i % 5 === 0 || i === priceSeries.length - 1;
          return `
            <rect x="${cx - bw / 2}" y="${yTop}" width="${bw}" height="${bh}" fill="${fill}" stroke="${stroke}" stroke-width="1" />
            ${showLabel ? `<text x="${cx}" y="${padT + plotH + 16}" text-anchor="middle" fill="#cbd5e1" font-size="10">${p.ym}</text>` : ''}
          `;
        }).join('')}

        <!-- Dual Closing Price Lines -->
        <polyline fill="none" stroke="#2563eb" stroke-width="2.5" points="${ptsA}" />
        <polyline fill="none" stroke="#ea580c" stroke-width="2.5" points="${ptsB}" />
      </svg>
      <div style="display:flex; justify-content:center; gap:18px; font-size:0.78rem; margin-top:6px;">
        <span><span style="display:inline-block;width:14px;height:10px;background:#2563eb;margin-right:4px;"></span>${stockA.name} 月收盤(元)</span>
        <span><span style="display:inline-block;width:14px;height:10px;background:#ea580c;margin-right:4px;"></span>${stockB.name} 月收盤(元)</span>
        <span><span style="display:inline-block;width:14px;height:10px;background:rgba(248,113,113,0.55);border:1px solid #ef4444;margin-right:4px;"></span>${stockA.name} − ${stockB.name} 價差(元)</span>
      </div>
    `;
  }

  _renderSvgPkQuarterChart(stockA, stockB, quarterSeries) {
    const W = 760, H = 250, padL = 48, padR = 48, padT = 18, padB = 38;
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
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:260px; display:block;">
        ${quarterSeries.map((q, i) => {
          const cx = xAt(i);
          const bw = 16;
          const yEA = yE(q.epsA);
          const yEB = yE(q.epsB);
          return `
            <rect x="${cx - bw - 2}" y="${yEA}" width="${bw}" height="${Math.max(2, padT + plotH - yEA)}" fill="rgba(59,130,246,0.42)" stroke="#3b82f6" />
            <rect x="${cx + 2}" y="${yEB}" width="${bw}" height="${Math.max(2, padT + plotH - yEB)}" fill="rgba(249,115,22,0.42)" stroke="#f97316" />
            <text x="${cx}" y="${padT + plotH + 16}" text-anchor="middle" fill="#cbd5e1" font-size="11">${q.q}</text>
          `;
        }).join('')}

        <polyline fill="none" stroke="#3b82f6" stroke-width="2.5" points="${opPtsA}" />
        <polyline fill="none" stroke="#f97316" stroke-width="2.5" points="${opPtsB}" />
      </svg>
      <div style="display:flex; justify-content:center; gap:16px; font-size:0.78rem; margin-top:4px;">
        <span style="color:#60a5fa;">■ ${stockA.name} 營業利益率(%) / EPS(元)</span>
        <span style="color:#fb923c;">■ ${stockB.name} 營業利益率(%) / EPS(元)</span>
      </div>
    `;
  }

  _renderSvgPkRevenueChart(stockA, stockB, revenueSeries) {
    const W = 760, H = 240, padL = 54, padR = 48, padT = 18, padB = 38;
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
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; max-height:250px; display:block;">
        ${revenueSeries.map((r, i) => {
          const cx = xAt(i);
          const bw = 5;
          const yA = yRev(r.revMA);
          const yB = yRev(r.revMB);
          const showLbl = i % 6 === 0 || i === revenueSeries.length - 1;
          return `
            <rect x="${cx - bw}" y="${yA}" width="${bw}" height="${Math.max(2, padT + plotH - yA)}" fill="rgba(59,130,246,0.38)" />
            <rect x="${cx}" y="${yB}" width="${bw}" height="${Math.max(2, padT + plotH - yB)}" fill="rgba(249,115,22,0.38)" />
            ${showLbl ? `<text x="${cx}" y="${padT + plotH + 16}" text-anchor="middle" fill="#cbd5e1" font-size="10">${r.ym}</text>` : ''}
          `;
        }).join('')}

        <polyline fill="none" stroke="#3b82f6" stroke-width="2" points="${ptsYA}" />
        <polyline fill="none" stroke="#f97316" stroke-width="2" points="${ptsYB}" />
      </svg>
    `;
  }

  // ============================================================================
  // Event Binding
  // ============================================================================
  _bindEvents(container, state, store, showToast) {
    const rerender = () => this.render(container, store.getState(), store, showToast);

    // Top main tab switcher
    container.querySelectorAll('[data-gs-main]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mainTab = btn.getAttribute('data-gs-main');
        rerender();
      });
    });

    // Screener mode switcher
    container.querySelectorAll('[data-gs-screen]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.screenerMode = btn.getAttribute('data-gs-screen');
        rerender();
      });
    });

    // Open single stock info
    container.querySelectorAll('[data-open-stock]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.openStockInfo(btn.getAttribute('data-open-stock'), 'all');
        rerender();
      });
    });

    // Select for PK
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

    // Six Indicators Quick Presets
    container.querySelectorAll('[data-six-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-six-preset');
        this.sixFilters = {
          scope: 'ALL', industry: 'ALL', minAvgScore: 0, maxLandmines: '',
          momDeltaMode: 'ALL', qoqDeltaMode: 'ALL', improvedItem: 'ALL',
          minRevScore: 0, minOpScore: 0, minProfitScore: 0, minEpsScore: 0, minInvScore: 0, minFcfScore: 0,
          sortBy: 'avgScore'
        };
        if (p === 'ALL_HIGH') {
          this.sixFilters.minAvgScore = 3.0;
          this.sixFilters.maxLandmines = '1';
        } else if (p === 'MOM_UP') {
          this.sixFilters.momDeltaMode = 'UP';
          this.sixFilters.sortBy = 'deltaMoM';
        } else if (p === 'QOQ_UP') {
          this.sixFilters.qoqDeltaMode = 'UP';
          this.sixFilters.sortBy = 'deltaQoQ';
        } else if (p === 'DUAL_UP') {
          this.sixFilters.minAvgScore = 3.0;
          this.sixFilters.momDeltaMode = 'NON_DEC';
          this.sixFilters.qoqDeltaMode = 'UP';
          this.sixFilters.sortBy = 'deltaQoQ';
        } else if (p === 'MY_HOLDINGS') {
          this.sixFilters.scope = 'HOLDINGS';
        } else if (p === 'WEAKENING') {
          this.sixFilters.momDeltaMode = 'DOWN';
        }
        rerender();
      });
    });

    // Bind Six Indicator Filter Inputs
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
    bindSelect('six-max-landmines', this.sixFilters, 'maxLandmines');
    bindSelect('six-mom-mode', this.sixFilters, 'momDeltaMode');
    bindSelect('six-qoq-mode', this.sixFilters, 'qoqDeltaMode');
    bindSelect('six-improved-item', this.sixFilters, 'improvedItem');
    bindSelect('six-sort-by', this.sixFilters, 'sortBy');
    bindSelect('six-min-rev', this.sixFilters, 'minRevScore');
    bindSelect('six-min-op', this.sixFilters, 'minOpScore');
    bindSelect('six-min-profit', this.sixFilters, 'minProfitScore');
    bindSelect('six-min-eps', this.sixFilters, 'minEpsScore');
    bindSelect('six-min-inv', this.sixFilters, 'minInvScore');
    bindSelect('six-min-fcf', this.sixFilters, 'minFcfScore');

    // Strong Screener Inputs
    bindSelect('strong-days', this.strongFilters, 'lookbackDays');
    bindSelect('strong-min-gain', this.strongFilters, 'minGainPct');
    bindSelect('strong-vol-surge', this.strongFilters, 'minVolSurgePct');
    bindSelect('strong-min-price', this.strongFilters, 'minPrice');

    // Financial Screener Presets & Inputs
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
            minOpMargin: 15, minEps: 2, minRevYoY: 25, minCumYoY: 20, minDoubleArrow: 65, sortBy: 'doubleArrow'
          });
        } else if (p === 'HIGH_PRICE') {
          Object.assign(this.finFilters, {
            minOpMargin: 10, minEps: 5, minRevYoY: 15, minCumYoY: 15, minPrice: 1000, sortBy: 'latestOpMargin'
          });
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
    bindSelect('fin-min-cumyoy', this.finFilters, 'minCumYoY');
    bindSelect('fin-max-cumyoy', this.finFilters, 'maxCumYoY');
    bindSelect('fin-min-arrow', this.finFilters, 'minDoubleArrow');
    bindSelect('fin-max-arrow', this.finFilters, 'maxDoubleArrow');
    bindSelect('fin-min-price', this.finFilters, 'minPrice');
    bindSelect('fin-max-price', this.finFilters, 'maxPrice');
    bindSelect('fin-min-pe', this.finFilters, 'minPe');
    bindSelect('fin-max-pe', this.finFilters, 'maxPe');
    bindSelect('fin-sort-by', this.finFilters, 'sortBy');

    // Trend & NewHigh Inputs
    bindSelect('trend-days', this.trendFilters, 'trendDays');
    bindSelect('trend-move', this.trendFilters, 'minMovePct');
    bindSelect('nh-rev', this.newHighFilters, 'revHighMonths');
    bindSelect('nh-op', this.newHighFilters, 'opHighQuarters');
    bindSelect('nh-eps', this.newHighFilters, 'epsHighQuarters');
    bindSelect('nh-price', this.newHighFilters, 'priceHighDays');
    bindSelect('nh-vol', this.newHighFilters, 'volHighDays');

    // Single Stock Info Section & Health Tabs
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

    // Search single stock
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

    // Live FinMind Fetch
    const liveBtn = container.querySelector('#btn-gs-fetch-live');
    if (liveBtn) {
      liveBtn.addEventListener('click', async () => {
        const code = searchInput ? searchInput.value.trim() : this.selectedCode;
        this.isFetchingLive = true;
        rerender();
        try {
          const res = await GoodStockData.fetchLiveFinMindStock(code);
          this.selectedCode = res.stock.code;
          if (showToast) {
            showToast(res.source === 'finmind-live'
              ? `✅ 已從 FinMind 即時更新 ${res.stock.code} ${res.stock.name} 最新營收與股價`
              : `⚡ 已載入 ${res.stock.code} ${res.stock.name} 內建完整財報快取`);
          }
        } catch (err) {
          if (showToast) showToast(`⚠️ ${err.message}`);
        } finally {
          this.isFetchingLive = false;
          rerender();
        }
      });
    }

    // Custom PE Bands
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

    // PK Pair Switchers
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
  }
}
