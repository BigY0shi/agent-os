# Feature Walkthrough

A full tour of every page and feature in Agent-OS v1.0.

> **Screenshots:** Markers like `[SCREENSHOT: description]` indicate where to insert real screenshots once the app is running on your device.

---

## Dashboard (Home)

`[SCREENSHOT: Dashboard overview showing KPI cards, recent agents, pending decisions, and content queue]`

The dashboard is your command center. At a glance it shows:

**KPI Cards (top row)**
- Total agents in the fleet
- Active tasks in progress
- Pending decisions awaiting approval
- Content items in review
- Estimated cost this month

**Recent Agents panel** — the last 5 agents updated, with their stage badge and framework.

**Pending Decisions panel** — the decision queue surfaced on the dashboard so nothing gets buried. Each decision shows the agent that raised it, the question, and the context. Click **Details** to read the full context in a modal, then **Approve** or **Reject** directly from the dashboard.

`[SCREENSHOT: Decision details modal with approve/reject buttons]`

**Content Queue panel** — recent agent outputs waiting for human review. Click any item to open the feedback modal.

---

## Agents

`[SCREENSHOT: Agents fleet view grouped by department with department icons and color accents]`

The Agents page is the heart of Agent-OS. It has three modes: **Fleet View**, **Scaffold Modal**, and **Agent Detail View**.

### Fleet View

Agents are grouped by department (CEO, CTO, CMO, CFO, COO, CIO, CHRO). Each department section shows its icon and a count badge.

**Agent cards display:**
- Name and role
- Goal (truncated to two lines)
- Framework badge (CrewAI, OpenClaw, etc.)
- Stage badge (Ideate / Build / Test / Deploy / Observe) with color coding
- Manager indicator (crown icon) if the agent is a Manager type

**Filters (top bar):**
- Search — matches name, role, and goal text
- Department dropdown — filter to one department
- Framework dropdown — filter by harness

### Scaffold Modal (+ Scaffold Agent)

`[SCREENSHOT: Scaffold modal showing all 12 fields with helper text]`

Click **+ Scaffold Agent** to open the scaffold form. All 12 fields with helper text:

| Field | Description |
|---|---|
| **Name** | The agent's name — can be a real name (Aria) or a codename |
| **Role** | Job title used in prompts and the AGENT.md spec |
| **Department** | Which C-Suite division they belong to |
| **Goal** | One sentence: what is this agent fundamentally trying to accomplish? |
| **Vibe** | Personality archetype. Use a preset or write your own |
| **System Prompt** | The actual instructions the agent receives. This goes directly into the AGENT.md |
| **Framework** | Which harness runs this agent |
| **Assigned Tools** | Checkbox multi-select from your tools library |
| **Assigned Skills** | Checkbox multi-select from your skills library |
| **Memory** | Toggle: should this agent retain context between runs? |
| **Agent Type** | Worker (executes) or Manager (delegates) |
| **Stage** | Current lifecycle stage |

**Vibe presets:** Analyst, Builder, Strategist, Creative, Guardian, Optimizer — each auto-fills a personality description in the vibe field.

### Agent Detail View

`[SCREENSHOT: Agent detail view with tabs: Overview, Settings, Outputs]`

Click any agent card to open the detail view. Three tabs:

**Overview** — goal, system prompt preview, framework, stage, assigned tools and skills, memory status.

**Settings** — editable form with all 12 fields. Same layout as the scaffold form. Save changes with the Update button.

**Outputs** — (v1.2) will show run history, cost, and outputs here.

**Export .md button** — downloads a deploy-ready AGENT.md spec file.

`[SCREENSHOT: Sample AGENT.md export open in a text editor]`

**Copy .md button** — copies the AGENT.md content to clipboard for pasting directly into your harness repo.

---

## Skills

`[SCREENSHOT: Skills page two-column layout — Skills left with orange accent, Tools right with blue accent, MCP Servers grid below with purple accent]`

The Skills page has three sections:

### Skills (left column)

Your library of agent capabilities. Each skill card shows:
- Name and category badge
- Description
- Assigned agent (if any)

