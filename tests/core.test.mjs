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

test('TwseRadarCore v4.0 engine parses real_twse_v4.csv and computes 0-100 risk thermometer', async () => {
  const { parseCsvText, generateDemoData, inferDataMeta, runQuantEngine, buildLatestSummary, DEFAULT_PARAMS, STRATEGY_PRESETS } = await import('../tools/twse-radar/core.js');
  const csvText = fs.readFileSync(path.join(ROOT, 'tools/twse-radar/real_twse_v4.csv'), 'utf8');
  const parsed = parseCsvText(csvText, 'real_twse_v4.csv');
  assert.ok(parsed && parsed.rawData.length >= 1000);
  assert.equal(parsed.dataMeta.hasChip, true);
  assert.equal(parsed.dataMeta.hasUs, true);
  assert.equal(parsed.dataMeta.hasFx, true);

  const res = runQuantEngine(parsed.rawData, DEFAULT_PARAMS, parsed.dataMeta);
  const summary = buildLatestSummary(parsed.rawData, DEFAULT_PARAMS, parsed.dataMeta, res);
  assert.equal(summary.maxScore, 100);
  assert.ok(summary.score >= 0 && summary.score <= 100);
  assert.equal(summary.activeFactorCount, parsed.dataMeta.hasOtc ? 5 : 4);
  assert.equal(DEFAULT_PARAMS.futQ, 12);
  assert.equal(DEFAULT_PARAMS.spotQ, 12);
  assert.equal(DEFAULT_PARAMS.maLen, 15);
  assert.equal(DEFAULT_PARAMS.confirmDays, 1);
  assert.equal(DEFAULT_PARAMS.maintTh, 157);
  assert.equal(DEFAULT_PARAMS.yellowScore, 70);
  assert.equal(DEFAULT_PARAMS.redScore, 85);
  assert.equal(DEFAULT_PARAMS.reentryDays, 3);
  assert.equal(STRATEGY_PRESETS.presetB.params.confirmDays, 2);
  assert.equal(STRATEGY_PRESETS.presetB.params.volQ, 85);

  // Full 5-factor dataset (with OTC populated) activates all 5 factors
  const demo = generateDemoData();
  const demoMeta = inferDataMeta(demo);
  assert.equal(demoMeta.hasOtc, true);
  const demoSum = buildLatestSummary(demo, DEFAULT_PARAMS, demoMeta);
  assert.equal(demoSum.activeFactorCount, 5);
  assert.equal(demoSum.maxScore, 100);
});

