# SEO

Route: `/seo` · UI: `src/components/SEOView.tsx`, `src/components/SeoSettings.tsx` · Backend: `src/app/api/seo/`, `src/lib/seoPipeline.ts`, `src/lib/seoHistory.ts`

Keyword research from Google Search Console, then one CLI agent run that writes a separate article for each of your configured blog sites from a keyword and a transcript, then a build and deploy per site. The sites are your own local repos, listed in the gear.

## Tabs and controls

### Top bar

| Control | What it does |
|---|---|
| **Research**, **Generate**, **Deploy**, **History**, **Transcripts**, **Skill** | The tabs. History shows a count of logged sessions plus deploys. Generate is the default. |
| **Configure** | The "SEO settings" gear. **Generation agent** (a CLI agent, Claude by default), **Sites** (per site: label, URL, local repo dir, deploy command; trash icon removes one, **Add site** adds one), **Brand / name**, **Author byline**, **Audience**, then **Save**. |
| **Setup Guide** | Opens `/seo-guide`. |
| **SEO Pack (.zip)** | Downloads `/downloads/seo-pack.zip` (the skill, config templates and a sample transcript). |

### Research

| Control | What it does |
|---|---|
| **Google Search Console** banner | **CONNECTED** or **NOT CONNECTED** (whether the token file exists). When not connected it tells you to run `python3 ~/.agentic-os/gsc-report.py` once. |
| **Site to analyse** | Sites from the last cached GSC pull, or your configured sites' domains when there is no cache. |
| **Date range** | **Last 7 days**, **Last 28 days**, **Last 90 days**. |
| **Seed keyword (optional filter)** | Narrows the queries. Enter runs the research. |
| **Run research** | Posts to `/api/seo/research`. Scores queries (striking distance, low CTR on page 1, content gaps, high impressions) and lists topics with score, badges, impressions, clicks, CTR, position and page. With `SERPAPI_KEY` set, the top competitors are listed too. |
| **Use topic** | Copies the keyword into Generate and switches tab. |

### Generate

| Control | What it does |
|---|---|
| **Target keyword** | The keyword. It also fills the slug. |
| **File slug** | The article file name. |
| **Pick existing** / **Paste new** | Source transcript mode. |
| Transcript list + **clear selection** | Pick a saved transcript (the 40 newest). |
| Paste box + **Save & reuse** | Paste a transcript. Save & reuse posts it to `/api/seo/transcript/save` so it shows in the picker next time. |
| **Auto-deploy after generate** (toggle) | When on, every site that got a file written is deployed straight after. Remembered in this browser. |
| **Generate 5 articles** | Posts to `/api/seo/generate` and streams the agent's output into **Live generation**. It writes live files into your site repos. |
| **Stop** | Aborts the stream from the browser. |
| **Deploys** panel | Per-site status (queued, deploying, live, failed) with the live URL or the error tail. |

### Deploy

| Control | What it does |
|---|---|
| **Deploy** (per site card) | Posts to `/api/seo/deploy` for that site and streams the log. Several sites can deploy at once. Each card shows the post count, repo path and recent posts. |

### History

| Control | What it does |
|---|---|
| **Refresh** | Re-reads `/api/seo/history`. |
| **Recently deployed** | The last 12 deploys: site, when, how long, status, live and Netlify URLs, and the error tail on failure. |
| **Generate sessions** | The last 30 runs: keyword, slug, transcript source, status, and the files or live URLs written. |

### Transcripts

Every saved transcript, newest first, with date, size and a preview. Clicking one opens Generate with it selected.

### Skill

Renders the blog-post skill served by `/api/seo/skill`.

## How it works

- Sites, brand, author, audience and the generation agent live in `~/.agentic-os/settings.json` under `seo`. A fresh install has no sites. Posts go to `<repo dir>/src/blog/posts` unless a posts dir is set.
- Transcripts default to `<first site>/.claude/transcripts`, and the skill to `<first site>/.claude/skills/blog-post.md`; with no sites both fall back to `~/.agentic-os/seo/`.
- Generation spawns the chosen CLI agent (claude, codex, cursor, pi or hermes) with file-write permissions and streams its output. History is kept in `~/.agentic-os/seo-history.json`.
- Deploy runs `npx @11ty/eleventy` then `netlify deploy --prod --dir=_site` in the site's repo, so each site must be an 11ty project already linked to Netlify.
- Research runs `~/.agentic-os/gsc-research.py` with the cached read-only token `~/.agentic-os/gsc-token.json`.

## Known gaps

- The Generate heading, button and write warning count your configured sites ("Generate N articles"); past sessions show how many articles were written.
- Auto-deploy only recognises files written under five hard-coded site folders (`siteIdFromPath` in `SEOView.tsx`). For sites added in the gear, files are written but nothing is deployed automatically; use the Deploy tab.
- The per-site **Deploy command** field in the gear is saved but the deploy route does not use it yet; its placeholder says so.
- The live log and the written-file tracking parse Claude's stream-json output. With another generation agent its plain-text output is dropped by the page (only stderr and the exit code show), the History session lists no articles, and auto-deploy has nothing to act on.
- The **Save & reuse** tooltip names a fixed `~/AIProfitBoardroom.com/.claude/transcripts/` path; the route saves to the transcripts folder described above.
