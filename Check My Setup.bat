@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   🩺  Agent OS — setup check
echo   ─────────────────────────────────────────────

:: Core
where node >nul 2>nul
if %errorlevel% equ 0 (
  echo   [✅] Node.js is installed
) else (
  echo   [❌] Node.js missing - install from https://nodejs.org
)

if exist node_modules (
  echo   [✅] Dashboard installed
) else (
  echo   [⚪️] Dashboard not installed yet - run Start Agent OS.bat
)

if exist .next (
  echo   [✅] Dashboard built
) else (
  echo   [⚪️] Dashboard not built yet - Start Agent OS.bat does it on first run
)

:: Check running dashboard (requires powerShell or curl)
powershell -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3737 -TimeoutSec 2 -ErrorAction Stop; Write-Output '[✅] Dashboard is RUNNING -> http://localhost:3737' } catch { Write-Output '[⚪️] Dashboard not running right now -> run Start Agent OS.bat' }"

echo   ─────────────────────────────────────────────
:: Optional systems
where ollama >nul 2>nul
if %errorlevel% equ 0 (
  echo   [✅] Ollama installed ^(free voice brain^)
) else (
  echo   [⚪️] Ollama not installed -> see install/2-VOICE-BUILDING.md
)

:: Check for ElevenLabs voice keys in user profiles
powershell -Command "$p = Join-Path $env:USERPROFILE '.hermes\profiles\*\*'; $files = Get-ChildItem -Path $p -Filter '.env' -ErrorAction SilentlyContinue; $found = $false; foreach ($f in $files) { if (Select-String -Path $f.FullName -Pattern 'ELEVENLABS_API_KEY=.') { $found = $true; break } }; if ($found) { Write-Output '[✅] Jarvis voice key found' } else { Write-Output '[⚪️] No Jarvis voice key yet -> see install/3-JARVIS-VOICE.md' }"

where hermes >nul 2>nul
if %errorlevel% equ 0 (
  echo   [✅] Hermes agent installed
) else (
  echo   [⚪️] Hermes not installed -> see install/4-HERMES.md
)

powershell -Command "$p = Join-Path $env:USERPROFILE '.hermes\profiles\*\*'; $files = Get-ChildItem -Path $p -Filter '.env' -ErrorAction SilentlyContinue; $found = $false; foreach ($f in $files) { if (Select-String -Path $f.FullName -Pattern 'OPENROUTER_API_KEY=.') { $found = $true; break } }; if ($found) { Write-Output '[✅] OpenRouter key found ^(Hermes can think^)' } else { Write-Output '[⚪️] No OpenRouter key yet -> see install/4-HERMES.md' }"

where claude >nul 2>nul
if %errorlevel% equ 0 (
  echo   [✅] Claude Code installed
) else (
  echo   [⚪️] Claude Code not found -> install via npm i -g @anthropic-ai/claude-code
)

powershell -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3100 -TimeoutSec 2 -ErrorAction Stop; Write-Output '[✅] Paperclip company is running' } catch { Write-Output '[⚪️] Paperclip not running -> see install/6-PAPERCLIP.md ^(optional^)' }"

echo   ─────────────────────────────────────────────
echo   [✅] The dashboard only answers your own computer ^(localhost^) - never the network
echo.
echo   [⚪️] = optional, not broken.
echo.
pause
