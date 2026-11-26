import { StockCore } from '../stock-tracker/core.js';
import { AssetCore, FS_SHEET_URL } from '../asset-tracker/core.js';
import { TwseRadarCore } from '../twse-radar/core.js';
import { bindTwoStepConfirm } from '../../core/nav-history.js';

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
const fmtPct = (n) => `${(toRatio(n) * 100).toFixed(2)}%`;

export class HubUI {
  constructor(navigateFn) {
    this.navigate = navigateFn;
    this.showAddExternal = false;
    this.topSort = { col: 'market', dir: 'desc' };
  }

  getViewSnapshot() {
    return {
      label: '總覽',
      state: { topSort: { ...this.topSort } }
    };
  }

  restoreViewSnapshot(snap) {
    if (snap?.topSort) this.topSort = { ...snap.topSort };
    this.showAddExternal = false;
  }

  handleEscape() {
    if (this.showAddExternal) {
      this.showAddExternal = false;
      return true;
    }
    return false;
  }

  render(container, state, store, showToast) {
    const stockSum = StockCore.getSummary(state);
    const assetSum = AssetCore.getSummary(state);
    const salData = AssetCore.getSalaryData(state);
    const radarSum = TwseRadarCore.getCachedSummaryFast();
    const config = store.getConfig();
    const queue = store.getSyncQueue();

    const holdings = [...(state?.stock?.overview || [])];
    const dirMul = this.topSort.dir === 'asc' ? 1 : -1;
    holdings.sort((a, b) => {
      if (this.topSort.col === 'code') return String(a['代號'] || '').localeCompare(String(b['代號'] || '')) * dirMul;
      if (this.topSort.col === 'pnl') return (toNum(a['未實現(TWD)'], 0) - toNum(b['未實現(TWD)'], 0)) * dirMul;
      if (this.topSort.col === 'roi') return (toRatio(a['報酬率']) - toRatio(b['報酬率'])) * dirMul;
      return (toNum(a['市值(TWD)'], 0) - toNum(b['市值(TWD)'], 0)) * dirMul;
    });
    const topHoldings = holdings.slice(0, 6);

    const externalTools = config.externalTools || [];
    const needsPairing = Boolean(state?.isDemoSeed && !config.gasUrl);

    const sortTh = (col, label, align = 'left') => {
      const isAct = this.topSort.col === col;
      const arrow = isAct ? (this.topSort.dir === 'desc' ? '▼' : '▲') : '↕';
      return `<th class="sortable ${isAct ? 'sort-active' : ''}" data-hub-sort="${col}" style="${align === 'right' ? 'text-align:right;' : ''}">${label}<span class="sort-indicator">${arrow}</span></th>`;
    };

    container.innerHTML = `
      ${needsPairing ? `
        <div class="card" style="margin-bottom:16px; border-color:var(--accent-blue);">
          <div class="card-header" style="margin-bottom:6px;">
            <div class="card-title">iPhone / 新裝置快速解鎖雲端同步</div>
          </div>
          <p class="text-muted" style="font-size:12px; margin-bottom:10px;">
            輸入您的 <strong>4 位數個人解鎖碼（預設：<code>2026</code>）</strong>，即可一鍵解鎖雲端連線並載入真實持股與資產（記憶後免重輸）：
          </p>
          <form id="form-quick-pair" style="display:flex; gap:8px; flex-wrap:wrap;">
            <input class="form-control" name="pairInput" placeholder="輸入 4 位解鎖碼 (2026) 或配對連結" style="flex:1; min-width:160px;" required />
            <button type="submit" class="btn btn-primary">一鍵解鎖</button>
          </form>
        </div>
      ` : ''}

      <!-- Clean Minimalist Executive KPI Banner (Clickable direct jumps) -->
      <div class="grid-kpi">
        <div class="card kpi-clickable" data-kpi-jump="asset:accounts:ALL" title="點擊進入家庭資產總覽">
          <div class="kpi-label">
            <span>個人總淨值 (F&S 含不動產扣負債)</span>
            <span class="pill">淨值 ↗</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(assetSum.netWorthTwd)}</div>
          <div class="kpi-sub mask-amount">金融資產 $${fmtInt(assetSum.totalFinancialAssetsTwd)} ｜ 目標 ${Number.isFinite(Number(assetSum.goalProgress)) ? (Number(assetSum.goalProgress) * 100).toFixed(1) + '%' : '—'}</div>
        </div>

        <div class="card kpi-clickable" data-kpi-jump="stock:holdings" title="點擊進入股票庫存持倉總覽">
          <div class="kpi-label">
            <span>N_BD_C 股票持倉總市值</span>
            <span class="pill">${stockSum.holdingCount} 檔 ↗</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(stockSum.totalMarketTwd)}</div>
          <div class="kpi-sub mask-amount ${stockSum.unrealizedTwd >= 0 ? 'text-emerald' : 'text-rose'}">
            未實現 ${stockSum.unrealizedTwd >= 0 ? '▲ +' : '▼ '}$${fmtInt(stockSum.unrealizedTwd)} (${fmtPct(stockSum.returnRate)})
          </div>
        </div>

        <div class="card kpi-clickable" data-kpi-jump="asset:accounts:流動資金" title="點擊檢視流動資金與儲蓄帳戶">
          <div class="kpi-label">
            <span>流動儲蓄 + 保障預備金</span>
            <span class="pill">${assetSum.accountCount} 帳戶 ↗</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(assetSum.liquidSavingsTwd + assetSum.protectionTwd)}</div>
          <div class="kpi-sub mask-amount">可動用儲蓄 $${fmtInt(assetSum.liquidSavingsTwd)}</div>
        </div>

        <div class="card kpi-clickable" data-kpi-jump="asset:salary" title="點擊進入歷年薪資與獎金追蹤">
          <div class="kpi-label">
            <span>${salData.latestAnnual?.year || 2026} 年度累計實領薪資 (N_薪資)</span>
            <span class="pill pill-emerald">▲ ${Number.isFinite(Number(salData.totalGrowthMultiple)) ? Number(salData.totalGrowthMultiple).toFixed(2) + 'x' : '—'} ↗</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(salData.latestAnnual?.annualSalary || 0)}</div>
          <div class="kpi-sub mask-amount">
            預估年薪 $${fmtInt(salData.latestAnnual?.estimatedAnnual || 0)} ｜ 待同步 ${queue.length} 筆
          </div>
        </div>
      </div>

      <!-- Section 1: Core Tool Modules -->
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header">
          <div class="card-title">核心工具模組與外部系統</div>
          <button class="btn btn-ghost btn-sm" id="btn-toggle-ext-tool">
            ${this.showAddExternal ? '✕ 取消新增' : '＋ 新增外部連結'}
          </button>
        </div>

        ${this.showAddExternal ? `
          <form id="form-add-ext" class="form-grid" style="margin-bottom:14px; padding:12px; background:var(--bg-subtle); border-radius:8px;">
            <input class="form-control" name="name" placeholder="工具名稱 (如 TradingView)" required />
            <input class="form-control" name="subtitle" placeholder="功能簡述" required />
            <input class="form-control" type="url" name="url" placeholder="https://..." required />
            <button type="submit" class="btn btn-primary">確認新增</button>
          </form>
        ` : ''}

        <div class="grid-3" style="margin-bottom:0;">
          <div class="tool-card" data-goto="stock-tracker">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-weight:700; font-size:15px;">股票庫存與風控配置</span>
                <span class="pill">N_BD_C</span>
              </div>
              <div class="text-muted" style="font-size:12.5px;">
                台美股 ${stockSum.holdingCount} 檔持倉、進攻/防禦/樂透雙層權重比較、分批明細與目標價估值。
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:8px; border-top:1px solid var(--border-color); font-size:12px; color:var(--accent-blue);">
              <span>進入股票庫存</span>
              <span>→</span>
            </div>
          </div>

          <div class="tool-card" data-goto="goodstock">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-weight:700; font-size:15px;">好股價選股與六大指標</span>
                <span class="pill">0050 + 持股</span>
              </div>
              <div class="text-muted" style="font-size:12.5px;">
                財務六大指標評分選股 (含較前月 MoM / 較前季 QoQ 比較)、7 大地雷、8 季財報與雙股 PK。
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:8px; border-top:1px solid var(--border-color); font-size:12px; color:var(--accent-blue);">
              <span>進入好股價選股</span>
              <span>→</span>
            </div>
          </div>

          <div class="tool-card" data-goto="twse-radar">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:6px;">
                <span style="font-weight:700; font-size:15px;">${radarSum.emoji} TWSE 減碼行動雷達</span>
                <span class="pill ${radarSum.level === 'red' ? 'pill-rose' : radarSum.level === 'yellow' || radarSum.level === 'defense' ? 'pill-amber' : 'pill-emerald'}">${radarSum.score}/${radarSum.maxScore}分 · ${radarSum.tomorrowPosPct}%</span>
              </div>
              <div class="text-muted" style="font-size:12.5px;">
                <strong>${radarSum.verdict}</strong>（${radarSum.date} · TAIEX ${Number(radarSum.close || 0).toLocaleString('zh-TW')} · ${radarSum.isReal ? radarSum.sourceName : '示範模擬'}）
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:8px; border-top:1px solid var(--border-color); font-size:12px; color:var(--accent-blue);">
              <span>進入台股避險戰情室</span>
              <span>→</span>
            </div>
          </div>

          <div class="tool-card" data-goto="asset-tracker">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-weight:700; font-size:15px;">家庭資產、分析圖與薪資</span>
                <span class="pill">F&S V2</span>
              </div>
              <div class="text-muted" style="font-size:12.5px;">
                ${assetSum.accountCount} 個帳戶一鍵對帳校正、長期淨值分析圖、N_薪資歷年薪資獎金追蹤與日常開銷。
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:8px; border-top:1px solid var(--border-color); font-size:12px; color:var(--accent-blue);">
              <span>進入家庭資產</span>
              <span>→</span>
            </div>
          </div>

          ${externalTools.map((ext) => `
            <div class="tool-card" data-ext-url="${ext.url}">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:6px;">
                  <span style="font-weight:700; font-size:15px;">${ext.name}</span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span class="pill">${ext.badge || '外部系統'}</span>
                    <button type="button" class="btn btn-ghost btn-sm" data-del-ext-id="${ext.id}" title="刪除此自訂連結（點擊兩次確認）" style="padding:2px 6px; font-size:11px;">✕</button>
                  </div>
                </div>
                <div class="text-muted" style="font-size:12.5px;">${ext.subtitle}</div>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; padding-top:8px; border-top:1px solid var(--border-color); font-size:12px; color:var(--text-secondary);">
                <span class="font-mono" style="font-size:11px; overflow:hidden; text-overflow:ellipsis;">${ext.url}</span>
                <span>↗ 開啟</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Section 2: Quick Snapshot Tables -->
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div class="card-title">核心持股部位速覽 (N_BD_C)</div>
            <button class="btn btn-ghost btn-sm" data-goto="stock-tracker">全部持倉 →</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  ${sortTh('code', '代號')}
                  <th>屬性</th>
                  ${sortTh('market', '市值 (TWD)', 'right')}
                  ${sortTh('pnl', '未實現損益', 'right')}
                  ${sortTh('roi', '報酬率', 'right')}
                </tr>
              </thead>
              <tbody>
                ${topHoldings.map((r) => {
                  const pnl = toNum(r['未實現(TWD)'], 0);
                  const roi = toRatio(r['報酬率']);
                  return `
                    <tr data-hub-stock="${r['代號']}" style="cursor:pointer;" title="點擊查看 ${r['代號']} 分批庫存明細">
                      <td class="font-mono" style="font-weight:700; color:var(--accent-blue);">${r['代號']}</td>
                      <td><span class="pill">${r['類型']}</span></td>
                      <td class="font-mono mask-amount" style="text-align:right;">$${fmtInt(r['市值(TWD)'])}</td>
                      <td class="font-mono mask-amount ${pnl >= 0 ? 'text-emerald' : 'text-rose'}" style="text-align:right; font-weight:600;">
                        ${pnl >= 0 ? '+' : ''}$${fmtInt(pnl)}
                      </td>
                      <td style="text-align:right;">
                        <span class="pill ${pnl >= 0 ? 'pill-emerald' : 'pill-rose'}">${pnl >= 0 ? '▲ ' : '▼ '}${fmtPct(roi)}</span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">快速連結與試算表直達</div>
            <button class="btn btn-ghost btn-sm" data-goto="settings">連線與同步設定 →</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px; font-size:13px; color:var(--text-secondary);">
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <a class="btn btn-ghost" href="https://docs.google.com/spreadsheets/d/18zTY4jjQ8Q1BRmqp_meYS24OOLE0GOkbn_56DWdwQrM/edit" target="_blank" rel="noopener">
                ↗ 開啟 N_BD_C 股票庫存試算表
              </a>
              <a class="btn btn-ghost" href="${FS_SHEET_URL}" target="_blank" rel="noopener">
                ↗ 開啟 F&S Asset Report_V2 試算表
              </a>
            </div>
            <div style="padding:10px 12px; background:var(--bg-subtle); border-radius:8px; border:1px solid var(--border-color); font-size:12px;">
              <div>• <strong>介面規範</strong>：全站統一採用美股慣例（<span class="text-emerald">綠漲 / 獲利 / 成長 ▲</span>、<span class="text-rose">紅跌 / 虧損 / 警示 ▼</span>），頂部可一鍵切換淺色與深色主題。</div>
              <div style="margin-top:4px;">• <strong>手機與電腦通用</strong>：所有表格皆支援點擊標題排序，且首欄於手機橫滑時自動凍結固定。</div>
            </div>
          </div>
        </div>
      </div>
    `;

    this._bindEvents(container, state, store, showToast);
  }

  _bindEvents(container, state, store, showToast) {
    container.querySelectorAll('[data-goto]').forEach((el) => {
      el.addEventListener('click', () => {
        const target = el.getAttribute('data-goto');
        if (typeof this.navigate === 'function') this.navigate(target);
      });
    });

    container.querySelectorAll('[data-hub-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-hub-sort');
        if (this.topSort.col === col) {
          this.topSort.dir = this.topSort.dir === 'desc' ? 'asc' : 'desc';
        } else {
          this.topSort.col = col;
          this.topSort.dir = col === 'code' ? 'asc' : 'desc';
        }
        this.render(container, store.getState(), store, showToast);
      });
    });

