# Agent OS — Dev Journal

## How to keep this file (read this before adding an entry)

You are an agent working in this repo. The `commit-msg` hook in `.githooks/`
blocks a commit that changes code under `src/` or `scripts/` without staging an
engineering doc. Usually the doc it wants is this one.

**Write the entry as you finish the work, not at the end of a session.** A
journal reconstructed from memory loses the thing that makes it worth keeping:
what you believed before you were corrected.

An entry earns its place if a future reader learns something they could not get
from `git log`. That means:

- **The decision, and the alternative you rejected.** "Keyed ephemeral dirs on a
  random nonce" is a diff. "Keyed on a nonce because PIDs are recycled and the
  pid-based version silently resurrected the previous run's cookies" is a
  journal entry.
- **What you got wrong on the way.** The failed attempt is often the most
  valuable line in the file, because it is the one that stops someone
  re-introducing it. If a check passed while the bug was live, say so.
- **The evidence.** Name the smoke, the count, the file:line, the command whose
  output convinced you. "Verified" without an artifact is not verification.
- **What it costs.** A guard that needs hand-maintenance, a cap that will annoy
  someone, a doc left deliberately blank. Say it here rather than letting the
  next person discover it.

**Do not** log routine edits, dependency bumps with no consequence, or anything
already obvious from the diff. A journal that logs everything gets read by
nobody.

Newest entry at the top. Date each one. Companion docs: `_design/agentos-v2/`
for the plan, `_audit/2026-07-22/` for the original audit.

---

## 2026-09-01 - Four modules were writing to a vault that does not exist

**Symptom.** A Loop run finished, its modal closed, and there was nowhere to
read what happened.

**Cause.** `loop/run/route.ts` hardcoded its log directory to
`~/Documents/Obsidian Vault/Agentic OS/Loops`. That path does not exist on this
machine - the configured `vaultRoot` is `C:\Users\Yoshi\.agentic-os\agentos` and
was ignored. `mkdir -p` cheerfully created the phantom folder, and the write sat
inside `catch { /* vault optional */ }`, so it failed silently every time.

Sweeping for the pattern found three more, all in notebooklm (ask, library,
artifact/download). All four now resolve through `AGENTIC_DIR`, with a
`~/.agentic-os/` fallback rather than the RELATIVE path that `path.join("")`
yields when no vault is set. `config.ts:180` still names the Obsidian path and
is left alone: it is the legitimate default when nothing is configured.

**Two Loop fixes that had been conflated.** The run log now writes on EVERY run,
pass or fail - a run the judge rejected is exactly the one worth reading. The
gallery keeps its `if (passed)` guard. Both had been decided by the same
condition, and they are different questions: one is a showcase, the other is the
only record. A failed log write is now emitted on the stream (`logfail`) instead
of swallowed, because a run whose log did not write looks identical to one that
did until you go looking.

**A correction.** I first reported that vault writes "stopped on 2026-08-28".
Wrong. The distribution is Jun 30, Jul 24-30, Aug 8, Aug 28 - 29 files over
three months. It has always been sparse, because those writers fire per Pipeline
item or per explicit save. Aug 28 was the last occasional write, not a cliff.
There was no regression to chase, and chasing one would have wasted the time.

**The finding that actually matters, not yet fixed.** Memory V2 is not broken:
`ingestFromModule` has 11 call sites, boot starts the queue, `ingestEnabled` is
true. Every table reads 0 rows because nothing has been ingested. All seven
files that feed memory are V2 modules (tasks chat, anynotes, integrations,
jarvis brain + tools, pages butler, tasks engine). **Zero V1 modules write
episodes** - so Deal Desk's triaged opportunities and the Hire Engine's leads,
which carry more judgment than anything else here, have never entered memory.
A wiring gap rather than a bug, and the next thing to close.

## 2026-09-01 - Docs stop drifting: a commit-msg gate, and a narrowed ASCII hook

**The failure this answers.** PROGRESS.md was last touched 2026-08-28 and still
presented Phase 0 as the frontier while the repo had shipped v2.0.0 through
v2.4.0 and PRs #11 to #18. This journal was in better shape but had zero
coverage of the identity/containment work, the spend ceiling, or either PR.
A plan doc that is never revised does not become "slightly old"; it becomes
actively misleading, because the next reader trusts it.

