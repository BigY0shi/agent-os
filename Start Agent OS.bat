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

:: 2 - Paperclip is NOT started here any more (owner's call, 2026-09-13). Run
::     "Start Paperclip Server.bat" yourself when you want it. The PORT clear stays:
::     `set PORT=3737` (below) survives in this cmd window, and a stale PORT has
::     already bitten a second launch from the same window once (2026-07-28).
set "PORT="

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

:: 5 - Preflight, in one PowerShell process: local voice servers (Kokoro TTS 8880,
::     Parakeet STT 8881), Tailscale HTTPS for the tailnet microphone, and LAST the
::     already-running check, right before npm start. A second server on 3737 would
::     share one database and one approvals file with the first and corrupt run state
::     (2026-08-29). Exit codes are exact: 0 go, 3 ours is running or booting,
::     4 something else holds 3737; anything else means the preflight failed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agentos-start-preflight.ps1"
set "PREFLIGHT=%errorlevel%"
if "%PREFLIGHT%"=="3" (
  echo   Use "Restart Agent OS.bat" to load a new build.
  start http://localhost:3737
  echo.
  timeout /t 6 >nul
  exit /b 0
)
if "%PREFLIGHT%"=="4" (
  echo.
  pause
  exit /b 1
)
if not "%PREFLIGHT%"=="0" (
  echo.
  echo   NOT STARTED - the start preflight failed with exit code %PREFLIGHT%.
  echo   Read the message above; nothing was started.
  pause
  exit /b 1
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
