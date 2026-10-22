# NEXORA vs Agent OS: feature diff

Written 2026-09-28. Source A is `C:\Users\Yoshi\Downloads\NEXORA-Prompts-Fresh-Hermes-KomputerMechanic.md` (Komputer Mechanic, "Mission Control Dashboard 3.0"). It is third-party reference material and advisory only (global rule 27). Nothing below is a requirement.

**Scope correction:** the brief said about 39 prompts. The file has **46** (its header says "Total prompts: 46", and Prompt 46 is the last one). All 46 are covered below.

**What NEXORA is:** a Python standard-library backend (`~/nexora/server/`, port 8800, 127.0.0.1 only) that reads a Hermes install and treats it as read-only, with three narrow exceptions. It sits in front of a paid, prebuilt single-file dashboard of about 9 MB that includes xterm and three.js. It has 14 pages: Cockpit, Voice mode, Hand mode, Chat, Missions, Docs, Schedule, Agent City, Health, Files, Terminal, Integrations and Settings. Prompt 39 names only 13 of them, although it says "fourteen".

**How to read the Evidence column:** every path in it was grepped or read in this session. "not found" means a targeted grep came back empty. It does not mean the code has been proven absent.

## 1. Prompt-by-prompt table

| # | Name | What it creates | Status | Agent OS evidence |
|---|---|---|---|---|
| 1 | Introduce Yourself | The EXECUTOR orchestrator persona. Owner facts are saved to Hermes memory | N/A | Persona chatter. The orchestrator role here is Jarvis (`src/lib/v2/jarvis/`) |
| 2 | Let NEXORA Interview You | The agent asks exactly 6 follow-up questions and saves the answers to memory | N/A | Agent conversation, not a module. Closest equivalent is Memory V2 ingest (`src/components/v2/memory/ManualIngest.tsx`) |
| 3 | Permanent Operating Rules | Standing rules: progress lines, plan before acting, no filler, never fabricate, blocked-command handoff, 127.0.0.1 only, no spending | PARTIAL | Standing policies exist as data (`src/lib/v2/skills`, `/skills`). Spend ceiling exists (`src/lib/v2/agents/spendCap.ts`). The 127.0.0.1 rule conflicts with ours: `package.json:8` runs `next start -H 0.0.0.0` behind the `src/proxy.ts` gate |
| 4 | Plan the Four-Agent Fleet | A written plan for EXECUTOR plus research, writer and developer | N/A | Planning chatter |
| 5 | Create the Three Specialists | `hermes profile create <p> --clone`, a SOUL.md starting "Your name is X.", auth.json/config.yaml/.env copied across, a "Who are you?" verification turn | PARTIAL | Hermes profiles are read-only in the app: `src/app/api/hermes/profiles/route.ts` has GET only, and `src/components/HermesProfiles.tsx` shows "N hired". Agent OS's own agents are created in `src/components/v2/agents/ForgeWizard.tsx`. `profile create` was not found anywhere in `src/` |
| 6 | Memory, Workspaces, Team Awareness | Per-agent memory and workspace, owner facts split by role, a "The team" section in every SOUL, a one-line boundary rule | PARTIAL | Per-agent memory for our own agents: `src/lib/agentsStore.ts` (`memory/facts.md`, `journal.md`). A team-section sync for SOUL files was not found |
| 7 | Project Folder and Activity Log | Shared `~/nexora/data/`. Every agent appends `TIMESTAMP \| AGENT \| what \| how long` to activity.log | PARTIAL | Run registry: `src/lib/moduleRuns.ts`. Event log: `src/lib/v2/events.ts`. `/api/activity` tails CLI logs, but see the flag in section 4 |
| 8 | Brief Your Builder | Backend contract: Python stdlib, one module per subject, JSON errors, guarded shell-outs, Hermes home treated as read-only with 3 exceptions | N/A | Different architecture (Next.js). The principles we share are already house rules in `AGENTS.md` ("Fail loudly", credentials) |
| 9 | The Router | ThreadingHTTPServer, route table, 405 vs 404, 30 MB body cap, Raw/Stream returns, `/api/ping` | N/A | Covered by Next route handlers (`src/app/api/**/route.ts`) |
| 10 | Where Our Own State Lives | SQLite with WAL, `settings` and `audit` tables, `ensure()` schema | HAVE | `src/lib/v2/db.ts`, `src/lib/v2/dbSchema.ts` (migrations), `src/lib/v2/events.ts` (header says every emit persists to the events table, which serves as feed and audit), `src/lib/settings.ts` |
| 11 | Prove The Floor | curl checks for ping, 404, 405 and the bind address | N/A | Process step. Our equivalent is the `scripts/v2/smoke-*.mjs` offline smokes |
| 12 | Find Your Agents | `roster.py`: profiles discovered from disk, name from SOUL, model from config.yaml, stats from state.db (read-only), 4 status words, a 2-letter code frozen per profile, one fleet-level gateway | PARTIAL | `src/app/api/hermes/profiles/route.ts` reads profile.yaml, config.yaml, the first SOUL line and lastActive. No state.db session stats, no status vocabulary, no frozen codes. Status bands for our own agents: `src/lib/v2/agents/statusFeed.ts` |
| 13 | The Fleet Endpoint | `/api/agents`: per-agent and fleet stats, `hourly_24h {you, agent}` sparklines, heatmap, handoffs, recent sessions ticker | PARTIAL | `src/app/api/fleet/runtime/route.ts` is derived only from run records and flags token gaps. `src/app/api/tokens/route.ts` and `src/lib/tokenLog.ts` cover tokens. No hourly, heat or handoff series for Hermes profiles |
| 14 | Who Is Running This | Settings: display_name (24-char limit, rejected not truncated), timezone checked with zoneinfo, voice_engine; operator_name read from Hermes USER.md | PARTIAL | `src/lib/settings.ts:297` has `tasks.timezone`. Operator name comes from config (`src/lib/store.ts:107`, `cfg.operator.name`). Not found: display_name validation, and reading the name from USER.md |
| 15 | Faces | Avatar library, per-agent and operator portraits, data-URL upload (png/jpg/webp by magic bytes, 4 MB) | MISSING | `src/components/AgentAvatar.tsx` is fixed brand marks per CLI. No upload or picker found |
| 16 | One Real Turn | `hermes [-p] chat -q ... -Q --source nexora -c nexora-<agent> --create-if-missing`, one lock per profile, output stripped of ANSI and warnings, 6000-char cap | PARTIAL | `src/app/api/hermes/chat/route.ts:65` runs `hermes --profile <p> -z <prompt>`. Single-query mode with history stitched in by the caller (line 15 comment). No named persistent session |
| 17 | Remembering And Forgetting | Server-side history per agent and source, "forget" renames the session, `thinking` flag survives reload | PARTIAL | The Hermes Sessions tab lists `hermes sessions` (`src/app/hermes/page.tsx:116`). The Jarvis conversation store is in `src/lib/v2/jarvis/`. No server-side per-profile chat history for `/api/hermes/chat` |
| 18 | Attachments | Files posted in chat (limits 8/16 MB, max 4, never dropped silently), first image passed as `--image`, served back by id | MISSING | Not found in the Hermes chat route. Other modules take files (`src/components/v2/anynotes/CaptureBox.tsx`, `ThumbnailStudio.tsx`) |
| 19 | A Voice On This Machine | Local Piper TTS service on 127.0.0.1:8768 with `/say`, `/voices`, `/health` | HAVE | Kokoro TTS :8880 (`kokoro-start.ps1`), Parakeet STT :8881 (`parakeet-start.ps1`, `src/app/api/stt/transcribe/route.ts`) |
| 20 | Voice Mode | Modes 1/2/3 (local, studio, both), ElevenLabs fallback reported in the `X-Voice-Engine` header, per-agent voice cast, auto-greet, `/api/transcribe` | PARTIAL | A labelled fallback exists: `src/app/api/hermes/tts/route.ts:160,178` (`provider`, `fellBackFrom`, `fallbackReason`). STT exists. Per-agent voice cast and auto-greet were not found (JarvisView has a `greeting` string at :411, but it is a briefing field, not a spoken greeting) |
| 21 | What A Mission Is | Mission lifecycle planning, awaiting_approval, running, review, delivered (plus stopped/cancelled), with steps and plain-sentence events | PARTIAL | Planner/builder cards: `src/app/api/agent-kanban/plan/route.ts`. Hermes board: `src/lib/kanbanDb.ts`. Approvals: `src/lib/v2/attention/`. No mission object with an approval gate and a review state |
| 22 | Launching One | Launcher `{objective, auto_team, agents, time_limit_min, max_steps, length, review}`. The default profile plans JSON steps with `needs` dependencies. Only seats that can answer are used | PARTIAL | `agent-kanban/plan` takes a goal plus a launch drawer (seat, skills, `timeoutMin`, `maxCards`) and returns 400 on unknown fields. No step dependency graph, no check that a seat can answer |
| 23 | The Seven Verbs | approve/accept/send_back/replan/stop/cancel/clear. A watcher reads kanban `task_runs` and `deliverable.md` every 20 s and assembles a report. Retry cap. Time budget per step | PARTIAL | Card-level verbs: `src/app/api/hermes/kanban/action/route.ts:41-91` (create/complete/block/unblock/archive/comment/assign/specify). `task_runs.summary` read at `src/lib/kanbanDb.ts:214`. No mission-level verbs, watcher or report |
| 24 | Hiring | Role library JSON. Deploy runs profile create, writes the SOUL, copies credentials (0600, platform tokens stripped), runs a verify turn and rolls back on failure | PARTIAL | Our own agents are hired through `ForgeWizard.tsx` and `src/app/api/v2/agents/draft/route.ts` (fails loudly). No Hermes profile hiring |
| 25 | Letting Go | Remove after typed-name confirmation. Archive tar.gz excluding secrets. `hermes profile delete -y`. Team-section sync across SOULs | PARTIAL | Lifecycle/retire for our own agents: `src/lib/v2/agents/lifecycle.ts`. Nothing for Hermes profiles |
| 26 | Standing Orders | Reads every profile's `cron/jobs.json`, English rendering of expressions, ticker heartbeat (alive if under 300 s), run/pause/resume/remove guarded 4 ways, "asked for" rather than "ran" | PARTIAL | Hermes cron is only reachable through the embedded Hermes web UI (`src/components/HermesManage.tsx`, `/api/hermes/dashboard`, :9119). Agent OS's own scheduler: `src/lib/v2/scheduler.ts`, `/automations`. No native view across profiles |
| 27 | The Library | Markdown docs per agent with front matter, excerpts (1400 bytes), exact word count, download | PARTIAL | Pages V2: `src/lib/v2/pages/store.ts`. Hermes output browser: `src/lib/hermesWorkspace.ts`. Kanban workspace files: `src/app/api/hermes/kanban/workspace/`. No unified deliverables library |
| 28 | Writing, Deleting, Keeping | Doc save/delete (copy to docs-deleted), "from chat" reply-to-doc, missions filing their own report | PARTIAL (uncertain) | The Pages editor exists (`src/components/v2/pages/Editor.tsx`). I did not verify a save-reply-as-doc path. Mission auto-filing is not present |
| 29 | What The Box Is Doing | Host health every 3 s: CPU/mem/disk/net, top processes attributed to agents, first CPU reading null, gateway uptime, diagnostics sentences (ok/strain/needs a look) | PARTIAL | `src/app/api/vitals/route.ts` gives CLI and gateway liveness (`:73`). The Hermes Doctor tab is at `src/app/hermes/page.tsx:120`. No host metrics: a grep for `os.cpus()`, `freemem()`, `loadavg()` and `statfs` in `src/` came back empty |
| 30 | What They Said To Each Other | `traffic.py`: kanban cards as handoffs, reply taken from `task_runs.summary`, parent chains, filter by mission id, "unassigned" | PARTIAL | `src/lib/kanbanDb.ts` reads the board (read-only) and `task_runs`. No handoff/traffic view |
| 31 | Their Files (+ models) | Editor for SOUL/USER/MEMORY/config.yaml: mtime conflict refusal, backup before every save, yaml sanity checks, skills reported as "not in the manifest". Plus `/api/models` and model assign | MISSING (files) / PARTIAL (models) | No SOUL writes found in `src/` (only reads, in `profiles/route.ts:45`). Model and provider can be set through the embedded Hermes dashboard (`HermesManage.tsx` header) |
| 32 | A Real Shell | PTY terminal: ring buffer, SSE with Last-Event-ID replay, gap/exit events, resize, process-group kill, quick commands | HAVE (core) | `src/lib/ptySessions.ts`, `src/app/api/terminal/route.ts` + `stream/`, `src/components/TerminalView.tsx`. No quick-commands store found |
| 33 | Prove The Backend | Route table, refusal tests, audit of what was written under Hermes home | N/A | Process step. Our equivalent is `./test.sh` plus the smokes |
| 34 | Bring The Dashboard Down | Serves the single HTML file with gzip and ETag. `/api/agents` acts as the pulse | N/A | We build our own UI |
| 35 | Hand Mode's Models | MediaPipe hand-landmarker (~26 MB) served locally for gesture control | MISSING | A grep for `mediapipe`/`HandLandmarker` in `src/` came back empty |
| 36 | Make It Yours | Display name and timezone flow into the greeting, account card and header clock | PARTIAL | `src/components/dashboard/HeroGreeting.tsx:19-28` (falls back from operator name to "Operator"). No header timezone clock found |
| 37 | Their Faces | Portrait picker; faces on cards and in the 3D campus; operator avatar replaces the letter in the header | PARTIAL | A 3D office exists (`src/lib/v2/hermes3d/scene.ts`, `/hermes3d`). No portraits (see 15) |
| 38 | Palette, Layout And Type | 5 palettes plus 1 custom, 5 nav layouts, type pairings, per device, applied before first paint | MISSING | A grep for `data-theme` in `src/` came back empty. There is one token set in `src/app/globals.css` |
| 39 | Walk Every Page | Page-by-page live/designed audit that fixes the backend, never the template | N/A | Process step |
| 40 | It Comes Back By Itself | systemd --user unit, `Restart=always`, linger | PARTIAL | Windows launchers `Start Agent OS.bat` / `Restart Agent OS.bat` are run by the owner. No auto-restart on crash found |
| 41 | One Way To Restart It | Restart script that finds the real port owner and proves the new PID differs from the old | HAVE | `agentos-restart.ps1` aborts when a process survives on 3737 (`AGENTS.md`, "Running it"). I did not verify a before/after PID comparison |
| 42 | Reachable Only By You | `tailscale serve` on an explicit port, funnel explained | HAVE | `AGENTS.md`: `tailscale serve --bg 3737`, which the owner runs |
| 43 | A Lock On The Door | Optional token gate for page and API. Header, bearer, cookie or `?k=` link. Query string redacted in logs | HAVE | `src/proxy.ts` (password and session cookie on every route), `agentos-password.ps1` |
| 44 | History | git with a careful .gitignore and `.gitkeep`, self-contained clone test | HAVE | This repo |
| 45 | Keep A Copy | Nightly hard-linked snapshots with restore.sh, SQLite backup API, keep 30 | MISSING | No backup/restore script in `scripts/` or the repo root |
| 46 | Preset Roles | 14-role library (Research, Writer, Developer, Brand Designer, Finance, Marketing, Product, Projects, Recruiter, SDR, SEO, Social, Support, Video) with SOULs built from a template | PARTIAL | The harness library is data with builtins (`src/lib/v2/agents/harnesses.ts`, `HarnessLibrary.tsx`). There is no role catalogue |