test('TwseRadarUI renders native 5-tab v4.0 responsive views with zoom, calendar jump, and settings tab', async () => {
  const { TwseRadarUI } = await import('../tools/twse-radar/ui.js');
  const { TwseRadarCore } = await import('../tools/twse-radar/core.js');
  const ui = new TwseRadarUI();
  ui._csvLoadedAttempted = true; // Skip network fetch in unit test

  const makeMockContainer = () => ({ innerHTML: '', querySelector: () => null, querySelectorAll: () => [] });

  // Tab 1 (default): Minimalist T+1 action directive + 5 v4.0 factors, no iframe
  assert.equal(ui.activeTab, 'action');
  const cAction = makeMockContainer();
  ui.render(cAction, {}, {});
  assert.ok(!cAction.innerHTML.includes('<iframe'));
  assert.ok(cAction.innerHTML.includes('radar-hero'));
  assert.ok(cAction.innerHTML.includes('風險溫度'));
  assert.ok(cAction.innerHTML.includes('OTC 櫃買廣度'));
  assert.ok(cAction.innerHTML.includes('美股費半 / VIX'));

  // Tab 2: Interactive SVG chart with date range inputs & zoom controls
  ui.activeTab = 'radar';
  const cRadar = makeMockContainer();
  ui.render(cRadar, {}, {});
  assert.ok(cRadar.innerHTML.includes('id="radar-svg-host"'));
  assert.ok(cRadar.innerHTML.includes('id="radar-date-start"'));
  assert.ok(cRadar.innerHTML.includes('id="radar-date-end"'));
  assert.ok(cRadar.innerHTML.includes('id="btn-radar-zoom-in"'));

  // Tab 3: Yearly calendar with clickable days & current month marker
  ui.activeTab = 'calendar';
  const cCal = makeMockContainer();
  ui.render(cCal, {}, {});
  assert.ok(cCal.innerHTML.includes('radar-cal-grid'));
  assert.ok(cCal.innerHTML.includes('data-cal-date='));
  assert.ok(cCal.innerHTML.includes('data-cal-current-month="true"'));

  // Calendar click -> _jumpToDate switches to Tab 2 focused on that date
  const { rawData } = TwseRadarCore.getWorkingData();
  const sampleDate = rawData[Math.floor(rawData.length / 2)].Date;
  ui._jumpToDate(sampleDate, rawData);
  assert.equal(ui.activeTab, 'radar');
  assert.equal(ui.focusDate, sampleDate);
  const cFocused = makeMockContainer();
  ui.render(cFocused, {}, {});
  assert.ok(cFocused.innerHTML.includes(`聚焦日期：${sampleDate}`));

  // Tab 4: Audit KPIs & What-If simulator (params moved out to Tab 5)
  ui.activeTab = 'audit';
  const cAudit = makeMockContainer();
  ui.render(cAudit, {}, {});
  assert.ok(cAudit.innerHTML.includes('form-radar-whatif'));
  assert.ok(cAudit.innerHTML.includes('歷次大跌波段複盤'));
  assert.ok(!cAudit.innerHTML.includes('id="form-radar-params"'));

  // Tab 5: Full v4.0 parameter settings tab + OOS grid search scanner + Preset A/B buttons
  ui.activeTab = 'settings';
  const cSettings = makeMockContainer();
  ui.render(cSettings, {}, {});
  assert.ok(cSettings.innerHTML.includes('id="btn-radar-preset-a"'));
  assert.ok(cSettings.innerHTML.includes('id="btn-radar-preset-b"'));
  assert.ok(cSettings.innerHTML.includes('id="btn-radar-scan-apply"'));
  assert.ok(cSettings.innerHTML.includes('id="btn-radar-scan-only"'));
  assert.ok(cSettings.innerHTML.includes('id="form-radar-params"'));
  assert.ok(cSettings.innerHTML.includes('name="useUsFilter"'));
  assert.ok(cSettings.innerHTML.includes('name="yellowScore"'));
  assert.ok(cSettings.innerHTML.includes('name="finmindToken"'));
});

test('TwseRadarCore.runOosGridSearch scans 81 combos and applies best combo when requested', async () => {
  const { TwseRadarCore, DEFAULT_PARAMS } = await import('../tools/twse-radar/core.js');
  const scan = TwseRadarCore.runOosGridSearch({ applyBest: false });
  assert.equal(scan.combosCount, 81);
  assert.equal(scan.topResults.length, 8);
  assert.equal(scan.applied, false);
  assert.ok(scan.bestCombo && typeof scan.bestCombo.futDelta5d === 'number');
  assert.ok(scan.topResults[0].score >= scan.topResults[1].score);

  const scanApply = TwseRadarCore.runOosGridSearch({ applyBest: true });
  assert.equal(scanApply.applied, true);
  assert.ok(scanApply.latestSummary && scanApply.latestSummary.maxScore === 100);
  // Restore defaults after test
  TwseRadarCore.updateParams(DEFAULT_PARAMS);
});

test('GAS Code.gs and copy-paste version stay structurally in sync', () => {
  const codeGs = fs.readFileSync(path.join(ROOT, 'backend-gas/Code.gs'), 'utf8').replace(/^\uFEFF/, '');
  const copyGs = fs.readFileSync(path.join(ROOT, 'data/GAS_直接複製貼上版.gs'), 'utf8').replace(/^\uFEFF/, '');
  const stripConfig = (s) => s.replace(/function getConfig_\(\)\s*\{[\s\S]*?\n\}/, 'function getConfig_() { /* normalized */ }');
  assert.equal(stripConfig(codeGs), stripConfig(copyGs));
});

