import { agentBridge } from '../../core/agent-bridge.js';

export const RADAR_STORAGE_KEY = 'nic_twse_radar_v1';
export const LEGACY_TOKEN_KEY = 'twse_radar_finmind_token';

export const DEFAULT_PARAMS = {
  fwdDays: 15,
  crashPct: -7.0,
  window: 252,
  futQ: 15,
  spotQ: 15,
  maLen: 20,
  confirmDays: 2,
  dropPct: -1.5,
  volMult: 1.2,
  volQ: 85,
  retDays: 10,
  marginHighQ: 75,
  yellowPos: 55,
  redPos: 15,
  reentryDays: 2,
  feePct: 0.20
};

export const DEFAULT_DATA_META = {
  isReal: false,
  sourceName: '內建示範模擬',
  priceOnly: false,
  hasVolume: true,
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
    const v = arr[i];
    if (!isNaN(v)) { sum += v; valid++; }
    if (i >= period) {
      const old = arr[i - period];
      if (!isNaN(old)) { sum -= old; valid--; }
    }
    if (i >= period - 1 && valid === period) out[i] = sum / period;
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
    for (let j = i - period + 1; j <= i; j++) {
      const diff = rets[j] - mean;
      sq += diff * diff;
    }
    vol[i] = Math.sqrt(sq / (period - 1)) * Math.sqrt(252) * 100;
    if (i === period) firstVal = vol[i];
  }
  for (let i = 0; i < period && i < n; i++) vol[i] = firstVal;
  return vol;
}

// =========================================================================
// Built-in Demo Dataset Generator
// =========================================================================
export function generateDemoData() {
  const rng = createRNG(20261120);
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
    { start: '2018-10-01', end: '2018-10-29', drift: -0.0085, vol: 0.0165, mode: 'diverge' },
    { start: '2020-02-24', end: '2020-03-19', drift: -0.0155, vol: 0.0235, mode: 'margin_call' },
    { start: '2022-03-28', end: '2022-10-25', drift: -0.0026, vol: 0.0148, mode: 'diverge' },
    { start: '2024-07-12', end: '2024-08-06', drift: -0.0108, vol: 0.0215, mode: 'margin_call' },
    { start: '2025-03-04', end: '2025-04-09', drift: -0.0082, vol: 0.0185, mode: 'diverge' },
    { start: '2026-05-06', end: '2026-06-02', drift: -0.0076, vol: 0.0175, mode: 'margin_call' }
  ];

  const deadCat = [
    { start: '2022-05-24', end: '2022-05-30' },
    { start: '2022-07-22', end: '2022-08-03' }
  ];

  const activeCrash = new Array(len).fill(null);
  const preWarn = new Uint8Array(len);
  const isDC = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    const d = dates[i];
    for (const c of crashes) {
      if (d >= c.start && d <= c.end) {
        activeCrash[i] = c;
        for (let k = Math.max(0, i - 6); k < i; k++) if (!activeCrash[k]) preWarn[k] = 1;
      }
    }
    for (const dc of deadCat) {
      if (d >= dc.start && d <= dc.end) isDC[i] = 1;
    }
  }

  const rows = [];
  let close = 10700;
  let futOI = 18000;
  let spotNet = 15;
  let margin = 1750;
  let vol = 13.5;

  for (let i = 0; i < len; i++) {
    const d = dates[i];
    const cr = activeCrash[i];
    const pre = preWarn[i] === 1;
    const dc = isDC[i] === 1;

    let drift = 0.00062;
    let sigma = 0.0080;
    if (dc) {
      drift = 0.009;
      sigma = 0.0085;
    } else if (cr) {
      drift = cr.drift;
      sigma = cr.vol;
    } else if (d >= '2020-03-20' && d <= '2020-07-24') {
      drift = 0.0038;
      sigma = 0.011;
    } else if (d >= '2026-11-12') {
      drift = 0.0008;
      sigma = 0.0075;
    }

    let ret = drift + sigma * rng.randn();
    if (cr && !dc && rng.rand() < 0.28) ret = Math.min(ret, -0.0175 - rng.rand() * 0.016);
    if (cr && i > 0 && !activeCrash[i - 1]) ret = -0.021;

    close = Math.max(7800, close * Math.exp(ret));
    const scale = close / 14000;

    const baseVol = 1300 + (close - 10000) * 0.25;
    const volume = Math.max(700, baseVol * (ret <= -0.015 ? 1.42 : 1.0) * (cr && !dc ? 1.2 : 1.0) * (0.84 + rng.rand() * 0.32));

    let targetFut = 10000 - (i / len) * 28000;
    if (cr && !dc) targetFut = -44000 - (i / len) * 10000;
    else if (pre) targetFut = -35000 - (i / len) * 8000;
    else if (dc) targetFut = -26000;
    futOI = 0.80 * futOI + 0.20 * targetFut + rng.randn() * 5200;

    let targetSpot = 16 * scale;
    if (cr && !dc) targetSpot = -185 * scale;
    else if (pre) targetSpot = -130 * scale;
    else if (dc) targetSpot = -40 * scale;
    spotNet = 0.30 * spotNet + 0.70 * targetSpot + rng.randn() * 95 * scale;

    let mChg = (ret > 0 ? 5.5 : -1.5) * scale + rng.randn() * 6.0 * scale;
    if (pre) mChg = 16.0 * scale;
    else if (cr && !dc) mChg = cr.mode === 'margin_call' ? -14.0 * scale : (rng.rand() < 0.78 ? 11.5 : -6.0) * scale;
    margin = Math.max(1050, margin + mChg);

    let targetVol = 13.8 + Math.abs(ret) * 260;
    if (cr && !dc) targetVol = 26.5 + Math.abs(ret) * 320;
    else if (pre) targetVol = 21.0;
    else if (dc) targetVol = 21.5;
    vol = Math.max(9.5, 0.70 * vol + 0.30 * targetVol + rng.randn() * 1.3);

    rows.push({
      Date: d,
      Close: Number(close.toFixed(2)),
      Volume: Number(volume.toFixed(1)),
      Foreign_Fut_OI: Math.round(futOI),
      Foreign_Spot_Net: Number(spotNet.toFixed(1)),
      Margin_Balance: Number(margin.toFixed(1)),
      Volatility: Number(vol.toFixed(2))
    });
  }
  return rows;
}

