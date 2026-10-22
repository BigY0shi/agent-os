# Ollama Cloud

Route: `/ollama` · UI: `src/components/OllamaView.tsx` · Backend: `src/app/api/ollama/chat/route.ts`, `src/app/api/ollama/models/route.ts`

A chat window for models hosted on Ollama Cloud (ollama.com). It talks to the Ollama Cloud API directly over HTTPS, so no CLI and no local GPU are involved.

## Tabs and controls

The page has a single chat panel, no tabs. The header shows how many models your account lists.

| Control | What it does |
|---|---|
| **Configure** (gear, "Ollama settings") | The one place for everything Ollama, shared by this page, the Room, Brainstorm, the Loop judge, Memory, Agents and Free Claude Code. **Ollama Cloud key**: your ollama.com key, stored write-only (it shows as its first 5 characters + `********` and a save of that mask keeps the stored key). **Ollama Cloud host** (blank = `OLLAMA_CLOUD_HOST`, else `https://ollama.com`). **Default model**: used when a page sends no model (this chat, else `qwen3-coder:480b`; a Room agent on auto when no preference matches, else your account's first model; blank = `OLLAMA_CLOUD_MODEL`). **Local Ollama URL** for Memory, the Agents ollama provider and Free Claude Code (blank = `OLLAMA_URL`, else `http://127.0.0.1:11434`; Pipeline keeps its own URL in its gear). A saved value wins over the environment variable; each change applies to the next call. |
| Model dropdown (top right) | Lists the models returned by `/api/ollama/models`. A preferred set comes first when present (`qwen3-coder:480b`, `qwen3-coder-next`, `kimi-k2.7-code`, `deepseek-v4-pro`, `glm-5.2`, `gpt-oss:120b`), then the rest alphabetically. Shows an error line if the list could not be loaded. Your choice is remembered. |
| Message box | Type a prompt. Ctrl/Cmd+Enter sends. |
| **Send** | Streams a reply from the selected model. While it waits, the bubble reads "<model> is thinking...". |
| **Stop** | Aborts the request. |
| Trash icon ("Clear history") | Shown once there are messages. Asks for confirmation, then empties the thread. |

Errors show as a red note under the messages, with a hint for a rejected key (401) or a model your account does not have (404).

## How it works

- `/api/ollama/models` calls `GET <host>/api/tags` and `/api/ollama/chat` calls `POST <host>/api/chat` with `stream: true`. The host is the gear's **Ollama Cloud host**, else `OLLAMA_CLOUD_HOST`, else `https://ollama.com`.
- The key, host, default model and local URL are read per request from `settings.ollama` through `src/lib/ollamaCloud.ts`, with the environment (`OLLAMA_API_KEY` or `OLLAMA_CLOUD_KEY`, `OLLAMA_CLOUD_HOST`, `OLLAMA_CLOUD_MODEL`, `OLLAMA_URL`) as the fallback for each blank field. The key never leaves the server: `/api/settings` masks it and no API returns it. Without a key, the model list reports "No Ollama Cloud key: add it in the gear, or set OLLAMA_API_KEY." and a send fails with the same advice.
- If no model is sent, the route uses the gear's **Default model**, else `OLLAMA_CLOUD_MODEL`, else `qwen3-coder:480b`. When the account's model list loads, the page switches to the first listed model if the saved one is not on it.
- Each request carries a short fixed system prompt ("be concise, return complete self-contained code when building") plus the last 24 turns as real chat messages.
- The thread and the chosen model are stored in browser localStorage (`agentic-os/ollama-cloud/history/v1`, last 200 messages; `agentic-os/ollama-cloud/model/v1`). Nothing is written to disk or to the Obsidian vault.
