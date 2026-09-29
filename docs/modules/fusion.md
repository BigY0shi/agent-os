# Fusion

Route: `/fusion` · UI: `src/components/FusionView.tsx` · Backend: `src/app/api/fusion/chat`, `src/app/api/fusion/history`, `src/lib/hermesWorkspace.ts` (the `fusion` bucket)

The Fusion Boardroom. You ask one question and it goes to OpenRouter's `openrouter/fusion` model, where a panel of models works on it with web search and a judge writes one combined answer. Use it for questions where a single model's answer is not enough. A second tab browses files the Hermes `fusion` profile has produced.

## Tabs and controls

### Boardroom

| Control | What it does |
|---|---|
| **Ask the board** | Preset chip. It has no template, so clicking it does nothing. |
| **SEO content council** | Fills the box with an SEO research template. Replace `[KEYWORD]` before sending. |
| **Title + thumbnail brain** | Fills the box with a YouTube title template. Replace `[TOPIC]`. |
| **Fact-check** | Fills the box with a fact-check template. Replace `[CLAIM]`. |
| **Deep research** | Fills the box with a deep research template. Replace `[TOPIC]`. |
| **Red-team my offer** | Fills the box with an offer critique template. Replace `[PASTE OFFER]`. |
| **Message box** | Enter sends, Shift+Enter adds a new line. |
| **Convene** | Sends the question, with the last 16 turns of history, to `/api/fusion/chat` and streams the answer. |
| **Stop** (shown while waiting) | Aborts the request. |
| **Clear history** (trash icon) | Asks "Clear Fusion history?" and then empties both the browser copy and the server copy. |

While waiting, a status card shows a timer and a status line. The status line and the model chips on it ("Opus 4.8", "Gemini 3", "Grok", "Fable 5", "+ more") are fixed text driven by the elapsed seconds. They do not report which models are really on the panel or what stage the request has reached. Once the judge starts streaming, the text appears under "Judge writing the verdict". A full answer usually takes 30 to 90 seconds.

### Workspace

| Control | What it does |
|---|---|
| **Workspace** tab | Loads the file list. The tab label shows the file count once loaded. |
| **Refresh** (circular arrows) | Re-lists the files. |
| **File row** | Opens the file in the preview pane. HTML renders live and video plays inline. |
| **preview / source** (HTML only) | Switches between the live page and its HTML. |
| **Open in new tab** (arrow icon) | Opens the file through `/api/hermes/preview/fusion/<path>`. |
| **download** (binary files) | Link to the raw file. |

## How it works

- The chat calls `https://openrouter.ai/api/v1/chat/completions` with model `openrouter/fusion` and streams the reply back to the page. It needs an OpenRouter key. The route looks for `OPENROUTER_API_KEY` in the server environment, then in `~/.hermes/profiles/fusion/.env`, then in `~/.hermes/.env`. With no key, the reply is an error telling you where to set it.
- Each request costs OpenRouter credit. The route deliberately sends no `max_tokens` cap, because a small cap makes Fusion fail.
- Chat history is saved to `~/.hermes/profiles/fusion/chat-history.json` (last 200 messages) on every change, and cached in browser localStorage. The server copy wins when the page loads, so history follows you between browsers.
- The Workspace tab reads `~/.hermes/profiles/fusion/workspace` through the shared Hermes workspace routes, one folder deep, and only lists HTML and video files. Chat answers in the Boardroom are not saved there. Files appear only when the Hermes `fusion` profile writes them.
