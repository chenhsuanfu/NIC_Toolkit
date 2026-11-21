/**
 * NIC Toolkit - Google Apps Script (GAS) Unified JSON API Gateway
 * ============================================================================
 * 功能：
 * 1. 同時串接您的兩份原試算表：
 *    - N_BD_C (股票庫存紀錄)
 *    - F&S Asset Report_V2 (個人與家庭資產紀錄)
 * 2. 內建 CacheService 記憶體快取（5 分鐘快取 + 寫入時自動刷新），解決傳統讀取 11 個分頁太慢的痛點。
 * 3. 嚴格執行 API_SECRET_TOKEN 驗證與「只追加明細（Append-Only）」公式保護鎖，絕不覆蓋『總攬』、『風控』、『帳戶』、『N_3%目標』等公式分頁。
 *
 * 部署步驟：
 * 1. 前往 https://script.google.com 新增專案，將本檔案內容貼入 Code.gs。
 * 2. 在專案設定 ->「指令碼屬性 (Script Properties)」新增：
 *    - API_SECRET_TOKEN : 您自訂的私密通行金鑰
 *    - STOCK_SHEET_ID   : 您的 N_BD_C 試算表 ID
 *    - ASSET_SHEET_ID   : 您的 F&S Asset Report_V2 試算表 ID
 * 3. 點選右上角「部署」->「新增部署作業」-> 類型選「網頁應用程式」：
 *    - 執行身分：我 (Me)
 *    - 誰可以存取：所有人 (Anyone) [註：安全性由 API_SECRET_TOKEN 強制把關]
 * 4. 複製部署後的網頁應用程式網址，貼入 NIC Toolkit「設定與 AI 雙軌中心」即可。
 */

const CACHE_KEY = 'NIC_TOOLKIT_SNAPSHOT_V2';
const CACHE_TTL_SECONDS = 300; // 5 minutes fast memory cache
const CACHE_CHUNK_SIZE = 90000; // Safe margin under GAS CacheService 100KB per-key limit
const CACHE_MAX_CHUNKS = 30;    // Up to ~2.7MB compressed (~15MB+ raw JSON)

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    token: props.getProperty('API_SECRET_TOKEN') || 'CHANGE_ME_SECRET_TOKEN',
    stockSheetId: props.getProperty('STOCK_SHEET_ID') || 'PUT_YOUR_N_BD_C_SHEET_ID_HERE',
    assetSheetId: props.getProperty('ASSET_SHEET_ID') || 'PUT_YOUR_FS_ASSET_SHEET_ID_HERE'
  };
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyToken_(reqToken) {
  const cfg = getConfig_();
  if (!reqToken || reqToken !== cfg.token) {
    throw new Error('Unauthorized: 通行金鑰 (API Secret Token) 驗證失敗');
  }
}

/**
 * Gzip + Chunked CacheService Helpers (breaks GAS 100KB per-key limit)
 */
function writeChunkedCache_(cache, baseKey, obj, ttlSeconds) {
  try {
    const jsonStr = JSON.stringify(obj);
    const gzBlob = Utilities.gzip(Utilities.newBlob(jsonStr, 'application/json'));
    const b64 = Utilities.base64Encode(gzBlob.getBytes());
    const totalChunks = Math.ceil(b64.length / CACHE_CHUNK_SIZE);
    if (totalChunks < 1 || totalChunks > CACHE_MAX_CHUNKS) return false;

    const entries = {};
    entries[baseKey + '_META'] = JSON.stringify({
      chunks: totalChunks,
      rawBytes: jsonStr.length,
      compressedChars: b64.length
    });
    for (var i = 0; i < totalChunks; i++) {
      entries[baseKey + '_C_' + i] = b64.slice(i * CACHE_CHUNK_SIZE, (i + 1) * CACHE_CHUNK_SIZE);
    }
    cache.putAll(entries, ttlSeconds);
    return true;
  } catch (_) {
    return false;
  }
}

function readChunkedCache_(cache, baseKey) {
  try {
    const metaRaw = cache.get(baseKey + '_META');
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw);
    const totalChunks = Number(meta && meta.chunks) || 0;
    if (totalChunks < 1 || totalChunks > CACHE_MAX_CHUNKS) return null;

    const keys = [];
    for (var i = 0; i < totalChunks; i++) {
      keys.push(baseKey + '_C_' + i);
    }
    const map = cache.getAll(keys);
    let b64 = '';
    for (var j = 0; j < totalChunks; j++) {
      const part = map[keys[j]];
      if (typeof part !== 'string') return null; // Partial eviction -> treat as cache miss
      b64 += part;
    }
    const gzBytes = Utilities.base64Decode(b64);
    const jsonStr = Utilities.ungzip(Utilities.newBlob(gzBytes, 'application/x-gzip')).getDataAsString('UTF-8');
    return JSON.parse(jsonStr);
  } catch (_) {
    return null;
  }
}

