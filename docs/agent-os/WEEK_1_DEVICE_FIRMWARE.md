# Week 1 — Device + working firmware

**Deadline:** 7 days from presentation kickoff  
**Definition of done:** Raspberry Pi powers on into fullscreen Agent OS kiosk; operator can govern the fleet on-device.

**“Firmware” here** = production Next.js service + systemd unit + Chromium kiosk stack (not microcontroller firmware).

---

## Acceptance criteria (demo gates)

| # | Gate | Pass when |
|---|------|-----------|
| **D1** | Boot | Cold boot ≤ 90s to visible kiosk UI (no desktop clutter) |
| **D2** | Touch | Primary nav works with finger (Dashboard, Agents, Approvals, Memory) |
| **D3** | Offline core | Seeded agents + create/approve decision without Hermes/Honcho |
| **D4** | Audit | Approve → row visible in `/audit` |
| **D5** | Survive reboot | After power cycle, service + kiosk return automatically |
| **S1** | LAN stretch | If Hermes/Honcho up: dashboard pills green |
| **S2** | Stretch sync | Honcho → Memory sync succeeds |

**Out of scope for week 1:** Trixie Wayland kiosk, multi-user login UI, vector search, full OpenClaw bidirectional sync, v1.2 team orchestration.

---

## Bill of materials (device)

| Item | Spec | Notes |
|------|------|-------|
| Compute | Raspberry Pi **5** (preferred) or Pi 4 4GB+ | aarch64 |
| Storage | 32GB+ microSD (A2) or NVMe on Pi 5 | Flash **Bookworm 64-bit** |
| Display | Official 7" touch **or** HDMI touch panel | Tested with Chromium `--kiosk` |
| Power | Official PSU (Pi 5: 27W) | Avoid underpower brownouts |
| Network | Ethernet preferred; Wi‑Fi OK | Static IP optional |
| Optional | USB keyboard | Fallback if touch fails mid-demo |

