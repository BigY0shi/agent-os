# Deal Desk

Route: `/deals` · Backend: `src/lib/upworkDesk.ts`, `src/lib/dealBrief.ts` · UI: `src/components/DealDesk.tsx`

A triage board for inbound job leads. It reads scraped listings, asks an agent to assess each one, and gives you a Kanban to move them through without re-reading the same posting three times.

## What it actually does

Leads arrive as files, not from an API inside this app. The scraper pipeline writes three files into the leads directory:

| file | holds |
|---|---|
| `board.json` | the scraped listings |
| `pitches.json` | bulk pitches from the offline pitch pass (Upwork only) |
| `feeds.json` | the feed sources |

Deal Desk merges those with your own per-deal state and renders the board.

**Where state lives:** `~/.agentic-os/upwork-desk.json`, keyed by the stable job UID. That key choice is the important part: status, notes, the need-info flag, your edited pitch, Q&A answers, and enrichment all survive a re-scrape. Re-running the scraper does not reset your board.

**Where leads live:** `~/Documents/Upwork-Leads` by default, overridable with `UPWORK_LEADS_DIR`.

## The brief

`dealBrief.ts` generates four fields per deal through your Claude CLI:

- `summary` — what the client actually wants, in plain language
- `why` — why you are a credible fit, **or honestly why you are not**
- `approach` — 3 to 5 bullets on how you would deliver it
- `crashCourse` — any unfamiliar tool or API named in the listing, and the single biggest gotcha

Upwork leads already get these in bulk from the offline pitch pass. RemoteOK and WeWorkRemotely leads never go through it, so without the batch route they stay blank forever. That is why `brief-batch` exists and matters more than the single-card route: clicking 248 cards individually is not a workflow.

## Setup

Nothing to install inside Agent OS. It needs two things to be useful:

1. **A leads directory with scraper output.** Point `UPWORK_LEADS_DIR` at it, or drop the files in `~/Documents/Upwork-Leads`.
2. **A working Claude CLI**, since brief generation shells out to it. No API key: it uses your logged-in subscription.

```powershell
# if your scraper writes somewhere else
$env:UPWORK_LEADS_DIR = "C:\Users\Yoshi\Documents\Upwork-Leads"
```

Open `/deals`. An empty board means the leads directory has no `board.json`, not that the module is broken.

## Routes

| route | does |
|---|---|
| `GET /api/deals/list` | the board, listings merged with your state |
| `POST /api/deals/brief` | brief one deal |
| `POST /api/deals/brief-batch` | brief every deal missing one — the one you actually use |
| `POST /api/deals/proposal` | draft a proposal for a deal |
| `POST /api/deals/ask` | ask a question about a specific listing |
| `POST /api/deals/action` | move a card, set status, save notes |
| `POST /api/deals/enrich` | pull more context onto a deal |
| `POST /api/deals/scrape` | trigger a scrape |
| `POST /api/deals/refill` | top the board back up |
| `POST /api/deals/feeds` | manage feed sources |
| `POST /api/deals/cookie` | set the session cookie the scraper needs |

## Prompts that work

The brief prompt is fixed in `dealBrief.ts` and asks for minified JSON with exactly four keys. What you steer is the **ask** route, which takes a free question about one listing:

```
This client wants "Zapier + HubSpot cleanup, 200 workflows".
What is the realistic scope here, and what would I need to see
before quoting?
```

```
They mention Snowflake and dbt. I have not used dbt.
What is the shortest path to being credible on this call, and
what should I not pretend to know?
```

For proposals, the useful steer is what to leave out:

```
Draft the proposal, but no stack list and no "I hope this finds
you well". Lead with the specific thing in their posting that
tells me they have already tried something and it broke.
```

## Gotchas

- **An empty board is a missing file, not a bug.** Check that `board.json` exists in the leads directory before debugging anything else.
- **Briefs are not free.** `brief-batch` runs one CLI call per un-briefed deal. On a fresh 248-card board that is 248 calls. The per-run spend ceiling (Agents settings) does not apply here, because this is not an agent run.
- **The `why` field is allowed to say no.** It is prompted to state honestly when you are not a fit. That is deliberate: a board where every lead looks winnable is a board you stop trusting.
- **State is keyed by job UID**, so a listing that changes its title keeps your notes. A listing that changes its UID does not.

## Related

- `docs/modules/hire-engine.md` — the same triage shape aimed at candidates rather than clients
- `docs/modules/leads.md` — finding leads, as opposed to triaging them
