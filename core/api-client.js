import { store } from './store.js';

/**
 * Cloud Sync Client for Google Apps Script (GAS) Unified JSON API
 * Strictly adheres to Zero-Secret & Token-Verified Append-Only architecture.
 */
export class GasApiClient {
  static getCredentials() {
    const cfg = store.getConfig();
    return {
      gasUrl: (cfg.gasUrl || '').trim(),
      apiToken: (cfg.apiToken || '').trim(),
      mode: cfg.mode || 'sandbox'
    };
  }

  static isConfigured() {
    const { gasUrl, apiToken } = this.getCredentials();
    return Boolean(gasUrl && apiToken);
  }

  /**
   * Generate a 1-click pairing URL for iPhone / secondary devices
   */
  static generatePairingUrl() {
    const { gasUrl, apiToken, mode } = this.getCredentials();
    const payload = btoa(JSON.stringify({ gasUrl, apiToken, mode }));
    const base = window.location.origin + window.location.pathname;
    return `${base}?pair=${encodeURIComponent(payload)}`;
  }

  /**
   * Pull latest snapshot from Google Sheets (via GAS CacheService / SpreadsheetApp)
   */
  static async pullSnapshot(forceRefresh = false) {
    const { gasUrl, apiToken } = this.getCredentials();
    if (!gasUrl || !apiToken) {
      throw new Error('尚未設定 Google Apps Script API 網址或通行金鑰 (API Token)');
    }

    const url = new URL(gasUrl);
    url.searchParams.set('action', 'snapshot');
    url.searchParams.set('token', apiToken);
    if (forceRefresh) url.searchParams.set('refresh', '1');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!res.ok) {
      throw new Error(`雲端回應錯誤 (HTTP ${res.status})`);
    }

    const json = await res.json();
    if (!json.ok) {
      throw new Error(json.error || '驗證失敗或試算表讀取錯誤');
    }

    store.replaceStateFromCloud(json.data);
    return json.data;
  }

  /**
   * Push queued local mutations to Google Sheets (Append-Only to protect formulas)
   */
  static async pushPendingQueue() {
    const { gasUrl, apiToken, mode } = this.getCredentials();
    const queue = store.getSyncQueue();

    if (queue.length === 0) {
      return { syncedCount: 0, message: '目前沒有待同步的變更' };
    }

    if (mode !== 'cloud') {
      throw new Error('目前處於「本機沙盒模式」，請先至「設定與同步」切換為「正式雲端同步模式」再寫入原試算表。');
    }

    if (!gasUrl || !apiToken) {
      throw new Error('尚未設定 Google Apps Script API 網址或通行金鑰');
    }

    // GAS web apps accept text/plain POST body cleanly without CORS preflight blocks
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'batchMutate',
        token: apiToken,
        mutations: queue
      })
    });

    if (!res.ok) {
      throw new Error(`同步請求失敗 (HTTP ${res.status})`);
    }

    const json = await res.json();
    if (!json.ok) {
      throw new Error(json.error || '雲端寫入失敗');
    }

    const syncedIds = json.syncedIds || queue.map((q) => q.id);
    store.markQueueSynced(syncedIds);
    return { syncedCount: syncedIds.length, details: json };
  }
}
