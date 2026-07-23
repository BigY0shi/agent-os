@echo off
title Stop Agent OS
echo.
echo   Stopping the Agent OS dashboard (port 3737)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agentos-stop.ps1"
echo.
echo   Done - the dashboard is stopped.
echo   (Run "Restart Agent OS.bat" to bring it back up.)
echo.
timeout /t 4 >nul