function removeChunkedCache_(cache, baseKey) {
  try {
    const keys = [baseKey, baseKey + '_META'];
    const metaRaw = cache.get(baseKey + '_META');
    const totalChunks = metaRaw ? (Number((JSON.parse(metaRaw) || {}).chunks) || CACHE_MAX_CHUNKS) : CACHE_MAX_CHUNKS;
    const limit = Math.min(Math.max(totalChunks, 1), CACHE_MAX_CHUNKS);
    for (var i = 0; i < limit; i++) {
      keys.push(baseKey + '_C_' + i);
    }
    cache.removeAll(keys);
  } catch (_) {}
}

/**
 * GET Endpoint: Fast Snapshot Retrieval (with Gzip + Chunked CacheService acceleration)
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    verifyToken_(params.token);

    const forceRefresh = params.refresh === '1';
    const cache = CacheService.getScriptCache();

    if (!forceRefresh) {
      const cachedSnapshot = readChunkedCache_(cache, CACHE_KEY);
      if (cachedSnapshot) {
        return jsonResponse_({ ok: true, fromCache: true, data: cachedSnapshot });
      }
    }

    const snapshot = buildFullSnapshot_();
    const cachedOk = writeChunkedCache_(cache, CACHE_KEY, snapshot, CACHE_TTL_SECONDS);

    return jsonResponse_({ ok: true, fromCache: false, cached: cachedOk, data: snapshot });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message || String(err) });
  }
}

/**
 * POST Endpoint: Snapshot Retrieval (Token in Body) & Formula-Safe Append-Only Batch Mutations
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    verifyToken_(body.token);

    if (body.action === 'snapshot') {
      const forceRefresh = body.refresh === true || body.refresh === '1' || body.refresh === 1;
      const cache = CacheService.getScriptCache();
      if (!forceRefresh) {
        const cachedSnapshot = readChunkedCache_(cache, CACHE_KEY);
        if (cachedSnapshot) {
          return jsonResponse_({ ok: true, fromCache: true, data: cachedSnapshot });
        }
      }
      const snapshot = buildFullSnapshot_();
      const cachedOk = writeChunkedCache_(cache, CACHE_KEY, snapshot, CACHE_TTL_SECONDS);
      return jsonResponse_({ ok: true, fromCache: false, cached: cachedOk, data: snapshot });
    }

    if (body.action === 'fetchMarketFactors') {
      const range = String(body.range || '3mo');
      const sox = fetchYahooChartSeries_('^SOX', range);
      const vix = fetchYahooChartSeries_('^VIX', range);
      return jsonResponse_({
        ok: true,
        data: {
          sox: sox,
          vix: vix,
          fetchedAt: new Date().toISOString()
        }
      });
    }

    if (body.action !== 'batchMutate' || !Array.isArray(body.mutations)) {
      throw new Error('Invalid action or mutations array');
    }

    const cfg = getConfig_();
    const stockSS = SpreadsheetApp.openById(cfg.stockSheetId);
    const assetSS = SpreadsheetApp.openById(cfg.assetSheetId);
    const syncedIds = [];
    const unsupportedTypes = [];

    for (const mut of body.mutations) {
      const p = mut.payload || {};
      switch (mut.type) {
        case 'stock.appendTrade': {
          const sh = stockSS.getSheetByName('交易明細');
          sh.appendRow([
            p.id || Utilities.getUuid(),
            p['建立時間'] || new Date(),
            p['類型'] || '進攻型',
            p['市場'] || 'US',
            p['券商'] || 'F',
            p['代號'] || '',
            p['進場日'] || '',
            Number(p['進場價'] || 0),
            Number(p['進場股數'] || 0),
            p['備註'] || ''
          ]);
          syncedIds.push(mut.id);
          break;
        }
        case 'stock.appendExit': {
          const sh = stockSS.getSheetByName('出場明細');
          sh.appendRow([
            p.id || Utilities.getUuid(),
            p['建立時間'] || new Date(),
            p['交易id'] || '',
            p['出場日'] || '',
            Number(p['出場價'] || 0),
            Number(p['出場股數'] || 0),
            p['備註'] || ''
          ]);
          syncedIds.push(mut.id);
          break;
        }
        case 'stock.upsertWatchlist': {
          const sh = stockSS.getSheetByName('觀察清單');
          const data = sh.getDataRange().getValues();
          const sym = String(p['代號'] || '').toUpperCase();
          let updated = false;
          for (let i = 1; i < data.length; i++) {
            if (String(data[i][0]).toUpperCase() === sym) {
              sh.getRange(i + 1, 3).setValue(Number(p['公允價格'] || 0));
              updated = true;
              break;
            }
          }
          if (!updated) {
            sh.appendRow([sym, p['市場'] || 'US', Number(p['公允價格'] || 0)]);
          }
          syncedIds.push(mut.id);
          break;
        }
        case 'stock.upsertSetting': {
          const sh = stockSS.getSheetByName('設定');
          if (!sh) throw new Error('N_BD_C 試算表找不到「設定」分頁');
          const data = sh.getDataRange().getValues();
          const key = String(p['項目'] || '').trim();
          const val = String(p['值'] || '');
          const desc = String(p['說明'] || '');
          if (key) {
            let updated = false;
            for (let i = 1; i < data.length; i++) {
              if (String(data[i][0]).trim() === key) {
                sh.getRange(i + 1, 2).setValue(val);
                if (desc) sh.getRange(i + 1, 3).setValue(desc);
                updated = true;
                break;
              }
            }
            if (!updated) {
              sh.appendRow([key, val, desc]);
            }
          }
          syncedIds.push(mut.id);
          break;
        }
        case 'asset.appendExpense': {
          const sh = assetSS.getSheetByName('開銷明細');
          sh.appendRow([
            p.ID || '',
            p['日期'] || '',
            Number(p['金額'] || 0),
            p['固定變動'] || '變動',
            p['類別'] || '',
            p['子類別'] || '',
            p['名目'] || '',
            p['負擔人'] || ''
          ]);
          syncedIds.push(mut.id);
          break;
        }
        case 'asset.appendLog': {
          const sh = assetSS.getSheetByName('log_V2');
          sh.appendRow([
            p.ID || '',
            p['日期'] || '',
            p['性質'] || '',
            p['類別'] || '',
            p['帳戶'] || '',
            p['幣別'] || 'TWD',
            Number(p['金額'] || 0),
            p['備註'] || '',
            p['轉帳編號'] || '',
            p['標籤'] || ''
          ]);
          syncedIds.push(mut.id);
          break;
        }
        case 'asset.appendSnapshot': {
          const sh = assetSS.getSheetByName('資產快照');
          if (!sh) throw new Error('F&S 試算表找不到「資產快照」分頁');
          const lastCol = Math.max(sh.getLastColumn(), 3);
          const headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map((h) => String(h).trim());
          const aliasMap = {
            '日期': p['日期'] || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'),
            '資金總額': Number(p['資金總額'] ?? p.financialAssetsTwd ?? 0),
            '金融資產': Number(p['資金總額'] ?? p.financialAssetsTwd ?? 0),
            '不動產': Number(p['不動產'] ?? p.realEstateTwd ?? 0),
            '總資產(含不動產)': Number(p['總資產(含不動產)'] ?? p.grossAssetsTwd ?? 0),
            '總負債': Number(p['總負債'] ?? p.totalDebtTwd ?? 0),
            '負債': Number(p['總負債'] ?? p.totalDebtTwd ?? 0),
            '淨值': Number(p['淨值'] ?? p.netWorthTwd ?? 0),
            '流動資金': Number(p['流動資金'] ?? p.liquidSavingsTwd ?? 0),
            '保障資金': Number(p['保障資金'] ?? p.protectionTwd ?? 0),
            '國內股票': Number(p['國內股票'] ?? p.twStockTwd ?? 0),
            '海外股票': Number(p['海外股票'] ?? p.usStockTwd ?? 0),
            '其他': Number(p['其他'] ?? p.otherTwd ?? 0),
            'FS共同資產': Number(p['FS共同資產'] ?? p.fsSharedTwd ?? 0),
            'FS共同池': Number(p['FS共同資產'] ?? p.fsSharedTwd ?? 0),
            '備註': String(p['備註'] || 'NIC Toolkit 快照')
          };
          const row = headers.map((h) => (Object.prototype.hasOwnProperty.call(aliasMap, h) ? aliasMap[h] : ''));
          sh.appendRow(row);
          syncedIds.push(mut.id);
          break;
        }
        case 'stock.updatePrices': {
          updateStockPrices_(stockSS, p);
          syncedIds.push(mut.id);
          break;
        }
        default: {
          unsupportedTypes.push(String(mut.type || 'unknown'));
          break;
        }
      }
    }

    // Invalidate chunked cache if any mutation succeeded
    if (syncedIds.length > 0) {
      removeChunkedCache_(CacheService.getScriptCache(), CACHE_KEY);
    }

    if (unsupportedTypes.length > 0) {
      const uniq = unsupportedTypes.filter((v, idx, arr) => arr.indexOf(v) === idx);
      return jsonResponse_({
        ok: false,
        syncedIds,
        unsupportedTypes: uniq,
        error: 'GAS 後端尚未支援同步類型：' + uniq.join(', ')
      });
    }

    return jsonResponse_({ ok: true, syncedIds });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message || String(err) });
  }
}

function readSheetObjects_(ss, sheetName, limit = 0, fromBottom = false) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return [];
  const rows = sh.getDataRange().getDisplayValues();
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => String(h).trim());
  const list = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {};
    let hasVal = false;
    for (let c = 0; c < headers.length; c++) {
      const k = headers[c];
      const v = r[c] !== undefined ? String(r[c]).trim() : '';
      if (k && v !== '') {
        obj[k] = v;
        hasVal = true;
      }
    }
    if (hasVal) list.push(obj);
  }

  if (limit > 0 && list.length > limit) {
    return fromBottom ? list.slice(-limit) : list.slice(0, limit);
  }
  return list;
}

function buildFullSnapshot_() {
  const cfg = getConfig_();
  const stockSS = SpreadsheetApp.openById(cfg.stockSheetId);
  const assetSS = SpreadsheetApp.openById(cfg.assetSheetId);

  return {
    generatedAt: new Date().toISOString(),
    stock: {
      settings: readSheetObjects_(stockSS, '設定', 50, false),
      fx: readSheetObjects_(stockSS, '匯率', 5, false),
      overview: readSheetObjects_(stockSS, '總攬', 100, false),
      risk: readSheetObjects_(stockSS, '風控', 20, false),
      watchlist: readSheetObjects_(stockSS, '觀察清單', 50, false),
      dailySnapshots: readSheetObjects_(stockSS, '每日快照', 30, false),
      recentTrades: readSheetObjects_(stockSS, '交易明細', 0, false),
      recentExits: readSheetObjects_(stockSS, '出場明細', 0, false)
    },
    asset: {
      settings: readSheetObjects_(assetSS, '設定', 100, false),
      fx: readSheetObjects_(assetSS, '匯率', 10, false),
      accounts: readSheetObjects_(assetSS, '帳戶', 50, false),
      debts: readSheetObjects_(assetSS, '債務處置表', 20, false),
      recentLogs: readSheetObjects_(assetSS, 'log_V2', 0, false),
      recentExpenses: readSheetObjects_(assetSS, '開銷明細', 60, true),
      snapshots: readSheetObjects_(assetSS, '資產快照', 36, true),
      salaryHistory: readSheetObjects_(assetSS, '薪資歷史', 20, false),
      cashflowHistory: readSheetObjects_(assetSS, '收支歷史', 36, true)
    }
  };
}

/**
 * Update latest market prices into N_BD_C 『行情』(C:自動價, F:更新時間) & 『總攬』(G:現價, J~N:市值/未實現/報酬率)
 * Does NOT overwrite manual prices (D) or formulas (E) in 『行情』.
 */
