const CACHE_NAME = 'nic-toolkit-shell-v12';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/main.css',
  './core/seed-data.js',
  './core/vault-data.js',
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
  './tools/asset-tracker/data.js',
  './tools/asset-tracker/core.js',
  './tools/asset-tracker/ui.js',
  './tools/settings/ui.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        CORE_ASSETS.map((url) =>
          fetch(new Request(url, { cache: 'reload' })).then((res) => {
            if (res && res.status === 200) return cache.put(url, res);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-First with ETag revalidation (no-cache bypasses 10m GitHub Pages max-age=600 stale HTTP cache)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
