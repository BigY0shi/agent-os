# Newsletter

Route: `/newsletter` · UI: `src/components/v2/newsletter/NewsletterView.tsx`, `EditionReader.tsx`, `SubscriptionManager.tsx`, `NewsletterSettings.tsx` · Backend: `src/app/api/newsletter/`, `src/lib/v2/newsletter/`

A daily paper built from the newsletters you subscribe to. Each newsletter gets its own addy.io alias. Mail sent to those aliases is pulled in, split into stories by an agent, deduplicated across sources, and laid out as one edition per day with a chip per source that ran the story.

## Tabs and controls

### Header and status strip

| Control | What it does |
|---|---|
| **Gmail ✓** / **Gmail not connected** | Status chip. Read only. |
| **addy.io ✓** / **addy.io not configured** | Status chip. Read only. |
| **Configure** | The "Newsletter settings" gear (see below). |
| **Connect Gmail →** | Shown when Gmail is not connected. Goes to `/integrations`. |
| Sync line | "never synced", "sync running...", or the last watermark and the last run's fetched, parsed and failed counts. |
| **Sync now** | Posts to `/api/newsletter/sync`. Reports new emails, new stories and merges. If the embedder is down it says dedupe ran on URLs only. With nothing connected it shows the error that says what to connect. |
| **Build** | Posts to `/api/newsletter/edition` for the selected date. Builds the edition if that date has none; an existing edition is served untouched. |
| **Force rebuild** | Recompiles that date's edition from scratch and replaces the stored one. |
| **Today's Edition**, **Archive**, **Subscriptions** | The tabs. The tab is kept in `?tab=`. |

### Today's Edition

The latest edition, section by section. Each story shows its title (linked when it has a URL), a summary, and a chip per source. If the sectioning agent failed during the build, a banner says the edition was "Sectioned by FALLBACK" and gives the error. No controls beyond the links.

### Archive

| Control | What it does |
|---|---|
| Date buttons | One per built edition. Clicking one loads it below and sets `?date=`, so the link can be shared or reloaded. **Build** and **Force rebuild** act on that date. |

### Subscriptions

| Control | What it does |
|---|---|
| **Subscribe** | Opens the new-subscription form. |
| Newsletter name, Topic, Signup URL, Existing alias, **Cadence** (daily, weekly, monthly, unknown) | Only the name is required. The topic drives the section fallback. Leave the alias blank to mint a new one. |
| **Create alias** | Posts to `/api/newsletter/subscriptions`. Creates the alias on addy.io and copies it to your clipboard. |
| **copy** / **Open signup** | Shown after creation: copy the alias again, or open the signup page to use it. |
| Newsletter name (link) | Opens the signup URL. |
| Copy icon ("Copy alias") | Copies that row's alias. |
| Status chip (**active** / **paused**) | Toggles the subscription with a PATCH to `/api/newsletter/subscriptions/<id>`. Pausing also deactivates the addy alias; resuming reactivates it. |

The table also shows Topic, Cadence and Last seen (a dash when no mail has arrived).

### Newsletter settings (gear)

| Control | What it does |
|---|---|
| **Credentials** | Read-only status for addy.io (with the config path) and Gmail. |
| **Scheduled Gmail sync**: **Poll Gmail on the schedule below** | Turns the scheduled sync on or off. Saves at once. **Sync now** always runs. |
| **Sync schedule (RRULE)** | Default `FREQ=MINUTELY;INTERVAL=30`. |
| **Scheduled daily edition**: **Build the edition every day** | Turns the daily build on or off. Saves at once. |
| **Edition time (HH:MM local)** | Default 06:30. |
| **Sections (one per line)** | Section names in order. "Everything Else" is always appended. |
| **Story extraction / sectioning agent** | The CLI agent that splits emails into stories. Saves at once. |
| **Dedupe threshold (0-1)** | Default 0.86. |
| **Dedupe window (days)** | Default 3. |
| **Tracker hosts (one per line)** | Link-wrapper hosts to unwrap. Empty uses the built-in list. |
| **First-sync lookback (days)** | Default 1. |
| **addy.io alias domain** | For example `yoshi.addy.io`. |
| **Gmail account id (optional)** | Pins one connected Gmail account. |
| **Gmail label (optional)** | A Gmail label that catches mail to aliases this app does not know. |
| **Save** | Saves the text fields. |

## How it works

- Subscriptions, emails, stories and editions are stored in the V2 SQLite database. The addy.io key lives under `addyio` in `~/.agentic-os/newsletter/config.json` (or `AGENTIC_OS_NEWSLETTER_DIR`) and is never returned by any route.
- Mail arrives through the shared Gmail connector from `/integrations`. If Gmail is not connected but an AgentMail inbox is, **Sync now** reads that inbox instead.
- Story extraction runs through `cliComplete` on the chosen agent. There is no silent fallback: a failed email is marked failed with its error, and the edition says when it was sectioned by fallback.
- Dedupe first matches canonical URLs, then compares embeddings above the threshold within the window. With the embedder unreachable it uses URLs only and the sync result says so.
- The page polls every 8 seconds while visible.
