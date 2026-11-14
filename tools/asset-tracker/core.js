/**
 * tools/asset-tracker/core.js
 * Pure Business Logic for F&S Asset Report_V2 (Personal Asset, Expense, Account Log, Analytics & N_薪資)
 * Decoupled from DOM so both Human UI and AI Agent can invoke identically.
 */

import { ASSET_EXTRA_DATA } from './data.js';

const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const cleaned = String(v).replace(/(?:NT\$|US\$|[$,%\s,])/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
};

export const EXPENSE_CATEGORIES = {
  '餐費': ['早餐', '午餐', '晚餐', '飲料點心', '聚餐大餐', '食材採買'],
  '生活': ['日用品', '水電瓦斯網路', '醫療保健', '服飾美容', '家居設備'],
  '交通': ['加油/充電', '大眾運輸', '停車過路費', '保養維修', '計程車'],
  '娛樂': ['旅遊住宿', '電影展覽', '運動健身', '遊戲訂閱', '社交禮金'],
  '學習與工作': ['書籍課程', '軟體工具', '考照進修', '辦公設備'],
  '固定支出': ['房貸本息', '信貸還款', '保險費', '稅金規費', '孝親家用'],
  '其他': ['雜項支出', '公益捐款', '意外開銷']
};

export const FS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1K_4Oz3tC5E7U2pnBf8rGF0OgyEqgeHuqfWt7ljW738M/edit';

