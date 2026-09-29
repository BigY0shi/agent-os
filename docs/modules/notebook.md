# Notebook

Route: `/notebook` · UI: `src/components/NotebookView.tsx`, `src/components/NotebookSettings.tsx` · Backend: `src/app/api/notebooklm/` (`health`, `notebooks`, `ask`, `research`, `research/import`, `studio`, `artifact/download`, `library`), `src/lib/notebooklmClient.ts`

A front end for Google NotebookLM. You can list and create notebooks, have NotebookLM's research agent find web sources and import them, ask questions answered from a notebook's sources, generate Studio outputs (audio overviews, videos, slide decks and more), and pull finished outputs down to your machine.

## Tabs and controls

A header strip shows the connection state, then five tabs: **Library**, **Research**, **Chat**, **Studio**, **Assets**. Research, Chat and Studio work on the active notebook, which you pick in Library. `?tab=<name>` and `?nb=<notebook id>` in the URL preselect both.

### Header

| Control | What it does |
|---|---|
| Status line | "checking...", then either "Authenticated · N notebooks · N saved assets · active: <name>" or "Not connected" with a pointer to `install/15-NOTEBOOKLM.md`, `nlm login` and `nlm doctor`, plus the error text. |
| **Configure** (gear) | Opens "Notebook settings": **notebooklm-mcp binary** (path override; the hint says it takes effect after a restart) and **Default notebook ID**. Saved to the `notebook` section of `~/.agentic-os/settings.json`. |
| **Refresh** | Rechecks the connection and reloads notebooks, saved assets and the active notebook's artifacts. |

### Library

| Control | What it does |
|---|---|
| **New notebook** | Asks for a title in a browser prompt, then creates the notebook in NotebookLM. |
| Notebook cards | Title, description, id and source count. Click to make it the active notebook (marked "active"). |

### Research

| Control | What it does |
|---|---|
| Query box | What to research. Ctrl/Cmd+Enter starts. |
| **Fast · ~30s** / **Deep · ~5min** | Research mode. |
| **Discover sources** | Starts a NotebookLM research task for the active notebook and polls it every 4 seconds. A status bar shows progress and "N found". |
| Source cards | Title, snippet and a link to each source found. The last research for a notebook is reloaded when you open it. |
| **Import into notebook** | Shown when research is done. Adds the found sources to the active notebook. |

### Chat

| Control | What it does |
|---|---|
| Mic | Voice input; the final transcript is added to the box. |
| Question box | "Ask anything about this notebook..." Ctrl/Cmd+Enter sends. |
| **Ask** | Sends the question to NotebookLM, which answers from the notebook's sources. |

Chat history is kept per notebook in browser localStorage (last 50 messages).

### Studio

| Control | What it does |
|---|---|
| Type buttons | **Audio Overview**, **Video**, **Slide Deck**, **Mind Map**, **Infographic**, **Flashcards**, **Quiz**, **Data Table**, **Report**. |
| Focus prompt | Optional custom instructions. |
| **Generate** | Starts the output in NotebookLM and returns right away; generation continues there (audio 2 to 10 minutes, video 5 to 15, slide deck 1 to 3, others 30 seconds to 2 minutes). |
| **Refresh** | Reloads the artifact list. |
| Artifact cards | Type, title, status and id. |
| **Pull** | Enabled when the artifact is ready. Downloads it to your machine; it then appears in Assets. |
| **View** | Opens the artifact's NotebookLM URL, when one is returned. |

### Assets

| Control | What it does |
|---|---|
| Asset cards | Everything pulled so far, with notebook name, file name, size and date, and an inline preview (audio, video, image, PDF or HTML). Other types get **Open externally**. |
| **Save** | Downloads the file. |

## How it works

- The server talks to NotebookLM through the `notebooklm-mcp` MCP server (from the `notebooklm-mcp-cli` project), started as a child process and kept as one shared client. The binary comes from the settings gear, then `config.nlmBin`, then `notebooklm-mcp` on the PATH.
- Authentication belongs to that tool: run `nlm login` in a terminal. There is no API key in this app. The full setup is in `install/15-NOTEBOOKLM.md`.
- Pulled assets are written to your Obsidian vault under `Agentic OS/Notebooks/_assets/`, or to `~/.agentic-os/notebooks/_assets/` when no vault is configured.
- Notebooks, sources and Studio outputs live in your Google NotebookLM account, not locally. Notebooks created at notebooklm.google.com show up here after a refresh.
