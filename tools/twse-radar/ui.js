import {
  TwseRadarCore,
  DEFAULT_PARAMS,
  BOOL_PARAM_KEYS,
  runQuantEngine,
  buildLatestSummary,
  parseCsvText,
  formatDate
} from './core.js';

const fmtInt = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v).toLocaleString('zh-TW') : '--';
};
const fmtDec = (n, d = 1) => {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d }) : '--';
};
const fmtSign = (n, d = 1, suffix = '') => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '--';
  return `${v > 0 ? '+' : ''}${fmtDec(v, d)}${suffix}`;
};
const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const MIN_VIEW_BARS = 15;

/**
 * TWSE Trim Action Radar Native UI (v4.0 Engine + 5 Responsive Tabs)
 * Tab 1: Minimalist T+1 Action Directive & 5 Enhanced Factor Strip
 * Tab 2: Interactive Pinch-Zoom / Drag-Pan SVG Radar Chart + Date Range + Action Log
 * Tab 3: Yearly Trim Calendar (Auto-scroll to today/current month, click day -> chart focus)
 * Tab 4: Backtest KPIs, Crash Wave Audit & 8-Factor What-If Simulator
 * Tab 5: Full v4.0 Parameter Settings (6 Filters + Thresholds + Positions + FinMind Token)
 */
export class TwseRadarUI {
  constructor() {
    this.activeTab = 'action'; // 'action' | 'radar' | 'calendar' | 'audit' | 'settings'
    this.chartRange = '1Y';    // '6M' | '1Y' | '3Y' | 'ALL' | 'CUSTOM'
    this.viewStartIdx = null;
    this.viewEndIdx = null;
    this.focusDate = null;
    this.selectedYear = null;
    this._shouldScrollToday = false;
    this.isRefreshing = false;
    this.refreshStatus = '';
    this.whatIfResult = null;
    this.gridScanResult = null;
    this._csvLoadedAttempted = false;
  }

  _ensureBundledCsv(container, state, store, showToast) {
    if (this._csvLoadedAttempted) return;
    this._csvLoadedAttempted = true;
    const cache = TwseRadarCore.loadCache();
    // Auto-load bundled v4 CSV if cache is missing, demo, or lacks v4 external columns
    const hasV4Cols = Array.isArray(cache.rawData) && cache.rawData.length >= 80 && cache.dataMeta?.isReal
      && cache.rawData.some((r) => Number.isFinite(Number(r.SOX_Close)) || Number.isFinite(Number(r.OTC_Close)));
    if (hasV4Cols) return;
    if (typeof fetch !== 'function') return;

    fetch(`./tools/twse-radar/real_twse_v4.csv?v=${encodeURIComponent((typeof window !== 'undefined' && window.NIC_APP_VERSION) || 'v53')}`)
      .then((resp) => (resp.ok ? resp.text() : null))
      .then((txt) => {
        if (!txt) return;
        const parsed = parseCsvText(txt, '內建真實台股 v4.0 CSV');
        if (!parsed) return;
        const res = runQuantEngine(parsed.rawData, cache.params, parsed.dataMeta);
        const summary = buildLatestSummary(parsed.rawData, cache.params, parsed.dataMeta, res);
        TwseRadarCore.saveCache({
          rawData: parsed.rawData,
          dataMeta: parsed.dataMeta,
          latestSummary: summary
        });
        if (typeof window !== 'undefined' && typeof window.NIC_OnRadarUpdated === 'function') {
          window.NIC_OnRadarUpdated(summary);
        }
        this.viewStartIdx = null;
        this.viewEndIdx = null;
        this.render(container, state, store, showToast);
      })
      .catch(() => {});
  }

  _syncViewBounds(n) {
    if (n <= 0) {
      this.viewStartIdx = 0;
      this.viewEndIdx = 0;
      return;
    }
    if (this.viewStartIdx === null || this.viewEndIdx === null || this.viewEndIdx >= n) {
      const rangeCounts = { '6M': 126, '1Y': 252, '3Y': 756, 'ALL': n };
      const take = Math.min(n, rangeCounts[this.chartRange] || 252);
      this.viewEndIdx = n - 1;
      this.viewStartIdx = Math.max(0, n - take);
    }
    this.viewStartIdx = Math.max(0, Math.min(this.viewStartIdx, n - 1));
    this.viewEndIdx = Math.max(this.viewStartIdx, Math.min(this.viewEndIdx, n - 1));
  }

  _jumpToDate(dateStr, rawData) {
    const n = rawData.length;
    if (!n) return;
    let targetIdx = rawData.findIndex((r) => r.Date === dateStr);
    if (targetIdx < 0) {
      targetIdx = rawData.findIndex((r) => r.Date >= dateStr);
      if (targetIdx < 0) targetIdx = n - 1;
    }
    const pad = 40;
    this.viewStartIdx = Math.max(0, targetIdx - pad);
    this.viewEndIdx = Math.min(n - 1, targetIdx + pad);
    this.chartRange = 'CUSTOM';
    this.focusDate = rawData[targetIdx].Date;
    this.activeTab = 'radar';
  }

