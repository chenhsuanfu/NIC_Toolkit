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

  // Verify expanding advanced filters drawer renders without ReferenceError
  ui.showAdvancedFilters = true;
  const html = ui._renderSixIndicatorsScreener({ stock: { overview: [], watchlist: [] } }, ['半導體'], list1);
  assert.ok(html.includes('id="six-scope"'));
  // Verify stock with no financials gets null scores and '待同步' grade (no fake scores)
  const emptyEval = GoodStockCore.evaluateSixIndicatorsWithHistory({ code: '0050', quarters: [], monthlyRevenues: [] });
  assert.equal(emptyEval.current.avgScore, null);
  assert.equal(emptyEval.current.grade, '待同步');
  assert.equal(emptyEval.deltaMoM, null);
  assert.equal(emptyEval.deltaQoQ, null);
  // Verify 1-quarter summary without finmind-batch/live also gets null avgScore and '待同步'
  const partialEval = GoodStockCore.evaluateSixIndicatorsWithHistory({
    code: '1102',
    dataSource: 'universe-index',
    quarters: [{ q: '2026Q3', opMargin: 7.77, eps: 2.86 }],
    monthlyRevenues: [{ ym: '2026-10', yoy: 12.5 }]
  });
  assert.equal(partialEval.current.avgScore, null);
  assert.equal(partialEval.current.grade, '待同步');
});

test('AssetCore.getFsSharedAssets preserves negative amounts on non-expense rows', async () => {
  const { AssetCore } = await import('../tools/asset-tracker/core.js');
  const res = AssetCore.getFsSharedAssets({
    asset: {
      config: [],
      recentLogs: [
        { 日期: '2026-04-09', 性質: '轉帳', 類別: '換匯', 帳戶: '中信', 幣別: 'TWD', 金額: -65845, 標籤: 'FS' },
        { 日期: '2026-04-09', 性質: '轉帳', 類別: '換匯', 帳戶: '中信_定存', 幣別: 'USD', 金額: 2037, 標籤: 'FS' },
        { 日期: '2026-04-16', 性質: '轉帳', 類別: '定存解約', 帳戶: '中信', 幣別: 'TWD', 金額: 70000, 標籤: 'FS' },
        { 日期: '2026-04-16', 性質: '轉帳', 類別: '定存解約', 帳戶: '中信_定存', 幣別: 'TWD', 金額: -70000, 標籤: 'FS' },
        { 日期: '2026-05-01', 性質: '支出', 類別: '雜支', 帳戶: '中信', 幣別: 'TWD', 金額: 500, 標籤: 'FS' }
      ]
    }
  });
  assert.equal(res.totalTwd, -66345);
  assert.equal(res.totalUsd, 2037);
});

test('GoodStockCore.estimateTargetPrices dynamically computes PE bands from live price', async () => {
  const { GoodStockCore } = await import('../tools/goodstock/core.js');

  // Case 1: 4967-like low PE stock (Price: 216.5, TTM EPS: 90.95 => PE ~ 2.38)
  const stock4967 = {
    code: '4967',
    name: '十銓',
    price: 216.5,
    quarters: [
      { q: '2026Q3', eps: 90.95, revYoY: 159.4 }
    ]
  };

  const res1 = GoodStockCore.estimateTargetPrices(stock4967, { horizon: 1 });
  assert.equal(res1.currentPe, 2.38);
  assert.equal(res1.peSource, 'dynamic-live');
  // Bands should be dynamic [1.9, 2.4, 3.0] rather than static [12, 16, 20]
  assert.deepEqual(res1.peBands, [1.9, 2.4, 3.0]);
  // All target prices should be reasonable (close to ~200-400), not thousands
  for (const line of res1.lines) {
    assert.ok(line.targetPrice > 100 && line.targetPrice < 500, `Target price ${line.targetPrice} should be realistic`);
  }

  // Case 2: Update live price updates currentPe and peBands dynamically
  const updatedStock4967 = { ...stock4967, price: 300 };
  const resUpdated = GoodStockCore.estimateTargetPrices(updatedStock4967, { horizon: 1 });
  assert.equal(resUpdated.currentPe, 3.3);
  assert.deepEqual(resUpdated.peBands, [2.6, 3.3, 4.1]);

  // Case 3: Manual override with custom peBands
  const resCustom = GoodStockCore.estimateTargetPrices(stock4967, { peBands: [5, 8, 10] });
  assert.equal(resCustom.peSource, 'custom');
  assert.deepEqual(resCustom.peBands, [5, 8, 10]);

  // Case 4: Stock with PE >= 10 uses integer rounded bands
  const stock2330 = {
    code: '2330',
    name: '台積電',
    price: 1000,
    quarters: [
      { q: '2026Q1', eps: 10 },
      { q: '2026Q2', eps: 10 },
      { q: '2026Q3', eps: 12 },
      { q: '2026Q4', eps: 13, revYoY: 25 }
    ]
  };
  const res2330 = GoodStockCore.estimateTargetPrices(stock2330, { horizon: 1 });
  assert.equal(res2330.ttmEps, 45);
  assert.equal(res2330.currentPe, 22.22);
  assert.deepEqual(res2330.peBands, [18, 22, 28]);

  // Case 5: Stock with no price and no PE falls back to fallback peBands
  const noPriceStock = {
    code: '0000',
    price: 0,
    pe: null,
    quarters: [{ q: '2026Q3', eps: 2 }]
  };
  const resFallback = GoodStockCore.estimateTargetPrices(noPriceStock, { horizon: 1 });
  assert.equal(resFallback.peSource, 'fallback');
  assert.deepEqual(resFallback.peBands, [12, 16, 20]);
});

