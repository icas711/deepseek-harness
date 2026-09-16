# Launches the custom-harness web UI: starts the bundled server hidden when
# it is not already listening, then opens the UI in the default browser.
$ErrorActionPreference = 'Stop'

# Порт 3080 — общий с dev-чекоутом: пока dev-экземпляр держит порт, ярлык по
# single-instance дизайну просто открывает браузер на работающем экземпляре.
$port = 3080
$url = "http://127.0.0.1:$port/"
$root = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $root 'app'
$nodeExe = Join-Path $root 'node\node.exe'
$logDir = Join-Path $env:LOCALAPPDATA 'custom-harness\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

# Полный протокол запуска: без него мгновенная смерть окна не оставляет улик.
Start-Transcript -Path (Join-Path $logDir "launcher-$stamp.log") -IncludeInvocationHeader | Out-Null

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

try {
  if (Test-DshPort $port) {
    Write-Host "Порт $port уже занят работающим экземпляром custom-harness — открываю его в браузере. Новая иконка в трее при этом не появится."
  } else {
    $out = Join-Path $logDir "server-$stamp.out.log"
    $err = Join-Path $logDir "server-$stamp.err.log"
    $entry = Join-Path $appDir 'node_modules\@deepseek-ai\dsh\lib\bin.js'
    $child = Start-Process -FilePath $nodeExe `
      -ArgumentList "`"$entry`"", 'web', '--port', "$port" `
      -WindowStyle Hidden `
      -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
    # Первый после установки запуск медленный: хилер ссылок профиля и первый
    # проход антивируса по свежему дереву. Дедлайн с запасом, живой прогресс
    # вместо молчания, немедленный провал с хвостом лога при смерти процесса.
    $deadline = (Get-Date).AddSeconds(240)
    $startedAt = Get-Date
    $nextReport = (Get-Date).AddSeconds(5)
    Write-Host 'Запускаем custom-harness; первый запуск может занять около минуты…'
    while (-not (Test-DshPort $port) -and (Get-Date) -lt $deadline) {
      if ($child.HasExited) { break }
      Start-Sleep -Milliseconds 500
      if ((Get-Date) -gt $nextReport) {
        Write-Host ("  … ждём запуск сервера, {0} с" -f [int]((Get-Date) - $startedAt).TotalSeconds)
        $nextReport = (Get-Date).AddSeconds(5)
      }
    }
    if (-not (Test-DshPort $port)) {
      if ($child.HasExited) {
        Write-Host ("Сервер завершился с кодом {0}. Последние строки лога ({1}):" -f $child.ExitCode, $logDir)
        Get-Content $err -Tail 15 -ErrorAction SilentlyContinue | Write-Host
        Get-Content $out -Tail 15 -ErrorAction SilentlyContinue | Write-Host
      } else {
        Write-Host ("Сервер не открыл порт за 240 с, но процесс ещё работает; чуть позже откройте {0} вручную. Логи: {1}" -f $url, $logDir)
      }
      Read-Host 'Нажмите Enter, чтобы закрыть это окно'
      exit 1
    }
  }
} finally {
  Stop-Transcript | Out-Null
}

Start-Process $url