**Counts:** 7 HAVE, 24 PARTIAL, 6 MISSING, 9 N/A. Total 46. Row 31 is counted as MISSING.

## 2. Candidate modules to adopt

Each slice lists its size (S/M/L), what it would extend, and any rule conflicts. The ordering is my suggestion; Yoshi decides.

### C1. Hermes Crew: roster, hire and retire (Prompts 5, 12, 13, 24, 25, 46). Size L
- Turns the read-only profiles list into a crew page:
  - Status for each profile uses one fixed vocabulary (working, active, ready, unreachable), derived from `state.db` opened read-only. A running kanban card counts as "working".
  - Hiring creates a profile through `hermes profile create`, writes a SOUL that opens with "Your name is X." (backed up first), runs one verify turn, and rolls the whole thing back if any step fails.
  - Retiring archives the profile first, then runs `hermes profile delete -y`.
- **Extends:** `src/app/api/hermes/profiles/route.ts` (add POST), `src/components/HermesProfiles.tsx`, `statusFeed.ts` vocabulary.
- **Role presets** must be editable data (rule 17): harness-style rows, not a hardcoded JSON of 14 roles.
- **Conflicts:**
  - Copying auth.json/.env into a new profile moves credential material. Do it file-to-file on the server only. The route must never return or log it: return booleans only (the "one door" rule). Strip platform tokens, as Nexora itself says.
  - "Remove" deletes a profile directory. The archive-first step plus Hermes's own `.deleted` parking roughly matches our exile rule, but never add a `rm`.

