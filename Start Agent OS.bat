@echo off
cd /d "%~dp0"
echo.
echo   🚀  Starting your Agent OS on Windows...
echo.

:: 1 · Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo   ❌ Node.js is not installed.
  echo      Opening the download page... Install the LTS version, then run this script again.
  start https://nodejs.org
  pause
  exit /b 1
)

:: 2 · Start Paperclip in its own window (reuses the standalone bat — one source of truth)
:: Clear PORT first: `set PORT=3737` (below) survives in this cmd window, so running
:: this bat twice from the same window handed Paperclip the dashboard's port — an
:: Express "Cannot GET /" squatting on 3737 while Next failed to bind (seen 2026-07-28).
set "PORT="
echo   📎 Launching Paperclip in a separate window...
start "Paperclip Server" "%~dp0Start Paperclip Server.bat"

:: 2b · Start the local Kokoro TTS server (butler voice, free/offline) — no-op if
::      it isn't installed or is already running.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kokoro-start.ps1"

:: 3 · Install Dependencies on First Run
if not exist node_modules (
  echo   📦 First run — installing dependencies...
  call npm install --no-fund --no-audit
)

:: 4 · Build Dashboard on First Run
if not exist .next (
  echo   🔨 First run — building the dashboard...
  call npm run build
)

echo   ✓ Dashboard ready
echo.
echo   ✅ Opening http://localhost:3737 in your browser.
echo      Keep this window open while using the Agent OS.
echo      (Paperclip runs in its own window — close that one to stop Paperclip.)
echo      To stop: Close this window or press Ctrl+C.
echo.

:: Start browser after a brief delay
start http://localhost:3737
set PORT=3737
call npm start
