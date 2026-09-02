#!/usr/bin/env bash
# Smoke gate for the Ralph harness (scripts/harness/ralph-loop.sh). Exit 0 = green.
#
# Same gate the PR quality CI runs: a clean type-check, then every offline smoke
# under scripts/v2/. Smokes must not need the dev server, the network, or live
# credentials (AGENTS.md rule 19); one that does is a bug in the smoke.
#
#   ./test.sh            run everything, stop at the first failure
#   ./test.sh --list     print the smoke files and exit
#   SMOKE_ONLY=voicebox ./test.sh   run only smoke-voicebox.mjs (substring match)
set -u
cd "$(dirname "$0")" || exit 1

if [ "${1:-}" = "--list" ]; then ls scripts/v2/smoke-*.mjs; exit 0; fi

echo "== gate: tsc --noEmit"
if ! npx tsc --noEmit; then echo "GATE FAIL: type errors" >&2; exit 1; fi

pass=0; fail=0; failed=""
for f in scripts/v2/smoke-*.mjs; do
  case "$f" in *"${SMOKE_ONLY:-}"*) ;; *) continue ;; esac
  name="$(basename "$f" .mjs)"
  start=$(date +%s)
  if npx tsx "$f" > ".harness-logs/${name}.log" 2>&1; then
    pass=$((pass+1)); echo "PASS  $name ($(( $(date +%s) - start ))s)"
  else
    fail=$((fail+1)); failed="$failed $name"
    echo "FAIL  $name ($(( $(date +%s) - start ))s) -> .harness-logs/${name}.log" >&2
    tail -n 12 ".harness-logs/${name}.log" >&2
    break   # one red smoke is enough to stop the gate; fix it before anything else
  fi
done
echo "== gate: $pass passed, $fail failed${failed:+ (${failed# })}"
[ "$fail" -eq 0 ]
