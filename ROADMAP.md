# Agent-OS Roadmap

**Last updated:** April 12, 2026

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

## v1.1 — Agent Harness Integration

Wire the dashboard to runtimes on **Proxmox LXCs** (see `docs/agent-os/PROXMOX_RUNTIME_STACK.md`).

- [ ] **Hermes Workspace** — UI `:3000`, gateway `:8642` (not Nous `hermes dashboard` `:9119`); link-out + bundle push
- [ ] **OpenClaw** — gateway ~`:18789`; bidirectional spec sync
- [ ] **Honcho** — memory LXC; optional bridge from `/api/memory` ↔ Honcho conclusions
- [ ] Claude Code / Codex / Gemini — Honcho peers on same workspace
- [ ] Live agent status polling (heartbeat from gateway → dashboard)
- [ ] Run history per agent — log of executions, outputs, durations
- [ ] Cost tracking tied to real API usage (OpenAI, Anthropic token metering)

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
