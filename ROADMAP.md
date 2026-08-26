# Agent-OS Roadmap

**Last updated:** August 26, 2026

---

## Near-term — Device + firmware (this week)

See **[docs/agent-os/WEEK_1_DEVICE_FIRMWARE.md](docs/agent-os/WEEK_1_DEVICE_FIRMWARE.md)** and the presentation pack ([DOC_INDEX.md](docs/agent-os/DOC_INDEX.md)).

- [ ] Flash Pi Bookworm 64-bit + deploy Agent OS systemd service
- [ ] Chromium kiosk autostart (cold boot → UI)
- [ ] Pass acceptance gates D1–D5 (boot, touch, offline approve, audit, reboot)
- [ ] Stretch: Hermes/Honcho health pills green on LAN

---

## v1.0 — Foundation (Current)

Everything needed to scaffold, manage, and deploy agents from a touch-friendly dashboard.

- [x] SQLite persistence (sql.js WASM) — all APIs migrated from mock data
- [x] Agent scaffold form (12 fields: name, role, department, goal, vibe, system prompt, framework, tools, skills, memory, type, stage)
- [x] Corporate hierarchy model (CEO, CTO, CMO, CFO, COO, CIO, CHRO departments)
- [x] Fleet view grouped by department with filters (department, framework, search)
- [x] AGENT.md export — deploy-ready spec files per agent
- [x] Skills & Tools page — two-column layout with SKILL.md export
- [x] MCP Servers management
- [x] Pipeline kanban (Ideate → Build → Test → Deploy → Observe)
- [x] Decision queue with approve/reject from dashboard
- [x] Content review with feedback (vote, tags, comment)
- [x] Touch-optimized CSS (44px targets, coarse pointer media queries, kiosk fullscreen)
- [x] Pi deployment scripts — `deploy-pi.sh` (Desktop) and `deploy-pi-lite.sh` (Lite)
- [x] Target OS: Raspberry Pi OS Bookworm 64-bit

---

## Phase B — Dashboard surfaces ✅

**Status:** Complete (April 2026). Operator walkthrough: **[docs/agent-os/PHASE_B_DEMO.md](docs/agent-os/PHASE_B_DEMO.md)**.

| Milestone | Focus | Status |
|-----------|--------|--------|
| **B1** | Memory attach to agents/teams + agent context panel | ✅ |
| **B2** | Multi-step pipeline builder + run console | ✅ |
| **B3** | Governance APIs + console + model providers | ✅ |
| **B4** | Audit explorer + cross-links + demo script | ✅ |

See **[docs/agent-os/PHASE_B_PLAN.md](docs/agent-os/PHASE_B_PLAN.md)** for win gates.

### Phase C entry criteria

Start **Phase C** when at least one of:

- SQLite write contention or Pi deploy needs a split memory reader service
- Semantic retrieval requires a vector backend
- Agent runtimes need MCP gateway parity with HTTP memory tools

---

## v1.1 — Agent Harness Integration

Wire the dashboard to runtimes on **Proxmox LXCs** (see `docs/agent-os/V1_1.md`, `PROXMOX_RUNTIME_STACK.md`).

- [x] **Hermes Workspace** — UI `:3000`, gateway `:8642` link-out; bundle export + HTTP push + pull script
- [x] **OpenClaw** — gateway link-out + bundle push; status probe (`GET /api/openclaw/status`)
- [x] **Honcho** — bridge sync + CLI peer registration (Claude/Codex/Gemini)
- [x] Claude Code / Codex / Gemini — Honcho peers UI + `POST /api/honcho/peers`
- [x] Live runtime health — dashboard polls every 30s
- [x] Run history per agent — `agent_runs` table + `/api/agent-runs`
- [x] Cost tracking hook — run `cost_usd` → `cost_entries`

---

## v1.2 — Multi-Agent Orchestration

Move from managing individual agents to orchestrating teams.

- [ ] Team builder — compose agent groups with defined roles and communication flows
- [ ] Workflow designer — visual DAG editor for multi-agent pipelines
- [ ] Inter-agent messaging log — see what agents said to each other during runs
- [ ] Manager agent auto-delegation — manager agents route tasks to their department
- [ ] Shared memory / context store across agent teams

---

## v1.3 — Observability & Analytics

Understand what your agents are doing and how well they're doing it.

- [ ] Dashboard analytics overhaul — real charts (recharts) replacing placeholder stats
- [ ] Per-agent performance metrics (success rate, avg duration, cost per run)
- [ ] Department-level rollup views
- [ ] Alert rules — configurable triggers (agent failure, cost spike, stuck task)
- [ ] Output quality scoring — human feedback loop integrated into content review
- [ ] Export analytics to CSV / PDF

---

## v1.4 — Trixie Support

Bring kiosk deployment forward to the current Pi OS release.

- [ ] Replace X11/openbox kiosk with Wayland/labwc native autostart
- [ ] Replace xset/xrandr with Wayland equivalents (wlr-randr, swaymsg)
- [ ] Replace LightDM autologin with greetd or labwc session config
- [ ] Replace xinput_calibrator with libinput Wayland touch calibration
- [ ] Test and validate on Pi OS Trixie Lite and Desktop
- [ ] Update deploy scripts with Trixie auto-detection and native path
- [ ] Keep Bookworm scripts as-is for backward compatibility

---

## v1.5 — New Harness Support

Expand optional adapters beyond the primary Proxmox stack.

- [ ] NemoClaw harness adapter — NVIDIA NeMo-based agent orchestration
- [ ] CrewAI adapter (legacy) — only if still needed alongside Hermes/OpenClaw
- [ ] LangChain adapter — LangGraph / LangSmith integration
- [ ] AutoGen adapter — Microsoft AutoGen multi-agent sync
- [ ] Generic harness SDK — documented interface for adding custom frameworks
- [ ] Framework comparison view — side-by-side performance across harnesses

---

## v2.0 — Agent-OS Platform

Graduate from a dashboard to a platform.

- [ ] Multi-user auth (role-based: admin, operator, viewer)
- [ ] API keys & external access — REST API for CI/CD and external tooling
- [ ] Agent marketplace — share and import agent specs across instances
- [ ] Plugin system — extend dashboard with custom pages and integrations
- [ ] Webhook support — trigger external systems on agent events
- [ ] Mobile-responsive layout (phone-sized, not just tablet)
- [ ] Backup & restore — full database export/import with versioning

---

## Backlog (Unprioritized)

Ideas captured but not yet slotted into a milestone.

- [ ] Dark/light theme toggle (currently dark-only)
- [ ] Agent versioning — track spec changes over time with diff view
- [ ] Prompt library — reusable system prompt templates
- [ ] Skill dependency graph — visualize which agents share skills/tools
- [ ] Voice control for kiosk mode (wake word → agent command)
- [ ] Proxmox VM health integration — show host resource usage alongside agent status
- [ ] Notification system — push alerts to phone/Slack/Discord when agents need attention
- [ ] RAG integration — agents backed by vector stores for domain knowledge
- [ ] Fine-tune tracking — log fine-tune jobs and link resulting models to agents
