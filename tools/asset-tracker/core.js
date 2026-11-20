/**
 * tools/asset-tracker/core.js
 * Pure Business Logic for F&S Asset Report_V2 (Personal Asset, Expense, Account Log, Analytics & N_薪資)
 * Uses exact column names from F&S Asset Report_V2 Google Sheet & local-snapshot.json
 */

import { agentBridge } from '../../core/agent-bridge.js';
import { ASSET_EXTRA_DATA } from './data.js';

const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const cleaned = String(v).replace(/(?:NT\$|US\$|[$,%\s,])/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
};

export const FS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1K_4Oz3tC5E7U2pnBf8rGF0OgyEqgeHuqfWt7ljW738M/edit';

export const AssetCore = {
  /**
   * 1. Extract dynamic dropdown options & parameters from state.asset.settings & fx
   */
  getConfigOptions(state) {
    const settings = state?.asset?.settings || [];
    const groupValues = (g) => settings.filter((r) => r['群組'] === g).map((r) => r['值']).filter(Boolean);

    const natures = groupValues('性質');
    const ledgerCategories = {
      '收入': groupValues('收入類別'),
      '支出': groupValues('支出類別'),
      '轉帳': groupValues('轉帳類別'),
      '校正': groupValues('校正類別')
    };

    const expenseMainCategories = groupValues('消費大類');
    const expenseSubCategories = {};
    for (const main of expenseMainCategories) {
      expenseSubCategories[main] = settings
        .filter((r) => r['群組'] === '消費子類別' && r['附屬'] === main)
        .map((r) => r['值'])
        .filter(Boolean);
    }

    const currencies = groupValues('幣別');
    const payers = groupValues('負擔人');
    const fixedVar = groupValues('固定變動');

    const findParam = (name, def) => {
      const row = settings.find((r) => r['群組'] === '參數' && r['值'] === name);
      return row ? toNum(row['附屬'], def) : def;
    };

    const fxList = state?.asset?.fx || [];
    const fxMap = { TWD: 1 };
    for (const f of fxList) {
      if (f['幣別']) fxMap[f['幣別']] = toNum(f['每單位兌台幣'], 1);
    }
    if (!fxMap.USD || fxMap.USD === 1) fxMap.USD = 32.89;

    const accounts = (state?.asset?.accounts || []).filter((a) => a['帳戶名'] || a['帳戶名稱']);
    const accountNames = Array.from(new Set(accounts.map((a) => a['帳戶名'] || a['帳戶名稱'])));

    return {
      natures: natures.length ? natures : ['收入', '支出', '轉帳', '校正'],
      ledgerCategories,
      expenseMainCategories: expenseMainCategories.length ? expenseMainCategories : ['餐費', '交通費', '通信費', '水電費', '訂閱', '旅遊', '管理費', '其他'],
      expenseSubCategories,
      currencies: currencies.length ? currencies : ['TWD', 'USD', 'JPY', 'KRW'],
      payers: payers.length ? payers : ['炫甫', '垠宣', 'FS'],
      fixedVar: fixedVar.length ? fixedVar : ['固定', '變動'],
      accountNames,
      fxMap,
      targetTotalAsset: findParam('目標總資產', 7000000),
      realEstateBase: findParam('不動產基準值', 3403844)
    };
  },

  /**
   * 2. Get Net Worth & Asset Allocation Summary (Matches F&S Asset Report_V2 schema)
   */
  getSummary(state) {
    const opts = this.getConfigOptions(state);
    const accounts = (state?.asset?.accounts || []).filter((a) => a['帳戶名'] || a['帳戶名稱']);
    const debts = (state?.asset?.debts || []).filter((d) => d['債務名稱'] || d['項目名稱']);

    let liquidSavingsTwd = 0;
    let protectionTwd = 0;
    let twStockTwd = 0;
    let usStockTwd = 0;

    for (const acc of accounts) {
      const attr = String(acc['屬性'] || acc['資產屬性'] || '儲蓄');
      const cur = String(acc['幣別'] || 'TWD');
      const rate = opts.fxMap[cur] || 1;
      const balNative = toNum(acc['目前餘額(自動)'] ?? acc['原幣金額'], 0);
      const balTwd = acc['台幣金額'] !== undefined ? toNum(acc['台幣金額'], balNative * rate) : (balNative * rate);

      if (attr.includes('儲蓄') || attr.includes('流動')) {
        liquidSavingsTwd += balTwd;
      } else if (attr.includes('保障') || attr.includes('保險') || attr.includes('預備')) {
        protectionTwd += balTwd;
      } else if (attr.includes('股票') || attr.includes('投資') || attr.includes('國內') || attr.includes('海外')) {
        if (cur === 'TWD' && !attr.includes('海外')) twStockTwd += balTwd;
        else usStockTwd += balTwd;
      } else {
        liquidSavingsTwd += balTwd;
      }
    }

    const totalFinancialAssetsTwd = liquidSavingsTwd + protectionTwd + twStockTwd + usStockTwd;
    const grossAssetsWithRealEstateTwd = totalFinancialAssetsTwd + opts.realEstateBase;

    let totalDebtTwd = 0;
    let monthlyDebtPaymentTwd = 0;
    for (const d of debts) {
      totalDebtTwd += toNum(d['目前餘額(自動)'] ?? d['剩餘本金'], 0);
      monthlyDebtPaymentTwd += toNum(d['每月還款'] ?? d['每期應繳'], 0);
    }

    const netWorthTwd = grossAssetsWithRealEstateTwd - totalDebtTwd;
    const goalProgress = opts.targetTotalAsset > 0 ? totalFinancialAssetsTwd / opts.targetTotalAsset : 0;

    return {
      usdRate: opts.fxMap.USD || 32.89,
      liquidSavingsTwd: Math.round(liquidSavingsTwd),
      protectionTwd: Math.round(protectionTwd),
      twStockTwd: Math.round(twStockTwd),
      usStockTwd: Math.round(usStockTwd),
      totalFinancialAssetsTwd: Math.round(totalFinancialAssetsTwd),
      realEstateBaseTwd: Math.round(opts.realEstateBase),
      realEstateTwd: Math.round(opts.realEstateBase),
      grossAssetsWithRealEstateTwd: Math.round(grossAssetsWithRealEstateTwd),
      grossAssetsTwd: Math.round(grossAssetsWithRealEstateTwd),
      totalDebtTwd: Math.round(totalDebtTwd),
      totalDebtRemainingTwd: Math.round(totalDebtTwd),
      monthlyDebtPaymentTwd: Math.round(monthlyDebtPaymentTwd),
      netWorthTwd: Math.round(netWorthTwd),
      targetTotalAssetTwd: Math.round(opts.targetTotalAsset),
      targetGoalTwd: Math.round(opts.targetTotalAsset),
      goalProgress,
      accountCount: accounts.length,
      debtCount: debts.length
    };
  },

  /**
   * 3. Record Daily Expense (Appends to state.asset.recentExpenses using store.mutate)
   */
  addExpense(state, params, storeInstance) {
    const date = String(params.date || params['日期'] || new Date().toISOString().slice(0, 10));
    const amount = toNum(params.amount ?? params['金額'], 0);
    const fixedVar = String(params.fixedVar || params['固定變動'] || '變動');
    const category = String(params.category || params['類別'] || '餐費');
    const subCategory = String(params.subCategory || params['子類別'] || '');
    const title = String(params.title || params['名目'] || subCategory || category).trim();
    const payer = String(params.payer || params['負擔人'] || '炫甫');

    if (amount <= 0) throw new Error('開銷金額必須大於 0');

    const nextId = (state?.asset?.recentExpenses?.length || 0) + 1001;
    const record = {
      ID: String(nextId),
      '日期': date,
      '金額': String(amount),
      '固定變動': fixedVar,
      '類別': category,
      '子類別': subCategory,
      '名目': title,
      '負擔人': payer
    };

    storeInstance.mutate('asset.appendExpense', record, (s) => {
      s.asset.recentExpenses.push(record);
    });

    return record;
  },

  /**
   * 4. Record Account Ledger Log (log_V2)
   */
  addLedgerLog(state, params, storeInstance) {
    const date = String(params.date || params['日期'] || new Date().toISOString().slice(0, 10));
    const nature = String(params.nature || params['性質'] || '支出');
    const category = String(params.category || params['類別'] || '其他');
    const account = String(params.account || params['帳戶'] || '富邦');
    const currency = String(params.currency || params['幣別'] || 'TWD');
    const amount = toNum(params.amount ?? params['金額'], 0);
    const note = String(params.note || params['備註'] || '').trim();
    const tag = String(params.tag || params['標籤'] || '');

    if (amount === 0 && nature !== '校正') throw new Error('流水金額不可為 0');

    const nextId = (state?.asset?.recentLogs?.length || 0) + 1001;
    const record = {
      ID: String(nextId),
      '日期': date,
      '性質': nature,
      '類別': category,
      '帳戶': account,
      '幣別': currency,
      '金額': String(amount),
      '備註': note,
      '轉帳編號': '',
      '標籤': tag
    };

    storeInstance.mutate('asset.appendLog', record, (s) => {
      s.asset.recentLogs.push(record);
      const acc = s.asset.accounts.find((a) => (a['帳戶名'] || a['帳戶名稱']) === account && (a['幣別'] || 'TWD') === currency)
        || s.asset.accounts.find((a) => (a['帳戶名'] || a['帳戶名稱']) === account);
      if (acc) {
        const curBal = toNum(acc['目前餘額(自動)'] ?? acc['原幣金額'], 0);
        if (nature === '收入') acc['目前餘額(自動)'] = String(curBal + Math.abs(amount));
        else if (nature === '支出') acc['目前餘額(自動)'] = String(curBal - Math.abs(amount));
        else if (nature === '校正') acc['目前餘額(自動)'] = String(curBal + amount);
      }
    });

    return record;
  },

  /**
   * 5. One-Click Inline Account Balance Reconciliation (快速對帳校正)
   * User enters actual current balance -> auto-calculates delta, updates account balance, and logs to log_V2
   */
  reconcileAccountBalance(state, params, storeInstance) {
    const account = String(params.account || '').trim();
    const currency = String(params.currency || 'TWD').trim();
    const actualBalance = toNum(params.actualBalance, NaN);
    const date = String(params.date || new Date().toISOString().slice(0, 10));

    if (!account) throw new Error('請指定要對帳的帳戶');
    if (!Number.isFinite(actualBalance) || actualBalance < 0) {
      throw new Error('請輸入有效的實際帳戶餘額（≥ 0）');
    }

    const targetAcc = (state?.asset?.accounts || []).find(
      (a) => (a['帳戶名'] || a['帳戶名稱']) === account && (a['幣別'] || 'TWD') === currency
    ) || (state?.asset?.accounts || []).find((a) => (a['帳戶名'] || a['帳戶名稱']) === account);

    if (!targetAcc) throw new Error(`找不到帳戶：${account}`);

    const oldBal = toNum(targetAcc['目前餘額(自動)'] ?? targetAcc['原幣金額'], 0);
    const delta = Math.round((actualBalance - oldBal) * 100) / 100;
    const cur = targetAcc['幣別'] || currency || 'TWD';

    const nextId = (state?.asset?.recentLogs?.length || 0) + 1001;
    const record = {
      ID: String(nextId),
      '日期': date,
      '性質': '校正',
      '類別': '對帳校正',
      '帳戶': account,
      '幣別': cur,
      '金額': String(delta),
      '備註': `快速對帳 (原 ${oldBal.toLocaleString()} → 實盤 ${actualBalance.toLocaleString()})`,
      '轉帳編號': '',
      '標籤': '快速對帳'
    };

    storeInstance.mutate('asset.appendLog', record, (s) => {
      s.asset.recentLogs.push(record);
      const acc = s.asset.accounts.find(
        (a) => (a['帳戶名'] || a['帳戶名稱']) === account && (a['幣別'] || 'TWD') === cur
      ) || s.asset.accounts.find((a) => (a['帳戶名'] || a['帳戶名稱']) === account);
      if (acc) {
        acc['目前餘額(自動)'] = String(actualBalance);
      }
    });

    return {
      status: 'ok',
      account,
      currency: cur,
      oldOrig: oldBal,
      newOrig: actualBalance,
      deltaOrig: delta,
      record
    };
  },

  /**
   * 6. Get Analytics Data for Charts (2014~2026 Snapshots, Allocation, Monthly Cashflow, Expense Breakdown)
   */
  getAnalyticsData(state) {
    const summary = this.getSummary(state);
    const rawSnapshots = (state?.asset?.snapshots && state.asset.snapshots.length > 0)
      ? state.asset.snapshots
      : (ASSET_EXTRA_DATA.snapshots || []);

    const seenDates = new Set();
    const snapshots = [];
    for (const s of rawSnapshots) {
      const d = String(s['日期'] || s.date || '').trim();
      if (!d || seenDates.has(d)) continue;
      seenDates.add(d);

      const fin = toNum(s['資金總額'] ?? s.financialAssetsTwd, 0);
      const realEst = toNum(s['不動產'] ?? s.realEstateTwd, 0);
      const gross = toNum(s['總資產(含不動產)'] ?? s.grossAssetsTwd, fin + realEst);
      const debt = toNum(s['總負債'] ?? s.debtTwd, 0);
      const net = toNum(s['淨值'] ?? s.netWorthTwd, debt > 0 ? (gross - debt) : gross);

      snapshots.push({
        date: d,
        financialAssetsTwd: fin,
        realEstateTwd: realEst,
        grossAssetsTwd: gross,
        debtTwd: debt,
        netWorthTwd: net,
        monthIncome: toNum(s['當月收入'], 0),
        monthExpense: toNum(s['當月支出'], 0),
        monthSavings: toNum(s['儲蓄'], 0),
        growthPct: toNum(s['成長率%'], 0)
      });
    }
    snapshots.sort((a, b) => a.date.localeCompare(b.date));

    // Current Asset Allocation
    const totalFin = Math.max(1, summary.totalFinancialAssetsTwd);
    const allocation = [
      { label: '海外股票 (美股)', amount: summary.usStockTwd, ratio: summary.usStockTwd / totalFin },
      { label: '國內股票 (台股)', amount: summary.twStockTwd, ratio: summary.twStockTwd / totalFin },
      { label: '保障與預備金', amount: summary.protectionTwd, ratio: summary.protectionTwd / totalFin },
      { label: '流動儲蓄 (活定存)', amount: summary.liquidSavingsTwd, ratio: summary.liquidSavingsTwd / totalFin }
    ];

    // Monthly Cashflow History (Combine cashflowHistory 2024~2025 + snapshots 2026 monthly income/expense)
    const rawCashflow = (state?.asset?.cashflowHistory && state.asset.cashflowHistory.length > 0)
      ? state.asset.cashflowHistory
      : (ASSET_EXTRA_DATA.cashflowHistory || []);

    const cfMap = new Map();
    for (const c of rawCashflow) {
      const yr = Math.round(toNum(c['年'] ?? c.year, 0));
      const mo = Math.round(toNum(c['月'] ?? c.month, 0));
      const ym = c.yearMonth || (yr && mo ? `${yr}-${String(mo).padStart(2, '0')}` : '');
      if (!ym) continue;
      const inc = toNum(c['收入'] ?? c.income, 0);
      const exp = toNum(c['支出'] ?? c.expense, 0);
      if (inc > 0 || exp > 0) {
        cfMap.set(ym, {
          yearMonth: ym,
          income: inc,
          expense: exp,
          savings: inc - exp
        });
      }
    }

    // Also include 2026 monthly income/expense from snapshots if present
    for (const s of snapshots) {
      if (s.monthIncome > 0 || s.monthExpense > 0) {
        const ym = s.date.slice(0, 7);
        cfMap.set(ym, {
          yearMonth: ym,
          income: s.monthIncome,
          expense: s.monthExpense,
          savings: s.monthIncome - s.monthExpense
        });
      }
    }

    const cashflowHistory = Array.from(cfMap.values()).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    const recent18Cashflow = cashflowHistory.slice(-18).filter((c) => c.income > 0 || c.expense > 0);
    const cfSampleCount = recent18Cashflow.length;
    const avgMonthlyIncome = cfSampleCount > 0
      ? Math.round(recent18Cashflow.reduce((s, c) => s + c.income, 0) / cfSampleCount)
      : 0;
    const avgMonthlyExpense = cfSampleCount > 0
      ? Math.round(recent18Cashflow.reduce((s, c) => s + c.expense, 0) / cfSampleCount)
      : 0;
    const avgMonthlySavings = avgMonthlyIncome - avgMonthlyExpense;
    const avgSavingsRate = avgMonthlyIncome > 0 ? avgMonthlySavings / avgMonthlyIncome : 0;

    // Expense Breakdown from state.asset.recentExpenses
    const expenses = state?.asset?.recentExpenses || [];
    const byCategoryMap = {};
    const byPayerMap = {};
    const byFixedMap = { '變動': 0, '固定': 0 };
    let totalExpenseSample = 0;

    for (const e of expenses) {
      const amt = toNum(e['金額'], 0);
      if (amt <= 0) continue;
      totalExpenseSample += amt;
      const cat = String(e['類別'] || e['主類別'] || '其他').trim();
      const payer = String(e['負擔人'] || e['支付人'] || '未標註').trim();
      const fixed = String(e['固定變動'] || e['固定/變動'] || '變動').includes('固定') ? '固定' : '變動';

      byCategoryMap[cat] = (byCategoryMap[cat] || 0) + amt;
      byPayerMap[payer] = (byPayerMap[payer] || 0) + amt;
      byFixedMap[fixed] = (byFixedMap[fixed] || 0) + amt;
    }

    const byCategory = Object.entries(byCategoryMap)
      .map(([name, amount]) => ({
        name,
        amount,
        ratio: totalExpenseSample > 0 ? amount / totalExpenseSample : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    const byPayer = Object.entries(byPayerMap)
      .map(([name, amount]) => ({
        name,
        amount,
        ratio: totalExpenseSample > 0 ? amount / totalExpenseSample : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      summary,
      snapshots,
      allocation,
      cashflowHistory,
      cashflowStats: {
        monthCount: cfSampleCount,
        avgMonthlyIncome,
        avgMonthlyExpense,
        avgMonthlySavings,
        avgSavingsRate
      },
      expenseBreakdown: {
        totalExpenseSample,
        count: expenses.length,
        byCategory,
        byPayer,
        fixedAmount: byFixedMap['固定'] || 0,
        variableAmount: byFixedMap['變動'] || 0
      }
    };
  },

  /**
   * 6b. Universal Date Normalization & Sorting for Expenses and Ledger Logs
   * Ensures newest date is always on top when dir='desc', with ID / row-order tie-breaker.
   */
  parseDateTs(rawDate) {
    const s = String(rawDate || '').trim();
    if (!s) return null;
    const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (m) {
      const yr = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const dy = Number(m[3]);
      const hr = Number(m[4] || 0);
      const mn = Number(m[5] || 0);
      const sc = Number(m[6] || 0);
      return Date.UTC(yr, mo, dy, hr, mn, sc);
    }
    const parsed = Date.parse(s);
    return Number.isFinite(parsed) ? parsed : null;
  },

  formatNormalizedDate(rawDate) {
    const s = String(rawDate || '').trim();
    if (!s) return '-';
    const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) {
      return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    }
    return s;
  },

  getSortedExpenses(state, { col = 'date', dir = 'desc', limit = 100 } = {}) {
    const raw = Array.isArray(state?.asset?.recentExpenses) ? state.asset.recentExpenses : [];
    const mul = dir === 'asc' ? 1 : -1;
    const indexed = raw.map((e, idx) => ({
      e,
      idx,
      idNum: toNum(e?.ID, idx),
      dateTs: this.parseDateTs(e?.['日期']),
      normDate: this.formatNormalizedDate(e?.['日期']),
      amount: toNum(e?.['金額'], 0),
      cat: String(e?.['類別'] || ''),
      payer: String(e?.['負擔人'] || '')
    }));

    indexed.sort((a, b) => {
      if (col === 'amount') {
        const diff = (a.amount - b.amount) * mul;
        if (diff !== 0) return diff;
      } else if (col === 'cat') {
        const diff = a.cat.localeCompare(b.cat) * mul;
        if (diff !== 0) return diff;
      } else if (col === 'payer') {
        const diff = a.payer.localeCompare(b.payer) * mul;
        if (diff !== 0) return diff;
      }
      // Primary or fallback: Date comparison (missing date always at bottom)
      if (a.dateTs === null && b.dateTs !== null) return 1;
      if (a.dateTs !== null && b.dateTs === null) return -1;
      if (a.dateTs !== null && b.dateTs !== null && a.dateTs !== b.dateTs) {
        return (a.dateTs - b.dateTs) * mul;
      }
      // Tie-breaker for same date: larger ID / later row on top when desc
      if (a.idNum !== b.idNum) return (a.idNum - b.idNum) * mul;
      return (a.idx - b.idx) * mul;
    });

    const out = indexed.map((item) => ({
      ...item.e,
      '日期': item.normDate
    }));
    return limit > 0 ? out.slice(0, limit) : out;
  },

  getSortedLogs(state, { col = 'date', dir = 'desc', limit = 100 } = {}) {
    const raw = Array.isArray(state?.asset?.recentLogs) ? state.asset.recentLogs : [];
    const mul = dir === 'asc' ? 1 : -1;
    const indexed = raw.map((l, idx) => ({
      l,
      idx,
      idNum: toNum(l?.ID, idx),
      dateTs: this.parseDateTs(l?.['日期']),
      normDate: this.formatNormalizedDate(l?.['日期']),
      amount: toNum(l?.['金額'], 0),
      account: String(l?.['帳戶'] || ''),
      nature: String(l?.['性質'] || '')
    }));

    indexed.sort((a, b) => {
      if (col === 'amount') {
        const diff = (a.amount - b.amount) * mul;
        if (diff !== 0) return diff;
      } else if (col === 'account') {
        const diff = a.account.localeCompare(b.account) * mul;
        if (diff !== 0) return diff;
      } else if (col === 'nature') {
        const diff = a.nature.localeCompare(b.nature) * mul;
        if (diff !== 0) return diff;
      }
      if (a.dateTs === null && b.dateTs !== null) return 1;
      if (a.dateTs !== null && b.dateTs === null) return -1;
      if (a.dateTs !== null && b.dateTs !== null && a.dateTs !== b.dateTs) {
        return (a.dateTs - b.dateTs) * mul;
      }
      if (a.idNum !== b.idNum) return (a.idNum - b.idNum) * mul;
      return (a.idx - b.idx) * mul;
    });

    const out = indexed.map((item) => ({
      ...item.l,
      '日期': item.normDate
    }));
    return limit > 0 ? out.slice(0, limit) : out;
  },

  /**
   * 7. Get Personal Salary & Bonus Data (N_薪資)
   */
  getSalaryData(state, options = {}) {
    const rawRecords = (state?.asset?.salaryRecords && state.asset.salaryRecords.length > 0)
      ? state.asset.salaryRecords
      : (ASSET_EXTRA_DATA.salaryRecords || []);

    const rawAnnual = (state?.asset?.salaryAnnual && state.asset.salaryAnnual.length > 0)
      ? state.asset.salaryAnnual
      : (ASSET_EXTRA_DATA.salaryAnnual || []);

    const yearBreakdownMap = {};
    for (const r of rawRecords) {
      const yr = Number(r.year) || Number(String(r.yearTag || '').slice(0, 4)) || 0;
      if (!yr) continue;
      if (!yearBreakdownMap[yr]) {
        yearBreakdownMap[yr] = { year: yr, baseTotal: 0, bonusTotal: 0, total: 0, count: 0 };
      }
      const amt = toNum(r.amount, 0);
      const itemName = String(r.item || '');
      const isBonus = itemName.includes('獎金') || itemName.includes('年終') || itemName.includes('禮金') || itemName.includes('補助') || itemName.includes('分紅') || String(r.yearTag || '').includes('年終');
      if (isBonus) {
        yearBreakdownMap[yr].bonusTotal += amt;
      } else {
        yearBreakdownMap[yr].baseTotal += amt;
      }
      yearBreakdownMap[yr].total += amt;
      yearBreakdownMap[yr].count += 1;
    }

    const annualList = rawAnnual.map((a) => {
      const yr = Number(a.year);
      const computed = yearBreakdownMap[yr] || { baseTotal: 0, bonusTotal: 0, total: 0, count: 0 };
      const sheetTotal = toNum(a.annualSalary, computed.total);
      const bonusRatio = sheetTotal > 0 ? computed.bonusTotal / sheetTotal : 0;
      return {
        year: yr,
        annualSalary: sheetTotal,
        monthlyAvg: toNum(a.monthlyAvg, Math.round(sheetTotal / 12)),
        estimatedAnnual: toNum(a.estimatedAnnual, 0),
        estimatedMonthly: toNum(a.estimatedMonthly, 0),
        baseTotal: computed.baseTotal,
        bonusTotal: computed.bonusTotal,
        bonusRatio,
        recordCount: computed.count
      };
    }).sort((a, b) => a.year - b.year);

    for (let i = 0; i < annualList.length; i++) {
      if (i === 0) {
        annualList[i].yoyPct = null;
      } else {
        const prev = annualList[i - 1].annualSalary;
        annualList[i].yoyPct = prev > 0 ? ((annualList[i].annualSalary - prev) / prev) * 100 : null;
      }
    }

    const filterYear = options.year ? String(options.year) : 'ALL';
    const filterType = options.type || 'ALL';

    const filteredRecords = rawRecords.filter((r) => {
      const yr = String(r.year || String(r.yearTag || '').slice(0, 4));
      if (filterYear !== 'ALL' && yr !== filterYear) return false;
      const itemName = String(r.item || '');
      const isBonus = itemName.includes('獎金') || itemName.includes('年終') || itemName.includes('禮金') || itemName.includes('補助') || String(r.yearTag || '').includes('年終');
      if (filterType === 'BASE' && isBonus) return false;
      if (filterType === 'BONUS' && !isBonus) return false;
      return true;
    });

    const latestAnnual = annualList[annualList.length - 1] || null;
    const firstAnnual = annualList[0] || null;
    const totalGrowthMultiple = (firstAnnual && latestAnnual && firstAnnual.annualSalary > 0)
      ? (latestAnnual.annualSalary / firstAnnual.annualSalary)
      : 1;

    return {
      annualList,
      records: filteredRecords,
      totalRecordsCount: rawRecords.length,
      latestAnnual,
      firstAnnual,
      totalGrowthMultiple
    };
  },

  /**
   * 8. Add New Salary / Bonus Record (N_薪資)
   */
  addSalaryRecord(state, params, storeInstance) {
    const date = String(params.date || new Date().toISOString().slice(0, 10));
    const item = String(params.item || '月薪水').trim();
    const numAmt = toNum(params.amount, NaN);
    if (!Number.isFinite(numAmt) || numAmt <= 0) {
      throw new Error('請輸入大於 0 的實領薪資或獎金金額');
    }

    const d = new Date(date);
    const yr = Number.isFinite(d.getFullYear()) ? d.getFullYear() : new Date().getFullYear();
    const mo = Number.isFinite(d.getMonth() + 1) ? (d.getMonth() + 1) : 1;

    const newRec = {
      yearTag: String(yr),
      year: yr,
      month: mo,
      item,
      date,
      amount: numAmt,
      detail: String(params.detail || '').trim(),
      bigSpend: String(params.bigSpend || '').trim(),
      spendAmount: toNum(params.spendAmount, 0),
      bankDetail: String(params.bankDetail || '').trim(),
      note: String(params.note || '').trim()
    };

    storeInstance.mutate('asset.appendSalary', newRec, (s) => {
      if (!Array.isArray(s.asset.salaryRecords) || s.asset.salaryRecords.length === 0) {
        s.asset.salaryRecords = [...(ASSET_EXTRA_DATA.salaryRecords || [])];
      }
      if (!Array.isArray(s.asset.salaryAnnual) || s.asset.salaryAnnual.length === 0) {
        s.asset.salaryAnnual = [...(ASSET_EXTRA_DATA.salaryAnnual || [])];
      }
      s.asset.salaryRecords.unshift(newRec);

      const targetYearRow = s.asset.salaryAnnual.find((a) => Number(a.year) === yr);
      if (targetYearRow) {
        targetYearRow.annualSalary = toNum(targetYearRow.annualSalary, 0) + numAmt;
        targetYearRow.monthlyAvg = Math.round(targetYearRow.annualSalary / 12);
      } else {
        s.asset.salaryAnnual.push({
          year: yr,
          annualSalary: numAmt,
          monthlyAvg: Math.round(numAmt / 12),
          estimatedAnnual: numAmt,
          estimatedMonthly: Math.round(numAmt / 12)
        });
      }
    });

    return { status: 'ok', record: newRec };
  }
};

// Register headless module for AI Agent & CLI usage
agentBridge.registerModule('asset-tracker', {
  description: '個人與家庭資產、銀行帳戶、收支流水、分析圖與 N_薪資模組 (對接 F&S Asset Report_V2 試算表)',
  actions: {
    getSummary: (state) => AssetCore.getSummary(state),
    getConfigOptions: (state) => AssetCore.getConfigOptions(state),
    getAnalyticsData: (state) => AssetCore.getAnalyticsData(state),
    getSortedExpenses: (state, params) => AssetCore.getSortedExpenses(state, params),
    getSortedLogs: (state, params) => AssetCore.getSortedLogs(state, params),
    getSalaryData: (state, params) => AssetCore.getSalaryData(state, params),
    addExpense: (state, params, store) => AssetCore.addExpense(state, params, store),
    addLedgerLog: (state, params, store) => AssetCore.addLedgerLog(state, params, store),
    reconcileAccountBalance: (state, params, store) => AssetCore.reconcileAccountBalance(state, params, store),
    addSalaryRecord: (state, params, store) => AssetCore.addSalaryRecord(state, params, store)
  },
  schemas: [
    {
      name: 'getSummary',
      description: '取得資金總額、流動儲蓄、保障資金、國內外股票、總負債與淨值摘要',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'getSalaryData',
      description: '取得 N_薪資 2021~2026 歷年年薪彙總與 105 筆月薪/獎金明細',
      parameters: { type: 'object', properties: { year: { type: 'string' }, type: { type: 'string' } } }
    },
    {
      name: 'reconcileAccountBalance',
      description: '輸入銀行實際餘額，自動計算差額並寫入 log_V2 對帳校正',
      parameters: {
        type: 'object',
        required: ['account', 'actualBalance'],
        properties: {
          account: { type: 'string' },
          currency: { type: 'string' },
          actualBalance: { type: 'number' }
        }
      }
    }
  ]
});
