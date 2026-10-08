# Mission Control

Route: `/` · UI: `src/components/Overview.tsx`, `src/components/v2/home/` (Cockpit, AttentionHero, HomeGrid, ScratchpadSlot, WidgetShell, WidgetPicker, WidgetConfigForm) · Backend: `src/app/api/v2/home/pulse/route.ts`, `src/app/api/v2/attention/route.ts`, `src/lib/hostHealth.ts`, `src/lib/v2/widgets/`

The home page. It greets you, shows measured telemetry for the machine and the agents, lists what needs your attention, and holds a customizable widget grid plus today's scratchpad. It has three views, picked from a tab strip under the greeting. The chosen view is remembered per browser and falls back to Cockpit.

## Tabs and controls

### Cockpit (default)

| Control | What it does |
|---|---|
| **System pulse** card | Overall status word (Optimal, Under strain, Needs a look, or Unknown), "N of M checks clear", and bars for Processor, Memory and the first disk. A value with no source reads "unknown". |
| **Runs** card | Ring with the count of recent module runs and the success rate, "running now", "average run", and a strip of the last finished runs (done, stopped, failed). Says which window it counts over. |
| **Missions** card | Queued, Running, Review and Parked counts, how many are waiting on you, and how many were delivered. **Open** goes to `/jarvis?tab=goals` (the Jarvis Missions tab). |
| **Orchestration** card | Jarvis and every configured agent under him with its mark and live status, plus CLIs with running mission seats. "No agents configured." when empty. |