test('StockTrackerUI search inputs render with type search and isolated list containers', async () => {
  const { StockTrackerUI } = await import('../tools/stock-tracker/ui.js');
  const ui = new StockTrackerUI();

  const mockState = {
    stock: {
      overview: [
        { '代號': '2330.TW', '市場': 'TW', '類型': '進攻型', '剩餘股數': 1000, '平均成本(原幣)': 800, '現價(原幣)': 1000, '市值(TWD)': 1000000, '未實現(TWD)': 200000, '報酬率': 0.25 },
        { '代號': 'NVDA', '市場': 'US', '類型': '進攻型', '剩餘股數': 50, '平均成本(原幣)': 100, '現價(原幣)': 140, '市值(TWD)': 224000, '未實現(TWD)': 64000, '報酬率': 0.4 }
      ],
      settings: []
    }
  };

  const mockStore = {
    getState: () => mockState,
    getConfig: () => ({ lastSyncAt: null })
  };

  // Test Holdings tab rendering
  ui.activeTab = 'holdings';
  const mockContainerHoldings = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  ui.render(mockContainerHoldings, mockState, mockStore);

  assert.ok(mockContainerHoldings.innerHTML.includes('id="filter-query" type="search"'));
  assert.ok(mockContainerHoldings.innerHTML.includes('id="holdings-list-container"'));

  // Test Rebalance tab rendering
  ui.activeTab = 'rebalance';
  const mockContainerReb = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  ui.render(mockContainerReb, mockState, mockStore);

  assert.ok(mockContainerReb.innerHTML.includes('id="rebalance-query" type="search"'));
  assert.ok(mockContainerReb.innerHTML.includes('id="rebalance-table-container"'));
});

test('TwseRadarUI renders native 4-tab responsive views without iframe', async () => {
  const { TwseRadarUI } = await import('../tools/twse-radar/ui.js');
  const ui = new TwseRadarUI();
  ui._csvLoadedAttempted = true; // Skip network fetch in unit test

  const makeMockContainer = () => ({ innerHTML: '', querySelector: () => null, querySelectorAll: () => [] });

  // Tab 1 (default): Minimalist T+1 action directive + 5 factors, no iframe
  assert.equal(ui.activeTab, 'action');
  const cAction = makeMockContainer();
  ui.render(cAction, {}, {});
  assert.ok(!cAction.innerHTML.includes('<iframe'));
  assert.ok(cAction.innerHTML.includes('radar-hero'));
  assert.ok(cAction.innerHTML.includes('radar-factors-grid'));
  assert.ok(cAction.innerHTML.includes('明日 T+1 行動指令'));

  // Tab 2: Radar SVG chart & action list
  ui.activeTab = 'radar';
  const cRadar = makeMockContainer();
  ui.render(cRadar, {}, {});
  assert.ok(cRadar.innerHTML.includes('<svg viewBox='));
  assert.ok(cRadar.innerHTML.includes('歷史加減碼行動清單'));

  // Tab 3: Yearly calendar
  ui.activeTab = 'calendar';
  const cCal = makeMockContainer();
  ui.render(cCal, {}, {});
  assert.ok(cCal.innerHTML.includes('radar-cal-grid'));
  assert.ok(cCal.innerHTML.includes('年度減碼執行日曆'));

  // Tab 4: Audit KPIs & What-If simulator
  ui.activeTab = 'audit';
  const cAudit = makeMockContainer();
  ui.render(cAudit, {}, {});
  assert.ok(cAudit.innerHTML.includes('form-radar-whatif'));
  assert.ok(cAudit.innerHTML.includes('歷次大跌波段複盤'));
});

test('GAS Code.gs and copy-paste version stay structurally in sync', () => {
  const codeGs = fs.readFileSync(path.join(ROOT, 'backend-gas/Code.gs'), 'utf8').replace(/^\uFEFF/, '');
  const copyGs = fs.readFileSync(path.join(ROOT, 'data/GAS_直接複製貼上版.gs'), 'utf8').replace(/^\uFEFF/, '');
  const stripConfig = (s) => s.replace(/function getConfig_\(\)\s*\{[\s\S]*?\n\}/, 'function getConfig_() { /* normalized */ }');
  assert.equal(stripConfig(codeGs), stripConfig(copyGs));
});