  render(container, state, store, showToast) {
    this._ensureBundledCsv(container, state, store, showToast);

    const { rawData, dataMeta, params, finmindToken } = TwseRadarCore.getWorkingData();
    const res = runQuantEngine(rawData, params, dataMeta);
    const summary = buildLatestSummary(rawData, params, dataMeta, res);
    TwseRadarCore.saveCache({ latestSummary: summary });

    this._syncViewBounds(rawData.length);

    const years = Array.from(new Set(rawData.map((r) => String(r.Date).slice(0, 4)))).sort().reverse();
    const todayStr = formatDate(new Date());
    const todayYear = todayStr.slice(0, 4);
    if (!this.selectedYear || !years.includes(this.selectedYear)) {
      this.selectedYear = years.includes(todayYear) ? todayYear : (years[0] || todayYear);
    }

    container.innerHTML = `
      <div class="tabs-bar" role="tablist">
        <button type="button" class="tab-btn ${this.activeTab === 'action' ? 'active' : ''}" data-radar-tab="action">
          🎯 明日 T+1 指令
        </button>
        <button type="button" class="tab-btn ${this.activeTab === 'radar' ? 'active' : ''}" data-radar-tab="radar">
          📈 雷達圖與行動清單
        </button>
        <button type="button" class="tab-btn ${this.activeTab === 'calendar' ? 'active' : ''}" data-radar-tab="calendar">
          📅 年度減碼日曆
        </button>
        <button type="button" class="tab-btn ${this.activeTab === 'audit' ? 'active' : ''}" data-radar-tab="audit">
          🧪 回測與盤後試算
        </button>
        <button type="button" class="tab-btn ${this.activeTab === 'settings' ? 'active' : ''}" data-radar-tab="settings">
          ⚙️ 參數設定
        </button>
      </div>

      <div id="twse-radar-tab-content">
        ${this.activeTab === 'action' ? this._renderActionTab(rawData, res.meta, params, res, summary) : ''}
        ${this.activeTab === 'radar' ? this._renderRadarTab(rawData, res) : ''}
        ${this.activeTab === 'calendar' ? this._renderCalendarTab(rawData, res, years, todayStr) : ''}
        ${this.activeTab === 'audit' ? this._renderAuditTab(rawData, res.meta, params, res) : ''}
        ${this.activeTab === 'settings' ? this._renderSettingsTab(params, finmindToken, res.meta) : ''}
      </div>
    `;

    this._bindEvents(container, state, store, showToast, rawData, res, params);

    // Auto-scroll to today's month when entering Calendar tab
    if (this.activeTab === 'calendar' && this._shouldScrollToday) {
      this._shouldScrollToday = false;
      const targetMonth = container.querySelector('[data-cal-current-month="true"]');
      if (targetMonth && typeof targetMonth.scrollIntoView === 'function') {
        setTimeout(() => {
          try {
            targetMonth.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (_) {}
        }, 40);
      }
    }
  }

  // =========================================================================
  // Tab 1: Minimalist T+1 Action Directive (一目瞭然首頁 - v4.0 引擎)
  // =========================================================================
  _renderActionTab(rawData, meta, params, res, summary) {
    const last = res.n - 1;
    const row = rawData[last];
    const { pre, spotThArr, volThArr } = res;

    const pillCls = summary.level === 'red'
      ? 'pill-rose'
      : (summary.level === 'yellow' || summary.level === 'defense' ? 'pill-amber' : 'pill-emerald');
    const posColor = summary.level === 'red'
      ? 'var(--accent-rose)'
      : (summary.level === 'yellow' || summary.level === 'defense' ? '#d97706' : 'var(--accent-emerald)');

    const futDelta = pre.futDelta5d[last];
    const spot5d = pre.spot5d[last];
    const spotTh = spotThArr[last];
    const fxVal = row.USD_TWD;
    const maVal = pre.ma20[last];
    const consecBelow = pre.consecBelowMA[last] || 0;
    const volVal = row.Volatility;
    const volTh = volThArr[last];
    const maintVal = pre.estMaint[last];
    const otcVal = row.OTC_Close;
    const otcMa = pre.otcMa20[last];
    const soxVal = row.SOX_Close;
    const vixVal = row.VIX;

    const factors = [
      {
        title: '1. 外資空單+匯率',
        enabled: meta.hasChip,
        alert: res.sig1[last] === 1,
        val: meta.hasChip && Number.isFinite(futDelta) ? `5日 ${fmtSign(futDelta, 0)} 口` : '--',
        sub: meta.hasChip
          ? `現貨5日 ${fmtSign(spot5d, 0)} 億${Number.isFinite(fxVal) ? ` · 匯 ${fmtDec(fxVal, 2)}` : ''}`
          : '未載入籌碼'
      },
      {
        title: `2. 趨勢破線 (MA${params.maLen})`,
        enabled: true,
        alert: res.sig2[last] === 1,
        val: Number.isFinite(maVal) ? (row.Close < maVal ? `破線 ${consecBelow} 日` : '站穩均線') : '--',
        sub: Number.isFinite(maVal) ? `MA${params.maLen}：${fmtInt(maVal)}` : '--'
      },
      {
        title: '3. 波動恐慌+維持率',
        enabled: true,
        alert: res.sig3[last] === 1,
        val: Number.isFinite(maintVal) ? `維持率 ${fmtDec(maintVal, 1)}%` : '--',
        sub: `波動 ${fmtDec(volVal, 1)}%${Number.isFinite(volTh) ? ` (警戒 >${fmtDec(volTh, 1)}%)` : ''}`
      },
      {
        title: '4. OTC 櫃買廣度',
        enabled: meta.hasOtc && params.useOtcSignal,
        alert: res.sig4[last] === 1,
        val: Number.isFinite(otcVal) ? `${fmtDec(otcVal, 1)}` : '--',
        sub: meta.hasOtc && params.useOtcSignal
          ? (Number.isFinite(otcMa) ? `20MA ${fmtDec(otcMa, 1)}` : '--')
          : (params.useOtcSignal ? '無 OTC 欄位' : '濾網已關閉')
      },
      {
        title: '5. 美股費半 / VIX',
        enabled: meta.hasUs && params.useUsFilter,
        alert: res.sig5[last] === 1,
        val: Number.isFinite(soxVal) ? `SOX ${fmtInt(soxVal)}` : '--',
        sub: meta.hasUs && params.useUsFilter
          ? `VIX ${Number.isFinite(vixVal) ? fmtDec(vixVal, 1) : '--'}`
          : (params.useUsFilter ? '無美股欄位' : '濾網已關閉')
      }
    ];

    const updatedNote = meta.updatedAt
      ? new Date(meta.updatedAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      : null;

    return `
      <div class="card radar-hero level-${summary.level}" style="margin-bottom:14px;">
        <div style="min-width:0;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
            <span class="pill ${pillCls}" style="font-size:12px; font-weight:700;">
              ${summary.emoji} 明日 T+1 行動指令
            </span>
            <span class="pill" style="font-size:11.5px; font-weight:700;">
              風險溫度 ${summary.score} / 100 分
            </span>
            ${summary.filterBlockedLabel ? `<span class="pill pill-emerald" style="font-size:11px;">🛡️ ${escapeHtml(summary.filterBlockedLabel)}</span>` : ''}
            <span class="text-muted font-mono" style="font-size:12px;">
              基準日 ${escapeHtml(summary.date)}
            </span>
          </div>

          <div style="font-size:24px; font-weight:800; line-height:1.25; color:var(--text-primary); margin-bottom:8px;">
            ${escapeHtml(summary.verdict)}
          </div>

          <div class="text-muted" style="font-size:12.5px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
            <span>加權收盤 <strong class="font-mono" style="color:var(--text-primary);">${fmtDec(summary.close, 2)}</strong></span>
            <span>v4.0 引擎（${summary.activeFactorCount}/5 因子）</span>
            <span>來源：${escapeHtml(summary.sourceName)}${updatedNote ? ` (${updatedNote})` : ''}</span>
            ${this.refreshStatus ? `<span style="color:var(--accent-blue);">${escapeHtml(this.refreshStatus)}</span>` : ''}
          </div>
        </div>

        <div class="radar-hero-pos">
          <div>
            <div class="text-muted" style="font-size:12px; text-align:right;">明日開盤建議倉位</div>
            <div class="radar-pos-num font-mono" style="color:${posColor};">
              ${summary.tomorrowPosPct}%
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="btn-radar-refresh" ${this.isRefreshing ? 'disabled' : ''}>
            ${this.isRefreshing ? '⏳ 更新中...' : '🔄 更新即時資料'}
          </button>
        </div>
      </div>

      <div class="radar-factors-grid">
        ${factors.map((f) => `
          <div class="radar-factor-card ${f.alert ? 'is-alert' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
              <span class="text-muted" style="font-size:11.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${f.title}</span>
              <span class="pill ${!f.enabled ? '' : (f.alert ? 'pill-rose' : 'pill-emerald')}" style="font-size:10.5px; padding:1px 6px;">
                ${!f.enabled ? '未啟用' : (f.alert ? '警戒' : '正常')}
              </span>
            </div>
            <div class="font-mono" style="font-size:15.5px; font-weight:700; color:var(--text-primary);">
              ${f.val}
            </div>
            <div class="text-muted font-mono" style="font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(f.sub)}">
              ${f.sub}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // =========================================================================
  // Tab 2: Interactive Pinch-Zoom / Drag-Pan SVG Chart & Action List
  // =========================================================================
  _renderRadarTab(rawData, res) {
    const startDate = rawData[this.viewStartIdx]?.Date || '';
    const endDate = rawData[this.viewEndIdx]?.Date || '';
    const minDate = rawData[0]?.Date || '';
    const maxDate = rawData[rawData.length - 1]?.Date || '';
    const recentActions = res.actions.slice().reverse().slice(0, 30);

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="margin-bottom:8px;">
          <div>
            <div class="card-title">加權指數走勢與減碼訊號點位</div>
            <div class="text-muted" style="font-size:12px; margin-top:2px;">
              支援手機雙指縮放 / 單指拖曳，電腦滾輪縮放 / 滑鼠拖曳 ｜ 🔴 重砍 · 🟡 減碼 · 🟢 回補
            </div>
          </div>
          <div class="action-toolbar-group">
            ${['6M', '1Y', '3Y', 'ALL'].map((rg) => `
              <button type="button" class="btn ${this.chartRange === rg ? 'btn-primary' : 'btn-ghost'} btn-sm" data-radar-range="${rg}">${rg}</button>
            `).join('')}
          </div>
        </div>

        <div class="radar-date-controls">
          <div class="radar-date-inputs">
            <span class="text-muted" style="font-size:12px;">日期區間：</span>
            <input type="date" id="radar-date-start" class="form-control font-mono" min="${minDate}" max="${maxDate}" value="${startDate}" />
            <span class="text-muted">～</span>
            <input type="date" id="radar-date-end" class="form-control font-mono" min="${minDate}" max="${maxDate}" value="${endDate}" />
          </div>
          <div class="action-toolbar-group">
            <button type="button" class="btn btn-ghost btn-sm" id="btn-radar-zoom-in" title="放大">＋ 放大</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-radar-zoom-out" title="縮小">－ 縮小</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-radar-zoom-reset" title="重設區間">↺ 重設</button>
          </div>
        </div>

        <div id="radar-focus-banner">${this._renderFocusBanner(rawData, res)}</div>

        <div id="radar-svg-host" class="radar-svg-host" style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:10px; padding:10px;">
          ${this._renderSvgRadarChart(rawData, res)}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">歷史加減碼行動清單（近 ${recentActions.length} 筆）</div>
          <span class="text-muted" style="font-size:12px;">點擊任一列可定位走勢圖 ｜ 共 ${res.actions.length} 次</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>執行日 (T+1)</th>
                <th>動作</th>
                <th style="text-align:right;">風險分</th>
                <th style="text-align:right;">倉位變化</th>
                <th style="text-align:right;">執行日收盤</th>
                <th style="text-align:right;">後續 15 日最大跌幅</th>
                <th>驗證 / 觸發摘要</th>
              </tr>
            </thead>
            <tbody>
              ${recentActions.length === 0 ? `
                <tr><td colspan="7" class="text-muted" style="text-align:center; padding:18px;">此區間尚無加減碼行動紀錄</td></tr>
              ` : recentActions.map((a) => {
                const badgeCls = a.type === 2 ? 'pill-rose' : (a.type === 1 ? 'pill-amber' : 'pill-emerald');
                const dropStr = a.subsequentDrop !== null ? `${fmtDec(a.subsequentDrop, 1)}%` : '--';
                const verifyTag = a.type === 3
                  ? '<span class="pill pill-emerald">回補</span>'
                  : (a.subsequentDrop === null
                    ? '<span class="text-muted">觀察中</span>'
                    : (a.hitCrash
                      ? '<span class="pill pill-emerald">命中大跌</span>'
                      : '<span class="pill">預防避險</span>'));
                const isFocused = this.focusDate === a.execDate;
                return `
                  <tr data-jump-date="${escapeHtml(a.execDate)}" style="cursor:pointer; ${isFocused ? 'background:var(--accent-blue-soft);' : ''}">
                    <td class="font-mono" style="color:var(--accent-blue); font-weight:700;">${escapeHtml(a.execDate)}</td>
                    <td><span class="pill ${badgeCls}">${escapeHtml(a.typeName)}</span></td>
                    <td class="font-mono" style="text-align:right;">${Math.round(a.riskScore || 0)}</td>
                    <td class="font-mono" style="text-align:right;">${a.fromPos}% → <strong>${a.toPos}%</strong></td>
                    <td class="font-mono" style="text-align:right;">${fmtDec(a.execClose, 0)}</td>
                    <td class="font-mono" style="text-align:right; color:${a.subsequentDrop !== null && a.subsequentDrop <= -5 ? 'var(--accent-rose)' : 'var(--text-primary)'};">${dropStr}</td>
                    <td style="font-size:12px;">${verifyTag} <span class="text-muted">${escapeHtml(a.reasonSummary || '')}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderFocusBanner(rawData, res) {
    if (!this.focusDate) return '';
    const idx = rawData.findIndex((r) => r.Date === this.focusDate);
    if (idx < 0) return '';
    const r = rawData[idx];
    const score = Math.round(res.riskScore[idx] || 0);
    const pos = Math.round((res.position[idx] || 1) * 100);
    const act = res.actionTypeArr[idx];
    const actLabel = act === 2 ? '🔴 紅燈重砍' : (act === 1 ? '🟡 黃燈減碼' : (act === 3 ? '🟢 警報解除回補' : (pos < 99 ? '🟠 防禦期' : '🟢 正常持有')));
    return `
      <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; padding:8px 12px; margin-bottom:10px; border-radius:8px; background:var(--accent-blue-soft); border:1px solid rgba(59,130,246,0.3); font-size:12.5px;">
        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:10px;">
          <strong class="font-mono" style="color:var(--accent-blue);">📍 聚焦日期：${escapeHtml(r.Date)}</strong>
          <span>收盤 <strong class="font-mono">${fmtDec(r.Close, 2)}</strong></span>
          <span>風險分 <strong class="font-mono">${score}/100</strong></span>
          <span>倉位 <strong class="font-mono">${pos}%</strong></span>
          <span>${actLabel}</span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-clear-focus-date" style="padding:2px 8px; font-size:11px;">✕ 取消聚焦</button>
      </div>
    `;
  }

  _renderSvgRadarChart(rawData, res) {
    const startIdx = this.viewStartIdx ?? 0;
    const endIdx = this.viewEndIdx ?? (rawData.length - 1);
    const slice = rawData.slice(startIdx, endIdx + 1);
    if (!slice.length) return '<div class="text-muted" style="padding:20px; text-align:center;">無資料</div>';

    const W = 760;
    const H = 260;
    const padL = 54;
    const padR = 16;
    const padT = 18;
    const padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    let minP = Infinity;
    let maxP = -Infinity;
    for (const r of slice) {
      if (r.Close < minP) minP = r.Close;
      if (r.Close > maxP) maxP = r.Close;
    }
    const span = Math.max(1, maxP - minP);
    minP -= span * 0.06;
    maxP += span * 0.06;

    const xAt = (idx) => padL + (slice.length > 1 ? (idx / (slice.length - 1)) * plotW : plotW / 2);
    const yAt = (val) => padT + ((maxP - val) / (maxP - minP)) * plotH;

    const pricePts = slice.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r.Close).toFixed(1)}`).join(' ');
    const maPts = slice
      .map((_, i) => {
        const mv = res.pre.ma20[startIdx + i];
        return Number.isFinite(mv) ? `${xAt(i).toFixed(1)},${yAt(mv).toFixed(1)}` : null;
      })
      .filter(Boolean)
      .join(' ');

    const markers = [];
    let focusSvg = '';
    for (let i = 0; i < slice.length; i++) {
      const gx = xAt(i);
      const gy = yAt(slice[i].Close);
      const act = res.actionTypeArr[startIdx + i];
      if (act) {
        const color = act === 2 ? '#e11d48' : (act === 1 ? '#f59e0b' : '#10b981');
        markers.push(`<circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="4.5" fill="${color}" stroke="#ffffff" stroke-width="1.5"><title>${slice[i].Date} 收盤 ${fmtDec(slice[i].Close, 0)}</title></circle>`);
      }
      if (this.focusDate && slice[i].Date === this.focusDate) {
        focusSvg = `
          <line x1="${gx.toFixed(1)}" y1="${padT}" x2="${gx.toFixed(1)}" y2="${H - padB}" stroke="var(--accent-blue)" stroke-width="1.6" stroke-dasharray="4,3" />
          <circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="7" fill="none" stroke="var(--accent-blue)" stroke-width="2.2" />
          <circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="3.5" fill="var(--accent-blue)" />
        `;
      }
    }

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const val = minP + (maxP - minP) * (1 - t);
      const y = padT + t * plotH;
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border-color)" stroke-dasharray="3,3" stroke-width="1" />
        <text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="10" font-family="monospace">${fmtInt(val)}</text>
      `;
    }).join('');

    const xTickIdxs = [0, Math.floor(slice.length * 0.33), Math.floor(slice.length * 0.66), slice.length - 1];
    const xTicks = Array.from(new Set(xTickIdxs)).map((i) => `
      <text x="${xAt(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : (i === slice.length - 1 ? 'end' : 'middle')}" fill="var(--text-muted)" font-size="10" font-family="monospace">${slice[i].Date}</text>
    `).join('');

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
        ${yTicks}
        ${maPts ? `<polyline fill="none" stroke="var(--text-muted)" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.65" points="${maPts}" />` : ''}
        <polyline fill="none" stroke="var(--accent-blue)" stroke-width="2" points="${pricePts}" />
        ${markers.join('')}
        ${focusSvg}
        ${xTicks}
      </svg>
    `;
  }

  // =========================================================================
  // Tab 3: Yearly Trim Calendar (Auto-scroll to today + Click day -> Chart)
  // =========================================================================
  _renderCalendarTab(rawData, res, years, todayStr) {
    const yr = this.selectedYear;
    const latestDate = rawData[rawData.length - 1]?.Date || todayStr;
    const highlightDate = todayStr.startsWith(`${yr}-`) ? todayStr : (latestDate.startsWith(`${yr}-`) ? latestDate : '');
    const highlightMonth = highlightDate ? Number(highlightDate.slice(5, 7)) : -1;

    const dayMap = new Map();
    for (let i = 0; i < rawData.length; i++) {
      const dt = rawData[i].Date;
      if (!dt.startsWith(`${yr}-`)) continue;
      const act = res.actionTypeArr[i];
      const pos = res.position[i];
      let cls = '';
      let label = '正常持有';
      if (act === 2) { cls = 'act-red'; label = '紅燈重砍'; }
      else if (act === 1) { cls = 'act-yellow'; label = '黃燈減碼'; }
      else if (act === 3) { cls = 'act-buyback'; label = '警報解除回補'; }
      else if (pos < 0.99) { cls = 'act-defense'; label = `防禦持有 (${Math.round(pos * 100)}%)`; }
      dayMap.set(dt, { cls, label, close: rawData[i].Close, score: Math.round(res.riskScore[i] || 0) });
    }

    const monthsHtml = Array.from({ length: 12 }, (_, mIdx) => {
      const mNum = mIdx + 1;
      const mStr = String(mNum).padStart(2, '0');
      const isCurMonth = mNum === highlightMonth;
      const firstDow = new Date(Number(yr), mIdx, 1).getDay();
      const daysInMonth = new Date(Number(yr), mIdx + 1, 0).getDate();
      const cells = [];
      for (let e = 0; e < firstDow; e++) {
        cells.push('<div class="radar-cal-cell is-empty"></div>');
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${yr}-${mStr}-${String(d).padStart(2, '0')}`;
        const info = dayMap.get(key);
        const isTodayCell = key === highlightDate;
        const title = info
          ? `${key} ${info.label} (收盤 ${fmtInt(info.close)} · 風險 ${info.score}/100) — 點擊查看走勢圖`
          : `${key} 休市 / 無交易`;
        const clickableAttr = info ? `data-cal-date="${key}"` : '';
        const classes = ['radar-cal-cell', info ? info.cls : '', info ? 'is-clickable' : '', isTodayCell ? 'is-today' : ''].filter(Boolean).join(' ');
        cells.push(`<div class="${classes}" ${clickableAttr} title="${escapeHtml(title)}">${d}</div>`);
      }
      return `
        <div class="radar-cal-month ${isCurMonth ? 'is-current-month' : ''}" ${isCurMonth ? 'data-cal-current-month="true"' : ''}>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12.5px; font-weight:700; color:var(--text-primary);">${yr} 年 ${mNum} 月</span>
            ${isCurMonth ? '<span class="pill" style="font-size:10px; padding:1px 6px;">本月</span>' : ''}
          </div>
          <div class="radar-cal-days">${cells.join('')}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">年度減碼執行日曆（${escapeHtml(yr)}）</div>
            <div class="text-muted" style="font-size:12px; margin-top:2px;">
              點擊任意交易日即跳轉至走勢圖檢視前後 40 日 ｜ 🔴 重砍 · 🟡 減碼 · 🟠 防禦期 · 🟢 回補
            </div>
          </div>
          <div class="action-toolbar-group">
            ${years.map((y) => `
              <button type="button" class="btn ${y === yr ? 'btn-primary' : 'btn-ghost'} btn-sm" data-radar-year="${y}">${y}</button>
            `).join('')}
          </div>
        </div>

        <div class="radar-cal-grid">
          ${monthsHtml}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Tab 4: Backtest Audit & v4.0 8-Factor What-If Simulator (參數設定已移至 Tab 5)
  // =========================================================================
  _renderAuditTab(rawData, meta, params, res) {
    const lastRow = rawData[rawData.length - 1];
    const waves = res.crashWaves.slice().reverse();

    return `
      <div class="grid-kpi">
        <div class="card">
          <div class="kpi-label">歷史減碼命中率</div>
          <div class="kpi-value" style="color:var(--accent-emerald);">${fmtDec(res.actionPrecision, 1)}%</div>
          <div class="kpi-sub">${res.hitCuts}/${res.cutActionsValidCount} 次命中${res.oosPrecision !== null ? ` · 樣本外 ${fmtDec(res.oosPrecision, 1)}%` : ''}</div>
        </div>
        <div class="card">
          <div class="kpi-label">股災波段捕捉率</div>
          <div class="kpi-value" style="color:var(--accent-blue);">${fmtDec(res.eventRecall, 1)}%</div>
          <div class="kpi-sub">捕捉 ${res.hitWaves} / ${res.crashWaves.length} 次大跌 · 濾網擋下 ${res.filteredDaysCount} 日</div>
        </div>
        <div class="card">
          <div class="kpi-label">最大回撤 (MDD) 改善</div>
          <div class="kpi-value" style="color:var(--accent-emerald);">-${fmtDec(res.mddReductionPct, 1)}%</div>
          <div class="kpi-sub">大盤 ${fmtDec(res.mddBH, 1)}% → 策略 ${fmtDec(res.mddSt, 1)}%</div>
        </div>
        <div class="card">
          <div class="kpi-label">累積報酬對比</div>
          <div class="kpi-value">${fmtSign(res.retSt, 1, '%')}</div>
          <div class="kpi-sub">同期大盤 Buy &amp; Hold：${fmtSign(res.retBH, 1, '%')}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div>
            <div class="card-title">What-If 盤後試算（v4.0 全 8 因子即時推演）</div>
            <div class="text-muted" style="font-size:12px; margin-top:2px;">基準日：${escapeHtml(lastRow.Date)}（收盤 ${fmtDec(lastRow.Close, 0)}）</div>
          </div>
          <div class="action-toolbar-group">
            <button type="button" class="btn btn-ghost btn-sm" data-whatif-preset="latest">帶入最新</button>
            <button type="button" class="btn btn-ghost btn-sm" data-whatif-preset="yellow">模擬黃燈</button>
            <button type="button" class="btn btn-ghost btn-sm" data-whatif-preset="red">模擬紅燈</button>
          </div>
        </div>
        <form id="form-radar-whatif" class="form-grid" style="align-items:end;">
          <div class="form-group">
            <label class="form-label">預估加權收盤</label>
            <input type="number" step="any" name="close" class="form-control font-mono" value="${lastRow.Close}" />
          </div>
          <div class="form-group">
            <label class="form-label">成交金額 (億)</label>
            <input type="number" step="any" name="volume" class="form-control font-mono" value="${Number.isFinite(lastRow.Volume) ? lastRow.Volume : 3500}" />
          </div>
          <div class="form-group">
            <label class="form-label">外資期貨未平倉 (口)</label>
            <input type="number" step="1" name="futOI" class="form-control font-mono" value="${Number.isFinite(lastRow.Foreign_Fut_OI) ? lastRow.Foreign_Fut_OI : 0}" />
          </div>
          <div class="form-group">
            <label class="form-label">外資現貨買賣超 (億)</label>
            <input type="number" step="any" name="spotNet" class="form-control font-mono" value="${Number.isFinite(lastRow.Foreign_Spot_Net) ? lastRow.Foreign_Spot_Net : 0}" />
          </div>
          <div class="form-group">
            <label class="form-label">OTC 櫃買指數</label>
            <input type="number" step="any" name="otc" class="form-control font-mono" value="${Number.isFinite(lastRow.OTC_Close) ? lastRow.OTC_Close : ''}" placeholder="選填" />
          </div>
          <div class="form-group">
            <label class="form-label">新台幣匯率 (USD/TWD)</label>
            <input type="number" step="0.01" name="fx" class="form-control font-mono" value="${Number.isFinite(lastRow.USD_TWD) ? lastRow.USD_TWD : ''}" placeholder="選填" />
          </div>
          <div class="form-group">
            <label class="form-label">美股費半 SOX</label>
            <input type="number" step="any" name="sox" class="form-control font-mono" value="${Number.isFinite(lastRow.SOX_Close) ? lastRow.SOX_Close : ''}" placeholder="選填" />
          </div>
          <div class="form-group">
            <label class="form-label">VIX 恐慌指數</label>
            <input type="number" step="0.1" name="vix" class="form-control font-mono" value="${Number.isFinite(lastRow.VIX) ? lastRow.VIX : 15}" />
          </div>
          <div class="form-group">
            <button type="submit" class="btn btn-primary" style="width:100%;">⚡ 立即試算</button>
          </div>
        </form>
        <div id="radar-whatif-output" style="margin-top:10px;">
          ${this._renderWhatIfOutput(this.whatIfResult)}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">歷次大跌波段複盤（共 ${waves.length} 次）</div>
          <span class="text-muted" style="font-size:12px;">點擊任一波段可跳轉至走勢圖</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>波段高點 → 低點</th>
                <th style="text-align:right;">波段最大跌幅</th>
                <th>狀態</th>
                <th>首次減碼日</th>
                <th style="text-align:right;">減碼後避開跌幅</th>
              </tr>
            </thead>
            <tbody>
              ${waves.length === 0 ? `
                <tr><td colspan="5" class="text-muted" style="text-align:center; padding:16px;">無大跌波段資料</td></tr>
              ` : waves.map((w) => `
                <tr data-jump-date="${escapeHtml(w.firstCutDate || w.peakDate)}" style="cursor:pointer;">
                  <td class="font-mono" style="color:var(--accent-blue);">${escapeHtml(w.peakDate)} → ${escapeHtml(w.troughDate)}</td>
                  <td class="font-mono" style="text-align:right; color:var(--accent-rose); font-weight:700;">${fmtDec(w.maxDrop, 1)}%</td>
                  <td><span class="pill ${w.hit ? 'pill-emerald' : 'pill-rose'}">${w.hit ? (w.alreadyInDefense ? '已在防禦中' : '成功預警') : '未觸發'}</span></td>
                  <td class="font-mono">${w.firstCutDate ? escapeHtml(w.firstCutDate) : '--'}</td>
                  <td class="font-mono" style="text-align:right;">${w.avoidedDrop !== null ? `${fmtDec(w.avoidedDrop, 1)}%` : '--'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderWhatIfOutput(res) {
    if (!res) return '';
    const pillCls = res.level === 'red' ? 'pill-rose' : (res.level === 'yellow' ? 'pill-amber' : 'pill-emerald');
    return `
      <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:8px; padding:10px 12px; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span class="pill ${pillCls}" style="font-weight:700;">${escapeHtml(res.verdict)}</span>
          <span class="font-mono text-muted" style="font-size:12px;">
            單日 ${fmtSign(res.estimatedDailyRetPct, 2, '%')} ｜ 波動 ${fmtDec(res.estimated20dVolPct, 1)}% ｜ 維持率 ${fmtDec(res.estimatedMaintRatio, 1)}%
          </span>
          ${res.usStrongBull ? '<span class="pill pill-emerald" style="font-size:11px;">🛡️ 美股強勢減壓 -20分</span>' : ''}
        </div>
        <div class="font-mono" style="font-size:11.5px;">
          S1外資:${res.signals.s1 ? '🔴' : '🟢'} · S2破線:${res.signals.s2 ? '🔴' : '🟢'} · S3維持率:${res.signals.s3 ? '🔴' : '🟢'} · S4櫃買:${res.signals.s4 ? '🔴' : '🟢'} · S5美股:${res.signals.s5 ? '🔴' : '🟢'}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Tab 5: Full v4.0 Parameter Settings (獨立參數設定分頁)
  // =========================================================================
  _renderSettingsTab(params, finmindToken, meta) {
    const filterToggles = [
      { key: 'useFutDelta', label: '外資 5 日空單急增濾網', desc: '追蹤 5 日空單變化量而非僅看絕對水位' },
      { key: 'useFxConfirm', label: '新台幣匯率貶值確認', desc: 'USD/TWD 站上 20MA 確認外資實質匯出' },
      { key: 'useOtcSignal', label: 'OTC 櫃買破拉積盤訊號', desc: '櫃買領先破月線且弱於大盤時加權警示' },
      { key: 'useUsFilter', label: '美股費半 SOX / VIX 濾網', desc: '費半強勢且低 VIX 時自動降壓抗洗盤 (-20分)' },
      { key: 'useMa240Protect', label: '年線 (240MA) 低檔保護', desc: '跌破年線且距高點逾 15% 時拉高減碼門檻' },
      { key: 'useOversoldProtect', label: '負乖離超跌防追砍保護', desc: '20MA 負乖離 ≤ -6% 時擋下黃燈避免殺低' }
    ];

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div>
            <div class="card-title">🧪 樣本外防過度擬合・最佳化掃描（81 組網格）</div>
            <div class="text-muted" style="font-size:12px; margin-top:2px;">
              僅依前 70% 訓練集評分排序（空單急增 × 維持率 × 破線天數 × 黃燈分），同時揭露後 30% 樣本外盲測命中率
            </div>
          </div>
          <div class="action-toolbar-group">
            <button type="button" class="btn btn-primary btn-sm" id="btn-radar-scan-apply">⚡ 掃描並自動套用第 1 名</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-radar-scan-only">🔍 僅掃描比較 Top 8</button>
          </div>
        </div>
        ${this._renderGridScanTable()}
      </div>

      <form id="form-radar-params">
        <div class="card" style="margin-bottom:14px;">
          <div class="card-header">
            <div>
              <div class="card-title">1. v4.0 六大強化濾網開關</div>
              <div class="text-muted" style="font-size:12px; margin-top:2px;">目前資料來源：${escapeHtml(meta.sourceName)}（籌碼:${meta.hasChip ? '有' : '無'} · OTC:${meta.hasOtc ? '有' : '無'} · 美股:${meta.hasUs ? '有' : '無'} · 匯率:${meta.hasFx ? '有' : '無'}）</div>
            </div>
          </div>
          <div class="radar-toggle-grid">
            ${filterToggles.map((ft) => `
              <label class="radar-toggle-item">
                <input type="checkbox" name="${ft.key}" ${params[ft.key] ? 'checked' : ''} />
                <div>
                  <div style="font-weight:700; color:var(--text-primary);">${ft.label}</div>
                  <div class="text-muted" style="font-size:11px; margin-top:2px;">${ft.desc}</div>
                </div>
              </label>
            `).join('')}
          </div>
        </div>

        <div class="card" style="margin-bottom:14px;">
          <div class="card-header">
            <div class="card-title">2. 風險溫度計門檻與倉位管理</div>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">黃燈減碼門檻 (分)</label>
              <input type="number" name="yellowScore" min="20" max="90" step="5" class="form-control font-mono" value="${params.yellowScore}" />
            </div>
            <div class="form-group">
              <label class="form-label">紅燈重砍門檻 (分)</label>
              <input type="number" name="redScore" min="40" max="100" step="5" class="form-control font-mono" value="${params.redScore}" />
            </div>
            <div class="form-group">
              <label class="form-label">黃燈目標倉位 (%)</label>
              <input type="number" name="yellowPos" min="0" max="95" step="5" class="form-control font-mono" value="${params.yellowPos}" />
            </div>
            <div class="form-group">
              <label class="form-label">紅燈目標倉位 (% 支援負值對沖)</label>
              <input type="number" name="redPos" min="-30" max="80" step="5" class="form-control font-mono" value="${params.redPos}" />
            </div>
            <div class="form-group">
              <label class="form-label">回補確認站上 10MA 天數</label>
              <input type="number" name="reentryDays" min="1" max="10" step="1" class="form-control font-mono" value="${params.reentryDays}" />
            </div>
            <div class="form-group">
              <label class="form-label">單邊交易摩擦成本 (%)</label>
              <input type="number" name="feePct" min="0" max="1" step="0.05" class="form-control font-mono" value="${params.feePct}" />
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom:14px;">
          <div class="card-header">
            <div class="card-title">3. 五大因子細部門檻與回測參數</div>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">外資期貨 5 日空單急增 (口)</label>
              <input type="number" name="futDelta5d" min="-25000" max="-1000" step="500" class="form-control font-mono" value="${params.futDelta5d}" />
            </div>
            <div class="form-group">
              <label class="form-label">外資期貨分位數 (%)</label>
              <input type="number" name="futQ" min="5" max="40" step="1" class="form-control font-mono" value="${params.futQ}" />
            </div>
            <div class="form-group">
              <label class="form-label">外資現貨 5 日分位數 (%)</label>
              <input type="number" name="spotQ" min="5" max="40" step="1" class="form-control font-mono" value="${params.spotQ}" />
            </div>
            <div class="form-group">
              <label class="form-label">趨勢均線天數 (MA)</label>
              <input type="number" name="maLen" min="5" max="120" step="1" class="form-control font-mono" value="${params.maLen}" />
            </div>
            <div class="form-group">
              <label class="form-label">破線確認天數</label>
              <input type="number" name="confirmDays" min="1" max="5" step="1" class="form-control font-mono" value="${params.confirmDays}" />
            </div>
            <div class="form-group">
              <label class="form-label">帶量長黑單日跌幅 (%)</label>
              <input type="number" name="dropPct" min="-5" max="-0.5" step="0.1" class="form-control font-mono" value="${params.dropPct}" />
            </div>
            <div class="form-group">
              <label class="form-label">放量倍數 (vs 均量)</label>
              <input type="number" name="volMult" min="0.8" max="2.5" step="0.05" class="form-control font-mono" value="${params.volMult}" />
            </div>
            <div class="form-group">
              <label class="form-label">20 日波動率警戒分位數 (%)</label>
              <input type="number" name="volQ" min="60" max="98" step="1" class="form-control font-mono" value="${params.volQ}" />
            </div>
            <div class="form-group">
              <label class="form-label">估算融資維持率警戒線 (%)</label>
              <input type="number" name="maintTh" min="140" max="175" step="1" class="form-control font-mono" value="${params.maintTh}" />
            </div>
            <div class="form-group">
              <label class="form-label">融資背離觀察天數</label>
              <input type="number" name="retDays" min="3" max="30" step="1" class="form-control font-mono" value="${params.retDays}" />
            </div>
            <div class="form-group">
              <label class="form-label">動態門檻滾動視窗 (交易日)</label>
              <input type="number" name="window" min="60" max="504" step="10" class="form-control font-mono" value="${params.window}" />
            </div>
            <div class="form-group">
              <label class="form-label">大跌驗證前瞻天數 / 門檻 (%)</label>
              <div style="display:flex; gap:6px;">
                <input type="number" name="fwdDays" min="5" max="40" step="1" class="form-control font-mono" value="${params.fwdDays}" title="前瞻天數" />
                <input type="number" name="crashPct" min="-20" max="-3" step="0.5" class="form-control font-mono" value="${params.crashPct}" title="大跌門檻%" />
              </div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom:14px;">
          <div class="card-header">
            <div class="card-title">4. FinMind API Token（選填）</div>
          </div>
          <div class="form-grid" style="align-items:end;">
            <div class="form-group" style="grid-column: span 2;">
              <label class="form-label">個人 FinMind Token（留空仍可使用免費公開額度，僅儲存在本機瀏覽器）</label>
              <input type="password" name="finmindToken" class="form-control font-mono" value="${escapeHtml(finmindToken || '')}" placeholder="貼上 FinMind API Token..." autocomplete="off" />
            </div>
            <div class="form-group" style="display:flex; flex-direction:row; gap:8px;">
              <button type="submit" class="btn btn-primary" style="flex:1;">💾 套用全部設定</button>
              <button type="button" class="btn btn-ghost" id="btn-radar-reset-params">↺ 恢復 v4.0 預設</button>
            </div>
          </div>
        </div>
      </form>
    `;
  }

  _renderGridScanTable() {
    if (!this.gridScanResult || !Array.isArray(this.gridScanResult.topResults)) {
      return '<div class="text-muted" style="font-size:12px;">點擊上方「⚡ 掃描並自動套用第 1 名」即可自動跑完 81 組並把最佳結果帶入下方參數設定。</div>';
    }
    const list = this.gridScanResult.topResults;
    return `
      <div style="margin-bottom:8px; font-size:12px;" class="text-muted">
        已完成 <strong>${this.gridScanResult.combosCount}</strong> 組掃描${this.gridScanResult.applied ? '（<span style="color:var(--accent-emerald); font-weight:700;">已自動套用第 1 名至下方參數</span>）' : ''}：
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>參數組合 (空單/維持率/破線/黃燈)</th>
              <th style="text-align:right;">訓練集命中</th>
              <th style="text-align:right;">樣本外盲測</th>
              <th style="text-align:right;">捕捉率</th>
              <th style="text-align:right;">策略MDD</th>
              <th style="text-align:right;">行動數</th>
              <th>套用</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((item, idx) => {
              const c = item.combo;
              const oosTxt = item.oosPrec !== null ? `${fmtDec(item.oosPrec, 1)}% (${item.oosCnt})` : '--';
              return `
                <tr style="${idx === 0 ? 'background:var(--accent-blue-soft);' : ''}">
                  <td class="font-mono" style="font-weight:700;">#${item.rank}</td>
                  <td class="font-mono" style="font-size:11.5px;">${c.futDelta5d} / ${c.maintTh}% / ${c.confirmDays}日 / ${c.yellowScore}分</td>
                  <td class="font-mono" style="text-align:right;">${fmtDec(item.isPrec, 1)}% (${item.isCnt})</td>
                  <td class="font-mono" style="text-align:right; font-weight:700; color:${item.oosPrec !== null && item.oosPrec >= 50 ? 'var(--accent-emerald)' : 'var(--text-primary)'};">${oosTxt}</td>
                  <td class="font-mono" style="text-align:right;">${fmtDec(item.recall, 1)}%</td>
                  <td class="font-mono" style="text-align:right;">${fmtDec(item.mddSt, 1)}%</td>
                  <td class="font-mono" style="text-align:right;">${item.trades}</td>
                  <td>
                    <button type="button" class="btn ${idx === 0 ? 'btn-primary' : 'btn-ghost'} btn-sm" data-apply-grid-idx="${idx}" style="padding:3px 8px; font-size:11px;">套用此組</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // =========================================================================
  // Event Binding (Includes Pinch-to-Zoom, Drag-Pan, Calendar Jump, Presets)
  // =========================================================================
  _bindEvents(container, state, store, showToast, rawData, res, params) {
    // Tab switching
    container.querySelectorAll('[data-radar-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextTab = btn.getAttribute('data-radar-tab');
        this.activeTab = nextTab;
        if (nextTab === 'calendar') {
          const todayYr = formatDate(new Date()).slice(0, 4);
          const hasTodayYr = rawData.some((r) => r.Date.startsWith(`${todayYr}-`));
          if (hasTodayYr) this.selectedYear = todayYr;
          this._shouldScrollToday = true;
        }
        this.render(container, state, store, showToast);
      });
    });

    // Quick range buttons (6M / 1Y / 3Y / ALL)
    container.querySelectorAll('[data-radar-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rg = btn.getAttribute('data-radar-range');
        this.chartRange = rg;
        const n = rawData.length;
        const counts = { '6M': 126, '1Y': 252, '3Y': 756, 'ALL': n };
        const take = Math.min(n, counts[rg] || 252);
        this.viewEndIdx = n - 1;
        this.viewStartIdx = Math.max(0, n - take);
        this.render(container, state, store, showToast);
      });
    });

    // Partial update helper for smooth chart zoom / pan / date range changes
    const refreshChartLocally = () => {
      const host = container.querySelector('#radar-svg-host');
      if (host) host.innerHTML = this._renderSvgRadarChart(rawData, res);
      const sInp = container.querySelector('#radar-date-start');
      const eInp = container.querySelector('#radar-date-end');
      if (sInp && rawData[this.viewStartIdx]) sInp.value = rawData[this.viewStartIdx].Date;
      if (eInp && rawData[this.viewEndIdx]) eInp.value = rawData[this.viewEndIdx].Date;
      const focusEl = container.querySelector('#radar-focus-banner');
      if (focusEl) {
        focusEl.innerHTML = this._renderFocusBanner(rawData, res);
        bindClearFocus();
      }
    };

    const zoomBy = (factor, anchorRatio = 0.5) => {
      const n = rawData.length;
      if (n <= MIN_VIEW_BARS) return;
      const curSpan = this.viewEndIdx - this.viewStartIdx + 1;
      const nextSpan = Math.max(MIN_VIEW_BARS, Math.min(n, Math.round(curSpan * factor)));
      const anchor = this.viewStartIdx + curSpan * anchorRatio;
      let nextStart = Math.round(anchor - nextSpan * anchorRatio);
      let nextEnd = nextStart + nextSpan - 1;
      if (nextStart < 0) { nextStart = 0; nextEnd = Math.min(n - 1, nextSpan - 1); }
      if (nextEnd >= n) { nextEnd = n - 1; nextStart = Math.max(0, n - nextSpan); }
      this.viewStartIdx = nextStart;
      this.viewEndIdx = nextEnd;
      this.chartRange = 'CUSTOM';
      refreshChartLocally();
    };

    const panByBars = (deltaBars) => {
      const n = rawData.length;
      const span = this.viewEndIdx - this.viewStartIdx;
      let nextStart = this.viewStartIdx + deltaBars;
      let nextEnd = nextStart + span;
      if (nextStart < 0) { nextStart = 0; nextEnd = span; }
      if (nextEnd >= n) { nextEnd = n - 1; nextStart = Math.max(0, nextEnd - span); }
      this.viewStartIdx = nextStart;
      this.viewEndIdx = nextEnd;
      this.chartRange = 'CUSTOM';
      refreshChartLocally();
    };

    const bindClearFocus = () => {
      const clr = container.querySelector('#btn-clear-focus-date');
      if (clr) {
        clr.addEventListener('click', () => {
          this.focusDate = null;
          refreshChartLocally();
        });
      }
    };
    bindClearFocus();

    // Date range inputs
    const startInp = container.querySelector('#radar-date-start');
    const endInp = container.querySelector('#radar-date-end');
    const applyDateInputs = () => {
      if (!startInp || !endInp) return;
      const sVal = startInp.value;
      const eVal = endInp.value;
      if (!sVal || !eVal || sVal > eVal) return;
      let sIdx = rawData.findIndex((r) => r.Date >= sVal);
      if (sIdx < 0) sIdx = 0;
      let eIdx = rawData.length - 1;
      for (let i = rawData.length - 1; i >= 0; i--) {
        if (rawData[i].Date <= eVal) { eIdx = i; break; }
      }
      if (eIdx - sIdx < MIN_VIEW_BARS - 1) {
        eIdx = Math.min(rawData.length - 1, sIdx + MIN_VIEW_BARS - 1);
      }
      this.viewStartIdx = sIdx;
      this.viewEndIdx = eIdx;
      this.chartRange = 'CUSTOM';
      refreshChartLocally();
    };
    if (startInp) startInp.addEventListener('change', applyDateInputs);
    if (endInp) endInp.addEventListener('change', applyDateInputs);

    // Zoom toolbar buttons
    const zIn = container.querySelector('#btn-radar-zoom-in');
    const zOut = container.querySelector('#btn-radar-zoom-out');
    const zReset = container.querySelector('#btn-radar-zoom-reset');
    if (zIn) zIn.addEventListener('click', () => zoomBy(0.68, 0.5));
    if (zOut) zOut.addEventListener('click', () => zoomBy(1.45, 0.5));
    if (zReset) {
      zReset.addEventListener('click', () => {
        this.chartRange = '1Y';
        this.focusDate = null;
        this.viewStartIdx = null;
        this.viewEndIdx = null;
        this.render(container, state, store, showToast);
      });
    }

    // Pinch-to-Zoom (Touch) & Wheel Zoom / Drag Pan (Desktop + Mobile) on #radar-svg-host
    const svgHost = container.querySelector('#radar-svg-host');
    if (svgHost) {
      let pinchStartDist = 0;
      let pinchStartSpan = 0;
      let pinchStartLeft = 0;
      let pinchAnchorRatio = 0.5;
      let dragActive = false;
      let dragStartX = 0;
      let dragOriginStart = 0;
      let dragOriginEnd = 0;

      const touchDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

      svgHost.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          dragActive = false;
          pinchStartDist = touchDist(e.touches[0], e.touches[1]);
          pinchStartSpan = this.viewEndIdx - this.viewStartIdx + 1;
          pinchStartLeft = this.viewStartIdx;
          const rect = svgHost.getBoundingClientRect();
          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          pinchAnchorRatio = rect.width > 0 ? Math.max(0, Math.min(1, (midX - rect.left) / rect.width)) : 0.5;
        } else if (e.touches.length === 1) {
          dragActive = true;
          dragStartX = e.touches[0].clientX;
          dragOriginStart = this.viewStartIdx;
          dragOriginEnd = this.viewEndIdx;
        }
      }, { passive: false });

      svgHost.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && pinchStartDist > 10) {
          e.preventDefault();
          const curDist = touchDist(e.touches[0], e.touches[1]);
          const scale = pinchStartDist / Math.max(10, curDist);
          const n = rawData.length;
          const nextSpan = Math.max(MIN_VIEW_BARS, Math.min(n, Math.round(pinchStartSpan * scale)));
          const anchor = pinchStartLeft + pinchStartSpan * pinchAnchorRatio;
          let nextStart = Math.round(anchor - nextSpan * pinchAnchorRatio);
          let nextEnd = nextStart + nextSpan - 1;
          if (nextStart < 0) { nextStart = 0; nextEnd = Math.min(n - 1, nextSpan - 1); }
          if (nextEnd >= n) { nextEnd = n - 1; nextStart = Math.max(0, n - nextSpan); }
          if (nextStart !== this.viewStartIdx || nextEnd !== this.viewEndIdx) {
            this.viewStartIdx = nextStart;
            this.viewEndIdx = nextEnd;
            this.chartRange = 'CUSTOM';
            refreshChartLocally();
          }
        } else if (e.touches.length === 1 && dragActive) {
          const rect = svgHost.getBoundingClientRect();
          if (rect.width <= 0) return;
          const dx = e.touches[0].clientX - dragStartX;
          const span = dragOriginEnd - dragOriginStart;
          const shift = Math.round((-dx / rect.width) * Math.max(10, span));
          if (shift !== 0) {
            e.preventDefault();
            this.viewStartIdx = dragOriginStart;
            this.viewEndIdx = dragOriginEnd;
            panByBars(shift);
          }
        }
      }, { passive: false });

      svgHost.addEventListener('touchend', () => {
        pinchStartDist = 0;
        dragActive = false;
      });

      svgHost.addEventListener('mousedown', (e) => {
        dragActive = true;
        dragStartX = e.clientX;
        dragOriginStart = this.viewStartIdx;
        dragOriginEnd = this.viewEndIdx;
      });
      svgHost.addEventListener('mousemove', (e) => {
        if (!dragActive) return;
        const rect = svgHost.getBoundingClientRect();
        if (rect.width <= 0) return;
        const dx = e.clientX - dragStartX;
        const span = dragOriginEnd - dragOriginStart;
        const shift = Math.round((-dx / rect.width) * Math.max(10, span));
        this.viewStartIdx = dragOriginStart;
        this.viewEndIdx = dragOriginEnd;
        panByBars(shift);
      });
      const stopMouseDrag = () => { dragActive = false; };
      svgHost.addEventListener('mouseup', stopMouseDrag);
      svgHost.addEventListener('mouseleave', stopMouseDrag);

      svgHost.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = svgHost.getBoundingClientRect();
        const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0.5;
        zoomBy(e.deltaY > 0 ? 1.25 : 0.8, ratio);
      }, { passive: false });
    }

    // Calendar year switch
    container.querySelectorAll('[data-radar-year]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedYear = btn.getAttribute('data-radar-year');
        this._shouldScrollToday = false;
        this.render(container, state, store, showToast);
      });
    });

    // Calendar day click -> jump to Radar chart focused on that date
    container.querySelectorAll('[data-cal-date]').forEach((cell) => {
      cell.addEventListener('click', () => {
        const dt = cell.getAttribute('data-cal-date');
        if (!dt) return;
        this._jumpToDate(dt, rawData);
        this.render(container, state, store, showToast);
      });
    });

    // Action log & crash wave row click -> jump to Radar chart
    container.querySelectorAll('[data-jump-date]').forEach((row) => {
      row.addEventListener('click', () => {
        const dt = row.getAttribute('data-jump-date');
        if (!dt) return;
        this._jumpToDate(dt, rawData);
        this.render(container, state, store, showToast);
      });
    });

    // Live FinMind refresh
    const refreshBtn = container.querySelector('#btn-radar-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        if (this.isRefreshing) return;
        this.isRefreshing = true;
        this.refreshStatus = '連線 FinMind 更新多因子資料...';
        this.render(container, state, store, showToast);
        try {
          const out = await TwseRadarCore.refreshFromFinMind({
            onStep: (step, msg) => {
              this.refreshStatus = `步驟 ${step}/5：${msg}`;
            }
          });
          this.refreshStatus = '';
          this.viewStartIdx = null;
          this.viewEndIdx = null;
          if (typeof window !== 'undefined' && typeof window.NIC_OnRadarUpdated === 'function') {
            window.NIC_OnRadarUpdated(out.summary);
          }
          if (showToast) showToast(`✅ TWSE 雷達已更新至 ${out.summary.date}（共 ${out.rowCount} 筆）`);
        } catch (err) {
          this.refreshStatus = '';
          if (showToast) showToast(`⚠️ 更新失敗：${err.message}`);
        } finally {
          this.isRefreshing = false;
          this.render(container, state, store, showToast);
        }
      });
    }

    // What-If Simulator presets & submit
    const whatIfForm = container.querySelector('#form-radar-whatif');
    if (whatIfForm) {
      const evalForm = () => {
        const fd = new FormData(whatIfForm);
        this.whatIfResult = TwseRadarCore.runWhatIf(Object.fromEntries(fd.entries()));
        const outEl = container.querySelector('#radar-whatif-output');
        if (outEl) outEl.innerHTML = this._renderWhatIfOutput(this.whatIfResult);
      };

      whatIfForm.addEventListener('submit', (e) => {
        e.preventDefault();
        evalForm();
      });

      container.querySelectorAll('[data-whatif-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const preset = btn.getAttribute('data-whatif-preset');
          const i = res.n - 1;
          const row = rawData[i];
          const ma20 = res.pre.ma20[i] || row.Close;
          const vMa = res.pre.volMa[i] || row.Volume || 3500;
          const sTh = Number.isFinite(res.spotThArr[i]) ? res.spotThArr[i] : -500;
          const otcBase = Number.isFinite(res.pre.otcMa20[i]) ? res.pre.otcMa20[i] : (row.OTC_Close || 250);
          const fxBase = Number.isFinite(res.pre.fxMa20[i]) ? res.pre.fxMa20[i] : (row.USD_TWD || 32.0);
          const soxBase = Number.isFinite(res.pre.soxMa20[i]) ? res.pre.soxMa20[i] : (row.SOX_Close || 5000);
          const setVal = (name, val) => {
            const inp = whatIfForm.querySelector(`[name="${name}"]`);
            if (inp) inp.value = val;
          };

          if (preset === 'latest') {
            setVal('close', row.Close);
            setVal('volume', Number.isFinite(row.Volume) ? row.Volume : 3500);
            setVal('futOI', Number.isFinite(row.Foreign_Fut_OI) ? row.Foreign_Fut_OI : 0);
            setVal('spotNet', Number.isFinite(row.Foreign_Spot_Net) ? row.Foreign_Spot_Net : 0);
            setVal('otc', Number.isFinite(row.OTC_Close) ? row.OTC_Close : '');
            setVal('fx', Number.isFinite(row.USD_TWD) ? row.USD_TWD : '');
            setVal('sox', Number.isFinite(row.SOX_Close) ? row.SOX_Close : '');
            setVal('vix', Number.isFinite(row.VIX) ? row.VIX : 15);
          } else if (preset === 'yellow') {
            setVal('close', (ma20 * 0.975).toFixed(1));
            setVal('volume', Math.round(vMa * 1.35));
            setVal('futOI', Math.round((res.pre.futOI[i - 4] || -20000) - 9000));
            setVal('spotNet', Math.round((sTh - 200) / 2));
            setVal('otc', (otcBase * 0.96).toFixed(1));
            setVal('fx', (fxBase + 0.35).toFixed(2));
            setVal('sox', (soxBase * 0.97).toFixed(0));
            setVal('vix', 21.0);
          } else if (preset === 'red') {
            setVal('close', (ma20 * 0.945).toFixed(1));
            setVal('volume', Math.round(vMa * 1.65));
            setVal('futOI', Math.round((res.pre.futOI[i - 4] || -20000) - 14000));
            setVal('spotNet', Math.round(sTh - 350));
            setVal('otc', (otcBase * 0.93).toFixed(1));
            setVal('fx', (fxBase + 0.65).toFixed(2));
            setVal('sox', (soxBase * 0.93).toFixed(0));
            setVal('vix', 28.5);
          }
          evalForm();
        });
      });
    }

    // Full v4.0 Parameter Form (Tab 5)
    const paramsForm = container.querySelector('#form-radar-params');
    if (paramsForm) {
      paramsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(paramsForm);
        const patch = {};
        for (const [k, v] of fd.entries()) {
          if (k === 'finmindToken') continue;
          patch[k] = v;
        }
        // Unchecked checkboxes are omitted by FormData, so explicitly set false
        for (const bk of BOOL_PARAM_KEYS) {
          patch[bk] = fd.has(bk);
        }
        const tokenVal = fd.has('finmindToken') ? String(fd.get('finmindToken') || '').trim() : undefined;
        const out = TwseRadarCore.updateParams(patch, tokenVal);
        if (typeof window !== 'undefined' && typeof window.NIC_OnRadarUpdated === 'function') {
          window.NIC_OnRadarUpdated(out.latestSummary);
        }
        if (showToast) showToast('✅ 已套用 v4.0 參數設定並重算明日行動指令');
        this.render(container, state, store, showToast);
      });
    }

    const resetParamsBtn = container.querySelector('#btn-radar-reset-params');
    if (resetParamsBtn) {
      resetParamsBtn.addEventListener('click', () => {
        const out = TwseRadarCore.updateParams(DEFAULT_PARAMS);
        if (typeof window !== 'undefined' && typeof window.NIC_OnRadarUpdated === 'function') {
          window.NIC_OnRadarUpdated(out.latestSummary);
        }
        if (showToast) showToast('已恢復 v4.0 預設參數');
        this.render(container, state, store, showToast);
      });
    }

    // OOS Grid Search buttons (Tab 5)
    const runScan = (applyBest) => {
      const scanRes = TwseRadarCore.runOosGridSearch({ applyBest });
      this.gridScanResult = scanRes;
      if (applyBest && scanRes.latestSummary && typeof window !== 'undefined' && typeof window.NIC_OnRadarUpdated === 'function') {
        window.NIC_OnRadarUpdated(scanRes.latestSummary);
      }
      if (showToast) {
        showToast(applyBest && scanRes.bestCombo
          ? `✅ 掃描完成！已自動套用第 1 名最佳參數（空單 ${scanRes.bestCombo.futDelta5d} / 維持率 ${scanRes.bestCombo.maintTh}% / 破線 ${scanRes.bestCombo.confirmDays} 日 / 黃燈 ${scanRes.bestCombo.yellowScore} 分）`
          : `✅ 完成 ${scanRes.combosCount} 組樣本外掃描，請挑選要套用的組合`);
      }
      this.render(container, state, store, showToast);
    };

    const scanApplyBtn = container.querySelector('#btn-radar-scan-apply');
    if (scanApplyBtn) scanApplyBtn.addEventListener('click', () => runScan(true));

    const scanOnlyBtn = container.querySelector('#btn-radar-scan-only');
    if (scanOnlyBtn) scanOnlyBtn.addEventListener('click', () => runScan(false));

    container.querySelectorAll('[data-apply-grid-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-apply-grid-idx'));
        const chosen = this.gridScanResult?.topResults?.[idx];
        if (!chosen) return;
        const out = TwseRadarCore.updateParams(chosen.combo);
        this.gridScanResult = { ...this.gridScanResult, applied: true };
        if (typeof window !== 'undefined' && typeof window.NIC_OnRadarUpdated === 'function') {
          window.NIC_OnRadarUpdated(out.latestSummary);
        }
        if (showToast) showToast(`✅ 已套用排名 #${chosen.rank} 參數組合並重算明日指令`);
        this.render(container, state, store, showToast);
      });
    });
  }
}