test('NavHistory manages bounded stack, deduplicates identical top state, and restores scrollY', async () => {
  const { NavHistory, bindTwoStepConfirm } = await import('../core/nav-history.js');
  const hist = new NavHistory({ maxDepth: 3 });

  assert.equal(hist.canGoBack(), false);
  assert.equal(hist.peek(), null);

  assert.equal(hist.push({ toolId: 'hub', label: '總覽', viewState: { tab: 'a' }, scrollY: 120 }), true);
  // Duplicate top entry should update scrollY without growing stack
  assert.equal(hist.push({ toolId: 'hub', label: '總覽', viewState: { tab: 'a' }, scrollY: 480 }), false);
  assert.equal(hist.size(), 1);
  assert.equal(hist.peek().scrollY, 480);

  hist.push({ toolId: 'stock-tracker', label: '2330 庫存', viewState: { sym: '2330' }, scrollY: 200 });
  hist.push({ toolId: 'goodstock', label: '選股結果', viewState: { mode: 'six' }, scrollY: 900 });
  hist.push({ toolId: 'twse-radar', label: '2026 日曆', viewState: { tab: 'calendar' }, scrollY: 300 });
  // Bounded at maxDepth = 3 (oldest 'hub' evicted)
  assert.equal(hist.size(), 3);
  assert.equal(hist.pop().toolId, 'twse-radar');
  assert.equal(hist.pop().label, '選股結果');
  assert.equal(hist.pop().toolId, 'stock-tracker');
  assert.equal(hist.canGoBack(), false);

  // Two-step confirm requires two clicks within timeout
  let confirmed = 0;
  const listeners = {};
  const classes = new Set();
  const mockBtn = {
    innerHTML: '刪除',
    textContent: '刪除',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c)
    },
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: (ev, fn) => { listeners[ev] = fn; }
  };
  bindTwoStepConfirm(mockBtn, {
    confirmText: '再點一次確認',
    timeoutMs: 5000,
    onConfirm: () => { confirmed += 1; }
  });
  const fakeEvent = { preventDefault: () => {}, stopPropagation: () => {} };
  listeners.click(fakeEvent);
  assert.equal(confirmed, 0);
  assert.equal(mockBtn.textContent, '再點一次確認');
  assert.equal(classes.has('btn-danger-confirm'), true);

  listeners.click(fakeEvent);
  assert.equal(confirmed, 1);
  assert.equal(classes.has('btn-danger-confirm'), false);
});

