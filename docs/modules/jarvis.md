# Jarvis

Route: `/jarvis` · UI: `src/components/jarvis/JarvisHub.tsx` and its tab components (`JarvisView.tsx`, `jarvis/VoiceTab.tsx`, `OracleView.tsx`, `NewsView.tsx`, `HermesOutreach.tsx`, `jarvis/SessionsTab.tsx`, `jarvis/MissionsTab.tsx`, `jarvis/CrewTab.tsx`, `jarvis/FilesTab.tsx`, `jarvis/StandingOrdersTab.tsx`, `jarvis/ArchiveTab.tsx`, `jarvis/McpTab.tsx`, `jarvis/ControlRoomTab.tsx`) · Backend: `src/lib/v2/jarvis/`, `src/app/api/v2/jarvis/`, `src/lib/v2/missions/`, `src/lib/oracle.ts`, `src/lib/newsDigest.ts`, `src/lib/outreach.ts`

Jarvis is the resident orchestrator agent. The page is a tab bar; the active tab is kept in `?tab=` so links and Jarvis himself can deep-link (no `?tab=` means Console).

## Tabs and controls

### Console

| Control | What it does |
|---|---|
| Face ("Tap to talk") | Starts or stops listening. The phase label shows ONLINE, LISTENING, THINKING, ACTING, SPEAKING or BUILDING. |
| **Realtime ON/OFF** | Opens the speech-to-speech panel with **GPT Realtime**, **Gemini Live** or **Kimi**. The tooltip notes GPT Realtime needs `OPENAI_API_KEY`. |
| **Live ON/OFF** | Hands-free: listens continuously. Disabled while Realtime is on. |
| **Wake word ON/OFF** | Listens for "Jarvis". Disabled while Realtime is on. |
| **Auto** / **Agent** | Auto answers fast and escalates; Agent is the full agent with tools. |
| **Briefing** | A vault-grounded rundown (suggested focus, open action items, done this week, activity, themes, worked on, on your mind, headlines). The panel has **daily** / **weekly**, a history button ("Past briefings") and a Dismiss X. |
| Reply voice select | Picks the reply voice and saves it to settings. |
| **Configure** (gear, tooltip "Jarvis models") | Sets "Kimi voice brain (Ollama Cloud)", and the models behind the hosted voice lanes: **Gemini Live model** (blank = `GEMINI_LIVE_MODEL`, else `gemini-live-2.5-flash-preview`), **GPT Realtime model** (`gpt-realtime`), **GPT Realtime transcription model** (`gpt-4o-mini-transcribe`) and **OpenAI reply voice model** (`gpt-4o-mini-tts`). Saved to `settings.jarvis` and used by the next session or reply. |
| **Wall mode** | Full-screen HUD; Esc exits. |
| Text box, **Send** | Type any time and press Enter. |
| Built with Hermes-Jarvis | Gallery of pages Jarvis built; each opens in a preview. |

### Voice

| Control | What it does |
|---|---|
| Dial, **Previous** / **Next**, arrow keys | Picks who you talk to: Jarvis, Oracle, Mastermind specialists and crew agents. Saying "talk to <name>" also switches. |
| **Hold to talk** (or hold Space) | Records through Parakeet while held, sends on release. |
| **Replies spoken** / **Replies muted** | Speaks replies through Kokoro, or not. |
| Prompt chips, text box, **Send** | Typed messages to the same agent. |

### Oracle

