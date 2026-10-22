#!/usr/bin/env bash
# ralph-loop.sh — stack-agnostic autonomous "one failing feature per session" harness.
#
# Repeatedly spawns fresh headless `claude -p` sessions. Each session works EXACTLY ONE
# feature whose status is "failing" in features.json, until every feature passes, a pause
# marker appears in agent-progress.md, or progress stalls. All state lives in files, so
# every session cold-starts — nothing depends on prior context.
#
# Portable: bash 3.2+ (macOS/Linux). Reads JSON via jq or python3 (auto-detected).
# No engine, editor, or OS assumptions. The only project-specific hook is ./test.sh.
#
# Exit codes:
#   0  done (no failing features) / dry-run / smoke pass / reached max cycles cleanly
#   1  preflight or usage error (no claude CLI, bad/missing features.json, no jq|python3)
#   2  PAUSED — a live "AWAITING USER VERIFY" or "BLOCKED" marker in agent-progress.md
#   3  STALLED — 3 cycles with no new commit and no change in the failing count
set -u

# ---- defaults (env overrides these; CLI flags override env) ----
PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
MAX_CYCLES="${MAX_CYCLES:-10}"
MODEL_EXPLICIT=0                                  # 1 = --model flag / CLAUDE_MODEL env wins for the whole run
[ -n "${CLAUDE_MODEL:-}" ] && MODEL_EXPLICIT=1
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-fable-5-1}"   # Agent OS: Fable by default (verified valid 2026-09-02)   # any id valid on your installed `claude` CLI
ONLY_FEATURE=""
DRY_RUN=0
SMOKE_ONLY=0
# RALPH_FORCE_JSON=jq|py  — internal test hook to force the JSON reader (optional)

usage() {
  cat <<'EOF'
ralph-loop.sh — one-feature-per-session autonomous harness

Usage: ralph-loop.sh [options]
  --project DIR     project root containing features.json (default: current dir)
  --feature ID      work only this feature id (must be "failing")
  --max-cycles N    stop after N sessions (default 10)
  --model NAME      claude CLI model id (default claude-opus-4-8)
  --smoke-only      run ./test.sh once and exit with its code (no agent)
  --dry-run         print the plan and exit; spawn nothing
  -h, --help        show this help

Exit: 0 done · 1 preflight/usage · 2 paused · 3 stalled
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --project)    PROJECT_ROOT="${2:?--project needs a value}"; shift 2 ;;
    --feature)    ONLY_FEATURE="${2:?--feature needs a value}"; shift 2 ;;
    --max-cycles) MAX_CYCLES="${2:?--max-cycles needs a value}"; shift 2 ;;
    --model)      CLAUDE_MODEL="${2:?--model needs a value}"; MODEL_EXPLICIT=1; shift 2 ;;
    --smoke-only) SMOKE_ONLY=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "unknown flag: $1" >&2; usage; exit 1 ;;
  esac
done

cd "$PROJECT_ROOT" 2>/dev/null || { echo "PREFLIGHT FAIL: cannot cd to $PROJECT_ROOT" >&2; exit 1; }
FEATURES="features.json"
PROGRESS="agent-progress.md"
LOGDIR=".harness-logs"

# ---- smoke gate (needs no JSON reader; handle --smoke-only first) ----
run_smoke() {
  if [ -x ./test.sh ]; then ./test.sh; return $?; fi
  echo "WARN: no executable ./test.sh — smoke gate skipped" >&2
  return 0
}

if [ "$SMOKE_ONLY" -eq 1 ]; then run_smoke; exit $?; fi

# ---- choose a JSON reader ----
JSON="${RALPH_FORCE_JSON:-}"
if [ -z "$JSON" ]; then
  if command -v jq >/dev/null 2>&1; then JSON=jq
  elif command -v python3 >/dev/null 2>&1; then JSON=py
  else echo "PREFLIGHT FAIL: need 'jq' or 'python3' to read features.json" >&2; exit 1
  fi
fi

# ---- preflight: features.json present + valid ----
[ -f "$FEATURES" ] || { echo "PREFLIGHT FAIL: no $FEATURES in $PROJECT_ROOT" >&2; exit 1; }
if [ "$JSON" = jq ]; then
  jq -e . "$FEATURES" >/dev/null 2>&1 || { echo "PREFLIGHT FAIL: $FEATURES is not valid JSON" >&2; exit 1; }
else
  python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$FEATURES" >/dev/null 2>&1 \
    || { echo "PREFLIGHT FAIL: $FEATURES is not valid JSON" >&2; exit 1; }
fi
if [ "$DRY_RUN" -eq 0 ]; then
  command -v claude >/dev/null 2>&1 || { echo "PREFLIGHT FAIL: no 'claude' CLI on PATH" >&2; exit 1; }
fi

# ---- helpers ----
# next failing feature id (honors --feature); empty if none
next_failing() {
  if [ "$JSON" = jq ]; then
    if [ -n "$ONLY_FEATURE" ]; then
      jq -r --arg f "$ONLY_FEATURE" \
        '.features[] | select(.id==$f and .status=="failing" and ((.notes // "") | contains("SKIP ") | not)) | .id' "$FEATURES" | head -n1
    else
      jq -r '.features[] | select(.status=="failing" and ((.notes // "") | contains("SKIP ") | not)) | .id' "$FEATURES" | head -n1
    fi
  else
    ONLY_FEATURE="$ONLY_FEATURE" python3 - "$FEATURES" <<'PY'
import json, os, sys
want = os.environ.get("ONLY_FEATURE", "")
data = json.load(open(sys.argv[1]))
for x in data.get("features", []):
    if "SKIP " in str(x.get("notes", "")): continue   # Agent OS: a skipped row is left for the operator
    if x.get("status") == "failing" and (not want or x.get("id") == want):
        print(x.get("id", "")); break
PY
  fi
}

