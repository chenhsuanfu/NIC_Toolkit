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
    const obj = { gasUrl, apiToken, mode };
    try {
      const raw = localStorage.getItem('nic_twse_radar_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        const radarFrag = {};
        if (parsed?.finmindToken) radarFrag.t = parsed.finmindToken;
        if (parsed?.params) radarFrag.p = parsed.params;
        if (Object.keys(radarFrag).length) obj.radar = radarFrag;
      }
    } catch (_) {}
    const payload = btoa(JSON.stringify(obj));
    const base = window.location.origin + window.location.pathname;
    return `${base}?pair=${encodeURIComponent(payload)}`;
  }

  /**
   * Pull latest snapshot from Google Sheets (via GAS CacheService / SpreadsheetApp)
   */
  static async pullSnapshot(forceRefresh = false) {
    const { gasUrl, apiToken, mode } = this.getCredentials();
    if (!gasUrl || !apiToken) {
      throw new Error('尚未設定 Google Apps Script API 網址或通行金鑰 (API Token)');
    }

    if (mode === 'cloud' && store.getSyncQueue().length > 0) {
      await store.pushPendingQueue({ silent: false });
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
    return store.pushPendingQueue({ silent: false });
  }
}
