@echo off
cd /d "%~dp0"
echo.
echo   📎  Starting Paperclip Server on Windows...
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

:: 2 · Already running? Don't double-launch — just open it and exit.
netstat -an | findstr "127.0.0.1:3100 " | findstr "LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
  echo   ✓ Paperclip is already running at http://localhost:3100
  start http://localhost:3100
  echo      ^(You can close this window.^)
  timeout /t 3 >nul
  exit /b 0
)

:: 3 · Self-heal — clear any orphaned embedded-Postgres locks from an unclean
::      shutdown (they hold ports 54329/54330 and cause "shared memory block in
::      use" -> Paperclip fails to start). Only the processes on those exact ports.
echo   🧹 Clearing any stale Paperclip database locks...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 54329,54330 -ErrorAction SilentlyContinue | Select-Object -Expand OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >nul 2>nul

:: 4 · First run — set up Paperclip (embedded database + config). This also starts it.
if not exist "%USERPROFILE%\.paperclip\instances\default\config.json" (
  echo   📦 First run — setting up Paperclip ^(database + config^)...
  echo      Keep this window open when it finishes — Paperclip runs here.
  echo.
  call npx --yes paperclipai onboard --yes
  goto :end
)

echo   ✓ Paperclip ready
echo.
echo   ✅ Opening http://localhost:3100 in your browser.
echo      It also appears inside the Agent OS dashboard's Paperclip tab.
echo      Keep this window open while using Paperclip.
echo      To stop: Close this window or press Ctrl+C.
echo.

:: Open the browser, then run the server (this blocks and keeps Paperclip alive)
start http://localhost:3100
call npx --yes paperclipai run

:end
