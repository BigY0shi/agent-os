# Agent-OS Roadmap

**Last updated:** April 2026  
**Repo:** [github.com/BigY0shi/agent-os](https://github.com/BigY0shi/agent-os)

---

## Priority Scoring System

Each upgrade is scored 1–10 using a weighted composite:

| Dimension | Weight | Notes |
|---|---|---|
| **Urgency** (U) | 25% | Pain felt _without_ this feature |
| **Value** (V) | 40% | Gain delivered _by_ the feature |
| **Ease** (E) | 20% | How simple it is to build (10 = trivial) |
| **Speed** (S) | 15% | How fast it can ship (10 = days) |
| **Bell multiplier** (B) | ×0.7–1.15 | Importance curve: trivial and moonshot features are discounted; mid-tier features with clear ROI float up |

`Score = (U×0.25 + V×0.40 + E×0.20 + S×0.15) × B`

**Tiers:**

| Score | Tier | Meaning |
|---|---|---|
| 7.5–10 | 🔴 Critical | Do this sprint |
| 6.0–7.4 | 🟠 High | Next 1–2 milestones |
| 4.5–5.9 | 🟡 Medium | On the roadmap |
| 2.5–4.4 | 🟢 Low | Backlog |
| 0–2.4 | ⚪ Someday | Visionary / speculative |

---

## Priority Leaderboard

| # | Feature | U | V | E | S | B | **Score** | Tier |
|---|---|---|---|---|---|---|---|---|
| 1 | WebSocket live agent status | 7 | 8 | 5 | 5 | 1.15 | **7.71** | 🔴 |
| 2 | Run history log per agent | 7 | 7 | 6 | 5 | 1.15 | **7.48** | 🔴 |
| 3 | Real analytics charts (recharts) | 6 | 7 | 6 | 5 | 1.15 | **7.19** | 🟠 |
| 4 | Cost tracking — real API metering | 6 | 7 | 6 | 5 | 1.15 | **7.19** | 🟠 |
| 5 | Team builder | 6 | 8 | 4 | 5 | 1.15 | **7.19** | 🟠 |
| 6 | Alert rules (cost spike, agent fail) | 7 | 7 | 5 | 4 | 1.15 | **7.07** | 🟠 |
| 7 | Onboarding flow (first-run wizard) | 5 | 7 | 6 | 5 | 1.15 | **6.90** | 🟠 |
| 8 | Docker deployment option | 5 | 7 | 6 | 5 | 1.15 | **6.90** | 🟠 |
| 9 | Loading skeletons + better UX states | 5 | 5 | 8 | 9 | 1.05 | **6.51** | 🟠 |
| 10 | API keys + external REST API | 5 | 8 | 4 | 4 | 1.15 | **6.73** | 🟠 |
| 11 | CrewAI live integration | 9 | 9 | 3 | 3 | 0.85 | **5.87** | 🟡 |
| 12 | Trixie (Wayland/labwc) kiosk support | 5 | 6 | 6 | 5 | 1.05 | **5.88** | 🟡 |
| 13 | Agent spec versioning + diff | 5 | 7 | 5 | 4 | 1.05 | **5.93** | 🟡 |
| 14 | Workflow DAG editor | 5 | 8 | 3 | 4 | 1.05 | **5.93** | 🟡 |
| 15 | Empty state illustrations | 4 | 5 | 7 | 8 | 1.05 | **5.88** | 🟡 |
| 16 | OTA dashboard updates from Pi UI | 5 | 6 | 5 | 4 | 1.05 | **5.51** | 🟡 |
| 17 | Multi-user auth + RBAC | 4 | 7 | 3 | 4 | 1.05 | **5.25** | 🟡 |
| 18 | Plugin system (SDK) | 4 | 9 | 3 | 5 | 0.85 | **5.06** | 🟡 |
| 19 | Natural language agent builder | 3 | 9 | 3 | 5 | 0.85 | **4.85** | 🟡 |
| 20 | AI copilot inside dashboard | 3 | 8 | 4 | 5 | 0.85 | **4.68** | 🟡 |
| 21 | Agent marketplace | 2 | 9 | 2 | 4 | 0.85 | **4.34** | 🟡 |
| 22 | Federated agent networks (multi-cluster) | 2 | 9 | 2 | 2 | 0.85 | **4.08** | 🟡 |
| 23 | Micro-animations on cards | 2 | 4 | 6 | 7 | 0.90 | **3.92** | 🟢 |
| 24 | Self-healing agent mesh | 2 | 9 | 1 | 2 | 0.85 | **3.91** | 🟢 |
| 25 | Dark / light theme toggle | 2 | 4 | 5 | 6 | 0.90 | **3.60** | 🟢 |
| 26 | Agent-OS as Pi OS (full desktop replacement) | 1 | 8 | 2 | 2 | 0.85 | **3.53** | 🟢 |
| 27 | Voice control kiosk interface | 2 | 6 | 4 | 4 | 0.90 | **3.87** | 🟢 |

---

## v1.0 — Foundation ✅ Current

- [x] SQLite persistence via sql.js WASM
- [x] Agent scaffold form (12 fields) with AGENT.md export
- [x] Corporate hierarchy model (CEO → CHRO)
- [x] Fleet view grouped by department, filtered by framework
- [x] Skills & Tools page with SKILL.md export
- [x] MCP Servers management
- [x] Pipeline kanban (Ideate → Build → Test → Deploy → Observe)
- [x] Decision queue with approve/reject
- [x] Content review with feedback voting
- [x] Touch-optimized CSS for Pi tablet kiosk
- [x] `deploy-pi.sh` (Bookworm Desktop) and `deploy-pi-lite.sh` (Bookworm Lite)
- [x] Trixie runtime detection with Bookworm fallback guidance

---

## v1.1 — Polish & Presence 🟠 High Priority
> **Theme:** Make what exists feel professional and trustworthy

- [ ] Loading skeletons on all data-fetching components (Score: 6.51)
- [ ] Empty state illustrations — no agents, no tasks, no decisions (Score: 5.88)
- [ ] Onboarding flow — first-run wizard walks new users through creating their first agent (Score: 6.90)
- [ ] Error boundary components with retry buttons
- [ ] Toast notifications for create / update / delete actions
- [ ] Page transitions (subtle fade between routes)
- [ ] Docker deployment option — `docker-compose.yml` for non-Pi installs (Score: 6.90)

---

## v1.2 — Live Intelligence 🔴 Critical
> **Theme:** The dashboard stops being a file editor and becomes a control room

- [ ] WebSocket connection to agent harnesses — live status, heartbeat indicator (Score: 7.71)
- [ ] Run history log per agent — every execution timestamped with output, duration, cost (Score: 7.48)
- [ ] Real-time cost tracking — actual token counts from OpenAI / Anthropic APIs (Score: 7.19)
- [ ] Alert rules — configurable triggers on agent failure, cost threshold, stuck tasks (Score: 7.07)
- [ ] CrewAI adapter — push AGENT.md spec, receive run events back (Score: 5.87)
- [ ] OpenClaw adapter — same bidirectional sync
- [ ] API keys + external REST API — so CI/CD and other tools can trigger agents (Score: 6.73)

---

## v1.3 — Data & Visibility 🟠 High Priority
> **Theme:** Turn raw activity into insight**

- [ ] Replace placeholder analytics charts with real recharts graphs (Score: 7.19)
- [ ] Department-level rollup views — aggregated metrics per C-Suite division
- [ ] Per-agent performance metrics — success rate, avg duration, cost per run
- [ ] Agent spec versioning — diff viewer between spec versions (Score: 5.93)
- [ ] Output quality scoring — close the human feedback loop on content review
- [ ] Export reports to CSV and PDF
- [ ] Proxmox host resource view — CPU, RAM, temp of the cluster running agents

---

## v1.4 — Orchestration 🟠 High Priority
> **Theme:** Think in teams, not just individual agents**

- [ ] Team builder — compose agent groups with explicit roles and communication flows (Score: 7.19)
- [ ] Workflow DAG editor — visual pipeline designer with nodes and edges (Score: 5.93)
- [ ] Manager agent auto-delegation — manager agents automatically route tasks to their department workers
- [ ] Inter-agent message log — audit trail of what agents said to each other
- [ ] Shared memory / context store — agents within a team share a persistent knowledge base

---

## v1.5 — Trixie & Platform 🟡 Medium
> **Theme:** Expand the deployment surface**

- [ ] Trixie kiosk support — Wayland/labwc native autostart (Score: 5.88)
  - Replace `openbox` with `labwc` autostart at `~/.config/labwc/autostart`
  - Replace `xset`/`xrandr` with `wlr-randr` / `swaymsg` equivalents
  - Replace `LightDM` with `greetd` session config
  - Keep Bookworm scripts unchanged, add parallel Trixie scripts
- [ ] OTA updates triggered from the dashboard UI — no SSH required (Score: 5.51)
- [ ] Multi-user auth with RBAC — admin, operator, viewer roles (Score: 5.25)
- [ ] Webhook support — trigger external systems on agent lifecycle events
- [ ] Backup + restore — full DB export/import with version tags

---

## v1.6 — New Harnesses 🟡 Medium
> **Theme:** Make Agent-OS framework-agnostic**

- [ ] NemoClaw adapter — NVIDIA NeMo-based orchestration
- [ ] Hermes Agent adapter — Hermes function-calling runtime
- [ ] LangChain / LangGraph adapter
- [ ] AutoGen adapter (Microsoft)
- [ ] Generic harness SDK — documented interface for custom framework support
- [ ] Framework performance comparison view — side-by-side benchmarks

---

## v2.0 — Intelligence Layer 🟡 Medium
> **Theme:** The dashboard thinks alongside you**

- [ ] Natural language agent builder — "Build me a research agent that monitors HN" (Score: 4.85)
- [ ] AI copilot inside the dashboard — ask questions about your fleet, get suggestions (Score: 4.68)
- [ ] Plugin system + SDK — extend the dashboard with custom pages and integrations (Score: 5.06)
- [ ] Agent prompt library — reusable, versioned system prompt templates
- [ ] Fine-tune tracking — link fine-tune jobs to the models powering your agents
- [ ] RAG integration — agents backed by vector stores for domain knowledge

---

## v3.0 — Platform 🟢 Low / Long Horizon
> **Theme:** Agent-OS becomes an ecosystem**

- [ ] Agent marketplace — publish, share, and import agent + skill specs across instances (Score: 4.34)
- [ ] Plugin marketplace — curated plugin store with free and paid listings
- [ ] Federated agent networks — sync and orchestrate across multiple Proxmox clusters (Score: 4.08)
- [ ] Cloud-managed option — hosted Agent-OS for teams without a Proxmox setup
- [ ] Mobile app — iOS/Android companion for monitoring and approvals
- [ ] Notification hub — push to phone, Slack, Discord, PagerDuty

---

## Visionary / Speculative ⚪ Someday

These are directional bets, not scheduled work. They live here to capture the ambition.

- **Agent-OS as a Pi OS** — strips away the traditional desktop entirely. The Pi boots directly into Agent-OS fullscreen. Your agents _are_ your computer. (Score: 3.53)
- **Self-healing agent mesh** — agents monitor each other's health and automatically restart, reassign tasks, or escalate when peers go dark. (Score: 3.91)
- **Voice control kiosk** — wake word triggers agent commands. Useful for hands-free Pi tablet interactions. (Score: 3.87)
- **Autonomous spec evolution** — agents propose edits to their own AGENT.md based on observed performance. Humans approve or reject the diff.
- **Cross-org agent lending** — securely loan specialized agents to trusted partners, metered by usage.
- **Agent-OS Cloud** — fully managed SaaS where organizations run their entire agent workforce without touching infrastructure.
- **Micro-animations** — spring-physics card transitions, stagger-in fleet views, progress trails on pipeline moves. (Score: 3.92)

---

## Changelog

| Version | Date | Summary |
|---|---|---|
| v1.0 | Apr 2026 | Foundation — SQLite, scaffold form, Pi kiosk deployment |
