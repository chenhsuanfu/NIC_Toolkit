import { agentBridge } from '../../core/agent-bridge.js';

export const RADAR_STORAGE_KEY = 'nic_twse_radar_v1';
export const LEGACY_TOKEN_KEY = 'twse_radar_finmind_token';

export const DEFAULT_PARAMS = {
  fwdDays: 15,
  crashPct: -6.5,
  window: 252,
  // 5 因子門檻 (100% 對齊 v4.0)
  futQ: 18,
  futDelta5d: -6000,   // 外資期貨 5 日淨空單急增門檻
  spotQ: 18,
  maLen: 20,
  confirmDays: 2,
  dropPct: -1.4,
  volMult: 1.15,
  volQ: 80,
  maintTh: 159,        // 估算融資維持率警戒線 (%)
  retDays: 10,
  // 6 大強化濾網開關
  useFutDelta: true,
  useFxConfirm: true,
  useUsFilter: true,
  useOtcSignal: true,
  useMa240Protect: true,
  useOversoldProtect: true,
  // 風險溫度計門檻與階梯倉位
  yellowScore: 55,     // >=55 黃燈減碼
  redScore: 80,        // >=80 紅燈重砍
  yellowPos: 55,
  redPos: 15,
  reentryDays: 2,
  feePct: 0.20
};

export const BOOL_PARAM_KEYS = new Set([
  'useFutDelta',
  'useFxConfirm',
  'useUsFilter',
  'useOtcSignal',
  'useMa240Protect',
  'useOversoldProtect'
]);

export const DEFAULT_DATA_META = {
  isReal: false,
  sourceName: '內建 v4.0 示範模擬',
  hasVolume: true,
  hasChip: true,
  hasOtc: true,
  hasUs: true,
  hasFx: true,
  hasRealMaint: false,
  priceOnly: false,
  autoVolComputed: false,
  updatedAt: null
};

// =========================================================================
// Pure Utility & Math Functions (Zero DOM Dependency)
// =========================================================================
export function createRNG(seed) {
  let a = seed >>> 0;
  const rand = () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randn = () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  };
  return { rand, randn };
}

export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseFlexibleDate(val) {
  if (val instanceof Date && !isNaN(val.getTime())) return formatDate(val);
  if (typeof val === 'number' && val > 20000 && val < 70000) {
    const utcDays = Math.floor(val - 25569);
    const dt = new Date(utcDays * 86400 * 1000);
    return formatDate(new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  }
  if (typeof val === 'string') {
    const clean = val.trim().replace(/\//g, '-').slice(0, 10);
    const d = new Date(clean);
    if (!isNaN(d.getTime())) return formatDate(d);
  }
  return null;
}

export function parseNum(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  const n = Number(String(v).replace(/,/g, '').trim());
  return isFinite(n) ? n : NaN;
}

export function quantileFromSorted(sortedArr, q) {
  const len = sortedArr.length;
  if (!len) return NaN;
  if (len === 1) return sortedArr[0];
  const pos = (len - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < len) return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
  return sortedArr[base];
}

export function buildRollingSortedWindows(arr, windowSize, minPeriods = 60) {
  const n = arr.length;
  const effMin = Math.min(minPeriods, windowSize);
  const windows = new Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const slice = [];
    for (let j = start; j <= i; j++) {
      const v = arr[j];
      if (!isNaN(v)) slice.push(v);
    }
    if (slice.length < effMin) {
      windows[i] = null;
    } else {
      slice.sort((a, b) => a - b);
      windows[i] = slice;
    }
  }
  return windows;
}

export function calcSMA(arr, period) {
  const n = arr.length;
  const out = new Float64Array(n).fill(NaN);
  let sum = 0, valid = 0;
  for (let i = 0; i < n; i++) {
    if (!isNaN(arr[i])) { sum += arr[i]; valid++; }
    if (i >= period && !isNaN(arr[i - period])) { sum -= arr[i - period]; valid--; }
    if (i >= period - 1 && valid >= Math.ceil(period * 0.7)) {
      out[i] = sum / valid;
    }
  }
  return out;
}

export function calcRollingSum(arr, period) {
  const n = arr.length;
  const out = new Float64Array(n).fill(NaN);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += isNaN(arr[i]) ? 0 : arr[i];
    if (i >= period) sum -= isNaN(arr[i - period]) ? 0 : arr[i - period];
    if (i >= period - 1) out[i] = sum;
  }
  return out;
}

export function computeRealizedVolatility(closeArr, period = 20) {
  const n = closeArr.length;
  const rets = new Float64Array(n).fill(0);
  for (let i = 1; i < n; i++) rets[i] = (closeArr[i] - closeArr[i - 1]) / closeArr[i - 1];
  const vol = new Float64Array(n).fill(15.0);
  let firstVal = 15.0;
  for (let i = period; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += rets[j];
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) { const d = rets[j] - mean; sq += d * d; }
    vol[i] = Math.sqrt(sq / (period - 1)) * Math.sqrt(252) * 100;
    if (i === period) firstVal = vol[i];
  }
  for (let i = 0; i < period && i < n; i++) vol[i] = firstVal;
  return vol;
}

// 估算大盤融資維持率 (依據 6 成融資初始 166.67% 與滾動成本加權)
export function computeEstimatedMaintRatio(closeArr, marginArr) {
  const n = closeArr.length;
  const out = new Float64Array(n).fill(168.0);
  if (!n) return out;
  let costBasis = closeArr[0];
  let prevM = isNaN(marginArr[0]) ? 2000 : marginArr[0];
  for (let i = 0; i < n; i++) {
    const c = closeArr[i];
    const m = isNaN(marginArr[i]) ? prevM : marginArr[i];
    if (i > 0) {
      if (m > prevM && m > 0) {
        const add = m - prevM;
        costBasis = (prevM * costBasis + add * c) / m;
      }
      // 自然換手衰減 (約對應近 30~40 交易日活躍融資籌碼)
      costBasis = costBasis * 0.965 + c * 0.035;
    }
    prevM = m;
    out[i] = 166.67 * (c / costBasis);
  }
  return out;
}

export function inferDataMeta(rawData, baseMeta = {}) {
  const n = Array.isArray(rawData) ? rawData.length : 0;
  if (!n) return { ...DEFAULT_DATA_META, ...baseMeta };
  const hasVolume = rawData.some((r) => Number.isFinite(parseNum(r.Volume)) && parseNum(r.Volume) > 0);
  const hasChip = rawData.filter((r) => Number.isFinite(parseNum(r.Foreign_Fut_OI))).length > n * 0.5;
  const hasOtc = rawData.filter((r) => Number.isFinite(parseNum(r.OTC_Close))).length > n * 0.5;
  const hasUs = rawData.filter((r) => Number.isFinite(parseNum(r.SOX_Close))).length > n * 0.5;
  const hasFx = rawData.filter((r) => Number.isFinite(parseNum(r.USD_TWD))).length > n * 0.5;
  const hasRealMaint = rawData.some((r) => Number.isFinite(parseNum(r.Margin_Maint_Ratio)));
  return {
    ...DEFAULT_DATA_META,
    ...baseMeta,
    hasVolume,
    hasChip,
    hasOtc,
    hasUs,
    hasFx,
    hasRealMaint,
    priceOnly: !hasChip
  };
}

