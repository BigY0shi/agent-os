# Ollama Cloud

Route: `/ollama` · UI: `src/components/OllamaView.tsx` · Backend: `src/app/api/ollama/chat/route.ts`, `src/app/api/ollama/models/route.ts`

A chat window for models hosted on Ollama Cloud (ollama.com). It talks to the Ollama Cloud API directly over HTTPS, so no CLI and no local GPU are involved.

## Tabs and controls

The page has a single chat panel, no tabs. The header shows how many models your account lists.

| Control | What it does |
|---|---|
| Model dropdown (top right) | Lists the models returned by `/api/ollama/models`. A preferred set comes first when present (`qwen3-coder:480b`, `qwen3-coder-next`, `kimi-k2.7-code`, `deepseek-v4-pro`, `glm-5.2`, `gpt-oss:120b`), then the rest alphabetically. Shows an error line if the list could not be loaded. Your choice is remembered. |
| Message box | Type a prompt. Ctrl/Cmd+Enter sends. |
| **Send** | Streams a reply from the selected model. While it waits, the bubble reads "<model> is thinking...". |
| **Stop** | Aborts the request. |
| Trash icon ("Clear history") | Shown once there are messages. Asks for confirmation, then empties the thread. |

Errors show as a red note under the messages, with a hint for a rejected key (401) or a model your account does not have (404).

## How it works

- `/api/ollama/models` calls `GET <host>/api/tags` and `/api/ollama/chat` calls `POST <host>/api/chat` with `stream: true`. The host is `https://ollama.com` unless `OLLAMA_CLOUD_HOST` is set.
- The key is read from the server environment only: `OLLAMA_API_KEY`, or `OLLAMA_CLOUD_KEY`. There is no in-app setting for it. Without a key, the model list reports "No OLLAMA_API_KEY set." and a send fails with "No Ollama Cloud key. Set OLLAMA_API_KEY in .env.local, then restart the dashboard."
- If no model is sent, the route uses `OLLAMA_CLOUD_MODEL` or `qwen3-coder:480b`. When the account's model list loads, the page switches to the first listed model if the saved one is not on it.
- Each request carries a short fixed system prompt ("be concise, return complete self-contained code when building") plus the last 24 turns as real chat messages.
- The thread and the chosen model are stored in browser localStorage (`agentic-os/ollama-cloud/history/v1`, last 200 messages; `agentic-os/ollama-cloud/model/v1`). Nothing is written to disk or to the Obsidian vault.
