import { agentBridge } from '../../core/agent-bridge.js';

const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  const cleaned = String(v).replace(/[$,%\s,]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
};

export const AssetCore = {
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

    const accounts = (state?.asset?.accounts || []).filter((a) => a['帳戶名']);
    const accountNames = Array.from(new Set(accounts.map((a) => a['帳戶名'])));

    return {
      natures: natures.length ? natures : ['收入', '支出', '轉帳', '校正'],
      ledgerCategories,
      expenseMainCategories: expenseMainCategories.length ? expenseMainCategories : ['餐費', '交通費', '通信費', '水電費', '訂閱', '其他'],
      expenseSubCategories,
      currencies: currencies.length ? currencies : ['TWD', 'USD', 'JPY', 'KRW'],
      payers: payers.length ? payers : ['炫甫', '垠宣', 'FS'],
      fixedVar: fixedVar.length ? fixedVar : ['固定', '變動'],
      accountNames,
      fxMap,
      targetTotalAsset: findParam('目標總資產', 7000000),
      realEstateBase: findParam('不動產基準值', 3332541)
    };
  },

  getSummary(state) {
    const opts = this.getConfigOptions(state);
    const accounts = (state?.asset?.accounts || []).filter((a) => a['帳戶名']);
    const debts = (state?.asset?.debts || []).filter((d) => d['債務名稱']);

    let liquidSavingsTwd = 0;
    let protectionTwd = 0;
    let twStockTwd = 0;
    let usStockTwd = 0;

    for (const acc of accounts) {
      const attr = acc['屬性'] || '儲蓄';
      const cur = acc['幣別'] || 'TWD';
      const rate = opts.fxMap[cur] || 1;
      const balNative = toNum(acc['目前餘額(自動)']);
      const balTwd = balNative * rate;

      if (attr === '儲蓄') {
        liquidSavingsTwd += balTwd;
      } else if (attr === '保障' || attr === '保險') {
        protectionTwd += balTwd;
      } else if (attr === '股票') {
        if (cur === 'TWD') twStockTwd += balTwd;
        else usStockTwd += balTwd;
      }
    }

    const totalFinancialAssetsTwd = liquidSavingsTwd + protectionTwd + twStockTwd + usStockTwd;
    const grossAssetsWithRealEstateTwd = totalFinancialAssetsTwd + opts.realEstateBase;

    let totalDebtTwd = 0;
    let monthlyDebtPaymentTwd = 0;
    for (const d of debts) {
      totalDebtTwd += toNum(d['目前餘額(自動)']);
      monthlyDebtPaymentTwd += toNum(d['每月還款']);
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
      grossAssetsWithRealEstateTwd: Math.round(grossAssetsWithRealEstateTwd),
      totalDebtTwd: Math.round(totalDebtTwd),
      monthlyDebtPaymentTwd: Math.round(monthlyDebtPaymentTwd),
      netWorthTwd: Math.round(netWorthTwd),
      targetTotalAssetTwd: Math.round(opts.targetTotalAsset),
      goalProgress,
      accountCount: accounts.length,
      debtCount: debts.length
    };
  },

  addExpense(state, params, storeInstance) {
    const date = String(params.date || params['日期'] || new Date().toISOString().slice(0, 10));
    const amount = toNum(params.amount ?? params['金額'], 0);
    const fixedVar = String(params.fixedVar || params['固定變動'] || '變動');
    const category = String(params.category || params['類別'] || '餐費');
    const subCategory = String(params.subCategory || params['子類別'] || '');
    const title = String(params.title || params['名目'] || '').trim();
    const payer = String(params.payer || params['負擔人'] || '炫甫');

    if (amount <= 0) throw new Error('開銷金額必須大於 0');
    if (!title) throw new Error('請輸入消費名目說明');

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

  addLedgerLog(state, params, storeInstance) {
    const date = String(params.date || params['日期'] || new Date().toISOString().slice(0, 10));
    const nature = String(params.nature || params['性質'] || '支出');
    const category = String(params.category || params['類別'] || '其他');
    const account = String(params.account || params['帳戶'] || '富邦');
    const currency = String(params.currency || params['幣別'] || 'TWD');
    const amount = toNum(params.amount ?? params['金額'], 0);
    const note = String(params.note || params['備註'] || '').trim();
    const tag = String(params.tag || params['標籤'] || '');

    if (amount === 0) throw new Error('流水金額不可為 0');

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
      // Optimistically update account balance
      const acc = s.asset.accounts.find((a) => a['帳戶名'] === account && (a['幣別'] || 'TWD') === currency);
      if (acc) {
        const curBal = toNum(acc['目前餘額(自動)']);
        if (nature === '收入') acc['目前餘額(自動)'] = String(curBal + Math.abs(amount));
        else if (nature === '支出') acc['目前餘額(自動)'] = String(curBal - Math.abs(amount));
        else if (nature === '校正') acc['目前餘額(自動)'] = String(amount);
      }
    });

    return record;
  }
};

// Register headless module for AI Agent & CLI usage
agentBridge.registerModule('asset-tracker', {
  description: '個人與家庭資產、銀行帳戶、收支流水與開銷明細模組 (對接 F&S Asset Report_V2 試算表)',
  actions: {
    getSummary: (state) => AssetCore.getSummary(state),
    getConfigOptions: (state) => AssetCore.getConfigOptions(state),
    addExpense: (state, params, store) => AssetCore.addExpense(state, params, store),
    addLedgerLog: (state, params, store) => AssetCore.addLedgerLog(state, params, store)
  },
  schemas: [
    {
      name: 'getSummary',
      description: '取得資金總額、流動儲蓄、保障資金、國內外股票、總負債與淨值摘要',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'addExpense',
      description: '新增一筆日常開銷至 F&S Asset Report_V2「開銷明細」分頁',
      parameters: {
        type: 'object',
        required: ['amount', 'category', 'title'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          amount: { type: 'number', description: '消費金額 (TWD)' },
          fixedVar: { type: 'string', enum: ['固定', '變動'] },
          category: { type: 'string', description: '消費大類，如 餐費、交通費、通信費、訂閱' },
          subCategory: { type: 'string', description: '消費子類別，如 TPASS、停車費、網路費' },
          title: { type: 'string', description: '消費名目說明' },
          payer: { type: 'string', description: '負擔人，如 炫甫、垠宣、FS' }
        }
      }
    },
    {
      name: 'addLedgerLog',
      description: '新增一筆銀行帳戶收支/轉帳/校正紀錄至 F&S Asset Report_V2「log_V2」分頁',
      parameters: {
        type: 'object',
        required: ['nature', 'category', 'account', 'amount'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          nature: { type: 'string', enum: ['收入', '支出', '轉帳', '校正'] },
          category: { type: 'string', description: '對應性質之類別，如 薪資、卡費、房貸、對帳校正' },
          account: { type: 'string', description: '帳戶名稱，如 富邦、台新、中信、元大' },
          currency: { type: 'string', enum: ['TWD', 'USD', 'JPY', 'KRW'] },
          amount: { type: 'number' },
          note: { type: 'string' }
        }
      }
    }
  ]
});
