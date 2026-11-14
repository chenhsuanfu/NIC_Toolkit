import { StockCore } from '../stock-tracker/core.js';
import { AssetCore } from '../asset-tracker/core.js';

const fmtInt = (n) => Number(n || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const fmtPct = (n) => `${(Number(n || 0) * 100).toFixed(2)}%`;

export class HubUI {
  constructor(navigateFn) {
    this.navigate = navigateFn;
    this.showAddExternal = false;
  }

  render(container, state, store, showToast) {
    const stockSum = StockCore.getSummary(state);
    const assetSum = AssetCore.getSummary(state);
    const config = store.getConfig();
    const queue = store.getSyncQueue();

    const topHoldings = (state?.stock?.overview || []).slice(0, 5);
    const externalTools = config.externalTools || [];

    container.innerHTML = `
      <!-- Combined Executive KPI Banner -->
      <div class="grid-kpi">
        <div class="card" style="border-color: rgba(56, 189, 248, 0.35);">
          <div class="kpi-label">
            <span>個人總淨值 (含不動產扣負債)</span>
            <span class="pill pill-blue">F&S 總覽</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(assetSum.netWorthTwd)}</div>
          <div class="kpi-sub mask-amount">金融資產 $${fmtInt(assetSum.totalFinancialAssetsTwd)} ｜ 目標達成 ${(assetSum.goalProgress * 100).toFixed(1)}%</div>
        </div>

        <div class="card" style="border-color: rgba(16, 185, 129, 0.35);">
          <div class="kpi-label">
            <span>N_BD_C 股票持倉總市值</span>
            <span class="pill pill-emerald">${stockSum.holdingCount} 檔標的</span>
          </div>
          <div class="kpi-value mask-amount text-emerald">$${fmtInt(stockSum.totalMarketTwd)}</div>
          <div class="kpi-sub mask-amount">
            未實現 ${stockSum.unrealizedTwd >= 0 ? '+' : ''}$${fmtInt(stockSum.unrealizedTwd)} (${fmtPct(stockSum.returnRate)})
          </div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>流動現金 + 保障預備金</span>
            <span class="pill pill-purple">${assetSum.accountCount} 個銀行帳戶</span>
          </div>
          <div class="kpi-value mask-amount">$${fmtInt(assetSum.liquidSavingsTwd + assetSum.protectionTwd)}</div>
          <div class="kpi-sub mask-amount">隨時可動用儲蓄 $${fmtInt(assetSum.liquidSavingsTwd)}</div>
        </div>

        <div class="card">
          <div class="kpi-label">
            <span>系統運行與同步狀態</span>
            <span class="pill ${config.mode === 'cloud' ? 'pill-emerald' : 'pill-amber'}">
              ${config.mode === 'cloud' ? '雲端同步模式' : '本機安全沙盒'}
            </span>
          </div>
          <div class="kpi-value" style="font-size:18px; margin-top:4px;">
            ⚡ 0.05s 極速快取就緒
          </div>
          <div class="kpi-sub">
            待同步變更：<strong>${queue.length} 筆</strong>
            ${state?.isDemoSeed ? ' (Demo 預設資料)' : ' (已載入真實試算表快照)'}
          </div>
        </div>
      </div>

      <!-- Section 1: Built-in Core Tools & External Quant Portal Wall -->
      <div class="card" style="margin-bottom:22px;">
        <div class="card-header">
          <div class="card-title">🧰 個人工具集啟動牆（支援內建模組 & 外部量化系統插拔）</div>
          <button class="btn btn-ghost btn-sm" id="btn-toggle-ext-tool">
            ${this.showAddExternal ? '✕ 取消新增' : '＋ 掛載新外部工具連結'}
          </button>
        </div>

        ${this.showAddExternal ? `
          <form id="form-add-ext" class="form-grid" style="margin-bottom:16px; padding:14px; background:rgba(255,255,255,0.03); border-radius:12px;">
            <input class="form-control" name="name" placeholder="工具名稱 (如 TradingView / FinMind)" required />
            <input class="form-control" name="subtitle" placeholder="功能簡述 (如 技術線圖與籌碼分析)" required />
            <input class="form-control" type="url" name="url" placeholder="https://..." required />
            <button type="submit" class="btn btn-primary">✓ 確認掛載至工具牆</button>
          </form>
        ` : ''}

        <div class="grid-3" style="margin-bottom:0;">
          <!-- Built-in Tool 1 -->
          <div class="tool-card" data-goto="stock-tracker">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-size:24px;">📈</span>
                <span class="pill pill-emerald">內建核心模組 · N_BD_C</span>
              </div>
              <div style="font-weight:700; font-size:16px; margin-bottom:4px;">股票庫存與目標價估值</div>
              <div class="text-muted" style="font-size:13px;">
                管理台美股 ${stockSum.holdingCount} 檔持倉、防禦/進攻/樂透風控配置、進出場紀錄，內建「好股價 EPS 目標價推估引擎」。
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:10px; border-top:1px solid var(--border-color); font-size:12px; color:var(--accent-blue);">
              <span>立即進入操作</span>
              <span>→</span>
            </div>
          </div>

          <!-- Built-in Tool 2 -->
          <div class="tool-card" data-goto="asset-tracker">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-size:24px;">🏦</span>
                <span class="pill pill-blue">內建核心模組 · F&S V2</span>
              </div>
              <div style="font-weight:700; font-size:16px; margin-bottom:4px;">資產與日常收支紀錄</div>
              <div class="text-muted" style="font-size:13px;">
                跨幣別 ${assetSum.accountCount} 個銀行/券商帳戶總覽、消費主子類別自動連動記帳、log_V2 流水與房貸信貸處置追蹤。
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:10px; border-top:1px solid var(--border-color); font-size:12px; color:var(--accent-blue);">
              <span>立即進入記帳</span>
              <span>→</span>
            </div>
          </div>

          <!-- External Connected Portals (MVP-QAS, GoodStockPrice, etc.) -->
          ${externalTools.map((ext) => `
            <div class="tool-card" data-ext-url="${ext.url}">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                  <span style="font-size:24px;">🚀</span>
                  <span class="pill pill-purple">${ext.badge || '外部連動系統'}</span>
                </div>
                <div style="font-weight:700; font-size:16px; margin-bottom:4px;">${ext.name}</div>
                <div class="text-muted" style="font-size:13px;">${ext.subtitle}</div>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; padding-top:10px; border-top:1px solid var(--border-color); font-size:12px; color:var(--accent-amber);">
                <span class="font-mono" style="font-size:11px;">${ext.url}</span>
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
            <div class="card-title">🔥 前五大核心持股部位 (N_BD_C)</div>
            <button class="btn btn-ghost btn-sm" data-goto="stock-tracker">查看全部 →</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>代號</th>
                  <th>類型</th>
                  <th>市值 (TWD)</th>
                  <th>未實現損益</th>
                  <th>報酬率</th>
                </tr>
              </thead>
              <tbody>
                ${topHoldings.map((r) => {
                  const pnl = Number(r['未實現(TWD)'] || 0);
                  const roi = Number(r['報酬率'] || 0);
                  return `
                    <tr>
                      <td class="font-mono" style="font-weight:700;">${r['代號']}</td>
                      <td><span class="pill pill-blue">${r['類型']}</span></td>
                      <td class="font-mono mask-amount">$${fmtInt(r['市值(TWD)'])}</td>
                      <td class="font-mono mask-amount ${pnl >= 0 ? 'text-emerald' : 'text-rose'}">${pnl >= 0 ? '+' : ''}$${fmtInt(pnl)}</td>
                      <td><span class="pill ${pnl >= 0 ? 'pill-emerald' : 'pill-rose'}">${fmtPct(roi)}</span></td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🤖 人機雙軌架構狀態 (Human-to-Agent Ready)</div>
            <button class="btn btn-ghost btn-sm" data-goto="settings">開啟 Agent 控制台 →</button>
          </div>
          <div style="font-size:13px; color:var(--text-secondary); display:flex; flex-direction:column; gap:10px;">
            <p>
              本平台已完成 <strong>UI 介面層</strong> 與 <strong>Core 純業務邏輯層</strong> 100% 解耦：
            </p>
            <div style="background:var(--bg-input); padding:12px; border-radius:8px; border:1px solid var(--border-color);" class="font-mono">
              <div style="color:var(--accent-blue);">// 瀏覽器或 AI Agent 可直接無頭呼叫：</div>
              <div>await window.NIC_Agent.invoke("stock-tracker", "getSummary")</div>
              <div>await window.NIC_Agent.invoke("asset-tracker", "addExpense", { amount: 150, category: "餐費", title: "午餐" })</div>
            </div>
            <p>
              • <strong>iPhone / 電腦人工操作</strong>：透過上方卡片與底部導覽列 0 秒切換。<br/>
              • <strong>未來 AI Agent / iOS 捷徑接管</strong>：透過標準 JSON Schema 與 CLI 腳本直接自動化讀寫。
            </p>
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

    container.querySelectorAll('[data-ext-url]').forEach((el) => {
      el.addEventListener('click', () => {
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
          badge: '自訂外部工具',
          category: 'custom'
        });
        store.saveConfig({ externalTools: list });
        this.showAddExternal = false;
        showToast('✅ 已將新工具掛載至首頁工具牆！');
        this.render(container, store.getState(), store, showToast);
      });
    }
  }
}