export const AssetCore = {
  /**
   * 1. Get Net Worth & Asset Allocation Summary
   */
  getSummary(state) {
    const accounts = state?.asset?.accounts || [];
    const debts = state?.asset?.debts || [];
    const s = state?.asset?.summary || {};

    let liquidSavingsTwd = 0;
    let protectionTwd = 0;
    let twStockTwd = 0;
    let usStockTwd = 0;

    for (const acc of accounts) {
      const twd = toNum(acc['台幣金額'], 0);
      const attr = String(acc['資產屬性'] || '');
      if (attr.includes('儲蓄') || attr.includes('流動')) liquidSavingsTwd += twd;
      else if (attr.includes('保障') || attr.includes('預備')) protectionTwd += twd;
      else if (attr.includes('國內') || attr.includes('台股')) twStockTwd += twd;
      else if (attr.includes('海外') || attr.includes('美股')) usStockTwd += twd;
      else liquidSavingsTwd += twd;
    }

    const totalFinancialAssetsTwd = liquidSavingsTwd + protectionTwd + twStockTwd + usStockTwd;

    let totalDebtRemainingTwd = 0;
    for (const d of debts) {
      totalDebtRemainingTwd += toNum(d['剩餘本金'], 0);
    }

    const realEstateTwd = toNum(s.realEstateTwd, 11880000);
    const grossAssetsTwd = totalFinancialAssetsTwd + realEstateTwd;
    const netWorthTwd = grossAssetsTwd - totalDebtRemainingTwd;
    const targetGoalTwd = toNum(s.targetGoalTwd, 7000000);

    return {
      totalFinancialAssetsTwd,
      liquidSavingsTwd,
      protectionTwd,
      twStockTwd,
      usStockTwd,
      realEstateTwd,
      grossAssetsTwd,
      totalDebtRemainingTwd,
      netWorthTwd,
      targetGoalTwd,
      goalProgress: targetGoalTwd > 0 ? totalFinancialAssetsTwd / targetGoalTwd : 0,
      accountCount: accounts.length
    };
  },

  /**
   * 2. Record Daily Expense (Appends to Expense Log & Deducts Account if matched)
   */
  addExpense(state, params, store) {
    const {
      date = new Date().toISOString().slice(0, 10),
      category = '餐費',
      subCategory = '午餐',
      title = '',
      amount = 0,
      paymentMethod = '信用卡',
      payer = '炫甫',
      isFixed = '變動',
      note = ''
    } = params;

    const numAmt = toNum(amount, NaN);
    if (!Number.isFinite(numAmt) || numAmt <= 0) {
      throw new Error('請輸入大於 0 的消費金額');
    }

    const d = new Date(date);
    const record = {
      '日期': date,
      '年': d.getFullYear(),
      '月': d.getMonth() + 1,
      '主類別': category,
      '子類別': subCategory,
      '項目': title || subCategory,
      '金額': numAmt,
      '支付方式': paymentMethod,
      '支付人': payer,
      '固定/變動': isFixed,
      '備註': note
    };

    store.updateState((draft) => {
      draft.asset.recentExpenses.unshift(record);
    }, {
      type: 'asset.appendExpense',
      payload: record
    });

    return { status: 'ok', record };
  },

  /**
   * 3. Record Account Inflow / Outflow / Adjustment (log_V2)
   */
  addAccountLog(state, params, store) {
    const {
      date = new Date().toISOString().slice(0, 10),
      account = '',
      type = '存入', // '存入' | '轉出' | '校正'
      currency = 'TWD',
      amount = 0,
      fxRate = 1,
      note = ''
    } = params;

    const numAmt = toNum(amount, NaN);
    if (!account || !Number.isFinite(numAmt) || numAmt === 0) {
      throw new Error('請選擇帳戶並輸入有效金額');
    }

    const rate = currency === 'USD' ? (toNum(fxRate, 32.5) || 32.5) : 1;
    const signedAmt = type === '轉出' ? -Math.abs(numAmt) : numAmt;
    const signedTwd = Math.round(signedAmt * rate);

    const logItem = {
      '日期': date,
      '帳戶名稱': account,
      '類別': type,
      '幣別': currency,
      '原幣變動': signedAmt,
      '折合台幣': signedTwd,
      '備註': note
    };

    store.updateState((draft) => {
      draft.asset.recentLogs.unshift(logItem);
      const targetAcc = draft.asset.accounts.find((a) => a['帳戶名稱'] === account);
      if (targetAcc) {
        if (type === '校正') {
          targetAcc['原幣金額'] = Math.abs(numAmt);
          targetAcc['台幣金額'] = Math.abs(signedTwd);
        } else {
          targetAcc['原幣金額'] = toNum(targetAcc['原幣金額'], 0) + signedAmt;
          targetAcc['台幣金額'] = toNum(targetAcc['台幣金額'], 0) + signedTwd;
        }
      }
      draft.asset.summary = AssetCore.getSummary(draft);
    }, {
      type: 'asset.appendAccountLog',
      payload: logItem
    });

    return { status: 'ok', logItem };
  },

  /**
   * 4. One-Click Inline Account Balance Reconciliation (快速對帳校正)
   * User enters actual current balance -> auto-calculates delta and updates account + log_V2
   */
  reconcileAccountBalance(state, params, store) {
    const {
      account = '',
      actualBalance = 0,
      date = new Date().toISOString().slice(0, 10),
      note = '快速對帳校正'
    } = params;

    const targetAcc = (state?.asset?.accounts || []).find((a) => a['帳戶名稱'] === account);
    if (!targetAcc) {
      throw new Error(`找不到帳戶：${account}`);
    }

    const newOrig = toNum(actualBalance, NaN);
    if (!Number.isFinite(newOrig) || newOrig < 0) {
      throw new Error('請輸入有效的實際帳戶餘額（≥ 0）');
    }

    const oldOrig = toNum(targetAcc['原幣金額'], 0);
    const oldTwd = toNum(targetAcc['台幣金額'], 0);
    const currency = targetAcc['幣別'] || 'TWD';
    const impliedFx = currency === 'TWD' ? 1 : (oldOrig > 0 ? oldTwd / oldOrig : 32.5);
    const newTwd = Math.round(newOrig * impliedFx);
    const deltaOrig = newOrig - oldOrig;
    const deltaTwd = newTwd - oldTwd;

    const logItem = {
      '日期': date,
      '帳戶名稱': account,
      '類別': '校正',
      '幣別': currency,
      '原幣變動': deltaOrig,
      '折合台幣': deltaTwd,
      '備註': `${note} (原 ${oldOrig.toLocaleString()} → 實盤 ${newOrig.toLocaleString()})`
    };

    store.updateState((draft) => {
      draft.asset.recentLogs.unshift(logItem);
      const acc = draft.asset.accounts.find((a) => a['帳戶名稱'] === account);
      if (acc) {
        acc['原幣金額'] = newOrig;
        acc['台幣金額'] = newTwd;
      }
      draft.asset.summary = AssetCore.getSummary(draft);
    }, {
      type: 'asset.appendAccountLog',
      payload: logItem
    });

    return { status: 'ok', account, oldOrig, newOrig, deltaOrig, deltaTwd, logItem };
  },

  /**
   * 5. Get Analytics Data for Charts (Long-term Net Worth, Allocation, Cashflow, Expense Breakdown)
   */
  getAnalyticsData(state) {
    const sum = AssetCore.getSummary(state);
    const rawSnapshots = (state?.asset?.snapshots && state.asset.snapshots.length > 0)
      ? state.asset.snapshots
      : (ASSET_EXTRA_DATA.snapshots || []);

    // Deduplicate or sample snapshots cleanly by date
    const seenDates = new Set();
    const snapshots = [];
    for (const s of rawSnapshots) {
      const d = String(s.date || '').trim();
      if (!d || seenDates.has(d)) continue;
      seenDates.add(d);
      snapshots.push({
        date: d,
        financialAssetsTwd: toNum(s.financialAssetsTwd, 0),
        grossAssetsTwd: toNum(s.grossAssetsTwd, 0),
        netWorthTwd: toNum(s.netWorthTwd, 0),
        debtTwd: toNum(s.debtTwd, 0)
      });
    }
    snapshots.sort((a, b) => a.date.localeCompare(b.date));

    // Allocation breakdown
    const totalFin = Math.max(1, sum.totalFinancialAssetsTwd);
    const allocation = [
      { label: '國內股票 (台股)', amount: sum.twStockTwd, ratio: sum.twStockTwd / totalFin },
      { label: '海外股票 (美股)', amount: sum.usStockTwd, ratio: sum.usStockTwd / totalFin },
      { label: '流動儲蓄 (活定存)', amount: sum.liquidSavingsTwd, ratio: sum.liquidSavingsTwd / totalFin },
      { label: '保障與預備金', amount: sum.protectionTwd, ratio: sum.protectionTwd / totalFin }
    ];

    // Monthly Cashflow History (2024~2026)
    const rawCashflow = (state?.asset?.cashflowHistory && state.asset.cashflowHistory.length > 0)
      ? state.asset.cashflowHistory
      : (ASSET_EXTRA_DATA.cashflowHistory || []);
    const cashflowHistory = rawCashflow
      .filter((c) => toNum(c.income, 0) > 0 || toNum(c.expense, 0) > 0)
      .map((c) => ({
        yearMonth: String(c.yearMonth || ''),
        income: toNum(c.income, 0),
        expense: toNum(c.expense, 0),
        savings: toNum(c.savings, toNum(c.income, 0) - toNum(c.expense, 0)),
        savingRate: toNum(c.savingRate, 0)
      }));

    // Expense Breakdown by Category, Payer, and Fixed/Variable
    const expenses = state?.asset?.recentExpenses || [];
    const byCategoryMap = {};
    const byPayerMap = {};
    const byFixedMap = { '變動': 0, '固定': 0 };
    let totalExpenseSample = 0;

    for (const e of expenses) {
      const amt = toNum(e['金額'], 0);
      if (amt <= 0) continue;
      totalExpenseSample += amt;
      const cat = String(e['主類別'] || '其他').trim();
      const payer = String(e['支付人'] || '未標註').trim();
      const fixed = String(e['固定/變動'] || '變動').includes('固定') ? '固定' : '變動';

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
      summary: sum,
      snapshots,
      allocation,
      cashflowHistory,
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
   * 6. Get Personal Salary & Bonus Data (N_薪資)
   */
  getSalaryData(state, options = {}) {
    const rawRecords = (state?.asset?.salaryRecords && state.asset.salaryRecords.length > 0)
      ? state.asset.salaryRecords
      : (ASSET_EXTRA_DATA.salaryRecords || []);

    const rawAnnual = (state?.asset?.salaryAnnual && state.asset.salaryAnnual.length > 0)
      ? state.asset.salaryAnnual
      : (ASSET_EXTRA_DATA.salaryAnnual || []);

    // Compute per-year Base Salary vs Bonus/Festival breakdown from detailed records
    const yearBreakdownMap = {};
    for (const r of rawRecords) {
      const yr = Number(r.year) || Number(String(r.yearTag || '').slice(0, 4)) || 0;
      if (!yr) continue;
      if (!yearBreakdownMap[yr]) {
        yearBreakdownMap[yr] = { year: yr, baseTotal: 0, bonusTotal: 0, total: 0, count: 0, maxSingle: 0 };
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
      if (amt > yearBreakdownMap[yr].maxSingle) yearBreakdownMap[yr].maxSingle = amt;
    }

    // Merge with sheet's annual summary table (2021~2026)
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

    // Compute YoY growth for annual summary
    for (let i = 0; i < annualList.length; i++) {
      if (i === 0) {
        annualList[i].yoyPct = null;
      } else {
        const prev = annualList[i - 1].annualSalary;
        annualList[i].yoyPct = prev > 0 ? ((annualList[i].annualSalary - prev) / prev) * 100 : null;
      }
    }

    const filterYear = options.year ? String(options.year) : 'ALL';
    const filterType = options.type || 'ALL'; // 'ALL' | 'BASE' | 'BONUS'

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
   * 7. Add New Salary / Bonus Record (N_薪資)
   */
  addSalaryRecord(state, params, store) {
    const {
      date = new Date().toISOString().slice(0, 10),
      item = '月薪水',
      amount = 0,
      detail = '',
      bigSpend = '',
      spendAmount = 0,
      bankDetail = '',
      note = ''
    } = params;

    const numAmt = toNum(amount, NaN);
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
      item: String(item || `${mo}月薪水`).trim(),
      date,
      amount: numAmt,
      detail: String(detail || '').trim(),
      bigSpend: String(bigSpend || '').trim(),
      spendAmount: toNum(spendAmount, 0),
      bankDetail: String(bankDetail || '').trim(),
      note: String(note || '').trim()
    };

    store.updateState((draft) => {
      if (!Array.isArray(draft.asset.salaryRecords) || draft.asset.salaryRecords.length === 0) {
        draft.asset.salaryRecords = [...(ASSET_EXTRA_DATA.salaryRecords || [])];
      }
      if (!Array.isArray(draft.asset.salaryAnnual) || draft.asset.salaryAnnual.length === 0) {
        draft.asset.salaryAnnual = [...(ASSET_EXTRA_DATA.salaryAnnual || [])];
      }
      draft.asset.salaryRecords.unshift(newRec);

      const targetYearRow = draft.asset.salaryAnnual.find((a) => Number(a.year) === yr);
      if (targetYearRow) {
        targetYearRow.annualSalary = toNum(targetYearRow.annualSalary, 0) + numAmt;
        targetYearRow.monthlyAvg = Math.round(targetYearRow.annualSalary / 12);
      } else {
        draft.asset.salaryAnnual.push({
          year: yr,
          annualSalary: numAmt,
          monthlyAvg: Math.round(numAmt / 12),
          estimatedAnnual: numAmt,
          estimatedMonthly: Math.round(numAmt / 12)
        });
      }
    }, {
      type: 'asset.appendSalary',
      payload: newRec
    });

    return { status: 'ok', record: newRec };
  }
};