**OS image:** [Raspberry Pi OS Bookworm 64-bit](https://www.raspberrypi.com/software/operating-systems/)  
- Desktop → `deploy-pi.sh`  
- Lite → `deploy-pi-lite.sh`  
**Do not use Trixie** for week-1 kiosk (Wayland/labwc breaks current autostart).

---

## Day-by-day plan

### Day 0 (presentation day) — Align & freeze scope

- [ ] Present [EXECUTIVE_OVERVIEW.md](./EXECUTIVE_OVERVIEW.md) + diagrams
- [ ] Confirm hardware on hand (Pi + screen + PSU + card)
- [ ] Freeze: **D1–D5 only**; S1–S2 if LAN ready
- [ ] Assign: who flashes SD, who owns LAN IPs, who demos

### Day 1 — Flash & baseline OS

- [ ] Flash Bookworm 64-bit; enable SSH; set hostname `agent-os-pi`
- [ ] `apt update && apt full-upgrade`
- [ ] Confirm architecture `uname -m` → `aarch64`
- [ ] Join LAN; note Pi IP; optional static lease on router
- [ ] Clone or `scp` repo to `/home/pi/agent-os`

### Day 2 — App “firmware” install

```bash
cd ~/agent-os
# Desktop image:
./deploy-pi.sh --app-only
# or Lite:
# ./deploy-pi-lite.sh   # follow prompts; can do app first
```

- [ ] `npm ci && npm run build` succeeds on device (or build on CI + copy `.next`)
- [ ] systemd `agent-os` enabled; `curl -I http://localhost:3000` → 200
- [ ] Env file ready (see below) — even if Honcho offline

**Minimal env (`/home/pi/agent-os/.env.local` or systemd EnvironmentFile):**

```bash
AGENT_OS_HERMES_UI_URL=http://192.168.0.168:3000
AGENT_OS_HERMES_GATEWAY_URL=http://192.168.0.168:8642
AGENT_OS_HONCHO_URL=http://192.168.0.99:8000
AGENT_OS_HONCHO_API_KEY=local-dev
# Demo venue without keys is OK; for production set:
# AGENT_OS_API_KEYS='{"demo-op":"operator"}'
```

### Day 3 — Kiosk shell

```bash
./deploy-pi.sh --kiosk-only
# or complete lite installer kiosk section
```

- [ ] Autologin works
- [ ] Chromium launches `--kiosk` to `http://localhost:3000`
- [ ] Screen blanking disabled; cursor hide optional
- [ ] Rotate display if needed (`xrandr` / screen config)
- [ ] Touch: 44px targets usable (CSS already touch-oriented)

**Manual rescue:** `~/start-kiosk.sh` if autostart fails.

### Day 4 — Operator demo path (offline)

Run [PHASE_B_DEMO.md](./PHASE_B_DEMO.md) abbreviated on-device:

1. Dashboard loads
2. Agents → open Content Agent
3. Approvals → create/approve a decision (or use seeded pending)
4. Memory → add entry + promote
5. Audit → filter `decision` / `memory`

- [ ] Record 60s screen recording (backup if live demo fails)
- [ ] Fix any touch scroll / modal issues

### Day 5 — Hardening + reboot soak

- [ ] Cold boot ×5; measure time-to-UI
- [ ] `systemctl status agent-os` after reboot
- [ ] Disk space check (`df -h`); prune `node_modules` caches if needed
- [ ] Optional: `AGENT_OS_API_KEYS` with operator token; verify viewer cannot approve
- [ ] Label device physically: “Agent OS kiosk — do not flash Trixie”

### Day 6 — LAN stretch (if available)

- [ ] From Pi: `curl -s -o /dev/null -w "%{http_code}\n" http://192.168.0.99:8000/health`
- [ ] From Pi: `curl -s -o /dev/null -w "%{http_code}\n" http://192.168.0.168:3000/`
- [ ] Dashboard pills green
- [ ] Settings → Test Honcho → Sync Honcho → Memory
- [ ] Agents → Hermes link-out (if browser can open LAN)

### Day 7 — Dress rehearsal & deliver

- [ ] Full dry run of [PRESENTATION.md](./PRESENTATION.md) demo script
- [ ] Backup: SD card image (`dd` or Pi Imager backup) + git tag `device-v1.0`
- [ ] One-page leave-behind printed / PDF from EXECUTIVE_OVERVIEW
- [ ] Handoff card taped to device (Wi‑Fi, IP, SSH user, reboot tip)

---

## Firmware components checklist

| Component | Path / unit | Role |
|-----------|-------------|------|
| App build | `~/agent-os/.next` | Production UI/API |
| Process manager | `agent-os.service` | Keeps Next.js up |
| Kiosk | `~/.config/autostart/agent-os-kiosk.desktop` | Chromium fullscreen |
| Manual kiosk | `~/start-kiosk.sh` | Demo recovery |
| Deployers | `deploy-pi.sh`, `deploy-pi-lite.sh` | Idempotent install |

---

## Demo failure playbook

| Failure | Fix in &lt;2 min |
|---------|------------------|
| White screen | SSH: `sudo systemctl restart agent-os`; wait; refresh |
| Desktop instead of kiosk | Run `~/start-kiosk.sh` |
| Touch dead | Plug USB keyboard/mouse; continue demo |
| Honcho red | Say “offline mode — fleet governance still works on device SQLite” |
| Wrong IP | Show dashboard from laptop on same LAN as backup surface |

---

## Success metrics (week 1)

| Metric | Target |
|--------|--------|
| Cold boot → UI | ≤ 90s |
| Demo path length | ≤ 5 minutes |
| Reboot survival | 5/5 |
| Stakeholder can complete approve + audit | Without developer help |

---

## After week 1 (backlog, not blocking)

1. Production API keys + HTTPS reverse proxy (Caddy/nginx)
2. Hermes pull cron (`scripts/harness-pull-bundle.mjs`)
3. Honcho peer registration for Claude/Codex/Gemini
4. Trixie / Wayland kiosk path (ROADMAP v1.4)
5. Nightly SQLite backup to NAS

---

## Related

- [EXECUTIVE_OVERVIEW.md](./EXECUTIVE_OVERVIEW.md)
- [PRESENTATION.md](./PRESENTATION.md)
- [ECOSYSTEM_STANDUP.md](./ECOSYSTEM_STANDUP.md)
- [PROXMOX_RUNTIME_STACK.md](./PROXMOX_RUNTIME_STACK.md)
- Repo root: `deploy-pi.sh`, `deploy-pi-lite.sh`