| **Orchestration** card | Jarvis and every configured agent under him with its live status, plus CLIs with running mission seats. "No agents configured." when empty. |
| **Fleet stats** strip | Under the telemetry band (S36). Its header names the bucket, the window and the timezone in use. **Count again** re-reads the records now; it also refreshes every 60 s while visible. |
| **Fleet stats** gear | Opens the two settings. **Bucket**: 6 h, 12 h (twice a day, the default), 24 h or 48 h per sparkline point. **Window**: 7, 14 (default), 30 or 60 days. Both save to `fleetStats` in the runtime settings and apply on the next count, with no rebuild. The heatmap's timezone is the Tasks timezone (Tasks gear), the single timezone source. |
| **Activity over time** card | Two lines per bucket: you (purple) and agents (blue), with each line's total. Buckets start at local midnight at the window's start, so a 12 h bucket is a morning or an afternoon in your zone. "Nothing recorded in this window." when empty. The basis of each line is printed under it. |
| **When the fleet is busy** card | Weekday by hour heatmap over the window, hours in the Tasks timezone. **both** / **you** / **agents** picks whose events colour it. |
| **Recent hand-offs** card | The newest 12 mission hand-offs: who passed the step (Jarvis, or the seats of the steps it depended on), who received it (agent and role), the mission and step, and when. "No hand-offs recorded." when there are none. |
| **Sessions** card | Per source, sessions in the last 24 h and in total: Jarvis conversations, Rabbit sessions, task chats, task sessions, agent runs, module runs (the registry keeps the last 50 finished), missions and Ultracode runs. A source Agent OS keeps no record for (Hermes keeps its own state.db) reads "not tracked" and is left out of the totals; it is never shown as 0. |
| **Needs my attention** | Open attention items grouped as Urgent, Warnings and FYI. Each row has **Go** (opens the item's route), a check button ("Done, handled this occurrence") and an X button ("Dismiss, stop telling me about this"). Shows "All clear" when empty and names any collector that cannot read its source. Polls every 30 s. |
| **Customize** | Arms edit mode on the widget grid. |
| **Add widget** (edit mode) | Opens the widget catalog. A widget whose source is unavailable says "not available: <reason>". Close with the X. |
| **Cancel** (edit mode) | Restores the layout you had when you pressed Customize. |
| **Done** (edit mode) | Saves the layout now and leaves edit mode. |
| Drag a widget (edit mode) | Reorders it; the dashed strip at the end appends it. |
| Gear on a widget (edit mode) | Opens "Configure <widget>" with that widget's fields, then **Cancel** or **Save**. Only widgets with settings show it. |
| Size button (edit mode) | Cycles the widget width S, M, L. |
| X on a widget (edit mode) | Removes it from the layout. The underlying data is never deleted. |
| **Today** section, **open /today** | The daily scratchpad (see the Today module) embedded at the bottom. Hidden if `home.showScratchpad` is false in settings. |

Default widgets, in order: Mission stripe, Jarvis, Telemetry, KPI grid, Todos, Deal Desk, System map, Timeline. The catalog also offers Needs my attention, Integration activity, Pipeline / Deal Desk, Agent status, Tasks, Calendar, Newsletter and AnyNotes.

### Health

| Control | What it does |
|---|---|
| Headline and ring | "The machine is quiet and well" or the list of failing checks, with checks clear out of total. |
| **Measure again** | Re-reads everything now. It also refreshes on its own every 5 s while visible. |
| **This machine** | Host, System, Kernel, Processor, Uptime, Storage (drive count). |
| **Load, 1 / 5 / 15 min** | Load averages per core. On Windows it says none is kept. |
| **Memory** | In use and free. |
| History sparklines | Processor, Memory, Disk (system drive), Network, each tagged flat, spiky, bursty or steady ("gathering..." until enough samples). |
| **Per core** | One bar per core. |
| **Storage** | Used percentage and free space for every drive. |
| **Snapshots** | Last snapshot (when, by hand or scheduled, file count, size, how many secret files were left out), the schedule and its next run, the last scheduled run with its status, the snapshot folder with how many are kept and how many sit in `.exile`. "none yet" / "not yet" / "unknown" are said as such. |
| **Snapshot now** | Takes a snapshot immediately (`POST /api/v2/snapshots`). Reads "Taking a snapshot..." while one runs; a second request meanwhile is refused. |
| **Configure** (gear) | **Cadence** (Weekly, default; Every 2 weeks; Monthly; Off. Weekly runs Sunday 04:00, monthly on the 1st at 04:00), **Snapshot folder** (empty = `<home>/AgentOS-snapshots`; must be outside `~/.agentic-os`, a folder inside it is refused), **Keep last** (default 8; older snapshots are moved to the folder's `.exile`, never deleted), **Include secrets** (off by default). **Save** writes `settings.snapshots` and re-syncs the scheduled job at once; **Cancel** discards. |
| **Busiest processes**, **Everything** / **Agents only** | Top processes by processor and by memory. "Agents only" keeps processes named after an agent CLI (claude, hermes, codex, agy, antigravity, openclaw, ollama, cursor-agent, kimi). |
| **Diagnostics** / **Local services** | Each check with its detail, then Kokoro, Parakeet, Ollama, LM Studio (optional) and Voicebox (optional) with "ok · N ms", the error, or "not set up". |

### Scratchpad

Shows only the Today scratchpad, the same component as `/today`.

### Skills & workflows (top bar, every page)

A **Skills & workflows** button sits in the top bar on every module (`src/components/ModuleKit.tsx`). Its badge counts the skills and workflows switched on for the current module. It resolves the module from the URL; each Jarvis tab counts as its own module.

| Control | What it does |
|---|---|
| **Skills & workflows** | Opens the pop-up for the current module. Esc or **Close** shuts it. |
| Search box | Filters by name and description. |
| **Workflows** tab | Each workflow with "Runs on <agent>". The switch turns it on for this module. **Run** opens a form (with the workflow's input box if it asks for one) and **Run <name>** posts to `/api/workflows/<id>/run`; the result appears with a **Copy result** button. The run also shows in the runs tray. |
| **Skills** tab | Filters **All**, **On**, **Agent OS**, **Claude Code**, **SkillDB**. Each skill has a **here** switch (this module) and an **everywhere** switch (every module). |
| **New** tab | **Workflow** (Name, Description, Prompt with `{{input}}`, "Ask for input (optional label)", "Runs on" agent) or **Skill** (lowercase-with-hyphens Name, Description, Instructions). "Switch it on for <module>" is ticked by default. **Create workflow** / **Create skill** saves it. |

If a module's agent calls do not read skills yet, the pop-up says so: a skill switched on there is saved but has no effect. Workflows still run.

## How it works

- All cockpit and Health numbers come from `GET /api/v2/home/pulse` (`?processes=1` and `?history=1` for Health). It reads `src/lib/hostHealth.ts` (a short CPU sample, loopback-only service probes), `src/lib/hostSampler.ts` for history, the module-run registry (running runs plus the last 50 finished), mission records and the live agent status snapshot. Anything without a source is left out, never estimated.
- Fleet stats come from `GET /api/v2/home/fleet-stats` (`src/lib/v2/fleetStats/stats.ts`). You: your messages to Jarvis, Rabbit and task chats, runs you triggered (manual, crew-chat), missions you created. Agents: agent replies, agent runs, module runs, mission steps and Ultracode runs, at the moment they started. Bucket and window come from `fleetStats.bucketHours` / `fleetStats.windowDays`, the zone from `tasks.timezone`, all read per request. Every number is a stored record; an unrecorded source is "not tracked".

- Snapshots (`src/lib/v2/snapshots/`): one folder per snapshot, `<folder>/<YYYY-MM-DD_HH-mm-ss>/`, holding `agentos.db` (a consistent copy made with SQLite's backup API, never a raw copy of the live WAL database), `agentic-os/` (a copy of `~/.agentic-os`), `manifest.json` (every file with its size and sha256, what was left out and why) and `restore.ps1`. The scheduled job is `core:snapshots` on the V2 scheduler, so it also appears in Jarvis > Standing orders with "Run it now" and "Hold it" (a hold lasts until the next sync: boot, a Save in the gear, or a run). Always left out, whatever the setting: `backups/` (the nightly DB copies), `.exile/`, `agentos.lock`, `heygen-cache/` and the live database files. Left out unless **Include secrets** is on: `secrets.json`, `session-secret.json`, `principals.json`, `agentos.key` (the integrations key, so the tokens inside the DB copy stay unreadable), `ws-secret`, `rabbit.secret`, `jarvis-hotkey.secret`, `jarvis-glasses.token`, `newsletter/config.json`, `agentmail/config.json`, every `*.env`, `*.secrets.json`, `*.secret`, `*.token`, `*.key`, `*.pem`, and `browser-profiles/`; `settings.json` and `config.json` are kept with their secret fields removed (the manifest names the fields). A half-written snapshot lives under `.partial-*` and never counts as one.
- Restoring: run `restore.ps1` inside a snapshot (PowerShell). It refuses to run while something listens on 3737 (it calls the repo's `Stop Agent OS.bat` first when it can find it), asks for a typed "yes" unless `-Yes`, moves the current `~/.agentic-os` and database to `<folder>/.exile/<stamp>/before-restore/`, copies the snapshot in, carries the left-out secret files and the removed secret fields over from that exiled state so a restore does not lose today's keys, and checks every file against the manifest's sha256. `-SourceDir`, `-DbPath`, `-RepoRoot` and `-Port` override the recorded paths. Nothing is deleted.
- Attention items come from `GET /api/v2/attention`; Done and Dismiss send `PATCH {id, action}`.
- The widget layout is stored as `home.cells` in the runtime settings store (`src/lib/settings.ts`), saved 800 ms after each edit. With no saved layout the defaults render. A cell pointing at an unknown widget shows "unknown widget" instead of vanishing.
- Skills & workflows: toggles go through `/api/modules/kit` (`src/lib/moduleKit.ts`) and are stored under `skills` in settings. Skills are read from `~/.agentic-os/skills/<name>/SKILL.md`, plus `~/.claude/skills` and `~/.skilldb/skills` (read-only). Workflows live in `~/.agentic-os/workflows/workflows.json`.
