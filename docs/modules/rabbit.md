# Rabbit R1

Route: `/rabbit` · UI: `src/components/v2/rabbit/RabbitView.tsx`, `RabbitSettings.tsx` · Backend: `src/lib/v2/rabbit/`, `src/app/api/rabbit/`

A bridge that lets a Rabbit R1 handheld talk to your agents on this PC. The R1 connects to an OpenAI-style endpoint served by Agent OS, and each turn is answered by your logged-in `claude` CLI (or by a panel of room agents). This page shows what the R1 is asking right now, every past session with its transcript, and the gear holds the connection details and bridge settings.

## Tabs and controls

### Header and live strip

The header shows counts: live turns, active sessions and archived sessions.

| Control | What it does |
|---|---|
| **Archive idle** | Reads the "Archive idle after (days)" setting, asks for confirmation, then archives every active session idle for longer than that. Reports how many were archived. |
| **Configure** (gear, titled "Rabbit R1 settings") | Opens the settings panel described below. |
| **Live turn card** | One card per turn being answered right now, with model, start time and a preview. Clicking it opens that session. |

### Sessions (left pane)

| Control | What it does |
|---|---|
| **Search titles and transcripts** | Filters the list by text in titles and messages. |
| **Active** / **Archived** / **All** | Which sessions to list. |
| **Session row** | Opens the transcript. Shows the title, turn count, last activity, and a pulse icon when a turn is in flight. |

### Transcript (right pane)

| Control | What it does |
|---|---|
| **Rename** (pencil) | Prompts for a new title. |
| **Archive** / **Restore** | Archives the session, or brings an archived one back. |
| Message list | Every exchange: "R1" for the device, the model name for replies, with time, reply duration and an error mark when a turn failed. A dashed bubble shows a reply still being written. |

Header line under the title: model, when it started, last activity, token counts when known, and the client.

### Gear: Connection

| Control | What it does |
|---|---|
| **Endpoint (base URL)** + **Copy** | The address to paste into the R1's local-endpoint field. |
| **Require API key** ("Ask the R1 for an API key") | Off: the R1 connects without a key, and so can anyone who can reach the address. On: the key below must be sent. |
| **API key** field, **Reveal/Hide**, **Copy**, **Generate a short random key** | Type your own key (4+ characters, no spaces) or generate one. |
| **Save key** | Saves a typed key. Enabled only when it differs from the stored one. |

### Gear: Bridge

| Control | What it does |
|---|---|
| **Bridge enabled** ("Serve /api/rabbit/v1 to the R1") | Kill switch. Off answers every R1 request with 503. Saves immediately. |
| **Default model** | Used when the R1 sends no model or `agentos-claude`. Options include `agentos-claude`, `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001` and `agentos-mastermind`. |
| **Persona (system prompt)** | Prefix for every turn. Empty uses the built-in R1 persona. |
| **History turns** | How many earlier turns are packed into each call (0 to 200, default 24). |
| **Session gap (minutes)** | After this long a message starts a new session (default 120). |
| **Archive idle after (days)** | Threshold for **Archive idle** (default 30). |
| **Save** | Saves persona, history turns, gap and archive days. |

### Gear: Mastermind panel

| Control | What it does |
|---|---|
| **Who answers** (one checkbox per room agent) | Agents that answer when the R1 picks `agentos-mastermind`. Default claude, codex and cursor. @mention one in a message to hear only that one. |
| **Round order** ("Agents build on each other (sequential)") | Sequential: each agent sees the previous answer, slower. Off: all answer at once. |

### Gear: R1 Creation

| Control | What it does |
|---|---|
| **Public address of this box** + **Save** | The HTTPS address the R1 uses from outside your network. Empty uses the address you opened the page at. |
| **Install on the R1** (QR code) | Scan with the R1 camera to install the Agent OS Creation (`/rabbit-creation/index.html`) with the key already filled in. |
| Install URL + **Copy install URL** | The same link as text. A red warning appears when the address is not a local one and the key is off. |

## How it works

- The R1 talks to `/api/rabbit/v1/*`: `models`, `chat/completions`, `stt`, `tts` and session routes. Each chat turn runs one `claude -p` call with your CLI login, so it bills your subscription, not an API key. `agentos-mastermind` is answered by the room agents from `/api/room` instead.
- Speech: `stt` uses the local Parakeet server and `tts` uses the local Kokoro server on port 8880. Both always require the key.
- Sessions and messages are stored in the V2 SQLite database (`rabbit_sessions`, `rabbit_messages`). The key lives at `~/.agentic-os/rabbit.secret` and bridge activity is logged to `~/.agentic-os/rabbit.log`. Other settings live in `settings.rabbit` and apply on the next turn with no restart.
- The page and the open transcript poll every 4 seconds.
- Reaching the bridge from outside home needs an HTTPS front such as Tailscale. Keep **Require API key** on for any public address.
