import { SEED_DATA } from './seed-data.js';
import { VAULT_B64 } from './vault-data.js';

const STORAGE_KEY = 'nic_toolkit_state_v1';
const CONFIG_KEY = 'nic_toolkit_config_v1';
const QUEUE_KEY = 'nic_toolkit_sync_queue_v1';
const COOKIE_CFG_KEY = 'nic_tk_cfg';

class LocalFirstStore {
  constructor() {
    this.listeners = new Set();
    this.state = null;
    this.baselineLots = null;
    this.config = this._loadConfig();
    this.syncQueue = this._loadQueue();
    this.initialized = false;
  }

  _decryptVault(pin = '2026') {
    try {
      const cipherStr = atob(VAULT_B64);
      const keyBytes = new TextEncoder().encode(String(pin).trim());
      const plainBytes = new Uint8Array(cipherStr.length);
      for (let i = 0; i < cipherStr.length; i++) {
        plainBytes[i] = cipherStr.charCodeAt(i) ^ keyBytes[i % keyBytes.length];
      }
      const plainText = new TextDecoder().decode(plainBytes);
      if (plainText.startsWith('{"gasUrl":"https://')) {
        return JSON.parse(plainText);
      }
    } catch (_) {}
    return null;
  }

  _getBaselineLots() {
    if (this.baselineLots) return this.baselineLots;
    if (!this.config?.apiToken && !this.config?.gasUrl) return [];
    const vault = this._decryptVault('2026');
    if (vault && Array.isArray(vault.openLots)) {
      this.baselineLots = vault.openLots.map((r) => ({
        id: r[0] || '',
        '建立時間': r[1] || '',
        '類型': r[2] || '進攻型',
        '市場': r[3] || 'US',
        '券商': r[4] || 'F',
        '代號': r[5] || '',
        '進場日': r[6] || '',
        '進場價': r[7] || '0',
        '進場股數': r[8] || '0',
        '備註': r[9] || ''
      }));
      return this.baselineLots;
    }
    return [];
  }

