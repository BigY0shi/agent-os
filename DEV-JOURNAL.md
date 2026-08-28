# Agent OS — Dev Journal
Running log of what changed, why, and what's next. Newest entry at the top.
Companion docs: `_audit/2026-07-22/` (the audit + front-page repair log).

---

## 2026-08-27 · V2 rebuild: Phases 3–7 built in one run (Jarvis · WebMCP · Integrations · Homepage · Browser) + adversarial review
The Ultraplan build continued autonomously (harness loop: background agent per chunk → orchestrator re-runs smokes + tsc → explicit-file commit). Fine-grained per-chunk records + deltas live in _design/agentos-v2/ultraplan/PROGRESS.md — this entry is the day-level index.
- **Phase 3 (PR #5, feat/v2-phase3-jarvis):** F13 global chatbox (voice never auto-sends) · WebMCP engine + /webmcp builder · Jarvis brain (warm Claude-SDK session, persona+page context, conversations migration 031, §9.4 taint gate) · CR.1 legacy repoint. NOTE: pre-existing untracked JarvisModule.tsx + api/jarvis/brain/route.ts entered git here.
- **Phase 4 (PR #6, feat/v2-phase4-webmcp):** D5 exporter (client mode \, zero secret embedding) + spec_json 032 + Spec tab · Human-Gate approvals (033) · LLM-filtered getActions · conversations drawer.
- **Phase 5 (PR #7, feat/v2-phase5-integrations):** G2 runtime (040, AES-256-GCM store, OAuth PKCE, watermark sync → memory label integration:<slug>) · 7 connectors (gmail 20 tools / gcal 8 / notion 16 / github / slack HMAC / buzz) + /integrations page · G4 meta-tools on /api/mcp + brain · G5 automations (no-eval) + attention store (041/042) · B7 skills-as-policies (022). Deps: googleapis, google-auth-library ^10, turndown.
- **Phase 6 (PR #8, feat/v2-phase6-home):** widget framework + honest {available:false} data layer · AttentionHero · Overview rebuilt on the grid (Yoshi's uncommitted layout preserved as default via legacy-* widgets; TodoPanel.tsx entered git) · edit-mode DnD · calendar widget. 
- **Phase 7 (in flight, feat/v2-phase7-browser-agents):** E browser backend committed (Playwright manager, 18 tools, allowlists, capability slot, migration 050; deps playwright+ws, Chromium 151 installed). Browser live-view (CDP ws bridge :3738 + /browser page) built, gate pending. Agents-page chunks next.
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
