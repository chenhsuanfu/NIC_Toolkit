param(
  [int]$Port = 8080,
  [switch]$OpenBrowser = $false,
  [switch]$SelfTest = $false
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot

$MimeTypes = @{
  ".html"        = "text/html; charset=utf-8"
  ".js"          = "application/javascript; charset=utf-8"
  ".mjs"         = "application/javascript; charset=utf-8"
  ".css"         = "text/css; charset=utf-8"
  ".json"        = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".svg"         = "image/svg+xml"
  ".png"         = "image/png"
  ".ico"         = "image/x-icon"
}

$Endpoint = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Loopback, $Port)
$Listener = New-Object System.Net.Sockets.TcpListener($Endpoint)
$Listener.Start()

$Url = "http://127.0.0.1:$Port/"
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 🚀 NIC Toolkit 本地極速伺服器已啟動 (免管理員權限 · 零外部依賴)" -ForegroundColor Green
Write-Host " 🌐 電腦瀏覽器網址 : $Url" -ForegroundColor Yellow
Write-Host " 📁 專案根目錄     : $RootDir" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan

if ($OpenBrowser) {
  Start-Process $Url
}

try {
  $reqCount = 0
  while ($true) {
    $Client = $Listener.AcceptTcpClient()
    $Stream = $Client.GetStream()
    $Reader = New-Object System.IO.StreamReader($Stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)

    $RequestLine = $Reader.ReadLine()
    while ($true) {
      $HeaderLine = $Reader.ReadLine()
      if ([string]::IsNullOrEmpty($HeaderLine)) { break }
    }

    if (-not [string]::IsNullOrEmpty($RequestLine)) {
      $Parts = $RequestLine.Split(' ')
      $RawUrl = if ($Parts.Length -ge 2) { $Parts[1] } else { "/" }
      $UrlPath = ($RawUrl -split '\?')[0]
      if ($UrlPath -eq "/" -or $UrlPath -eq "") {
        $UrlPath = "/index.html"
      }

      $SafeRelPath = [System.Uri]::UnescapeDataString($UrlPath.TrimStart('/')).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $FullPath = Join-Path $RootDir $SafeRelPath

      if ((Test-Path $FullPath) -and -not (Get-Item $FullPath).PSIsContainer) {
        $Ext = [System.IO.Path]::GetExtension($FullPath).ToLower()
        $ContentType = if ($MimeTypes.ContainsKey($Ext)) { $MimeTypes[$Ext] } else { "application/octet-stream" }
        $BodyBytes = [System.IO.File]::ReadAllBytes($FullPath)
        $StatusHeader = "HTTP/1.1 200 OK`r`nContent-Type: $ContentType`r`nContent-Length: $($BodyBytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
      } else {
        $BodyBytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"error":"Not Found"}')
        $StatusHeader = "HTTP/1.1 404 Not Found`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($BodyBytes.Length)`r`nConnection: close`r`n`r`n"
      }

      $HeaderBytes = [System.Text.Encoding]::ASCII.GetBytes($StatusHeader)
      $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)
      $Stream.Write($BodyBytes, 0, $BodyBytes.Length)
      $Stream.Flush()
    }

    $Client.Close()
    $reqCount++
    if ($SelfTest -and $reqCount -ge 3) {
      break
    }
  }
} finally {
  $Listener.Stop()
}
