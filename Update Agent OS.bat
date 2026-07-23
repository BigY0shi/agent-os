@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   🔄  Updating your Agent OS on Windows...
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo   ❌ Node.js is not installed. Install it first, then try again.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$here = (Get-Item -Path '.\').FullName;" ^
  "$app = $here;" ^
  "$downloads = [System.IO.Path]::Combine($env:USERPROFILE, 'Downloads');" ^
  "$desktop = [System.IO.Path]::Combine($env:USERPROFILE, 'Desktop');" ^
  "$parent = (Get-Item -Path '..\').FullName;" ^
  "$zip = Get-ChildItem -Path $downloads, $desktop, $parent -Filter 'agent-os-pack*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1;" ^
  "if (-not $zip) {" ^
  "  Write-Host '  📥 I couldn''t find a new ''agent-os-pack'' zip in Downloads, Desktop, or parent folder.' -ForegroundColor Yellow;" ^
  "  Write-Host '     1. Download the latest version from Skool (don''t unzip it).';" ^
  "  Write-Host '     2. Leave it in your Downloads folder.';" ^
  "  Write-Host '     3. Run this updater again.';" ^
  "  exit 0;" ^
  "}" ^
  "Write-Host \"  ✓ Found update: $($zip.Name)\" -ForegroundColor Green;" ^
  "$tmp = New-Item -ItemType Directory -Path (Join-Path [System.IO.Path]::GetTempPath() ([System.IO.Path]::GetRandomFileName()));" ^
  "Write-Host '  📦 Extracting...';" ^
  "Expand-Archive -Path $zip.FullName -DestinationPath $tmp.FullName -Force;" ^
  "$newsrc = Get-ChildItem -Path $tmp.FullName -Directory -Recurse -Filter 'source' | Select-Object -First 1;" ^
  "if (-not $newsrc -or -not (Test-Path (Join-Path $newsrc.FullName 'package.json'))) {" ^
  "  Write-Host '  ❌ That zip doesn''t look like an Agent OS pack. Re-download and try again.' -ForegroundColor Red;" ^
  "  exit 1;" ^
  "}" ^
  "$oldv = 'unknown';" ^
  "if (Test-Path (Join-Path $app 'VERSION')) { $oldv = (Get-Content (Join-Path $app 'VERSION') -Raw).Trim() };" ^
  "$newv = 'unknown';" ^
  "if (Test-Path (Join-Path $newsrc.FullName 'VERSION')) { $newv = (Get-Content (Join-Path $newsrc.FullName 'VERSION') -Raw).Trim() };" ^
  "Write-Host \"  📦 You have: $oldv   →   New: $newv\";" ^
  "if ($oldv -eq $newv -and $oldv -ne 'unknown') {" ^
  "  Write-Host \"  ✅ You're already on the latest version ($newv). Nothing to do.\" -ForegroundColor Green;" ^
  "  exit 0;" ^
  "}" ^
  "Write-Host '  ⏸  Stopping the running dashboard...';" ^
  "Get-Process -Name 'node' -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*next start*' -or $_.CommandLine -like '*next dev*' } | Stop-Process -Force -ErrorAction SilentlyContinue;" ^
  "$bk = Join-Path $parent \"_backup_$($oldv)_$(Get-Date -Format 'yyyyMMdd_HHmmss')\";" ^
  "Write-Host \"  💾 Backing up your old version to $(Split-Path $bk -Leaf)...\";" ^
  "New-Item -ItemType Directory -Path $bk -Force > $null;" ^
  "Copy-Item -Path (Join-Path $app '*') -Destination $bk -Recurse -Exclude 'node_modules', '.next', '.git' -Force -ErrorAction SilentlyContinue;" ^
  "Write-Host '  ✓ Swapping in the new code...';" ^
  "Get-ChildItem -Path $app -Exclude 'node_modules', '.next', '.git', '*.bat', '*.command', '_backup_*' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;" ^
  "Copy-Item -Path (Join-Path $newsrc.FullName '*') -Destination $app -Recurse -Force;" ^
  "$zipRootFiles = Get-ChildItem -Path $tmp.FullName -Filter '*.command';" ^
  "foreach ($f in $zipRootFiles) {" ^
  "  $dest = Join-Path $app $f.Name;" ^
  "  Copy-Item -Path $f.FullName -Destination $dest -Force;" ^
  "  $content = Get-Content -Path $dest -Raw;" ^
  "  $patched = $content -replace '/source', '';" ^
  "  Set-Content -Path $dest -Value $patched -NoNewline;" ^
  "};" ^
  "Remove-Item -Path $tmp.FullName -Recurse -Force -ErrorAction SilentlyContinue;" ^
  "Write-Host '  📦 Installing updated packages...' -ForegroundColor Cyan;" ^
  "Start-Process -FilePath 'npm' -ArgumentList 'install --no-fund --no-audit' -WorkingDirectory $app -NoNewWindow -Wait;" ^
  "Write-Host '  🔨 Rebuilding dashboard...' -ForegroundColor Cyan;" ^
  "Start-Process -FilePath 'npm' -ArgumentList 'run build' -WorkingDirectory $app -NoNewWindow -Wait;" ^
  "Write-Host \"  ✅ Updated to $newv. Starting...\" -ForegroundColor Green;" ^
  "Start-Process -FilePath 'http://localhost:3737';" ^
  "$env:PORT='3737';" ^
  "Start-Process -FilePath 'npm' -ArgumentList 'start' -WorkingDirectory $app -NoNewWindow;"

pause
