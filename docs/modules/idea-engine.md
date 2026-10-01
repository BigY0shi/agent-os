# Idea Engine

Route: `/idea-engine` · UI: `src/components/IdeaEngineView.tsx` · Backend: `src/lib/ideaEngine.ts`, `src/lib/ideaValidation.ts`, `src/lib/ideaRadar.ts`, `src/lib/ideaDaily.ts`, `src/app/api/idea-engine/`

Validates a business idea with a multi-model council and saves the result as a dossier. You can type an idea yourself, or pick one from the Trend Radar, which scans public sources for recurring pain points and groups them into candidate topics. An optional daily run picks and validates one idea a day.

## Tabs and controls

The page is a single scroll: header, validate box, live run panel, Trend Radar, then the dossier archive.

### Header and validate box

| Control | What it does |
|---|---|
| Dossier count | "N dossiers" next to the title. |
| **Models** (gear) | Opens "Idea Engine settings" with seven fields: **Research + judge (claude)**, **Dossier writer**, **Sizing seat (Ollama Cloud)**, **Radar: reddit subs**, **Radar: seed terms**, **Daily idea (true/false)**, **Daily hour (0-23)**. Saved to the `ideaEngine` section of `~/.agentic-os/settings.json`. |
| **Idea of the Day** | Appears when today's daily run produced a dossier. Click to open it. If today's daily run spent its slot without a dossier, a grey line explains why instead. |
| Idea box | Free text. Enter submits, Shift+Enter adds a line. |
| **Validate** | Posts the idea to `/api/idea-engine/validate`. Reads **In council...** while a run is active. Only one run can be active at a time (a second one gets a 409). |

### Live run panel

| Control | What it does |
|---|---|
| Status line | "Council in session" with elapsed time and "~8-12 min typical", then "Dossier ready" or "Run failed: <reason>". |
| Seat chips | Pain evidence, Market map, Sizing, Kill-it adversary, Verdict judge, Dossier writer. The dot is grey (pending), cyan (running), green (done) or red (failed). |
| **Cancel** | Sends `DELETE /api/idea-engine/validate?id=...` and marks the run "cancelled by user". |

When a run finishes, the new dossier opens automatically.

### Trend Radar

| Control | What it does |
|---|---|
| **Scan now** | Posts to `/api/idea-engine/radar` to start a scan. Reads **Scanning sources...** while running, with one chip per source turning to a check or a cross. After a scan, a summary line shows each source's result and "+N signals". |
| Candidate cards | Grouped under New, Watching, Validating, Validated, Parked, sorted by momentum. Each shows topic, thesis, and momentum, pain and builders scores (hover a score to see its inputs) plus the signal count. |
| **Validate ↑** | Copies "<topic> - <thesis>" into the idea box and scrolls up. The candidate id is sent with the run so its board status follows it. |
| **watch** / **park** | Moves the candidate to Watching or Parked (`PATCH /api/idea-engine/radar`). |

### Dossiers

| Control | What it does |
|---|---|
| Dossier row | Verdict badge (BUILD, WATCH or PASS), title, one-liner, "opp N/10" and the date. Click to open the dossier drawer. |
| Trash icon | "Exile dossier". After a confirm, moves the dossier's JSON and Markdown to `~/.agentic-os/idea-engine/.exile/<timestamp>/`. Nothing is hard-deleted. |
| Dossier drawer | Renders the dossier Markdown. If any seat failed, an amber note lists the degraded seats ("output omitted, not faked"). The X closes it. |

## How it works

- The validation council (`ideaValidation.ts`): pain miner and market mapper run on Claude with web access, in parallel; the sizing seat runs on the gear's **Sizing seat agent** (default Claude, no web); the kill pass runs on the **Kill pass agent** (default codex, so a different lineage attacks the idea); when a seat's agent fails, the **Fallback agent** (default codex) answers and the dossier's `model_seats` records it ("codex (fallback: claude failed: ...)"), or with "none" the seat fails; the judge and the writer run on Claude. A failed seat is recorded in `provenance.degraded_seats` and its output is left out.
- Numbers without a source are dropped in code, not by the model. Radar scores are also computed in code from signal metrics.
- Radar sources: Reddit (the subs from settings), Hacker News, search autocomplete, Product Hunt, Tavily, and Google Trends. Tavily needs a key from `TAVILY_API_KEY` or `tavilyKey` in `~/.agentic-os/outreach/config.json`. Google Trends uses pytrends in its own Python venv, created on first use under `~/.agentic-os/idea-engine/venv`, so it needs Python on PATH. A failed source is marked on its chip and does not block the others. When a scan brings in 5 or more new signals, they are clustered into candidates by the **Radar clustering agent** (default Claude, then the Fallback agent); the cluster chip names who did it.
- Data lives in `~/.agentic-os/idea-engine/`: `dossiers/<id>.json` (source of truth) and `dossiers/<id>.md`, `runs/<id>.json` and `runs/<id>.jsonl` (per-seat transcript), `signals.json`, `candidates.json`, `daily.json`.
- The daily idea loop starts from `src/instrumentation.ts`. When **Daily idea** is `true`, at **Daily hour** it runs one scan and auto-validates the best new candidate. It is capped at one run per calendar day; the stamp is written before the run starts.
- The page polls the run every 4 seconds and the radar every 5 seconds while a scan runs, and it picks up a run already in flight after a reload.