// =========================================================================
// Core Quant Engine (T+1 Anti-Lookahead + Action State Extraction)
// =========================================================================
export function buildPrecomputed(rawData, p) {
  const n = rawData.length;
  const close = rawData.map((r) => r.Close);
  const volume = rawData.map((r) => (r.Volume === null || isNaN(r.Volume) ? NaN : r.Volume));
  const futOI = rawData.map((r) => (r.Foreign_Fut_OI === null || isNaN(r.Foreign_Fut_OI) ? NaN : r.Foreign_Fut_OI));
  const spotNet = rawData.map((r) => (r.Foreign_Spot_Net === null || isNaN(r.Foreign_Spot_Net) ? NaN : r.Foreign_Spot_Net));
  const margin = rawData.map((r) => (r.Margin_Balance === null || isNaN(r.Margin_Balance) ? NaN : r.Margin_Balance));
  const vol = rawData.map((r) => r.Volatility);

  const dailyRet = new Float64Array(n).fill(0);
  for (let i = 1; i < n; i++) dailyRet[i] = (close[i] - close[i - 1]) / close[i - 1];

  const spot5d = calcRollingSum(spotNet, 5);
  const ma10 = calcSMA(close, 10);
  const ma = calcSMA(close, p.maLen);
  const volMa = calcSMA(volume, p.maLen);

  const maxFutureDrop = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n - 1; i++) {
    const endIdx = Math.min(n - 1, i + p.fwdDays);
    let minP = Infinity;
    for (let j = i + 1; j <= endIdx; j++) if (close[j] < minP) minP = close[j];
    maxFutureDrop[i] = (minP - close[i]) / close[i];
  }

  const consecAbove10 = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    if (!isNaN(ma10[i]) && close[i] > ma10[i]) {
      consecAbove10[i] = i > 0 ? consecAbove10[i - 1] + 1 : 1;
    } else {
      consecAbove10[i] = 0;
    }
  }

  const consecBelowMA = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    if (!isNaN(ma[i]) && close[i] < ma[i]) {
      consecBelowMA[i] = i > 0 ? consecBelowMA[i - 1] + 1 : 1;
    } else {
      consecBelowMA[i] = 0;
    }
  }

  return {
    n, close, volume, futOI, spotNet, spot5d, margin, vol,
    dailyRet, ma10, ma, volMa, maxFutureDrop, consecAbove10, consecBelowMA,
    futWin: buildRollingSortedWindows(futOI, p.window, 60),
    spotWin: buildRollingSortedWindows(spot5d, p.window, 60),
    volWin: buildRollingSortedWindows(vol, p.window, 60),
    marginWin: buildRollingSortedWindows(margin, p.window, 60)
  };
}

