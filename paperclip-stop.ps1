# Stop Paperclip: kill whatever listens on 3100 (the server) and 54329/54330 (its
# embedded Postgres). Port-scoped only. 2026-10-18: this was copied from
# agentos-stop.ps1 and also killed every "next start" node process, which is the
# Agent OS dashboard, never Paperclip (Paperclip is `npx paperclipai run`).
$ErrorActionPreference = 'SilentlyContinue'

$ids = @(Get-NetTCPConnection -LocalPort 3100,54329,54330 -State Listen | Select-Object -Expand OwningProcess -Unique)
$ids = $ids | Sort-Object -Unique

if ($ids) {
  foreach ($procId in $ids) {
    try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Host "   killed PID $procId" -ForegroundColor Yellow } catch {}
  }
} else {
  Write-Host "   nothing was running on 3100"
}
