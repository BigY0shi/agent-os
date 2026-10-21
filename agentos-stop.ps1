# Stop the Agent OS dashboard: kill whatever owns port 3737, plus any hung
# "next start" node process of this repo that stopped listening (a true zombie), plus
# OUR local voice servers. Scoped so it never touches your CLI agents, Paperclip, or
# other node apps.
$ErrorActionPreference = 'SilentlyContinue'
# Get-DashboardPids and Get-VoiceServerPids live in agentos-common.ps1 (2026-10-21),
# shared with Restart and the Start preflight so "is this ours" has one definition.
. (Join-Path $PSScriptRoot 'agentos-common.ps1')

$ids = @(Get-DashboardPids)
# Kokoro TTS (8880) and Parakeet STT (8881) ride the same lifecycle. Ownership is
# checked (the listener or its venv launcher must live under ~/.agentic-os/<name>), so
# another program that happens to use one of these ports is left running (2026-10-21;
# Parakeet joined Stop on 2026-10-19).
foreach ($voice in @((Get-VoiceServerPids 8880 'kokoro-tts'), (Get-VoiceServerPids 8881 'parakeet-stt'))) {
  $ids += @($voice.Ours)
  foreach ($procId in $voice.Foreign) {
    Write-Host "   left alone: PID $procId on a voice port is not ours - $((Get-AgentOsProc $procId).CommandLine)" -ForegroundColor Yellow
  }
}
$ids = @($ids | Where-Object { $_ } | Sort-Object -Unique)

if ($ids.Count -gt 0) {
  foreach ($procId in $ids) {
    try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Host "   killed PID $procId" -ForegroundColor Yellow }
    catch { Write-Host "   COULD NOT kill PID $procId - $($_.Exception.Message)" -ForegroundColor Red }
  }
} else {
  Write-Host "   nothing was running on 3737"
}
