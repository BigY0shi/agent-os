# Restart the Agent OS dashboard: kill the old / stale / zombie server, then launch
# a fresh one detached + hidden so it survives the launching window closing.
$ErrorActionPreference = 'SilentlyContinue'
$dir = $PSScriptRoot
$logDir = Join-Path $env:USERPROFILE '.agentic-os'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

Write-Host "  [1/3] Stopping the old server..."
$ids = @(Get-NetTCPConnection -LocalPort 3737 -State Listen | Select-Object -Expand OwningProcess -Unique)
$ids += @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'next.dist.bin.next start' } |
  Select-Object -Expand ProcessId)
# Kokoro local TTS restarts with the dashboard (port-scoped; relaunched below).
$ids += @(Get-NetTCPConnection -LocalPort 8880 -State Listen | Select-Object -Expand OwningProcess -Unique)
$ids = $ids | Sort-Object -Unique
foreach ($procId in ($ids | Where-Object { $_ })) {
  try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Host "        killed PID $procId" -ForegroundColor Yellow } catch {}
}
Start-Sleep -Milliseconds 1200

Write-Host "  [2/3] Starting a fresh server in the background..."
Start-Process -WindowStyle Hidden -FilePath 'node' `
  -ArgumentList @('node_modules\next\dist\bin\next','start','-H','0.0.0.0','-p','3737') `
  -WorkingDirectory $dir `
  -RedirectStandardOutput (Join-Path $logDir 'agentos-server.log') `
  -RedirectStandardError  (Join-Path $logDir 'agentos-server.err.log')

& (Join-Path $dir 'kokoro-start.ps1')

Write-Host "  [3/3] Waiting for it to come online..."
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  if (Get-NetTCPConnection -LocalPort 3737 -State Listen) { $ok = $true; break }
  Start-Sleep -Seconds 1
}
if ($ok) { Write-Host "        online at http://localhost:3737" -ForegroundColor Green }
else     { Write-Host "        still starting - see $logDir\agentos-server.err.log" -ForegroundColor Red }
