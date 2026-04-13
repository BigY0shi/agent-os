# Getting Started with Agent-OS

Agent-OS is a Next.js dashboard for building, managing, and deploying an AI agent workforce organized as a corporate hierarchy. This guide gets you from zero to your first running agent in about 15 minutes.

---

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **npm 9+** — included with Node
- **Git** — [git-scm.com](https://git-scm.com)
- A terminal (PowerShell, Terminal.app, bash)

---

## 1. Clone and Install

```bash
git clone https://github.com/BigY0shi/agent-os.git
cd agent-os
npm install
```

This installs all dependencies including Next.js, Tailwind CSS, sql.js (SQLite), and Lucide icons. Expect it to take 30–60 seconds.

---

## 2. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. You should see the Agent-OS dashboard with seed data already loaded — a handful of example agents, skills, and tasks to give you something to explore right away.

> **Note:** On first launch, Agent-OS creates `data/agent-os.db` — your SQLite database. This file persists all your data between restarts. Keep it safe and back it up regularly.

---

## 3. Understand the Structure

Agent-OS organizes your AI workforce as a **corporate hierarchy** with seven departments:

| Department | Head | Purpose |
|---|---|---|
| CEO | Chief Executive | Strategy, vision, cross-department coordination |
| CTO | Chief Technology | Engineering, infrastructure, dev tooling agents |
| CMO | Chief Marketing | Content, campaigns, SEO, social agents |
| CFO | Chief Financial | Budget tracking, cost analysis, reporting agents |
| COO | Chief Operations | Workflow, process automation, ops agents |
| CIO | Chief Information | Data, integrations, MCP server agents |
| CHRO | Chief HR | Recruiting, onboarding, people ops agents |

Every agent you create belongs to one of these departments. This keeps your fleet organized as it grows.

---

## 4. Create Your First Agent

1. Click **Agents** in the left sidebar
2. Click the **+ Scaffold Agent** button (top right)
3. Fill in the form:

   - **Name** — what to call this agent (e.g. `Aria`)
   - **Role** — their job title (e.g. `Senior Research Analyst`)
   - **Department** — pick the C-Suite department they report to
   - **Goal** — one sentence describing their primary mission
   - **Vibe** — the personality archetype. Use a preset (Analyst, Builder, Strategist, etc.) or write your own
   - **System Prompt** — the full instructions this agent receives. This is what gets written into your AGENT.md spec file
   - **Framework** — which harness will run this agent (CrewAI, OpenClaw, etc.)
   - **Tools & Skills** — assign from your library
   - **Memory** — toggle on if the agent should retain context between runs
   - **Agent Type** — Worker (executes tasks) or Manager (delegates to workers)
   - **Stage** — where in the lifecycle: Ideate → Build → Test → Deploy → Observe

4. Click **Create Agent**

Your agent appears in the fleet view, grouped under their department.

---

## 5. Export Your First AGENT.md

Every agent can export a **deploy-ready spec file** that your harness (CrewAI, OpenClaw, etc.) can consume directly.

1. Click the agent card to open the detail view
2. Click the **Export .md** button in the header
3. A `AgentName.md` file downloads to your machine

The spec includes YAML frontmatter with all metadata plus a full markdown body with role, goal, system prompt, tools, skills, and memory configuration.

---

## 6. Add Skills and Tools

Before assigning skills and tools to agents, you need to populate your library.

1. Click **Skills** in the sidebar
2. Click **+ Add Skill** — fill in name, description, category, and optionally assign it to an agent
3. To export a **SKILL.md** spec, hover a skill card and click the download icon

Tools and MCP Servers follow the same pattern on the right side of the Skills page.

---

## 7. Move an Agent Through the Pipeline

The Pipeline page is a kanban board tracking every agent through their lifecycle.

1. Click **Pipeline** in the sidebar
2. Find your agent's card in the **Ideate** column
3. Drag it to **Build** once you're actively developing it
4. Continue moving it through **Test → Deploy → Observe** as it matures

---

## 8. Deploy to Raspberry Pi (Optional)

Agent-OS is designed to run as a touch kiosk on a Raspberry Pi tablet. See the deployment scripts in the project root:

- `deploy-pi.sh` — for **Pi OS Bookworm Desktop** (has a desktop environment already)
- `deploy-pi-lite.sh` — for **Pi OS Bookworm Lite** (installs X11 + Chromium from scratch)

**Important:** Use **Bookworm 64-bit**, not Trixie. See [FAQ.md](FAQ.md) for details.

Transfer the project to your Pi and run:

```bash
chmod +x deploy-pi.sh
./deploy-pi.sh
```

---

## 9. Production Build (Non-Pi)

To run Agent-OS in production on any Linux/Mac server:

```bash
npm run build
npm start
```

Or with a custom port:

```bash
PORT=8080 npm start
```

---

## Important First Steps Checklist

- [ ] Delete the seed agents and replace with your own real agents
- [ ] Add your actual tools and MCP servers (the seed data is generic)
- [ ] Set up your first skill and assign it to an agent
- [ ] Export at least one AGENT.md and verify it works in your harness
- [ ] Back up `data/agent-os.db` somewhere safe
- [ ] If on Pi: verify `~/agent-os-status.sh` shows everything green after deploy

---

## What's Next

- [Feature Walkthrough](FEATURE_WALKTHROUGH.md) — deep dive into every page
- [FAQ & Troubleshooting](FAQ.md) — common issues and fixes
- [Roadmap](ROADMAP.md) — what's coming next