    container.querySelectorAll('[data-kpi-jump]').forEach((card) => {
      card.addEventListener('click', () => {
        const spec = card.getAttribute('data-kpi-jump') || '';
        const [kind, tab, attr] = spec.split(':');
        if (kind === 'stock') {
          if (window.NIC_Nav?.openStockDetail) window.NIC_Nav.openStockDetail(null, tab || 'holdings');
          else if (typeof this.navigate === 'function') this.navigate('stock-tracker');
        } else if (kind === 'asset') {
          if (window.NIC_Nav?.openAssetTab) window.NIC_Nav.openAssetTab(tab || 'accounts', attr ?? null);
          else if (typeof this.navigate === 'function') this.navigate('asset-tracker');
        }
      });
    });

    container.querySelectorAll('[data-hub-stock]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const sym = tr.getAttribute('data-hub-stock');
        if (window.NIC_Nav?.openStockDetail) {
          window.NIC_Nav.openStockDetail(sym, 'holdings');
        } else if (typeof this.navigate === 'function') {
          this.navigate('stock-tracker');
        }
      });
    });

    container.querySelectorAll('[data-del-ext-id]').forEach((btn) => {
      bindTwoStepConfirm(btn, {
        confirmText: '確認刪除？',
        timeoutMs: 3000,
        onConfirm: (e) => {
          e.stopPropagation();
          const delId = btn.getAttribute('data-del-ext-id');
          const cfg = store.getConfig();
          const nextList = (cfg.externalTools || []).filter((x) => String(x.id) !== String(delId));
          store.saveConfig({ externalTools: nextList });
          showToast('已刪除自訂外部連結');
          this.render(container, store.getState(), store, showToast);
        }
      });
    });

    container.querySelectorAll('[data-ext-url]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('[data-del-ext-id]')) return;
        const url = el.getAttribute('data-ext-url');
        window.open(url, '_blank', 'noopener');
      });
    });

    const toggleExtBtn = container.querySelector('#btn-toggle-ext-tool');
    if (toggleExtBtn) {
      toggleExtBtn.addEventListener('click', () => {
        this.showAddExternal = !this.showAddExternal;
        this.render(container, store.getState(), store, showToast);
      });
    }

    const quickPairForm = container.querySelector('#form-quick-pair');
    if (quickPairForm) {
      quickPairForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(quickPairForm);
        const ok = store.applyPairingInput(fd.get('pairInput'));
        if (ok) {
          showToast('配對成功！正在從雲端試算表載入您的真實資料...');
          this.render(container, store.getState(), store, showToast);
        } else {
          showToast('配對連結或解鎖碼格式不正確');
        }
      });
    }

    const addExtForm = container.querySelector('#form-add-ext');
    if (addExtForm) {
      addExtForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(addExtForm);
        const cfg = store.getConfig();
        const list = [...(cfg.externalTools || [])];
        list.push({
          id: 'ext-' + Date.now(),
          name: String(fd.get('name')).trim(),
          subtitle: String(fd.get('subtitle')).trim(),
          url: String(fd.get('url')).trim(),
          badge: '自訂連結',
          category: 'custom'
        });
        store.saveConfig({ externalTools: list });
        this.showAddExternal = false;
        showToast('已新增外部連結');
        this.render(container, store.getState(), store, showToast);
      });
    }
  }
}