**Decision: enforce at commit time, not by reminder.** `.githooks/commit-msg`
blocks a commit that changes `src/` or `scripts/` without staging one of
DEV-JOURNAL / PROGRESS / SPEC-* / ROADMAP / README / AGENTS. A reminder would
not have worked - the standing rule to keep this file already existed and was
ignored for an entire session.

Chose `commit-msg` over `pre-commit` deliberately: it can read the message, so
a commit that genuinely warrants no doc change says `Docs: n/a - <reason>` and
leaves that in the history. `--no-verify` leaves no trace, which is the point.
The trailer is rejected without a reason, so it cannot decay into a reflex.

Installed via `core.hooksPath .githooks` (tracked; `.git/hooks` protects
exactly one working copy). `scripts/install-hooks.sh` for fresh clones.

Verified all four paths by hand: code without a doc blocks; bare `Docs: n/a`
rejects; `Docs: n/a - reason` allows; code plus a staged doc allows.

**The ASCII hook got narrowed, and the measurement is why.** The first design
scanned whole files for non-ASCII. Measured against this repo that fires on
752/914 `.ts`, 301/384 `.tsx` and 75/79 `.mjs` - roughly 82% of edits - because
box-drawing in smoke headers and em dashes in comments are everywhere and
harmless. A warning at that rate is wallpaper.

`.claude/hooks/check-console-ascii.ps1` checks only lines that EMIT (console.log,
print, Write-Host, echo). That is the actual cp1252 failure; a comment never
reaches stdout. It also handles `CLAUDE_FILE_PATHS` being plural, which the
one-liner version could not - `Get-Content -Raw` on a multi-path value throws
instead of checking.

It immediately flagged real hits in my own smoke files (`console.log("
-- SS A --")`
style section headers), which will mojibake on a cp1252 console. Left as-is for
now, noted here rather than silently fixed.

**Cost, stated plainly.** Every code commit now needs a doc touched or an
explicit reason. That is friction by design, and it will occasionally be
annoying on a one-line fix. The alternative was the state this entry opens with.

**Correction.** I exiled DEV-JOURNAL.md and ROADMAP.md during the root cleanup.
The journal was not stale - its newest entry was that same day. I flagged it as
significant at the time and still batched it with 17 genuinely dead upstream
docs. Both restored here.

## 2026-09-01 - GitHub PR quality and approval gates

**Decision:** `local-main` now has two additive GitHub Actions gates.

- `PR quality / required-ci` uses Node 24, `npm ci`, `npm run version:check`,
  `npx tsc --noEmit`, and every offline `scripts/v2/smoke-*.mjs` file. It has
  read-only repository permission and is deliberately independent of the dev
  server, credentials, network services, and generated build output.
- `PR approval gate / approval-gate` requires a deliberate `merge:approved`
  label, removes it for every new commit, and blocks while the latest review
  state for a non-author reviewer is `CHANGES_REQUESTED`. Its only write
  permission lives on the label-reset job; the review check itself is read-only
  and never checks out pull-request code on `pull_request_target`.

**Hosting gate:** verified with GitHub's API on 2026-09-01: the private
repository's current plan returns HTTP 403 for rulesets and branch protection.
The checks report their result but cannot yet be mandatory in GitHub's merge
UI. `scripts/github/apply-merge-protection.mjs` is the fail-loud, repeatable
activation step after making the repo public or moving to a plan that supports
private branch protection; it requires both workflow names, resolved
conversations, stale-review dismissal, one non-author approval, and no force
push/deletion. Full contract: `_design/github-merge-gates.md`.

**Rollback:** remove `.github/workflows/pr-quality.yml` and
`.github/workflows/pr-approval-gate.yml` to stop the reported gates. If remote
protection has later been applied, remove or revise it in GitHub before merging
without the checks. No application state or production process changed.

