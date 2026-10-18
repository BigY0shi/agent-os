@echo off
title Stop Paperclip Server
echo.
echo   Stopping YoshiCorp's Paperclip (port 3100)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0paperclip-stop.ps1"
echo.
echo   Done - Paperclip is stopped. The Agent OS dashboard is left running.
echo   (Run "Start Paperclip Server.bat" to bring it back up.)
echo.
timeout /t 4 >nul
