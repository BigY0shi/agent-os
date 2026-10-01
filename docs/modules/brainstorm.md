# Brainstorm

Route: `/brainstorm` · UI: `src/components/BrainstormView.tsx` · Backend: `src/lib/brainstorm.ts`, `src/app/api/brainstorm/`

A three-seat ideation council. You give it a topic, idea or goal. Claude, ChatGPT (the codex CLI) and a Kimi model on Ollama Cloud each propose something on their own, then cross-examine each other, and Claude (as chair) writes a working project brief. Later messages in the same session steer the council and rewrite the brief.

## Tabs and controls

The page is one column with a session list on the left (shown on wide screens only).

| Control | What it does |
|---|---|
| **New session** | Clears the view so your next message starts a fresh session. |
| Session cards (left rail) | One per saved session, showing the topic, the date, and "brief ready" once a brief exists. Click to load its transcript and brief. The open session has an amber outline. |
| Seat avatars (header) | Claude, ChatGPT and Kimi. Hovering the Kimi avatar shows the model that filled the seat. The line next to them reads "three-seat council" plus "kimi seat: <model>" once resolved. |
| **Models** (gear) | Opens "Brainstorm models": **Kimi seat (Ollama Cloud)**, placeholder `kimi-k2.6`; **CLI seat time limit (seconds)** for Claude and Codex (default 240); **Kimi seat time limit (seconds)** for the Ollama Cloud call (default 180). A time limit chosen in the launch drawer still wins for that run. Saved to the `brainstorm` section of `~/.agentic-os/settings.json` and used on the next call. |
| Message box | "Topic, idea, or goal for the council..." for a new session, "Steer the council..." once a session is open. Enter sends, Shift+Enter adds a line. |
| **Convene** / **Steer** | Sends the message. The label is **Convene** with no session open and **Steer** inside one. It reads **In session...** while the council runs. |
| Phase line | While running, shows the current phase with a spinner: "Diverge - independent concepts", "Converge - cross-examination", "Steer - the council responds", "Chair synthesis". |
| Error strip | Amber list of per-seat errors (for example "Kimi: Kimi seat empty: ...") and fatal errors. |
| **Working project brief** panel | The chair's latest brief, in green. |
| **Accept brief** | Posts to `/api/brainstorm/accept`. Writes the brief as a Markdown note into your Obsidian vault under `Agentic OS/Project Briefs/<date> <topic-slug>.md` and marks the session accepted. After that the button is replaced by "Accepted · <file name>". Steering again updates the brief; the note says to Accept again to save a fresh note. |

## How it works

- `POST /api/brainstorm` streams NDJSON events (`phase`, `seat`, `msg`, `brief`, `err`, `fatal`, `done`). The first message of a session runs a diverge round, then a critique round, then the chair synthesis. Each later message runs one steer round and a re-synthesis. `GET /api/brainstorm` lists sessions; `GET /api/brainstorm?id=...` loads one.
- Claude and codex run through your own CLI logins via `cliComplete()` in `src/lib/loopEngine.ts` (no API keys). Kimi is an HTTP call to Ollama Cloud using the key and host from the Ollama Cloud page's gear (`settings.ollama`, see the Ollama Cloud doc), with `OLLAMA_API_KEY` / `OLLAMA_CLOUD_HOST` in the server environment as the fallback.
- The Kimi model is resolved live from Ollama Cloud's model list. If you set a model in the gear and it is not on your plan, the seat fails loudly rather than swapping models. If the Kimi seat cannot be filled, the council runs with two seats and says so in the error strip. If every seat fails a round, the run stops with "Every council seat failed".
- The chair synthesis is always Claude.
- Sessions are saved as JSON in `~/.agentic-os/brainstorm/<id>.json`, capped at the last 200 messages.
- Accept brief needs an Obsidian vault configured (`vaultRoot` in `~/.agentic-os/config.json`); without one it returns a 503 with that message. It also appends a line to the daily memory stream.
- A run can take several minutes (the route allows up to 600 seconds).