test('UX enhancements render contextual controls, sequential prev/next, local-update hooks, and shell nav wiring', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('id="btn-nav-back"'), 'Topbar contextual back button missing');
  assert.ok(html.includes('id="topbar-more-menu"'), 'Topbar overflow menu missing');
  assert.ok(html.includes('id="floating-nav-pill"'), 'Floating quick nav pill missing');
  assert.ok(html.includes("addEventListener('popstate'"), 'Browser popstate listener missing');

  // GoodStockUI: folded maintenance drawer + sequential prev/next from screener list
  const { GoodStockUI } = await import('../tools/goodstock/ui.js');
  const gs = new GoodStockUI();
  gs._universeTriggered = true;
  const mockContainer = () => ({ innerHTML: '', querySelector: () => null, querySelectorAll: () => [] });
  const cGsScreen = mockContainer();
  gs.render(cGsScreen, { stock: { overview: [], watchlist: [] } }, { getState: () => ({ stock: { overview: [], watchlist: [] } }) });
  assert.ok(cGsScreen.innerHTML.includes('id="btn-gs-toggle-maint"'));
  assert.ok(cGsScreen.innerHTML.includes('id="gs-maintenance-panel" hidden'));
  assert.ok(gs.lastScreenerCodes.length >= 2);

  const secondCode = gs.lastScreenerCodes[1];
  gs.openStockInfo(secondCode, 'all');
  const cGsInfo = mockContainer();
  gs.render(cGsInfo, { stock: { overview: [], watchlist: [] } }, { getState: () => ({ stock: { overview: [], watchlist: [] } }) });
  assert.ok(cGsInfo.innerHTML.includes('◀ 上一檔'));
  assert.ok(cGsInfo.innerHTML.includes('下一檔 ▶'));
  assert.ok(cGsInfo.innerHTML.includes(`2 / ${gs.lastScreenerCodes.length}`));

  // StockTrackerUI: snapshot roundtrip, Escape handling, and in-place rebalance markers
  const { StockTrackerUI } = await import('../tools/stock-tracker/ui.js');
  const st = new StockTrackerUI();
  st.activeTab = 'holdings';
  st.selectedSymbol = '2330.TW';
  const stSnap = st.getViewSnapshot();
  assert.equal(stSnap.label, '2330.TW 庫存');
  assert.equal(st.handleEscape(), true);
  assert.equal(st.selectedSymbol, null);
  st.restoreViewSnapshot(stSnap.state);
  assert.equal(st.selectedSymbol, '2330.TW');

  // AssetTrackerUI: in-place category selects & simulator IDs
  const { AssetTrackerUI } = await import('../tools/asset-tracker/ui.js');
  const at = new AssetTrackerUI();
  at.activeForm = 'expense';
  at.activeTab = 'fixed_sim';
  const cAt = mockContainer();
  at.render(cAt, { asset: { accounts: [], config: [], expenses: [], recentLogs: [], debts: [] } }, { getState: () => ({}) });
  assert.ok(cAt.innerHTML.includes('id="select-exp-sub"'));
  assert.ok(cAt.innerHTML.includes('id="sim-kpi-total"'));
  assert.ok(cAt.innerHTML.includes('id="asset-sub-tabs"'));
  assert.equal(at.handleEscape(), true);
  assert.equal(at.activeForm, null);

  // TwseRadarUI: sticky unsaved changes bar on settings tab & Escape clears focusDate
  const { TwseRadarUI } = await import('../tools/twse-radar/ui.js');
  const rd = new TwseRadarUI();
  rd._csvLoadedAttempted = true;
  rd.activeTab = 'settings';
  const cRd = mockContainer();
  rd.render(cRd, {}, {});
  assert.ok(cRd.innerHTML.includes('id="radar-dirty-bar" hidden'));
  rd.focusDate = '2026-01-05';
  assert.equal(rd.handleEscape(), true);
  assert.equal(rd.focusDate, null);
});

test('GoodStockCore aligns finmind-batch netProfitYoY/revM fields and evaluates inflection points', async () => {
  const { GoodStockCore } = await import('../tools/goodstock/core.js');
  const batchStock = {
    code: '9988',
    name: '批次財報對齊測試',
    industry: '半導體業',
    marketCap: 200,
    price: 150,
    pe: 15,
    yield: 4.5,
    dataSource: 'finmind-batch',
    monthlyRevenues: [
      { ym: '2026-05', revM: 100, yoy: 28 },
      { ym: '2026-06', revM: 110, yoy: 30 },
      { ym: '2026-07', revM: 115, yoy: 32 },
      { ym: '2026-08', revM: 120, yoy: 35 },
      { ym: '2026-09', revM: 125, yoy: 38 },
      { ym: '2026-10', revM: 130, yoy: 42 }
    ],
    quarters: [
      { q: '2025Q2', revM: 250, opMargin: 16, netMargin: 13, eps: 1.5, revYoY: 10, netProfitYoY: 15, invTurnover: 1.8, fcfM: 30 },
      { q: '2025Q3', revM: 280, opMargin: 17, netMargin: 14, eps: 1.8, revYoY: 20, netProfitYoY: 25, invTurnover: 1.9, fcfM: 35 },
      { q: '2025Q4', revM: 300, opMargin: 18, netMargin: 15, eps: 2.0, revYoY: 25, netProfitYoY: 55, invTurnover: 2.0, fcfM: 40 },
      { q: '2026Q1', revM: 320, opMargin: 19, netMargin: 16, eps: 2.2, revYoY: 30, netProfitYoY: 62, invTurnover: 2.1, fcfM: 45 },
      { q: '2026Q2', revM: 360, opMargin: 20, netMargin: 17, eps: 2.5, revYoY: 36, netProfitYoY: 75, invTurnover: 2.2, fcfM: 50 },
      { q: '2026Q3', revM: 400, opMargin: 21, netMargin: 18, eps: 3.0, revYoY: 42, netProfitYoY: 88, invTurnover: 2.3, fcfM: 60 }
    ]
  };

  const score = GoodStockCore.scoreSixIndicatorsAtWindow(batchStock, 0, 0);
  // netProfitYoY 62%, 75%, 88% (all >= 50%) MUST score 4.0, not fallback 2.0
  assert.equal(score.byKey.profitGrowth, 4.0);
  assert.equal(score.avgScore, 4.0);

  const growth = GoodStockCore.computeGrowthAnalysis(batchStock);
  assert.equal(growth.rows[0].latestVal, '400');
  assert.ok(growth.rows[0].qoq > 0, 'Quarterly revenue QoQ should read revM accurately');
});

