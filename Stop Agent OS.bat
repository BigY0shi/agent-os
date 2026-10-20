@echo off
title Stop Agent OS
echo.
echo   Stopping the Agent OS dashboard (port 3737)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agentos-stop.ps1"
echo.
echo   Done - the dashboard and its local voice servers are stopped.
echo   (Run "Start Agent OS.bat" or "Restart Agent OS.bat" to bring it back up.)
echo   Tailscale HTTPS stays configured; it answers 502 until the dashboard is back.
echo.
timeout /t 4 >nul
