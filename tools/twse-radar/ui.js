import {
  TwseRadarCore,
  DEFAULT_PARAMS,
  runQuantEngine,
  buildLatestSummary,
  parseNum,
  parseFlexibleDate,
  computeRealizedVolatility
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

function parseBundledCsv(csvText) {
  const lines = String(csvText || '').trim().split(/\r?\n/);
  if (lines.length < 85) return null;
  const headers = lines[0].split(',').map((h) => h.trim());
  const idx = (name) => headers.indexOf(name);
  const iDate = idx('Date');
  const iClose = idx('Close');
  const iVol = idx('Volume');
  const iFut = idx('Foreign_Fut_OI');
  const iSpot = idx('Foreign_Spot_Net');
  const iMargin = idx('Margin_Balance');
  const iVolatility = idx('Volatility');
  if (iDate < 0 || iClose < 0) return null;

  const rows = [];
  for (let k = 1; k < lines.length; k++) {
    const cols = lines[k].split(',');
    const dt = parseFlexibleDate(cols[iDate]);
    const close = parseNum(cols[iClose]);
    if (!dt || !Number.isFinite(close) || close <= 0) continue;
    rows.push({
      Date: dt,
      Close: close,
      Volume: iVol >= 0 ? parseNum(cols[iVol]) : NaN,
      Foreign_Fut_OI: iFut >= 0 ? parseNum(cols[iFut]) : NaN,
      Foreign_Spot_Net: iSpot >= 0 ? parseNum(cols[iSpot]) : 0,
      Margin_Balance: iMargin >= 0 ? parseNum(cols[iMargin]) : NaN,
      Volatility: iVolatility >= 0 ? parseNum(cols[iVolatility]) : NaN
    });
  }
  if (rows.length < 80) return null;
  rows.sort((a, b) => a.Date.localeCompare(b.Date));

  // Fill missing realized volatility if needed
  const needsVol = rows.some((r) => !Number.isFinite(r.Volatility));
  if (needsVol) {
    const realized = computeRealizedVolatility(rows.map((r) => r.Close), 20);
    for (let i = 0; i < rows.length; i++) {
      if (!Number.isFinite(rows[i].Volatility)) {
        rows[i].Volatility = Number(realized[i].toFixed(2));
      }
    }
  }
  const hasChip = rows.some((r) => Number.isFinite(r.Foreign_Fut_OI)) && rows.some((r) => Number.isFinite(r.Margin_Balance));
  return {
    rawData: rows,
    dataMeta: {
      isReal: true,
      sourceName: '內建真實台股 CSV',
      priceOnly: !hasChip,
      hasVolume: rows.some((r) => Number.isFinite(r.Volume) && r.Volume > 0),
      autoVolComputed: needsVol,
      updatedAt: null
    }
  };
}

/**
 * TWSE Trim Action Radar Native UI
 * Tab 1: Minimalist T+1 Action Directive & 5-Factor Status Strip
 * Tab 2: Native SVG Radar Chart & Action Log
 * Tab 3: Yearly Trim Calendar
 * Tab 4: Backtest Audit, What-If Simulator & Parameter Tuning
 */
export class TwseRadarUI {
  constructor() {
    this.activeTab = 'action'; // 'action' | 'radar' | 'calendar' | 'audit'
    this.chartRange = '1Y';    // '6M' | '1Y' | '3Y' | 'ALL'
    this.selectedYear = null;
    this.isRefreshing = false;
    this.refreshStatus = '';
    this.whatIfResult = null;
    this._csvLoadedAttempted = false;
  }

  _ensureBundledCsv(container, state, store, showToast) {
    if (this._csvLoadedAttempted) return;
    this._csvLoadedAttempted = true;
    const cache = TwseRadarCore.loadCache();
    if (cache.rawData && cache.rawData.length >= 80 && cache.dataMeta?.isReal) return;
    if (typeof fetch !== 'function') return;

    fetch(`./tools/twse-radar/real_twse_v4.csv?v=${encodeURIComponent(window?.NIC_APP_VERSION || 'v52')}`)
      .then((resp) => (resp.ok ? resp.text() : null))
      .then((txt) => {
        if (!txt) return;
        const parsed = parseBundledCsv(txt);
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
        this.render(container, state, store, showToast);
      })
      .catch(() => {});
  }

  render(container, state, store, showToast) {
    this._ensureBundledCsv(container, state, store, showToast);

    const { rawData, dataMeta, params } = TwseRadarCore.getWorkingData();
    const res = runQuantEngine(rawData, params, dataMeta);
    const summary = buildLatestSummary(rawData, params, dataMeta, res);
    TwseRadarCore.saveCache({ latestSummary: summary });

    const years = Array.from(new Set(rawData.map((r) => String(r.Date).slice(0, 4)))).sort().reverse();
    if (!this.selectedYear || !years.includes(this.selectedYear)) {
      this.selectedYear = years[0] || String(new Date().getFullYear());
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
      </div>

      <div id="twse-radar-tab-content">
        ${this.activeTab === 'action' ? this._renderActionTab(rawData, dataMeta, params, res, summary) : ''}
        ${this.activeTab === 'radar' ? this._renderRadarTab(rawData, res) : ''}
        ${this.activeTab === 'calendar' ? this._renderCalendarTab(rawData, res, years) : ''}
        ${this.activeTab === 'audit' ? this._renderAuditTab(rawData, dataMeta, params, res) : ''}
      </div>
    `;

    this._bindEvents(container, state, store, showToast, rawData, params);
  }

  // =========================================================================
  // Tab 1: Minimalist T+1 Action Directive (一目瞭然首頁)
  // =========================================================================
  _renderActionTab(rawData, dataMeta, params, res, summary) {
    const last = res.n - 1;
    const row = rawData[last];
    const { pre, futThArr, spotThArr, volThArr, marginThArr } = res;

    const pillCls = summary.level === 'red'
      ? 'pill-rose'
      : (summary.level === 'yellow' || summary.level === 'defense' ? 'pill-amber' : 'pill-emerald');
    const posColor = summary.level === 'red'
      ? 'var(--accent-rose)'
      : (summary.level === 'yellow' || summary.level === 'defense' ? '#d97706' : 'var(--accent-emerald)');

    const futVal = row.Foreign_Fut_OI;
    const futTh = futThArr[last];
    const futAlert = !dataMeta.priceOnly && Number.isFinite(futVal) && Number.isFinite(futTh) && futVal < futTh;

    const spot5d = pre.spot5d[last];
    const spotTh = spotThArr[last];
    const spotAlert = !dataMeta.priceOnly && Number.isFinite(spot5d) && Number.isFinite(spotTh) && spot5d < spotTh;

    const maVal = pre.ma[last];
    const consecBelow = pre.consecBelowMA[last] || 0;
    const trendAlert = res.sig2[last] === 1;

    const volVal = row.Volatility;
    const volTh = volThArr[last];
    const volAlert = Number.isFinite(volVal) && Number.isFinite(volTh) && volVal > volTh;

    const marginVal = row.Margin_Balance;
    const marginTh = marginThArr[last];
    const marginAlert = !dataMeta.priceOnly && Number.isFinite(marginVal) && Number.isFinite(marginTh) && marginVal > marginTh;

    const factors = [
      {
        title: '外資期貨未平倉',
        alert: futAlert,
        val: Number.isFinite(futVal) ? `${fmtInt(futVal)} 口` : '--',
        sub: Number.isFinite(futTh) ? `警戒線 < ${fmtInt(futTh)}` : '純價量模式'
      },
      {
        title: '外資現貨 5 日',
        alert: spotAlert,
        val: Number.isFinite(spot5d) ? `${fmtSign(spot5d, 1)} 億` : '--',
        sub: Number.isFinite(spotTh) ? `警戒線 < ${fmtDec(spotTh, 1)} 億` : '純價量模式'
      },
      {
        title: `趨勢破線 (MA${params.maLen})`,
        alert: trendAlert,
        val: Number.isFinite(maVal) ? (row.Close < maVal ? `破線 ${consecBelow} 日` : '站穩均線') : '--',
        sub: Number.isFinite(maVal) ? `MA${params.maLen}：${fmtInt(maVal)}` : '--'
      },
      {
        title: '20日波動恐慌',
        alert: volAlert,
        val: Number.isFinite(volVal) ? `${fmtDec(volVal, 1)}%` : '--',
        sub: Number.isFinite(volTh) ? `警戒線 > ${fmtDec(volTh, 1)}%` : '--'
      },
      {
        title: '大盤融資餘額',
        alert: marginAlert,
        val: Number.isFinite(marginVal) ? `${fmtInt(marginVal)} 億` : '--',
        sub: Number.isFinite(marginTh) ? `高檔線 > ${fmtInt(marginTh)} 億` : '純價量模式'
      }
    ];

    const updatedNote = dataMeta.updatedAt
      ? new Date(dataMeta.updatedAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      : null;

    return `
      <div class="card radar-hero level-${summary.level}" style="margin-bottom:14px;">
        <div style="min-width:0;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
            <span class="pill ${pillCls}" style="font-size:12px; font-weight:700;">
              ${summary.emoji} 明日 T+1 行動指令
            </span>
            <span class="pill" style="font-size:11px;">
              風險評分 ${summary.score} / ${summary.maxScore}
            </span>
            <span class="text-muted font-mono" style="font-size:12px;">
              基準日 ${escapeHtml(summary.date)}
            </span>
          </div>

          <div style="font-size:24px; font-weight:800; line-height:1.25; color:var(--text-primary); margin-bottom:8px;">
            ${escapeHtml(summary.verdict)}
          </div>

          <div class="text-muted" style="font-size:12.5px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
            <span>加權收盤 <strong class="font-mono" style="color:var(--text-primary);">${fmtDec(summary.close, 2)}</strong></span>
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
              <span class="pill ${f.alert ? 'pill-rose' : 'pill-emerald'}" style="font-size:10.5px; padding:1px 6px;">
                ${f.alert ? '警戒' : '正常'}
              </span>
            </div>
            <div class="font-mono" style="font-size:16px; font-weight:700; color:var(--text-primary);">
              ${f.val}
            </div>
            <div class="text-muted font-mono" style="font-size:11px;">
              ${f.sub}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // =========================================================================
  // Tab 2: Native SVG Radar Chart & Action List
  // =========================================================================
  _renderRadarTab(rawData, res) {
    const rangeCounts = { '6M': 126, '1Y': 252, '3Y': 756, 'ALL': rawData.length };
    const take = Math.min(rawData.length, rangeCounts[this.chartRange] || 252);
    const startIdx = Math.max(0, rawData.length - take);
    const slice = rawData.slice(startIdx);
    const recentActions = res.actions.slice().reverse().slice(0, 30);

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div>
            <div class="card-title">加權指數走勢與減碼訊號點位</div>
            <div class="text-muted" style="font-size:12px; margin-top:2px;">
              藍線：加權收盤 ｜ 虛線：均線 ｜ 🔴 重砍 · 🟡 減碼 · 🟢 回補
            </div>
          </div>
          <div class="action-toolbar-group">
            ${['6M', '1Y', '3Y', 'ALL'].map((rg) => `
              <button type="button" class="btn ${this.chartRange === rg ? 'btn-primary' : 'btn-ghost'} btn-sm" data-radar-range="${rg}">${rg}</button>
            `).join('')}
          </div>
        </div>
        <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:10px; padding:10px;">
          ${this._renderSvgRadarChart(slice, startIdx, res)}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">歷史加減碼行動清單（近 ${recentActions.length} 筆）</div>
          <span class="text-muted" style="font-size:12px;">共 ${res.actions.length} 次行動</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>執行日 (T+1)</th>
                <th>動作</th>
                <th style="text-align:right;">倉位變化</th>
                <th style="text-align:right;">執行日收盤</th>
                <th style="text-align:right;">後續 15 日最大跌幅</th>
                <th>驗證</th>
              </tr>
            </thead>
            <tbody>
              ${recentActions.length === 0 ? `
                <tr><td colspan="6" class="text-muted" style="text-align:center; padding:18px;">此區間尚無加減碼行動紀錄</td></tr>
              ` : recentActions.map((a) => {
                const badgeCls = a.type === 2 ? 'pill-rose' : (a.type === 1 ? 'pill-amber' : 'pill-emerald');
                const dropStr = a.subsequentDrop !== null ? `${fmtDec(a.subsequentDrop, 1)}%` : '--';
                const verifyTag = a.type === 3
                  ? '<span class="text-muted">回補</span>'
                  : (a.subsequentDrop === null
                    ? '<span class="text-muted">觀察中</span>'
                    : (a.hitCrash
                      ? '<span class="pill pill-emerald">命中大跌</span>'
                      : '<span class="pill">預防性避險</span>'));
                return `
                  <tr>
                    <td class="font-mono">${escapeHtml(a.execDate)}</td>
                    <td><span class="pill ${badgeCls}">${escapeHtml(a.typeName)}</span></td>
                    <td class="font-mono" style="text-align:right;">${a.fromPos}% → <strong>${a.toPos}%</strong></td>
                    <td class="font-mono" style="text-align:right;">${fmtDec(a.execClose, 0)}</td>
                    <td class="font-mono" style="text-align:right; color:${a.subsequentDrop !== null && a.subsequentDrop <= -5 ? 'var(--accent-rose)' : 'var(--text-primary)'};">${dropStr}</td>
                    <td>${verifyTag}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderSvgRadarChart(slice, startIdx, res) {
    if (!slice.length) return '<div class="text-muted" style="padding:20px; text-align:center;">無資料</div>';
    const W = 760;
    const H = 250;
    const padL = 52;
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
        const mv = res.pre.ma[startIdx + i];
        return Number.isFinite(mv) ? `${xAt(i).toFixed(1)},${yAt(mv).toFixed(1)}` : null;
      })
      .filter(Boolean)
      .join(' ');

    const markers = [];
    for (let i = 0; i < slice.length; i++) {
      const act = res.actionTypeArr[startIdx + i];
      if (!act) continue;
      const color = act === 2 ? '#e11d48' : (act === 1 ? '#f59e0b' : '#10b981');
      markers.push(`<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(slice[i].Close).toFixed(1)}" r="4.5" fill="${color}" stroke="#ffffff" stroke-width="1.5"><title>${slice[i].Date} 收盤 ${fmtDec(slice[i].Close, 0)}</title></circle>`);
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
      <text x="${xAt(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : (i === slice.length - 1 ? 'end' : 'middle')}" fill="var(--text-muted)" font-size="10" font-family="monospace">${slice[i].Date.slice(0, 7)}</text>
    `).join('');

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
        ${yTicks}
        ${maPts ? `<polyline fill="none" stroke="var(--text-muted)" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.65" points="${maPts}" />` : ''}
        <polyline fill="none" stroke="var(--accent-blue)" stroke-width="2" points="${pricePts}" />
        ${markers.join('')}
        ${xTicks}
      </svg>
    `;
  }

  // =========================================================================
  // Tab 3: Yearly Trim Calendar (年度減碼日曆)
  // =========================================================================
  _renderCalendarTab(rawData, res, years) {
    const yr = this.selectedYear;
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
      dayMap.set(dt, { cls, label, close: rawData[i].Close });
    }

    const monthsHtml = Array.from({ length: 12 }, (_, mIdx) => {
      const mNum = mIdx + 1;
      const mStr = String(mNum).padStart(2, '0');
      const firstDow = new Date(Number(yr), mIdx, 1).getDay();
      const daysInMonth = new Date(Number(yr), mIdx + 1, 0).getDate();
      const cells = [];
      for (let e = 0; e < firstDow; e++) {
        cells.push('<div class="radar-cal-cell is-empty"></div>');
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${yr}-${mStr}-${String(d).padStart(2, '0')}`;
        const info = dayMap.get(key);
        const title = info ? `${key} ${info.label} (收盤 ${fmtInt(info.close)})` : `${key} 休市`;
        cells.push(`<div class="radar-cal-cell ${info ? info.cls : ''}" title="${escapeHtml(title)}">${d}</div>`);
      }
      return `
        <div class="radar-cal-month">
          <div style="font-size:12.5px; font-weight:700; color:var(--text-primary);">${yr} 年 ${mNum} 月</div>
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
              🔴 紅燈重砍 ｜ 🟡 黃燈減碼 ｜ 🟠 防禦減碼期 ｜ 🟢 警報解除回補
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
  // Tab 4: Backtest Audit, What-If Simulator & Parameter Tuning
  // =========================================================================
  _renderAuditTab(rawData, dataMeta, params, res) {
    const lastRow = rawData[rawData.length - 1];
    const waves = res.crashWaves.slice().reverse();

    return `
      <div class="grid-kpi">
        <div class="card">
          <div class="kpi-label">歷史減碼命中率</div>
          <div class="kpi-value" style="color:var(--accent-emerald);">${fmtDec(res.actionPrecision, 1)}%</div>
          <div class="kpi-sub">${res.hitCuts} / ${res.cutActionsValidCount} 次有效減碼命中</div>
        </div>
        <div class="card">
          <div class="kpi-label">股災波段捕捉率</div>
          <div class="kpi-value" style="color:var(--accent-blue);">${fmtDec(res.eventRecall, 1)}%</div>
          <div class="kpi-sub">捕捉 ${res.hitWaves} / ${res.crashWaves.length} 次大跌波段</div>
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
            <div class="card-title">What-If 盤後試算（輸入今日預估數據）</div>
            <div class="text-muted" style="font-size:12px; margin-top:2px;">基準日：${escapeHtml(lastRow.Date)}（收盤 ${fmtDec(lastRow.Close, 0)}）</div>
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
            <label class="form-label">融資餘額 (億)</label>
            <input type="number" step="any" name="marginBalance" class="form-control font-mono" value="${Number.isFinite(lastRow.Margin_Balance) ? lastRow.Margin_Balance : 0}" />
          </div>
          <div class="form-group">
            <button type="submit" class="btn btn-primary" style="width:100%;">⚡ 立即試算</button>
          </div>
        </form>
        <div id="radar-whatif-output" style="margin-top:10px;">
          ${this._renderWhatIfOutput(this.whatIfResult)}
        </div>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="card-header">
          <div class="card-title">歷次大跌波段複盤（共 ${waves.length} 次）</div>
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
                <tr>
                  <td class="font-mono">${escapeHtml(w.peakDate)} → ${escapeHtml(w.troughDate)}</td>
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

      <details class="card">
        <summary style="cursor:pointer; font-weight:700; font-size:14px; list-style:none;">
          ⚙️ 進階量化參數微調（點擊展開）
        </summary>
        <form id="form-radar-params" class="form-grid" style="margin-top:12px; align-items:end;">
          <div class="form-group">
            <label class="form-label">黃燈目標倉位 (%)</label>
            <input type="number" name="yellowPos" min="0" max="100" class="form-control font-mono" value="${params.yellowPos}" />
          </div>
          <div class="form-group">
            <label class="form-label">紅燈目標倉位 (%)</label>
            <input type="number" name="redPos" min="0" max="100" class="form-control font-mono" value="${params.redPos}" />
          </div>
          <div class="form-group">
            <label class="form-label">趨勢均線天數 (MA)</label>
            <input type="number" name="maLen" min="5" max="120" class="form-control font-mono" value="${params.maLen}" />
          </div>
          <div class="form-group">
            <label class="form-label">外資期貨分位數 (%)</label>
            <input type="number" name="futQ" min="5" max="40" class="form-control font-mono" value="${params.futQ}" />
          </div>
          <div class="form-group">
            <label class="form-label">波動率分位數 (%)</label>
            <input type="number" name="volQ" min="60" max="98" class="form-control font-mono" value="${params.volQ}" />
          </div>
          <div class="form-group" style="display:flex; flex-direction:row; gap:6px;">
            <button type="submit" class="btn btn-primary btn-sm" style="flex:1;">套用參數</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-radar-reset-params">重設</button>
          </div>
        </form>
      </details>
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
            單日漲跌 ${fmtSign(res.estimatedDailyRetPct, 2, '%')} ｜ 20日波動 ${fmtDec(res.estimated20dVolPct, 1)}%
          </span>
        </div>
        <div class="font-mono" style="font-size:12px;">
          S1外資:${res.signals.s1 ? '🔴' : '🟢'} · S2破線:${res.signals.s2 ? '🔴' : '🟢'} · S3恐慌:${res.signals.s3 ? '🔴' : '🟢'}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Event Binding
  // =========================================================================
  _bindEvents(container, state, store, showToast) {
    container.querySelectorAll('[data-radar-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.getAttribute('data-radar-tab');
        this.render(container, state, store, showToast);
      });
    });

    container.querySelectorAll('[data-radar-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.chartRange = btn.getAttribute('data-radar-range');
        this.render(container, state, store, showToast);
      });
    });

    container.querySelectorAll('[data-radar-year]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedYear = btn.getAttribute('data-radar-year');
        this.render(container, state, store, showToast);
      });
    });

    const refreshBtn = container.querySelector('#btn-radar-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        if (this.isRefreshing) return;
        this.isRefreshing = true;
        this.refreshStatus = '連線 FinMind 更新 5 因子資料...';
        this.render(container, state, store, showToast);
        try {
          const out = await TwseRadarCore.refreshFromFinMind({
            onStep: (step, msg) => {
              this.refreshStatus = `步驟 ${step}：${msg}`;
            }
          });
          this.refreshStatus = '';
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

    const whatIfForm = container.querySelector('#form-radar-whatif');
    if (whatIfForm) {
      whatIfForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(whatIfForm);
        this.whatIfResult = TwseRadarCore.runWhatIf(Object.fromEntries(fd.entries()));
        const outEl = container.querySelector('#radar-whatif-output');
        if (outEl) {
          outEl.innerHTML = this._renderWhatIfOutput(this.whatIfResult);
        }
      });
    }

    const paramsForm = container.querySelector('#form-radar-params');
    if (paramsForm) {
      paramsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(paramsForm);
        const res = TwseRadarCore.updateParams(Object.fromEntries(fd.entries()));
        if (typeof window !== 'undefined' && typeof window.NIC_OnRadarUpdated === 'function') {
          window.NIC_OnRadarUpdated(res.latestSummary);
        }
        if (showToast) showToast('✅ 已套用量化參數並重算明日行動指令');
        this.render(container, state, store, showToast);
      });
    }

    const resetParamsBtn = container.querySelector('#btn-radar-reset-params');
    if (resetParamsBtn) {
      resetParamsBtn.addEventListener('click', () => {
        const res = TwseRadarCore.updateParams(DEFAULT_PARAMS);
        if (typeof window !== 'undefined' && typeof window.NIC_OnRadarUpdated === 'function') {
          window.NIC_OnRadarUpdated(res.latestSummary);
        }
        if (showToast) showToast('已恢復預設量化參數');
        this.render(container, state, store, showToast);
      });
    }
  }
}
