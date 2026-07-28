# Start the local Kokoro TTS server (the butler voice without the API bill) if
# it's installed and not already up. Idempotent — safe to call from Start and
# Restart. Lives at ~/.agentic-os/kokoro-tts (server.py + venv); port 8880.
$ErrorActionPreference = 'SilentlyContinue'

$dir = Join-Path $env:USERPROFILE '.agentic-os\kokoro-tts'
$py  = Join-Path $dir 'venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
  Write-Host "   Kokoro TTS not installed ($dir) - skipping local voice" -ForegroundColor DarkGray
  exit 0
}
if (Get-NetTCPConnection -LocalPort 8880 -State Listen) {
  Write-Host "   Kokoro TTS already running on 8880" -ForegroundColor Green
  exit 0
}
$logDir = Join-Path $env:USERPROFILE '.agentic-os'
Start-Process -WindowStyle Hidden -FilePath $py `
  -ArgumentList @('-m','uvicorn','server:app','--host','127.0.0.1','--port','8880') `
  -WorkingDirectory $dir `
  -RedirectStandardOutput (Join-Path $logDir 'kokoro-tts.log') `
  -RedirectStandardError  (Join-Path $logDir 'kokoro-tts.err.log')
Write-Host "   Kokoro TTS starting on 127.0.0.1:8880 (first start downloads the ~330MB model)" -ForegroundColor Green