  _loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    try {
      const match = document.cookie.split('; ').find((row) => row.startsWith(COOKIE_CFG_KEY + '='));
      if (match) {
        const parsed = JSON.parse(decodeURIComponent(match.split('=')[1]));
        if (parsed && parsed.gasUrl) {
          localStorage.setItem(CONFIG_KEY, JSON.stringify(parsed));
          return parsed;
        }
      }
    } catch (_) {}
    return {
      mode: 'sandbox', // 'sandbox' (本機安全沙盒) | 'cloud' (正式同步 Google Sheets)
      gasUrl: '',
      apiToken: '',
      privacyMask: false,
      lastSyncAt: null,
      externalTools: [
        {
          id: 'ext-mvp-qas',
          name: 'MVP 量化分析系統',
          subtitle: '美股價值投資 · 量化觀察 (CNN F&G / 估值錨點)',
          url: 'https://mvp-qas.com/',
          badge: '外部系統',
          category: 'quant'
        },
        {
          id: 'ext-goodstock',
          name: '好股價 GoodStockPrice',
          subtitle: '台股財務雙箭頭選股 · EPS 目標價推估 · 健診回測',
          url: 'https://goodstockprice.com/',
          badge: '外部系統',
          category: 'quant'
        }
      ]
    };
  }

  _loadQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return [];
  }

  saveConfig(partial) {
    this.config = { ...this.config, ...partial };
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    } catch (_) {}
    try {
      if (this.config.gasUrl) {
        const cookiePayload = encodeURIComponent(JSON.stringify({
          mode: this.config.mode,
          gasUrl: this.config.gasUrl,
          apiToken: this.config.apiToken
        }));
        document.cookie = `${COOKIE_CFG_KEY}=${cookiePayload}; max-age=31536000; path=/; SameSite=Lax`;
      }
    } catch (_) {}
    this._notify();
  }

  async init() {
    if (this.initialized) return this.state;

    // 1. Check URL for 1-click iPhone pairing payload (?pair=...)
    this._checkUrlPairing();

    // 2. Instant read from localStorage (< 0.01s)
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        this.state = this._normalizeSnapshot(JSON.parse(cached));
        this.initialized = true;
        this._notify();
        // Background refresh: if demo seed, try local snapshot or cloud GAS snapshot
        if (this.state.isDemoSeed) {
          const okLocal = await this._tryLoadLocalSnapshot();
          if (!okLocal && this.config.gasUrl && this.config.apiToken) {
            this.pullFromCloudSilently();
          }
        } else if (this.config.gasUrl && this.config.apiToken) {
          // Stale-While-Revalidate: already rendered in 0.01s, silently revalidate in background
          this.pullFromCloudSilently();
        }
        return this.state;
      }
    } catch (_) {}

    // 3. First-time hydration: try local-snapshot.json, then cloud GAS if paired, fallback to SEED_DATA
    const loadedSnapshot = await this._tryLoadLocalSnapshot();
    if (!loadedSnapshot) {
      this.state = structuredClone(SEED_DATA);
      this._persistState();
      if (this.config.gasUrl && this.config.apiToken) {
        this.pullFromCloudSilently();
      }
    }

    this.initialized = true;
    this._notify();
    return this.state;
  }

  async pullFromCloudSilently(forceRefresh = false) {
    if (!this.config.gasUrl || !this.config.apiToken) return false;
    try {
      const url = new URL(this.config.gasUrl);
      url.searchParams.set('action', 'snapshot');
      url.searchParams.set('token', this.config.apiToken);
      if (forceRefresh) url.searchParams.set('refresh', '1');
      const res = await fetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (!res.ok) return false;
      const json = await res.json();
      if (json && json.ok && json.data) {
        this.replaceStateFromCloud(json.data);
        return true;
      }
    } catch (_) {}
    return false;
  }

  async _tryLoadLocalSnapshot() {
    try {
      const res = await fetch('./data/local-snapshot.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        data.isDemoSeed = false;
        this.state = this._normalizeSnapshot(data);
        this._persistState();
        this._notify();
        return true;
      }
    } catch (_) {}
    return false;
  }

  _normalizeSnapshot(raw) {
    const cleanCellVal = (key, val) => {
      if (typeof val !== 'string') return val;
      const s = val.trim();
      if (!s) return s;
      // Do not touch list settings (e.g. "B, S, F, C")
      if (key === '值' || key === '券商分佈' || key === '備註' || key === '名目') return s;
      // Convert formatted percentage strings (e.g. "48.08%", "-4.01%") to ratio string ("0.4808") unless column is explicitly a % number like "利率%"
      if (/^[+-]?\s*\d[\d,]*(?:\.\d+)?\s*%$/.test(s)) {
        const num = parseFloat(s.replace(/[,%\s]/g, ''));
        if (Number.isFinite(num)) {
          return key.includes('%') ? String(num) : String(num / 100);
        }
      }
      // Convert currency/comma formatted numbers (e.g. "100,000", "1,580.20", "$327,424", "NT$100,000")
      if (/^[+-]?\s*(?:NT\$|US\$|\$)?\s*[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/i.test(s)) {
        return s.replace(/(?:NT\$|US\$|[$,\s])/gi, '');
      }
      return s;
    };
    const ensureArr = (v) => {
      let arr = [];
      if (Array.isArray(v)) arr = v;
      else if (v && typeof v === 'object' && Object.keys(v).length > 0) arr = [v];
      return arr.map((row) => {
        if (!row || typeof row !== 'object') return row;
        const out = {};
        for (const [k, val] of Object.entries(row)) {
          out[k] = cleanCellVal(k, val);
        }
        return out;
      });
    };
    const rawTrades = ensureArr(raw.stock?.recentTrades);
    const baseline = this._getBaselineLots();
    let mergedTrades = rawTrades;
    if (baseline.length > 0) {
      const map = new Map();
      for (const b of baseline) {
        if (b.id) map.set(String(b.id), b);
      }
      for (const t of rawTrades) {
        if (t.id) map.set(String(t.id), t);
      }
      mergedTrades = Array.from(map.values());
    }
    const rawSettings = ensureArr(raw.stock?.settings);
    const prevWeightRow = (this.state?.stock?.settings || []).find((r) => r['項目'] === '目標權重JSON');
    if (prevWeightRow && !rawSettings.some((r) => r['項目'] === '目標權重JSON')) {
      rawSettings.push(prevWeightRow);
    }
    return {
      generatedAt: raw.generatedAt || new Date().toISOString(),
      isDemoSeed: Boolean(raw.isDemoSeed),
      stock: {
        settings: rawSettings,
        fx: ensureArr(raw.stock?.fx),
        overview: ensureArr(raw.stock?.overview),
        risk: ensureArr(raw.stock?.risk),
        watchlist: ensureArr(raw.stock?.watchlist),
        dailySnapshots: ensureArr(raw.stock?.dailySnapshots),
        recentTrades: mergedTrades,
        recentExits: ensureArr(raw.stock?.recentExits)
      },
      asset: {
        settings: ensureArr(raw.asset?.settings),
        fx: ensureArr(raw.asset?.fx),
        accounts: ensureArr(raw.asset?.accounts),
        debts: ensureArr(raw.asset?.debts),
        recentLogs: ensureArr(raw.asset?.recentLogs),
        recentExpenses: ensureArr(raw.asset?.recentExpenses),
        snapshots: ensureArr(raw.asset?.snapshots),
        salaryHistory: ensureArr(raw.asset?.salaryHistory),
        cashflowHistory: ensureArr(raw.asset?.cashflowHistory)
      }
    };
  }

  _checkUrlPairing(rawUrl = window.location.search) {
    try {
      const queryStr = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : rawUrl;
      const params = new URLSearchParams(queryStr);
      const pairCode = params.get('pair');
      if (pairCode) {
        const decoded = JSON.parse(atob(decodeURIComponent(pairCode)));
        if (decoded.gasUrl || decoded.apiToken) {
          this.saveConfig({
            gasUrl: decoded.gasUrl || '',
            apiToken: decoded.apiToken || '',
            mode: decoded.mode || 'cloud'
          });
          // Only strip URL in standalone mode so iOS Safari "Add to Home Screen" keeps ?pair=...
          const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
          if (isStandalone && rawUrl === window.location.search) {
            const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
            window.history.replaceState({}, document.title, cleanUrl);
          }
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  applyPairingInput(inputStr) {
    const trimmed = String(inputStr || '').trim();
    if (!trimmed) return false;
    // 1. Try unlocking built-in encrypted personal vault via short PIN (e.g. "2026")
    const vaultObj = this._decryptVault(trimmed);
    if (vaultObj && vaultObj.gasUrl) {
      this.saveConfig({
        gasUrl: vaultObj.gasUrl,
        apiToken: vaultObj.apiToken,
        mode: 'cloud'
      });
      if (this.state) {
        this.state = this._normalizeSnapshot(this.state);
        this._persistState();
        this._notify();
      }
      this.pullFromCloudSilently(true);
      return true;
    }

    // 2. Fallback: full ?pair= URL or base64 string
    if (trimmed.includes('pair=')) {
      const ok = this._checkUrlPairing(trimmed);
      if (ok) this.pullFromCloudSilently(true);
      return ok;
    }
    try {
      const decoded = JSON.parse(atob(decodeURIComponent(trimmed)));
      if (decoded.gasUrl || decoded.apiToken) {
        this.saveConfig({
          gasUrl: decoded.gasUrl || '',
          apiToken: decoded.apiToken || '',
          mode: decoded.mode || 'cloud'
        });
        this.pullFromCloudSilently(true);
        return true;
      }
    } catch (_) {}
    return false;
  }

  _persistState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (_) {}
  }

  _persistQueue() {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(this.syncQueue));
    } catch (_) {}
  }

  getState() {
    return this.state;
  }

  getConfig() {
    return this.config;
  }

  getSyncQueue() {
    return this.syncQueue;
  }

  /**
   * Optimistic UI Update + Enqueue Mutation for Google Sheets / Agent Sync
   */
  mutate(mutationType, payload, updaterFn) {
    if (typeof updaterFn === 'function') {
      updaterFn(this.state);
    }
    const mutationRecord = {
      id: (crypto.randomUUID ? crypto.randomUUID() : 'mut-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
      timestamp: new Date().toISOString(),
      type: mutationType,
      payload,
      synced: false
    };
    this.syncQueue.push(mutationRecord);
    this._persistState();
    this._persistQueue();
    this._notify();
    return mutationRecord;
  }

  markQueueSynced(ids = []) {
    const idSet = new Set(ids);
    this.syncQueue = this.syncQueue.filter((item) => !idSet.has(item.id));
    this.saveConfig({ lastSyncAt: new Date().toISOString() });
    this._persistQueue();
    this._notify();
  }

  clearQueue() {
    this.syncQueue = [];
    this._persistQueue();
    this._notify();
  }

  replaceStateFromCloud(cloudData) {
    this.state = this._normalizeSnapshot(cloudData);
    this.state.isDemoSeed = false;
    this.saveConfig({ lastSyncAt: new Date().toISOString() });
    this._persistState();
    this._notify();
  }

  async resetToInitialSnapshot() {
    localStorage.removeItem(STORAGE_KEY);
    this.clearQueue();
    const ok = await this._tryLoadLocalSnapshot();
    if (!ok) {
      this.state = structuredClone(SEED_DATA);
      this._persistState();
      this._notify();
    }
    return this.state;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify() {
    for (const fn of this.listeners) {
      try {
        fn(this.state, this.config, this.syncQueue);
      } catch (err) {
        console.error('Store listener error:', err);
      }
    }
  }
}

export const store = new LocalFirstStore();
