import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const ROOT = process.cwd();

function loadGasContext(overrides = {}) {
  const src = fs.readFileSync(path.join(ROOT, 'backend-gas/Code.gs'), 'utf8');
  const memCache = new Map();
  const mockCache = {
    get: (k) => (memCache.has(k) ? memCache.get(k) : null),
    getAll: (ks) => {
      const out = {};
      for (const k of ks) {
        if (memCache.has(k)) out[k] = memCache.get(k);
      }
      return out;
    },
    putAll: (entries) => {
      for (const [k, v] of Object.entries(entries)) {
        if (String(v).length > 100000) {
          throw new Error(`Cache value for ${k} exceeds GAS 100KB limit (${String(v).length})`);
        }
        memCache.set(k, String(v));
      }
    },
    removeAll: (ks) => {
      for (const k of ks) memCache.delete(k);
    }
  };

  const ctx = {
    Utilities: {
      gzip: (b) => ({ getBytes: () => zlib.gzipSync(Buffer.from(b.str, 'utf8')) }),
      ungzip: (b) => ({ getDataAsString: () => zlib.gunzipSync(b.buf).toString('utf8') }),
      newBlob: (d) => (typeof d === 'string' ? { str: d } : { buf: d }),
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      base64Decode: (s) => Buffer.from(s, 'base64'),
      getUuid: () => 'test-uuid-1234'
    },
    CacheService: {
      getScriptCache: () => mockCache
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => ({
          API_SECRET_TOKEN: 'TEST_SECRET_TOKEN',
          STOCK_SHEET_ID: 'STOCK_ID',
          ASSET_SHEET_ID: 'ASSET_ID'
        }[k] || null)
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (str) => ({
        _text: str,
        setMimeType() { return this; }
      })
    },
    ...overrides
  };

  vm.runInNewContext(src, ctx);
  return { ctx, memCache, mockCache };
}

test('app-meta.js defines version and all coreAssets exist on disk', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/app-meta.js'), 'utf8');
  const sandbox = { self: {} };
  vm.runInNewContext(src, sandbox);
  const meta = sandbox.self.NIC_APP_META;

  assert.ok(meta && /^v\d+$/.test(meta.version), 'version should match v<number>');
  assert.ok(Array.isArray(meta.coreAssets) && meta.coreAssets.length > 10);
  for (const rel of meta.coreAssets) {
    const full = path.join(ROOT, rel.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(full), `Missing coreAsset: ${rel}`);
  }
});

test('GAS chunked cache compresses large JSON under 100KB per key and round-trips cleanly', () => {
  const { ctx, memCache, mockCache } = loadGasContext();
  const payload = {
    generatedAt: '2026-11-21T00:00:00.000Z',
    rows: Array.from({ length: 2500 }, (_, i) => ({
      id: `LOG_${i}`,
      date: '2026-11-21',
      note: '重複文字測試壓縮率與完整還原',
      amount: i * 100
    }))
  };
  assert.ok(JSON.stringify(payload).length > 120000, 'Test payload should exceed 100KB raw');

  const ok = ctx.writeChunkedCache_(mockCache, 'SNAP_TEST', payload, 300);
  assert.equal(ok, true);
  assert.ok(memCache.size >= 2);

  const restored = JSON.parse(JSON.stringify(ctx.readChunkedCache_(mockCache, 'SNAP_TEST')));
  assert.deepEqual(restored, payload);

  ctx.removeChunkedCache_(mockCache, 'SNAP_TEST');
  assert.equal(memCache.size, 0);
});

