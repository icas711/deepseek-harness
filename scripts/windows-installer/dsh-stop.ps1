# Stops the custom-harness web server started by dsh-web.ps1: the process
# listening on the launcher's port — but only when its command line runs this
# installation's bin (the dev checkout on the same port is never touched) —
# plus any leftover node running the bin whose boot never reached the bind.
$ErrorActionPreference = 'Stop'

$port = 3080
$marker = '@deepseek-ai\dsh\lib\bin.js" web'
$stopped = @()
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)"
  if ($proc -ne $null -and $proc.CommandLine -like "*$marker*") {
    $stopped += $_.OwningProcess
    Stop-Process -Id $_.OwningProcess -Force
  }
}

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.CommandLine -like "*$marker*" -and $stopped -notcontains $_.ProcessId
} | ForEach-Object {
  $stopped += $_.ProcessId
  Stop-Process -Id $_.ProcessId -Force
}

if ($stopped.Count -eq 0) {
  Write-Host 'custom-harness server is not running.'
} else {
  Write-Host ("Stopped custom-harness server (PID {0})." -f ($stopped -join ', '))
}