export function parseCsvText(csvText, sourceName = '內建真實台股 CSV') {
  const lines = String(csvText || '').trim().split(/\r?\n/);
  if (lines.length < 85) return null;
  const headers = lines[0].split(',').map((h) => h.trim());
  const matchCol = (candidates) => {
    const lowerMap = {};
    headers.forEach((h, idx) => { lowerMap[h.toLowerCase()] = idx; });
    for (const c of candidates) if (lowerMap[c.toLowerCase()] !== undefined) return lowerMap[c.toLowerCase()];
    for (const c of candidates) {
      const hit = headers.findIndex((h) => h.toLowerCase().includes(c.toLowerCase()));
      if (hit >= 0) return hit;
    }
    return -1;
  };

  const iDate = matchCol(['date', '日期']);
  const iClose = matchCol(['close', '收盤', '加權']);
  const iVol = matchCol(['volume', '成交金額', '成交量']);
  const iFut = matchCol(['foreign_fut_oi', '期貨', '未平倉']);
  const iSpot = matchCol(['foreign_spot_net', '現貨', '買賣超']);
  const iMargin = matchCol(['margin_balance', '融資']);
  const iOtc = matchCol(['otc_close', 'otc', '櫃買', 'tpex']);
  const iFx = matchCol(['usd_twd', '匯率', 'twd']);
  const iSox = matchCol(['sox_close', 'sox', '費半']);
  const iVix = matchCol(['vix']);
  const iVolatility = matchCol(['volatility', '波動率']);
  const iMaint = matchCol(['margin_maint_ratio', '維持率']);
  if (iDate < 0 || iClose < 0) return null;

  const rows = [];
  const seen = new Set();
  for (let k = 1; k < lines.length; k++) {
    const cols = lines[k].split(',');
    const dt = parseFlexibleDate(cols[iDate]);
    const close = parseNum(cols[iClose]);
    if (!dt || !Number.isFinite(close) || close <= 0 || seen.has(dt)) continue;
    seen.add(dt);
    rows.push({
      Date: dt,
      Close: close,
      Volume: iVol >= 0 ? parseNum(cols[iVol]) : NaN,
      Foreign_Fut_OI: iFut >= 0 ? parseNum(cols[iFut]) : NaN,
      Foreign_Spot_Net: iSpot >= 0 ? (Number.isFinite(parseNum(cols[iSpot])) ? parseNum(cols[iSpot]) : 0) : 0,
      Margin_Balance: iMargin >= 0 ? parseNum(cols[iMargin]) : NaN,
      OTC_Close: iOtc >= 0 ? parseNum(cols[iOtc]) : NaN,
      USD_TWD: iFx >= 0 ? parseNum(cols[iFx]) : NaN,
      SOX_Close: iSox >= 0 ? parseNum(cols[iSox]) : NaN,
      VIX: iVix >= 0 ? parseNum(cols[iVix]) : NaN,
      Volatility: iVolatility >= 0 ? parseNum(cols[iVolatility]) : NaN,
      Margin_Maint_Ratio: iMaint >= 0 ? parseNum(cols[iMaint]) : NaN
    });
  }
  if (rows.length < 80) return null;
  rows.sort((a, b) => a.Date.localeCompare(b.Date));

  // Forward-fill & backfill optional series if > 50% populated (matches radar.html v4.0)
  const fillCol = (key) => {
    const validCount = rows.filter((r) => Number.isFinite(r[key])).length;
    if (validCount <= rows.length * 0.5) return false;
    const firstValid = rows.find((r) => Number.isFinite(r[key]))[key];
    let cur = firstValid;
    for (const r of rows) {
      if (Number.isFinite(r[key])) cur = r[key];
      else r[key] = cur;
    }
    return true;
  };
  fillCol('Foreign_Fut_OI');
  fillCol('Margin_Balance');
  fillCol('OTC_Close');
  fillCol('USD_TWD');
  fillCol('SOX_Close');
  fillCol('VIX');

  const needsVol = rows.some((r) => !Number.isFinite(r.Volatility));
  if (needsVol) {
    const realized = computeRealizedVolatility(rows.map((r) => r.Close), 20);
    for (let i = 0; i < rows.length; i++) {
      if (!Number.isFinite(rows[i].Volatility)) {
        rows[i].Volatility = Number(realized[i].toFixed(2));
      }
    }
  }

  const dataMeta = inferDataMeta(rows, {
    isReal: true,
    sourceName,
    autoVolComputed: needsVol,
    updatedAt: null
  });
  return { rawData: rows, dataMeta };
}

// =========================================================================
// v4.0 Demo Data Generator (Includes OTC, SOX, VIX, USD_TWD)
// =========================================================================
export function generateDemoData() {
  const rng = createRNG(202611204);
  const rawDates = [];
  const cur = new Date(2018, 0, 2);
  const end = new Date(2026, 10, 20);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) rawDates.push(formatDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  const dates = [];
  for (let i = 0; i < rawDates.length; i++) {
    if (i === rawDates.length - 1 || rng.rand() > 0.055) dates.push(rawDates[i]);
  }
  const len = dates.length;

  const crashes = [
    { start: Math.floor(len * 0.10), len: 22, drop: -0.145, pre: 6 },
    { start: Math.floor(len * 0.25), len: 16, drop: -0.265, pre: 5 },
    { start: Math.floor(len * 0.43), len: 14, drop: -0.115, pre: 5 },
    { start: Math.floor(len * 0.56), len: 42, drop: -0.245, pre: 7 },
    { start: Math.floor(len * 0.78), len: 14, drop: -0.155, pre: 5 },
    { start: Math.floor(len * 0.90), len: 13, drop: -0.118, pre: 5 }
  ];
  const fakeDrops = [
    { start: Math.floor(len * 0.34), len: 4 },
    { start: Math.floor(len * 0.68), len: 3 },
    { start: Math.floor(len * 0.84), len: 4 }
  ];

  const rows = [];
  let close = 10700;
  let otc = 148;
  let sox = 1350;
  let vix = 13.5;
  let fx = 29.8;
  let futOI = 42000;
  let spotNet = 10;
  let margin = 1720;
  let vol = 13.5;

  for (let i = 0; i < len; i++) {
    const d = dates[i];
    const progress = i / len;
    const scale = close / 12000;
    const structuralFutBase = 38000 - progress * 72000;

    let cr = null, pre = null, fake = null;
    for (const c of crashes) {
      if (i >= c.start && i < c.start + c.len) cr = c;
      else if (i >= c.start - c.pre && i < c.start) pre = c;
    }
    for (const f of fakeDrops) {
      if (i >= f.start && i < f.start + f.len) fake = f;
    }

    let ret = 0.00055 + rng.randn() * 0.0085;
    if (pre) ret = -0.0045 + rng.randn() * 0.009;
    else if (cr) ret = (cr.drop / cr.len) + rng.randn() * 0.0135;
    else if (fake) ret = -0.012 + rng.randn() * 0.006;

    close = Math.max(7000, close * (1 + ret));

    let otcRet = ret * 1.05 + rng.randn() * 0.006;
    if (pre) otcRet -= 0.009;
    else if (cr) otcRet -= 0.004;
    else if (fake) otcRet += 0.008;
    otc = Math.max(85, otc * (1 + otcRet));

    let soxRet = 0.0007 + rng.randn() * 0.015;
    if (pre) soxRet = -0.012 + rng.randn() * 0.014;
    else if (cr) soxRet = -0.018 + rng.randn() * 0.020;
    else if (fake) soxRet = 0.009 + rng.randn() * 0.008;
    sox = Math.max(800, sox * (1 + soxRet));

    let targetVix = 14.0 + Math.abs(soxRet) * 180;
    if (cr) targetVix = 29.0;
    else if (pre) targetVix = 22.5;
    else if (fake) targetVix = 13.8;
    vix = Math.max(10.5, 0.72 * vix + 0.28 * targetVix + rng.randn() * 0.9);

    let fxTarget = 30.8 + Math.sin(i / 280) * 1.3;
    if (cr) fxTarget += 0.95;
    else if (pre) fxTarget += 0.48;
    else if (fake) fxTarget -= 0.35;
    fx = Math.max(27.5, Math.min(33.6, 0.88 * fx + 0.12 * fxTarget + rng.randn() * 0.045));

    const baseVol = 1350 + (close - 10000) * 0.25;
    const volume = Math.max(700, baseVol * (ret <= -0.014 ? 1.42 : 1.0) * (cr ? 1.2 : 1.0) * (0.85 + rng.rand() * 0.30));

    let targetFut = structuralFutBase;
    if (cr) targetFut = structuralFutBase - 19000;
    else if (pre) targetFut = structuralFutBase - 13500;
    else if (fake) targetFut = structuralFutBase - 2500;
    futOI = 0.72 * futOI + 0.28 * targetFut + rng.randn() * 2900;

    let targetSpot = 15 * scale;
    if (cr) targetSpot = -195 * scale;
    else if (pre) targetSpot = -125 * scale;
    else if (fake) targetSpot = -75 * scale;
    spotNet = 0.30 * spotNet + 0.70 * targetSpot + rng.randn() * 82 * scale;

    let mChg = (ret > 0 ? 5.2 : -1.5) * scale + rng.randn() * 5.2 * scale;
    if (pre) mChg = 15.0 * scale;
    else if (cr) mChg = -8.5 * scale;
    margin = Math.max(1100, margin + mChg);

    let targetVol = 13.5 + Math.abs(ret) * 240;
    if (cr) targetVol = 26.0 + Math.abs(ret) * 310;
    else if (pre) targetVol = 21.0;
    else if (fake) targetVol = 18.0;
    vol = Math.max(9.5, 0.72 * vol + 0.28 * targetVol + rng.randn() * 1.2);

    rows.push({
      Date: d,
      Close: Number(close.toFixed(2)),
      Volume: Number(volume.toFixed(1)),
      Foreign_Fut_OI: Math.round(futOI),
      Foreign_Spot_Net: Number(spotNet.toFixed(1)),
      Margin_Balance: Number(margin.toFixed(1)),
      Volatility: Number(vol.toFixed(2)),
      OTC_Close: Number(otc.toFixed(2)),
      SOX_Close: Number(sox.toFixed(2)),
      VIX: Number(vix.toFixed(2)),
      USD_TWD: Number(fx.toFixed(3))
    });
  }
  return rows;
}