test('GAS doPost snapshot verifies token and uses chunked cache', () => {
  let buildCount = 0;
  const { ctx } = loadGasContext();
  ctx.buildFullSnapshot_ = () => {
    buildCount++;
    return { generatedAt: '2026-11-21T00:00:00.000Z', count: buildCount };
  };

  // Unauthorized
  const badRes = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'snapshot', token: 'WRONG' }) } })._text);
  assert.equal(badRes.ok, false);

  // First call -> cache miss
  const r1 = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'snapshot', token: 'TEST_SECRET_TOKEN', refresh: false }) } })._text);
  assert.equal(r1.ok, true);
  assert.equal(r1.fromCache, false);
  assert.equal(r1.data.count, 1);

  // Second call -> cache hit
  const r2 = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'snapshot', token: 'TEST_SECRET_TOKEN', refresh: false }) } })._text);
  assert.equal(r2.ok, true);
  assert.equal(r2.fromCache, true);
  assert.equal(r2.data.count, 1);

  // Force refresh -> cache bypass
  const r3 = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'snapshot', token: 'TEST_SECRET_TOKEN', refresh: true }) } })._text);
  assert.equal(r3.ok, true);
  assert.equal(r3.fromCache, false);
  assert.equal(r3.data.count, 2);
});

test('GAS updateStockPrices_ batch-writes 行情 and 總攬 without touching formula columns', () => {
  const { ctx } = loadGasContext();
  const quoteWrites = [];
  const ovWrites = [];

  const mockQuoteSheet = {
    getLastRow: () => 3,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => [
        ['2330', 'TW', 900, '', '=IF(D2<>"",D2,C2)', 'old'],
        ['NVDA', 'US', 120, '', '=IF(D3<>"",D3,C3)', 'old']
      ],
      setValues: (vals) => quoteWrites.push({ row, col, numRows, numCols, vals })
    })
  };

  const mockOvSheet = {
    getLastRow: () => 3,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => [
        // A, B(sym), C(mkt), D, E(shares), F, G(price), H(costUsd), I(costTwd), J..N
        ['', '2330.TW', 'TW', '', 1000, '', 900, 28125, 900000, 0, 0, 0, 0, 0],
        ['', 'NVDA', 'US', '', 10, '', 120, 1000, 32000, 0, 0, 0, 0, 0]
      ],
      setValues: (vals) => ovWrites.push({ row, col, numRows, numCols, vals })
    })
  };

  const mockSS = {
    getSheetByName: (name) => (name === '行情' ? mockQuoteSheet : name === '總攬' ? mockOvSheet : null)
  };

  ctx.updateStockPrices_(mockSS, {
    usdTwd: 32,
    prices: { '2330': 1000, NVDA: 150 }
  });

  // Only 2 batch writes on 行情 (col 3 and col 6), never touching col 4 or col 5
  assert.equal(quoteWrites.length, 2);
  assert.deepEqual(quoteWrites.map((w) => w.col), [3, 6]);
  assert.deepEqual(JSON.parse(JSON.stringify(quoteWrites[0].vals)), [[1000], [150]]);

  // Only 2 batch writes on 總攬 (col 7 and cols 10..14)
  assert.equal(ovWrites.length, 2);
  assert.deepEqual(ovWrites.map((w) => w.col), [7, 10]);
  assert.deepEqual(JSON.parse(JSON.stringify(ovWrites[0].vals)), [[1000], [150]]);

  // Verify 2330: mktTwd = 1,000,000, unrealTwd = 100,000, roi = 100000/900000
  const [twRow, usRow] = JSON.parse(JSON.stringify(ovWrites[1].vals));
  assert.equal(twRow[1], 1000000);
  assert.equal(twRow[3], 100000);
  assert.ok(Math.abs(twRow[4] - 100000 / 900000) < 1e-9);

  // Verify NVDA: mktUsd = 1500, mktTwd = 48000, unrealUsd = 500, unrealTwd = 16000, roi = 0.5
  assert.deepEqual(usRow, [1500, 48000, 500, 16000, 0.5]);
});

test('GAS doPost fetchMarketFactors parses Yahoo Finance SOX and VIX series', () => {
  const { ctx } = loadGasContext({
    UrlFetchApp: {
      fetch: (url) => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          chart: {
            result: [{
              timestamp: [1795046400, 1795132800],
              indicators: { quote: [{ close: url.includes('SOX') ? [9500.123, 9419.72] : [25.4, 28.44] }] }
            }]
          }
        })
      })
    }
  });

  const res = JSON.parse(ctx.doPost({
    postData: { contents: JSON.stringify({ action: 'fetchMarketFactors', token: 'TEST_SECRET_TOKEN', range: '3mo' }) }
  })._text);

  assert.equal(res.ok, true);
  assert.equal(res.data.sox.length, 2);
  assert.equal(res.data.vix.length, 2);
  assert.equal(res.data.sox[1].close, 9419.72);
  assert.equal(res.data.vix[1].close, 28.44);
});