# count of features still failing
failing_count() {
  if [ "$JSON" = jq ]; then
    jq -r '[.features[] | select(.status=="failing" and ((.notes // "") | contains("SKIP ") | not))] | length' "$FEATURES"
  else
    python3 - "$FEATURES" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
print(sum(1 for x in data.get("features", []) if x.get("status") == "failing" and "SKIP " not in str(x.get("notes", ""))))
PY
  fi
}

# per-feature model delegation: a feature entry may carry a "model" field naming the
# claude CLI id to use for its cycles (e.g. a cheaper model for proven recipe work).
# An explicit --model flag or CLAUDE_MODEL env overrides it for the whole run.
feature_model() {
  if [ "$JSON" = jq ]; then
    jq -r --arg f "$1" '.features[] | select(.id==$f) | .model // empty' "$FEATURES" | head -n1
  else
    FEATURE_ID="$1" python3 - "$FEATURES" <<'PY'
import json, os, sys
want = os.environ.get("FEATURE_ID", "")
data = json.load(open(sys.argv[1]))
for x in data.get("features", []):
    if x.get("id") == want:
        print(x.get("model", "")); break
PY
  fi
}

# live pause marker in agent-progress.md?  (BLOCKED must not be preceded by a letter,
# so "UNBLOCKED" does NOT trip it; "AWAITING USER VERIFY" is matched literally)
paused() {
  [ -f "$PROGRESS" ] || return 1
  grep -Eq '(^|[^[:alpha:]])BLOCKED' "$PROGRESS" && return 0
  grep -q 'AWAITING USER VERIFY' "$PROGRESS" && return 0
  return 1
}

git_head() { git rev-parse HEAD 2>/dev/null || echo nogit; }

# ---- main loop ----
mkdir -p "$LOGDIR"
NO_PROGRESS=0
cycle=1

while [ "$cycle" -le "$MAX_CYCLES" ]; do
  if paused; then
    echo "PAUSED: live marker in $PROGRESS — human action needed, then re-run." >&2
    exit 2
  fi

  fid="$(next_failing)"
  if [ -z "$fid" ]; then
    if [ -n "$ONLY_FEATURE" ]; then
      echo "DONE: feature '$ONLY_FEATURE' is not failing — nothing to do."
    else
      echo "DONE: no failing features remain."
    fi
    exit 0
  fi

  fc="$(failing_count)"
  head_before="$(git_head)"

  CYCLE_MODEL="$CLAUDE_MODEL"
  if [ "$MODEL_EXPLICIT" -eq 0 ]; then
    fm="$(feature_model "$fid")"
    [ -n "$fm" ] && CYCLE_MODEL="$fm"
  fi
  echo "-- cycle $cycle/$MAX_CYCLES | feature $fid | failing=$fc | model=$CYCLE_MODEL"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "   (dry-run) would spawn: claude -p --model $CYCLE_MODEL --dangerously-skip-permissions"
    exit 0
  fi

  ts="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo t$cycle)"
  log="$LOGDIR/cycle-$cycle-$fid-$ts.log"

  PROMPT="You are ONE session of the Ralph harness. Read AGENTS.md in the project root and follow its Session Initialization Ritual, then work EXACTLY ONE feature: $fid. If a 'feat-loop' skill is available, apply its cycle discipline for this feature (recon with explicit exit-code capture, evidence-first diagnosis, fix to 0 errors AND 0 warnings, completion marker, breadcrumb commit). Contract: in features.json you may change only that feature's \"status\", \"notes\", and \"model\" — nothing else, and no other feature. Implement to its acceptance_criteria, then run ./test.sh as the smoke gate; only flip \"status\" to \"passing\" if it exits 0. Complete the Close-Out Ritual (commit as feat($fid): <desc> with code + features.json together, update agent-progress.md, append the dev journal). If you cannot finish, write a BLOCKED note or an AWAITING USER VERIFY checklist in agent-progress.md and stop."

  # Agent OS: no MCP servers and no session persistence for spawned cycles. A bare
  # "PONG" against the full env cost 92k cache-creation tokens (2026-09-02); the
  # cycle needs the repo, the skills and the CLI tools, not 200 MCP tools.
  claude -p "$PROMPT" --model "$CYCLE_MODEL" --dangerously-skip-permissions --strict-mcp-config --no-session-persistence >> "$log" 2>&1
  rc=$?
  echo "   session rc=$rc | log=$log"

  head_after="$(git_head)"
  fc_after="$(failing_count)"
  if [ "$head_after" = "$head_before" ] && [ "$fc_after" = "$fc" ]; then
    NO_PROGRESS=$((NO_PROGRESS + 1))
  else
    NO_PROGRESS=0
  fi
  if [ "$NO_PROGRESS" -ge 3 ]; then
    echo "STALLED: 3 cycles with no new commit and no change in failing count — human review." >&2
    exit 3
  fi

  cycle=$((cycle + 1))
done

echo "STOP: reached max cycles ($MAX_CYCLES)."
exit 0
