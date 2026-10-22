# Local

Route: `/local` · UI: `src/components/LocalView.tsx` · Backend: `src/lib/localModel.ts`, `src/lib/localBuilds.ts`, `src/app/api/local/`

A chat with a model running in Ollama on this machine, tuned for quick single-file builds. Ask it to build something visual and it answers with one self-contained HTML file, which the page pulls out of the reply and previews live. Nothing goes to a cloud provider.

The header shows the model that is actually answering and the last measured tokens per second.

## Tabs and controls

### Build

| Control | What it does |
|---|---|
| **Mic button** (VoiceButton) | Dictates into the message box. |
| **Hands-free** (radio icon, title "Hands-free: auto-send when you stop talking") | Toggles auto-send. When on, each finished spoken phrase is sent as soon as you pause. |
| **Message box** | Free text. Ctrl+Enter (Cmd+Enter on Mac) sends. |
| **Send** | Streams the message, plus the last 20 turns of history, to `/api/local/chat`. |
| **Stop** (shown while streaming) | Aborts the request. Text streamed so far is kept if there was any. |
| **Clear chat history** (trash icon) | Asks for confirmation, then clears the chat. Workspace builds are kept. |
| **Built: <title> - open preview** | Appears under a reply that contained HTML. Opens that build in Preview. |

### Preview

| Control | What it does |
|---|---|
| **Source** | Toggles between the rendered page and its raw HTML. |
| **Reload** (circular arrow) | Re-renders the iframe. |
| **Open in new tab** | Opens the build in a new tab from a temporary blob URL. |
| **Download .html** | Saves the build as an `.html` file named from its title. |
| **Go build something** (empty state) | Switches to the Build tab. |

When a reply contains HTML, the page switches to Preview on its own.

### Workspace

One card per build, newest first, with its title, size and the prompt that made it. The tab badge shows the count.

| Control | What it does |
|---|---|
| **Open** | Makes the build active and shows it in Preview. |
| **Tab** | Opens the build in a new browser tab. |
| **.html** | Downloads the build. |
| **Delete** (trash icon) | Removes the build from the list, and sends `DELETE /api/local/builds?id=<id>` so a server-side copy does not sync back. The server copy is moved to `local-builds/.exile/<timestamp>/`, not deleted. |

## How it works

- Chat goes to Ollama's native `/api/chat` at `127.0.0.1:11434`, streamed, with `keep_alive: "30m"` and `think: false`. A system prompt tells the model to answer build requests with one complete HTML file in a single fenced block.
- The model is chosen by `resolveModel()`: the `LOCAL_MODEL` environment variable if set, otherwise whatever model Ollama has loaded right now, otherwise an installed model whose name looks like a coder or general model, and only then a fixed fallback tag. `/api/local/model` exposes the choice for the header.
- The page extracts the largest HTML block from each reply. Code blocks are hidden from the chat bubble so it shows only the prose.
- Chat history (last 200 messages), builds (last 60) and the active build are stored in your browser's localStorage. Builds made in the chat are not written to the server.
- The Workspace also polls `/api/local/builds` every 4 seconds and merges any server-side builds, stored as HTML files plus `manifest.json` under `~/.agentic-os/local-builds` (overridable with `AGENTIC_OS_LOCAL_BUILDS`). Nothing in the app UI writes there; the route accepts `POST` from scripts.
- Needs Ollama running with at least one model installed. If Ollama is down the reply says it cannot reach `127.0.0.1:11434`.
