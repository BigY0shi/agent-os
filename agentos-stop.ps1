# Stop the Agent OS dashboard: kill whatever owns port 3737, plus any hung
# "next start" node process that stopped listening (a true zombie). Scoped so it
# never touches your CLI agents, Paperclip, or other node apps.
$ErrorActionPreference = 'SilentlyContinue'

$ids = @(Get-NetTCPConnection -LocalPort 3737 -State Listen | Select-Object -Expand OwningProcess -Unique)
$ids += @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'next.dist.bin.next start' } |
  Select-Object -Expand ProcessId)
# Kokoro local TTS rides the same lifecycle — port-scoped so only OUR server dies.
$ids += @(Get-NetTCPConnection -LocalPort 8880 -State Listen | Select-Object -Expand OwningProcess -Unique)
$ids = $ids | Sort-Object -Unique

if ($ids) {
  foreach ($procId in $ids) {
    try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Host "   killed PID $procId" -ForegroundColor Yellow } catch {}
  }
} else {
  Write-Host "   nothing was running on 3737"
}
