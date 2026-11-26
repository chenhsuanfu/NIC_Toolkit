// Single source of truth for App Version and PWA Core Assets
// Shared by index.html (<script src="./core/app-meta.js">) and sw.js (importScripts('./core/app-meta.js'))
self.NIC_APP_META = {
  version: 'v53',
  coreAssets: [
    './core/app-meta.js',
    './assets/css/main.css',
    './core/seed-data.js',
    './core/store.js',
    './core/api-client.js',
    './core/registry.js',
    './core/agent-bridge.js',
    './tools/hub/ui.js',
    './tools/stock-tracker/core.js',
    './tools/stock-tracker/ui.js',
    './tools/goodstock/data.js',
    './tools/goodstock/core.js',
    './tools/goodstock/ui.js',
    './tools/twse-radar/core.js',
    './tools/twse-radar/ui.js',
    './tools/twse-radar/radar.html',
    './tools/twse-radar/real_twse_v4.csv',
    './tools/asset-tracker/data.js',
    './tools/asset-tracker/core.js',
    './tools/asset-tracker/ui.js',
    './tools/settings/ui.js'
  ]
};