test('GoodStockCore.rankTopPicks enforces gatekeepers, scores real universe cleanly, and renders Top Picks UI', async () => {
  const { GoodStockCore } = await import('../tools/goodstock/core.js');
  const { GoodStockUI } = await import('../tools/goodstock/ui.js');

  const uniJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/goodstock/tw-universe-index.json'), 'utf8'));
  const prevUni = GoodStockCore._universeIndex;
  try {
    GoodStockCore._universeIndex = uniJson;
    GoodStockCore.invalidateCache();

    const state = { stock: { overview: [], watchlist: [] } };
    const balanced = GoodStockCore.rankTopPicks(state, { style: 'balanced', limit: 20 });
    const growth = GoodStockCore.rankTopPicks(state, { style: 'growth', limit: 20 });
    const value = GoodStockCore.rankTopPicks(state, { style: 'value', limit: 20 });

    assert.equal(balanced.usingSeedFallback, false);
    assert.ok(balanced.syncedCount >= 300, `Expected >= 300 synced stocks, got ${balanced.syncedCount}`);
    assert.ok(balanced.eligibleCount > 0, 'Expected eligible stocks in real universe');
    assert.ok(balanced.items.length > 0 && balanced.items.length <= 20);
    assert.ok(balanced.marketMedianPe > 5 && balanced.marketMedianPe < 60);

    const fatalIds = new Set(GoodStockCore.FATAL_LANDMINE_IDS);
    for (let i = 0; i < balanced.items.length; i++) {
      const s = balanced.items[i];
      assert.equal(s.rankInfo.rank, i + 1);
      assert.ok(s.dataSource === 'finmind-batch' || s.dataSource === 'finmind-live');
      assert.ok(s.sixEval.current.avgScore >= 2.8);
      assert.ok(s.ttmEps > 0 && s.pe > 0 && s.marketCap >= 50);
      assert.ok(s.landmines.hitCount <= 1);
      assert.ok(!s.landmines.items.some((lm) => lm.hit && fatalIds.has(lm.id)), `Fatal landmine leaked on ${s.code}`);
      assert.ok(s.rankInfo.totalScore >= 0 && s.rankInfo.totalScore <= 100);
      assert.ok(s.rankInfo.reason.length > 10);
      assert.ok(s.rankInfo.tag.label.length > 0);
      assert.ok(Array.isArray(s.rankInfo.risks));
      if (i > 0) {
        assert.ok(balanced.items[i - 1].rankInfo.totalScore >= s.rankInfo.totalScore);
      }
    }

    // Value style must strictly enforce avgScore >= 3.0
    for (const s of value.items) {
      assert.ok(s.sixEval.current.avgScore >= 3.0, `Value pick ${s.code} had avgScore ${s.sixEval.current.avgScore} < 3.0`);
    }

    // Growth vs Value style should produce distinct weighted scores
    assert.ok(growth.weights.momentum > value.weights.momentum);
    assert.ok(value.weights.valuation > growth.weights.valuation);

    // Inflection filter in six_indicators mode
    const inflections = GoodStockCore.screenStocks(state, 'six_indicators', { scope: 'SYNCED_FIN', onlyInflection: true });
    for (const s of inflections) {
      assert.equal(s.isInflection, true);
      assert.ok(s.sixEval.prevQuarter.avgScore < 3.0 && s.sixEval.current.avgScore >= 3.0);
    }

    // UI renders Top Picks as default screener tab and wires inflection preset in six_indicators
    const ui = new GoodStockUI();
    ui._universeTriggered = true;
    assert.equal(ui.screenerMode, 'top_picks');
    const mockC = () => ({ innerHTML: '', querySelector: () => null, querySelectorAll: () => [] });
    const cTop = mockC();
    ui.render(cTop, state, { getState: () => state });
    assert.ok(cTop.innerHTML.includes('★ 系統精選排行'));
    assert.ok(cTop.innerHTML.includes('data-top-style="balanced"'));
    assert.ok(cTop.innerHTML.includes('data-top-style="growth"'));
    assert.ok(cTop.innerHTML.includes('data-top-style="value"'));
    assert.equal(ui.lastScreenerCodes.length, balanced.eligibleCount);

    ui.screenerMode = 'six_indicators';
    const cSix = mockC();
    ui.render(cSix, state, { getState: () => state });
    assert.ok(cSix.innerHTML.includes('data-six-preset="INFLECTION"'));
  } finally {
    GoodStockCore._universeIndex = prevUni;
    GoodStockCore.invalidateCache();
  }
});

