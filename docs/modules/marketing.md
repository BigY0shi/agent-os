# Marketing Hub

Route: `/marketing` (and `/marketing/<slug>` per campaign) · UI: `src/components/MarketingHub.tsx`, `src/components/v2/marketing/CampaignDetail.tsx` · Backend: `src/app/api/marketing/`, `src/lib/marketing.ts`, `src/lib/buzzBridge.ts`

Campaign planning and drafting for three brands: PayloadsCO, Launchworks / Deal Desk, and Cobalt Research Supply. A planning council writes the strategy and a dated content calendar, your CLI agents draft each piece in the brand's voice, and every draft waits for your approval. Nothing is posted from here; you mark pieces published yourself.

## Tabs and controls

### Header

| Control | What it does |
|---|---|
| **Configure** | The "Marketing Hub settings" gear. **Drafting agent** (leads planning and writes drafts), **Planning council** (**Run the 3-pass council when planning**), **Critic agent** (shown when the council is on), **Text-post platforms** (linkedin, x, facebook, plus any you add with the plus button), **Ideate backend** (**In-hub chat (local)** or **Buzz channel**, with a **Buzz channel** name). The Ideate backend saves as soon as you change it; everything else saves on **Save**. |
| **Ideate**, **Campaigns**, **Calendar**, **Approval Queue (N)**, **Personas** | The tabs. N is the number of drafts waiting. |

### Ideate

| Control | What it does |
|---|---|
| Brand select | **No brand (freestyle)** or one of the three brands, so the riff uses that brand's persona. |
| Agent picker | The CLI agent that replies. |
| **via Buzz · #channel** | Shown when the Ideate backend is Buzz. The riff runs through that Buzz channel. |
| **Clear** | Clears the conversation. Nothing here is saved anyway. |
| **Promote to campaign** | Needs at least one full exchange. Posts the riff to `/api/marketing/ideate` to distill it into a campaign brief, then opens Campaigns with the form pre-filled. |
| Riff box + send button | Enter sends, Shift+Enter adds a line. Posts to `/api/marketing/ideate`. |
| Stop (square icon) | Aborts the reply or the promote. |

### Campaigns

| Control | What it does |
|---|---|
| Title, brand select, **Goal** | Title and goal are required. |
| **Add an angle (optional)** | Shows the angle and constraints box. |
| Channel boxes | **YouTube (long-form)**, **Short video (LinkedIn + Shorts)**, **Text posts (LinkedIn / X / FB)**, **Blog / SEO (draft-only)**. All ticked by default. |
| **Create** | Posts the new campaign to `/api/marketing/campaigns`. |
| Campaign card | Opens the campaign drawer. Shows brand, status and how many pieces are published. |
| **Open campaign** | Goes to `/marketing/<slug>`. |

### Campaign drawer

| Control | What it does |
|---|---|
| Archive icon ("Remove campaign") | Posts `action: "exile"` to `/api/marketing/campaigns`. The file is moved to `.exile/`, not deleted. |
| **Plan campaign** | Posts to `/api/marketing/plan`. The council writes the plan and one item per piece, grouped by date. Typically 1 to 4 minutes. |
| **Re-plan** | Asks for confirmation, then re-runs the council. This replaces the plan, the calendar and every item, drafts included. |
| **Stop** | Aborts a running plan or draft from the browser. |
| Item row | Click to expand: shows the brief and the draft. |
| Agent picker + **Draft it** | On `idea` items. Posts `action: "draft"` to `/api/marketing/item`. |
| **Approve** | On `drafted` items. |
| **Revise** + feedback box + **Revise draft** | Redrafts with your feedback and the chosen agent. |
| **Edit** / **Save edit** / **Cancel** | Edit the draft by hand. A manual edit removes approval, so it goes back through the gate. |
| **Unapprove** | On approved or scheduled items. |
| Date picker | Sets `scheduledFor` (action `schedule`). |
| **Published URL (optional)** + **Mark published** | Marks the item published and stores the link. |

### Calendar

| Control | What it does |
|---|---|
| Previous month / Next month arrows, **Today** | Moves the Monday-first month grid. |
| Item chip | Opens that campaign's drawer with the item expanded. Chip colour is the status (legend: idea, drafted, approved / scheduled, published). |
| **Unscheduled** strip | Items with no date, from every campaign. |

### Approval Queue

| Control | What it does |
|---|---|
| Campaign name | Opens that campaign in the Campaigns tab. |
| **Show full draft** / **Collapse** | Expands a draft longer than 320 characters. |
| **Approve** | Approves the draft. |
| **Revise** + **Revise draft** | Redraft with feedback and a chosen agent. |

### Personas

| Control | What it does |
|---|---|
| Name, **Audience**, **Tone**, `Voice rules — one per line`, `Hard-banned — one per line`, **CTA style**, **Voice samples (optional)** | One card per brand persona. |
| **Save persona** | Posts the persona to `/api/marketing/personas`. |

### Campaign page (`/marketing/<slug>`)

**Marketing Hub** links back. The **Overview** tab shows the goal, angle, plan and item counts by status. **Calendar**, **Board**, **Assets** and **Metrics** show a placeholder message only.

## How it works

- Campaigns and personas are files under `~/.agentic-os/marketing/` (`campaigns/` and `personas/`). Personas are seeded by the backend on first load.
- Planning and drafting shell out to your CLI agents through `cliComplete`, no API keys. With the council on, the lead agent plans, the critic agent (default `codex`) attacks the plan, and the lead revises. With it off, one pass.
- The persona for the campaign's brand is injected into whichever agent drafts, so voice rules live in data, not in agent-specific prompts.
- The Ideate riff is not stored. On the Buzz backend it goes through `src/lib/buzzBridge.ts` to your Buzz workspace channel (default `marketing-ideas`).
- Replies take 15 to 60 seconds or more per round because each is a full CLI agent run.