// =========================================================================
// v4.0 Core Quant Engine (0~100 Risk Thermometer + 5 Factors + 6 Filters)
// =========================================================================
export function buildPrecomputed(rawData, p) {
  const n = rawData.length;
  const close = rawData.map((r) => parseNum(r.Close));
  const volume = rawData.map((r) => parseNum(r.Volume));
  const futOI = rawData.map((r) => parseNum(r.Foreign_Fut_OI));
  const spotNet = rawData.map((r) => parseNum(r.Foreign_Spot_Net));
  const margin = rawData.map((r) => parseNum(r.Margin_Balance));
  const vol = rawData.map((r) => parseNum(r.Volatility));
  const otc = rawData.map((r) => parseNum(r.OTC_Close));
  const sox = rawData.map((r) => parseNum(r.SOX_Close));
  const vix = rawData.map((r) => parseNum(r.VIX));
  const fx = rawData.map((r) => parseNum(r.USD_TWD));

  const dailyRet = new Float64Array(n).fill(0);
  for (let i = 1; i < n; i++) dailyRet[i] = (close[i] - close[i - 1]) / close[i - 1];

  const spot5d = calcRollingSum(spotNet, 5);
  const futDelta5d = new Float64Array(n).fill(NaN);
  for (let i = 5; i < n; i++) {
    if (!isNaN(futOI[i]) && !isNaN(futOI[i - 5])) futDelta5d[i] = futOI[i] - futOI[i - 5];
  }

  const ma10 = calcSMA(close, 10);
  const ma20 = calcSMA(close, p.maLen);
  const ma240 = calcSMA(close, 240);
  const volMa = calcSMA(volume, p.maLen);

  // OTC 廣度與相對強弱比
  const otcMa20 = calcSMA(otc, 20);
  const otcRatio = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (!isNaN(otc[i]) && close[i] > 0) otcRatio[i] = otc[i] / close[i];
  const otcRatioMa20 = calcSMA(otcRatio, 20);

  // 美股 SOX 20MA 與 VIX 日漲幅
  const soxMa20 = calcSMA(sox, 20);
  const vixRet = new Float64Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (!isNaN(vix[i]) && !isNaN(vix[i - 1]) && vix[i - 1] > 0) vixRet[i] = (vix[i] - vix[i - 1]) / vix[i - 1];
  }

  // 新台幣匯率 20MA
  const fxMa20 = calcSMA(fx, 20);

  // 估算大盤融資維持率 (若有實測欄位則直用)
  const estMaint = rawData.some((r) => Number.isFinite(parseNum(r.Margin_Maint_Ratio)))
    ? rawData.map((r) => parseNum(r.Margin_Maint_Ratio))
    : computeEstimatedMaintRatio(close, margin);

  // 252 日滾動高點 (供年線低檔防誤殺判斷)
  const high252 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let mx = close[i];
    for (let j = Math.max(0, i - 251); j <= i; j++) if (close[j] > mx) mx = close[j];
    high252[i] = mx;
  }

  // 事後諸葛未來 N 日最大跌幅
  const maxFutureDrop = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n - 1; i++) {
    const endIdx = Math.min(n - 1, i + p.fwdDays);
    let minP = Infinity;
    for (let j = i + 1; j <= endIdx; j++) if (close[j] < minP) minP = close[j];
    maxFutureDrop[i] = (minP - close[i]) / close[i];
  }

  const consecAbove10 = new Uint16Array(n);
  const consecBelowMA = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    consecAbove10[i] = (!isNaN(ma10[i]) && close[i] > ma10[i]) ? (i > 0 ? consecAbove10[i - 1] + 1 : 1) : 0;
    consecBelowMA[i] = (!isNaN(ma20[i]) && close[i] < ma20[i]) ? (i > 0 ? consecBelowMA[i - 1] + 1 : 1) : 0;
  }

  return {
    n, close, volume, futOI, futDelta5d, spotNet, spot5d, margin, estMaint, vol,
    otc, otcMa20, otcRatio, otcRatioMa20, sox, soxMa20, vix, vixRet, fx, fxMa20,
    dailyRet, ma10, ma20, ma: ma20, ma240, volMa, high252, maxFutureDrop, consecAbove10, consecBelowMA,
    futWin: buildRollingSortedWindows(futOI, p.window, 60),
    spotWin: buildRollingSortedWindows(spot5d, p.window, 60),
    volWin: buildRollingSortedWindows(vol, p.window, 60)
  };
}

