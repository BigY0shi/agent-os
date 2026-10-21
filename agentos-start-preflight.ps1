# Everything "Start Agent OS.bat" does before npm start, in ONE PowerShell process
# (it used to start four). Exit codes are a contract with the batch file, which checks
# each one exactly - any other code, including a PowerShell failure, means "do not start":
#   0  port 3737 is free and nothing of ours is booting: go ahead and start
#   3  this repo's Agent OS is already running or still booting: open it, start nothing
#   4  something ELSE holds 3737: start nothing and say what it is
#   1  the preflight itself failed
# The voice servers and Tailscale go first (each idempotent), and the dashboard check
# goes LAST, so the gap between the check and npm start is as short as possible. The app
# itself also refuses a second instance at boot (src/instrumentation.ts,
# checkSingleInstance), which covers whatever is left of that gap.
try {
  . (Join-Path $PSScriptRoot 'agentos-common.ps1')

  # Local voice (Kokoro TTS 8880, Parakeet STT 8881) and Tailscale HTTPS. Each is a no-op
  # when missing or already up, and none of them can fail the start.
  & (Join-Path $PSScriptRoot 'kokoro-start.ps1')
  & (Join-Path $PSScriptRoot 'parakeet-start.ps1')
  & (Join-Path $PSScriptRoot 'tailscale-serve.ps1')

  $state = Get-DashboardState
  if ($state.Foreign.Count -gt 0) {
    Write-Host ""
    Write-Host "  NOT STARTED - port $AgentOsPort is held by something this repo does not recognise:" -ForegroundColor Red
    foreach ($f in $state.Foreign) { Write-Host "        PID $($f.Pid)  $($f.CommandLine)" -ForegroundColor Red }
    Write-Host "  If that is an older Agent OS, run Restart Agent OS.bat. Otherwise close it, then" -ForegroundColor Yellow
    Write-Host "  run Start again. To close it:  Stop-Process -Id $(($state.Foreign | ForEach-Object { $_.Pid }) -join ',') -Force" -ForegroundColor Yellow
    exit 4
  }
  if ($state.Ours.Count -gt 0) {
    Write-Host "  Agent OS is already running (PID $($state.Ours -join ', ')) - not starting a second copy." -ForegroundColor Green
    exit 3
  }
  exit 0
} catch {
  Write-Host "  Start preflight FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
