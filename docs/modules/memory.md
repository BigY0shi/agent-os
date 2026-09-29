# Memory

Route: `/memory` · UI: `src/components/v2/memory/MemoryView.tsx` (with `EpisodeBrowser.tsx`, `EpisodeDetail.tsx`, `EntityBrowser.tsx`, `AspectExplorer.tsx`, `LabelsManager.tsx`, `IngestLogs.tsx`, `RulesEditor.tsx`, `PersonaPanel.tsx`, `ManualIngest.tsx`, `MemorySettings.tsx`) · Backend: `src/app/api/v2/memory/`, `src/lib/v2/memory/`, `src/app/api/mcp/`

The long-term memory that the rest of Agent OS (and outside tools over MCP) reads and writes. Things to remember arrive as episodes (a conversation, a decision, a document). An LLM breaks each episode into facts about your world, entities (people, orgs, tech, concepts) and "voice" aspects (how you want things done), and keeps a persona document about you.

## Tabs and controls

### Header

| Control | What it does |
|---|---|
| Status line | Time of the last ingest, or "feed unreachable". |
| Stats strip | Counts of episodes, statements, entities, voice, labels, invalidated, and the ingest queue. Polled. |
| **Add memory** | Opens the manual ingest drawer: a text box (at least 20 characters), **File...** to load a `.md` or `.txt` file (a dropped file works too), source, session, type (conversation or document), label chips, then **Ingest**. It confirms "Queued" and points you to the Logs tab. |
| **Configure** (gear, tooltip "Memory Settings") | See Settings below. |

### Episodes

| Control | What it does |
|---|---|
| **Search episode text...** | Text search. |
| **Filters** | Shows filters for label, source, session, end user and a date range. |
| **Previous page** / **Next page** | Pages through results. |
| Episode row | Opens the episode detail: **normalized** / **original** text, labels, **Extracted facts**, **Voice aspects**, the session compact (if any), and **Exile episode...** then **Exile episode** or **Cancel**. |

### Entities

| Control | What it does |
|---|---|
| **Search entities (name + semantic)...**, type filter | Finds entities by name and meaning. |
| Entity row | Shows attributes, statements (current and previously believed) and source episodes. |

### Aspects

Cards with counts for each aspect, in two groups: **World graph** (atomic facts) and **Voice** (stored whole, never split). Click a card to list its entries.

### Labels

| Control | What it does |
|---|---|
| **New label** | Name, color and a description ("what belongs under this label (the router reads this)"), then **Create**. |
| Pencil ("Edit <label>") | Rename or recolor, then **Save**. Labels are never deleted. |

### Logs

| Control | What it does |
|---|---|
| Status filter | All, PENDING, PROCESSING, COMPLETED, FAILED. |
| **Retry** | On a FAILED row: requeues it (up to 3 times). |
| **New rule**, **Add**, active checkbox | Ingestion rules under the queue: plain-language rules that steer or veto what gets remembered, for one source or all (blank source). Rules are deactivated, never deleted. |

### Persona

| Control | What it does |
|---|---|
| **Generate persona** | Rebuilds the persona document from memory. |
| Auto-update checkbox | When on, identity, preference and directive facts update the document after each ingest. |

### Settings (Configure gear)

| Section | Controls |
|---|---|
| Models | **Provider** (who runs ingestion and search calls), **Model, low tier**, **Model, medium tier**. |
| Embeddings | **Embed provider**, **Embed model**. |
| Behavior | **Ingestion enabled** (master switch), **Session compaction**, **Persona auto-update**, **Token budget**, **Label router threshold**. |
| MCP endpoint | Shows `/api/mcp?source=<name>` and the `x-agentos-mcp-secret` header; **Copy secret** fetches the full secret on click. |
| Capabilities | Folders agents may use (**Add folder**, remove), **Exec allow**, **Exec deny (additive)**, **Browser slot**. |
| Legacy migration | Per source (.memsearch session logs, Jarvis voice memory, Agents memory, .remember notes): **Dry-run** and **Import**. |
| Legacy backfill | Episodes per run, served by, chat model, server URL, thinking budget; **Dry-run** and **Run backfill** (runs as a module run; progress is in the runs tray). |
| System | Scheduled jobs and the event feed. |

## How it works

- Everything is stored in the V2 SQLite database (`~/.agentic-os/agentos.db`). Ingestion is queued and processed in the background; progress shows in Logs.
- Every LLM call goes through `src/lib/v2/memory/llm.ts` using `settings.memory.provider` and the tier models (defaults: Ollama Cloud, `kimi-k2.6:cloud` low, `glm-5.2:cloud` medium). An empty reply is an error naming the provider and model; there is no silent fallback.
- Embeddings default to local Ollama with `nomic-embed-text`, so Ollama must be running for ingest and semantic search. Changing the embed model after data exists needs `scripts/v2/reembed.mjs`.
- Other modules feed memory too: Jarvis exchanges, scratchpad `@jarvis` replies and the nightly Today page, and finished tasks. Outside tools reach it through the MCP endpoint at `/api/mcp` with the secret header.
- Nothing is hard-deleted: exiled episodes, labels and rules are kept.
