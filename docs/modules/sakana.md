# Sakana Fugu

Route: `/sakana` · UI: `src/components/SakanaView.tsx` · Backend: `src/app/api/sakana/chat/route.ts`, `src/app/api/sakana/history/route.ts`, `src/app/api/hermes/workspace/`, `src/app/api/hermes/preview/`, `src/lib/hermesWorkspace.ts`

A chat window for Sakana AI's Fugu Ultra model (`fugu-ultra-20260615`), called directly over Sakana's HTTPS API. The page presents Fugu as a panel of models with a judge, and is built around asking one hard question and waiting for a verdict. A second tab shows files in the Hermes `sakana-fugu` profile's workspace.

## Tabs and controls

Two tabs in the header: **Boardroom** and **Workspace** (with a file count once files are loaded).

### Boardroom

| Control | What it does |
|---|---|
| Preset chips: **SEO content council**, **Title + thumbnail brain**, **Fact-check**, **Deep research**, **Red-team my offer** | Put a prompt template in the box, with a placeholder such as `[KEYWORD]` or `[TOPIC]` to fill in. |
| Message box | Enter sends, Shift+Enter adds a new line. |
| **Convene** | Sends the prompt and the prior turns to `/api/sakana/chat` and streams the reply. |
| **Stop** | Aborts the request. |
| Trash icon ("Clear history") | Asks for confirmation (the dialog says "Clear Sakana history?"), then empties the thread in the browser and on disk. |

While waiting, a status card shows the real elapsed time and a status line that follows what the route reports: "Sending your question to Sakana" until Sakana answers, then "Sakana accepted it. Waiting for the answer to start" (the route sends `{"t":"status","s":"accepted"}` after the 200). Sakana does not report which models are on the panel or how far along they are, so the card does not show either. Once text arrives it streams under "Answer streaming".

### Workspace

| Control | What it does |
|---|---|
| **Sakana Fugu builds** list | Files in `~/.hermes/profiles/sakana-fugu/workspace/`, read through the Hermes workspace API (bucket `sakana-fugu`). Loaded when you open the tab. |
| Refresh icon | Reloads the file list. |
| File entry | Opens it in the preview pane. |
| **preview** / **source** | For HTML files: render in a sandboxed iframe, or show source. |
| Open-in-new-tab icon | Opens the file through `/api/hermes/preview/sakana-fugu/<path>`. |
| **download** | Shown for binary files. |

Images, video and audio play inline; other text files show as source.

## How it works

- `/api/sakana/chat` posts to `https://api.sakana.ai/v1/chat/completions` with `stream: true`. It sends a fixed system prompt (be decisive, flag disagreement or unverified claims), the last 16 turns as chat messages, and your prompt. The route allows up to 300 seconds; the page says 30 to 90 seconds is normal.
- The API key is read from `SAKANA_API_KEY` in the environment, or from `SAKANA_API_KEY=` in `~/.hermes/profiles/sakana-fugu/.env`, `~/.hermes/profiles/sakana/.env` or `~/.hermes/.env`, in that order. With no key, the reply says "No Sakana key found".
- The thread is kept in browser localStorage (`agentic-os/sakana/history/v1`) and also saved on every change to `~/.hermes/profiles/sakana-fugu/chat-history.json` (last 200 messages), so it survives a browser clear and shows up on other devices. On load the page shows the local copy first, then replaces it with the server copy if that is not empty.
- This page does not write files itself. The Workspace tab only shows what other tools (for example a Hermes chat on the `sakana-fugu` profile) put in that folder.
- The header tagline includes "#1 on goldiebench"; that is fixed text in the page.
