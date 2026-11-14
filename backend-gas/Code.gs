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

const CACHE_KEY = 'NIC_TOOLKIT_SNAPSHOT_V1';
const CACHE_TTL_SECONDS = 300; // 5 minutes fast memory cache

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
 * GET Endpoint: Fast Snapshot Retrieval (with CacheService acceleration)
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    verifyToken_(params.token);

    const forceRefresh = params.refresh === '1';
    const cache = CacheService.getScriptCache();

    if (!forceRefresh) {
      const cached = cache.get(CACHE_KEY);
      if (cached) {
        return jsonResponse_({ ok: true, fromCache: true, data: JSON.parse(cached) });
      }
    }

    const snapshot = buildFullSnapshot_();
    try {
      cache.put(CACHE_KEY, JSON.stringify(snapshot), CACHE_TTL_SECONDS);
    } catch (_) {}

    return jsonResponse_({ ok: true, fromCache: false, data: snapshot });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message || String(err) });
  }
}

/**
 * POST Endpoint: Formula-Safe Append-Only Batch Mutations
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    verifyToken_(body.token);

    if (body.action !== 'batchMutate' || !Array.isArray(body.mutations)) {
      throw new Error('Invalid action or mutations array');
    }

    const cfg = getConfig_();
    const stockSS = SpreadsheetApp.openById(cfg.stockSheetId);
    const assetSS = SpreadsheetApp.openById(cfg.assetSheetId);
    const syncedIds = [];

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
      }
    }

    // Invalidate cache after writes
    CacheService.getScriptCache().remove(CACHE_KEY);

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
      recentTrades: readSheetObjects_(stockSS, '交易明細', 60, true),
      recentExits: readSheetObjects_(stockSS, '出場明細', 40, true)
    },
    asset: {
      settings: readSheetObjects_(assetSS, '設定', 100, false),
      fx: readSheetObjects_(assetSS, '匯率', 10, false),
      accounts: readSheetObjects_(assetSS, '帳戶', 50, false),
      debts: readSheetObjects_(assetSS, '債務處置表', 20, false),
      recentLogs: readSheetObjects_(assetSS, 'log_V2', 60, true),
      recentExpenses: readSheetObjects_(assetSS, '開銷明細', 60, true),
      snapshots: readSheetObjects_(assetSS, '資產快照', 36, true),
      salaryHistory: readSheetObjects_(assetSS, '薪資歷史', 20, false),
      cashflowHistory: readSheetObjects_(assetSS, '收支歷史', 36, true)
    }
  };
}