### C2. Missions with an approval gate over the Hermes board (Prompts 21, 22, 23, 28, 30). Size L
- A mission record lives in V2 SQLite as a new migration in a free phase band. It moves through planning, awaiting_approval, running, review, delivered, with plain-sentence events.
- **Approve** creates kanban cards whose parents encode the step dependencies.
- **A watcher** reads `task_runs.summary` and `deliverable.md` and moves the mission to review.
- **Accept / send back** closes the loop. The final report is filed into Pages.
- **Traffic view:** the same board data shown as handoffs.
- **Extends:** `src/app/api/agent-kanban/plan/route.ts`, `src/app/api/hermes/kanban/action/route.ts`, `src/lib/kanbanDb.ts`, `src/lib/v2/attention/` (approvals), `src/lib/v2/pages/store.ts`.
- **Conflicts:**
  - Nexora's planner silently degrades to a one-step plan when the JSON cannot be parsed (Prompt 22). Here that must fail loudly, or become an owner-chosen fallback that is labelled (rule 20).
  - Approving starts paid work, so it must stay an explicit owner action.

### C3. Agent files editor (Prompts 31, 25 team sync). Size M
- Edits SOUL.md, memories/USER.md, memories/MEMORY.md and config.yaml for each Hermes profile.
  - Refuses the save if the file's mtime changed since it was read.
  - Backs up every save (fits our exile/no-destroy rule).
  - Rejects YAML that is empty, tab-indented or has an unclosed quote.
  - Lists skills against `.bundled_manifest`, worded "not in the manifest" rather than "yours".
