# Audit Pass 1 — Engineering ("make the monster live")
Status: IN PROGRESS · fleet reports landing. Severity: P0 broken · P1 degraded · P2 smell · P3 opportunity.

## ⚡ Headline findings (verified by me, main auditor)

### [P0] Version control is GONE — `.git` is an empty directory
- Evidence: `ls .git/` → 0 entries, no HEAD, no refs (dir mtime 2026-06-30 03:38). `git log` → "fatal: not a git repository".
- Impact: no history, no rollback, no diffing since ~Jun 30. Every change since is uncommitted and unrecoverable except via `.exile/`. `Update Agent OS.bat` (git-pull based) presumably broken too.
- Fix: `git init` + initial commit snapshot, or re-clone upstream + overlay local changes. Decide whether to keep upstream remote (juliangoldie) or cut loose as a personal fork. → COUNCIL ITEM (debatable).

### [VERIFIED] Prod build is NOT stale
- `.next/BUILD_ID` (Jul 1 12:36) is newer than newest src file (Jul 1 12:34) → H2 rejected. What the server serves = current source. Front-page brokenness is therefore IN the source, not a stale build.
- Also note: no src file has changed since Jul 1 — the app has been frozen for 3 weeks.

### [P1] Front page gate works as designed (fail-closed LAN gate)
- Unauthed localhost → login screen; APIs → 401. By design (proxy.ts). Not itself the "broken front page".

---

## Agent A — Core plumbing (config/runner/settings/loopEngine/store) — COMPLETE
Prior Windows fixes all verified intact (where(), resolveSpawn(), sanitizeAgentEnv(), config.json pins, per-request settings, vitals de-dupe). No P0 on happy path. Key findings:

| Sev | Finding | Where | Fix sketch |
|---|---|---|---|
| P1 | `cliComplete` drops AbortSignal — Stop can't kill CLI children (burn full 600s) | loopEngine.ts:31, runner.ts:149 | wire signal→child.kill |
| P1 | Args >32k silently DISCARDED — codex/cursor/pi/hermes loop prompts vanish after iter 1 (HTML artifact embedded in prompt) | runner.ts:128,136 + loopEngine.ts:25 | prompts via stdin for all agents, or fail loudly |
| P1 | `child.stdin.write` no error handler — EPIPE can crash the prod server | runner.ts:186,204 | stdin.on("error") |
| P1 | settings.json non-atomic write + corrupt→silent-default → can permanently wipe user settings/keys | settings.ts:137-157 | tmp+rename, backup corrupt file |
| P1 | Timeout kill orphans grandchildren on Windows (no tree kill) | runner.ts:171 | taskkill /T /F on win32 |
| P2 | Raw .bat/.cmd spawn EINVALs on patched Node (latent) | runner.ts:43,55 | shell:true or resolve entry |
| P2 | Unbounded stdout accumulation (memory balloon) | runner.ts:175 | 10MB cap |
| P2 | Judge fallback: hardcoded gemma model + ignores settings.ollamaUrl → local judge 404s (only glm-5.2:cloud installed) | loopEngine.ts:191,197 | resolveOllamaModel() like pipeline |
| P2 | `verdict()` swallows judge error causes | loopEngine.ts:239 | carry message into fallback |
| P2 | token-usage.jsonl grows forever, full re-read per poll | tokenLog.ts:105 | rotation/tail-read |
| P2 | Loop CLI builders run full-permission with cwd=$HOME | loopEngine.ts:26 + runner.ts:166 | scratch cwd |
| P2 | store.ts fabricates fleet telemetry (agent #4 always "error", invented tokens/cost) | store.ts:45-71 | zero/badge mock fields — feeds FRONT PAGE |
| P2 | spawnStream throws uncaught on missing binary in claude chat route | runner.ts:196 + claude/chat/route.ts:90 | try/catch → friendly payload |
| P3 | Timeout indistinguishable from crash (no timedOut flag) | runner.ts:171-179 | add flag |
| P3 | macOS leftovers (/Users/juliangoldie fallbacks, "your Mac" copy) | runner.ts:110, loopEngine.ts:267 | cleanup |
| P3 | deepMerge accepts __proto__ keys; writeSettings swallows failures; provider fetches no timeout; nlmBinGuess no Windows path; store hydrate race | settings.ts / loopEngine / config | small hardening batch |

## Agent E-child 1 — Hermes core surfaces — COMPLETE
- HermesWorkspace: LIVE (real fs over ~/.hermes). P2: buckets overlap HermesStudio dirs; apps/videos buckets scan entire $HOME (noisy).
- HermesStudio: LIVE code; MiniMax OAuth-gated (400 banner if absent); Grok via openclaw auth. P2: elevenlabs branch unreachable from its own toggle.
- **HermesPanel: ORPHAN (P0-dead-code, high conf)** — never mounted; fully superseded by AgentRoom (same /api/{agent}?action= route, superset actions). Kill candidate.
- **HermesTalk: ORPHAN (P0-dead-code, high conf)** — "talk" tab renders MiniMaxVoiceAgent instead. Kill candidate.
- HermesPhone: unmounted (commented out); backend real but **macOS-only** (brew/pgrep//tmp, cloudflared paths) — dead on Windows as-is; ElevenLabs half valid.
- UnifiedChat→Hermes: LIVE (`hermes -z --yolo --accept-hooks`), good timeout diagnostics.

## Agent E-child 2 — Notebook / Voice / SpeakBuild — COMPLETE
- NotebookView: REAL NotebookLM integration via notebooklm-mcp stdio (works iff `nlm login` done); graceful "Not connected" banner. P2: orphan duplicate route studio/status; P2: NotebookSettings.notebookId saved but never read (dead field).
- MiniMaxVoiceAgent: real STT(ffmpeg+openclaw grok-stt)→MiniMax M3→TTS loop; MiniMax-OAuth-gated; whisper fallback dead (OpenRouter).
- VoiceButton: client-only Web Speech dictation, fine.
- **SpeakBuild "N2 ✦ smarter" engine: [P0] dead on click** — hard-depends on invalid OPENROUTER_API_KEY (freeclaude/build/route.ts:37-123). Looks fully live, fails every request. Fix: swap provider or show not-connected state. On-device Ollama engine real.
- hermes/tts route duplicates elevenlabs.ts logic inline (P2).

## Agent B — FRONT PAGE — COMPLETE · **H1 CONFIRMED: demo shell, not runtime crash**
Server log tail: clean boot, zero errors. Page makes exactly ONE real fetch (`/api/config` → real CLI detection). Everything else is fiction, admitted at store.ts:44 ("Mock runtime numbers — replaced by real telemetry when the bridge is wired") — **the bridge was never wired.**

| Widget | Verdict | Evidence |
|---|---|---|
| HeroGreeting | DEGRADED | counts fabricated statuses (always "2 active"); "Run plan"/"New agent" buttons have NO onClick |
| MissionStripe | FAKE P2 | UPTIME frozen at "07:42:14" forever; fake BUILD id |
| KPIGrid | FAKE P1 | `const mockKPIs` — "4/7", "142 runs", "$14.82", invented sparklines |
| TelemetryPanel | FAKE P3 | random walk every 1.8s; at least labeled "Simulated" |
| AssistantPanel | FAKE P1 | recs about NONEXISTENT agents (Atlas/Orion/Vega/Lyra), fictional PR #4218, "● LIVE" badge, dead "Execute plan" |
| FleetSummary | DEGRADED P0 | real names/auth + fabricated status-by-index (Hermes always "paused") + fake $ accrued |
| SystemMap | DEGRADED P2 | maps real config but "connected" counts are the same fabricated statuses |
| MiniTimeline | FAKE P0 | mock-data.ts fiction ("Migration 0042", agent "Rigel") + random event every 3.2s, badged LIVE. **Real feed exists unused: `/api/activity` tails actual openclaw/hermes logs (only ActivityStream.tsx uses it)** |

Ranked fixes (B's): 1) replace `seedRuntime` fabrication with honest `hasAuth?idle:offline` + real `/api/fleet/runtime`; 2) MiniTimeline → `/api/activity` (proven pattern in ActivityStream.tsx); 3) KPIGrid from real stores or hide tiles; 4) strip AssistantPanel fiction or back with real `claude -p` endpoint; 5) MissionStripe → process.uptime()+real versions; 6) wire/remove dead hero buttons, slow 1.8s cosmetic churn (8 infinite framer-motion loops = constant GPU load).

## Agent G — SECURITY — COMPLETE · **the sharpest edges in the whole system**
Framing (accurate): *this app is by design a remote-code-execution service for the machine* — it spawns claude/codex/hermes/agy with `--yolo`/`--full-auto`/`--dangerously-skip-permissions` and feeds them LAN-user-controlled prompts. The entire boundary is ONE shared password over cleartext HTTP. Severity: 1×P0, 4×P1, 4×P2, 3×P3.

| Sev | Finding | Where | Fix |
|---|---|---|---|
| **P0** | Login has NO rate-limit / lockout → brute-force the single password = full RCE as the user | api/auth/login/route.ts:14-40 | per-IP backoff + lockout + entropy check on AGENTOS_PASSWORD |
| P1 | Session cookie = unsalted non-expiring `sha256("agentos.v1:"+pw)` → pass-the-hash forever, logout is cosmetic, offline crackable | proxy.ts:13-15,44 | random server-stored session id, real revocation, expiry |
| P1 | Cookie + password travel cleartext (secure:false + 0.0.0.0 HTTP) → one LAN sniff = permanent access | login/route.ts:36 | TLS front (Tailscale/mkcert), secure:true, bind Tailscale iface |
| P1 | Path traversal `project=".."` → authed read of ALL `~/.agentic-os/**` (outreach keys, tokens) | claudeWorkspace.ts:131 + 3 sibling helpers | validate base under root, reject `.`/`..` project |
| P1 | All 224 API routes rely SOLELY on proxy.ts (no per-route authz) — single point of failure | proxy.ts | shared assertSession() in sensitive routes; tighten /_next allowlist |
| P2 | `isAllowedMediaPath` allows reading ANY media file under HOME; blocklist is macOS-only (matches nothing on Windows) | media.ts:89-118 | scope to generated-media roots, no client abs paths |
| P2 | Permission-bypass is client-toggleable (`dangerouslySkipPermissions` body bool) | antigravity/chat/route.ts:43 | server-side policy, sandbox cwd |
| P2 | Preview routes serve agent-writable HTML same-origin, no CSP → stored XSS → pivots to RCE routes | claude/preview/[...path]/route.ts:22 | sandbox iframe / separate origin / CSP |
| P2 | Raw agent stderr returned to client ("full, no trunc") → leaks paths/tokens agents print | hermes/chat/route.ts:102 +2 | generic error id, scrub secrets |
| P3 | No CSRF beyond sameSite:lax; no security headers (CSP/XFO/nosniff); 30-day non-revocable session; proxy `===` not constant-time | various | header pass + Origin check |

**Positive (done well):** no shell injection (spawn arg-arrays, no shell:true, safeArg rejects null bytes/over-long); `/api/run` has a real per-agent allowlist w/ diagnostic-only flag regexes; relPath containment correct; fail-closed when password unset; httpOnly cookie; `.env.local` gitignored + no `NEXT_PUBLIC_` secrets; Next 16.2.6 past the CVE-2025-29927 middleware-bypass.

## Codex (independent OpenAI-lineage critic) — core layer — CORROBORATES + adds
Independently reproduced: abort not wired (#6), spawnStream no lifecycle/timeout (#7), CLI accepted if any stdout even on nonzero exit (#8), oversized prompts silently dropped (#9), non-atomic settings (#12), corrupt→default silent revert (#13). **New that our agents missed:**
- **P1 CLI-option injection** — loopEngine.ts:25 passes untrusted `prompt` as a bare positional with no `--` terminator → a prompt starting with `-`/`--` becomes a CLI flag to codex/cursor. Fix: stdin or `--` before positional.
- **P1 verdict bug** — loopEngine.ts:180 `!!v.pass` makes the STRING `"false"` → `true` (loop treats a failed build as passed). Fix: `typeof v.pass === "boolean"`.
- P2 plaintext secrets in settings.json (sunoApiKey/sunoCookie) — DPAPI/credential-manager.
- P2 `extraEnv` spread unfiltered into child env (PATH/NODE_OPTIONS override surface).
- P2 Cursor version picked lexicographically (`.sort().reverse()`) → `2026.9` outranks `2026.10`. config.ts.
- P2 `AGENTIC_OS_VAULT` env does NOT have documented precedence (fileCfg.vaultRoot checked first) — config.ts:157.
- P2 Windows fallback discovery omits Windows paths for NotebookLM/Kimi/Grok. config.ts:78-112.
- P2 `/api/auth/*` over-allowlisted (any subpath bypasses gate); login body/password length uncapped.

## Agent E-parent — KNOWLEDGE MODULES (journal/memory/jarvis/oracle/news/radar) — COMPLETE
- **[P2] Nav-orphaned pages:** `/journal`, `/radar`, `/goals` are NOT in Sidebar/CommandPalette/home — reachable only by typing the URL. They're fully-built (TopBar has titles) but findable by nobody.
- **[P0] Jarvis Realtime voice — the sharpest UX lie in the app.** Realtime is the DEFAULT mode (`realtime` starts true) and needs `OPENAI_API_KEY`, which is NOT set on this box → session mint 400s, voice dead. Meanwhile `JarvisView.tsx:1124` hardcodes "Realtime voice is live below — just talk" and disables the working fallback buttons *because the toggle is on, not because it connected*. Default experience: shows "live," every voice path dead. Only working path = manually pick Agent mode (`hermes -z --yolo`). Also `speak()` hardcodes `provider:"openai"` TTS though ElevenLabs is valid.
- **Oracle: LIVE, proven** — `~/.agentic-os/oracle/log.json` = 10.3KB real entries. News: LIVE, proven — `news/log.json` = 4.6KB. Both CLI-scout based, no OpenRouter dep. ✅
- **Memory: LIVE** but `MemoryPanel.tsx:100` + `TopBar.tsx:40` hardcode "1261 omi · 186 notes" (frozen snapshot, not live counts). Two Three.js renderers (VaultGraph3D + MemoryGalaxy) on one toggle = doubled maintenance. **Vault paths Windows-safe (verified).** Minor `safeJoin` prefix-bug (vault.ts:11, low impact).
- **Journal: LIVE** (writes `<vault>/Agentic OS/Journal/YYYY-MM-DD.md`), just nav-orphaned.
- **Radar: LIVE code, unused since 2026-07-01** (`radar/status.json` records a failed sweep, never retried; latest/history/published.json + wordpress.json all missing → graceful empty/503). NOT Grok/X-dependent anymore (rewritten to CLI-scout fan-out; the "Grok/X-OAuth" UI copy is STALE). Contains a UNIQUE unfinished feature: multi-site WordPress auto-publish + index submission. Stale copy = the only reason it looks legacy.
- **Orphaned components (kill/wire):** HermesPanel, HermesTalk, HermesProfiles (backends live, components unmounted).
- **Hermes bonus:** HermesGoals "delete" leaks log+scratch dirs forever (hermesGoals.ts:209); HermesOutreach shows "Found 0 sites" instead of "no Firecrawl key"; HermesMCPCatalog UI says "Phase 2/3 coming" for already-shipped features; MCPCatalog vs embedded native dashboard both write `~/.hermes/config.yaml` (unclear winner).

### Chat-surface sprawl (the big architectural smell)
**≥3 live, independently-engineered "talk to Hermes" code paths** (UnifiedChat→/api/hermes/chat, Jarvis typed→/api/hermes/jarvis, Jarvis Realtime→OpenAI) + 2 orphaned (HermesTalk, HermesPanel) + MiniMaxVoiceAgent. Plus per-agent panels for claude/codex/cursor/pi/etc. Massive duplication of the same "prompt→CLI→render" pattern.

### Sidebar/product shape (from Sidebar.tsx)
4 groups: **Workspace** (Mission Control) · **Agent Orchestration** (Paperclip, Mastermind, Pipeline, Deal Desk, Agent Kanban) · **Agents** (claude/openclaw/hermes/antigravity/codex/cursor/pi/ollama/freeclaude/fusion/sakana/local/engine — 13 agent tabs) · **Self** (loop/seo/leads/opendesign/video/music/games/thumbnails/notebook/kanban/memory/guide). 31 nav items total. Footer "Wired: claude·codex·cursor·pi + Obsidian vault".

## Agent F — WORK / OUTPUT MODULES — COMPLETE (very thorough, per-module file:line)
**Live & healthy:** pipeline, agent-kanban (Rule 11 HONORED — rejects unknown CLI ids loudly), leads (CLEAN — literally NO send capability, only clipboard+CSV; stricter than draft-only), deals (Ask/Draft shell real `claude`; reload spinner already fixed), seo (CLI-based, NOT OpenRouter-dep), guide/seo-guide (static docs), goals (writes vault), kanban (real Hermes SQLite DB + CLI), games, sakana (live api.sakana.ai), engine, music (real Suno).

**Broken / degraded (ranked):**
| Sev | Module | Finding | Where |
|---|---|---|---|
| **P1** | **loop** | Judge SILENTLY falls back to Ollama on any judge failure — **Rule 11 violation, currently triggerable**: N2/Fusion judges need invalid OPENROUTER_API_KEY → silent unlabeled Ollama verdict today. UI also hand-dupes WORKERS/JUDGES (diverged from engine); findChrome() macOS-only so browser check no-ops on Windows | loopEngine.ts:216-246,44,164,233; LoopView.tsx:31 |
| **P0** | **video** | hyperframes render binary hardcoded to Unix `~/local/node/bin/hyperframes` (no Windows) → 503 every render. HeyGen/MiniMax unconfigured → grids silently empty (errors swallowed to []). Broken end-to-end on this box | api/video/hyperframes/render/route.ts:20 |
| **P1** | **thumbnails** | Default CLI backend LIES: UI claims vault-save but labs route returns savedTo:null → history always empty. `sharp` imported but ABSENT from package.json → clean install breaks preview | ThumbnailStudio.tsx:180; api/thumbnails/file/route.ts:3 |
| **P1** | **music** | "Account cookie" field self-documented "Scaffolded — not yet wired"; saving it does nothing forever | MusicSettings.tsx:61 |
| **P1** | **studio** | ContentStudioView = orphaned component (never imported); but its /api/content/* IS alive via KanbanView content-board. 4 separate "generate media" stacks coexist | ContentStudioView.tsx |
| **P1** | **ruflo** | Fully-built SEO-swarm launcher, **zero Sidebar AND zero TopBar entry** — most orphaned page in the app. Highest effort/impact fix (add 2 nav lines) | Sidebar.tsx/TopBar.tsx |
| **P1** | **paperclip** | 3 of 4 API routes (overview/workspace/builds, ~150 lines complete proxy) have zero frontend callers — finished backend, no cards | api/paperclip/* |
| **P1** | **sakana** | key-gated, error only after Send (no proactive banner) | api/sakana/chat |
| P2 | kanban | KanbanSettings "Dispatch agent" picker writes a setting nothing reads | KanbanSettings.tsx:36 |
| P2 | seo | getSites()=[] on this box, fails only after click (no "0 sites" banner); /api/seo/{index,transcript,notes} zero callers | seoPipeline |
| P2 | engine | UI says "Gemma-4 12B Coder" but backend diagnostic says llama3.1:8b (misleads troubleshooting) | LocalHermesEngine.tsx:101 |
| P3 | deals | elevator-pitch line still missing from yellow Project Summary box; board/feeds 3-4wk stale, no last-sync indicator | DealDesk.tsx:147 |
| P3 | pipeline | CLI/MiniMax errors swallowed → generic "local model busy" even when no local model ran | pipeline.ts:372 |

**Name-collision overlap map (F):** 3× "kanban" (Hermes-DB /kanban · demo /agent-kanban · Deal Desk self-labels "Upwork Kanban") — rename ≥2, no code merge. 4× "studio" (MediaView /studio · HermesStudio · OpenClawStudio · orphaned ContentStudio). 3× "goal mode" (/goals · HermesGoals · codexGoals) — zero shared code, same UX idea. seo/video/thumbnails "labs" routes copy-paste an identical CLI-dispatch table (DRY). **Kill candidates:** ContentStudioView component, Suno cookie field, /api/seo/{index,transcript,notes}, KanbanSettings dispatch picker, LoopView dup arrays. **Resurrect (built, unreachable):** /ruflo, /goals, /studio (add nav).

## Agent D — AGENT-WORKSPACE VIEWS (13 tabs) — COMPLETE
**Live & healthy:** claude (best-wired: chat/workspace/ultracode all real), codex, cursor, pi, antigravity (correctly reuses UnifiedChat), ollama (cloud, key-gated), room (7/9 agents work).
**Broken / degraded:**
| Sev | Module | Finding |
|---|---|---|
| **P0** | **fusion** | Chat's ONLY path is OpenRouter (invalid key) → every send fails. No fallback. "PANEL" model chips (Opus/Gemini/Grok/Fable) are a hardcoded client-side illusion; backend calls one model id. |
| P1 | claude | Artifacts publish broken on Windows — bespoke macOS-only `netlify` spawn (`:`-PATH rebuild) instead of runner.ts's Windows-safe layer. `claudeArtifacts.ts:124` |
| P1 | codex | Sessions file-preview dead on Windows — POSIX-only homedir regex `/^(\/(?:Users|home)\/...)/` never matches `C:\` → clicks no-op. Fix: return os.homedir() server-side |
| P1 | freeclaude | Panel chat needs local fcc-server (:8082, not running) AND defaults to OpenRouter; Speak "n2" engine = OpenRouter too |
| P2 | openclaw | "Memory" tab always runs `memory --help` (help text, never real memory entries) |
| P2 | room | `openclaw` agent hardcoded provider:openrouter (breaks each turn); `antigravity` agent points at fictional Ollama tag `gemini-3-flash-preview` (errors each turn though real `agy` CLI works elsewhere) |
| P2 | local | offline build feature dead until local Ollama daemon started; backend computes `warm:false` but UI discards it |

**Dead orphan components (zero importers, grep-confirmed):** ClaudePanel.tsx, OpenClawPanel.tsx, AgentPortal.tsx (+ HermesPanel/Talk/Profiles from E, + ContentStudioView from F).
**Naming collisions:** `AgentRoom.tsx` (control panel) vs `agentRoom.ts` (room chat engine); `kimiWorkspace.ts` misnamed (not Pi's); `LocalHermesEngine` belongs to /engine not /local.
**Chat-surface census (definitive):** 1 shared (UnifiedChat, reused 3×) + 8 bespoke reimplementations (Codex/Cursor/Pi/Ollama/Local/FreeClaude/GroupChat/Fusion) + 1 dead dup (ClaudePanel). Cursor+Pi are ~95% identical (cheapest consolidation win). AgentPicker exists + used by 12 files but /room and /fusion hand-roll their own.
**OpenRouter blast radius (invalid key):** fusion (P0), freeclaude panel + n2 (P1), room openclaw (P2), openclaw STT fallback (P2, unreachable). Everything CLI-shelled is unaffected — confirms CLI-first is the healthy design; OpenRouter paths are the exception that should get CLI fallbacks or honest banners.

---
## Agent C — API ROUTE SWEEP (224 routes) — COMPLETE · reveals a BUG CLASS
**The structural finding:** `runner.ts` is Windows-safe, but ~8 routes **bypass it and reintroduce the exact macOS assumptions runner.ts was written to kill.** This is a whole class, not isolated bugs:
| Sev | Route | macOS-only defect |
|---|---|---|
| **P0** | seo/research:18 | `const PY = "/usr/bin/python3"` → ENOENT on Windows, GSC research 100% dead |
| **P0** | hermes/realtime/open:11 | `spawn("open",…)` macOS-only; Jarvis "open website/app" silently no-ops on Windows |
| **P0** | loop/run:24 findChrome() | only checks macOS Playwright cache → Windows returns null → `renderCheck` returns `{ok:true}` WITHOUT checking. **Loop's "run in real browser" safety net is silently disabled.** |
| **P0** | hermes/goals + codex/goals | bypass runner.ts, force `HOME:""` on Windows (Windows uses USERPROFILE) → Goal-mode spawns likely broken |
| **P0** | video/hyperframes/init:271 | bare `spawn("claude",…)` ignores config resolution/overrides |
| P1 | thumbnails/generate:86 | `exec("python3")` — Windows has python.exe/py.exe |
| P1 | opendesign/control + seo/deploy | colon-join macOS PATH dirs in FRONT of Windows `;`-PATH → corrupts env (the exact anti-pattern runner.ts documents avoiding) |

**More orphans (zero callers, grep-verified):** paperclip/{builds,overview,workspace} (~250 LOC — page uses window.open instead), seo/index, seo/notes, translate/gemini-live, notebooklm/studio/status. **Sidebar missing /radar, /goals, /journal** (pages+APIs+TopBar titles all exist; only the nav link is gone). config.ts labels EVERY agent `kind:"claude-cli"` (display drift). hermes/tts + realtime/session read OPENAI_API_KEY from a `youtube-thumbnails` skill .env (odd copy-paste coupling). Only 19/224 routes set maxDuration (low impact — self-hosted Node, not edge).
**Env keys referenced (names only):** AGENTOS_PASSWORD, OLLAMA_*, OPENROUTER_API_KEY, OPENAI_API_KEY, ELEVENLABS_API_KEY, SAKANA_API_KEY, PAPERCLIP_*, INDEXCEPTIONAL_*, LOCAL_MODEL.

---
# PASS 1 COMPLETE. Coverage: core plumbing · front page · all 224 API routes · 13 agent workspaces · Hermes+knowledge · work/output modules · security · + independent Codex critic. 
## Cross-cutting themes (synthesis)
1. **Two big lies to the owner:** the home page fabricates telemetry (store.ts:44) and Jarvis hardcodes "voice is live" over a dead feed. Trust-corroding.
2. **A macOS→Windows portability BUG CLASS:** runner.ts is safe but ~8 routes bypass it → 5 P0 spawn failures (python3, `open`, Chrome, HOME, netlify/agy). The single highest-yield engineering theme.
3. **Chat-surface sprawl:** ~20 ways to talk to an agent (1 shared UnifiedChat + 8 bespoke + 5+ orphaned/duplicate). Cursor/Pi are 95% twins.
4. **OpenRouter blast radius:** one invalid key silently kills fusion (P0), freeclaude, room-openclaw, N2, whisper-fallback — because those paths have no CLI fallback (violating the CLI-first rule).
5. **Loop engine fragility:** abort not wired, >32k prompts dropped, `"false"`→true verdict, Rule-11 silent Ollama fallback, browser-check disabled. The autonomous core is the least trustworthy.
6. **Security = one brute-forceable password over cleartext gating full RCE** — but the fixes are hours, not weeks.
7. **~12 orphaned routes/components + 3 nav-orphaned fully-built pages** (/ruflo, /goals, /journal). And **version control is gone** (empty .git).
8. **Good bones:** no shell injection, CLI-first design is sound where honored, vault I/O Windows-safe, /api/run allowlisted, secrets gitignored, .exile discipline intact.
