# Leads

Route: `/leads` · UI: `src/components/LeadsView.tsx`, `src/components/LeadsSettings.tsx` · Backend: `src/app/api/leads/`, `src/lib/leads.ts`, `src/lib/leadProviders.ts`

A three-step prospecting page: describe your ideal customer, find matching contacts, then enrich, dedupe, score and draft an opener for each one. Results can be copied or exported as CSV. It finds leads; Deal Desk and Hire Engine triage them.

## Tabs and controls

### Header and provider pills

| Control | What it does |
|---|---|
| **Configure** | The "Leads settings" gear. **Reasoning agent** picks the CLI agent for ICP parsing and scoring, or **OpenRouter (gemini-2.5-flash)**. **Data provider** picks **AI guess**, **CLI agent (own tools)**, **Tavily**, **Perplexity**, **Firecrawl** or **Apify**. Picking a web provider shows its key field (**Tavily API key**, **Perplexity API key**, **Firecrawl API key**, or **Apify token** plus **Apify actor**). **Save** writes them. |
| **Model: ...** pill | Shows whether a model is connected and which one. Read only. |
| **Hunter ...** / **+ Add Hunter key** | Opens the key box for Hunter.io. |
| **Apollo ...** / **+ Add Apollo key (paid)** | Opens the key box for Apollo.io. |
| Key box: **Save** | Posts the pasted key to `/api/leads/keys`. Needs at least 8 characters. |

### 1. Define your ideal customer

| Control | What it does |
|---|---|
| Brief box | Free text describing who you want. |
| Offer box | What you are offering them. |
| **Parse ICP** | Posts brief and offer to `/api/leads/icp`. The reasoning agent returns titles, industries, geos, keywords and company size, shown as chips. |

### 2. Find candidates

| Control | What it does |
|---|---|
| **AI find (no list needed)** | The default source. Uses the data provider from the gear to find companies matching the ICP, then Hunter pulls contacts. Needs a parsed ICP. |
| **Company domains** | Paste domains, one per line; Hunter returns people and emails. |
| **Paste CSV** | Paste rows with `name,company,domain,title,email`. |
| **Apollo search** | Searches Apollo from the ICP. Disabled until an Apollo key is saved. |
| **Find leads** | Posts the source, ICP, CSV and domains to `/api/leads/find`. Shows the matched companies and the candidate count. |
| **Add key** | Shown when companies were found but no Hunter key is set. Opens the Hunter key box. |

### 3. Enrich, dedupe & write outreach

| Control | What it does |
|---|---|
| **Enrich & score N** | Posts candidates to `/api/leads/enrich` (drops ones pulled before), then to `/api/leads/score`, which scores each lead 0 to 100 with a reason, an opener and an email draft. |

### Results and history

| Control | What it does |
|---|---|
| **Export CSV** | Posts the scored leads to `/api/leads/export` and downloads `leads-N.csv`. |
| **Copy outreach** | Copies the opener and email draft for one lead. |
| **Recent runs** | The last six runs: brief, scored count, source and date. |

## How it works

- Reasoning (ICP, company finding, scoring) goes through the agent chosen in the gear, default `claude`, run one-shot on your subscription. Choosing OpenRouter uses `google/gemini-2.5-flash` (or `LEADS_MODEL`) and needs `OPENROUTER_API_KEY`; without it the call fails with a message telling you to pick a CLI agent.
- Hunter and Apollo keys entered here are written as `HUNTER_API_KEY` / `APOLLO_API_KEY` to the active Hermes profile's `.env` (`~/.hermes/profiles/<active>/.env`). Tavily, Perplexity, Firecrawl and Apify keys live in `~/.agentic-os/settings.json` under `leads`.
- The **CLI agent (own tools)** provider runs the reasoning agent with its own tools. If that agent has no search or browse tool, it can only guess from memory.
- Dedupe state is `~/.agentic-os/leads.json`; the run log is `~/.agentic-os/leads-history.json`.
- Nothing is sent from this page. Outreach is copy or CSV only.
