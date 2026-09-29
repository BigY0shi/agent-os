# AI Agent Mastermind

Route: `/room` · UI: `src/components/MastermindView.tsx` (wraps `src/components/GroupChatView.tsx`) · Backend: `src/app/api/room/` (`route.ts`, `status`, `history`, `personas`), `src/lib/agentRoom.ts`

A group chat with all your agents at once, where each agent is a different real model with its own personality. A round is sequential, so each agent sees what the ones before it said and they talk to each other. A left rail also gives you a private one-on-one line to any single specialist.

## Tabs and controls

### Specialists rail

| Control | What it does |
|---|---|
| Header line | "N specialists, N working now". |
| **The whole room** | Shows the group chat (below). |
| One button per specialist | Opens a one-on-one thread with that agent. Each shows one status word: **working now**, **active today**, **ready** or **unreachable**; hover shows why. The rail refreshes every 5 s. |

The specialists are Claude, Codex, Cursor, Pi, Hermes and Antigravity (run through their CLIs) and OpenClaw, Ollama and Free Claude Code (run through Ollama).

### The whole room (group chat)

| Control | What it does |
|---|---|
| **New chat** | Starts an empty conversation. |
| **New chat with Personas** | New chat where every agent role-plays a random real-world persona (NVIDIA Nemotron Personas). Shows "Casting..." while it draws. |
| **Cast** | Opens the Cast row: per agent, a dice button draws or re-draws a persona and an X drops it; **Clear all** drops every persona for this chat. |
| **Incognito ON/OFF** | Clean-room mode: agents run with no CLAUDE.md or rules, no MCP, no session history and no vault context (full for Claude, Hermes and Codex; Cursor and Antigravity only get a neutral working folder). |
| **History (N)** | Saved chats with age and message count. Click to reopen; the trash icon deletes one. "No saved chats yet." when empty. |
| **In the room** chips | Click an agent to add it to or remove it from the room. Hover shows its model. |
| Message box | "Message the room..." Tag `@claude` (or another agent) to ask only that one. With nobody in the room it asks you to add an agent first. |
| **Send** / **Stop** | Sends the message, or stops a round in progress. |

### One-on-one thread

| Control | What it does |
|---|---|
| Header | The agent, its status word and the reason. |
| Message box, **Send** | Sends to that agent alone. If it is unreachable the box says why. Tool actions it took (saved notes, pipeline ideas) appear as small system lines. |

## How it works

- `POST /api/room` takes `{ message, history, agents }` and streams one NDJSON event per step (typing, each agent's message, actions, done). One-on-one threads use the same endpoint with a single agent id.
- Unless Incognito is on, each agent gets context from your Obsidian vault: your "About Me" note, matching notes and recent memories. When you ask, an agent can save a note to the vault or add an idea to the project pipeline.
- Conversations are saved to the vault under `Agent Room/conversations` inside the Agentic OS vault folder, so they survive browser clears and show on any device. One-on-one threads are stored the same way with the id `dm-<agent>`. The browser also keeps a local cache. If no vault is found, saving returns false and only the browser copy remains.
- CLI agents need their CLI installed and signed in. Ollama agents use Ollama Cloud directly (`OLLAMA_CLOUD_HOST`, default `https://ollama.com`), falling back to a local Ollama daemon if no cloud key is set. Any agent can be repointed without code changes via `roomAgents` in `~/.agentic-os/config.json`.
- `GET /api/room/status` derives each status word from real signals: a reply in flight, a missing CLI or key, or a message saved today.