export function runQuantEngine(rawData, paramsIn = {}, dataMetaIn = DEFAULT_DATA_META, preIn = null) {
  const p = { ...DEFAULT_PARAMS, ...paramsIn };
  const meta = inferDataMeta(rawData, dataMetaIn);
  const pre = preIn || buildPrecomputed(rawData, p);
  const n = pre.n;
  const {
    close, volume, futOI, futDelta5d, spot5d, margin, estMaint, vol,
    otc, otcMa20, otcRatio, otcRatioMa20, sox, soxMa20, vix, vixRet, fx, fxMa20,
    dailyRet, ma20, ma240, volMa, high252, maxFutureDrop, consecAbove10, consecBelowMA,
    futWin, spotWin, volWin
  } = pre;

  const futQ = p.futQ / 100.0;
  const spotQ = p.spotQ / 100.0;
  const volQ = p.volQ / 100.0;
  const dropTh = p.dropPct / 100.0;
  const crashTh = p.crashPct / 100.0;

  const targetCrash = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!isNaN(maxFutureDrop[i]) && maxFutureDrop[i] <= crashTh) targetCrash[i] = 1;

  // 5 大強化因子燈號陣列 & 0~100 綜合風險溫度計
  const sig1 = new Uint8Array(n); // 1. 外資撤退 + 匯率確認
  const sig2 = new Uint8Array(n); // 2. 趨勢量價破線
  const sig3 = new Uint8Array(n); // 3. 波動恐慌 + 估算融資維持率
  const sig4 = new Uint8Array(n); // 4. OTC 櫃買廣度背離 (破拉積盤)
  const sig5 = new Uint8Array(n); // 5. 美股費半 SOX / VIX 濾網
  const riskScore = new Float64Array(n);
  const effLevel = new Uint8Array(n);      // 0=安全, 1=黃燈, 2=紅燈
  const regimeArr = new Uint8Array(n);     // 0=高位警戒, 1=中性, 2=低檔保護
  const filterBlocked = new Uint8Array(n); // 0=無, 1=美股強勢擋下, 2=年線低檔保護擋下, 3=負乖離超跌防追砍

  const futThArr = new Float64Array(n).fill(NaN);
  const spotThArr = new Float64Array(n).fill(NaN);
  const volThArr = new Float64Array(n).fill(NaN);

  const heavyDrop = new Uint8Array(n);
  for (let i = 1; i < n; i++) {
    const volCond = meta.hasVolume && !isNaN(volMa[i]) && !isNaN(volume[i])
      ? (volume[i] > volMa[i] * p.volMult) : true;
    if (dailyRet[i] <= dropTh && volCond) heavyDrop[i] = 1;
  }

  // 動態權重分配（對齊 v4.0 0~100 分）
  const activeOtc = meta.hasOtc && p.useOtcSignal;
  const activeUs = meta.hasUs && p.useUsFilter;
  const w1 = meta.hasChip ? 30 : 0;
  const w2 = 30;
  const w3 = 25;
  const w4 = activeOtc ? 15 : 0;
  const w5 = activeUs ? 20 : 0;
  const rawMax = Math.max(1, w1 + w2 + w3 + w4 + w5);
  const normScale = 100 / Math.min(100, rawMax);

  let filteredDaysCount = 0;

  for (let i = 0; i < n; i++) {
    // 1. 外資資金撤退（5日空單急增 + 現貨賣超 + 新台幣貶破月線確認）
    if (meta.hasChip && futWin[i] && spotWin[i] && !isNaN(futOI[i]) && !isNaN(spot5d[i])) {
      const fTh = quantileFromSorted(futWin[i], futQ);
      const sTh = quantileFromSorted(spotWin[i], spotQ);
      futThArr[i] = fTh;
      spotThArr[i] = sTh;

      const futSurge = p.useFutDelta
        ? (!isNaN(futDelta5d[i]) && futDelta5d[i] <= p.futDelta5d)
        : (futOI[i] < fTh);
      const futExtreme = futOI[i] < fTh;
      const spotBear = spot5d[i] < sTh;
      const fxBear = (!meta.hasFx || !p.useFxConfirm || isNaN(fxMa20[i])) ? true : (fx[i] > fxMa20[i]);

      if (spotBear && (futSurge || (futExtreme && !p.useFutDelta)) && fxBear) {
        sig1[i] = 1;
      }
    }

    // 2. 趨勢量價破線
    if (i >= 2 && !isNaN(ma20[i]) && !isNaN(ma20[i - 1])) {
      const hasHeavy3d = heavyDrop[i] || heavyDrop[i - 1] || heavyDrop[i - 2];
      if (consecBelowMA[i] >= p.confirmDays && ma20[i] < ma20[i - 1] && hasHeavy3d) {
        sig2[i] = 1;
      }
    }

    // 3. 波動恐慌 + 估算融資維持率 (多殺多斷頭警戒)
    if (i >= p.retDays && volWin[i]) {
      const vTh = quantileFromSorted(volWin[i], volQ);
      volThArr[i] = vTh;
      const retKd = (close[i] - close[i - p.retDays]) / close[i - p.retDays];
      const maintDanger = estMaint[i] < p.maintTh;
      const marginDiverge = meta.hasChip && !isNaN(margin[i]) && !isNaN(margin[i - p.retDays]) && (retKd < -0.01 && margin[i] > margin[i - p.retDays]);

      if ((vol[i] > vTh && (maintDanger || marginDiverge || retKd <= -0.025)) || (estMaint[i] < p.maintTh - 2.5)) {
        sig3[i] = 1;
      }
    }

    // 4. OTC 櫃買廣度背離（破拉積盤）
    if (activeOtc && i >= 1 && !isNaN(otcMa20[i]) && !isNaN(otcMa20[i - 1])) {
      const otcBreak = otc[i] < otcMa20[i] && otcMa20[i] < otcMa20[i - 1];
      const otcWeaker = !isNaN(otcRatioMa20[i]) && otcRatio[i] < otcRatioMa20[i];
      if (otcBreak && otcWeaker) sig4[i] = 1;
    }

    // 5. 美股費半 SOX / VIX 全球科技風險
    let usStrongBull = false;
    if (activeUs && i >= 1 && !isNaN(soxMa20[i]) && !isNaN(soxMa20[i - 1])) {
      const soxBear = sox[i] < soxMa20[i] && soxMa20[i] <= soxMa20[i - 1];
      const vixSpike = !isNaN(vix[i]) && (vixRet[i] >= 0.15 || vix[i] >= 22);
      if (soxBear || vixSpike) sig5[i] = 1;
      if (sox[i] > soxMa20[i] && soxMa20[i] > soxMa20[i - 1] && (isNaN(vix[i]) || (vix[i] < 17.5 && vixRet[i] < 0.10))) {
        usStrongBull = true;
      }
    }

    // 綜合 0~100 風險溫度計
    const rawPts = sig1[i] * w1 + sig2[i] * w2 + sig3[i] * w3 + sig4[i] * w4 + sig5[i] * w5;
    let score100 = Math.min(100, Math.round(rawPts * normScale));
    const preFilterScore = score100;
    if (activeUs && usStrongBull && score100 > 0) {
      score100 = Math.max(0, score100 - 20);
    }
    riskScore[i] = score100;

    // 大盤位階判斷（240MA 年線）
    const ddFromHigh = ((close[i] - high252[i]) / high252[i]) * 100;
    const isLowZone = !isNaN(ma240[i]) && close[i] < ma240[i] && ddFromHigh <= -15.0;
    const isHighZone = isNaN(ma240[i]) ? true : close[i] >= ma240[i];
    regimeArr[i] = isLowZone ? 2 : (isHighZone ? 0 : 1);

    let yTh = p.yellowScore;
    let rTh = p.redScore;
    if (p.useMa240Protect && isLowZone) {
      yTh = Math.min(95, p.redScore);
    }

    const bias20 = !isNaN(ma20[i]) ? ((close[i] - ma20[i]) / ma20[i]) * 100 : 0;
    let lv = 0;
    if (score100 >= rTh) lv = 2;
    else if (score100 >= yTh) lv = 1;

    if (lv === 0 && preFilterScore >= p.yellowScore) {
      filterBlocked[i] = (activeUs && usStrongBull) ? 1 : 2;
      filteredDaysCount++;
    } else if (lv === 1 && p.useOversoldProtect && bias20 <= -6.0) {
      lv = 0;
      filterBlocked[i] = 3;
      filteredDaysCount++;
    }

    effLevel[i] = lv;
  }

  // T+1 階梯減碼與狀態機
  const yellowPos = p.yellowPos / 100.0;
  const redPos = p.redPos / 100.0;
  const feeRate = p.feePct / 100.0;

  const position = new Float64Array(n);
  const bhEquity = new Float64Array(n);
  const stratEquity = new Float64Array(n);
  const bhDD = new Float64Array(n);
  const stratDD = new Float64Array(n);
  const actionTypeArr = new Uint8Array(n); // 0=無, 1=黃燈減碼, 2=紅燈重砍, 3=回補
  const actions = [];

  position[0] = 1.0; bhEquity[0] = 1.0; stratEquity[0] = 1.0;
  let peakBH = 1.0, peakSt = 1.0, inDefense = false, totalCostPct = 0;

  for (let i = 1; i < n; i++) {
    const prevLv = effLevel[i - 1];
    const prevPos = position[i - 1];
    let nextPos = prevPos;
    let actType = 0;

    if (prevLv === 2) {
      inDefense = true;
      if (prevPos > redPos + 1e-6) { nextPos = redPos; actType = 2; }
    } else if (prevLv === 1) {
      inDefense = true;
      if (prevPos > yellowPos + 1e-6) { nextPos = yellowPos; actType = 1; }
    } else if (prevLv === 0 && inDefense) {
      if (consecAbove10[i - 1] >= p.reentryDays && riskScore[i - 1] < 35) {
        inDefense = false;
        nextPos = 1.0;
        actType = 3;
      }
    } else if (!inDefense) {
      nextPos = 1.0;
    }

    position[i] = nextPos;
    actionTypeArr[i] = actType;

    const turnover = Math.abs(nextPos - prevPos);
    const fee = turnover > 1e-6 ? turnover * feeRate : 0;
    totalCostPct += fee * 100;

    bhEquity[i] = bhEquity[i - 1] * (1 + dailyRet[i]);
    stratEquity[i] = stratEquity[i - 1] * (1 + dailyRet[i] * nextPos - fee);

    if (bhEquity[i] > peakBH) peakBH = bhEquity[i];
    if (stratEquity[i] > peakSt) peakSt = stratEquity[i];
    bhDD[i] = ((bhEquity[i] - peakBH) / peakBH) * 100;
    stratDD[i] = ((stratEquity[i] - peakSt) / peakSt) * 100;

    if (actType > 0) {
      const si = i - 1;
      const subDrop = isNaN(maxFutureDrop[si]) ? null : maxFutureDrop[si] * 100;
      const isCut = actType === 1 || actType === 2;
      const hitCrash = isCut && subDrop !== null && subDrop <= p.crashPct;
      const labelMap = { 1: '黃燈減碼', 2: '紅燈重砍', 3: '警報解除回補' };

      const reasons = [];
      if (actType === 3) {
        reasons.push(`風險分降至 ${riskScore[si]} 且連 ${consecAbove10[si]} 日站上 10SMA`);
      } else {
        if (sig1[si]) reasons.push(`外資5日空單${Math.round(futDelta5d[si] || 0).toLocaleString()}口/現貨賣超`);
        if (sig2[si]) reasons.push(`連${consecBelowMA[si]}日破${p.maLen}MA帶量長黑`);
        if (sig3[si]) reasons.push(`波動飆升/維持率${estMaint[si].toFixed(0)}%`);
        if (sig4[si]) reasons.push('OTC櫃買領先破線');
        if (sig5[si]) reasons.push('美股費半/VIX轉空共振');
      }

      actions.push({
        id: `act-${i}`,
        execIdx: i,
        signalIdx: si,
        execDate: rawData[i].Date,
        signalDate: rawData[si].Date,
        type: actType,
        typeName: labelMap[actType],
        fromPos: Math.round(prevPos * 100),
        toPos: Math.round(nextPos * 100),
        execClose: close[i],
        signalClose: close[si],
        riskScore: riskScore[si],
        score: riskScore[si],
        signals: { s1: !!sig1[si], s2: !!sig2[si], s3: !!sig3[si], s4: !!sig4[si], s5: !!sig5[si] },
        reasonSummary: reasons.join(' ＋ '),
        subsequentDrop: subDrop,
        hitCrash
      });
    }
  }

  // 明日 T+1 行動指令判定
  const last = n - 1;
  const lastLv = effLevel[last];
  const currPos = position[last];
  let tomorrowAction = 'hold_full';
  let tomorrowPos = currPos;
  if (lastLv === 2) {
    tomorrowPos = redPos;
    tomorrowAction = currPos > redPos + 1e-6 ? 'cut_red' : 'hold_red';
  } else if (lastLv === 1) {
    tomorrowPos = Math.min(currPos, yellowPos);
    tomorrowAction = currPos > yellowPos + 1e-6 ? 'cut_yellow' : 'hold_defense';
  } else if (lastLv === 0 && inDefense) {
    if (consecAbove10[last] >= p.reentryDays && riskScore[last] < 35) {
      tomorrowPos = 1.0;
      tomorrowAction = 'buyback';
    } else {
      tomorrowAction = 'hold_defense';
    }
  } else if (inDefense) {
    tomorrowAction = 'hold_defense';
  } else {
    tomorrowPos = 1.0;
    tomorrowAction = 'hold_full';
  }

  // 命中率與樣本內(70%) / 樣本外(30%) 拆解統計
  const warmup = Math.min(60, Math.floor(n * 0.1));
  const validEnd = Math.max(warmup + 1, n - p.fwdDays);
  const splitIdx = Math.floor(warmup + (validEnd - warmup) * 0.70);
  const totalYears = Math.max(0.2, (n - 1) / 252);

  const validCuts = actions.filter((a) => (a.type === 1 || a.type === 2) && a.signalIdx >= warmup && a.signalIdx < validEnd);
  const hitCuts = validCuts.filter((a) => a.hitCrash).length;
  const actionPrecision = validCuts.length ? (hitCuts / validCuts.length) * 100 : 0;

  const isCuts = validCuts.filter((a) => a.signalIdx < splitIdx);
  const isHits = isCuts.filter((a) => a.hitCrash).length;
  const isPrecision = isCuts.length ? (isHits / isCuts.length) * 100 : null;

  const oosCuts = validCuts.filter((a) => a.signalIdx >= splitIdx);
  const oosHits = oosCuts.filter((a) => a.hitCrash).length;
  const oosPrecision = oosCuts.length ? (oosHits / oosCuts.length) * 100 : null;

  // 歷史大跌波段複盤
  const segments = [];
  let segS = -1, segE = -1;
  for (let i = warmup; i < validEnd; i++) {
    if (targetCrash[i] === 1) {
      if (segS === -1) { segS = i; segE = i; }
      else if (i - segE <= 10) segE = i;
      else { segments.push([segS, segE]); segS = i; segE = i; }
    }
  }
  if (segS !== -1) segments.push([segS, segE]);

  const crashWaves = segments.map(([sIdx, eIdx], idx) => {
    const peakScanStart = Math.max(0, sIdx - 5);
    const troughScanEnd = Math.min(n - 1, eIdx + p.fwdDays);
    let troughIdx = sIdx;
    for (let j = sIdx; j <= troughScanEnd; j++) if (close[j] < close[troughIdx]) troughIdx = j;
    let peakIdx = peakScanStart;
    for (let j = peakScanStart; j <= troughIdx; j++) if (close[j] > close[peakIdx]) peakIdx = j;

    const peakP = close[peakIdx], troughP = close[troughIdx];
    const maxDrop = ((troughP - peakP) / peakP) * 100;

    const scanStart = Math.max(1, Math.min(peakIdx, sIdx) - 3);
    let firstCutIdx = -1;
    for (let j = scanStart; j <= troughIdx; j++) {
      if (actionTypeArr[j] === 1 || actionTypeArr[j] === 2) { firstCutIdx = j; break; }
    }
    let alreadyInDefense = false;
    if (firstCutIdx === -1 && position[sIdx] < 0.99) { firstCutIdx = sIdx; alreadyInDefense = true; }

    const hit = firstCutIdx !== -1;
    const dropBeforeCut = hit ? ((close[firstCutIdx] - peakP) / peakP) * 100 : null;
    const avoidedDrop = hit ? ((troughP - close[firstCutIdx]) / close[firstCutIdx]) * 100 : null;

    return {
      id: idx + 1,
      peakIdx, troughIdx,
      peakDate: rawData[peakIdx].Date,
      troughDate: rawData[troughIdx].Date,
      maxDrop,
      hit,
      alreadyInDefense,
      firstCutIdx,
      firstCutDate: hit ? rawData[firstCutIdx].Date : null,
      dropBeforeCut,
      avoidedDrop
    };
  });

  const hitWavesArr = crashWaves.filter((w) => w.hit);
  const hitWaves = hitWavesArr.length;
  const eventRecall = crashWaves.length ? (hitWaves / crashWaves.length) * 100 : 0;
  const avgLeadDrop = hitWaves ? hitWavesArr.reduce((s, w) => s + w.dropBeforeCut, 0) / hitWaves : null;
  const avgAvoidDrop = hitWaves ? hitWavesArr.reduce((s, w) => s + w.avoidedDrop, 0) / hitWaves : null;

  const retBH = (bhEquity[n - 1] - 1) * 100;
  const retSt = (stratEquity[n - 1] - 1) * 100;
  const cagrBH = (Math.pow(Math.max(0.01, bhEquity[n - 1]), 1 / totalYears) - 1) * 100;
  const cagrSt = (Math.pow(Math.max(0.01, stratEquity[n - 1]), 1 / totalYears) - 1) * 100;
  let mddBH = 0, mddSt = 0;
  for (let i = 0; i < n; i++) {
    if (bhDD[i] < mddBH) mddBH = bhDD[i];
    if (stratDD[i] < mddSt) mddSt = stratDD[i];
  }
  const mddSavedPts = Math.abs(mddBH) - Math.abs(mddSt);
  const mddReductionPct = mddBH < -0.01 ? (mddSavedPts / Math.abs(mddBH)) * 100 : 0;
  const calmarBH = mddBH < -0.01 ? cagrBH / Math.abs(mddBH) : 0;
  const calmarSt = mddSt < -0.01 ? cagrSt / Math.abs(mddSt) : 0;

  return {
    pre, meta, n, warmup, validEnd, splitIdx, totalYears,
    targetCrash, sig1, sig2, sig3, sig4, sig5,
    riskScore, scoreArr: riskScore, effLevel, regimeArr, filterBlocked, filteredDaysCount,
    futThArr, spotThArr, volThArr,
    yellowTrigger: p.yellowScore, redTrigger: p.redScore,
    position, bhEquity, stratEquity, bhDD, stratDD,
    actionTypeArr, actions, totalCostPct,
    tomorrowAction, tomorrowPos, inDefenseAtEnd: inDefense,
    cutActionsValidCount: validCuts.length, hitCuts, actionPrecision,
    isCutsCount: isCuts.length, isHits, isPrecision,
    oosCutsCount: oosCuts.length, oosHits, oosPrecision,
    crashWaves, hitWaves, eventRecall, avgLeadDrop, avgAvoidDrop,
    retBH, retSt, cagrBH, cagrSt, mddBH, mddSt, mddSavedPts, mddReductionPct, calmarBH, calmarSt
  };
}

