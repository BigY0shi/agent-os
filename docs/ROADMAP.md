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
| 28 | **ESP32 server BMC — vitals + remote power control** | 7 | 8 | 5 | 5 | 1.15 | **7.71** | 🔴 |
| 29 | **Infrastructure panel — dashboard + kiosk vitals view** | 6 | 7 | 6 | 5 | 1.15 | **7.19** | 🟠 |
| 30 | **Companion app — CrowPanel Advanced (ESP32-P4)** | 6 | 8 | 4 | 4 | 1.15 | **7.02** | 🟠 |
| 31 | Companion app — ESP32-P4 multi-board (Guition, Tab5) | 3 | 6 | 5 | 5 | 1.05 | **5.15** | 🟡 |
| 32 | K210 vision sensor node (LilyGo / Sipeed) | 2 | 6 | 5 | 4 | 0.90 | **4.05** | 🟡 |
| 33 | K230 thin client / compact Agent-OS host | 2 | 7 | 4 | 4 | 0.85 | **3.99** | 🟢 |
| 34 | Skin / color / theme customization system | 3 | 6 | 5 | 5 | 1.05 | **5.15** | 🟡 |
| 35 | Widescreen & bar display layout mode | 4 | 6 | 5 | 4 | 0.90 | **4.50** | 🟡 |
| 36 | E-paper companion (7.5" Waveshare + Pi Zero 2 W) | 4 | 7 | 5 | 5 | 1.05 | **5.83** | 🟡 |
| 37 | K230 T-Display — dedicated decision queue terminal | 3 | 6 | 7 | 7 | 1.05 | **5.78** | 🟡 |

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

**Infrastructure: ESP32 Out-of-Band Server Monitor** (Score: 7.71 🔴)
> A small ESP32 wired directly into each Proxmox/Claw machine's motherboard headers. Operates independently of the host OS — reports vitals and accepts power commands even when the machine is completely unresponsive.

- [ ] ESP32 firmware — `agent-os-bmc` (separate repo, Arduino / ESP-IDF)
  - Power state detection via ATX 5VSB standby rail voltage sense
  - Remote power on / off via GPIO wired to ATX power button header
  - Remote restart via GPIO wired to ATX reset button header
  - Temperature monitoring via DS18B20 or NTC thermistor on GPIO
  - Uptime counter (increments from last detected power-on event)
  - WiFi — HTTP POST vitals to Agent-OS `/api/infrastructure` every 30s
  - HTTP endpoint on ESP32 for receiving power commands from Agent-OS
  - Watchdog: if Agent-OS stops polling, ESP32 can auto-restart host after configurable timeout
- [ ] Agent-OS `/api/infrastructure` endpoint — receive + store vitals per node
- [ ] Infrastructure panel in dashboard — server cards showing per-node:
  - Power state (Online / Offline / Unknown)
  - CPU temperature + trend sparkline
  - Uptime counter
  - **Power On / Restart / Shutdown** action buttons (Score: 7.19 🟠)
  - Last seen timestamp
- [ ] Alert rules for infrastructure — offline detection, temperature threshold breach
- [ ] Infrastructure cards on Pi kiosk home screen — always-visible server health strip
- [ ] Companion app integration — server status on CrowPanel with one-tap restart

---

## v1.3 — Data & Visibility 🟠 High Priority
> **Theme:** Turn raw activity into insight**

- [ ] Replace placeholder analytics charts with real recharts graphs (Score: 7.19)
- [ ] Department-level rollup views — aggregated metrics per C-Suite division
- [ ] Per-agent performance metrics — success rate, avg duration, cost per run
- [ ] Agent spec versioning — diff viewer between spec versions (Score: 5.93)
- [ ] Output quality scoring — close the human feedback loop on content review
- [ ] Export reports to CSV and PDF
- [ ] Proxmox host resource view — CPU, RAM, temp pulled from Proxmox API + ESP32 BMC nodes

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

**Display Layout Modes** (Score: 4.50 🟡)
- [ ] **Widescreen layout** (≥1600px) — 3-column fleet view, wider pipeline cards, expanded analytics panels. Targets the 10.4" 1600×1200 and similar landscape panels
- [ ] **Bar / shelf display layout** — ultra-wide low-height displays (e.g. 1920×480, 2560×360). Optimized single-row status strip: agent health, pending decisions count, cost today, server uptime. Perfect for a wall-mounted always-visible ops bar
- [ ] **Compact / dense mode** — reduced card padding and font size for smaller screens or information-dense operator preference
- [ ] Display layout selector in Settings — user picks from Auto / Standard / Widescreen / Bar / Compact

**Skin & Theme Customization** (Score: 5.15 🟡)
> Currently Agent-OS has one look: dark mode, orange accent (#F97316). This opens it up.
- [ ] Accent color picker — replace the hard-coded orange with any user-chosen color, applied across all badges, buttons, highlights, and active states
- [ ] Theme presets — Dark (current), Light, OLED Black (true black for AMOLED displays like K230 T-Display), High Contrast, Slate, Midnight Blue
- [ ] Font size / density slider — small / medium / large, affects all text and spacing globally
- [ ] Department color customization — override the per-department accent colors in the fleet view
- [ ] Theme stored in localStorage + exportable as a JSON skin file — share your setup or load a community theme
- [ ] Upgrade dark/light toggle (currently Score: 3.60) to full theme system — absorbs that backlog item

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

## v2.1 — Agent-OS Companion 🟠 High Priority
> **Theme:** Agent-OS on every surface — not just the Pi**
>
> A standalone firmware project (separate repo: `agent-os-companion`) that runs on ESP32-P4 display panels and communicates with any self-hosted Agent-OS instance via its REST API. Ships as a flashable `.bin` via ESP Web Tools — no toolchain required.

### Phase 1 — CrowPanel Advanced (Primary Target) 🟠 Score: 7.02
The CrowPanel Advanced 7" with ESP32-P4 is the first and primary supported board. Chosen for its 32MB PSRAM, 1024×600 IPS display, onboard ESP32-C6 (WiFi 6), swappable radio module slot (LoRa, Zigbee, Thread, nRF), and 2MP camera.

- [ ] Core firmware architecture — ESP-IDF 5.4+ project structure with LVGL 9.x
- [ ] WiFi provisioning screen — enter Agent-OS host IP + port on first boot
- [ ] Fleet overview screen — agents by department, counts, stage breakdown
- [ ] Pending decisions screen — scrollable queue with **Approve** / **Reject** touch buttons (the killer feature)
- [ ] Active tasks ticker — scrolling list of in-progress tasks with agent name
- [ ] Cost today widget — live spend counter polling the `/api/analytics` endpoint
- [ ] Alert banner — full-screen flash when agent fails, decision queue exceeds threshold, or server goes offline
- [ ] Infrastructure strip — server health cards at bottom of companion home screen, one-tap restart via ESP32 BMC
- [ ] Settings screen — host URL, polling interval, display brightness, rotation
- [ ] REST API polling loop — configurable interval (default: 5s), reconnect on failure
- [ ] CrowPanel BSP (Board Support Package) — display init, touch controller, WiFi via C6 co-processor
- [ ] ESP Web Tools flasher page — flash firmware from browser at `companion.agent-os.dev`

**LoRa module path** (swappable radio slot):
- [ ] LoRa transport option — communicate with Pi over SX1262 when WiFi isn't available (e.g. separate building, weak signal zone)
- [ ] Requires LoRa gateway on Pi side (simple Python bridge to Agent-OS REST API)

**Camera path** (2MP onboard):
- [ ] Motion/presence detection trigger — wake from sleep and surface alerts when presence detected
- [ ] Feed thumbnail to an agent's decision queue as a vision input event

---

### Phase 2 — ESP32-P4 Multi-Board Support 🟡 Score: 5.15
Same firmware core, hardware-specific BSP layers. All three run the same ESP32-P4 + 32MB PSRAM, so the port is mostly display driver + touch controller swap-out.

| Board | Display | Resolution | Notes |
|---|---|---|---|
| **Guition JC8012P4A1** | 10.1" IPS | 1024×600 | Largest screen, best for wall mount, very affordable |
| **Guition 7" ESP32-P4** | 7" IPS | 800×480 | Budget pick, close to CrowPanel specs |
| **M5Stack Tab5** | 5" IPS | 1280×720 | Sharpest display, official ESPHome support, tablet form factor |

- [ ] Guition 7" BSP
- [ ] Guition 10.1" BSP — best option for wall-mounted ops display
- [ ] M5Stack Tab5 BSP — leverages existing ESPHome device definition, also enables HA dashboard side-by-side with Agent-OS companion view
- [ ] Board selector in ESP Web Tools flasher — pick your hardware, flash the right `.bin`

---

### Phase 4 — E-Paper Companion 🟡 Score: 5.83
> A completely different companion paradigm. E-paper uses zero power between refreshes, is readable in direct sunlight, and looks like a printed page. Perfect for an always-on ambient status display that you glance at rather than interact with.

**Target hardware:** Waveshare 7.5" e-Paper HAT (800×480 or 880×528) driven by a **Raspberry Pi Zero 2 W** via SPI GPIO. Total BOM: ~$45. Mounts flat on a wall, sits on a desk stand, or sticks to a monitor bezel.

**Why e-paper fits Agent-OS perfectly:**
- Agent-OS data (fleet status, decision queue, cost, task counts) changes on the order of minutes to hours — not seconds. E-paper's slow refresh is irrelevant.
- A wall-mounted e-paper panel showing "3 decisions pending · 2 agents failing · $4.12 spent today" needs no interaction and no backlight — it just _is there_
- The always-on zero-power nature makes it ideal for a shared ops space or homelab wall

**Architecture:** Python daemon on Pi Zero 2 W, not LVGL firmware
- [ ] `agent-os-epaper` Python script — polls Agent-OS REST API, renders layout to bitmap using PIL/Pillow, pushes to display via Waveshare SPI library
- [ ] Layout sections:
  - **Header bar** — hostname, last updated timestamp
  - **Fleet health** — agents by stage (Ideate/Build/Test/Deploy/Observe), count per stage
  - **Decisions** — pending count + top 3 decision titles truncated to one line each
  - **Active tasks** — count + top 3 in-progress task names
  - **Cost today** — large number, prominent
  - **Server health** — ESP32 BMC nodes: power state + temp per machine
- [ ] Trigger modes — scheduled refresh (every 15/30/60 min configurable) + webhook-triggered instant refresh when Agent-OS fires a high-priority alert
- [ ] 3-color support — black/white/red Waveshare variant: red used for alerts, failing agents, and overdue decisions
- [ ] `install-epaper.sh` — one-command setup script for Pi Zero 2 W, mirrors the deploy-pi-lite.sh approach
- [ ] Systemd service + timer for scheduled refresh
- [ ] Agent-OS Settings page — toggle e-paper webhook endpoint on/off, configure refresh interval

---

### Phase 5 — Kendryte Hardware 🟢 Score: 3.99–4.05
Further out. Different chip family (RISC-V Kendryte), different SDK, different use cases.

**K210 — Vision Sensor Node** (Score: 4.05)
The K210 is not a display platform — it's an edge AI inference chip with an 8MB SRAM constraint that makes LVGL impractical. Its strength is the KPU (Knowledge Processing Unit) for local vision inference.

- [ ] K210 agent sensor node firmware — runs on LilyGo T-Watch K210 or Sipeed Maix boards
- [ ] Publishes vision events to Agent-OS via ESP32 WiFi bridge (HTTP POST to `/api/tasks`)
- [ ] Use cases: presence detection, gesture commands, object classification feeding agent decisions
- [ ] MaixPy-based (MicroPython) for rapid development

**K230 — Dedicated Decision Queue Terminal** (Score: 5.78 🟡)
The LilyGo T-Display K230 runs Linux with 1GB LPDDR4 @ 1.6GHz RISC-V and a 4.1" AMOLED 1232×568 display. Too small for a full Agent-OS dashboard, but the screen size and sharpness are ideal for a single-purpose terminal that lives on your desk.

- [ ] Chromium kiosk pointed at `/approvals` — the decision queue page, full-screen on the AMOLED. Tap Approve/Reject directly on the device, no SSH, no separate browser tab
- [ ] Custom `/approvals/kiosk` route — stripped layout optimized for 4.1" (larger buttons, no sidebar, high-contrast for AMOLED)
- [ ] `deploy-k230.sh` — Chromium kiosk autostart script for K230 Linux, mirrors deploy-pi.sh
- [ ] OLED Black theme preset (from v1.5 skin system) — true black background looks exceptional on AMOLED, saves power
- [ ] Doubles as an Agent-OS secondary node if needed — 1GB RAM can run the Next.js server in a pinch

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
- **Voice control** — wake word triggers agent commands on the Pi kiosk (Score: 3.87). More realistically first lands on the CrowPanel companion app via its onboard mic + speaker — "approve all decisions", "show CTO agents", "what's my cost today".
- **Autonomous spec evolution** — agents propose edits to their own AGENT.md based on observed performance. Humans approve or reject the diff.
- **Cross-org agent lending** — securely loan specialized agents to trusted partners, metered by usage.
- **Agent-OS Cloud** — fully managed SaaS where organizations run their entire agent workforce without touching infrastructure.
- **Micro-animations** — spring-physics card transitions, stagger-in fleet views, progress trails on pipeline moves. (Score: 3.92)

---

## Changelog

| Version | Date | Summary |
|---|---|---|
| v1.0 | Apr 2026 | Foundation — SQLite, scaffold form, Pi kiosk deployment |