- **Optional:** a "The team" section synced from the roster.
- **Extends:** `HermesProfiles.tsx`, `src/lib/hermesWorkspace.ts`. Rule 16 (settings in-app) fits.
- **Conflict:** never expose `.env` or `auth.json`. Nexora excludes them too.

### C4. Host health and diagnostics (Prompt 29). Size M
- Windows equivalents of Nexora's /proc sampler: `os.cpus()` deltas, `os.freemem()`, `fs.statfs`, network counters, and top processes attributed to agents (hermes/claude/codex).
- Keeps a 24-sample history so charts are populated on open.
- The first CPU reading is null. Nexora requires this, and it matches our "never fabricate".
- **Diagnostics:** plain sentences for disk over 90%, memory over 90%, gateway down, cron ticker stale, unreadable profile.
- **Extends:** `src/app/api/vitals/route.ts`, `src/components/Vitals.tsx`.
- **Watch:** heavy process enumeration is exactly what global rule 17 warns about for agents. This is app code, not an agent probe, but keep the sampler cheap and cached.

### C5. Schedule: cron across every profile (Prompt 26). Size M
- Reads each profile's `cron/jobs.json` read-only and renders the schedule as English (the raw expression when unsure).
- **Scheduler liveness** comes from `~/.hermes/cron/ticker_heartbeat` (alive if under 300 s old). A job list beside a dead ticker is labelled as such.
- **Actions** go through `hermes cron` with the 4 guards.
- **UI wording** says "asked for" rather than "ran" (never fabricate).
- **Extends:** today this is only reachable inside the `HermesManage.tsx` iframe. Could share UI with `src/lib/v2/scheduler.ts` and `/automations`.