export function runQuantEngine(rawData, p, dataMeta = DEFAULT_DATA_META, preIn = null) {
  const pre = preIn || buildPrecomputed(rawData, p);
  const n = pre.n;
  const {
    close, volume, futOI, spot5d, margin, vol,
    dailyRet, ma10, ma, volMa, maxFutureDrop, consecAbove10, consecBelowMA,
    futWin, spotWin, volWin, marginWin
  } = pre;

  const priceOnly = Boolean(dataMeta?.priceOnly);
  const hasVolume = dataMeta?.hasVolume !== false;

  const futQ = p.futQ / 100.0;
  const spotQ = p.spotQ / 100.0;
  const volQ = p.volQ / 100.0;
  const marginHighQ = p.marginHighQ / 100.0;
  const dropTh = p.dropPct / 100.0;
  const crashTh = p.crashPct / 100.0;

  const targetCrash = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!isNaN(maxFutureDrop[i]) && maxFutureDrop[i] <= crashTh) targetCrash[i] = 1;
  }

  const sig1 = new Uint8Array(n);
  const sig2 = new Uint8Array(n);
  const sig3 = new Uint8Array(n);
  const scoreArr = new Uint8Array(n);

  const futThArr = new Float64Array(n).fill(NaN);
  const spotThArr = new Float64Array(n).fill(NaN);
  const volThArr = new Float64Array(n).fill(NaN);
  const marginThArr = new Float64Array(n).fill(NaN);

  const heavyDrop = new Uint8Array(n);
  for (let i = 1; i < n; i++) {
    const volCond = hasVolume && !isNaN(volMa[i]) && !isNaN(volume[i])
      ? (volume[i] > volMa[i] * p.volMult)
      : true;
    if (dailyRet[i] <= dropTh && volCond) heavyDrop[i] = 1;
  }

  for (let i = 0; i < n; i++) {
    if (!priceOnly && futWin[i] && spotWin[i] && !isNaN(futOI[i]) && !isNaN(spot5d[i])) {
      const fTh = quantileFromSorted(futWin[i], futQ);
      const sTh = quantileFromSorted(spotWin[i], spotQ);
      futThArr[i] = fTh;
      spotThArr[i] = sTh;
      if (futOI[i] < fTh && spot5d[i] < sTh) sig1[i] = 1;
    }

    if (i >= 2 && !isNaN(ma[i]) && !isNaN(ma[i - 1])) {
      const hasHeavy3d = heavyDrop[i] || heavyDrop[i - 1] || heavyDrop[i - 2];
      if (consecBelowMA[i] >= p.confirmDays && ma[i] < ma[i - 1] && hasHeavy3d) {
        sig2[i] = 1;
      }
    }

    if (i >= p.retDays && volWin[i]) {
      const vTh = quantileFromSorted(volWin[i], volQ);
      volThArr[i] = vTh;
      const retKd = (close[i] - close[i - p.retDays]) / close[i - p.retDays];

      if (!priceOnly && marginWin[i] && !isNaN(margin[i])) {
        const mTh = quantileFromSorted(marginWin[i], marginHighQ);
        marginThArr[i] = mTh;
        const mChg = margin[i] - margin[i - p.retDays];
        const diverge = (retKd < 0 && mChg > 0);
        const highLevel = (margin[i] > mTh);
        if (vol[i] > vTh && (diverge || highLevel)) sig3[i] = 1;
      } else {
        if (vol[i] > vTh && retKd <= -0.02) sig3[i] = 1;
      }
    }

    scoreArr[i] = sig1[i] + sig2[i] + sig3[i];
  }

  const yellowPos = p.yellowPos / 100.0;
  const redPos = p.redPos / 100.0;
  const feeRate = p.feePct / 100.0;

  const yellowTrigger = priceOnly ? 1 : 2;
  const redTrigger = priceOnly ? 2 : 3;

  const position = new Float64Array(n);
  const bhEquity = new Float64Array(n);
  const stratEquity = new Float64Array(n);
  const bhDD = new Float64Array(n);
  const stratDD = new Float64Array(n);
  const stratDailyRet = new Float64Array(n);

  const actionTypeArr = new Uint8Array(n);
  const actions = [];

  position[0] = 1.0;
  bhEquity[0] = 1.0;
  stratEquity[0] = 1.0;
  let peakBH = 1.0, peakSt = 1.0;
  let inDefense = false;
  let totalCostPct = 0;

  for (let i = 1; i < n; i++) {
    const prevSc = scoreArr[i - 1];
    const prevPos = position[i - 1];
    let nextPos = prevPos;
    let actType = 0;

    if (prevSc >= redTrigger) {
      inDefense = true;
      if (prevPos > redPos + 1e-6) {
        nextPos = redPos;
        actType = 2;
      }
    } else if (prevSc >= yellowTrigger) {
      inDefense = true;
      if (prevPos > yellowPos + 1e-6) {
        nextPos = yellowPos;
        actType = 1;
      }
    } else if (prevSc === 0 && inDefense) {
      if (consecAbove10[i - 1] >= p.reentryDays) {
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
    let fee = 0;
    if (turnover > 1e-6) {
      fee = turnover * feeRate;
      totalCostPct += fee * 100;
    }

    bhEquity[i] = bhEquity[i - 1] * (1 + dailyRet[i]);
    const rSt = dailyRet[i] * nextPos - fee;
    stratDailyRet[i] = rSt;
    stratEquity[i] = stratEquity[i - 1] * (1 + rSt);

    if (bhEquity[i] > peakBH) peakBH = bhEquity[i];
    if (stratEquity[i] > peakSt) peakSt = stratEquity[i];
    bhDD[i] = ((bhEquity[i] - peakBH) / peakBH) * 100;
    stratDD[i] = ((stratEquity[i] - peakSt) / peakSt) * 100;

    if (actType > 0) {
      const subDrop = isNaN(maxFutureDrop[i - 1]) ? null : maxFutureDrop[i - 1] * 100;
      const isCut = (actType === 1 || actType === 2);
      const hitCrash = isCut && subDrop !== null && subDrop <= p.crashPct;
      const labelMap = { 1: '黃燈減碼', 2: '紅燈重砍', 3: '警報解除回補' };

      actions.push({
        id: `act-${i}`,
        execIdx: i,
        signalIdx: i - 1,
        execDate: rawData[i].Date,
        signalDate: rawData[i - 1].Date,
        type: actType,
        typeName: labelMap[actType],
        fromPos: Math.round(prevPos * 100),
        toPos: Math.round(nextPos * 100),
        execClose: close[i],
        signalClose: close[i - 1],
        score: prevSc,
        signals: {
          s1: sig1[i - 1] === 1,
          s2: sig2[i - 1] === 1,
          s3: sig3[i - 1] === 1
        },
        subsequentDrop: subDrop,
        hitCrash
      });
    }
  }

  const last = n - 1;
  const lastSc = scoreArr[last];
  const currPos = position[last];
  let tomorrowAction = 'hold_full';
  let tomorrowPos = currPos;

  if (lastSc >= redTrigger) {
    tomorrowPos = redPos;
    tomorrowAction = currPos > redPos + 1e-6 ? 'cut_red' : 'hold_red';
  } else if (lastSc >= yellowTrigger) {
    tomorrowPos = Math.min(currPos, yellowPos);
    tomorrowAction = currPos > yellowPos + 1e-6 ? 'cut_yellow' : 'hold_defense';
  } else if (lastSc === 0 && inDefense) {
    if (consecAbove10[last] >= p.reentryDays) {
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

  const warmup = Math.min(60, Math.floor(n * 0.1));
  const validEnd = Math.max(warmup + 1, n - p.fwdDays);
  const totalYears = Math.max(0.2, (n - 1) / 252);

  const cutActionsValid = actions.filter((a) => (a.type === 1 || a.type === 2) && a.signalIdx >= warmup && a.signalIdx < validEnd);
  const hitCuts = cutActionsValid.filter((a) => a.hitCrash).length;
  const actionPrecision = cutActionsValid.length > 0 ? (hitCuts / cutActionsValid.length) * 100 : 0;

  const segments = [];
  let segS = -1, segE = -1;
  for (let i = warmup; i < validEnd; i++) {
    if (targetCrash[i] === 1) {
      if (segS === -1) { segS = i; segE = i; }
      else if (i - segE <= 10) { segE = i; }
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

    const peakP = close[peakIdx];
    const troughP = close[troughIdx];
    const maxDrop = ((troughP - peakP) / peakP) * 100;

    const scanStart = Math.max(1, Math.min(peakIdx, sIdx) - 3);
    let firstCutIdx = -1;
    for (let j = scanStart; j <= troughIdx; j++) {
      if (actionTypeArr[j] === 1 || actionTypeArr[j] === 2) {
        firstCutIdx = j;
        break;
      }
    }
    let alreadyInDefense = false;
    if (firstCutIdx === -1 && position[sIdx] < 0.99) {
      firstCutIdx = sIdx;
      alreadyInDefense = true;
    }

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

  const hitWaves = crashWaves.filter((w) => w.hit).length;
  const eventRecall = crashWaves.length > 0 ? (hitWaves / crashWaves.length) * 100 : 0;

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
    pre, n, warmup, validEnd, totalYears,
    targetCrash, sig1, sig2, sig3, scoreArr,
    futThArr, spotThArr, volThArr, marginThArr,
    yellowTrigger, redTrigger,
    position, bhEquity, stratEquity, bhDD, stratDD,
    actionTypeArr, actions, totalCostPct,
    tomorrowAction, tomorrowPos, inDefenseAtEnd: inDefense,
    cutActionsValidCount: cutActionsValid.length, hitCuts, actionPrecision,
    crashWaves, hitWaves, eventRecall,
    retBH, retSt, cagrBH, cagrSt, mddBH, mddSt, mddSavedPts, mddReductionPct, calmarBH, calmarSt
  };
}

// =========================================================================
// FinMind API Fetcher (All 5 Factors)
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

export async function fetchAllFinMindFactors({ startDate = '2020-01-01', endDate = formatDate(new Date()), token = '', onStep = null } = {}) {
  const notify = (step, status, ok = null) => {
    if (typeof onStep === 'function') onStep(step, status, ok);
  };

  notify(1, '抓取中...');
  const priceRows = await fetchFinMindEndpoint('TaiwanStockPrice', startDate, endDate, token, 'TAIEX');
  if (!priceRows.length) throw new Error('TAIEX 加權指數回傳資料為空，請確認日期區間。');
  notify(1, `✅ 完成 (${priceRows.length} 筆)`, true);

  notify(2, '抓取中...');
  const instRows = await fetchFinMindEndpoint('TaiwanStockTotalInstitutionalInvestors', startDate, endDate, token);
  notify(2, `✅ 完成 (${instRows.length} 筆)`, true);

  notify(3, '抓取中...');
  const futRows = await fetchFinMindEndpoint('TaiwanFuturesInstitutionalInvestors', startDate, endDate, token, 'TX');
  notify(3, `✅ 完成 (${futRows.length} 筆)`, true);

  notify(4, '抓取中...');
  const marginRows = await fetchFinMindEndpoint('TaiwanStockTotalMarginPurchaseShortSale', startDate, endDate, token);
  notify(4, `✅ 完成 (${marginRows.length} 筆)`, true);

  const spotMap = {};
  for (const r of instRows) {
    const name = String(r.name || '');
    if (name === 'Foreign_Investor' || name.includes('Foreign')) {
      const dt = r.date;
      const net = (parseNum(r.buy) - parseNum(r.sell)) / 1e8;
      if (!isNaN(net)) spotMap[dt] = (spotMap[dt] || 0) + net;
    }
  }

  const futMap = {};
  for (const r of futRows) {
    const inv = String(r.institutional_investors || '');
    if (inv.includes('外資') || inv.includes('Foreign')) {
      const dt = r.date;
      const oi = parseNum(r.long_open_interest_balance_volume) - parseNum(r.short_open_interest_balance_volume);
      if (!isNaN(oi)) futMap[dt] = (futMap[dt] || 0) + oi;
    }
  }

  const marginMap = {};
  for (const r of marginRows) {
    if (r.name === 'MarginPurchaseMoney') {
      const val = parseNum(r.TodayBalance) / 1e8;
      if (!isNaN(val)) marginMap[r.date] = val;
    }
  }

  const merged = [];
  const seen = new Set();
  priceRows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let lastFut = NaN, lastSpot = 0, lastMargin = NaN;
  let futMissingStreak = 0, marginMissingStreak = 0;

  for (const pRow of priceRows) {
    const dt = parseFlexibleDate(pRow.date);
    const c = parseNum(pRow.close);
    if (!dt || isNaN(c) || seen.has(dt)) continue;
    seen.add(dt);

    const tMoney = parseNum(pRow.Trading_money);
    const tVol = parseNum(pRow.Trading_Volume);
    const volAmt = !isNaN(tMoney) && tMoney > 0 ? (tMoney / 1e8) : (!isNaN(tVol) ? tVol / 1e8 : NaN);

    let fOI = futMap[dt] !== undefined ? futMap[dt] : NaN;
    if (!isNaN(fOI)) { lastFut = fOI; futMissingStreak = 0; }
    else if (!isNaN(lastFut) && futMissingStreak < 2) { fOI = lastFut; futMissingStreak++; }

    let sNet = spotMap[dt] !== undefined ? spotMap[dt] : NaN;
    if (!isNaN(sNet)) lastSpot = sNet;
    else sNet = lastSpot;

    let mBal = marginMap[dt] !== undefined ? marginMap[dt] : NaN;
    if (!isNaN(mBal)) { lastMargin = mBal; marginMissingStreak = 0; }
    else if (!isNaN(lastMargin) && marginMissingStreak < 2) { mBal = lastMargin; marginMissingStreak++; }

    merged.push({
      Date: dt,
      Close: Number(c.toFixed(2)),
      Volume: isNaN(volAmt) ? null : Number(volAmt.toFixed(1)),
      Foreign_Fut_OI: isNaN(fOI) ? null : Math.round(fOI),
      Foreign_Spot_Net: Number(sNet.toFixed(1)),
      Margin_Balance: isNaN(mBal) ? null : Number(mBal.toFixed(1)),
      Volatility: null
    });
  }

  if (merged.length < 80) {
    throw new Error(`有效交易日不足（僅 ${merged.length} 筆），請拉長日期區間至少半年以上。`);
  }

  const firstValidFut = merged.find((r) => r.Foreign_Fut_OI !== null && !isNaN(r.Foreign_Fut_OI))?.Foreign_Fut_OI;
  const firstValidMargin = merged.find((r) => r.Margin_Balance !== null && !isNaN(r.Margin_Balance))?.Margin_Balance;
  const hasChip = firstValidFut !== undefined && firstValidMargin !== undefined;

  if (hasChip) {
    let cf = firstValidFut, cm = firstValidMargin;
    for (const r of merged) {
      if (r.Foreign_Fut_OI === null || isNaN(r.Foreign_Fut_OI)) r.Foreign_Fut_OI = cf; else cf = r.Foreign_Fut_OI;
      if (r.Margin_Balance === null || isNaN(r.Margin_Balance)) r.Margin_Balance = cm; else cm = r.Margin_Balance;
    }
  }

  const realized = computeRealizedVolatility(merged.map((r) => r.Close), 20);
  for (let i = 0; i < merged.length; i++) merged[i].Volatility = Number(realized[i].toFixed(2));

  const dataMeta = {
    isReal: true,
    sourceName: 'FinMind API',
    priceOnly: !hasChip,
    hasVolume: merged.some((r) => r.Volume !== null && !isNaN(r.Volume) && r.Volume > 0),
    autoVolComputed: true,
    updatedAt: new Date().toISOString()
  };

  return { rawData: merged, dataMeta };
}

// =========================================================================
// Verdict Formatting Helper
// =========================================================================
export function buildLatestSummary(rawData, params, dataMeta, resIn = null) {
  const res = resIn || runQuantEngine(rawData, params, dataMeta);
  const last = res.n - 1;
  const row = rawData[last];
  const score = res.scoreArr[last];
  const maxScore = dataMeta.priceOnly ? 2 : 3;
  const act = res.tomorrowAction;
  const targetPosPct = Math.round(res.tomorrowPos * 100);

  let emoji = '🟢';
  let level = 'safe';
  let verdict = `安全持有（維持 ${targetPosPct}%）`;
  if (act === 'cut_red' || act === 'hold_red') {
    emoji = '🔴';
    level = 'red';
    verdict = act === 'cut_red' ? `明日開盤重砍至 ${targetPosPct}%` : `維持紅燈防禦（${targetPosPct}%）`;
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
    signals: {
      s1_foreignDualShort: res.sig1[last] === 1,
      s2_trendBreakdown: res.sig2[last] === 1,
      s3_panicVolatilityMargin: res.sig3[last] === 1
    },
    isReal: Boolean(dataMeta.isReal),
    sourceName: dataMeta.sourceName || '內建示範模擬',
    priceOnly: Boolean(dataMeta.priceOnly),
    rowCount: rawData.length,
    updatedAt: dataMeta.updatedAt || null
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

    const params = { ...DEFAULT_PARAMS, ...(parsed.params || {}) };
    const finmindToken = parsed.finmindToken || legacyToken || '';
    const rawData = Array.isArray(parsed.rawData) && parsed.rawData.length >= 80 ? parsed.rawData : null;
    const dataMeta = { ...DEFAULT_DATA_META, ...(parsed.dataMeta || {}) };
    const latestSummary = parsed.latestSummary || null;

    return { params, finmindToken, rawData, dataMeta, latestSummary };
  },

  saveCache(patch = {}) {
    const ls = safeStorage();
    if (!ls) return;
    const current = this.loadCache();
    const next = {
      params: patch.params ? { ...DEFAULT_PARAMS, ...patch.params } : current.params,
      finmindToken: patch.finmindToken !== undefined ? String(patch.finmindToken || '').trim() : current.finmindToken,
      rawData: patch.rawData !== undefined ? patch.rawData : current.rawData,
      dataMeta: patch.dataMeta !== undefined ? { ...DEFAULT_DATA_META, ...patch.dataMeta } : current.dataMeta,
      latestSummary: patch.latestSummary !== undefined ? patch.latestSummary : current.latestSummary
    };

    try {
      ls.setItem(RADAR_STORAGE_KEY, JSON.stringify(next));
      if (next.finmindToken) ls.setItem(LEGACY_TOKEN_KEY, next.finmindToken);
      else ls.removeItem(LEGACY_TOKEN_KEY);
    } catch (err) {
      // Quota fallback: save without rawData if browser storage is tight
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
        dataMeta: cache.dataMeta,
        params: cache.params,
        finmindToken: cache.finmindToken
      };
    }
    return {
      rawData: generateDemoData(),
      dataMeta: { ...DEFAULT_DATA_META },
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
    if (cache.latestSummary) return cache.latestSummary;
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
      onStep: opts.onStep
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
    const { pre, futThArr, spotThArr, volThArr, marginThArr } = res;
    const i = pre.n - 1;
    const prevRow = rawData[i];

    const inClose = parseNum(input.close) || prevRow.Close;
    const inVol = parseNum(input.volume) || prevRow.Volume || 3500;
    const inFut = isNaN(parseNum(input.futOI)) ? prevRow.Foreign_Fut_OI : parseNum(input.futOI);
    const inSpotToday = isNaN(parseNum(input.spotNet)) ? 0 : parseNum(input.spotNet);
    const inMargin = parseNum(input.marginBalance) || prevRow.Margin_Balance;

    let prev4Spot = 0;
    for (let k = Math.max(0, i - 3); k <= i; k++) prev4Spot += isNaN(pre.spotNet[k]) ? 0 : pre.spotNet[k];
    const estSpot5d = prev4Spot + inSpotToday;

    const oldPriceOut = i >= params.maLen - 1 ? pre.close[i - params.maLen + 1] : prevRow.Close;
    const maPrev = pre.ma[i] || prevRow.Close;
    const newMA = maPrev + (inClose - oldPriceOut) / params.maLen;
    const estRet = (inClose - prevRow.Close) / prevRow.Close;

    const last20Rets = [];
    for (let k = Math.max(1, i - 18); k <= i; k++) last20Rets.push(pre.dailyRet[k]);
    last20Rets.push(estRet);
    const mR = last20Rets.reduce((a, b) => a + b, 0) / last20Rets.length;
    const sqR = last20Rets.reduce((a, b) => a + (b - mR) * (b - mR), 0);
    const estVol = Math.sqrt(sqR / Math.max(1, last20Rets.length - 1)) * Math.sqrt(252) * 100;

    const fTh = futThArr[i];
    const sTh = spotThArr[i];
    const vTh = volThArr[i];
    const mTh = marginThArr[i];
    const vMa = pre.volMa[i] || inVol;

    const s1Hit = !dataMeta.priceOnly && !isNaN(fTh) && !isNaN(sTh) && inFut < fTh && estSpot5d < sTh;
    const todayHeavy = (estRet <= params.dropPct / 100.0) && (inVol > vMa * params.volMult);
    const prevHeavy = (pre.dailyRet[i] <= params.dropPct / 100.0) || (pre.dailyRet[i - 1] <= params.dropPct / 100.0);
    const consecBelowNew = inClose < newMA ? (pre.consecBelowMA[i] + 1) : 0;
    const s2Hit = (consecBelowNew >= params.confirmDays) && (newMA < maPrev) && (todayHeavy || prevHeavy);

    const kIdx = Math.max(0, i - params.retDays + 1);
    const retKd = (inClose - pre.close[kIdx]) / pre.close[kIdx];
    const mChg = inMargin - (pre.margin[kIdx] || inMargin);
    const s3Hit = !isNaN(vTh) && estVol > vTh && (
      dataMeta.priceOnly
        ? (retKd <= -0.02)
        : ((retKd < 0 && mChg > 0) || (!isNaN(mTh) && inMargin > mTh))
    );

    const score = (s1Hit ? 1 : 0) + (s2Hit ? 1 : 0) + (s3Hit ? 1 : 0);
    let level = 'safe';
    let targetPosPct = 100;
    let verdict = `安全持有 (${score} 分)`;
    if (score >= res.redTrigger) {
      level = 'red';
      targetPosPct = params.redPos;
      verdict = `紅燈重砍 (${score} 分) → ${params.redPos}%`;
    } else if (score >= res.yellowTrigger) {
      level = 'yellow';
      targetPosPct = params.yellowPos;
      verdict = `黃燈減碼 (${score} 分) → ${params.yellowPos}%`;
    }

    return {
      baseDate: prevRow.Date,
      score,
      level,
      verdict,
      targetPosPct,
      estimatedDailyRetPct: Number((estRet * 100).toFixed(2)),
      estimated20dVolPct: Number(estVol.toFixed(2)),
      signals: { s1: s1Hit, s2: s2Hit, s3: s3Hit }
    };
  },

  getBacktestSummary(limitActions = 10) {
    const { rawData, dataMeta, params } = this.getWorkingData();
    const res = runQuantEngine(rawData, params, dataMeta);
    return {
      isReal: Boolean(dataMeta.isReal),
      sourceName: dataMeta.sourceName,
      dateRange: `${rawData[0].Date} ~ ${rawData[rawData.length - 1].Date}`,
      rowCount: rawData.length,
      kpis: {
        actionPrecisionPct: Number(res.actionPrecision.toFixed(2)),
        eventRecallPct: Number(res.eventRecall.toFixed(2)),
        totalActions: res.actions.length,
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

  updateParams(patch = {}) {
    const cache = this.loadCache();
    const nextParams = { ...cache.params };
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULT_PARAMS && isFinite(Number(v))) {
        nextParams[k] = Number(v);
      }
    }
    this.saveCache({ params: nextParams });
    const summary = this.getLatestSignal();
    return { params: nextParams, latestSummary: summary };
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
    if (frag.p && typeof frag.p === 'object') patch.params = { ...DEFAULT_PARAMS, ...frag.p };
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
  description: 'TWSE 台股全 5 因子減碼行動雷達（明日 T+1 減碼指令、FinMind 即時更新、What-If 盤後試算、回測績效與調參）',
  actions: {
    getLatestSignal: () => TwseRadarCore.getLatestSignal(),
    refreshFromFinMind: (_state, params = {}) => TwseRadarCore.refreshFromFinMind(params),
    runWhatIf: (_state, params = {}) => TwseRadarCore.runWhatIf(params),
    getBacktestSummary: (_state, params = {}) => TwseRadarCore.getBacktestSummary(params?.limitActions || 10),
    updateParams: (_state, params = {}) => TwseRadarCore.updateParams(params)
  },
  schemas: [
    {
      name: 'getLatestSignal',
      description: '取得最新盤後資料之明日 T+1 減碼行動指令、三大訊號狀態與目標倉位',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'refreshFromFinMind',
      description: '直連 FinMind API 抓取最新全 5 因子真實台股資料並更新本機快取',
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
      description: '輸入今晚盤後預估數值進行 What-If 減碼試算',
      parameters: {
        type: 'object',
        properties: {
          close: { type: 'number', description: '今日預估加權指數收盤' },
          volume: { type: 'number', description: '今日預估成交金額（億元）' },
          futOI: { type: 'number', description: '今日外資台指期未平倉淨口數' },
          spotNet: { type: 'number', description: '今日外資現貨買賣超（億元）' },
          marginBalance: { type: 'number', description: '今日大盤融資餘額（億元）' }
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
      description: '更新量化參數配置並即時重算明日減碼指令',
      parameters: {
        type: 'object',
        properties: {
          futQ: { type: 'number' },
          spotQ: { type: 'number' },
          volQ: { type: 'number' },
          confirmDays: { type: 'number' },
          yellowPos: { type: 'number' },
          redPos: { type: 'number' }
        }
      }
    }
  ]
});