test('StockCore.addTrade defaults TW broker to B and StockCore.updateTrade edits lots safely', async () => {
  const { StockCore } = await import('../tools/stock-tracker/core.js');
  const state = {
    stock: {
      settings: [],
      fx: [{ '採用': '32.5' }],
      overview: [],
      recentTrades: [],
      recentExits: []
    }
  };
  const mutations = [];
  const mockStore = {
    mutate(type, payload, updater) {
      mutations.push({ type, payload });
      updater(state);
    }
  };

  // TW stock without explicit broker should default to 'B'
  const twTrade = StockCore.addTrade(state, {
    symbol: '2330.TW',
    date: '2026-11-20',
    price: 1000,
    shares: 1000,
    type: '進攻型'
  }, mockStore);
  assert.equal(twTrade['市場'], 'TW');
  assert.equal(twTrade['券商'], 'B');

  // US stock without explicit broker should default to 'F'
  const usTrade = StockCore.addTrade(state, {
    symbol: 'NVDA',
    date: '2026-11-21',
    price: 140,
    shares: 10
  }, mockStore);
  assert.equal(usTrade['市場'], 'US');
  assert.equal(usTrade['券商'], 'F');

  // Add a partial exit of 400 shares on 2330.TW
  state.stock.recentExits.push({
    id: 'ex-1',
    '交易id': twTrade.id,
    '出場日': '2026-11-22',
    '出場價': '1050',
    '出場股數': '400'
  });

  // Attempting to reduce entry shares below exited shares (400) must throw
  assert.throws(() => {
    StockCore.updateTrade(state, {
      id: twTrade.id,
      price: 980,
      shares: 300
    }, mockStore);
  }, /不可小於此批次已出場股數/);

  // Valid update recalculates overview remaining shares, avg cost, and broker distribution
  const updated = StockCore.updateTrade(state, {
    id: twTrade.id,
    date: '2026-11-19',
    broker: 'B',
    type: '防禦型',
    price: 950,
    shares: 1200,
    note: '修正成交價'
  }, mockStore);

  assert.equal(updated['進場日'], '2026-11-19');
  assert.equal(updated['進場價'], '950');
  assert.equal(updated['進場股數'], '1200');
  assert.equal(updated['類型'], '防禦型');
  assert.equal(updated['備註'], '修正成交價');
  assert.equal(mutations.at(-1).type, 'stock.updateTrade');

  const ov = state.stock.overview.find((r) => r['代號'] === '2330.TW');
  assert.equal(ov['剩餘股數'], '800'); // 1200 - 400 exited
  assert.equal(ov['平均成本(原幣)'], '950');
  assert.equal(ov['類型'], '防禦型');
  assert.equal(ov['券商分佈'], 'B:800');
});

