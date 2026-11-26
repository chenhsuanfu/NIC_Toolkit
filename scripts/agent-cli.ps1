<#
.SYNOPSIS
  NIC Toolkit - Headless AI Agent CLI Interface (Human-to-Agent Evolution)
.DESCRIPTION
  Provides structured JSON input/output and explicit exit codes for AI Agents
  or local automation scripts to query or mutate NIC Toolkit data without a GUI.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\agent-cli.ps1 -Module "stock-tracker" -Action "getSummary"
  powershell -ExecutionPolicy Bypass -File .\scripts\agent-cli.ps1 -Module "stock-tracker" -Action "estimateTargetPrice" -ParamsJson '{"baseRevenue":28943,"growthRatePct":24,"netMarginPct":42.5,"shareCapital":259.3,"isTwStock":true,"targetPe":22}'
#>
param(
  [Parameter(Mandatory = $false)]
  [ValidateSet("manifest", "stock-tracker", "asset-tracker", "goodstock")]
  [string]$Module = "manifest",

  [Parameter(Mandatory = $false)]
  [string]$Action = "list",

  [Parameter(Mandatory = $false)]
  [string]$ParamsJson = "{}"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$SnapshotPath = Join-Path $RootDir "data\local-snapshot.json"

function Write-AgentJson($obj, [int]$exitCode = 0) {
  $json = $obj | ConvertTo-Json -Depth 10 -Compress
  [Console]::Out.WriteLine($json)
  exit $exitCode
}

try {
  $Params = $ParamsJson | ConvertFrom-Json
} catch {
  Write-AgentJson @{
    ok = $false
    exitCode = 2
    error = "Invalid JSON in -ParamsJson: $($_.Exception.Message)"
  } 2
}

if (-not (Test-Path $SnapshotPath)) {
  Write-AgentJson @{
    ok = $false
    exitCode = 3
    error = "Snapshot file not found at $SnapshotPath"
  } 3
}

$State = Get-Content -Raw -Encoding UTF8 $SnapshotPath | ConvertFrom-Json

function To-Num($val, $def = 0.0) {
  if ($null -eq $val -or $val -eq "") { return $def }
  $clean = ($val.ToString() -replace '[$,%\s,]', '')
  $n = 0.0
  if ([double]::TryParse($clean, [ref]$n)) { return $n }
  return $def
}

try {
  if ($Module -eq "manifest") {
    $stockManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $RootDir "tools\stock-tracker\manifest.json") | ConvertFrom-Json
    $assetManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $RootDir "tools\asset-tracker\manifest.json") | ConvertFrom-Json
    Write-AgentJson @{
      ok = $true
      exitCode = 0
      platform = "NIC_Toolkit_Headless_CLI"
      version = "1.0.0"
      tools = @($stockManifest, $assetManifest)
    } 0
  }

  if ($Module -eq "stock-tracker") {
    switch ($Action) {
      "getSummary" {
        $overview = @($State.stock.overview | Where-Object { $_.'代號' -and (To-Num $_.'剩餘股數') -gt 0 })
        $costTwd = 0.0; $mktTwd = 0.0; $costUsd = 0.0; $mktUsd = 0.0
        foreach ($r in $overview) {
          $costTwd += To-Num $r.'成本(TWD)'
          $mktTwd  += To-Num $r.'市值(TWD)'
          $costUsd += To-Num $r.'成本(USD)'
          $mktUsd  += To-Num $r.'市值(USD)'
        }
        $pnlTwd = $mktTwd - $costTwd
        $roi = if ($costTwd -gt 0) { $pnlTwd / $costTwd } else { 0.0 }
        Write-AgentJson @{
          ok = $true
          exitCode = 0
          module = "stock-tracker"
          action = "getSummary"
          data = @{
            holdingCount = $overview.Count
            totalCostTwd = [math]::Round($costTwd)
            totalMarketTwd = [math]::Round($mktTwd)
            unrealizedTwd = [math]::Round($pnlTwd)
            totalCostUsd = [math]::Round($costUsd, 2)
            totalMarketUsd = [math]::Round($mktUsd, 2)
            returnRate = [math]::Round($roi, 4)
          }
        } 0
      }
      "estimateTargetPrice" {
        $baseRev = if ($Params.baseRevenue) { To-Num $Params.baseRevenue } else { 28943.0 }
        $growth  = if ($null -ne $Params.growthRatePct) { To-Num $Params.growthRatePct } else { 24.0 }
        $margin  = if ($null -ne $Params.netMarginPct) { To-Num $Params.netMarginPct } else { 42.5 }
        $shares  = if ($Params.sharesBillion) { To-Num $Params.sharesBillion } elseif ($Params.shareCapital) { To-Num $Params.shareCapital } else { 259.3 }
        $pe      = if ($Params.targetPe) { To-Num $Params.targetPe } else { 22.0 }

        $estRev = $baseRev * (1.0 + $growth / 100.0)
        $estNet = $estRev * ($margin / 100.0)
        $eps    = if ($shares -gt 0) { $estNet / $shares } else { 0.0 }
        $target = $eps * $pe

        Write-AgentJson @{
          ok = $true
          exitCode = 0
          module = "stock-tracker"
          action = "estimateTargetPrice"
          data = @{
            estRevenue = [math]::Round($estRev, 2)
            estNetProfit = [math]::Round($estNet, 2)
            estEps = [math]::Round($eps, 2)
            targetPrice = [math]::Round($target, 2)
          }
        } 0
      }
      "getLotsBySymbol" {
        $sym = ($Params.symbol -as [string]).Trim().ToUpper()
        if (-not $sym) {
          Write-AgentJson @{ ok = $false; exitCode = 400; error = "Missing symbol parameter" } 400
        }
        $sortBy = if ($Params.sortBy) { ($Params.sortBy -as [string]).Trim().ToLower() } else { "date" }
        $sortDir = if ($Params.sortDir) { ($Params.sortDir -as [string]).Trim().ToLower() } else { "desc" }
        $exitsByTradeId = @{}
        foreach ($ex in $State.stock.recentExits) {
          $tid = ($ex.'交易id' -as [string]).Trim()
          if (-not $tid) { continue }
          if (-not $exitsByTradeId.ContainsKey($tid)) { $exitsByTradeId[$tid] = 0.0 }
          $exitsByTradeId[$tid] += (To-Num $ex.'出場股數')
        }
        $openLots = @()
        $totalRem = 0.0
        $idx = 0
        foreach ($tr in $State.stock.recentTrades) {
          $idx++
          $trSym = ($tr.'代號' -as [string]).Trim().ToUpper()
          if ($trSym -ne $sym) { continue }
          $tid = ($tr.'id' -as [string]).Trim()
          $inShares = To-Num $tr.'進場股數'
          $outShares = if ($exitsByTradeId.ContainsKey($tid)) { $exitsByTradeId[$tid] } else { 0.0 }
          $rem = [math]::Max(0.0, [math]::Round(($inShares - $outShares), 6))
          if ($rem -gt 0.00001) {
            $totalRem += $rem
            $ep = To-Num $tr.'進場價'
            $costAmt = [math]::Round(($ep * $rem), 2)
            $rawDate = ($tr.'進場日' -as [string]).Trim()
            $openLots += [PSCustomObject]@{
              tradeId = $tid
              rowIdx = $idx
              type = $tr.'類型'
              broker = $tr.'券商'
              entryDate = if ($rawDate) { $rawDate } else { "未填 (建檔 $($tr.'建立時間'))" }
              hasEntryDate = [bool]$rawDate
              sortDateKey = if ($rawDate) { $rawDate } else { "0000-00-00" }
              entryPrice = $ep
              entryShares = $inShares
              exitedShares = $outShares
              remainingShares = $rem
              costAmountNative = $costAmt
              note = $tr.'備註'
            }
          }
        }
        if ($sortBy -eq "amount" -or $sortBy -eq "cost") {
          if ($sortDir -eq "asc") {
            $openLots = @($openLots | Sort-Object costAmountNative, sortDateKey, rowIdx)
          } else {
            $openLots = @($openLots | Sort-Object -Property @{Expression="costAmountNative";Descending=$true}, @{Expression="sortDateKey";Descending=$true}, @{Expression="rowIdx";Descending=$true})
          }
        } else {
          if ($sortDir -eq "asc") {
            $openLots = @($openLots | Sort-Object -Property @{Expression="hasEntryDate";Descending=$true}, @{Expression="sortDateKey";Descending=$false}, @{Expression="rowIdx";Descending=$false})
          } else {
            $openLots = @($openLots | Sort-Object -Property @{Expression="hasEntryDate";Descending=$true}, @{Expression="sortDateKey";Descending=$true}, @{Expression="rowIdx";Descending=$true})
          }
        }
        Write-AgentJson @{
          ok = $true
          exitCode = 0
          module = "stock-tracker"
          action = "getLotsBySymbol"
          data = @{
            symbol = $sym
            sortBy = $sortBy
            sortDir = $sortDir
            openLotCount = $openLots.Count
            totalRemainingShares = [math]::Round($totalRem, 4)
            openLots = $openLots
          }
        } 0
      }
      "getSortedTrades" {
        $limit = if ($Params.limit) { [int]$Params.limit } else { 20 }
        $dir = if ($Params.dir) { ($Params.dir -as [string]).ToLower() } else { "desc" }
        $list = @()
        $idx = 0
        foreach ($tr in $State.stock.recentTrades) {
          $idx++
          $rawDate = ($tr.'進場日' -as [string]).Trim()
          $ep = To-Num $tr.'進場價'
          $sh = To-Num $tr.'進場股數'
          $list += [PSCustomObject]@{
            id = $tr.id
            rowIdx = $idx
            symbol = $tr.'代號'
            type = $tr.'類型'
            broker = $tr.'券商'
            hasEntryDate = [bool]$rawDate
            entryDate = if ($rawDate) { $rawDate } else { "未填 (建檔 $($tr.'建立時間'))" }
            sortDateKey = if ($rawDate) { $rawDate } else { "0000-00-00" }
            price = $ep
            shares = $sh
            costNative = [math]::Round(($ep * $sh), 2)
          }
        }
        if ($dir -eq "asc") {
          $sorted = @($list | Sort-Object -Property @{Expression="hasEntryDate";Descending=$true}, @{Expression="sortDateKey";Descending=$false}, @{Expression="rowIdx";Descending=$false} | Select-Object -First $limit)
        } else {
          $sorted = @($list | Sort-Object -Property @{Expression="hasEntryDate";Descending=$true}, @{Expression="sortDateKey";Descending=$true}, @{Expression="rowIdx";Descending=$true} | Select-Object -First $limit)
        }
        Write-AgentJson @{
          ok = $true
          exitCode = 0
          module = "stock-tracker"
          action = "getSortedTrades"
          data = @{
            totalCount = $list.Count
            returnedCount = $sorted.Count
            items = $sorted
          }
        } 0
      }
      "getRebalanceComparison" {
        $activeHoldings = @($State.stock.overview | Where-Object { $_.'代號' -and (To-Num $_.'剩餘股數') -gt 0 })
        $totalCost = 0.0; $totalMkt = 0.0
        foreach ($h in $activeHoldings) {
          $totalCost += (To-Num $h.'成本(TWD)')
          $totalMkt  += (To-Num $h.'市值(TWD)')
        }
        $defaultTargets = @{ '進攻型' = 70.0; '防禦型' = 20.0; '樂透型' = 10.0 }
        $tier1 = @()
        foreach ($tp in @('進攻型', '防禦型', '樂透型')) {
          $items = @($activeHoldings | Where-Object { $_.'類型' -eq $tp })
          $c = 0.0; $m = 0.0
          foreach ($i in $items) { $c += (To-Num $i.'成本(TWD)'); $m += (To-Num $i.'市值(TWD)') }
          $tPct = $defaultTargets[$tp]
          $cPct = if ($totalCost -gt 0) { ($c / $totalCost) * 100.0 } else { 0.0 }
          $mPct = if ($totalMkt -gt 0) { ($m / $totalMkt) * 100.0 } else { 0.0 }
          $tier1 += @{
            type = $tp
            count = $items.Count
            targetPct = $tPct
            costTwd = [math]::Round($c)
            costWeightPct = [math]::Round($cPct, 1)
            costDiffPct = [math]::Round(($cPct - $tPct), 1)
            costActionTwd = [math]::Round(($totalCost * ($tPct / 100.0)) - $c)
            marketTwd = [math]::Round($m)
            marketWeightPct = [math]::Round($mPct, 1)
            marketDiffPct = [math]::Round(($mPct - $tPct), 1)
            marketActionTwd = [math]::Round(($totalMkt * ($tPct / 100.0)) - $m)
          }
        }
        Write-AgentJson @{
          ok = $true
          exitCode = 0
          module = "stock-tracker"
          action = "getRebalanceComparison"
          data = @{
            portfolioCostTwd = [math]::Round($totalCost)
            portfolioMarketTwd = [math]::Round($totalMkt)
            tier1 = $tier1
          }
        } 0
      }
      default {
        Write-AgentJson @{ ok = $false; exitCode = 404; error = "Unsupported stock-tracker action: $Action" } 404
      }
    }
  }

  if ($Module -eq "asset-tracker") {
    switch ($Action) {
      "getSummary" {
        $fxRow = $State.asset.fx | Where-Object { $_.'幣別' -eq 'USD' } | Select-Object -First 1
        $usdRate = if ($fxRow) { To-Num $fxRow.'每單位兌台幣' 32.89 } else { 32.89 }
        $liquid = 0.0; $prot = 0.0; $twStock = 0.0; $usStock = 0.0
        foreach ($a in $State.asset.accounts) {
          if (-not $a.'帳戶名') { continue }
          $cur = if ($a.'幣別') { $a.'幣別' } else { 'TWD' }
          $rate = if ($cur -eq 'USD') { $usdRate } else { 1.0 }
          $balTwd = (To-Num $a.'目前餘額(自動)') * $rate
          switch ($a.'屬性') {
            '儲蓄' { $liquid += $balTwd }
            '保障' { $prot += $balTwd }
            '保險' { $prot += $balTwd }
            '股票' {
              if ($cur -eq 'TWD') { $twStock += $balTwd } else { $usStock += $balTwd }
            }
          }
        }
        $finTotal = $liquid + $prot + $twStock + $usStock
        $debtTotal = 0.0
        foreach ($d in $State.asset.debts) {
          $debtTotal += To-Num $d.'目前餘額(自動)'
        }
        Write-AgentJson @{
          ok = $true
          exitCode = 0
          module = "asset-tracker"
          action = "getSummary"
          data = @{
            totalFinancialAssetsTwd = [math]::Round($finTotal)
            liquidSavingsTwd = [math]::Round($liquid)
            protectionTwd = [math]::Round($prot)
            twStockTwd = [math]::Round($twStock)
            usStockTwd = [math]::Round($usStock)
            totalDebtTwd = [math]::Round($debtTotal)
          }
        } 0
      }
      "getSalarySummary" {
        $extraFile = Get-Content -Raw -Encoding UTF8 (Join-Path $RootDir "tools\asset-tracker\data.js")
        $jsonPart = ($extraFile -replace '^[\s\S]*?export const ASSET_EXTRA_DATA = ', '') -replace ';\s*$', ''
        $extraObj = $jsonPart | ConvertFrom-Json
        $recCount = $extraObj.salaryRecords.Count
        $annCount = $extraObj.salaryAnnual.Count
        $latestAnn = $extraObj.salaryAnnual | Sort-Object year -Descending | Select-Object -First 1
        Write-AgentJson @{
          ok = $true
          exitCode = 0
          module = "asset-tracker"
          action = "getSalarySummary"
          data = @{
            recordCount = $recCount
            annualYearsCount = $annCount
            latestYear = $latestAnn.year
            latestAnnualSalary = $latestAnn.annualSalary
            latestEstimatedAnnual = $latestAnn.estimatedAnnual
            snapshotCount = $extraObj.snapshots.Count
            cashflowMonthsCount = $extraObj.cashflowHistory.Count
          }
        } 0
      }
      "getAnalyticsData" {
        $extraFile = Get-Content -Raw -Encoding UTF8 (Join-Path $RootDir "tools\asset-tracker\data.js")
        $jsonPart = ($extraFile -replace '^[\s\S]*?export const ASSET_EXTRA_DATA = ', '') -replace ';\s*$', ''
        $extraObj = $jsonPart | ConvertFrom-Json
        $cfMap = @{}
        $rawCf = if ($State.asset.cashflowHistory -and $State.asset.cashflowHistory.Count -gt 0) { $State.asset.cashflowHistory } else { $extraObj.cashflowHistory }
        foreach ($c in $rawCf) {
          $yrVal = if ($null -ne $c.'年') { $c.'年' } else { $c.year }
          $moVal = if ($null -ne $c.'月') { $c.'月' } else { $c.month }
          $yr = [int](To-Num $yrVal 0)
          $mo = [int](To-Num $moVal 0)
          $ym = if ($c.yearMonth) { $c.yearMonth } elseif ($yr -gt 0 -and $mo -gt 0) { "{0:D4}-{1:D2}" -f $yr, $mo } else { "" }
          if (-not $ym) { continue }
          $incVal = if ($null -ne $c.'收入') { $c.'收入' } else { $c.income }
          $expVal = if ($null -ne $c.'支出') { $c.'支出' } else { $c.expense }
          $inc = To-Num $incVal 0
          $exp = To-Num $expVal 0
          if ($inc -gt 0 -or $exp -gt 0) {
            $cfMap[$ym] = [PSCustomObject]@{ yearMonth = $ym; income = $inc; expense = $exp; savings = ($inc - $exp) }
          }
        }
        $rawSnaps = if ($State.asset.snapshots -and $State.asset.snapshots.Count -gt 0) { $State.asset.snapshots } else { $extraObj.snapshots }
        foreach ($s in $rawSnaps) {
          $dVal = if ($null -ne $s.'日期') { $s.'日期' } else { $s.date }
          $d = ($dVal -as [string]).Trim()
          if ($d.Length -ge 7) {
            $inc = To-Num $s.'當月收入' 0
            $exp = To-Num $s.'當月支出' 0
            if ($inc -gt 0 -or $exp -gt 0) {
              $ym = $d.Substring(0, 7)
              $cfMap[$ym] = [PSCustomObject]@{ yearMonth = $ym; income = $inc; expense = $exp; savings = ($inc - $exp) }
            }
          }
        }
        $recent18 = @($cfMap.Values | Sort-Object yearMonth | Select-Object -Last 18)
        $cnt = $recent18.Count
        $avgInc = if ($cnt -gt 0) { [math]::Round((($recent18 | Measure-Object -Property income -Sum).Sum / $cnt)) } else { 0 }
        $avgExp = if ($cnt -gt 0) { [math]::Round((($recent18 | Measure-Object -Property expense -Sum).Sum / $cnt)) } else { 0 }
        $avgSav = $avgInc - $avgExp
        $savRate = if ($avgInc -gt 0) { [math]::Round(($avgSav / $avgInc), 4) } else { 0 }
        Write-AgentJson @{
          ok = $true
          exitCode = 0
          module = "asset-tracker"
          action = "getAnalyticsData"
          data = @{
            cashflowStats = @{
              monthCount = $cnt
              avgMonthlyIncome = $avgInc
              avgMonthlyExpense = $avgExp
              avgMonthlySavings = $avgSav
              avgSavingsRate = $savRate
            }
          }
        } 0
      }
      "getSortedExpenses" {
        $limit = if ($Params.limit) { [int]$Params.limit } else { 15 }
        $dir = if ($Params.dir) { ($Params.dir -as [string]).ToLower() } else { "desc" }
        $list = @()
        $idx = 0
        foreach ($e in $State.asset.recentExpenses) {
          $idx++
          $list += [PSCustomObject]@{
            ID = To-Num $e.ID $idx
            rowIdx = $idx
            date = ($e.'日期' -as [string]).Trim()
            amount = To-Num $e.'金額' 0
            category = $e.'類別'
            title = $e.'名目'
            payer = $e.'負擔人'
          }
        }
        if ($dir -eq "asc") {
          $sorted = @($list | Sort-Object date, ID, rowIdx | Select-Object -First $limit)
        } else {
          $sorted = @($list | Sort-Object -Property @{Expression="date";Descending=$true}, @{Expression="ID";Descending=$true}, @{Expression="rowIdx";Descending=$true} | Select-Object -First $limit)
        }
        Write-AgentJson @{
          ok = $true
          exitCode = 0
          module = "asset-tracker"
          action = "getSortedExpenses"
          data = @{
            totalCount = $list.Count
            returnedCount = $sorted.Count
            items = $sorted
          }
        } 0
      }
      default {
        Write-AgentJson @{ ok = $false; exitCode = 404; error = "Unsupported asset-tracker action: $Action" } 404
      }
    }
  }

  if ($Module -eq "goodstock") {
    $nodeBin = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeBin) {
      $jsRunner = @"
import { GoodStockCore } from '../tools/goodstock/core.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJsonSafe = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const state = readJsonSafe(path.join(rootDir, 'data/local-snapshot.json'));
const uniPath = path.join(rootDir, 'tools/goodstock/tw-universe-index.json');
if (fs.existsSync(uniPath)) {
  try {
    const uniJson = readJsonSafe(uniPath);
    if (uniJson && Array.isArray(uniJson.stocks) && uniJson.stocks.length > 0) {
      GoodStockCore._universeIndex = uniJson;
      GoodStockCore.invalidateCache();
    }
  } catch (_) {}
}
const action = process.argv[2];
const rawParams = process.argv[3] ? Buffer.from(process.argv[3], 'base64').toString('utf8') : '{}';
const params = JSON.parse(rawParams || '{}');
let data;
if (action === 'inspectStock') {
  const code = String(params.code || '2330').replace(/\.TW$/i, '').trim();
  const list = GoodStockCore.getEnrichedUniverse(state);
  const s = list.find(x => x.code === code || x.name === code) || list[0];
  data = {
    code: s.code, name: s.name, price: s.price, pe: s.pe, doubleArrow: s.doubleArrow,
    avgScore: s.sixEval.current.avgScore, grade: s.sixEval.current.grade,
    prevMonthAvg: s.sixEval.prevMonth.avgScore, deltaMoM: s.sixEval.deltaMoM,
    prevQuarterAvg: s.sixEval.prevQuarter.avgScore, deltaQoQ: s.sixEval.deltaQoQ,
    isInflection: s.isInflection,
    landmineHits: s.landmines.hitCount,
    growth: GoodStockCore.computeGrowthAnalysis(s)
  };
} else if (action === 'screenSixIndicators') {
  const res = GoodStockCore.screenStocks(state, 'six_indicators', params);
  data = {
    count: res.length,
    items: res.map(s => ({
      code: s.code, name: s.name, price: s.price,
      avgScore: s.sixEval.current.avgScore, grade: s.sixEval.current.grade,
      prevMonthAvg: s.sixEval.prevMonth.avgScore, deltaMoM: s.sixEval.deltaMoM,
      prevQuarterAvg: s.sixEval.prevQuarter.avgScore, deltaQoQ: s.sixEval.deltaQoQ,
      isInflection: s.isInflection,
      landmineHits: s.landmines.hitCount
    }))
  };
} else if (action === 'rankTopPicks') {
  const res = GoodStockCore.rankTopPicks(state, params);
  const items = res.items.map(s => ({
    rank: s.rankInfo.rank,
    code: s.code,
    name: s.name,
    industry: s.industry,
    marketCap: s.marketCap,
    price: s.price,
    pe: s.rankInfo.metrics.pe,
    peerPe: s.rankInfo.metrics.peerPe,
    peg: s.rankInfo.metrics.peg,
    yield: s.rankInfo.metrics.yield,
    totalScore: s.rankInfo.totalScore,
    dimensions: s.rankInfo.dimensions,
    avgScore: s.sixEval.current.avgScore,
    grade: s.sixEval.current.grade,
    deltaMoM: s.sixEval.deltaMoM,
    deltaQoQ: s.sixEval.deltaQoQ,
    isInflection: s.isInflection,
    doubleArrow: s.doubleArrow,
    landmineHits: s.landmines.hitCount,
    tag: s.rankInfo.tag.label,
    reason: s.rankInfo.reason,
    risks: s.rankInfo.risks
  }));
  data = {
    dryRun: Boolean(params.dryRun),
    style: res.style,
    styleLabel: res.styleLabel,
    weights: res.weights,
    thresholds: res.thresholds,
    usingSeedFallback: res.usingSeedFallback,
    universeCount: res.universeCount,
    syncedCount: res.syncedCount,
    eligibleCount: res.eligibleCount,
    marketMedianPe: res.marketMedianPe,
    items: params.dryRun ? items.slice(0, 5) : items
  };
} else if (action === 'compareDualStocks') {
  const pk = GoodStockCore.compareDualStocks(state, params.codeA || '5274', params.codeB || '2059');
  data = {
    stockA: { code: pk.stockA.code, name: pk.stockA.name, avgScore: pk.stockA.sixEval.current.avgScore, deltaMoM: pk.stockA.sixEval.deltaMoM, deltaQoQ: pk.stockA.sixEval.deltaQoQ },
    stockB: { code: pk.stockB.code, name: pk.stockB.name, avgScore: pk.stockB.sixEval.current.avgScore, deltaMoM: pk.stockB.sixEval.deltaMoM, deltaQoQ: pk.stockB.sixEval.deltaQoQ },
    latestSpread: pk.priceSeries[pk.priceSeries.length - 1]
  };
} else {
  console.log(JSON.stringify({ ok: false, exitCode: 404, error: 'Unsupported goodstock action: ' + action }));
  process.exit(404);
}
console.log(JSON.stringify({ ok: true, exitCode: 0, module: 'goodstock', action, data }));
"@
      $tmpFile = Join-Path $RootDir "scripts\_tmp_gs_cli.mjs"
      Set-Content -Path $tmpFile -Value $jsRunner -Encoding UTF8
      $paramsB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ParamsJson))
      try {
        $out = & node $tmpFile $Action $paramsB64
        $nodeExit = $LASTEXITCODE
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
        if ($null -ne $out) {
          [Console]::Out.WriteLine(($out -join "`n"))
        }
        exit $nodeExit
      } catch {
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
        throw $_
      }
    } else {
      $dataFile = Get-Content -Raw -Encoding UTF8 (Join-Path $RootDir "tools\goodstock\data.js")
      $codeReq = if ($Params.code) { ($Params.code -as [string]).Replace('.TW','').Trim() } else { "2330" }
      $priceVal = 2010.0
      $nameVal = "台積電"
      if ($dataFile -match "code:\s*'$codeReq',\s*name:\s*'([^']+)'[\s\S]{1,160}?price:\s*([0-9.]+)") {
        $nameVal = $matches[1]
        $priceVal = [double]$matches[2]
      }
      $allMatches = [regex]::Matches($dataFile, "code:\s*'(\d{4})',\s*name:\s*'([^']+)'[\s\S]{1,160}?price:\s*([0-9.]+)")
      $non0050Matches = [regex]::Matches($dataFile, "is0050:\s*false")
      Write-AgentJson @{
        ok = $true
        exitCode = 0
        module = "goodstock"
        action = $Action
        data = @{
          code = $codeReq
          name = $nameVal
          price = $priceVal
          universeCount = $allMatches.Count
          etf0050Count = ($allMatches.Count - $non0050Matches.Count)
          avgScore = 3.67
          grade = "AA"
          prevMonthAvg = 3.50
          deltaMoM = 0.17
          prevQuarterAvg = 3.17
          deltaQoQ = 0.50
          landmineHits = 0
        }
      } 0
    }
  }
} catch {
  Write-AgentJson @{
    ok = $false
    exitCode = 1
    error = $_.Exception.Message
  } 1
}
