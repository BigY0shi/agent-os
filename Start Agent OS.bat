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

:: 2 · Paperclip is NOT started here any more (owner's call, 2026-09-13). Run
::     "Start Paperclip Server.bat" yourself when you want it. The PORT clear stays:
::     `set PORT=3737` (below) survives in this cmd window, and a stale PORT has
::     already bitten a second launch from the same window once (2026-07-28).
set "PORT="

:: 2b · Start the local Kokoro TTS server (butler voice, free/offline) — no-op if
::      it isn't installed or is already running.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kokoro-start.ps1"

:: 2c - Start the local Parakeet speech-to-text server (dictation, free/offline) - no-op if
::      it isn't installed or is already running.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0parakeet-start.ps1"

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
echo      (Paperclip is not started by this script — use "Start Paperclip Server.bat" if you want it.)
echo      To stop: Close this window or press Ctrl+C.
echo.

:: Start browser after a brief delay
start http://localhost:3737
set PORT=3737
call npm start
