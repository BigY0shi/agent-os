# Hermes

Route: `/hermes` · UI: `src/app/hermes/page.tsx`, `src/components/UnifiedChat.tsx`, `src/components/MiniMaxVoiceAgent.tsx`, `src/components/HermesStudio.tsx`, `src/components/HermesWorkspace.tsx`, `src/components/HermesMCPCatalog.tsx`, `src/components/HermesManage.tsx`, `src/components/HermesGoals.tsx`, `src/components/AgentRoom.tsx` · Backend: `src/app/api/hermes/` (`route.ts`, `chat`, `profiles`, `talk`, `studio`, `workspace`, `preview`, `mcp`, `dashboard`, `goals`), `src/lib/hermesStudio.ts`, `src/lib/hermesWorkspace.ts`, `src/lib/hermesMcp.ts`, `src/lib/hermesGoals.ts`

Front end for the Hermes agent CLI (`hermes`). Chat with Hermes or any of its profiles, talk to it by voice, generate media, browse its files, manage its MCP servers, open its own web dashboard, and give it long-running goals.

Oracle, News Radar and Outreach used to be Hermes tabs; they now live in Jarvis. Old links like `/hermes?tab=oracle`, `?tab=radar` and `?tab=outreach` redirect to `/jarvis?tab=...`, and `?tab=jarvis` redirects to `/jarvis`. Any other valid tab name in `?tab=` opens that tab directly.

## Tabs and controls

Pill tabs: **Chat**, **Talk**, **Studio**, **Sessions**, **Workspace**, **MCPs**, **Manage**, **Control Room**, **Goal Mode**.

### Chat

The shared chat panel, locked to Hermes.

| Control | What it does |
|---|---|
| **Profile** bar: **default** + one pill per profile | Chat as a Hermes profile from `~/.hermes/profiles/` (profiles starting with `swarm` are hidden). Each profile keeps its own thread. With no profiles, a note explains how to add them. |
| **Logged · <time>**, **Clear**, mic, **Send** / **Stop** | Same as the other chat panels: vault log link, clear with confirmation, voice input, Ctrl/Cmd+Enter to send, Esc to stop. |

### Talk

| Control | What it does |
|---|---|
| **Female**, **Male**, **Deep**, **Presenter** | MiniMax voice for replies. |
| Orb button | Starts or ends a voice call. It records your mic, stops after about 1.1 seconds of silence, transcribes, replies and speaks, then listens again. |
| Type box + send | Talk by typing instead (no mic needed). |

### Studio

| Control | What it does |
|---|---|
| **MiniMax** / **Grok** | Provider. MiniMax uses image-01, Hailuo video and speech-02-hd; Grok goes through the OpenClaw CLI (grok-imagine, grok voices). |
| **Image**, **Video**, **Voice** | What to generate. |
| Prompt box + **Generate** | Starts the job. Ctrl/Cmd+Enter also works. MiniMax video is polled every 6 seconds until done. |
| Voice pills | Shown for **Voice**: six MiniMax voices or six Grok voices. |
| **Try** chips | Fill in a sample prompt. |
| Gallery | Everything generated of that kind. |

A warning appears when MiniMax is selected but not connected.

### Sessions and Control Room

Both open the same action panel; **Sessions** starts on the Sessions action, **Control Room** on Status. The left card shows **State** (Online / Offline), **Model** and **Provider** from `/api/vitals`, refreshed every 8 seconds.

| Control | What it does |
|---|---|
| **Status** | `hermes status` |
| **Sessions** | `hermes sessions list` |
| **Skills** | `hermes skills list` |
| **Plugins** | `hermes plugins list` |
| **Kanban** | `hermes kanban list` |
| **Doctor** | `hermes doctor` |
| **Insights** | `hermes insights` |
| **refresh** | Re-runs the current action (10 second timeout). |

### Workspace

| Control | What it does |
|---|---|
| Buckets list | Fixed groups of Hermes folders: **Kimi K2.7 ✦**, **GLM 5.2 ✦**, **Grok Build ✦**, **N2 ✦**, **Fusion ✦**, **Sakana Fugu ✦** (each a profile's `workspace`), **Goal Mode**, **Apps**, **Videos**, **Images**, **Audio**, **Workspace**, **Sandboxes**, **Pastes**. Refresh icon reloads; also polls every 6 seconds. |
| File list and preview | Click a file; **Preview** / **Source** for HTML, media inline, **Copy**, close (X). |

### MCPs

| Control | What it does |
|---|---|
| **Refresh** | Reloads both lists. |
| Catalogue: **Install**, **Copy cmd**, **Source** | **Install** opens a form for the server's settings, writes any values to `~/.hermes/.env`, then runs `hermes mcp install <name>` and streams the log. **Copy cmd** copies that command. Installed entries show **Installed**. |
| **Add custom** | Form for a server outside the catalogue: preset, name, **Transport** (stdio command and args, or http URL), **Authentication** (none, oauth, header), env vars. **Add server** saves it. |
| **Enabled** / **Disabled** | Toggles the server in `~/.hermes/config.yaml`. |
| Gear icon | Edits `tools.include` to limit which tools the server exposes. **Save** writes it. |
| Trash icon | Asks for confirmation, then runs `hermes mcp remove <name>`. |

### Manage

| Control | What it does |
|---|---|
| **Refresh** | Checks the Hermes web dashboard on port 9119 and starts it (`hermes dashboard --no-open --port 9119`) if it is not running, then reloads the embed. |
| **Open in tab** | Opens `http://localhost:9119` directly (useful if the embed asks you to log in). |
| **Try again** | Shown on error; same as Refresh. |

### Goal Mode

| Control | What it does |
|---|---|
| Title, prompt, **Launch goal** | Starts `hermes chat -q "<prompt>" -Q --yolo --accept-hooks --max-turns 50 --checkpoints` in the background. Ctrl/Cmd+Enter launches. |
| **refresh** | Reloads the goal list. It also polls the list, the open log and its files every 5 seconds while the page is visible (the log footer says 3.5s, which is out of date). |
| Stop / Delete icons | Stop a running goal; delete a goal and its log (with confirmation). |
| **Live log** / **Output files** | The goal's log, or the files in its folder with preview. **Open full log**, **Open**, **Save**. |

## How it works

- **Chat** runs `hermes [--profile <name>] -z "<prompt>" --yolo --accept-hooks` with a 6 minute timeout. The last 24 turns are packed into the prompt. Threads live in browser localStorage (`agentic-os-chat-v2:hermes` or `...:hermes:<profile>`) and replies are appended to the Obsidian vault.
- **Talk** transcribes through `/api/openclaw/studio/stt`, which runs `openclaw infer audio transcribe` with `xai/grok-stt` (no other provider is tried; an empty transcript is an error that says so); it needs `ffmpeg`. Replies come from MiniMax-M3 and are voiced with MiniMax speech-02-turbo, as the header says.
- MiniMax features read the OAuth token from `~/.hermes/profiles/<active profile>/auth.json`; connect with `hermes auth add minimax-oauth`. Studio saves to `~/.hermes/images`, `~/.hermes/videos` and the active profile's `audio_cache`.
- Goals are stored in `~/.agentic-os/hermes-goals.json`, logs in `~/.agentic-os/hermes-goal-logs/`, and each goal runs in `~/.hermes/goals/<id>/`.
- The MCP catalogue is read from `~/.hermes/hermes-agent/optional-mcps/`. The header text still says install "lands in Phase 2", though the **Install** button works.
- Needs the `hermes` CLI, found via `AGENTIC_OS_HERMES_BIN`, the config file, or the PATH.
