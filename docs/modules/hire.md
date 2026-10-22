# Hire Engine

Route: `/hire` · UI: `src/components/HireEngine.tsx` · Backend: `src/app/api/hire/`, `src/lib/hireDesk.ts`, `src/lib/hireBrief.ts`, `src/lib/hireBatch.ts`, `src/lib/hireDraft.ts`, `src/lib/hireMachines.ts`

A triage board for salaried job postings at companies hiring a person for work one of your machines already does. The pitch is to augment the hire, not replace it. It has the same Kanban and drawer shape as Deal Desk, aimed at employers instead of freelance clients.

## Tabs and controls

### Header

| Control | What it does |
|---|---|
| **Scan job boards** | Posts to `/api/hire/scrape`, which runs `hire.mjs` in the leads directory to refresh `hire-candidates.json` from remotive, jobicy and himalayas. A scan starts the brief pass automatically and the page polls it. |
| **Enrich approved** | Posts to `/api/hire/enrich`: looks up headcount and company type for Approved leads through Hunter, then starts the pitch pass for what landed. |
| **Draft approved** | Posts to `/api/hire/draft` with `all: true`: creates Gmail drafts for approved, pitched leads that have a contact email. Nothing is sent. |
| **Reload** | Re-reads the board from `/api/hire/list`. |
| **Models** | The "Hire Engine models" gear: **Triage sweep**, **Brief + pitch writer**, **Gmail draft clerk**, then **Save**. Blank uses the default model. |

### Machine strip

| Control | What it does |
|---|---|
| **CS Triage & Draft Engine**, **Speed-to-Lead Setter Engine**, **Ops Coordinator Copilot**, **Chief of Staff Co-Pilot** | One card per machine with its lead count, the role it covers, **BUILT** or **NOT BUILT**, and its price. Clicking a card filters the board to that machine; clicking it again clears the filter. |

### Board

| Control | What it does |
|---|---|
| **New**, **Researching**, **Approved**, **Sent**, **Parked** | The columns. Drag a card onto a column to change its status. Dismissed leads leave the board. |
| Card chips | Machine key, **F** (fit), **E** (ease), **W** (win), composite score, salary, company size after enrichment (**enrich ✗** when the lookup failed), **brief**, **pursue** / **skip** from triage, **pitched**, **drafted**. |
| Clicking a card | Opens the drawer. |

### Drawer

| Control | What it does |
|---|---|
| **Open the posting** | Opens the job URL in a new tab. |
| Status select ("Listing status") | new, researching, approved, sent, parked, dismissed. |
| **Dismiss** | Sets the status to dismissed and closes the drawer. |
| **Generate brief** | Shown when there is no summary yet, including on cards triage marked skip. Posts to `/api/hire/brief`. |
| **Write pitch** / **Rewrite pitch** | Posts to `/api/hire/pitch` and fills the proposal box. |
| **Proposal (editable)** | The outreach text. Saved through `/api/hire/action` when the box loses focus. |
| Contact email box + **Create Gmail draft** | Posts to `/api/hire/draft` with the lead id and address. Defaults to the Hunter contact email. Disabled until there is a pitch and an address. After success it shows "Drafted in Gmail". |
| **Notes** | Your notes. Saved when the box loses focus. |
| **Ask** | Posts your question to `/api/hire/ask`; answers stack under the box. |

The drawer also shows the project summary, company details, what the matched machine covers (and a build note when it is not built), the description, approach, crash course and fit read when they exist.

## How it works

- Data lives in the leads directory, `~/Documents/Upwork-Leads` by default (or `UPWORK_LEADS_DIR`): `hire-candidates.json` from the scanner, and your state in `hire-state.json`. The scanner itself is `hire.mjs` in that same folder, not in this repo; without it a scan fails.
- Triage, briefs and pitches shell out to the Claude CLI. The brief pass runs a cheap triage over the whole board first, then a full analysis on leads marked pursue. The page polls `/api/hire/brief-batch` for progress for up to 30 minutes.
- Enrichment calls the Hunter API with a key from `HUNTER_API_KEY` or `hunterKey` in `~/.agentic-os/outreach/config.json`. It is capped at 10 leads per run.
- Gmail drafts are created by a Claude CLI session using your Gmail MCP. They are drafts only; you review and send from Gmail.
- Pitches and status judgments are written to memory through the same seam Deal Desk uses (`src/lib/deskMemory.ts`).