### C6. Hermes chat upgrades (Prompts 16, 17, 18). Size M
- Named persistent sessions per profile, server-side history, "New conversation" (forget without deleting), a thinking flag that survives reload, and attachments (first image via `--image`).
- **Uncertain:** `-c <name> --create-if-missing`, `--source` and `--image` are Nexora's claims about the Hermes CLI. Check them against the local `hermes chat --help` before building.
- **Extends:** `src/app/api/hermes/chat/route.ts`, the Hermes Chat tab.

### C7. Faces: avatars for agents and the operator (Prompts 15, 37). Size M
- A picker and upload for each agent and for the operator (png/jpg/webp checked by magic bytes, 4 MB cap), stored in our own state and never in agent files.
- Shown in `AgentAvatar.tsx`, the Sidebar, the HeroGreeting and on the Hermes 3D office seats.
- **Conflict:** Nexora's 52 portraits live inside its paid template and are not in this file. The license bars redistribution. Supply our own art.

### C8. Appearance: palette, nav layout and type switcher (Prompt 38). Size M
- `data-theme` and `data-nav-layout` on `<html>`, set per device before first paint (inline script in `src/app/layout.tsx`).
- **Extends:** the token set in `src/app/globals.css` and the `Sidebar.tsx` layout.
- Nexora gives no colour values, so the palettes must be designed here.

