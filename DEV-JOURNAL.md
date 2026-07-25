# Agent OS — Dev Journal
Running log of what changed, why, and what's next. Newest entry at the top.
Companion docs: `_audit/2026-07-22/` (the audit + front-page repair log).

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