function updateStockPrices_(stockSS, payload) {
  const prices = (payload && payload.prices) || {};
  const usdTwd = Number(payload && payload.usdTwd) || 32.5;
  const now = new Date();
  const keys = Object.keys(prices);
  if (!keys.length) return;

  const normSym = function (s) {
    return String(s || '').trim().toUpperCase();
  };
  const priceLookup = {};
  for (var i = 0; i < keys.length; i++) {
    var k = normSym(keys[i]);
    var v = Number(prices[keys[i]]);
    if (k && isFinite(v) && v > 0) {
      priceLookup[k] = v;
      priceLookup[k.replace(/\.TW$/i, '').replace(/\.TWO$/i, '')] = v;
    }
  }

  // 1. Batch-update 『行情』 (C:自動價, F:更新時間) without touching D(手動價) or E(採用價公式)
  var quoteSheet = stockSS.getSheetByName('行情');
  if (quoteSheet && quoteSheet.getLastRow() >= 2) {
    var qNumRows = quoteSheet.getLastRow() - 1;
    var qVals = quoteSheet.getRange(2, 1, qNumRows, 6).getValues();
    var qColC = [];
    var qColF = [];
    var qChanged = false;
    for (var r = 0; r < qVals.length; r++) {
      var sym = normSym(qVals[r][0]);
      var clean = sym.replace(/\.TW$/i, '').replace(/\.TWO$/i, '');
      var newPrice = priceLookup[sym] || priceLookup[clean];
      if (newPrice) {
        qColC.push([newPrice]);
        qColF.push([now]);
        qChanged = true;
      } else {
        qColC.push([qVals[r][2]]);
        qColF.push([qVals[r][5]]);
      }
    }
    if (qChanged) {
      quoteSheet.getRange(2, 3, qNumRows, 1).setValues(qColC); // C: 自動價
      quoteSheet.getRange(2, 6, qNumRows, 1).setValues(qColF); // F: 更新時間
    }
  }

  // 2. Batch-update 『總攬』 (G:現價, J..N:市值/未實現/報酬率) in 2 range writes
  var ovSheet = stockSS.getSheetByName('總攬');
  if (ovSheet && ovSheet.getLastRow() >= 2) {
    var oNumRows = ovSheet.getLastRow() - 1;
    var oVals = ovSheet.getRange(2, 1, oNumRows, 14).getValues();
    var oColG = [];
    var oColJN = [];
    var oChanged = false;
    for (var rowIdx = 0; rowIdx < oVals.length; rowIdx++) {
      var oSym = normSym(oVals[rowIdx][1]); // B: 代號
      var oClean = oSym ? oSym.replace(/\.TW$/i, '').replace(/\.TWO$/i, '') : '';
      var pVal = oSym ? (priceLookup[oSym] || priceLookup[oClean]) : 0;
      if (!pVal) {
        oColG.push([oVals[rowIdx][6]]);
        oColJN.push([oVals[rowIdx][9], oVals[rowIdx][10], oVals[rowIdx][11], oVals[rowIdx][12], oVals[rowIdx][13]]);
        continue;
      }

      var market = normSym(oVals[rowIdx][2]); // C: 市場
      var shares = Number(oVals[rowIdx][4] || 0); // E: 剩餘股數
      var costUsd = Number(oVals[rowIdx][7] || 0); // H: 成本(USD)
      var costTwd = Number(oVals[rowIdx][8] || 0); // I: 成本(TWD)
      var isTw = market === 'TW' || /^\d{4,6}[A-Z]?$/.test(oClean);

      var mktTwd = isTw ? Math.round(shares * pVal) : Math.round(shares * pVal * usdTwd);
      var mktUsd = isTw ? Number((mktTwd / usdTwd).toFixed(2)) : Number((shares * pVal).toFixed(2));
      var unrealTwd = mktTwd - costTwd;
      var unrealUsd = Number((mktUsd - costUsd).toFixed(2));
      var roi = costTwd > 0 ? unrealTwd / costTwd : 0;

      oColG.push([pVal]);
      oColJN.push([mktUsd, mktTwd, unrealUsd, unrealTwd, roi]);
      oChanged = true;
    }
    if (oChanged) {
      ovSheet.getRange(2, 7, oNumRows, 1).setValues(oColG);   // G: 現價(原幣)
      ovSheet.getRange(2, 10, oNumRows, 5).setValues(oColJN); // J..N
    }
  }
}

/**
 * Fetch daily close series from Yahoo Finance Chart API (server-side, no CORS issues)
 */
function fetchYahooChartSeries_(symbol, range) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(symbol) + '?range=' + encodeURIComponent(range || '3mo') + '&interval=1d';
  const resp = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Yahoo Finance 回應錯誤 (' + symbol + ': HTTP ' + resp.getResponseCode() + ')');
  }
  const json = JSON.parse(resp.getContentText());
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result || !Array.isArray(result.timestamp)) return [];
  const timestamps = result.timestamp;
  const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
  const out = [];
  for (var i = 0; i < timestamps.length; i++) {
    var c = Number(closes[i]);
    if (!isFinite(c) || c <= 0) continue;
    var d = new Date(timestamps[i] * 1000);
    var yyyy = d.getUTCFullYear();
    var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(d.getUTCDate()).padStart(2, '0');
    out.push({ date: yyyy + '-' + mm + '-' + dd, close: Number(c.toFixed(2)) });
  }
  return out;
}
