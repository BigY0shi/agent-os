# Start the local Parakeet speech-to-text server (NVIDIA Parakeet-TDT 0.6B v2 on
# ONNX Runtime) if it's installed and not already up. Idempotent - safe to call
# from Start and Restart. Lives at ~/.agentic-os/parakeet-stt (server.py + venv);
# port 8881. Replaces the Voicebox/Whisper mic lane (2026-09-08).
$ErrorActionPreference = 'SilentlyContinue'
$dir = Join-Path $env:USERPROFILE '.agentic-os\parakeet-stt'
$py  = Join-Path $dir 'venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
  Write-Host "   Parakeet STT not installed ($dir) - skipping local dictation" -ForegroundColor DarkGray
  exit 0
}
if (Get-NetTCPConnection -LocalPort 8881 -State Listen) {
  Write-Host "   Parakeet STT already running on 8881" -ForegroundColor Green
  exit 0
}
$logDir = Join-Path $env:USERPROFILE '.agentic-os'
Start-Process -WindowStyle Hidden -FilePath $py `
  -ArgumentList @('-m','uvicorn','server:app','--host','127.0.0.1','--port','8881') `
  -WorkingDirectory $dir `
  -RedirectStandardOutput (Join-Path $logDir 'parakeet-stt.log') `
  -RedirectStandardError  (Join-Path $logDir 'parakeet-stt.err.log')
Write-Host "   Parakeet STT starting on 127.0.0.1:8881 (first request loads the ~0.7GB int8 model)" -ForegroundColor Green
