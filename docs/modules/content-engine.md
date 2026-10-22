# Content Engine

Route: `/content-engine` · UI: `src/components/ContentEngineView.tsx`, `src/components/RunLaunchDrawer.tsx` · Backend: `src/app/api/content-engine/`, `src/lib/contentEngine.ts`

A posting calendar you plan with an agent, then work slot by slot: generate the copy and supporting materials, paste the live link once posted, log the real numbers, and ask an analyst model what to double down on. It does not post anything itself.

## Tabs and controls

### Header

| Control | What it does |
|---|---|
| **Models** | The "Content Engine models" gear with one field, **Kimi rotation slot (Ollama Cloud)** (default `kimi-k2.6`), then **Save**. |
| **Plan calendar** / **Replan** | Shows or hides the planner. The label is Replan once a plan exists. |
| **Analyze performance** | Posts `action: "insights"` to `/api/content-engine/action`. Disabled until at least one item has metrics. The result shows as a "Performance read" box with who wrote it and when. |
| **Reload** | Re-reads `/api/content-engine/list`. |

### Planner

Shown when you open it, or automatically when there is no plan and no items.

| Control | What it does |
|---|---|
| **What are we trying to do?** | Your goals, in free text. |
| Channel buttons | x, linkedin, youtube, tiktok, instagram, blog, reddit, substack. x and linkedin are on by default. |
| **posts / week** | 1 to 21 (default 5). |
| **weeks** | 1 to 8 (default 2). |
| **Plan calendar...** | Opens the launch drawer. Needs goals and at least one channel. |

### Launch drawer (used by planning and generation)

| Control | What it does |
|---|---|
| **Seat** | **Rotation (codex / kimi / claude per item; claude plans)**, **Claude (CLI)**, **Codex (CLI)** or **Kimi (Ollama Cloud)**. |
| **Skills for this run** | Skills from `~/.agentic-os/skills` to include. |
| **Guardrails** | **Model call timeout (min)** (1 to 15, default 5) and **No fallback to Claude**. |
| **Extra instructions** | Text appended to the prompt. |
| **Plan calendar** / **Generate materials** / **Regenerate materials** | Launches the run. Last-used values are remembered per module. |
| **Cancel** | Closes the drawer. |

Once launched, the only control is **Stop** in the runs tray. While a run for this module is in flight, the drawer is locked.

### Calendar

Slots are grouped by week (Monday start). Each card shows the date, channel, format, topic, a status dot (planned, drafted, posted, skipped) and chips for **materials**, **posted** and views or **measured**. Clicking a card opens the item drawer.

### Item drawer

| Control | What it does |
|---|---|
| Status select | planned, drafted, posted, skipped. Saved at once. |
| **Remove** | Posts `action: "remove"`. The item is dropped from the state file straight away, with no confirmation. |
| **Generate materials...** / **Regenerate materials...** | Opens the launch drawer, then posts to `/api/content-engine/generate`. Fills the copy box, and adds hashtags, an image prompt (for Thumbnails) and a video script when the model returns them. |
| **Post copy (editable)** | The copy. Saved when the box loses focus. |
| **Posted URL** | Paste the live link; saved when the box loses focus. A link icon opens it. |
| **Metrics (log after posting)**: views, likes, comments, shares, clicks + **Save metrics** | Saves the numbers for the analyst. |
| **Notes** | Saved when the box loses focus. |

## How it works

- Everything lives in one file, `~/.agentic-os/content-engine/state.json`: the plan, the items and the last insights.
- Generation rotates across model lineages per item: codex, then kimi (Ollama Cloud), then claude. Insights run on codex, so the model grading the posts is not the one that planned them.
- If the chosen seat fails, the run falls back to Claude unless the launch guardrail says no fallback. The item records which seat actually answered, and the UI shows it as "by ...".
- A replan keeps drafted and posted items and replaces only untouched planned slots. A stopped plan leaves the calendar unchanged.
- The kimi seat needs Ollama Cloud access; codex and claude need their CLIs logged in.