test('GoodStockUI safely handles missing numeric fields without throwing and sorts nulls last', async () => {
  const { GoodStockUI } = await import('../tools/goodstock/ui.js');
  const ui = new GoodStockUI();

  const mockRows = [
    {
      code: '9999',
      name: '缺欄測試股',
      industry: '測試業',
      price: 50,
      pe: null,
      change5dPct: undefined,
      change10dPct: undefined,
      change20dPct: undefined,
      change1mPct: undefined,
      volumeLots: undefined,
      latestOpMargin: undefined,
      latestEps: undefined,
      latestNetMargin: undefined,
      latestRevYoY: undefined,
      latestCumYoY: undefined,
      doubleArrow: undefined,
      sixEval: { current: { avgScore: undefined }, deltaQoQ: undefined }
    },
    {
      code: '2330',
      name: '台積電',
      industry: '半導體',
      price: 1000,
      pe: 20,
      change5dPct: 2.5,
      change10dPct: 5.0,
      change20dPct: 8.0,
      change1mPct: 10.0,
      volumeLots: 30000,
      latestOpMargin: 45.2,
      latestEps: 12.3,
      latestNetMargin: 40.1,
      latestRevYoY: 30.5,
      latestCumYoY: 28.4,
      doubleArrow: 15.0,
      sixEval: { current: { avgScore: 3.8 }, deltaQoQ: 0.2 }
    }
  ];

  // Missing change1mPct should sort to the bottom in both desc and asc
  ui.tableSort.strong = { col: 'change1mPct', dir: 'desc' };
  const descSorted = ui._sortResults('strong', mockRows);
  assert.equal(descSorted[0].code, '2330');
  assert.equal(descSorted[1].code, '9999');

  ui.tableSort.strong = { col: 'change1mPct', dir: 'asc' };
  const ascSorted = ui._sortResults('strong', mockRows);
  assert.equal(ascSorted[0].code, '2330');
  assert.equal(ascSorted[1].code, '9999');
});

test('GoodStockUI defaults six_indicators sort to marketCap desc and preserves marketCap in cache', async () => {
  const { GoodStockUI } = await import('../tools/goodstock/ui.js');
  const { GoodStockCore } = await import('../tools/goodstock/core.js');
  const ui = new GoodStockUI();

  assert.equal(ui.tableSort.six_indicators.col, 'marketCap');
  assert.equal(ui.tableSort.six_indicators.dir, 'desc');
  assert.equal(ui.pageLimit.six_indicators, 50);

  const sorted = ui._sortResults('six_indicators', [
    { code: 'A', marketCap: 120 },
    { code: 'B', marketCap: null },
    { code: 'C', marketCap: 5000 }
  ]);
  assert.deepEqual(sorted.map((x) => x.code), ['C', 'A', 'B']);

  // Verify getEnrichedUniverse caches result for identical state
  GoodStockCore.invalidateCache();
  const list1 = GoodStockCore.getEnrichedUniverse({ stock: { overview: [], watchlist: [] } });
  const list2 = GoodStockCore.getEnrichedUniverse({ stock: { overview: [], watchlist: [] } });
  assert.equal(list1, list2);
});

test('GAS Code.gs and copy-paste version stay structurally in sync', () => {
  const codeGs = fs.readFileSync(path.join(ROOT, 'backend-gas/Code.gs'), 'utf8').replace(/^\uFEFF/, '');
  const copyGs = fs.readFileSync(path.join(ROOT, 'data/GAS_直接複製貼上版.gs'), 'utf8').replace(/^\uFEFF/, '');
  const stripConfig = (s) => s.replace(/function getConfig_\(\)\s*\{[\s\S]*?\n\}/, 'function getConfig_() { /* normalized */ }');
  assert.equal(stripConfig(codeGs), stripConfig(copyGs));
});
