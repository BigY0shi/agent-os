# Shared by agentos-start-preflight.ps1, agentos-restart.ps1 and agentos-stop.ps1:
# ONE definition of "is this Agent OS's process", so a fix lands once. Dot-source it:
#   . (Join-Path $PSScriptRoot 'agentos-common.ps1')
# Defines functions and variables only; does nothing on its own. ASCII only (cp1252).
#
# 2026-10-21: the Start guard had its own weaker copy of this (any 3737 listener counted
# as Agent OS, a still-booting server did not count at all) and the voice-server kills
# were port-only. Both now go through the functions below.

$AgentOsDir  = $PSScriptRoot
$AgentOsPort = 3737
# A "next start" counts as ours only if its command line names THIS repo's node_modules
# (2026-10-18). Requiring \node_modules\ right after the repo folder keeps out a sibling
# like agent-os-old and checkouts under .claude\worktrees\.
$AgentOsRepoNext = [regex]::Escape($AgentOsDir) + '[\\/]node_modules[\\/]'

function Get-AgentOsProc([int]$ProcId) {
  Get-CimInstance Win32_Process -Filter "ProcessId=$ProcId" -ErrorAction SilentlyContinue
}

function Get-AgentOsListenerPids([int]$Port) {
  # Every address family - the 2026-08-29 split brain was one server on 0.0.0.0 and
  # another on ::.
  @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ })
}

function Test-AgentOsNextCmd([string]$CommandLine) {
  ($CommandLine -match 'next.dist.bin.next"?\s+start') -and ($CommandLine -match $AgentOsRepoNext)
}

function Get-AgentOsBootingPids {
  # This repo's next-start node processes, listening or not. One that is still booting
  # would grab the port moments from now.
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { Test-AgentOsNextCmd $_.CommandLine } |
    Select-Object -ExpandProperty ProcessId)
}

function Get-DashboardPids {
  # For Stop and Restart: everything that must die before a fresh server may start.
  # Any listener on 3737 (the port is Agent OS's by owner decision, and a server from
  # the pre-2026-10-18 restart script has no repo path in its command line) plus this
  # repo's booting servers.
  return @(@(Get-AgentOsListenerPids $AgentOsPort) + @(Get-AgentOsBootingPids) |
    Where-Object { $_ } | Sort-Object -Unique)
}

function Get-DashboardState {
  # For Start: split what holds or is about to hold 3737 into OURS (this repo's next
  # start, listening or booting) and FOREIGN (any other listener). Start must not open a
  # browser onto a foreign process and call it Agent OS.
  $ours = @(Get-AgentOsBootingPids)
  $foreign = @()
  foreach ($procId in (Get-AgentOsListenerPids $AgentOsPort)) {
    if ($ours -contains $procId) { continue }
    $p = Get-AgentOsProc $procId
    if ($p -and (Test-AgentOsNextCmd $p.CommandLine)) { $ours += $procId }
    else { $foreign += [pscustomobject]@{ Pid = $procId; CommandLine = $(if ($p) { $p.CommandLine } else { '(process gone)' }) } }
  }
  [pscustomobject]@{ Ours = @($ours | Sort-Object -Unique); Foreign = $foreign }
}

function Get-VoiceServerPids([int]$Port, [string]$InstallDirName) {
  # Kokoro (8880) and Parakeet (8881) start via their venv's python.exe launcher, which
  # spawns the base interpreter that actually listens. So the listener's own command
  # line has no install path; its PARENT (the venv launcher) does. A listener counts as
  # ours when either one names ~/.agentic-os/<InstallDirName>. Anything else on the port
  # is returned as Foreign and must be left alone.
  $needle = [regex]::Escape((Join-Path $env:USERPROFILE ".agentic-os\$InstallDirName"))
  $ours = @(); $foreign = @()
  foreach ($procId in (Get-AgentOsListenerPids $Port)) {
    $p = Get-AgentOsProc $procId
    $parent = if ($p) { Get-AgentOsProc $p.ParentProcessId } else { $null }
    if (($p -and $p.CommandLine -match $needle) -or ($parent -and $parent.CommandLine -match $needle)) { $ours += $procId }
    else { $foreign += $procId }
  }
  [pscustomobject]@{ Ours = $ours; Foreign = $foreign }
}
