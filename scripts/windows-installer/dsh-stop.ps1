# Stops the DeepSeek Harness web server started by dsh-web.ps1, matching only
# node processes whose command line runs this installation's bin with `web`.
$ErrorActionPreference = 'Stop'

$marker = '@deepseek-ai\dsh\lib\bin.js" web'
$stopped = @()
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.CommandLine -like "*$marker*"
} | ForEach-Object {
  $stopped += $_.ProcessId
  Stop-Process -Id $_.ProcessId -Force
}

if ($stopped.Count -eq 0) {
  Write-Host 'DeepSeek Harness server is not running.'
} else {
  Write-Host ("Stopped DeepSeek Harness server (PID {0})." -f ($stopped -join ', '))
}
