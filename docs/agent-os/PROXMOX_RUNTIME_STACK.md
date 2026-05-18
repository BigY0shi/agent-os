# Proxmox runtime stack (Hermes Workspace, OpenClaw, Honcho)

This documents **Yoshi's production layout**: agent runtimes in **LXC containers on Proxmox**, with Agent OS as the **control plane** (typically Pi or desktop—not inside the harness LXCs).

## Topology

```text
┌─────────────────────────────────────────────────────────────────┐
│  Agent OS (Next.js) — fleet specs, memory API, pipelines,       │
│  governance, audit, approvals, SKILL.md / AGENT.md export       │
│  (e.g. Pi kiosk or dev machine — NOT assumed colocated with LXCs)│
└───────────────┬─────────────────────────────────────────────────┘
                │ HTTP over LAN (URLs in Settings → Harness)
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Proxmox host                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐ │
│  │ LXC: Hermes      │  │ LXC: OpenClaw    │  │ LXC: Honcho       │ │
│  │ Workspace        │  │                  │  │ (memory service)  │ │
│  │ UI :3000         │  │ gateway ~:18789  │  │ API (self-hosted  │ │
│  │ gateway ~:8642   │  │ no workspace UI  │  │  or honcho.dev)   │ │
│  └────────┬─────────┘  └──────────────────┘  └────────▲─────────┘ │
│           │ already connected                         │           │
│           └───────────────────────────────────────────┘           │
│  Planned: Claude Code, Codex, Gemini → same Honcho workspace/peers │
└───────────────────────────────────────────────────────────────────┘
```

## Hermes: Workspace vs Nous dashboard

| Surface | What it is | Typical port | Use for |
|---------|------------|--------------|---------|
| **[Hermes Workspace](https://github.com/outsourc-e/hermes-workspace)** | Full operator app (chat, terminal, Conductor, Kanban, skills UI) | **`:3000`** UI, **`:8642`** gateway | Day-to-day Hermes operations |
| **Nous `hermes dashboard`** | CLI/bundled dashboard from Hermes Agent package | **`:9119`** | Not the primary UI in this stack |

When you say “Hermes on localhost:3000”, that is **Hermes Workspace** (often via SSH port-forward or Proxmox console proxy). Agent OS should **link out** to that UI and integrate via the **gateway**, not duplicate chat/memory/terminal.

**Hermes Kanban** (`~/.hermes/kanban.db` inside the Hermes LXC) is separate from Agent OS **`/pipeline`** (lifecycle stages). Treat them as different boards unless you build an explicit sync adapter.

## OpenClaw

- **Gateway-oriented** (~`:18789`); no Hermes-style workspace.
- Agent OS is especially useful here: specs, approvals, fleet status, bundle push via [harness-sdk.md](../harness-sdk.md).

## Honcho (shared memory LXC)

Honcho is the **dialectic user-modeling memory backend** ([honcho.dev](https://honcho.dev/), [plastic-labs/honcho](https://github.com/plastic-labs/honcho)). Hermes is already configured with `memory.provider: honcho` pointing at your Honcho LXC.

Planned consumers on the same Honcho deployment:

- **Claude Code** (IDE / CLI sessions as peers or workspaces)
- **Codex**
- **Gemini**

See [HONCHO.md](./HONCHO.md) for how this relates to Agent OS `memory_entries` and Hermes file memory (`MEMORY.md` / `USER.md`).

## Agent OS responsibilities (by runtime)

| Concern | Hermes Workspace | OpenClaw | Honcho LXC |
|---------|------------------|----------|------------|
| Operator chat / terminal | ✅ Workspace UI | ❌ use gateway clients | — |
| Multi-agent Kanban (Hermes) | ✅ in LXC | — | — |
| AGENT.md / SKILL.md source of truth | ✅ export from Agent OS → push | ✅ bundle push | — |
| Long-term user model | via Honcho provider | future adapter | ✅ canonical for connected harnesses |
| Approvals / audit / RBAC | ✅ Agent OS | ✅ Agent OS | read-only via adapters (future) |
| Pipeline lifecycle board | ✅ Agent OS `/pipeline` | ✅ Agent OS | — |

## Configuration (today)

1. **Settings → Harness** — set LAN URLs (defaults use `localhost` when port-forwarded):
   - Hermes Workspace UI: `http://localhost:3000`
   - Hermes gateway: `http://localhost:8642`
   - OpenClaw gateway: `http://localhost:18789`
   - Honcho API base: your LXC URL (or `https://api.honcho.dev` if cloud)
2. **Agents → Framework** — choose **Hermes Workspace** for agents deployed to that LXC.
3. **Memory explorer** — Agent OS SQLite memory is the **control-plane catalog**; Honcho holds **runtime session memory** until a sync bridge exists.

## Future implementation (roadmap)

- `runtime_instances` table: `runtime_type`, `ui_url`, `gateway_url`, `proxmox_vm_id`, `honcho_workspace_id`, last heartbeat.
- Health poll: `GET` gateway `/health` or equivalent.
- Honcho adapter: optional mirror of conclusions into `memory_entries` with `external_id` / `source: honcho`.

## Related

- [HONCHO.md](./HONCHO.md)
- [INTEGRATIONS.md](./INTEGRATIONS.md)
- [MEMORY_MODEL.md](./MEMORY_MODEL.md)
- [Harness SDK](../harness-sdk.md)
