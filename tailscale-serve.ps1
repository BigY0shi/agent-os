# Make sure Tailscale fronts the dashboard at https://<this machine>.ts.net, so
# other tailnet devices get a secure context (the browser microphone needs one).
# Idempotent - safe to call from Start and Restart. Never fatal: a missing or
# signed-out Tailscale only means no remote HTTPS, and it says so.
#
# 2026-10-19: the serve root had been left pointing at 127.0.0.1:8766 with nothing
# listening there; it was repointed to 3737 by hand. If the root ever points at
# some OTHER live target again, this script reports it and leaves it alone rather
# than silently taking it over.
# Rollback: tailscale serve --https=443 off
$ErrorActionPreference = 'SilentlyContinue'
$target = 'http://127.0.0.1:3737'

$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts) { $ts = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe' }
if (-not (Test-Path $ts)) {
  Write-Host "   Tailscale not installed - remote HTTPS access is off" -ForegroundColor DarkGray
  exit 0
}

$st = & $ts status --json 2>$null | ConvertFrom-Json
if (-not $st -or $st.BackendState -ne 'Running') {
  Write-Host "   Tailscale is not connected - remote HTTPS access is off." -ForegroundColor Yellow
  Write-Host "   Open Tailscale from the tray and sign in, then run this again." -ForegroundColor Yellow
  exit 0
}
$dns = "$($st.Self.DNSName)".TrimEnd('.')

# Current root mapping for this machine's :443, if any.
$current = $null
$cfg = & $ts serve status --json 2>$null | ConvertFrom-Json
if ($cfg -and $cfg.Web) {
  $site = $cfg.Web.PSObject.Properties | Where-Object { $_.Name -eq "${dns}:443" } | Select-Object -First 1
  if ($site) { $current = $site.Value.Handlers.'/'.Proxy }
}

if ($current -eq $target) {
  Write-Host "   Tailscale HTTPS already on: https://$dns" -ForegroundColor Green
  exit 0
}
if ($current) {
  Write-Host "   Tailscale HTTPS root points at $current, not the dashboard - left alone." -ForegroundColor Yellow
  Write-Host "   To hand it to Agent OS: tailscale serve --bg 3737" -ForegroundColor Yellow
  exit 0
}

& $ts serve --bg 3737 *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "   Tailscale HTTPS on: https://$dns" -ForegroundColor Green
} else {
  Write-Host "   Tailscale serve FAILED (exit $LASTEXITCODE) - remote HTTPS access is off." -ForegroundColor Red
  Write-Host "   Try it by hand to see why: tailscale serve --bg 3737" -ForegroundColor Red
}
exit 0
