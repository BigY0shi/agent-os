@echo off
cd /d "%~dp0"
title Agent OS
echo.
echo   Starting your Agent OS on Windows...
echo.

:: 1 - Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo   [X] Node.js is not installed.
  echo       Opening the download page... Install the LTS version, then run this script again.
  start https://nodejs.org
  pause
  exit /b 1
)

:: 1b - Already running? A second server on 3737 would share one database and one
::      approvals file with the first and corrupt run state (2026-08-29), so this
::      window opens the running one instead of launching another.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3737 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if %errorlevel% neq 0 (
  echo   Agent OS is already running on port 3737 - not starting a second copy.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tailscale-serve.ps1"
  echo   Use "Restart Agent OS.bat" to load a new build.
  start http://localhost:3737
  echo.
  timeout /t 6 >nul
  exit /b 0
)

:: 2 - Paperclip is NOT started here any more (owner's call, 2026-09-13). Run
::     "Start Paperclip Server.bat" yourself when you want it. The PORT clear stays:
::     `set PORT=3737` (below) survives in this cmd window, and a stale PORT has
::     already bitten a second launch from the same window once (2026-07-28).
set "PORT="

:: 2b - Start the local Kokoro TTS server (butler voice, free/offline) - no-op if
::      it isn't installed or is already running.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kokoro-start.ps1"

:: 2c - Start the local Parakeet speech-to-text server (dictation, free/offline) - no-op if
::      it isn't installed or is already running.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0parakeet-start.ps1"

:: 2d - Tailscale HTTPS (https://<machine>.ts.net -> 3737) so phones and laptops on
::      the tailnet get a secure context and the microphone works. No-op if
::      Tailscale is missing, signed out, or already serving the dashboard.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tailscale-serve.ps1"

:: 3 - Install Dependencies on First Run
if not exist node_modules (
  echo   First run - installing dependencies...
  call npm install --no-fund --no-audit
)

:: 4 - Build Dashboard on First Run
if not exist .next (
  echo   First run - building the dashboard...
  call npm run build
)

echo   [OK] Dashboard ready
echo.
echo   Opening http://localhost:3737 in your browser.
echo      Keep this window open while using the Agent OS.
echo      (Paperclip is not started by this script - use "Start Paperclip Server.bat" if you want it.)
echo      To stop: Close this window or press Ctrl+C.
echo.

:: Start browser after a brief delay
start http://localhost:3737
set PORT=3737
call npm start
