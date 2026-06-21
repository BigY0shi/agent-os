# Harness deploy — pull & push

How to get Agent OS specs onto **Hermes** (`192.168.0.168`) or **OpenClaw** LXCs.

## Pull (recommended)

On the **runtime LXC**, clone or copy `scripts/harness-pull-bundle.mjs` from this repo, then:

```bash
# Hermes LXC
export AGENT_OS_URL=http://<agent-os-host>:3000   # Pi or dev machine
export AGENT_OS_API_KEY=your-operator-token       # if AGENT_OS_API_KEYS set

node scripts/harness-pull-bundle.mjs --out ~/.hermes/agent-os-bundle

# Single agent only
node scripts/harness-pull-bundle.mjs --agent-id 1 --out ~/.hermes/agent-os-bundle
```

Cron every 5 minutes:

```cron
*/5 * * * * AGENT_OS_URL=http://192.168.0.x:3000 node /opt/agent-os/scripts/harness-pull-bundle.mjs >> /var/log/agent-os-pull.log 2>&1
```

## Push (HTTP)

From Agent OS (operator):

```bash
curl -X POST http://localhost:3000/api/harness/push \
  -H 'Content-Type: application/json' \
  -d '{"target":"hermes"}'

# OpenClaw (when AGENT_OS_OPENCLAW_GATEWAY_URL is set)
curl -X POST http://localhost:3000/api/harness/push \
  -H 'Content-Type: application/json' \
  -d '{"target":"openclaw","agent_id":3}'
```

UI: **Settings → Harness → Push to Hermes** or **Agents → Runtime → Push bundle**.

Agent OS tries gateway paths in order (`/api/agent-os/bundle`, …). Override with:

```bash
AGENT_OS_HERMES_PUSH_URL=http://192.168.0.168:8642/api/agent-os/bundle
AGENT_OS_HERMES_GATEWAY_TOKEN=optional
AGENT_OS_OPENCLAW_GATEWAY_URL=http://<ip>:18789
AGENT_OS_OPENCLAW_PUSH_URL=http://<ip>:18789/api/agent-os/bundle
```

If HTTP push fails, use **pull** on the LXC — Hermes gateway may not expose a bundle ingest endpoint yet.

## Bundle layout

See [harness-sdk.md](../harness-sdk.md). Output directory:

```text
~/.hermes/agent-os-bundle/
  manifest.json
  agents/<slug>/AGENT.md
  skills/<slug>-SKILL.md
  pipelines/<id>-<name>.json
```

Point Hermes/OpenClaw config at this directory or sync into your existing skills tree.

## Honcho CLI peers

Register Claude Code, Codex, Gemini as Honcho AI peers (workspace `hermes`, user peer `yoshi`):

- **Settings → Harness → Honcho CLI peers → Register on Honcho**
- API: `POST /api/honcho/peers` with `{ "slug": "claude-code" }`

Env defaults match your stack:

```bash
AGENT_OS_HONCHO_URL=http://192.168.0.99:8000
AGENT_OS_HONCHO_API_KEY=local-dev
AGENT_OS_HONCHO_WORKSPACE=hermes
AGENT_OS_HONCHO_USER_PEER=yoshi
```

## Related

- [V1_1.md](./V1_1.md)
- [PROXMOX_RUNTIME_STACK.md](./PROXMOX_RUNTIME_STACK.md)
- [HONCHO.md](./HONCHO.md)