**Verified:** YAML parsed with the repository's `js-yaml`; `node --check
scripts/github/apply-merge-protection.mjs`; `npm run version:check`; `npx tsc
--noEmit`; and `git diff --check`.

---

## 2026-08-28 - Agents: a run can ask the user a question (ask-user park + reply)
Found in live testing: an agent asked clarifying questions about scope and they went nowhere. Root cause was structural, not a missing feature - `agentsRuntime.ts` pushed assistant text (question included) as `{kind:"text"}` and stopped there, and the `waiting` status was only reachable from `queueApproval`, i.e. from a TOOL requesting permission. A sentence could never trip it, so the run carried on and guessed.

**Fix** - questions attach to the other place a run can pause: the per-turn result.
- **Detection is marker-first.** Every run's rendered system text now carries `ASK_USER_PROTOCOL`, instructing the agent to end its turn with `[[ASK-USER]] <question>`. `detectQuestion()` reads that marker; a punctuation fallback (last non-empty line ends in "?", <=300 chars) exists but ships **default OFF** - agent reports close on rhetorical questions all the time, and a false positive would park a *finished* run instead of completing it.
- **Park** - `parkRunOnQuestion()` deliberately mirrors `queueApproval`: same `approvals.json` queue, same `meta.status = "waiting"`, same two `notifyStatus()` transition sites. So the hero band goes amber with no second code path, and `getStatusSnapshot()` remains the single derivation (CONVENTIONS section 6 - nothing re-derived).
- **Reply** - `answerQuestion()` resolves the promise the park is awaiting *inside* `onTurnResult`, which is awaited inside `consumeRunStream`'s `for await`. The SDK stream is suspended mid-iteration while the human types, so the answer is pushed into the same `query()` session's input queue and the agent continues with context intact.
- **Never a silent completion** - an unanswered question (skip / timeout / kill) sets `r.stranded`, and the run finalizes `error` with the question in the error text, never `done`. No curator pass fires on it.
- Both lanes: the SDK path and the cli/ollama provider path park identically, off the one `renderedSystem` render site (rule 17).
- Settings gear (rule 16): `agents.askUser.{enabled, heuristic, timeoutMin}` - all three exposed in AgentsSettings, nothing config-file-only.

**Load-bearing behavior change:** `execute()` no longer eagerly closes the input queue for plain one-shot runs (`if (!controller) queue.close()` is gone) - a question can arrive on turn 1, and a closed queue leaves nothing to answer into. The turn handler now owns every close.

**Verified:** `scripts/v2/smoke-agents-questions.mjs` 51/51 - drives the REAL turn path (`consumeRunStream` + `makeTurnResultHandler` + `makeInputQueue`) with a synthetic message stream, no SDK/network/model. Covers detection, park->waiting->reply->done, skip/timeout/kill all landing as `error`, the route's answer verb, and the wiring greps. Regressions green: smoke-approvals, smoke-agents-status, smoke-agents-forge, smoke-harnesses, smoke-agents-ui (its `agents.requireTestRun` assertion was a whitespace-exact grep that my multi-line defaults block broke - relaxed to assert the value; the hard default is unchanged, confirmed `{"requireTestRun":true,...}` at runtime). `tsc --noEmit` clean.

**NOT yet verified live (the one open item):** that the SDK emits a per-turn `result` while the input queue is still open on a *plain* run. The shipped loop harness relies on exactly this, but its live leg was explicitly out of scope for the Phase 7 smokes, so it is asserted-by-precedent, not observed. First live plain run should be watched for a hang; rollback is one line - restore `if (!controller) queue.close();` in `execute()`, which reverts to today's behavior at the cost of the feature.

Files: `src/lib/agentsRuntime.ts`, `src/lib/agentsTypes.ts`, `src/lib/settings.ts`, `src/app/api/agents/approvals/route.ts`, `src/components/AgentsView.tsx`, `src/components/v2/agents/{AgentsPageV2,AgentsSettings}.tsx`, `src/components/v2/agents/tabs/ApprovalsTab.tsx`, `scripts/v2/{smoke-agents-questions.mjs,smoke-agents-ui.mjs}`. Uncommitted - stage this explicit list only (rule 22; the tree carries 50+ unrelated dirty files).

---

## 2026-08-27 · V2 rebuild: Phases 3–7 built in one run (Jarvis · WebMCP · Integrations · Homepage · Browser) + adversarial review
The Ultraplan build continued autonomously (harness loop: background agent per chunk → orchestrator re-runs smokes + tsc → explicit-file commit). Fine-grained per-chunk records + deltas live in _design/agentos-v2/ultraplan/PROGRESS.md — this entry is the day-level index.
- **Phase 3 (PR #5, feat/v2-phase3-jarvis):** F13 global chatbox (voice never auto-sends) · WebMCP engine + /webmcp builder · Jarvis brain (warm Claude-SDK session, persona+page context, conversations migration 031, §9.4 taint gate) · CR.1 legacy repoint. NOTE: pre-existing untracked JarvisModule.tsx + api/jarvis/brain/route.ts entered git here.
- **Phase 4 (PR #6, feat/v2-phase4-webmcp):** D5 exporter (client mode \, zero secret embedding) + spec_json 032 + Spec tab · Human-Gate approvals (033) · LLM-filtered getActions · conversations drawer.
- **Phase 5 (PR #7, feat/v2-phase5-integrations):** G2 runtime (040, AES-256-GCM store, OAuth PKCE, watermark sync → memory label integration:<slug>) · 7 connectors (gmail 20 tools / gcal 8 / notion 16 / github / slack HMAC / buzz) + /integrations page · G4 meta-tools on /api/mcp + brain · G5 automations (no-eval) + attention store (041/042) · B7 skills-as-policies (022). Deps: googleapis, google-auth-library ^10, turndown.
- **Phase 6 (PR #8, feat/v2-phase6-home):** widget framework + honest {available:false} data layer · AttentionHero · Overview rebuilt on the grid (Yoshi's uncommitted layout preserved as default via legacy-* widgets; TodoPanel.tsx entered git) · edit-mode DnD · calendar widget. 
- **Phase 7 (in flight, feat/v2-phase7-browser-agents):** E browser backend committed (Playwright manager, 18 tools, allowlists, capability slot, migration 050; deps playwright+ws, Chromium 151 installed) · chunk 2 browser live-view committed `d251621` (CDP ws bridge :3738, HMAC tickets, /browser page) · 13-item hardening backlog committed `e0f056f` (migrations 003/034/043 — taint fail-closed on provenance, watermark tail-loss + dedupe keys, approval version pinning, HMAC session tokens w/ 7-day legacy grace, durable webhook inbox, memory-queue leases; record in HARDENING-2026-08-27.md) · chunk 3 agents F1-F3 committed `6ee83ae` (migration 051 harnesses + agent_status_events, getStatusSnapshot as the single band derivation, SSE status route, renderHarness injection, lifecycle trigger gating, §9.5 browser_evaluate approval) · chunk 4 agents page UI committed `88e3461` (Forge wizard + Draft-with-AI via cliComplete, harness library, AgentsHero SSE + cards grid, /agents/[id] detail tabs with ?tab= deep links, telemetry route; checkDeployGuard consolidated so the §11 gate has ONE implementation, both modes behind agents.requireTestRun). **Phase 7 COMPLETE — PR #9 open** against feat/v2-phase6-home. Gate re-run independently at each chunk: tsc clean, agents-forge 36 · agents-ui 77 · agents-status 35 · harnesses 54 · hardening 69 · tasks 78 · approvals 41, scripts/ zero deletions.
- **Phase 8 (COMPLETE, same branch — PR #9 retitled to cover 7+8; splitting it would need a force-push):** AnyNotes I committed `f82624b` (migration 060, capture engine w/ oEmbed+readability, routes, memory ingest, @jarvis reply worker; deps @mozilla/readability+linkedom) + `0f00c4f` (/anynotes page, thread, gear, widget, attention mapping). Newsletter K committed `9ec31e7` (migration 061, addy alias client, Gmail sync, extraction+dedupe, jobs; shared extractJsonObj lifted to v2/json.ts) + `7ee3728` (edition builder, subscriptions, /newsletter, widget). Three agent spec-refusals, all upheld: pending-ingest.jsonl (CONVENTIONS §2 deletes it by name), the "+20s" watermark (= hardening item 7's mail-loss bug), and the edition POST force/idempotent contradiction (§5 vs K4.1 verify — §5 needs correcting). **Real bug found via a "flaky" check:** listReplies tiebroke on the random shortId(), so replies sharing a millisecond shuffled ~25% of runs — Jarvis's answer could render above the question; now ORDER BY created_at, rowid, and the check burst-inserts 8 replies and asserts they actually collided. NOTE: `src/lib/marketing.ts` (Yoshi's UNTRACKED WIP) was edited by chunk 3 to import the shared json helper — deliberately NOT staged; it now depends on the committed v2/json.ts.
- **Independent review (Codex + Antigravity, both headless CLIs):** 25+10 findings, 10 confirmed+fixed (commit 'fix(v2): independent-review fixes'): gmail attachment arbitrary-write P0, §9.4 taint lost on session rebuild, SDK native Bash/Write/Edit ungated, live-read taint, approval double-execute race, scheduler run_at clobber, sync tx, untracked spawnEnv.ts (clean checkouts of #5–#8 were unbuildable), timing-safe compares, source-spoof hardening. 4 refuted. 13-item hardening backlog agent in flight → HARDENING-2026-08-27.md.
- **Incident:** tracked scripts/ tree (53 smokes) deleted from working tree mid-parallel-agents, no exile; restored via git restore, zero loss; hardening agent warned + integrity check mandated.
- **Env notes:** Ollama Cloud account hit session quota (429 glm-5.2:cloud) — memory-ingest legs degraded until reset; gemini CLI is dead (Google: migrate to Antigravity), agy works with --dangerously-skip-permissions BEFORE -p.
**Rollback:** each phase is its own stacked branch/PR (#5→#8 + phase-7 branch) — revert = drop the branch from the stack. DB migrations are forward-only (022,031-033,040-042,050) on ~/.agentic-os/agentos.db; snapshot exists via the nightly db.backup job (keep-14, .exile). New deps removable via package.json revert + npm i. Chromium: npx playwright uninstall.
**Verified:** every chunk gated on its smoke suite + regressions + tsc (records in PROGRESS.md); review fixes re-verified incl. brain taint legs + SDK live leg.

---

## 2026-07-27 · Hire Engine brought to Deal Desk parity
User: "it is supposed to mimic the Deal Desk" — it was a flat card grid with none of the review tooling. Changes:
- **Kanban board** — `HIRE_COLUMNS` (New / Researching / Approved / Sent + trailing Parked) in `lib/hireDesk.ts`; `HireEngine.tsx` rebuilt as drag-and-drop columns like `DealDesk.tsx`. Machine strip kept as the filter above the board.
- **F/E/W scoring** — `deriveScores()` maps the scrape's coverage/budget/commitment onto Deal-Desk axes: Fit = coverage (capped 3 when firmo says company too large), Ease = machine built? (9/5, −1 part-time), Win = salary signal (±firmo fit). Composite reweighted 0.4E+0.4W+0.2F. Displayed as chips on card + drawer.
- **Brief** — new `POST /api/hire/brief` (mirrors deals/brief): summary/why/approach/crashCourse via `claude -p`, stored in `hire-state.json` under `brief`. Drawer shows amber Project Summary box, Approach, Crash Course sections + "Generate brief" CTA when missing.
- **Ask AI** — new `POST /api/hire/ask` (mirrors deals/ask), answers persisted per lead (`answers[]`, last 20), Q&A section in drawer.
- **Notes** — drawer textarea wired to existing `notes` action (was API-only, no UI).
- **Pitch edits persist** — new `action:"pitch"` in `/api/hire/action`; the drawer textarea previously dropped hand edits on close.
- **Enriched cue** — cards show cyan Building2 chip (headcount) when firmo present, red `enrich ✗` on lookup failure, amber `brief` sparkle when analysed, purple `pitched`.
- **Description** — now run through `formatDescription()` (shared from upworkDesk) so postings render with bullets/sections instead of one flat line.
- Sidebar move (Self → Agent Orchestration) was already at HEAD (60e66de); needs only a rebuild.
**Rollback:** revert `src/lib/hireDesk.ts`, `src/components/HireEngine.tsx`, `src/app/api/hire/action/route.ts`; exile `src/app/api/hire/brief/`, `src/app/api/hire/ask/`. State file gains `brief`/`answers` keys — ignored by old code, safe.
**Verified:** `npx tsc --noEmit` clean; all hireDesk consumers are inside the hire module (grep).

---

## 2026-07-25 · Staleness sweep — the same 4 bug classes, repo-wide
Ran a grep pass for every failure mode found in Jarvis/Loop/Deal Desk, to see what else is stale before the rebuild. **Everything below is the SAME four classes repeated** — this is a macOS-authored codebase running on Windows, and each module that was never exercised here still carries the original assumptions.

### CLASS A — macOS-only commands/paths (breaks outright on Windows)
| Where | What | Verdict |
|---|---|---|
| `api/hermes/realtime/open/route.ts:25` | spawns macOS `open` | **BROKEN** — identical to the Jarvis bug just fixed (this is Realtime voice's "open a site" tool) |
| `api/seo/research/route.ts:18` | `const PY = "/usr/bin/python3"` absolute | **BROKEN** — GSC keyword research can't run |
| `api/thumbnails/generate/route.ts:86` | `exec("python3")` | **LIKELY BROKEN** — Windows has `python`/`py`, not `python3` |
| `lib/pipeline.ts:442` | `spawn("python3", …)` | **LIKELY BROKEN** |
| `lib/outreach.ts:30` | `~/.browser-use-env/bin/python3` (POSIX venv layout) | **LIKELY BROKEN** — Windows venvs use `Scripts/python.exe` |
| `lib/hermesPhone.ts:70,92,111,117,120` | `pgrep`/`pkill`/`brew install` | **BROKEN** (module is unmounted, so latent) |
| `api/openclaw/studio/stt/route.ts:19` | ffmpeg only at Homebrew paths, bare `ffmpeg` fallback | degraded — works only if ffmpeg is on PATH |
| **PATH corruption** — `codex/goals:58`, `hermes/goals:67`, `opendesign/control:17`, `seo/deploy:18`, `thumbnails/generate:48`, `video/hyperframes/render:62`, `claudeArtifacts.ts:19` | colon-join Homebrew dirs onto `process.env.PATH` | **BROKEN on Windows** — `;`-delimited PATH gets a bogus POSIX blob glued onto the first entry (the exact anti-pattern `runner.ts` documents avoiding) |

### CLASS B — hardcoded local model that isn't pulled
`freeclaude/build:32`, `video/auto/script:82`, `lib/localModel.ts:8`, `lib/localOllama.ts:6` all default to `xentriom/gemma-4-12B-coder-…`, which **isn't installed** → Ollama 404s. Same bug fixed in `loopEngine` (now queries `/api/tags`). Affects FreeClaude build, Video script-gen, and anything via `localModel`/`localOllama`. Also `local-hermes/run` mentions `llama3.1:8b` while its UI says "Gemma-4 12B Coder".

### CLASS C — MiniMax wired in (user does NOT have it; "shouldn't be wired into anything")
Still referenced in **20 files**. Highest-impact: **`lib/agentRoom.ts`** — that's the **Agent Council chat the user explicitly wants kept**. Also `api/hermes/talk` (Talk tab), `HermesStudio`, `VideoDirector/Studio/Settings`, `PipelineSettings`, `ConfigMenu`, `TokenUsage`, `loop/run`.

### CLASS D — macOS copy (the "system lies about itself" theme)
"your Mac" / "on my Mac" in `AgentKanban` (×3), `LocalHermesEngine` (×2), `LocalView` (×2), `JarvisView:817-818` ("Building it on your Mac, sir…"), plus `realtime/session` tool descriptions telling the model to open "macOS app name (e.g. 'Notes', 'Safari')". Cosmetic, but it's what steered Jarvis into the dead path.

### CLASS E — OpenRouter-only, no fallback (key invalid here)
`fusion/chat` (P0 dead), `freeclaude/build` (N2 engine), `lib/agentRoom.ts`, `lib/leads.ts`. `hermesJarvis` + `loopEngine` now have CLI fallbacks; these don't.

**Takeaway:** nothing new in kind — the audit's "macOS→Windows bug class" is broader than the 5 P0s it named. Fixing it module-by-module is whack-a-mole; the durable fix is a shared cross-platform helper set (`launchTarget()`, `pythonBin()`, `augmentPath()`, `resolveLocalModel()`) that these call instead of each re-implementing POSIX assumptions.

---

## 2026-07-23 · Session 4 — Jarvis rewired to a stack that actually exists (DONE)
**Goal:** get Jarvis working, per the plan: drop the dead OpenAI Realtime default → mic → speech-to-text → an LLM we have → **ElevenLabs TTS**. User confirmed ElevenLabs + hermes CLI both work.

### What was broken (verified first-hand)
- `JarvisView.tsx:645` — **Realtime defaulted ON**, and it needs an `OPENAI_API_KEY` this box doesn't have. Worse, while ON it **disabled every working path**: tap-to-talk (`coreTap` early-returns), Live, and the wake word are all `disabled={realtime}`. So the default experience was: nothing works.
- `JarvisView.tsx:1124` — hardcoded **"Realtime voice is live below — just talk."** It reported the *toggle*, never the connection. Pure UI lie.
- `JarvisView.tsx:768` — `speak()` hardcoded `provider: "openai"`, so TTS hit the one provider without a key, even though `/api/hermes/tts` already supports ElevenLabs (`route.ts:111`).
- `VOICES` were OpenAI voice names (`ash`/`onyx`/`ballad`) — meaningless to ElevenLabs, whose ids are long alphanumerics.
- `hermesJarvis.ts complete()` — the engine behind the **default "auto" mode** tried MiniMax OAuth → OpenRouter and then **gave up**. Both are unavailable here, so Jarvis's normal chat path returned an error string.

### Fixes
| Area | Change |
|---|---|
| Voice out | `speak()` now uses **`provider:"elevenlabs"`**; default voice = Daniel (`onwK4e9ZLuTAKqWW03F9`, British — fits the butler) |
| Voice picker | fetches the **real ElevenLabs voice list** from `/api/video/voices` (same source the Oracle uses), falling back to the built-in default if unreachable |
| Realtime | **defaults OFF** — so tap-to-talk / Live / wake word (browser speech-recognition, no key needed) work out of the box. Toggle still there if a key is ever added; tooltip now says it needs one |
| Status line | no longer claims "voice is live"; defers to the Realtime panel's own state |
| Chat engine | `complete()` gained a **local CLI fallback** (`claude -p`, one-shot, on the user's subscription) when MiniMax **and** OpenRouter are unavailable — including when OpenRouter is reachable but returns an empty/bad-key reply |

**Result:** the working stack is now the default — browser STT → Jarvis (MiniMax → OpenRouter → **Claude CLI**) → **ElevenLabs** voice. No OpenAI key anywhere in the path.

**Honest caveat:** the CLI fallback is a *correctness* fix, not a speed one — `claude -p` is slower than a hosted API call, so "fast" mode won't feel fast when it's on the fallback. It answers instead of erroring, which is the point. (Agent mode already used the hermes CLI and was the only path that worked before.)

**Verification:** `tsc --noEmit` → 0 errors; no OpenAI voice names or `provider:"openai"` left in Jarvis. **Not runtime-tested** — needs a rebuild + a real mic session to confirm end-to-end.

---

## 2026-07-23 · Session 3 — Loop engine repair (DONE, commit `be17294`)
**Goal:** fix the autonomous Loop engine (Builder → Judge → retry). It's the feature that works unsupervised, so its bugs cost real time + tokens.

### Known issues going in (from the audit, to be verified first-hand)
| # | Issue | Where (claimed) | Impact |
|---|---|---|---|
| L1 | Stop/abort never reaches the spawned CLI child | `loopEngine.cliComplete` → `runner.run` | pressing Stop burns the full timeout (up to 600s) of tokens |
| L2 | Prompt args >32k chars silently dropped | `runner.ts` MAX_ARG_LEN filter | loop spins uselessly after iteration 1 (artifact is embedded in the prompt) |
| L3 | `"false"` string coerced to a passing verdict | `loopEngine.verdict` `!!v.pass` | a failing build can be recorded as passed |
| L4 | Judge silently falls back to local Ollama | `loopEngine.verdict` catch | you don't know which model actually graded it (Rule 11 violation) |
| L5 | Judge error cause swallowed | same catch | "no parseable verdict" instead of the real reason |
| L6 | Hardcoded gemma model + ignores configured Ollama URL | `loopEngine` ollama judge | local judge 404s (only glm-5.2:cloud is installed) |
| L7 | Browser render-check is macOS-only (silently no-ops) | `api/loop/run/route.ts` findChrome | "runs clean" reported without ever checking |
| L8 | UI duplicates the WORKERS/JUDGES lists (diverged from engine) | `LoopView.tsx` | picker doesn't match what the server supports |

### Key finding first: **the Loop page has never been run.**
No `~/.agentic-os/loop` directory exists — the engine has never saved a build. So these bugs were costing *nothing* (I had earlier claimed it was "wasting API budget right now" — that was wrong and is corrected here). The value of this work is that the feature will **work the first time it's used**, instead of spinning silently and misreporting grades.

### What was verified + fixed
| # | Verified? | Fix |
|---|---|---|
| L1 abort ignored | ✅ `cliComplete` took `opts.signal` (loopEngine:19) but never passed it to `run()` (:31); `run()` had no signal support at all | `run()` now accepts `signal`, kills on abort, and reports `[stopped by user]`. Signal threaded through `cliComplete`. |
| L2 >32k args dropped | ✅ `safeArg` returned null for >32k, then `cleanArgs` filtered it out — the CLI ran with **no prompt** | Long prompts (>30k) now go via **stdin** for codex/cursor/pi/hermes; `run()` also **fails loudly** on an oversized arg instead of dropping it |
| L3 `"false"` → pass | ✅ `pass: !!v.pass` — the string `"false"` is truthy | strict check: only real `true` / `"true"` passes; everything else **fails closed**. Verified with a case table |
| L4 silent judge fallback | ✅ bare `catch {}` then silent `ollamaJudge()` | fallback still happens (loop keeps moving) but is now **labelled**: `judgedBy`, `fellBackFrom`, and a `⚠ Graded by the LOCAL fallback judge, not "<judge>"` line prepended to issues |
| L5 judge error swallowed | ✅ same `catch {}` | real cause captured in `judgeError` and surfaced in the issues text |
| L6 hardcoded gemma model | ✅ `xentriom/gemma-4-12B-...` hardcoded; not installed here → local judge always 404'd | new `localJudgeModel()` asks Ollama `/api/tags` what's actually pulled and picks a sensible one (`LOCAL_MODEL` env still wins) |
| L7 macOS-only Chrome | ✅ only checked `~/Library/Caches/ms-playwright` → on Windows always null → render check reported "clean" **without opening the page** | cross-platform: Windows `%LOCALAPPDATA%\ms-playwright` + `.exe` suffix, plus the linux path |
| L8 "Ollama on your Mac" | ✅ stale label on a Windows box | → "Ollama on this machine" |

**Bonus (found while in there):** `run()` now kills the **whole process tree** (`taskkill /T` on win32) instead of just the direct child — previously a timed-out CLI left orphaned grandchildren holding ports/tokens. Also added a `stdin` error handler: an EPIPE when a child died early was an unhandled event that could crash the server process.

**Not done (deliberate):** L-UI — `LoopView.tsx` hand-duplicates the WORKERS/JUDGES lists instead of importing them from the engine, so the picker can drift from what the server supports. Left for the UI pass; it's cosmetic-ish and the engine is the thing that had to be correct first.

### Verification
`tsc --noEmit` → 0 errors. Verdict-pass logic verified against a 9-case table (`true`/`"true"`/`"TRUE"` pass; `false`/`"false"`/`"no"`/`0`/`1`/`""` fail).

---

## 2026-07-23 · Session 2 — Security right-sizing
- **Committed `d24c8b3`** — `fix(paths)`: tightened the shared segment regex to reject dot-only names (`.`/`..`/`...`) at **43 call sites across 26 files**. The old `/^[A-Za-z0-9_.-]+$/` allowed `..` because the dot is inside the character class, so a `project=".."` walked out of its workspace root. Verified with a case table + `tsc` clean.
- **Rest of the security tourniquet intentionally SKIPPED** — user's call: single-user LAN box, so login rate-limiting + constant-time cookie compare are defending against an attacker already on the network. Documented rather than built.
  - *Revisit trigger:* if the dashboard is ever port-forwarded or the tailnet is shared, do the login rate-limit first (~20 min). Note Tailscale already widens reach beyond the physical LAN.
  - Session model decision: **minimal hardening only** — keep the derived-hash cookie (pass-the-hash + non-expiring accepted).

## 2026-07-23 · Session 1 — Front page made honest
- **Committed `28b95fb`** — replaced fabricated front-page telemetry with real data, fixed dead links, swapped the fleet roster for a real Deal Desk summary. Full detail: `_audit/2026-07-22/FRONTPAGE-REPAIR.md`.
- **Committed `202ed22`** — baseline snapshot; restored version control (`.git` was empty, no history since ~Jun 30).

## Standing constraints (user preferences)
- **Restarts are the user's** — never restart the live server; it's a prod build on the LAN. Assistant edits source + typechecks; user runs `npm run build` and restarts at a stopping point.
- **Agent modules to keep standalone** (do NOT fold into a unified console): **Agent Council chat (`/room`)**, **The Oracle**, **News Radar**.
- **Jarvis** — wanted working. Plan: drop the dead OpenAI Realtime default; decompose to mic → STT → hermes/Claude CLI → **ElevenLabs TTS** (key valid; `/api/hermes/tts` already supports it).
- Exile-not-delete; never hard-delete files.