**Hover actions on each card:**
- Copy .md — copies SKILL.md to clipboard
- Download .md — downloads the SKILL.md spec file
- Edit — opens edit modal
- Delete — removes the skill (with confirmation)

`[SCREENSHOT: Skill card hover state showing action buttons]`

**Add Skill modal fields:**
- Name, Description, Category
- Instructions — the detailed capability spec
- Input/Output format
- Assigned Agent (dropdown)

### Tools (right column)

Concrete functions your agents can call — APIs, database queries, file operations, etc. Same card layout as skills with a blue accent.

### MCP Servers (bottom grid)

Model Context Protocol servers that expose tools to Claude-based agents. Each card shows name, type, endpoint URL, and status badge.

`[SCREENSHOT: MCP Servers grid with status badges]`

---

## Pipeline

`[SCREENSHOT: Pipeline kanban board with five columns: Ideate, Build, Test, Deploy, Observe]`

The Pipeline is a kanban board representing every agent's lifecycle stage.

**Columns:** Ideate → Build → Test → Deploy → Observe

Each agent card on the board shows their name, role, department icon, and framework badge.

**Moving agents:** Drag a card between columns to advance or revert its stage. This also updates the stage on the agent's detail view — the pipeline and agent page are always in sync.

**Deleting from pipeline:** Hover a card to reveal the delete button (trash icon, top-right corner). This removes the agent from the system entirely.

`[SCREENSHOT: Pipeline card hover state showing delete button]`

---

## Tasks

`[SCREENSHOT: Tasks page with list of tasks, status badges, and agent assignments]`

The Tasks page tracks discrete pieces of work assigned to agents or departments.

**Task statuses:** Pending → In Progress → Done / Rejected

**Task cards show:**
- Task title and description
- Assigned agent name (with fallback to department)
- Status badge
- Created/updated timestamps

**Create task:** Click **+ New Task**. Assign to an agent, set priority, and add a description.

**Status updates:** Click the status badge on any task to cycle it forward, or use the Edit modal to set it explicitly. Completing a task (marking Done or Rejected) automatically sets the `completed_at` timestamp.

---

## Decisions

`[SCREENSHOT: Decisions queue with pending decision cards showing agent name, question, and context preview]`

When agents encounter questions requiring human judgment, they log them here.

Each decision card shows:
- The agent that raised the decision
- The decision question (title)
- Context preview
- Timestamp

**Approve / Reject buttons** are on every card. You can also click **Details** to open a modal with the full context before deciding.

`[SCREENSHOT: Decision details modal]`

Approvals and rejections are recorded with your username (`Yoshi`) and a timestamp — building a log of all human-in-the-loop decisions over time.

---

## Content

`[SCREENSHOT: Content review page with content cards showing type badges, agent names, and feedback icons]`

The Content page is a review queue for agent-generated outputs — blog posts, reports, emails, summaries, and any other text the agents produce.

**Content cards show:**
- Title and content type badge
- Assigned agent
- Preview text (first ~200 chars)
- Feedback indicators (thumbs up/down counts)

**Feedback modal:**
- 👍 / 👎 vote
- Tag chips: Accurate, Well-written, Off-brand, Needs Revision, Excellent
- Free-text comment field

`[SCREENSHOT: Content feedback modal with voting and tags]`

All feedback is stored and will feed into the Output Quality Scoring feature in v1.3.

---

## Analytics

`[SCREENSHOT: Analytics page showing placeholder charts and stat cards]`

The Analytics page shows fleet-level metrics. In v1.0 the charts use placeholder/seed data. Real charting backed by live run data is coming in v1.3.

**Current metrics displayed:**
- Agent count by department
- Task completion rates
- Decision resolution times
- Content feedback scores
- Estimated costs over time

---

## Settings / Reports / Alerts

These pages exist in v1.0 as scaffolded views. Full functionality is on the roadmap:

- **Reports** — downloadable summaries of fleet activity (v1.3)
- **Alerts** — configurable rules for failure, cost, and stuck tasks (v1.2)
- **Settings** — global configuration, API key management (v1.5)
