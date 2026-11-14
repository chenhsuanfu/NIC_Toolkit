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
  [ValidateSet("manifest", "stock-tracker", "asset-tracker")]
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
        $exitsByTradeId = @{}
        foreach ($ex in $State.stock.recentExits) {
          $tid = ($ex.'交易id' -as [string]).Trim()
          if (-not $tid) { continue }
          if (-not $exitsByTradeId.ContainsKey($tid)) { $exitsByTradeId[$tid] = 0.0 }
          $exitsByTradeId[$tid] += (To-Num $ex.'出場股數')
        }
        $openLots = @()
        $totalRem = 0.0
        foreach ($tr in $State.stock.recentTrades) {
          $trSym = ($tr.'代號' -as [string]).Trim().ToUpper()
          if ($trSym -ne $sym) { continue }
          $tid = ($tr.'id' -as [string]).Trim()
          $inShares = To-Num $tr.'進場股數'
          $outShares = if ($exitsByTradeId.ContainsKey($tid)) { $exitsByTradeId[$tid] } else { 0.0 }
          $rem = [math]::Max(0.0, [math]::Round(($inShares - $outShares), 6))
          if ($rem -gt 0.00001) {
            $totalRem += $rem
            $openLots += @{
              tradeId = $tid
              type = $tr.'類型'
              broker = $tr.'券商'
              entryDate = $tr.'進場日'
              entryPrice = To-Num $tr.'進場價'
              entryShares = $inShares
              exitedShares = $outShares
              remainingShares = $rem
              note = $tr.'備註'
            }
          }
        }
        Write-AgentJson @{
          ok = $true
          exitCode = 0
          module = "stock-tracker"
          action = "getLotsBySymbol"
          data = @{
            symbol = $sym
            openLotCount = $openLots.Count
            totalRemainingShares = [math]::Round($totalRem, 4)
            openLots = $openLots
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
      default {
        Write-AgentJson @{ ok = $false; exitCode = 404; error = "Unsupported asset-tracker action: $Action" } 404
      }
    }
  }
} catch {
  Write-AgentJson @{
    ok = $false
    exitCode = 1
    error = $_.Exception.Message
  } 1
}
