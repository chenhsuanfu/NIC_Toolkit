import { SEED_DATA } from './seed-data.js';

const STORAGE_KEY = 'nic_toolkit_state_v1';
const CONFIG_KEY = 'nic_toolkit_config_v1';
const QUEUE_KEY = 'nic_toolkit_sync_queue_v1';
const COOKIE_CFG_KEY = 'nic_tk_cfg';

class LocalFirstStore {
  constructor() {
    this.listeners = new Set();
    this.state = null;
    this.config = this._loadConfig();
    this.syncQueue = this._coalesceQueue(this._loadQueue());
    this.syncStatus = {
      state: 'idle', // 'idle' | 'syncing' | 'error'
      lastError: null,
      lastAttemptAt: null
    };
    this._autoPushTimer = null;
    this._pushPromise = null;
    this._pendingAutoPushAfterFlight = false;
    this._pullPromise = null;
    this._lastCloudPullAt = 0;
    this.initialized = false;
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
      if (raw) {
        const parsed = JSON.parse(raw);
        const coalesced = this._coalesceQueue(parsed);
        if (Array.isArray(parsed) && coalesced.length !== parsed.length) {
          localStorage.setItem(QUEUE_KEY, JSON.stringify(coalesced));
        }
        return coalesced;
      }
    } catch (_) {}
    return [];
  }

  _coalesceQueue(queue) {
    if (!Array.isArray(queue) || queue.length <= 1) return Array.isArray(queue) ? queue : [];
    const seenSettingKeys = new Set();
    const outReversed = [];
    for (let i = queue.length - 1; i >= 0; i--) {
      const item = queue[i];
      if (item && item.type === 'stock.upsertSetting' && item.payload?.['項目']) {
        const key = String(item.payload['項目']).trim();
        if (seenSettingKeys.has(key)) continue;
        seenSettingKeys.add(key);
      }
      outReversed.push(item);
    }
    return outReversed.reverse();
  }

  _setSyncStatus(partial) {
    this.syncStatus = { ...this.syncStatus, ...partial };
    this._notify('sync-status');
  }

  getSyncStatus() {
    return this.syncStatus;
  }

  saveConfig(partial) {
    const prevMode = this.config?.mode;
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
    this._notify('config');
    if (prevMode !== 'cloud' && this.config.mode === 'cloud' && this.syncQueue.length > 0) {
      this._scheduleAutoPush(300);
    }
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
        this._notify('init');
        // Background refresh: if demo seed, try local snapshot first, then sync with cloud if configured
        if (this.state.isDemoSeed) {
          await this._tryLoadLocalSnapshot();
        }
        if (this.config.gasUrl && this.config.apiToken) {
          // Stale-While-Revalidate: push pending queue first if any, then pull latest cloud snapshot
          this.syncWithCloud({ forceRefresh: false, pushFirst: true, silent: true });
        }
        return this.state;
      }
    } catch (_) {}

    // 3. First-time hydration: try local-snapshot.json, fallback to SEED_DATA, then sync with cloud if paired
    const loadedSnapshot = await this._tryLoadLocalSnapshot();
    if (!loadedSnapshot) {
      this.state = structuredClone(SEED_DATA);
      this._persistState();
    }

    this.initialized = true;
    this._notify('init');
    if (this.config.gasUrl && this.config.apiToken) {
      this.syncWithCloud({ forceRefresh: false, pushFirst: true, silent: true });
    }
    return this.state;
  }

  async pullFromCloudSilently(forceRefresh = false) {
    if (!this.config.gasUrl || !this.config.apiToken) return false;
    if (this.config.mode === 'cloud' && this.syncQueue.length > 0) return false;
    if (this._pullPromise) return this._pullPromise;

    this._pullPromise = (async () => {
      try {
        const res = await fetch(this.config.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'snapshot',
            token: this.config.apiToken,
            refresh: Boolean(forceRefresh)
          })
        });
        if (!res.ok) return false;
        const json = await res.json();
        if (json && json.ok && json.data) {
          this._lastCloudPullAt = Date.now();
          this.replaceStateFromCloud(json.data);
          return true;
        }
      } catch (_) {}
      return false;
    })().finally(() => {
      this._pullPromise = null;
    });

    return this._pullPromise;
  }

  _scheduleAutoPush(delayMs = 900) {
    if (this.config.mode !== 'cloud' || !this.config.gasUrl || !this.config.apiToken) return;
    if (this.syncQueue.length === 0) return;
    if (this._autoPushTimer) {
      clearTimeout(this._autoPushTimer);
    }
    this._autoPushTimer = setTimeout(() => {
      this._autoPushTimer = null;
      this.pushPendingQueue({ silent: true }).catch(() => {});
    }, delayMs);
  }

  async pushPendingQueue({ silent = false } = {}) {
    const gasUrl = (this.config?.gasUrl || '').trim();
    const apiToken = (this.config?.apiToken || '').trim();
    const mode = this.config?.mode || 'sandbox';

    if (this.syncQueue.length === 0) {
      return { syncedCount: 0, message: '目前沒有待同步的變更' };
    }

    if (mode !== 'cloud') {
      if (silent) return { syncedCount: 0, skipped: 'sandbox' };
      throw new Error('目前處於「本機沙盒模式」，請先至「設定與同步」切換為「正式雲端同步模式」再寫入原試算表。');
    }

    if (!gasUrl || !apiToken) {
      if (silent) return { syncedCount: 0, skipped: 'unconfigured' };
      throw new Error('尚未設定 Google Apps Script API 網址或通行金鑰');
    }

    if (this._autoPushTimer) {
      clearTimeout(this._autoPushTimer);
      this._autoPushTimer = null;
    }

    if (this._pushPromise) {
      this._pendingAutoPushAfterFlight = true;
      const inFlightRes = await this._pushPromise;
      if (this.syncQueue.length === 0 || silent) {
        return inFlightRes;
      }
    }

    const runPush = async () => {
      this._setSyncStatus({
        state: 'syncing',
        lastError: null,
        lastAttemptAt: new Date().toISOString()
      });

      const queueSnapshot = [...this.syncQueue];
      try {
        // GAS web apps accept text/plain POST body cleanly without CORS preflight blocks
        const res = await fetch(gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'batchMutate',
            token: apiToken,
            mutations: queueSnapshot
          })
        });

        if (!res.ok) {
          throw new Error(`同步請求失敗 (HTTP ${res.status})`);
        }

        const json = await res.json();
        const syncedIds = Array.isArray(json.syncedIds) ? json.syncedIds : [];
        if (syncedIds.length > 0) {
          this.markQueueSynced(syncedIds);
        }

        if (!json.ok) {
          throw new Error(json.error || '雲端寫入失敗');
        }

        const syncedSet = new Set(syncedIds);
        const unsynced = queueSnapshot.filter((q) => !syncedSet.has(q.id));
        if (unsynced.length > 0) {
          const missingTypes = Array.from(new Set(unsynced.map((u) => u.type))).join(', ');
          throw new Error(`雲端未完成 ${unsynced.length} 筆同步 (${missingTypes})，請確認 GAS 部署已更新並發布新版本`);
        }

        this._setSyncStatus({
          state: 'idle',
          lastError: null,
          lastAttemptAt: new Date().toISOString()
        });
        return { syncedCount: syncedIds.length, details: json };
      } catch (err) {
        this._setSyncStatus({
          state: 'error',
          lastError: err.message || String(err),
          lastAttemptAt: new Date().toISOString()
        });
        throw err;
      }
    };

    this._pushPromise = runPush().finally(() => {
      this._pushPromise = null;
      if (this._pendingAutoPushAfterFlight) {
        this._pendingAutoPushAfterFlight = false;
        if (this.syncQueue.length > 0) {
          this._scheduleAutoPush(300);
        }
      }
    });

    return this._pushPromise;
  }

  async syncWithCloud({ forceRefresh = false, pushFirst = true, silent = true } = {}) {
    if (pushFirst && this.config.mode === 'cloud' && this.syncQueue.length > 0) {
      try {
        await this.pushPendingQueue({ silent });
      } catch (err) {
        if (!silent) throw err;
        return { pushed: false, pulled: false, error: err.message || String(err) };
      }
    }
    if (this.config.mode === 'cloud' && this.syncQueue.length > 0) {
      return { pushed: false, pulled: false };
    }
    const pulled = await this.pullFromCloudSilently(forceRefresh);
    return { pushed: true, pulled };
  }

  async handleAppResume() {
    if (!this.initialized || !this.config.gasUrl || !this.config.apiToken) return;
    if (this.config.mode === 'cloud' && this.syncQueue.length > 0) {
      await this.syncWithCloud({ forceRefresh: false, pushFirst: true, silent: true });
      return;
    }
    if (Date.now() - this._lastCloudPullAt > 15000) {
      await this.pullFromCloudSilently(false);
    }
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
        recentTrades: rawTrades,
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
        cashflowHistory: ensureArr(raw.asset?.cashflowHistory),
        salaryRecords: Array.isArray(raw.asset?.salaryRecords) ? raw.asset.salaryRecords : [],
        salaryAnnual: Array.isArray(raw.asset?.salaryAnnual) ? raw.asset.salaryAnnual : []
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
        if (decoded.radar && typeof decoded.radar === 'object') {
          try {
            const curRaw = localStorage.getItem('nic_twse_radar_v1');
            const cur = curRaw ? JSON.parse(curRaw) : {};
            const next = { ...cur };
            if (typeof decoded.radar.t === 'string' && decoded.radar.t.trim()) {
              next.finmindToken = decoded.radar.t.trim();
              localStorage.setItem('twse_radar_finmind_token', next.finmindToken);
            }
            if (decoded.radar.p && typeof decoded.radar.p === 'object') {
              next.params = { ...(cur.params || {}), ...decoded.radar.p };
            }
            localStorage.setItem('nic_twse_radar_v1', JSON.stringify(next));
          } catch (_) {}
        }
        if (decoded.gasUrl || decoded.apiToken || decoded.radar) {
          if (decoded.gasUrl || decoded.apiToken) {
            this.saveConfig({
              gasUrl: decoded.gasUrl || '',
              apiToken: decoded.apiToken || '',
              mode: decoded.mode || 'cloud'
            });
          }
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

    // Parse full ?pair= URL or base64 payload
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
    this.syncQueue = this._coalesceQueue(this.syncQueue);
    this._persistState();
    this._persistQueue();
    this._notify('mutate');
    this._scheduleAutoPush();
    return mutationRecord;
  }

  markQueueSynced(ids = []) {
    const idSet = new Set(ids);
    this.syncQueue = this.syncQueue.filter((item) => !idSet.has(item.id));
    this.config = { ...this.config, lastSyncAt: new Date().toISOString() };
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    } catch (_) {}
    this._persistQueue();
    this._notify('queue-synced');
  }

  clearQueue() {
    this.syncQueue = [];
    this._persistQueue();
    this._notify('queue-cleared');
  }

  replaceStateFromCloud(cloudData) {
    this.state = this._normalizeSnapshot(cloudData);
    this.state.isDemoSeed = false;
    this.config = { ...this.config, lastSyncAt: new Date().toISOString() };
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    } catch (_) {}
    this._persistState();
    this._notify('cloud-pull');
  }

  async resetToInitialSnapshot() {
    localStorage.removeItem(STORAGE_KEY);
    this.clearQueue();
    const ok = await this._tryLoadLocalSnapshot();
    if (!ok) {
      this.state = structuredClone(SEED_DATA);
      this._persistState();
      this._notify('reset');
    }
    return this.state;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify(reason = 'state') {
    for (const fn of this.listeners) {
      try {
        fn(this.state, this.config, this.syncQueue, reason, this.syncStatus);
      } catch (err) {
        console.error('Store listener error:', err);
      }
    }
  }
}

export const store = new LocalFirstStore();