### C9. Fleet stats (Prompt 13). Size S-M
- Two-line hourly sparklines (you and agent), an activity heatmap in the owner's timezone, recent handoffs, and sessions over 24 h and in total.
- **Extends:** `src/app/api/fleet/runtime/route.ts`. Data comes from Hermes `state.db` (read-only) plus our run records.
- **Rule:** untracked tokens stay "not tracked" (`tokenLog.ts` convention).

### C10. Snapshots and restore (Prompt 45). Size S-M
- Nightly snapshot of `~/.agentic-os` and the V2 DB (using the SQLite backup API, not a raw copy of a WAL database), with a restore script inside each snapshot. Secrets are left out.
- **Conflict:** "keep 30, delete older" is a delete. Exile old snapshots instead, or leave pruning to the owner.

### C11. Voice cast and greeting (Prompt 20). Size S
- A Kokoro voice for each agent, a speed setting, and an auto-greet toggle in the Jarvis/Hermes gear (rule 16).
- The existing labelled-fallback design in `/api/hermes/tts` already matches rule 20. Keep it.

## 3. Aesthetics (only what the file states)

**Colour:**
- **No hex values, RGB values or colour names appear anywhere in the file.** A regex search for `#[0-9a-fA-F]{6}` came back empty. The palette cannot be reproduced from this source.
- **Palettes:** "the five names plus the one you mix yourself". It is set via `data-theme` on `<html>`, "saved per device", and "It ships on Ember" (Prompt 38). The other four names are not given.

**Navigation layouts (Prompt 38):**
- Exactly five: "full rail, icon rail, bottom dock, Executive, Editorial command".
- Set via `data-nav-layout` on `<html>`. "It ships on Editorial command, and a device that has chosen keeps its choice."

**Typography (Prompt 38):**
- There are several "type pairings". Only one face is named: **Press Baskerville**.
- Rule: "Each face is measured against the one the pages were drawn around and fitted to it, so the panels hold their height." Press Baskerville is the exception: it pushes the Cockpit headline to a third line.
- The base face the pages were drawn around is not named.

**First paint (Prompt 38):**
- Both choices are applied "before the first paint, with no flash of the old one", tested by reloading on a throttled network.

**Layout and header facts:**
- The header is "built for a first name". display_name is capped at 24 characters because "40 characters overflows it on every page" (Prompt 14).
- The header shows a greeting, a clock in the chosen timezone with a label naming the zone, and an account card (Prompt 36).
- The operator's picture "replaces the letter in the header", so the default operator avatar is a letter (Prompt 37).

