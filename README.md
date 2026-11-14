# NIC Toolkit | 個人財務與量化工具集基礎平台

一套專為 **iPhone 與電腦跨端使用**、**100% 免費資源打造**、具備 **0.05 秒 Local-First 瞬開體驗** 與 **人機雙軌演進（Human-to-Agent Scalability）** 的模組化個人工具集平台。

---

## ✨ 架構亮點

1. **0 秒瞬開（Local-First 快取引擎）**：
   - 前端採用零建置依賴（Zero-Build）原生 ES Modules + PWA Service Worker。
   - 開啟瞬間直接從本機快取（`localStorage` / 本地快照）渲染畫面，無需等待 Google Sheets 的 11 個分頁公式重算。
   - 新增股票買賣或日常記帳採用 **Optimistic UI（樂觀更新）**，按下去 **0.01 秒本機立即完成反應**，背景排入佇列同步至雲端。
2. **100% 無痛銜接既有 Google Sheets（公式安全保護鎖）**：
   - 直接對齊 `N_BD_C`（股票庫存紀錄）與 `F&S Asset Report_V2`（資產與收支紀錄）完整欄位與階層選單。
   - 後端 Google Apps Script (`backend-gas/Code.gs`) 內建 `CacheService` 記憶體快取，且嚴格執行 **Append-Only（只追加明細列）**，只寫入 `交易明細`、`出場明細`、`觀察清單`、`log_V2`、`開銷明細`，**絕不覆蓋** `總攬`、`風控`、`帳戶`、`N_3%目標`、`N_15%目標` 等公式分頁。
3. **內外部工具自由插拔（Plugin Hub Architecture）**：
   - 內建核心模組：**股票庫存與好股價估值 (`stock-tracker`)**、**資產與收支紀錄 (`asset-tracker`)**。
   - 內建外部量化系統傳送門：預設收錄 **MVP 量化分析系統 (`https://mvp-qas.com/`)** 與 **好股價 (`https://goodstockprice.com/`)**，並支援於首頁隨時掛載新工具。
4. **人機雙軌解耦（Human-to-Agent Evolution）**：
   - 每個工具模組嚴格拆分為 `manifest.json`（Schema）、`core.js`（純邏輯，零 DOM 依賴）與 `ui.js`（人機互動介面）。
   - 支援瀏覽器無頭調用 (`window.NIC_Agent.invoke(...)`) 與本機終端機 CLI 調用 (`scripts/agent-cli.ps1`)。

---

## 🚀 快速開始（電腦本機零安裝立即執行）

您的 Windows 電腦**不需安裝 Node.js 或 Python**，直接執行內建的 PowerShell 啟動腳本即可：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Port 8080 -OpenBrowser
```

啟動後瀏覽器將自動開啟 `http://localhost:8080`。

> **安全提示**：首次打開預設處於 **「🛡️ 本機安全沙盒模式」**（已預載您的試算表真實數據快照，但任何新增修改僅存於本機，100% 不會改動雲端原試算表，可盡情試按測試）。

---

## ☁️ 免費雲端部署與 iPhone 安裝指南

### 步驟 1：部署免費前端（GitHub Pages 或 Cloudflare Pages）
1. 將本專案推送至您的 GitHub 儲存庫（`.gitignore` 已自動排除 `data/local-snapshot.json`，確保公開程式碼零個資洩漏）。
2. 在 GitHub Repo 點選 **Settings -> Pages**，Branch 選擇 `main` 即可獲得免費的 `https://<您的帳號>.github.io/NIC_Toolkit/` 網址。
3. 用 **iPhone Safari** 打開該網址，點擊底部「分享」圖示 $\rightarrow$ **「加入主畫面」**，即可獲得像原生 App 一樣的全螢幕桌面圖示。

### 步驟 2：部署免費 Google Apps Script (GAS) 統一後端
1. 前往 [Google Apps Script](https://script.google.com/) 建立新專案，將 `backend-gas/Code.gs` 內容貼上。
2. 點選左側「⚙️ 專案設定」$\rightarrow$「指令碼屬性 (Script Properties)」，新增以下 3 個屬性：
   - `API_SECRET_TOKEN`：您自訂的私密通行密碼
   - `STOCK_SHEET_ID`：您的 `N_BD_C` 試算表網址中的檔案 ID
   - `ASSET_SHEET_ID`：您的 `F&S Asset Report_V2` 試算表網址中的檔案 ID
3. 點選右上角「部署」$\rightarrow$「新增部署作業」$\rightarrow$ 類型選「網頁應用程式（Web App）」，權限設為「所有人（Anyone）」，複製部署後的網址。
4. 在電腦打開 NIC Toolkit 的「**⚙️ 設定與 AI 雙軌中心**」，貼上 GAS 網址與 Token，點擊「**📱 產生 iPhone 一鍵配對連結**」，將連結傳給自己的 iPhone 點開即完成綁定！

---

## 🤖 AI Agent 無頭調用介面（Headless API & CLI）

### 1. 終端機 / 本機 Agent CLI 調用 (`scripts/agent-cli.ps1`)
```powershell
# 1. 取得所有已註冊工具之 JSON Schema
powershell -ExecutionPolicy Bypass -File .\scripts\agent-cli.ps1 -Module manifest

# 2. 查詢股票持倉總覽 (JSON 輸出)
powershell -ExecutionPolicy Bypass -File .\scripts\agent-cli.ps1 -Module stock-tracker -Action getSummary

# 3. 查詢個人資產與淨值總覽 (JSON 輸出)
powershell -ExecutionPolicy Bypass -File .\scripts\agent-cli.ps1 -Module asset-tracker -Action getSummary

# 4. 無頭推算好股價 EPS 與目標價
powershell -ExecutionPolicy Bypass -File .\scripts\agent-cli.ps1 -Module stock-tracker -Action estimateTargetPrice -ParamsJson '{"baseRevenue":28943,"growthRatePct":25,"netMarginPct":43,"shareCapital":259.3,"isTwStock":true,"targetPe":22}'
```

### 2. 瀏覽器 / WebView Agent API (`window.NIC_Agent`)
```javascript
// 讀取工具註冊表與參數 Schema
const schema = window.NIC_Agent.getManifest();

// 呼叫股票庫存新增買進
const res1 = await window.NIC_Agent.invoke('stock-tracker', 'addTrade', {
  symbol: 'NVDA', market: 'US', type: '進攻型', broker: 'F', price: 195.5, shares: 2, note: 'Agent 自動建倉'
});

// 呼叫資產紀錄新增日常開銷
const res2 = await window.NIC_Agent.invoke('asset-tracker', 'addExpense', {
  amount: 1200, fixedVar: '固定', category: '交通費', subCategory: 'TPASS', title: '通勤月票', payer: '炫甫'
});
```
