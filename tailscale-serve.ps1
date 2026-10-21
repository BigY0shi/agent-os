# Make sure Tailscale fronts the dashboard at https://<this machine>.ts.net, so
# other tailnet devices get a secure context (the browser microphone needs one).
# Idempotent - safe to call from Start and Restart. Never fatal: a missing or
# signed-out Tailscale only means no remote HTTPS, and it says so.
#
# 2026-10-19: the serve root had been left pointing at 127.0.0.1:8766 with nothing
# listening there; it was repointed to 3737 by hand. If HTTPS 443 is used for
# anything else, this script reports it and leaves it alone rather than silently
# taking it over.
# 2026-10-21: that "leave it alone" used to depend on finding the key "<dns>:443";
# with no DNS name, or a key in another form, it missed the existing handler and took
# over the root. It now refuses whenever it cannot identify this machine, and treats
# ANY 443 root or TCP forward it does not recognise as taken. The serve call also has
# a time limit: on a tailnet with HTTPS off, `tailscale serve` prints an enable link
# and waits, which used to freeze Start with nothing on screen.
# Rollback: tailscale serve --https=443 off
$ErrorActionPreference = 'SilentlyContinue'
$target = 'http://127.0.0.1:3737'
$serveTimeoutSec = 20

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
if (-not $dns) {
  # Without this machine's name we cannot tell our mapping from someone else's.
  Write-Host "   Tailscale has no DNS name for this machine (is MagicDNS off?) - HTTPS left as it is." -ForegroundColor Yellow
  exit 0
}

# Everything already using HTTPS port 443, from any site key and any handler type.
$taken = @()
$alreadyOurs = $false
$cfg = & $ts serve status --json 2>$null | ConvertFrom-Json
if ($cfg -and $cfg.Web) {
  foreach ($site in $cfg.Web.PSObject.Properties) {
    if ($site.Name -notmatch ':443$') { continue }
    $root = $site.Value.Handlers.'/'
    if (-not $root) { continue }
    $what = if ($root.Proxy) { $root.Proxy } elseif ($root.Path) { "files at $($root.Path)" } else { 'a text or other handler' }
    if ($site.Name -eq "${dns}:443" -and $root.Proxy -eq $target) { $alreadyOurs = $true }
    else { $taken += "$($site.Name) / -> $what" }
  }
}
if ($cfg -and $cfg.TCP -and $cfg.TCP.'443' -and $cfg.TCP.'443'.TCPForward) {
  $taken += "TCP 443 forwarded to $($cfg.TCP.'443'.TCPForward)"
}

if ($alreadyOurs -and $taken.Count -eq 0) {
  Write-Host "   Tailscale HTTPS already on: https://$dns" -ForegroundColor Green
  exit 0
}
if ($taken.Count -gt 0) {
  Write-Host "   Tailscale HTTPS 443 is used by something else - left alone:" -ForegroundColor Yellow
  foreach ($t in $taken) { Write-Host "     $t" -ForegroundColor Yellow }
  Write-Host "   To hand it to Agent OS: tailscale serve --bg 3737" -ForegroundColor Yellow
  exit 0
}

# Run serve with a time limit, keeping its output so a failure or an "enable HTTPS"
# link can be shown instead of hanging silently.
$out = Join-Path $env:TEMP 'agentos-tailscale-serve.out.txt'
$err = Join-Path $env:TEMP 'agentos-tailscale-serve.err.txt'
$p = Start-Process -FilePath $ts -ArgumentList @('serve','--bg','3737') -NoNewWindow -PassThru `
  -RedirectStandardOutput $out -RedirectStandardError $err
$null = $p.Handle   # keeps ExitCode readable after the process exits
if (-not $p.WaitForExit($serveTimeoutSec * 1000)) {
  # Our own child, closed by its PID.
  Stop-Process -Id $p.Id -Force
  Write-Host "   Tailscale serve did not finish in $serveTimeoutSec s - remote HTTPS access is off." -ForegroundColor Red
  Write-Host "   It usually waits for HTTPS to be enabled for the tailnet. What it said:" -ForegroundColor Red
  Get-Content $out, $err | Where-Object { $_ } | Select-Object -First 8 | ForEach-Object { Write-Host "     $_" -ForegroundColor Red }
  exit 0
}
if ($p.ExitCode -eq 0) {
  Write-Host "   Tailscale HTTPS on: https://$dns" -ForegroundColor Green
} else {
  Write-Host "   Tailscale serve FAILED (exit $($p.ExitCode)) - remote HTTPS access is off. What it said:" -ForegroundColor Red
  Get-Content $out, $err | Where-Object { $_ } | Select-Object -First 8 | ForEach-Object { Write-Host "     $_" -ForegroundColor Red }
}
exit 0
