# Agent-OS Website Outline

**Purpose:** Marketing + documentation site for Agent-OS  
**Tone:** Technical but approachable. Confident, builder-to-builder energy. No fluff.  
**Primary CTA:** Star on GitHub / Self-host in 5 minutes  

---

## Site Architecture

```
agentOS.dev (or agent-os.io)
│
├── /                    Home (hero + features + social proof)
├── /features            Full feature breakdown
├── /docs                Documentation hub (mirrors /docs in repo)
│   ├── /docs/getting-started
│   ├── /docs/walkthrough
│   ├── /docs/faq
│   └── /docs/roadmap
├── /deploy              Pi + self-hosting guides
├── /plugins             Plugin marketplace (v2.0+)
├── /changelog           Version history
├── /blog                Tutorials, agent spotlight posts
└── /about               Project background, Yoshi's story
```

---

## Page 1: Home `/`

### Hero Section
**Headline:** *Your AI workforce. Organized. Deployed. Observed.*  
**Subhead:** Agent-OS is an open-source dashboard for building, managing, and shipping AI agents as a structured corporate hierarchy — from your laptop or a Raspberry Pi.

**Hero visual:** Animated screenshot of the fleet view with department groupings, a pipeline kanban mid-drag, and a live decision card popping up.

**CTAs:**
- `⭐ Star on GitHub` (primary)
- `→ Self-host in 5 min` (secondary, links to Getting Started)

**Social proof strip:** GitHub stars count, forks, "Running on Pi" badge

---

### Problem Section
**Headline:** *Most agent tools treat your fleet like a flat list.*

Three pain points, icon + headline + 2-line description:
1. **No structure** — as your agent count grows, chaos follows. Who's responsible for what?
2. **No spec standard** — agents live in scattered prompts and config files. Hard to version, share, or audit.
3. **No visibility** — you don't know what your agents are doing, what they cost, or when they need help.

---

### Solution Section
**Headline:** *Organize your agents like a company.*

Three pillars, each with a screenshot:
1. **Hierarchy** — CEO → CTO → CMO → CFO → COO → CIO → CHRO. Every agent has a department, a role, and a reporting chain.
2. **Spec files** — every agent exports a deploy-ready AGENT.md. Every skill exports a SKILL.md. Version-controlled, harness-agnostic.
3. **Control room** — pipeline kanban, decision queue, content review, cost tracking, alerts.

---

### Features Strip
Six feature tiles with icon + headline + one-liner:

| Icon | Feature | One-liner |
|---|---|---|
| 🏗️ | Scaffold Form | 12-field agent builder with framework, tools, skills, memory |
| 📄 | AGENT.md Export | Deploy-ready specs for CrewAI, OpenClaw, and any harness |
| 🎛️ | Pipeline Kanban | Track every agent from Ideate to Observe |
| 🔔 | Decision Queue | Human-in-the-loop approvals, logged with resolver and timestamp |
| 📱 | Pi Kiosk Mode | Touch-optimized dashboard on a Raspberry Pi tablet |
| 🔌 | Framework Agnostic | CrewAI, OpenClaw, NemoClaw, Hermes Agent, LangChain, AutoGen |

---

### Deployment Section
**Headline:** *Runs anywhere. Shines on a Pi.*

Two deployment paths side by side:
- **Self-host** — Node.js on any machine. 5-minute setup.
- **Pi Kiosk** — Raspberry Pi OS Bookworm. Chromium fullscreen. Touch-ready. Interactive guided installer.

Screenshot of the Pi tablet with the fleet view loaded.

---

### Open Source Section
**Headline:** *Open source, forever.*

- MIT licensed
- All data stays on your machine
- No telemetry, no cloud lock-in
- Contribution-friendly: roadmap, issue templates, clear architecture

CTA: `View on GitHub →`

---

### Roadmap Teaser
**Headline:** *This is just the beginning.*

Three upcoming highlights from the roadmap (high priority items):
- Live agent status via WebSocket
- CrewAI + OpenClaw integration
- Plugin marketplace

Link: `Full roadmap →`

---

### Footer
- GitHub / Twitter (X) / Discord (future)
- Docs / Changelog / Roadmap / Blog
- "Built by Yoshi · Open source · No BS"

---

## Page 2: Features `/features`

Expanded breakdown of every feature with larger screenshots and more detail. Sections mirror the Feature Walkthrough doc:

1. Fleet View & Department Hierarchy
2. Agent Scaffold Form
3. AGENT.md & SKILL.md Export
4. Skills, Tools & MCP Servers
5. Pipeline Kanban
6. Decision Queue
7. Content Review
8. Analytics (current + roadmap)
9. Touch Kiosk Mode

---

## Page 3: Deploy `/deploy`

**Headline:** *Get running in 5 minutes.*

Two tracks side-by-side:

**Local / Server**
```bash
git clone https://github.com/BigY0shi/agent-os.git
cd agent-os && npm install && npm run dev
```

**Raspberry Pi**
- OS recommendation (Bookworm, not Trixie)
- SD card sizing guide (16GB min, 32GB recommended)
- Step-by-step deploy script walkthrough
- What happens on reboot (service → kiosk → dashboard)

---

## Page 4: Blog `/blog`

Editorial cadence (monthly to start):

- **Launch post** — "Why I built Agent-OS" — Yoshi's story, Proxmox setup, the problem with flat agent lists
- **Tutorial posts** — "Deploying your first CrewAI agent with Agent-OS", "Running a Pi kiosk dashboard for $50"
- **Agent spotlights** — showcase interesting agents people are building
- **Harness deep dives** — OpenClaw architecture, NemoClaw setup, etc.

---

## Page 5: About `/about`

- Project origin story
- Yoshi's setup (Proxmox cluster, OpenClaw, the Pi tablet)
- Philosophy: local-first, open-source, human-in-the-loop
- How to contribute
- Contact / community links