// =========================================================================
// FinMind API Fetcher (5 Factors + OTC TPEx + Preserve Existing US/FX)
// =========================================================================
export async function fetchFinMindEndpoint(dataset, startDate, endDate, token, dataId = null) {
  const params = new URLSearchParams({
    dataset,
    start_date: startDate,
    end_date: endDate
  });
  if (dataId) params.set('data_id', dataId);
  if (token) params.set('token', token);

  const url = `https://api.finmindtrade.com/api/v4/data?${params.toString()}`;
  const resp = await fetch(url, { method: 'GET', mode: 'cors' });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} (${resp.statusText || '請求遭拒或額度超限'})`);
  }
  const json = await resp.json();
  if (json.status !== 200) {
    throw new Error(json.msg || `FinMind API 狀態異常 (${json.status})`);
  }
  return Array.isArray(json.data) ? json.data : [];
}

export async function fetchAllFinMindFactors({ startDate = '2020-01-01', endDate = formatDate(new Date()), token = '', onStep = null, existingRows = null } = {}) {
  const notify = (step, status, ok = null) => {
    if (typeof onStep === 'function') onStep(step, status, ok);
  };

  notify(1, '抓取加權指數...');
  const priceRows = await fetchFinMindEndpoint('TaiwanStockPrice', startDate, endDate, token, 'TAIEX');
  if (!priceRows.length) throw new Error('TAIEX 加權指數回傳資料為空，請確認日期區間。');
  notify(1, `✅ 完成 (${priceRows.length} 筆)`, true);

  notify(2, '抓取外資現貨...');
  const instRows = await fetchFinMindEndpoint('TaiwanStockTotalInstitutionalInvestors', startDate, endDate, token);
  notify(2, `✅ 完成 (${instRows.length} 筆)`, true);

  notify(3, '抓取外資台指期...');
  const futRows = await fetchFinMindEndpoint('TaiwanFuturesInstitutionalInvestors', startDate, endDate, token, 'TX');
  notify(3, `✅ 完成 (${futRows.length} 筆)`, true);

  notify(4, '抓取大盤融資餘額...');
  const marginRows = await fetchFinMindEndpoint('TaiwanStockTotalMarginPurchaseShortSale', startDate, endDate, token);
  notify(4, `✅ 完成 (${marginRows.length} 筆)`, true);

  let otcRows = [];
  notify(5, '抓取 OTC 櫃買指數...');
  try {
    otcRows = await fetchFinMindEndpoint('TaiwanStockPrice', startDate, endDate, token, 'TPEx');
    notify(5, otcRows.length ? `✅ 完成 (${otcRows.length} 筆)` : '略過 (無資料)', true);
  } catch (_) {
    notify(5, '略過 (優雅降級)', true);
  }

  const spotMap = {}, futMap = {}, marginMap = {}, otcMap = {};
  for (const r of instRows) {
    const nm = String(r.name || '');
    if (nm.includes('Foreign')) {
      const net = (parseNum(r.buy) - parseNum(r.sell)) / 1e8;
      if (!isNaN(net)) spotMap[r.date] = (spotMap[r.date] || 0) + net;
    }
  }
  for (const r of futRows) {
    const inv = String(r.institutional_investors || r.name || '');
    if (inv.includes('外資') || inv.includes('Foreign')) {
      const oi = parseNum(r.long_open_interest_balance_volume) - parseNum(r.short_open_interest_balance_volume);
      if (!isNaN(oi)) futMap[r.date] = (futMap[r.date] || 0) + oi;
    }
  }
  for (const r of marginRows) {
    if (r.name === 'MarginPurchaseMoney') {
      const val = parseNum(r.TodayBalance) / 1e8;
      if (!isNaN(val)) marginMap[r.date] = val;
    }
  }
  for (const r of otcRows) {
    const c = parseNum(r.close);
    if (!isNaN(c)) otcMap[r.date] = c;
  }

  // Preserve historical SOX / VIX / USD_TWD from bundled CSV/cache if dates overlap
  const extMap = {};
  if (Array.isArray(existingRows)) {
    for (const r of existingRows) {
      if (r && r.Date) extMap[r.Date] = r;
    }
  }

  const merged = [];
  const seen = new Set();
  priceRows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let lFut = NaN, lSpot = 0, lMargin = NaN, lOtc = NaN;
  let lSox = NaN, lVix = NaN, lFx = NaN;
  for (const pRow of priceRows) {
    const dt = parseFlexibleDate(pRow.date);
    const c = parseNum(pRow.close);
    if (!dt || isNaN(c) || seen.has(dt)) continue;
    seen.add(dt);

    const tM = parseNum(pRow.Trading_money);
    const tV = parseNum(pRow.Trading_Volume);
    const volAmt = (!isNaN(tM) && tM > 0) ? tM / 1e8 : (!isNaN(tV) ? tV / 1e8 : NaN);

    const fOI = futMap[dt] !== undefined ? (lFut = futMap[dt]) : lFut;
    const sNet = spotMap[dt] !== undefined ? (lSpot = spotMap[dt]) : lSpot;
    const mBal = marginMap[dt] !== undefined ? (lMargin = marginMap[dt]) : lMargin;
    const oC = otcMap[dt] !== undefined ? (lOtc = otcMap[dt]) : (extMap[dt] && Number.isFinite(parseNum(extMap[dt].OTC_Close)) ? (lOtc = parseNum(extMap[dt].OTC_Close)) : lOtc);

    const prevExt = extMap[dt];
    if (prevExt) {
      if (Number.isFinite(parseNum(prevExt.SOX_Close))) lSox = parseNum(prevExt.SOX_Close);
      if (Number.isFinite(parseNum(prevExt.VIX))) lVix = parseNum(prevExt.VIX);
      if (Number.isFinite(parseNum(prevExt.USD_TWD))) lFx = parseNum(prevExt.USD_TWD);
    }

    merged.push({
      Date: dt,
      Close: Number(c.toFixed(2)),
      Volume: isNaN(volAmt) ? NaN : Number(volAmt.toFixed(1)),
      Foreign_Fut_OI: isNaN(fOI) ? NaN : Math.round(fOI),
      Foreign_Spot_Net: Number(sNet.toFixed(1)),
      Margin_Balance: isNaN(mBal) ? NaN : Number(mBal.toFixed(1)),
      Volatility: NaN,
      OTC_Close: isNaN(oC) ? NaN : Number(oC.toFixed(2)),
      SOX_Close: isNaN(lSox) ? NaN : Number(lSox.toFixed(2)),
      VIX: isNaN(lVix) ? NaN : Number(lVix.toFixed(2)),
      USD_TWD: isNaN(lFx) ? NaN : Number(lFx.toFixed(3))
    });
  }

  if (merged.length < 80) {
    throw new Error(`有效交易日不足（僅 ${merged.length} 筆），請拉長日期區間至少半年以上。`);
  }

  const realized = computeRealizedVolatility(merged.map((r) => r.Close), 20);
  for (let i = 0; i < merged.length; i++) merged[i].Volatility = Number(realized[i].toFixed(2));

  const hasChip = merged.filter((r) => !isNaN(r.Foreign_Fut_OI)).length > merged.length * 0.5;
  if (hasChip) {
    let cf = merged.find((r) => !isNaN(r.Foreign_Fut_OI)).Foreign_Fut_OI;
    let cm = merged.find((r) => !isNaN(r.Margin_Balance))?.Margin_Balance || 2000;
    for (const r of merged) {
      if (isNaN(r.Foreign_Fut_OI)) r.Foreign_Fut_OI = cf; else cf = r.Foreign_Fut_OI;
      if (isNaN(r.Margin_Balance)) r.Margin_Balance = cm; else cm = r.Margin_Balance;
    }
  }

  const dataMeta = inferDataMeta(merged, {
    isReal: true,
    sourceName: 'FinMind API',
    autoVolComputed: true,
    updatedAt: new Date().toISOString()
  });

  return { rawData: merged, dataMeta };
}

// =========================================================================
// Verdict Formatting Helper (v4.0 0~100 Risk Thermometer)
// =========================================================================
export function buildLatestSummary(rawData, params, dataMeta, resIn = null) {
  const res = resIn || runQuantEngine(rawData, params, dataMeta);
  const last = res.n - 1;
  const row = rawData[last];
  const score = Math.round(res.riskScore[last]);
  const maxScore = 100;
  const act = res.tomorrowAction;
  const targetPosPct = Math.round(res.tomorrowPos * 100);
  const meta = res.meta || inferDataMeta(rawData, dataMeta);

  let emoji = '🟢';
  let level = 'safe';
  let verdict = `安全持有（維持 ${targetPosPct}%）`;
  if (act === 'cut_red' || act === 'hold_red') {
    emoji = '🔴';
    level = 'red';
    const posTxt = targetPosPct < 0 ? `反向對沖 ${Math.abs(targetPosPct)}%` : `${targetPosPct}%`;
    verdict = act === 'cut_red' ? `明日開盤重砍至 ${posTxt}` : `維持紅燈防禦（${posTxt}）`;
  } else if (act === 'cut_yellow') {
    emoji = '🟡';
    level = 'yellow';
    verdict = `明日開盤減碼至 ${targetPosPct}%`;
  } else if (act === 'buyback') {
    emoji = '🟢';
    level = 'buyback';
    verdict = '警報解除・明日回補至 100%';
  } else if (act === 'hold_defense') {
    emoji = '🟠';
    level = 'defense';
    verdict = `維持減碼防禦（${targetPosPct}%）`;
  }

  const filterBlockMap = {
    1: '美股強勢抗洗盤擋下',
    2: '年線低檔保護擋下',
    3: '負乖離超跌防追砍擋下'
  };

  const activeFactorCount = (meta.hasChip ? 1 : 0) + 2 + (meta.hasOtc && params.useOtcSignal !== false ? 1 : 0) + (meta.hasUs && params.useUsFilter !== false ? 1 : 0);

  return {
    date: row.Date,
    close: row.Close,
    score,
    maxScore,
    emoji,
    level,
    verdict,
    tomorrowAction: act,
    tomorrowPosPct: targetPosPct,
    filterBlockedCode: res.filterBlocked[last],
    filterBlockedLabel: filterBlockMap[res.filterBlocked[last]] || null,
    regime: res.regimeArr[last],
    activeFactorCount,
    signals: {
      s1_foreignDualShort: res.sig1[last] === 1,
      s2_trendBreakdown: res.sig2[last] === 1,
      s3_panicVolatilityMargin: res.sig3[last] === 1,
      s4_otcDivergence: res.sig4[last] === 1,
      s5_usSoxVix: res.sig5[last] === 1
    },
    isReal: Boolean(meta.isReal),
    sourceName: meta.sourceName || '內建 v4.0 示範模擬',
    priceOnly: Boolean(meta.priceOnly),
    rowCount: rawData.length,
    updatedAt: meta.updatedAt || null
  };
}

// =========================================================================
// Local-First Cache & Dual-Track Core Facade
// =========================================================================
function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (_) {}
  return null;
}

function normalizeParams(raw = {}) {
  const out = { ...DEFAULT_PARAMS };
  for (const [k, v] of Object.entries(raw || {})) {
    if (!(k in DEFAULT_PARAMS)) continue;
    if (BOOL_PARAM_KEYS.has(k)) {
      out[k] = v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
    } else if (v !== '' && v !== null && v !== undefined && isFinite(Number(v))) {
      out[k] = Number(v);
    }
  }
  return out;
}

/**
 * Out-of-Sample Anti-Overfitting Grid Search (81 combinations)
 * Strictly ranks by In-Sample (first 70%) score while reporting OOS (last 30%) precision.
 */
export function runOosGridSearch(rawData, paramsIn = {}, dataMetaIn = DEFAULT_DATA_META) {
  const baseP = normalizeParams(paramsIn);
  const meta = inferDataMeta(rawData, dataMetaIn);
  const pre = buildPrecomputed(rawData, baseP);

  const futDeltas = [-4000, -6000, -9000];
  const maintList = [157, 159, 161];
  const confList = [1, 2, 3];
  const yScoreList = [50, 55, 65];

  const results = [];
  for (const fd of futDeltas) {
    for (const mt of maintList) {
      for (const cd of confList) {
        for (const ys of yScoreList) {
          const combo = { futDelta5d: fd, maintTh: mt, confirmDays: cd, yellowScore: ys };
          const r = runQuantEngine(rawData, { ...baseP, ...combo }, meta, pre);
          const isPrec = r.isPrecision !== null ? r.isPrecision : 0;
          const actPenalty = r.isCutsCount < 2 ? 0.4 : (r.actions.length / r.totalYears > 9 ? 0.8 : 1.0);
          const score = (isPrec * 0.55 + r.eventRecall * 0.25 + Math.max(0, r.mddReductionPct) * 0.20) * actPenalty;
          results.push({
            combo,
            isPrec: Number(isPrec.toFixed(1)),
            isCnt: r.isCutsCount,
            oosPrec: r.oosPrecision !== null ? Number(r.oosPrecision.toFixed(1)) : null,
            oosCnt: r.oosCutsCount,
            recall: Number(r.eventRecall.toFixed(1)),
            mddSt: Number(r.mddSt.toFixed(1)),
            trades: r.actions.length,
            score: Number(score.toFixed(2))
          });
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  const topResults = results.slice(0, 8).map((item, idx) => ({ rank: idx + 1, ...item }));

  return {
    combosCount: results.length,
    topResults,
    bestCombo: topResults[0]?.combo || null
  };
}

export const TwseRadarCore = {
  DEFAULT_PARAMS,

  loadCache() {
    const ls = safeStorage();
    let parsed = {};
    if (ls) {
      try {
        const raw = ls.getItem(RADAR_STORAGE_KEY);
        if (raw) parsed = JSON.parse(raw) || {};
      } catch (_) {}
    }

    let legacyToken = '';
    if (ls) {
      try {
        legacyToken = ls.getItem(LEGACY_TOKEN_KEY) || '';
      } catch (_) {}
    }

    const params = normalizeParams(parsed.params || {});
    const finmindToken = parsed.finmindToken || legacyToken || '';
    const rawData = Array.isArray(parsed.rawData) && parsed.rawData.length >= 80 ? parsed.rawData : null;
    const dataMeta = rawData ? inferDataMeta(rawData, parsed.dataMeta || {}) : { ...DEFAULT_DATA_META, ...(parsed.dataMeta || {}) };
    const latestSummary = parsed.latestSummary || null;

    return { params, finmindToken, rawData, dataMeta, latestSummary };
  },

  saveCache(patch = {}) {
    const ls = safeStorage();
    if (!ls) return;
    const current = this.loadCache();
    const next = {
      params: patch.params ? normalizeParams(patch.params) : current.params,
      finmindToken: patch.finmindToken !== undefined ? String(patch.finmindToken || '').trim() : current.finmindToken,
      rawData: patch.rawData !== undefined ? patch.rawData : current.rawData,
      dataMeta: patch.dataMeta !== undefined ? { ...DEFAULT_DATA_META, ...patch.dataMeta } : current.dataMeta,
      latestSummary: patch.latestSummary !== undefined ? patch.latestSummary : current.latestSummary
    };

    try {
      ls.setItem(RADAR_STORAGE_KEY, JSON.stringify(next));
      if (next.finmindToken) ls.setItem(LEGACY_TOKEN_KEY, next.finmindToken);
      else ls.removeItem(LEGACY_TOKEN_KEY);
    } catch (_) {
      try {
        const light = { ...next, rawData: null };
        ls.setItem(RADAR_STORAGE_KEY, JSON.stringify(light));
      } catch (_) {}
    }
  },

  getWorkingData() {
    const cache = this.loadCache();
    if (cache.rawData && cache.rawData.length >= 80) {
      return {
        rawData: cache.rawData,
        dataMeta: inferDataMeta(cache.rawData, cache.dataMeta),
        params: cache.params,
        finmindToken: cache.finmindToken
      };
    }
    const demo = generateDemoData();
    return {
      rawData: demo,
      dataMeta: inferDataMeta(demo, { ...DEFAULT_DATA_META }),
      params: cache.params,
      finmindToken: cache.finmindToken
    };
  },

  getLatestSignal() {
    const { rawData, dataMeta, params } = this.getWorkingData();
    const res = runQuantEngine(rawData, params, dataMeta);
    const summary = buildLatestSummary(rawData, params, dataMeta, res);
    this.saveCache({ latestSummary: summary });
    return summary;
  },

  getCachedSummaryFast() {
    const cache = this.loadCache();
    if (cache.latestSummary && cache.latestSummary.maxScore === 100) return cache.latestSummary;
    return this.getLatestSignal();
  },

  async refreshFromFinMind(opts = {}) {
    const cache = this.loadCache();
    const token = opts.token !== undefined ? String(opts.token).trim() : cache.finmindToken;
    const startDate = opts.startDate || '2020-01-01';
    const endDate = opts.endDate || formatDate(new Date());

    const { rawData, dataMeta } = await fetchAllFinMindFactors({
      startDate,
      endDate,
      token,
      onStep: opts.onStep,
      existingRows: cache.rawData
    });

    const res = runQuantEngine(rawData, cache.params, dataMeta);
    const summary = buildLatestSummary(rawData, cache.params, dataMeta, res);
    this.saveCache({
      finmindToken: token,
      rawData,
      dataMeta,
      latestSummary: summary
    });
    return { summary, rowCount: rawData.length, dataMeta };
  },

  runWhatIf(input = {}) {
    const { rawData, dataMeta, params } = this.getWorkingData();
    const res = runQuantEngine(rawData, params, dataMeta);
    const { pre, spotThArr, volThArr } = res;
    const meta = res.meta;
    const p = params;
    const i = pre.n - 1;
    const prevRow = rawData[i];

    const inClose = parseNum(input.close) || prevRow.Close;
    const inVol = parseNum(input.volume) || prevRow.Volume || 3500;
    const inFut = isNaN(parseNum(input.futOI)) ? prevRow.Foreign_Fut_OI : parseNum(input.futOI);
    const inSpot = isNaN(parseNum(input.spotNet)) ? 0 : parseNum(input.spotNet);
    const inOtc = parseNum(input.otc) || prevRow.OTC_Close;
    const inFx = parseNum(input.fx) || prevRow.USD_TWD;
    const inSox = parseNum(input.sox) || prevRow.SOX_Close;
    const inVix = parseNum(input.vix) || prevRow.VIX || 15;

    let prev4Spot = 0;
    for (let k = Math.max(0, i - 3); k <= i; k++) prev4Spot += isNaN(pre.spotNet[k]) ? 0 : pre.spotNet[k];
    const estSpot5d = prev4Spot + inSpot;
    const estFutDelta5d = (i >= 4 && !isNaN(pre.futOI[i - 4]) && !isNaN(inFut)) ? (inFut - pre.futOI[i - 4]) : 0;

    const oldOut = i >= p.maLen - 1 ? pre.close[i - p.maLen + 1] : prevRow.Close;
    const maPrev = pre.ma20[i] || prevRow.Close;
    const newMA = maPrev + (inClose - oldOut) / p.maLen;
    const estRet = (inClose - prevRow.Close) / prevRow.Close;

    const last20Rets = [];
    for (let k = Math.max(1, i - 18); k <= i; k++) last20Rets.push(pre.dailyRet[k]);
    last20Rets.push(estRet);
    const mR = last20Rets.reduce((a, b) => a + b, 0) / last20Rets.length;
    const sqR = last20Rets.reduce((a, b) => a + (b - mR) * (b - mR), 0);
    const estVol = Math.sqrt(sqR / Math.max(1, last20Rets.length - 1)) * Math.sqrt(252) * 100;
    const estMaintToday = pre.estMaint[i] * (inClose / prevRow.Close);

    const sTh = spotThArr[i];
    const vTh = volThArr[i];
    const vMa = pre.volMa[i] || inVol;
    const fxMa = pre.fxMa20[i];
    const otcMa = pre.otcMa20[i];
    const soxMa = pre.soxMa20[i];

    const fxBear = (!meta.hasFx || !p.useFxConfirm || isNaN(fxMa)) ? true : (inFx > fxMa);
    const s1 = meta.hasChip && !isNaN(sTh) && estSpot5d < sTh && (p.useFutDelta ? estFutDelta5d <= p.futDelta5d : true) && fxBear;
    const consecNew = inClose < newMA ? (pre.consecBelowMA[i] + 1) : 0;
    const todayHeavy = (estRet <= p.dropPct / 100) && (inVol > vMa * p.volMult);
    const prevHeavy = (pre.dailyRet[i] <= p.dropPct / 100) || (pre.dailyRet[i - 1] <= p.dropPct / 100);
    const s2 = consecNew >= p.confirmDays && newMA < maPrev && (todayHeavy || prevHeavy);
    const s3 = (!isNaN(vTh) && estVol > vTh && estMaintToday < p.maintTh) || estMaintToday < p.maintTh - 2.5;
    const s4 = meta.hasOtc && p.useOtcSignal && !isNaN(otcMa) && inOtc < otcMa && (inOtc / inClose < pre.otcRatioMa20[i]);
    const s5 = meta.hasUs && p.useUsFilter && !isNaN(soxMa) && (inSox < soxMa || inVix >= 22);
    const usStrongBull = meta.hasUs && p.useUsFilter && !isNaN(soxMa) && inSox > soxMa && inVix < 17.5;

    const activeOtc = meta.hasOtc && p.useOtcSignal;
    const activeUs = meta.hasUs && p.useUsFilter;
    const w1 = meta.hasChip ? 30 : 0;
    const w2 = 30;
    const w3 = 25;
    const w4 = activeOtc ? 15 : 0;
    const w5 = activeUs ? 20 : 0;
    const scale = 100 / Math.min(100, Math.max(1, w1 + w2 + w3 + w4 + w5));
    let score = Math.min(100, Math.round(((s1 ? w1 : 0) + (s2 ? w2 : 0) + (s3 ? w3 : 0) + (s4 ? w4 : 0) + (s5 ? w5 : 0)) * scale));
    if (usStrongBull && score > 0) score = Math.max(0, score - 20);

    let level = 'safe';
    let targetPosPct = 100;
    let verdict = `安全持有（風險 ${score} / 100 分）`;
    if (score >= p.redScore) {
      level = 'red';
      targetPosPct = p.redPos;
      const posTxt = p.redPos < 0 ? `反向對沖 ${Math.abs(p.redPos)}%` : `降至 ${p.redPos}%`;
      verdict = `紅燈重砍（風險 ${score} / 100 分）→ ${posTxt}`;
    } else if (score >= p.yellowScore) {
      level = 'yellow';
      targetPosPct = p.yellowPos;
      verdict = `黃燈減碼（風險 ${score} / 100 分）→ 降至 ${p.yellowPos}%`;
    }

    return {
      baseDate: prevRow.Date,
      score,
      maxScore: 100,
      level,
      verdict,
      targetPosPct,
      usStrongBull,
      estimatedDailyRetPct: Number((estRet * 100).toFixed(2)),
      estimated20dVolPct: Number(estVol.toFixed(2)),
      estimatedMaintRatio: Number(estMaintToday.toFixed(1)),
      estimatedSpot5d: Number(estSpot5d.toFixed(1)),
      estimatedFutDelta5d: Math.round(estFutDelta5d),
      signals: { s1, s2, s3, s4, s5 }
    };
  },

  getBacktestSummary(limitActions = 10) {
    const { rawData, dataMeta, params } = this.getWorkingData();
    const res = runQuantEngine(rawData, params, dataMeta);
    return {
      isReal: Boolean(res.meta.isReal),
      sourceName: res.meta.sourceName,
      dateRange: `${rawData[0].Date} ~ ${rawData[rawData.length - 1].Date}`,
      rowCount: rawData.length,
      kpis: {
        actionPrecisionPct: Number(res.actionPrecision.toFixed(2)),
        oosPrecisionPct: res.oosPrecision !== null ? Number(res.oosPrecision.toFixed(2)) : null,
        eventRecallPct: Number(res.eventRecall.toFixed(2)),
        totalActions: res.actions.length,
        filteredDaysCount: res.filteredDaysCount,
        bhReturnPct: Number(res.retBH.toFixed(2)),
        stratReturnPct: Number(res.retSt.toFixed(2)),
        bhMddPct: Number(res.mddBH.toFixed(2)),
        stratMddPct: Number(res.mddSt.toFixed(2)),
        mddReductionPct: Number(res.mddReductionPct.toFixed(2)),
        calmarBH: Number(res.calmarBH.toFixed(2)),
        calmarSt: Number(res.calmarSt.toFixed(2))
      },
      recentActions: res.actions.slice(-limitActions).reverse(),
      crashWaves: res.crashWaves
    };
  },

  updateParams(patch = {}, tokenOpt = undefined) {
    const cache = this.loadCache();
    const nextParams = normalizeParams({ ...cache.params, ...patch });
    const saveObj = { params: nextParams };
    if (tokenOpt !== undefined) saveObj.finmindToken = String(tokenOpt || '').trim();
    this.saveCache(saveObj);
    const summary = this.getLatestSignal();
    return { params: nextParams, latestSummary: summary };
  },

  runOosGridSearch(opts = {}) {
    const { rawData, dataMeta, params } = this.getWorkingData();
    const scan = runOosGridSearch(rawData, params, dataMeta);
    let applied = false;
    let latestSummary = null;
    if (opts.applyBest && scan.bestCombo) {
      const updated = this.updateParams(scan.bestCombo);
      applied = true;
      latestSummary = updated.latestSummary;
    }
    return {
      ...scan,
      applied,
      latestSummary
    };
  },

  setFinMindToken(token) {
    this.saveCache({ finmindToken: String(token || '').trim() });
    return this.loadCache().finmindToken;
  },

  exportPairingFragment() {
    const cache = this.loadCache();
    const customParams = {};
    for (const [k, v] of Object.entries(cache.params)) {
      if (v !== DEFAULT_PARAMS[k]) customParams[k] = v;
    }
    const out = {};
    if (cache.finmindToken) out.t = cache.finmindToken;
    if (Object.keys(customParams).length) out.p = customParams;
    return Object.keys(out).length ? out : null;
  },

  importPairingFragment(frag) {
    if (!frag || typeof frag !== 'object') return false;
    const patch = {};
    if (typeof frag.t === 'string' && frag.t.trim()) patch.finmindToken = frag.t.trim();
    if (frag.p && typeof frag.p === 'object') patch.params = normalizeParams({ ...DEFAULT_PARAMS, ...frag.p });
    if (Object.keys(patch).length) {
      this.saveCache(patch);
      return true;
    }
    return false;
  }
};

// =========================================================================
// Register Headless AI Agent Interface (Human-to-Agent Evolution)
// =========================================================================
agentBridge.registerModule('twse-radar', {
  description: 'TWSE 台股 v4.0 強化 5 因子減碼行動雷達（0~100 風險溫度計、明日 T+1 指令、FinMind 更新、What-If 盤後試算、回測績效與完整調參）',
  actions: {
    getLatestSignal: () => TwseRadarCore.getLatestSignal(),
    refreshFromFinMind: (_state, params = {}) => TwseRadarCore.refreshFromFinMind(params),
    runWhatIf: (_state, params = {}) => TwseRadarCore.runWhatIf(params),
    getBacktestSummary: (_state, params = {}) => TwseRadarCore.getBacktestSummary(params?.limitActions || 10),
    updateParams: (_state, params = {}) => TwseRadarCore.updateParams(params),
    runOosGridSearch: (_state, params = {}) => TwseRadarCore.runOosGridSearch(params)
  },
  schemas: [
    {
      name: 'getLatestSignal',
      description: '取得最新盤後資料之明日 T+1 減碼行動指令、0~100 風險溫度計、5 因子狀態與目標倉位',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'refreshFromFinMind',
      description: '直連 FinMind API 抓取最新台股多因子資料並更新本機快取',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: '起始日期 YYYY-MM-DD（預設 2020-01-01）' },
          endDate: { type: 'string', description: '結束日期 YYYY-MM-DD（預設今日）' },
          token: { type: 'string', description: '選填 FinMind API Token' }
        }
      }
    },
    {
      name: 'runWhatIf',
      description: '輸入今晚盤後預估數值進行 v4.0 8 因子 What-If 減碼試算',
      parameters: {
        type: 'object',
        properties: {
          close: { type: 'number', description: '今日預估加權指數收盤' },
          volume: { type: 'number', description: '今日預估成交金額（億元）' },
          futOI: { type: 'number', description: '今日外資台指期未平倉淨口數' },
          spotNet: { type: 'number', description: '今日外資現貨買賣超（億元）' },
          otc: { type: 'number', description: '今日 OTC 櫃買指數收盤' },
          fx: { type: 'number', description: '今日新台幣匯率 USD/TWD' },
          sox: { type: 'number', description: '前一日美股費半 SOX 收盤' },
          vix: { type: 'number', description: '前一日 VIX 恐慌指數' }
        }
      }
    },
    {
      name: 'getBacktestSummary',
      description: '取得避險回測績效 KPI、歷次大跌波段複盤與近期加減碼行動清單',
      parameters: {
        type: 'object',
        properties: {
          limitActions: { type: 'number', description: '回傳最近幾筆加減碼行動（預設 10）' }
        }
      }
    },
    {
      name: 'updateParams',
      description: '更新 v4.0 量化參數或強化濾網開關並即時重算明日減碼指令',
      parameters: {
        type: 'object',
        properties: {
          yellowScore: { type: 'number' },
          redScore: { type: 'number' },
          yellowPos: { type: 'number' },
          redPos: { type: 'number' },
          futQ: { type: 'number' },
          futDelta5d: { type: 'number' },
          spotQ: { type: 'number' },
          maLen: { type: 'number' },
          volQ: { type: 'number' },
          maintTh: { type: 'number' },
          useFutDelta: { type: 'boolean' },
          useFxConfirm: { type: 'boolean' },
          useUsFilter: { type: 'boolean' },
          useOtcSignal: { type: 'boolean' },
          useMa240Protect: { type: 'boolean' },
          useOversoldProtect: { type: 'boolean' }
        }
      }
    },
    {
      name: 'runOosGridSearch',
      description: '執行 81 組樣本外防過度擬合網格最佳化掃描，可選擇自動套用第 1 名最佳參數',
      parameters: {
        type: 'object',
        properties: {
          applyBest: { type: 'boolean', description: '是否自動將第 1 名最佳組合寫入參數設定並重算明日指令' }
        }
      }
    }
  ]
});
