# Documentation index

Master map of Agent OS docs. Start here for presentations, engineering, or ops.

---

## Present this week (stakeholder pack)

| Doc | Purpose | Audience |
|-----|---------|----------|
| [EXECUTIVE_OVERVIEW.md](./EXECUTIVE_OVERVIEW.md) | One-pager / leave-behind | Execs, advisors |
| [PRESENTATION.md](./PRESENTATION.md) | Slides outline, speaker notes, live demo, Q&A | Presenter |
| [DIAGRAMS.md](./DIAGRAMS.md) | Mermaid figures for slides | Presenter / eng |
| [WEEK_1_DEVICE_FIRMWARE.md](./WEEK_1_DEVICE_FIRMWARE.md) | 7-day device + kiosk firmware plan + acceptance | Eng / ops |
| [DEVICE_BOM.md](./DEVICE_BOM.md) | Hardware list + handoff sticker | Ops |
| [STAKEHOLDER_FAQ.md](./STAKEHOLDER_FAQ.md) | Short answers to common questions | All |

---

## Engineering north star

| Doc | Purpose |
|-----|---------|
| [ECOSYSTEM_STANDUP.md](./ECOSYSTEM_STANDUP.md) | Greenfield spec: vision, schema, phases, runbook |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Control-plane layers & threat model |
| [PROXMOX_RUNTIME_STACK.md](./PROXMOX_RUNTIME_STACK.md) | Hermes / OpenClaw / Honcho LXC topology |
| [HONCHO.md](./HONCHO.md) | Shared user-model memory |
| [MEMORY_MODEL.md](./MEMORY_MODEL.md) | Fleet memory layers |
| [MODEL_PROVIDERS.md](./MODEL_PROVIDERS.md) | Runtime vs inference providers |
| [GOVERNANCE.md](./GOVERNANCE.md) | Roles, decisions, autonomy |
| [SKILL_PIPELINE_SPEC.md](./SKILL_PIPELINE_SPEC.md) | Pipeline JSON contract |
| [INTEGRATIONS.md](./INTEGRATIONS.md) | Adapters & bibliography |
| [V1_1.md](./V1_1.md) | Harness integration APIs |
| [HARNESS_DEPLOY.md](./HARNESS_DEPLOY.md) | Bundle pull/push to LXCs |
| [../harness-sdk.md](../harness-sdk.md) | Bundle layout |

---

## Operator how-tos

| Doc | Purpose |
|-----|---------|
| [PHASE_B_DEMO.md](./PHASE_B_DEMO.md) | 10-minute operator walkthrough (W1–W4) |
| [PHASE_B_PLAN.md](./PHASE_B_PLAN.md) | Phase B milestones & win gates (complete) |
| Repo `README.md` | Dev env, runtime env vars |
| Repo `ROADMAP.md` | Product roadmap |
| `deploy-pi.sh` / `deploy-pi-lite.sh` | Device firmware installers |

---

## Reading order by role

### Presenter (today)

1. EXECUTIVE_OVERVIEW  
2. PRESENTATION  
3. DIAGRAMS (§2, §4, §6, §8)  
4. STAKEHOLDER_FAQ  
5. WEEK_1_DEVICE_FIRMWARE (acceptance table only)

### Engineer (build week)

1. WEEK_1_DEVICE_FIRMWARE  
2. DEVICE_BOM  
3. ECOSYSTEM_STANDUP (§5–§10)  
4. V1_1 + HARNESS_DEPLOY  
5. PHASE_B_DEMO (validation)

### New engineer (onboarding)

1. ECOSYSTEM_STANDUP  
2. ARCHITECTURE  
3. PROXMOX_RUNTIME_STACK + HONCHO  
4. MEMORY_MODEL + GOVERNANCE + MODEL_PROVIDERS  
5. DOC_INDEX (this file) for deep links

---

## Status snapshot

| Area | Status |
|------|--------|
| Control plane software (v1.0 + Phase B + v1.1 slice) | ✅ In repo |
| Pi deploy scripts | ✅ Ready |
| Device flash + kiosk soak | ⏳ Week-1 execution |
| Hermes/Honcho on LAN | ⚙️ Optional stretch for demo |

---

*Last updated: presentation pack · Aug 2026*
