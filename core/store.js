import { SEED_DATA } from './seed-data.js';

const STORAGE_KEY = 'nic_toolkit_state_v1';
const CONFIG_KEY = 'nic_toolkit_config_v1';
const QUEUE_KEY = 'nic_toolkit_sync_queue_v1';

class LocalFirstStore {
  constructor() {
    this.listeners = new Set();
    this.state = null;
    this.config = this._loadConfig();
    this.syncQueue = this._loadQueue();
    this.initialized = false;
  }

  _loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) return JSON.parse(raw);
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
        this.state = JSON.parse(cached);
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
    const ensureArr = (v) => {
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object' && Object.keys(v).length > 0) return [v];
      return [];
    };
    return {
      generatedAt: raw.generatedAt || new Date().toISOString(),
      isDemoSeed: Boolean(raw.isDemoSeed),
      stock: {
        settings: ensureArr(raw.stock?.settings),
        fx: ensureArr(raw.stock?.fx),
        overview: ensureArr(raw.stock?.overview),
        risk: ensureArr(raw.stock?.risk),
        watchlist: ensureArr(raw.stock?.watchlist),
        dailySnapshots: ensureArr(raw.stock?.dailySnapshots),
        recentTrades: ensureArr(raw.stock?.recentTrades),
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

  _checkUrlPairing() {
    try {
      const params = new URLSearchParams(window.location.search);
      const pairCode = params.get('pair');
      if (pairCode) {
        const decoded = JSON.parse(atob(decodeURIComponent(pairCode)));
        if (decoded.gasUrl || decoded.apiToken) {
          this.saveConfig({
            gasUrl: decoded.gasUrl || '',
            apiToken: decoded.apiToken || '',
            mode: decoded.mode || 'sandbox'
          });
          // Clean URL without reloading
          const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
          window.history.replaceState({}, document.title, cleanUrl);
        }
      }
    } catch (_) {}
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
