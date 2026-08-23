# Launches the DeepSeek Harness web UI: starts the bundled server hidden when
# it is not already listening, then opens the UI in the default browser.
$ErrorActionPreference = 'Stop'

$port = 3080
$url = "http://127.0.0.1:$port/"
$root = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $root 'app'
$nodeExe = Join-Path $root 'node\node.exe'
$logDir = Join-Path $env:LOCALAPPDATA 'DeepSeek Harness\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Test-DshPort([int]$p) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $p)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

if (-not (Test-DshPort $port)) {
  $out = Join-Path $logDir "server-$stamp.out.log"
  $err = Join-Path $logDir "server-$stamp.err.log"
  $entry = Join-Path $appDir 'node_modules\@deepseek-ai\dsh\lib\bin.js'
  Start-Process -FilePath $nodeExe `
    -ArgumentList "`"$entry`"", 'web', '--port', "$port" `
    -WorkingDirectory $appDir -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
  $deadline = (Get-Date).AddSeconds(90)
  while (-not (Test-DshPort $port) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }
  if (-not (Test-DshPort $port)) {
    Write-Error "DeepSeek Harness server did not start within 90 s. Logs: $logDir"
    exit 1
  }
}

Start-Process $url