| Control | What it does |
|---|---|
| Question box, **Consult the Oracle** (Ctrl/Cmd + Enter) | Runs the chosen CLI agent autonomously for counsel, not lookups. |
| **Voice** picker | Which CLI agent answers. |
| Gear ("The Oracle's voice") | **Voice engine** (Kokoro, the local default; ElevenLabs; or Voicebox, marked retired), **Kokoro voice** (Lewis by default; George is Jarvis's), **If Kokoro fails** / **If Voicebox fails** (the ElevenLabs voice below, labelled, or silence), **ElevenLabs voice**. |
| **Read aloud** / **Stop**, **Ask again** | Speak the answer, or clear it. |
| **Past counsel** | Reopens earlier consultations. |

### News Radar

| Control | What it does |
|---|---|
| Topic box, **What's new?**, example chips | Fans out your installed CLI agents (Claude, Codex, Cursor, Hermes) as web scouts, then a manager summarizes. |
| **summarize with** | Claude or Ollama (local). |
| **Read** | Opens a story's link. |
| **Past briefings** | Reopens earlier digests. |

### Outreach

| Control | What it does |
|---|---|
| **Dashboard**, **Leads**, **Campaigns**, **Sent**, **Inbox** | Sub-views. |
| **Emails hidden** / **Emails shown** | Presenter mode masks addresses. |
| Cog ("Settings & API keys"), **Refresh** | Settings view, reload. |
| **Find + enrich**, **Add**, **Enrich missing**, **Validate addresses** | Find leads by search, paste leads, fill emails, MX/SMTP-check addresses. |
| Status filters, **Hiding big companies**, **Select all**, **Delete selected**, **Delete all in view** | Lead list tools. |
| **Create campaign**, **Select all valid**, **Create drafts**, **Send batch**, **Pause** / **Activate** | Campaign builder and runs. |
| **Reset breaker**, **Paused · resume** | Clear the bounce circuit breaker, resume sending. |
| Settings: Hunter.io and Firecrawl keys, **Pause all** / **Resume**, **Daily send cap** | Keys are write-only; a Backends list shows what is configured. |

### Sessions

| Control | What it does |
|---|---|
| Search, **live** / **archived** / **all** | Finds conversations by title and message text. |
| **Resume in Console**, **Resume in overlay** | Continue the conversation. |
| **Rename**, **Archive**, **Restore** | Archive only hides; Restore brings it back. |

### Missions

| Control | What it does |
|---|---|
| **Desk** / **Board** | Desk: in-focus mission, your desk, stage columns. Board: waiting on you, a ring by state (In flight, Review, Blocked, Delivered), delivered list. |
| **New mission** | Three steps: the brief (Name, Objective, success, Priority, Target date), the crew (**Jarvis picks the team** or **I'll choose**, **Add crew member**), limits (Time limit, Maximum steps, Report length, **Send me the result to review first** / **Deliver it**). **Create and plan**. |
| **Approve plan**, **Accept result**, **Send back**, **Plan again**, **Stop the mission** | Mission decisions. Nothing runs until you approve. |
| **Answer**, **Raw output** | A step's final answer or live log. |
| **Allow** / **Deny**, reply box | Answers agents' approval requests and questions. |

### Crew

| Control | What it does |
|---|---|
| **Deploy agent** | Wizard: pick a prepared role or **Write your own**, Name, Role, Instructions, a tier (fast, standard, deep), then **Deploy** (posts to `/api/agents`). |
| Agent City, ring, **Roster** | Pick an agent to open its chat. |
| Chat box, **Send** | Starts a real run of that agent. |
| **When the crew speaks** | Heatmap, **24h** / **7d**, **both** / **you** / **agents**. |

### Files

| Control | What it does |
|---|---|
| Agents list, file list | Jarvis persona, Hermes, each agent's folder, skills. |
| **Edit...**, **I understand, let me edit** / **Just read it** | Files that shape an agent open read-only until you choose to edit them. |
| **Save** | Refused if the file changed since you opened it; then **Copy my text** or **Load the current file**. |

### Standing orders

| Control | What it does |
|---|---|
| **All** / **Live** / **Held** | Filters every recurring job (tasks, agent schedules, system jobs). |
| **Run it now**, **Hold it**, **Let it run**, **Take it off** | Act through the owning system (`POST /api/v2/standing`); Take it off asks to confirm. |

### Archive

| Control | What it does |
|---|---|
| **Re-read**, search, source filters | Mission reports, steps, Oracle, News Radar, Deal Desk and Hire Engine pitches, Jarvis conversations, Brainstorm briefs. Read-only, read in place. |

### MCP

| Control | What it does |
|---|---|
| **Installed**, **Claude Code & Hermes**, **Available** | Jarvis's servers and built-in tools; other tools' servers (read-only); the Hermes catalogue. |
| **Reload**, **Add a server**, **Add to Jarvis** | Wizard: Name, Transport, URL or Program and Arguments, headers or environment variables. Servers are added switched off. |
| On/off switch, **Turn it on**, Retire button, **Restore (off)** | Turning on shows a warning first. |

### Control Room

| Control | What it does |
|---|---|
| **Status** | Overall word, processor, memory, storage, local services, checks; **Measure again**. |
| **Skills & workflows** | Every module as a matrix of checkboxes, plus an **Everywhere** row; **Skills** / **Workflows**, filter. |
| **Plugins** | Claude Code plugins on/off (applies from the next session). |
| **Insights** | Runs by module, agents, skills in use. |
| **Settings** | Each settings block as JSON; **Save <block>**, **Open <module>**. Secrets are masked. |

### Orb chat and hotkey

The orb (bottom right of every page) opens the chat overlay. Its gear holds the voice and hotkey settings (`settings.jarvis.voice` and `settings.jarvis.hotkey`).

| Control | What it does |
|---|---|
| Mic button (hold or click, per **Hold to talk**) | Records into the text box at the cursor. Release stops; nothing is sent unless **Auto-send on release** is on. Unchanged by the hotkey. |
| Text box, **Send**, Enter | Sends. Esc discards the draft and closes. |
| **In-app keybind** | The mapped key also works when an Agent OS tab has focus, with or without the helper. |
| **Key** | The mapped key, as a `KeyboardEvent.key` and AutoHotkey key name: `F13` by default; `F13` to `F24`, `F9`, `CapsLock`. The helper re-reads it within 30 s. |
| **Mode** | **hold to talk** (default): holding the key opens the chat if closed, fronts the page and starts the mic; releasing stops it. **press to open**: a press only opens the chat (the behaviour before push-to-talk). |
| **Send on release** | On (default): releasing the key sends what you said and the reply is read aloud. Off: releasing only stops the mic; Enter sends. The mouse mic button follows **Auto-send on release** instead. |
| **OS-global helper install** | Opens `/api/jarvis/hotkey/setup`, which writes the shared secret and returns the AutoHotkey v2 helper script with install steps. The status line shows whether the secret exists and when the helper last fired. |

How the hotkey works: the AutoHotkey helper (`scripts/v2/jarvis-hotkey.ahk`) posts key down and key up to `POST /api/jarvis/hotkey` with the shared secret; the page receives them over `/api/jarvis/hotkey/stream`. The helper asks `GET /api/jarvis/hotkey/config` (secret-gated, returns the key and mode only) at start and every 30 s, so the gear is the one place to change the key. The helper assumes Agent OS on `http://127.0.0.1:3737`; only edit its `AppUrl` line if yours is elsewhere. With no Agent OS tab connected, a press opens one with `?jarvis=1`; the release of that first hold is lost because the page was not connected yet, so hold again.

Mini USB keyboards and F13 to F24: most keyboards have no F13 key, which is what makes F13 to F24 ideal: nothing else uses them. Map a spare key on a macro pad or mini USB keyboard to one of them with the keyboard's own tool (VIA, QMK, the vendor app), type that name into **Key**, and the helper picks it up. Without such a tool, `CapsLock` or `F9` works too; when the key is `CapsLock` the helper parks the caps state so it stops toggling.

Browser limits, stated honestly: the helper fronts the browser window, but it cannot pick the tab, so the Agent OS tab must be the active tab in that window. The mic starts in a window that was just fronted only if mic permission is already granted for the site (allow it once from the address bar; over Tailscale the site must be HTTPS, see the start page). The reply plays only if you have clicked in that tab since it loaded, a browser autoplay rule; a tab that was never touched stays silent and the text still arrives. Nothing in Agent OS can lift these; the gear says so.

## How it works

- The brain is `POST /api/v2/jarvis/ask` (`src/lib/v2/jarvis/brain.ts`). Engine `sdk` (default) runs one Claude Agent SDK session with tools; engine `cli` is answer-only. Conversations are stored in the SQLite DB at `~/.agentic-os/agentos.db`.
- Voice: Parakeet for dictation, Kokoro for replies via `/api/hermes/tts`.
- Missions live in `~/.agentic-os/missions/<id>/`; each seat works in its own scratch folder.
- Oracle keeps consultations in `~/.agentic-os/oracle`, News Radar in `~/.agentic-os/news`, Outreach in `~/.agentic-os/outreach/`, Jarvis MCP servers in `~/.agentic-os/jarvis/mcp-servers.json`. File saves keep the previous version in `~/.agentic-os/file-versions/`.
