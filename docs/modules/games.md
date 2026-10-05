# Game Studio

Route: `/games` · UI: `src/components/GameStudio.tsx` · Backend: `src/app/api/games/commission/route.ts`, plus `/api/freeclaude/workspace`, `/api/freeclaude/preview/...` and `/api/hermes/kanban/board`

Describe a browser game in a sentence and an agent builds it as a single self-contained HTML file. Finished games land on a shelf where you can play them in the page.

## Tabs and controls

One page: the commission box, the in-progress list, the shelf, and a play window.

| Control | What it does |
|---|---|
| **Commission the Game Agent** box | "Describe a game..." Enter commissions it. Limit 1200 characters. The label beside it reads "Claude 5 brain · single-file games · no libraries". |
| **Build with** | Who builds it. **Hermes game-dev (team)** (default) or one of your installed CLI agents. |
| **Build it** | Posts the prompt and chosen agent to `/api/games/commission`. A green note then says the agent is on it and names the file, or shows the error. |
| **IN THE WORKSHOP** | Open tasks (not done or archived) on the Hermes `game-studio` kanban board, with their status. Running tasks pulse. Only shown when there are some. |
| **The Shelf** | Every `.html` file in the games folder, newest first, with a live thumbnail (loaded only while on screen), a title made from the file name, and its age. Click a tile to play. |
| Play window | The game in a sandboxed iframe (pointer lock, autoplay, fullscreen and gamepad allowed). **Open full** opens it in a new tab. The X or a click outside closes it. |

The page refreshes the shelf and the workshop list every 12 seconds.

## How it works

- The output file name is a slug of your prompt, for example `neon-snake-that-grows.html`. A fixed build spec is added to every prompt: one playable HTML file, no external libraries or assets, keyboard and touch controls, score, difficulty ramp, start and game-over screens.
- **CLI agent path** (Claude, Codex, Cursor, Pi, Hermes, Antigravity): the route calls the CLI directly with your own login, waits up to about 280 seconds, checks that real HTML came back, and writes it to `<FreeClaude scratch root>/games/<slug>.html` (`~/freeclaude-scratch` unless `AGENTIC_OS_FCC_SCRATCH` is set), the same folder the shelf reads. The game appears on the shelf when the request returns.
- **Hermes game-dev (team) path**: the route creates a task on the Hermes `game-studio` board with `hermes kanban create ... --assignee game-dev --workspace dir:<games folder>`, then runs the dispatcher once. A Hermes worker on the `game-dev` profile builds the game in the background and writes the file itself. This needs Hermes installed with a `game-dev` profile.
- The shelf reads the `games` project through the FreeClaude workspace routes, whose root is `~/freeclaude-scratch` (or `AGENTIC_OS_FCC_SCRATCH` if set). Games are served from `/api/freeclaude/preview/games/<file>`.
- There is no delete or rename control on this page.
