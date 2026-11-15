import { GasApiClient } from '../../core/api-client.js';
import { agentBridge } from '../../core/agent-bridge.js';

export class SettingsUI {
  constructor() {
    this.agentOutput = '';
    this.pairingUrl = '';
  }

  render(container, state, store, showToast) {
    const cfg = store.getConfig();
    const queue = store.getSyncQueue();
    const syncStatus = store.getSyncStatus ? store.getSyncStatus() : { state: 'idle', lastError: null };
    const manifest = agentBridge.getManifest();
    const appVer = (typeof window !== 'undefined' && window.NIC_APP_VERSION) || 'v14';

    if (!this.agentOutput) {
      this.agentOutput = JSON.stringify(manifest, null, 2);
    }

    container.innerHTML = `
      <div class="grid-2">
        <!-- Left: Mode Switcher & Google Sheets GAS Pairing -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">🔐 資料存放模式與 Google Sheets 連線設定</div>
            <span class="pill ${cfg.mode === 'cloud' ? 'pill-emerald' : 'pill-amber'}">
              ${cfg.mode === 'cloud' ? '正式雲端同步模式' : '本機安全沙盒模式'}
            </span>
          </div>
          <p class="text-muted" style="font-size:13px; margin-bottom:14px;">
            • <strong>本機安全沙盒模式（預設）</strong>：已預載您 <code>N_BD_C</code> 與 <code>F&S Asset Report_V2</code> 的真實快照，所有新增買賣與記帳僅存於本機快取，<strong>100% 不會改動雲端原試算表</strong>，供您安心測試。<br/>
            • <strong>正式雲端同步模式</strong>：綁定 Google Apps Script 網址與專屬金鑰後，即可將待同步佇列以「只追加明細、保護既有公式」方式寫回您原本的兩份試算表。
          </p>

          <form id="form-save-config" style="display:flex; flex-direction:column; gap:12px;">
            <div class="form-group">
              <label class="form-label">運作模式切換</label>
              <select class="form-control" name="mode">
                <option value="sandbox" ${cfg.mode === 'sandbox' ? 'selected' : ''}>🛡️ 本機安全沙盒模式 (僅讀寫本機快取，不影響雲端原檔)</option>
                <option value="cloud" ${cfg.mode === 'cloud' ? 'selected' : ''}>☁️ 正式雲端同步模式 (同步寫入 N_BD_C 與 F&S Asset Report_V2)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Google Apps Script (GAS) 網頁應用程式網址</label>
              <input class="form-control font-mono" name="gasUrl" placeholder="https://script.google.com/macros/s/.../exec" value="${cfg.gasUrl || ''}" />
            </div>
            <div class="form-group">
              <label class="form-label">個人專屬通行金鑰 (API Secret Token)</label>
              <input class="form-control font-mono" type="password" name="apiToken" placeholder="輸入您自訂的私密 Token" value="${cfg.apiToken || ''}" />
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;">
              <button type="submit" class="btn btn-primary">💾 儲存連線設定</button>
              <button type="button" class="btn btn-ghost" id="btn-gen-pair">📱 產生 iPhone 一鍵配對連結</button>
            </div>
          </form>

          ${this.pairingUrl ? `
            <div style="margin-top:14px; padding:12px; background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.3); border-radius:10px;">
              <div style="font-size:12px; font-weight:700; color:var(--accent-blue); margin-bottom:6px;">
                📱 iPhone 免輸入一鍵配對連結（於 iPhone Safari 開啟此連結即自動完成綁定）：
              </div>
              <input class="form-control font-mono" style="font-size:12px;" readonly value="${this.pairingUrl}" onclick="this.select()" />
            </div>
          ` : ''}
        </div>

        <!-- Right: Local-First Cache & Sync Queue Manager -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">⚡ Local-First 快取與待同步佇列 (${queue.length} 筆)</div>
            <span class="text-muted" style="font-size:12px;">上次同步：${cfg.lastSyncAt ? cfg.lastSyncAt.slice(0, 19).replace('T', ' ') : '尚未雲端同步'}</span>
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
            <button class="btn btn-primary" id="btn-settings-pwa-update">🚀 手機 PWA 強制更新至最新版 (${appVer})</button>
            <button class="btn btn-emerald" id="btn-push-queue" ${syncStatus.state === 'syncing' ? 'disabled' : ''}>
              ${syncStatus.state === 'syncing' ? '⏳ 正在推送至雲端...' : `☁️ 立即推送佇列至 Google Sheets (${queue.length})`}
            </button>
            <button class="btn btn-ghost" id="btn-pull-cloud">🔄 從雲端拉取最新試算表快照</button>
            <button class="btn btn-ghost" id="btn-export-json">📥 匯出本機完整 JSON 備份</button>
            <button class="btn btn-ghost" id="btn-reset-snapshot">♻️ 重設回初始試算表快照</button>
          </div>

          ${syncStatus.state === 'error' && syncStatus.lastError ? `
            <div style="margin-bottom:12px; padding:10px 12px; background:rgba(244,63,94,0.12); border:1px solid rgba(244,63,94,0.35); border-radius:8px; font-size:12px; color:var(--text-primary);">
              <strong>⚠️ 上次雲端同步失敗：</strong>${syncStatus.lastError}
            </div>
          ` : ''}

          <p class="text-muted" style="font-size:12px; margin-bottom:10px;">
            ${cfg.mode === 'cloud'
              ? '✅ 已啟用自動背景同步：任何權重調整、買賣或記帳將於約 1 秒後自動寫入 Google Sheets；切回此分頁時也會自動拉取他裝置更新。'
              : '🛡️ 目前為本機沙盒模式：變更僅保留於待同步佇列，切換為「正式雲端同步模式」後即會自動同步。'}
          </p>

          <div class="table-wrap" style="max-height:240px; overflow-y:auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>動作類型</th>
                  <th>摘要內容</th>
                </tr>
              </thead>
              <tbody>
                ${queue.length === 0 ? `
                  <tr><td colspan="3" class="text-muted" style="text-align:center; padding:20px;">目前無待同步變更（本機新增買賣或記帳後會顯示於此）</td></tr>
                ` : queue.slice().reverse().map((q) => `
                  <tr>
                    <td class="font-mono" style="font-size:11px;">${q.timestamp.slice(11, 19)}</td>
                    <td><span class="pill pill-blue">${q.type}</span></td>
                    <td class="font-mono" style="font-size:11px;">${JSON.stringify(q.payload).slice(0, 65)}...</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- AI Agent Headless Console (Human-to-Agent Dual-Track Verification) -->
      <div class="card" style="margin-top:16px;">
        <div class="card-header" style="flex-wrap:wrap;">
          <div class="card-title">AI Agent 無頭調用測試台 (Headless Function Calling & JSON Schema)</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-ghost btn-sm" data-agent-cmd="manifest">1. 檢視工具 JSON Schema</button>
            <button class="btn btn-ghost btn-sm" data-agent-cmd="stock-summary">2. 測試 Agent 讀取股票總覽</button>
            <button class="btn btn-ghost btn-sm" data-agent-cmd="asset-summary">3. 測試 Agent 讀取資產淨值</button>
            <button class="btn btn-ghost btn-sm" data-agent-cmd="val-calc">4. 測試 Agent 推算台積電好股價</button>
          </div>
        </div>
        <pre class="font-mono" style="background:var(--bg-input); padding:14px; border-radius:8px; border:1px solid var(--border-color); font-size:12px; max-height:320px; overflow:auto; color:var(--text-primary);">${this.agentOutput}</pre>
      </div>
    `;

    this._bindEvents(container, state, store, showToast);
  }

  _bindEvents(container, state, store, showToast) {
    const cfgForm = container.querySelector('#form-save-config');
    if (cfgForm) {
      cfgForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(cfgForm);
        store.saveConfig({
          mode: fd.get('mode'),
          gasUrl: String(fd.get('gasUrl') || '').trim(),
          apiToken: String(fd.get('apiToken') || '').trim()
        });
        showToast('✅ 已儲存運作模式與連線設定！');
        this.render(container, store.getState(), store, showToast);
      });
    }

    const pairBtn = container.querySelector('#btn-gen-pair');
    if (pairBtn) {
      pairBtn.addEventListener('click', () => {
        const fd = new FormData(cfgForm);
        store.saveConfig({
          mode: fd.get('mode'),
          gasUrl: String(fd.get('gasUrl') || '').trim(),
          apiToken: String(fd.get('apiToken') || '').trim()
        });
        this.pairingUrl = GasApiClient.generatePairingUrl();
        showToast('📱 已產生 iPhone 一鍵配對連結！');
        this.render(container, store.getState(), store, showToast);
      });
    }

    const pushBtn = container.querySelector('#btn-push-queue');
    const pwaUpdateBtn = container.querySelector('#btn-settings-pwa-update');
    if (pwaUpdateBtn) {
      pwaUpdateBtn.addEventListener('click', (e) => {
        if (window.NIC_ForceUpdatePWA) {
          window.NIC_ForceUpdatePWA(e.currentTarget);
        } else {
          window.location.reload();
        }
      });
    }
    if (pushBtn) {
      pushBtn.addEventListener('click', async () => {
        const curQueue = store.getSyncQueue();
        if (curQueue.length === 0) {
          showToast('目前沒有待同步的變更');
          return;
        }
        pushBtn.disabled = true;
        pushBtn.textContent = '⏳ 正在推送至雲端...';
        showToast(`☁️ 正在推送 ${curQueue.length} 筆變更至 Google Sheets...`);
        try {
          const res = await GasApiClient.pushPendingQueue();
          if (res.syncedCount > 0) {
            showToast(`☁️ 同步成功！已寫入 ${res.syncedCount} 筆變更至 Google Sheets`);
          } else {
            showToast(res.message || '目前沒有待同步的變更');
          }
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
          this.render(container, store.getState(), store, showToast);
        }
      });
    }

    const pullBtn = container.querySelector('#btn-pull-cloud');
    if (pullBtn) {
      pullBtn.addEventListener('click', async () => {
        try {
          showToast('🔄 正在從 Google Sheets 拉取最新快照...');
          await GasApiClient.pullSnapshot(true);
          showToast('✅ 已成功更新本機快取！');
          this.render(container, store.getState(), store, showToast);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
      });
    }

    const exportBtn = container.querySelector('#btn-export-json');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(store.getState(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `NIC_Toolkit_Backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('📥 已匯出本機 JSON 備份檔');
      });
    }

    const resetBtn = container.querySelector('#btn-reset-snapshot');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        await store.resetToInitialSnapshot();
        showToast('♻️ 已重設回試算表初始快照並清空待同步佇列');
        this.render(container, store.getState(), store, showToast);
      });
    }

    container.querySelectorAll('[data-agent-cmd]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cmd = btn.getAttribute('data-agent-cmd');
        let res;
        if (cmd === 'manifest') {
          res = agentBridge.getManifest();
        } else if (cmd === 'stock-summary') {
          res = await agentBridge.invoke('stock-tracker', 'getSummary', {});
        } else if (cmd === 'asset-summary') {
          res = await agentBridge.invoke('asset-tracker', 'getSummary', {});
        } else if (cmd === 'val-calc') {
          res = await agentBridge.invoke('stock-tracker', 'estimateTargetPrice', {
            baseRevenue: 28943,
            growthRatePct: 25,
            netMarginPct: 43,
            shareCapital: 259.3,
            isTwStock: true,
            targetPe: 22
          });
        }
        this.agentOutput = JSON.stringify(res, null, 2);
        this.render(container, store.getState(), store, showToast);
      });
    });
  }
}
