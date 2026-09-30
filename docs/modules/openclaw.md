# OpenClaw

Route: `/openclaw` · UI: `src/app/openclaw/page.tsx`, `src/components/UnifiedChat.tsx`, `src/components/OpenClawStudio.tsx`, `src/components/OpenClawWorkspace.tsx`, `src/components/AgentRoom.tsx` · Backend: `src/app/api/openclaw/` (`route.ts`, `chat`, `studio/*`, `workspace`, `preview`), `src/lib/openclawWorkspace.ts`, `src/lib/studioHistory.ts`, `src/app/api/vitals/route.ts`

Front end for the OpenClaw CLI (`openclaw`) and its gateway. Chat with an OpenClaw agent, use its xAI (Grok) tools to make images, video and speech or search X, browse everything under `~/.openclaw`, and run the CLI's status commands.

## Tabs and controls

Four pill tabs at the top: **Chat**, **Studio**, **Workspace**, **Control Room**.

### Chat

The shared chat panel, locked to OpenClaw: **Logged · <time>** (links to `/memory`), **Clear** (with confirmation), mic button, message box (Ctrl/Cmd+Enter sends, Esc stops), **Send** / **Stop**. Replies arrive in one piece; a seconds counter shows while waiting.

### Studio

Five sub-tabs: **Image**, **X-Search**, **Voice**, **Video**, **Talk**.

| Control | What it does |
|---|---|
| **Image**: Prompt, **Aspect**, **Generate** | Runs `openclaw infer image generate --model xai/grok-imagine-image` and shows the result with **New tab** and **Save**. **Your image history** below; click one to reload it and its prompt. |
| **X-Search**: Query, **Search X** | Runs `openclaw infer web search --provider grok` (limit 20) and shows Grok's answer with numbered sources. Ctrl/Cmd+Enter searches. |
| **Auto-refresh (30s)** | Re-runs the last search every 30 seconds while ticked. Every run is saved. |
| Saved searches list | Click to reopen a past search; delete asks for confirmation. |
| **Voice**: Say this, **Voice**, **Speak** | Runs `openclaw infer tts convert` with the xAI voice you pick (eve, ara, rex, sal, leo, una) and plays the MP3. **Your voice history** below. |
| **Video**: Prompt, **Aspect**, **Res**, **Audio**, **Generate video** | Runs `openclaw infer video generate --model xai/grok-imagine-video` (up to 4 minutes). **Audio** is a toggle. **Your video history** below. |
| **Talk**: crab button | Starts a hands-free voice conversation: browser speech recognition listens, sends your words after about 0.9 seconds of silence, speaks the reply, then listens again. Press again to end. |
| **Grok's voice** | **Browser (instant)** uses the browser's own speech; the xAI voices go through the TTS route and add a few seconds per turn. |
| **Clear conversation** | Starts a new conversation slot. The old one stays in history. |
| Saved conversations list | Click to reload a past talk (not while one is live); delete asks for confirmation. |

### Workspace

| Control | What it does |
|---|---|
| **Buckets** list | Fixed groups of folders under `~/.openclaw`: **Studio · Images**, **Studio · Videos**, **Studio · Voice**, **Apps**, **Main Workspace**, **Personal Workspace**, **Marketing Workspace**, **Skills**, **Flows**, **Canvas**. The header counts buckets with files and total files. Refresh icon reloads; it also polls every 6 seconds. |
| File list | Files in the selected bucket. Click to preview in a third column. |
| **Preview** / **Source**, **New tab**, **Copy**, **Save**, close (X) | HTML in an iframe or as source, media inline, copy text, download, close. |

### Control Room

| Control | What it does |
|---|---|
| Gateway card | From `/api/vitals` every 8 seconds: **Nominal**, **Busy**, **Degraded** or **Down**, plus agent and session counts and agent names. |
| **Health** | Runs `openclaw health`. |
| **Agents** | Runs `openclaw agents list`. |
| **Doctor** | Runs `openclaw doctor`. |
| **Logs** | Runs `openclaw logs`. |
| **Cron** | Runs `openclaw cron list`. |
| **Memory** | Runs `openclaw memory --help` (it prints the command's help, not memory contents). |
| **refresh** | Re-runs the current action. Output shows raw, with the last run time and character count. |

Each action has an 8 second timeout.

## How it works

- **Chat** posts to `/api/openclaw/chat`, which runs `openclaw agent --local --agent <id> -m "<prompt>" --json --timeout 120`. The agent is `main` unless `AGENTIC_OS_OPENCLAW_AGENT` or `openclawAgent` in `~/.agentic-os/config.json` says otherwise. The last 24 turns are packed into the prompt. The thread lives in browser localStorage (`agentic-os-chat-v2:openclaw`, last 50 messages) and replies are appended to your Obsidian vault's `Agentic OS/Memories/<date>.md`.
- **Studio** outputs are saved under `~/.openclaw/studio/` (`images/`, `videos/`, `audio/`), with saved searches in `searches/` and talks in `talks/`. Talk saves after every turn.
- Talk's replies come from `openclaw infer model run --gateway` with a short "be brief" prompt and whatever default model the agent has. The route reports the model only when OpenClaw's JSON names one (otherwise `model` is null).
- All Studio tools need the OpenClaw CLI signed in to xAI. Talk needs Chrome or Safari and microphone access.
- The Gateway card treats OpenClaw's own "degraded" flag as **Busy** unless the event-loop numbers show real delay (max over 100 ms or p99 over 50 ms).
- Needs the `openclaw` CLI, found via `AGENTIC_OS_OPENCLAW_BIN`, the config file, or the PATH.
