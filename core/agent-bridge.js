import { store } from './store.js';

/**
 * Human-to-Agent Evolution Bridge (Headless API & Function Calling Interface)
 * Decouples business logic from UI so AI Agents, iOS Shortcuts, or CLI scripts
 * can inspect tool JSON Schemas and invoke actions programmatically.
 */
class AgentBridge {
  constructor() {
    this.actions = new Map();
    this.schemas = new Map();
  }

  /**
   * Register a headless module's actions and OpenAI/Gemini/MCP-compatible JSON Schemas
   */
  registerModule(moduleId, { description, actions, schemas }) {
    this.actions.set(moduleId, actions || {});
    this.schemas.set(moduleId, {
      moduleId,
      description,
      functions: schemas || []
    });
  }

  /**
   * List all available modules and their JSON Schemas for AI Agent discovery
   */
  getManifest() {
    const modules = [];
    for (const [, schemaObj] of this.schemas.entries()) {
      modules.push(schemaObj);
    }
    return {
      platform: 'NIC_Toolkit',
      version: '1.0.0',
      dualTrackReady: true,
      mode: store.getConfig().mode,
      pendingSyncCount: store.getSyncQueue().length,
      syncStatus: store.getSyncStatus(),
      modules
    };
  }

  /**
   * Programmatically invoke a tool action without UI interaction
   * @param {string} moduleId - e.g. 'stock-tracker' or 'asset-tracker'
   * @param {string} actionName - e.g. 'getSummary', 'addTrade', 'addExpense'
   * @param {object} params - Structured JSON arguments
   */
  async invoke(moduleId, actionName, params = {}) {
    const modActions = this.actions.get(moduleId);
    if (!modActions || typeof modActions[actionName] !== 'function') {
      return {
        ok: false,
        exitCode: 404,
        error: `Unknown module or action: ${moduleId}.${actionName}`,
        availableModules: Array.from(this.actions.keys())
      };
    }

    try {
      const startTime = performance.now();
      const result = await modActions[actionName](store.getState(), params, store);
      const elapsedMs = Math.round((performance.now() - startTime) * 100) / 100;
      return {
        ok: true,
        exitCode: 0,
        moduleId,
        action: actionName,
        elapsedMs,
        mode: store.getConfig().mode,
        data: result
      };
    } catch (err) {
      return {
        ok: false,
        exitCode: 400,
        moduleId,
        action: actionName,
        error: err.message || String(err)
      };
    }
  }
}

export const agentBridge = new AgentBridge();

agentBridge.registerModule('system', {
  description: 'Local-First 雲端同步與狀態控管模組',
  actions: {
    getSyncStatus: () => ({
      mode: store.getConfig().mode,
      lastSyncAt: store.getConfig().lastSyncAt,
      pendingSyncCount: store.getSyncQueue().length,
      syncStatus: store.getSyncStatus()
    }),
    syncNow: async (_state, params = {}) => {
      return store.syncWithCloud({
        forceRefresh: Boolean(params?.forceRefresh),
        pushFirst: true,
        silent: false
      });
    }
  },
  schemas: [
    {
      name: 'getSyncStatus',
      description: '取得目前運作模式、待同步佇列筆數與最近一次雲端同步狀態',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'syncNow',
      description: '立即先推送本地待同步佇列至 Google Sheets，並視需要強制拉取最新快照',
      parameters: {
        type: 'object',
        properties: {
          forceRefresh: { type: 'boolean' }
        }
      }
    }
  ]
});

// Expose globally on window for browser automation, Console scripts, and Agent WebView hooks
if (typeof window !== 'undefined') {
  window.NIC_Agent = agentBridge;
}
