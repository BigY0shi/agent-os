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
# Get-DashboardPids (every 3737 listener plus this repo's booting `next start`) and
# Get-VoiceServerPids live in agentos-common.ps1 (2026-10-21), shared with Stop and the
# Start preflight so "is this ours" has one definition.
. (Join-Path $dir 'agentos-common.ps1')
$logDir = Join-Path $env:USERPROFILE '.agentic-os'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

Write-Host "  [1/3] Stopping the old server..."
# Local voice servers are stopped and relaunched below too - but only OUR Kokoro and
# Parakeet (ownership checked), and deliberately NOT part of the abort check: a stuck
# voice server must not block the dashboard restart.
$kokoro   = Get-VoiceServerPids 8880 'kokoro-tts'
$parakeet = Get-VoiceServerPids 8881 'parakeet-stt'
foreach ($procId in (@($kokoro.Foreign) + @($parakeet.Foreign) | Where-Object { $_ } | Sort-Object -Unique)) {
  Write-Host "        left alone: PID $procId on a voice port is not ours - $((Get-AgentOsProc $procId).CommandLine)" -ForegroundColor Yellow
}
foreach ($procId in (@(Get-DashboardPids) + @($kokoro.Ours) + @($parakeet.Ours) | Where-Object { $_ } | Sort-Object -Unique)) {
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
# Absolute path so the sweep above can see the repo folder in the command line.
# Quoted by hand: Start-Process joins -ArgumentList with spaces and quotes nothing.
$nextBin = Join-Path $dir 'node_modules\next\dist\bin\next'
Start-Process -WindowStyle Hidden -FilePath 'node' `
  -ArgumentList @(('"' + $nextBin + '"'),'start','-H','0.0.0.0','-p','3737') `
  -WorkingDirectory $dir `
  -RedirectStandardOutput (Join-Path $logDir 'agentos-server.log') `
  -RedirectStandardError  (Join-Path $logDir 'agentos-server.err.log')

& (Join-Path $dir 'kokoro-start.ps1')
& (Join-Path $dir 'parakeet-start.ps1')

Write-Host "  [3/3] Waiting for it to come online..."
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  if (Get-NetTCPConnection -LocalPort 3737 -State Listen) { $ok = $true; break }
  Start-Sleep -Seconds 1
}
if ($ok) { Write-Host "        online at http://localhost:3737" -ForegroundColor Green }
else {
  # 2026-09-02: this used to print "still starting" and exit 0, so the batch
  # file said "Done" while nothing listened. The usual reason is the new
  # server refusing to start; its own words are in the err log, so show them.
  Write-Host ""
  Write-Host "  NOT ONLINE after 40 s. The server's last words:" -ForegroundColor Red
  $errLog = Join-Path $logDir 'agentos-server.err.log'
  if (Test-Path $errLog) { Get-Content $errLog -Tail 6 | ForEach-Object { Write-Host "        $_" -ForegroundColor Red } }
  Write-Host ""
  Write-Host "  If it says an old PID still holds the lock and that PID is gone, wait a" -ForegroundColor Yellow
  Write-Host "  minute for the lock to go stale (or rebuild: the guard now checks the PID)" -ForegroundColor Yellow
  Write-Host "  and run this again." -ForegroundColor Yellow
  exit 1
}
