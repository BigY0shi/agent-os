# PostToolUse guard: non-ASCII in text that reaches a cp1252 console.
#
# The naive version of this check scanned WHOLE FILES for non-ASCII. Measured
# against this repo that fires on 752 of 914 .ts files, 301 of 384 .tsx and 75
# of 79 .mjs, because box-drawing characters in smoke section headers and em
# dashes in comments are everywhere and are entirely harmless. A warning that
# fires on 82% of edits is not a warning, it is wallpaper.
#
# The real failure is narrower: non-ASCII inside a string that gets PRINTED.
# That is what mojibakes on a cp1252 console. A comment never reaches stdout.
#
# Reads CLAUDE_FILE_PATHS, which is PLURAL - a single Write can touch several
# files, and `Get-Content -Raw $env:CLAUDE_FILE_PATHS` on a multi-path value
# throws rather than checking anything.

$paths = $env:CLAUDE_FILE_PATHS
if ([string]::IsNullOrWhiteSpace($paths)) { exit 0 }

# Lines that emit to a console, per language. Deliberately not exhaustive:
# a false positive here costs a glance, a false negative costs mojibake.
$emitters = 'console\.(log|info|warn|error)|process\.stdout\.write|^\s*print\(|Write-Host|Write-Output|echo\s'

$findings = @()

foreach ($p in ($paths -split '[;,]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { continue }
  if ($p -notmatch '\.(ps1|py|js|jsx|ts|tsx|mjs|cjs|sh|bat|cmd)$') { continue }

  $lineNo = 0
  foreach ($line in (Get-Content -LiteralPath $p -ErrorAction SilentlyContinue)) {
    $lineNo++
    if ($line -notmatch $emitters) { continue }
    if ($line -notmatch '[^\x00-\x7F]') { continue }
    $chars = ([regex]::Matches($line, '[^\x00-\x7F]') | ForEach-Object { $_.Value }) -join ''
    $findings += "  {0}:{1}  {2}" -f (Split-Path -Leaf $p), $lineNo, $chars
  }
}

if ($findings.Count -gt 0) {
  Write-Output "WARN: non-ASCII in console output - a cp1252 terminal will mojibake this."
  $findings | Select-Object -First 10 | ForEach-Object { Write-Output $_ }
  if ($findings.Count -gt 10) { Write-Output "  ... and $($findings.Count - 10) more" }
}
exit 0