test('GAS doPost stock.updateTrade updates matching row in 交易明細 sheet', () => {
  const rows = [
    ['id', '建立時間', '類型', '市場', '券商', '代號', '進場日', '進場價', '進場股數', '備註'],
    ['tr-001', '2026-11-01 10:00', '進攻型', 'TW', 'B', '2330.TW', '2026-11-01', 1000, 1000, '原備註']
  ];
  let writtenRange = null;
  let writtenValues = null;
  const mockSheet = {
    getDataRange: () => ({ getValues: () => rows }),
    getRange: (r, c, numR, numC) => {
      writtenRange = { r, c, numR, numC };
      return {
        setValues: (vals) => { writtenValues = vals; }
      };
    }
  };
  const { ctx } = loadGasContext({
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name) => (name === '交易明細' ? mockSheet : null)
      })
    }
  });

  const res = JSON.parse(ctx.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'batchMutate',
        token: 'TEST_SECRET_TOKEN',
        mutations: [{
          id: 'mut-edit-1',
          type: 'stock.updateTrade',
          payload: {
            id: 'tr-001',
            '類型': '防禦型',
            '市場': 'TW',
            '券商': 'B',
            '代號': '2330.TW',
            '進場日': '2026-11-02',
            '進場價': '980',
            '進場股數': '1500',
            '備註': '已編輯'
          }
        }]
      })
    }
  })._text);

  assert.equal(res.ok, true);
  assert.deepEqual(res.syncedIds, ['mut-edit-1']);
  assert.deepEqual(writtenRange, { r: 2, c: 3, numR: 1, numC: 8 });
  assert.deepEqual(JSON.parse(JSON.stringify(writtenValues)), [['防禦型', 'TW', 'B', '2330.TW', '2026-11-02', 980, 1500, '已編輯']]);
});

test('TwseRadarUI renders clickable 5 factor cards and expands inline detail panel with normal standards', async () => {
  const { TwseRadarUI } = await import('../tools/twse-radar/ui.js');
  const ui = new TwseRadarUI();
  ui._csvLoadedAttempted = true;
  const mockContainer = () => ({ innerHTML: '', querySelector: () => null, querySelectorAll: () => [] });

  // Initial render: all 5 factor cards are clickable, detail panel closed
  const c0 = mockContainer();
  ui.render(c0, {}, null, () => {});
  for (const k of ['f1', 'f2', 'f3', 'f4', 'f5']) {
    assert.ok(c0.innerHTML.includes(`data-radar-factor="${k}"`), `Missing factor card ${k}`);
  }
  assert.ok(!c0.innerHTML.includes('id="radar-factor-detail-panel"'));

  // Select factor 1 -> inline detail panel renders normal standard & alert rule
  ui.selectedFactorKey = 'f1';
  const c1 = mockContainer();
  ui.render(c1, {}, null, () => {});
  assert.ok(c1.innerHTML.includes('id="radar-factor-detail-panel"'));
  assert.ok(c1.innerHTML.includes('正常標準'));
  assert.ok(c1.innerHTML.includes('觸發警戒條件'));
  assert.ok(c1.innerHTML.includes('外資空單+匯率'));

  // Escape key closes detail panel
  assert.equal(ui.handleEscape(), true);
  assert.equal(ui.selectedFactorKey, null);
});