**Agent faces (Prompts 13, 15, 37):**
- Every agent has a two-letter code (e.g. `EX`) and a short name ("Executor", never truncated, since "RESEAR" is called out as wrong).
- `avatar {id, url, thumb, kind:"library"}` plus a `portrait` stem such as `agent-brand-designer-classic`.
- "fifty two portraits the product ships with are inside the dashboard file". The picker has tabs (`sections`) and tiles.
- Portraits are keyed by code, and the code is frozen forever, because "a code that re-letters reassigns everyone's face".
- Faces appear on cards and in the "3D campus". Each agent has a `building` landmark (example: "Executor HQ").
- "Agent City" is the 3D view, and it needs `aliases` on every agent or it never initialises.

**Status and labels (the vocabulary is fixed):**

| Where | Exact strings |
|---|---|
| Agent status | `working, active, ready, unreachable`, with labels "Working, Active today, Ready, Unreachable" (Prompt 13) |
| Health headline | "ok, strain or needs a look" (Prompt 29) |
| Doc statuses | "Saved, From chat, In review, Delivered" (Prompt 28) |
| Schedule header | the example "LIVE 0 of 6 held" (Prompt 26) |
| Hand mode | the status "Hands live" (Prompt 35) |

- Written documents use no bold markers, no em dashes, and a blank line around every heading and list item (Prompt 23).

**Charts and motion:**
- Sparklines have two lines, "you" and "agent" (`hourly_24h` is an object). There is a heatmap (`heat`, `heat_tz`) and a fleet `failed` series (Prompt 13).
- Health charts use 24 samples at a 3 s interval for cpu/ram/disk/network. The Cockpit has "meters", and its first meter is driven by diagnostics status (Prompt 29).
- The only motion stated is the three.js campus and Hand mode's camera gestures (`index.html?holo=1` embed).
- **No animation timings, easing, glass or blur, radii, shadows or card treatments are specified.** Anything beyond the above would be invented.

## 4. Do not adopt

| Item | Prompts | Reason |
|---|---|---|
| Python stdlib server, single-HTML dashboard, systemd units | 8, 9, 34, 40 | Different stack. We are Next.js on Windows with owner-run `.bat` launchers |
| "127.0.0.1 only, never 0.0.0.0" | 3, 34, 42 | Conflicts with the deliberate LAN/Tailscale design. `src/proxy.ts` gates every route, and `tailscale serve` provides HTTPS for the mic |
| Token in a `?k=` URL | 43 | Puts a credential in a query string. Our cookie password gate already covers page and API |
| Planner that silently falls back to a one-step plan | 22 | Conflicts with "Fail loudly" and rule 20. It is only allowed if the owner chose it and it is labelled |
| ElevenLabs auto-fallback "for any reason" as the default | 20 | Only the owner-chosen, labelled form is allowed. We already have it in `/api/hermes/tts` |
| NEXORA's 52 portraits and the template itself | 15, 34, 37 | Paid template whose license forbids redistribution. The assets are not in the file anyway |
| A "designed" Integrations page with nothing behind it | 39 | A placeholder that looks live breaks "never fabricate". We already have a real `/integrations` |
| Hardcoded 14-role SOULs in code | 46 | Rule 17: personas are editable data. Adopt the list only as seed rows |
| EXECUTOR persona and interview prompts | 1, 2, 4 | Persona chatter. Jarvis is the orchestrator, and the owner's facts go through Memory V2 |
| Hand mode (MediaPipe gestures) | 35 | Low value against 26 MB of models plus camera handling. Defer unless Yoshi asks |
| Snapshot pruning by deletion | 45 | Nothing gets deleted here. Exile instead |

## 5. Issues found in our own code (outside the diff's scope)

- `src/app/api/activity/route.ts:23` gives log lines made-up timestamps (`ts: baseTs - (lines.length - i) * 200`). The time shown is the file's mtime minus 200 ms per line, not when the line was written. That looks like fabricated state. Needs a decision: show the file mtime once, or parse real timestamps.
- `src/lib/agentRoom.ts:21` says "If no cloud key is set we fall back to a local daemon". That may be an unlabelled provider fallback (rule 20 / "Fail loudly"). I have not traced whether the response labels it.
