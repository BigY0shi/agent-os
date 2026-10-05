#!/usr/bin/env bash
# Environment prep for the Ralph harness. Runs at the start of every session; must exit 0.
# Agent OS needs nothing installed per cycle: node_modules are already there and the
# gate is `npx tsc` + `npx tsx` over offline smokes. This only proves the tools exist
# and reminds the session of the two rules it is most likely to break.
set -u
cd "$(dirname "$0")" || exit 1
mkdir -p .harness-logs
command -v node >/dev/null || { echo "init: node not on PATH" >&2; exit 1; }
[ -d node_modules ] || { echo "init: node_modules missing; run npm ci" >&2; exit 1; }
echo "init: node $(node -v), package.json $(node -p "require('./package.json').version"), branch $(git rev-parse --abbrev-ref HEAD)"
echo "init: the tree carries the owner's uncommitted work - stage explicit file lists, never 'git add -A'"
echo "init: never start, stop or restart the Agent OS server (port 3737); the owner does that"
exit 0
