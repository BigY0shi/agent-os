@echo off
title Restart Agent OS
echo.
echo   Restarting the Agent OS dashboard...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agentos-restart.ps1"
start http://localhost:3737
echo.
echo   Done. The server runs in the background - you can close this window.
echo   TIP: if a page looks broken after a restart, press Ctrl+Shift+R in the
echo        browser (clears the cached app so it loads the current version).
echo.
timeout /t 5 >nul
