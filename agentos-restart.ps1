# Restart the Agent OS dashboard: kill the old / stale / zombie server, then launch
# a fresh one detached + hidden so it survives the launching window closing.
#
# 2026-08-29: this used to report success whether or not the old server actually
# died. $ErrorActionPreference='SilentlyContinue' plus an empty catch{} meant a
# failed Stop-Process looked exactly like a successful one, and the new server
# came up alongside the old one. Because Next binds one address family at a time,
# two servers can hold 3737 at once (0.0.0.0 and ::) without EADDRINUSE — they
# then shared one SQLite file and one approvals.json and quietly corrupted run
# state. The kill is now verified, and the launch is abandoned if it failed.
$ErrorActionPreference = 'SilentlyContinue'
$dir = $PSScriptRoot
$logDir = Join-Path $env:USERPROFILE '.agentic-os'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Get-DashboardPids {
  # EVERY address family on 3737 - the 2026-08-29 split brain was one server on
  # 0.0.0.0 and another on ::. Plus any next-start node process not yet
  # listening (still booting), which would grab the port moments from now.
  $ids = @()
  $ids += @(Get-NetTCPConnection -LocalPort 3737 -State Listen | Select-Object -Expand OwningProcess -Unique)
  $ids += @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'next.dist.bin.next start' } |
    Select-Object -Expand ProcessId)
  return @($ids | Where-Object { $_ } | Sort-Object -Unique)
}

function Get-KokoroPids {
  # Local TTS - port-scoped, relaunched below. Deliberately NOT part of the
  # abort check: a stuck voice server must not block the dashboard restart.
  return @(Get-NetTCPConnection -LocalPort 8880 -State Listen |
    Select-Object -Expand OwningProcess -Unique | Where-Object { $_ })
}

Write-Host "  [1/3] Stopping the old server..."
foreach ($procId in (@(Get-DashboardPids) + @(Get-KokoroPids) | Sort-Object -Unique)) {
  try {
    Stop-Process -Id $procId -Force -ErrorAction Stop
    Write-Host "        killed PID $procId" -ForegroundColor Yellow
  } catch {
    Write-Host "        COULD NOT kill PID $procId - $($_.Exception.Message)" -ForegroundColor Red
  }
}
Start-Sleep -Milliseconds 1200

# Verify. A survivor here is the whole bug: launching now would create the split
# brain, so we stop and tell the human exactly what is in the way.
$survivors = @(Get-DashboardPids)
if ($survivors.Count -gt 0) {
  Write-Host ""
  Write-Host "  ABORTED - these processes are still holding the port:" -ForegroundColor Red
  foreach ($procId in $survivors) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
    if ($p) { Write-Host "        PID $procId  $($p.CommandLine)" -ForegroundColor Red }
    else    { Write-Host "        PID $procId" -ForegroundColor Red }
  }
  Write-Host ""
  Write-Host "  Starting a second server would corrupt run state (both would share" -ForegroundColor Yellow
  Write-Host "  one database and one approvals file). Close them, then run this again:" -ForegroundColor Yellow
  Write-Host "        Stop-Process -Id $($survivors -join ',') -Force" -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

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
