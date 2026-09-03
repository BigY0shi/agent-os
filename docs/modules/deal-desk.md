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

**Where leads live:** `~/Documents/Upwork-Leads` by default, overridable with `UPWORK_LEADS_DIR`. The state file is overridable with `AGENTIC_OS_DESK`.

**The state file is rotated, never overwritten.** A write creates a new file, renames the current one aside as `upwork-desk_prev.json`, then renames the new one into place. So there are always two files: the live board and the last good one. If the live file is ever unreadable, Deal Desk falls back to the previous generation and says so on the server console, rather than reporting an unreadable board as an empty one. A damaged file is parked as `upwork-desk_corrupt_<stamp>.json` and never deleted.

## The brief

`dealBrief.ts` generates four fields per deal through your Claude CLI:

- `summary` — what the client actually wants, in plain language
- `why` — why you are a credible fit, **or honestly why you are not**
- `approach` — 3 to 5 bullets on how you would deliver it
- `crashCourse` — any unfamiliar tool or API named in the listing, and the single biggest gotcha

Upwork leads already get these in bulk from the offline pitch pass. RemoteOK and WeWorkRemotely leads never go through it, so without the batch route they stay blank forever. That is why `brief-batch` exists and matters more than the single-card route: clicking 248 cards individually is not a workflow.

## The verdict (S4)

Every card leads with the evaluator's own pass-or-pursue sentence, banded **pursue / maybe / pass** (`src/lib/dealDeskControl.ts`, `deriveVerdict`). The sentence is taken, in order, from a `Skip -` pitch opener, the first sentence of `why`, then the first sentence of `summary`; the band comes from the wording and falls back to the refined fit only when the text carries no readable call. The card edge colour and the first line of the drawer's summary box are that verdict. A lead nothing has assessed yet says `No written verdict yet (fit N/10)` rather than inventing one.

## The age gate (S4)

`deals.maxAgeDays` (gear, default 5) drops listings posted longer ago than that when a scrape or a feed pull lands: `board.json` and `shortlist.json` after scoring and before pitching, `feeds.json` after the pull and before the brief pass. Dropped rows are written beside the file as `<name>.dropped-<date>.json`, never discarded; undated rows are kept. Cards already on the board are not re-gated. Each card shows its age and turns amber with OLD past the gate.

## "Need more info" does work now (S4)

Turning the flag on starts a research pass as one module run: **enrich** (the gated logged-in visit; skipped in words for a feed lead or when no cookie is saved), **brief** (summary, why, approach, crash course), and **open questions** (3 to 5 things to settle before bidding, each answered from the listing or marked "Unknown - ask the client", saved as Q&A on the card). **Get more info** in the drawer runs the same pass without touching the flag. The card shows the state: researching, researched with the answer count, stopped, or the failure reason. Turning the flag off leaves whatever ran.

## Manual intake (S4)

**Paste URLs** in the header opens a box for Upwork job URLs, one per line, up to 20. Each becomes a card through the same path a scrape uses: `scripts/deals/intake-scrape.mjs` visits the page with the actor's own parser, the row is written into the actor's dataset directory, `score_board.mjs` rebuilds `board.json`, `pitch.mjs` writes the analysis, and the ids are forced into New. Anything that is not an Upwork job listing is rejected by name with the reason; a listing already on the desk is skipped and named. The login-wall gate applies. Cost: the next re-scrape purges the dataset, so an intake row leaves `board.json` unless the search finds it again (desk state survives by id, like every other row).

## The login wall (S4)

Enrichment needs a logged-in Upwork session. When a visit lands on the login page (`detectLoginWall` in `src/lib/dealDeskControl.ts`: the `/ab/account-security/login` URL, a "Log in" title, or the login-form text with none of a listing's markers), the run stops, the card at the wall and every card it never reached are flagged `needs login`, and a banner above the board offers **Open Upwork login** and **Update cookie**. Saving a fresh cookie clears every flag; a dead session flags them again on the next run.

## Deny without opening (S4)

Every pipeline card carries a tick box and a deny cross on its face. Ticking several shows a red bar above the board with **Deny N selected**, which is one `bulkStatus` write and one memory episode per card. Parked and Denied are a full-width lane under the board, each half a drop target, so nothing sits off the right edge.

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
| `POST /api/deals/action` | move a card, set status, save notes; `action: "bulkStatus"` with `ids[]` moves many in one write (bulk deny) |
| `POST /api/deals/enrichment` | the gated enrichment (S4): stops at Upwork's login wall, flags the cards it did not reach `needs login`, runs in the tray |
| `POST /api/deals/enrich` | the older, ungated enrichment; still works, superseded by `enrichment` |
| `POST /api/deals/scrape` | trigger a scrape |
| `POST /api/deals/intake` | `{ urls }`: pasted Upwork job URLs go through scrape, score, pitch and land in New (S4) |
| `POST /api/deals/research` | `{ id, steps? }`: the research pass "More info needed" fires (enrich, brief, open questions) as a module run; returns `runId` at once, the card carries the state (S4) |
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
- **An unpitched Upwork lead cannot be decided on, or remembered.** `listDeals` only surfaces board records with a matching entry in `pitches.json`, matched by URL. A board record with no pitch is invisible to the desk, so there is no card to move and nothing to record.
- **State is keyed by job UID**, so a listing that changes its title keeps your notes. A listing that changes its UID does not.
- **Recovery costs at most one generation.** `upwork-desk_prev.json` deliberately stops advancing while the live file keeps arriving damaged, on the grounds that a known-good older copy beats a newer broken one. One corruption followed by any healthy write costs one generation. Repeated back-to-back corruption loses the writes in between.
- **An empty board and a broken board now look different.** Empty is silent. Broken logs `[deal-desk]` lines to the server console naming the file it fell back to and how many deals it recovered. If you ever see an empty board with no such line, the leads directory is the place to look, not the state file.

## What reaches memory

Deal Desk writes episodes into Memory V2 through `src/lib/deskMemory.ts`, the same seam every V2 module uses (`ingestFromModule`). Hire Engine writes through the identical seam, so the two behave the same way.

Three things earn an episode:

| event | what is recorded |
|---|---|
| a judgment status: approved, denied, sent, parked | the call, the listing, and your note as the reason |
| a proposal generated by the agent | the listing plus the full proposal text |
| a Q&A answer | the question and the answer, against that listing |
| the brief, **only when the lead is approved** | what they want, why you fit, the approach, and the crash course on their stack |

Everything else is deliberately silent. `new`, `reviewing` and `dismissed` are triage motion rather than decisions, and refill dismisses in bulk, so recording them would bury the signal under the noise they exist to filter. `ready` is a staging step between approved and sent, and both ends are already recorded.

The approval gate on briefs is load-bearing rather than cautious. `brief-batch` runs one pass per un-briefed card, so recording every brief would enqueue 248 near-identical episodes off a single click on a fresh board. An approved lead is one you committed to, and its assessment is worth carrying forward; the other 240-odd are regenerable from the listing.

Episodes are grouped by listing (`sessionId` of `deal-desk-<uid>`), so recall can pull one card's whole history rather than a flat pile.

Turning it off is the global memory switch, `memory.ingestEnabled`. There is no per-desk toggle.

## Related

- `docs/modules/hire-engine.md` — the same triage shape aimed at candidates rather than clients
- `docs/modules/leads.md` — finding leads, as opposed to triaging them
