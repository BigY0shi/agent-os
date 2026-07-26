# Show or change the Agent OS LAN password (AGENTOS_PASSWORD in .env.local).
#
#   .\agentos-password.ps1                 show the current password + the LAN URL
#   .\agentos-password.ps1 -Set "hunter2"  set a specific password
#   .\agentos-password.ps1 -Random         generate + set a strong 20-char password
#   .\agentos-password.ps1 -Random -Restart  ...and restart the server so it takes effect
#
# The gate lives in src/proxy.ts: it fails CLOSED, so an empty/missing password
# locks the whole dashboard rather than opening it. Next.js reads .env.local once
# at server START, so any change here needs a restart before it applies.

param(
  [string]$Set,
  [switch]$Random,
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'
$dir     = $PSScriptRoot
$envFile = Join-Path $dir '.env.local'
$key     = 'AGENTOS_PASSWORD'

if (-not (Test-Path $envFile)) { Write-Host "  No .env.local at $envFile" -ForegroundColor Red; exit 1 }

function Get-Password {
  $line = Get-Content $envFile | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  # Strip the key, then any surrounding quotes.
  ($line -replace "^\s*$key\s*=\s*", '') -replace '^["'']|["'']$', ''
}

function Show-Access {
  param([string]$pw)
  # This box has WSL/Hyper-V virtual adapters (172.x) that look like LAN IPs but are
  # unreachable from another machine. The REAL one is whichever adapter carries the
  # default route, so resolve that first and demote everything else.
  $primaryIdx = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric | Select-Object -First 1).InterfaceIndex

  $addrs = @(Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' })

  $primary = $addrs | Where-Object { $_.InterfaceIndex -eq $primaryIdx } | Select-Object -First 1
  $others  = $addrs | Where-Object { $_.InterfaceIndex -ne $primaryIdx }

  Write-Host ""
  Write-Host "  Password : " -NoNewline; Write-Host $pw -ForegroundColor Cyan
  Write-Host "  This PC  : http://localhost:3737"
  if ($primary) {
    Write-Host "  On LAN   : " -NoNewline
    Write-Host ("http://{0}:3737" -f $primary.IPAddress) -ForegroundColor Green
  }
  foreach ($a in $others) {
    Write-Host ("           http://{0}:3737   (virtual adapter - probably not reachable)" -f $a.IPAddress) -ForegroundColor DarkGray
  }
  Write-Host ""
}

# ── Read-only mode ────────────────────────────────────────────────────────────
if (-not $Set -and -not $Random) {
  $pw = Get-Password
  if (-not $pw) {
    Write-Host "  $key is not set - the dashboard is LOCKED (the gate fails closed)." -ForegroundColor Red
    Write-Host "  Fix it with:  .\agentos-password.ps1 -Random -Restart"
    exit 1
  }
  Show-Access $pw
  exit 0
}

# ── Write mode ────────────────────────────────────────────────────────────────
if ($Random) {
  # Unambiguous alphabet: no 0/O/1/l/I, so it survives being read off a screen
  # and typed on the other machine.
  $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
  $bytes = [byte[]]::new(20)
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $Set = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

if ($Set.Length -lt 8) { Write-Host "  Too short - use at least 8 characters." -ForegroundColor Red; exit 1 }
if ($Set -match '[\r\n]') { Write-Host "  Password cannot contain newlines." -ForegroundColor Red; exit 1 }

# Back the file up before rewriting it - .env.local holds every other API key too.
$stamp  = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$backup = Join-Path $dir ".exile\$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Copy-Item $envFile (Join-Path $backup '.env.local') -Force

# Rewrite just the one line; leave every other key untouched.
$lines = Get-Content $envFile
if ($lines | Where-Object { $_ -match "^\s*$key\s*=" }) {
  $lines = $lines | ForEach-Object { if ($_ -match "^\s*$key\s*=") { "$key=$Set" } else { $_ } }
} else {
  $lines += "$key=$Set"
}
Set-Content -Path $envFile -Value $lines -Encoding UTF8

Write-Host "  Updated $key  (backup: .exile\$stamp\.env.local)" -ForegroundColor Green
Show-Access $Set

if ($Restart) {
  & (Join-Path $dir 'agentos-restart.ps1')
} else {
  Write-Host "  Not live yet - Next.js reads .env.local at startup. Restart with:" -ForegroundColor Yellow
  Write-Host "      .\agentos-restart.ps1"
  Write-Host ""
}
