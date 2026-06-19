# Model providers & runtimes (Phase B3)

Agent OS separates **where an agent runs** (runtime / harness) from **which model answers** (provider + model id). Honcho remains orthogonal (shared memory).

## Two axes

```text
Runtime (harness)          Model (provider + model_id)
─────────────────          ───────────────────────────
hermes-workspace      +    (configured inside Hermes / gateway)
openclaw              +    (OpenClaw session config)
claude-code           +    anthropic API · claude-sonnet-…
codex                 +    openai API · gpt-4.1 …
gemini                +    google API · gemini-2.5 …
custom worker         +    ollama-cloud · llama3.3
                       or  ollama-local · qwen2.5:14b
```

| Concept | Examples | Configured in Agent OS (B3) |
|---------|----------|-----------------------------|
| **Runtime** | Hermes Workspace, OpenClaw, Claude Code CLI, Codex CLI | Agent `framework` / harness URLs (Settings) |
| **Model provider** | Ollama Cloud, Ollama local, Anthropic, OpenAI, Google | `model_providers` table + Settings tab |
| **Model id** | `llama3.3`, `claude-sonnet-4-6`, `gpt-4.1` | Agent `model_id` + provider default |
| **Memory** | Honcho LXC | Separate — not a model provider |

## Provider kinds

| `kind` | Meaning | Typical fields |
|--------|---------|----------------|
| `api` | HTTP inference endpoint | `base_url`, `default_model`, `api_key_env` (env var **name**, not secret in DB) |
| `cli` | Tool uses its own auth; Agent OS tracks identity only | `cli_command` hint, link to runtime harness |

### Seed providers (v1 B3)

| slug | kind | label | base_url (example) |
|------|------|-------|---------------------|
| `ollama-cloud` | api | Ollama Cloud | `https://ollama.com` (or documented cloud API base) |
| `ollama-local` | api | Ollama (LAN) | `http://192.168.x.x:11434` |
| `anthropic` | api | Anthropic | `https://api.anthropic.com` |
| `openai` | api | OpenAI | `https://api.openai.com/v1` |
| `google` | api | Google Gemini | `https://generativelanguage.googleapis.com` |
| `openai-compatible` | api | OpenAI-compatible | custom base (LocalAI, vLLM, etc.) |

CLI runtimes (`claude-code`, `codex`, `gemini`) do **not** duplicate provider rows — agents using those runtimes may still set `model_provider_id` when the CLI is backed by a known API, or leave null when the CLI manages auth internally.

## Schema (B3)

```sql
CREATE TABLE model_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  kind TEXT CHECK(kind IN ('api', 'cli')) NOT NULL DEFAULT 'api',
  label TEXT NOT NULL,
  base_url TEXT,
  default_model TEXT,
  api_key_env TEXT,        -- e.g. OLLAMA_API_KEY — never store secret value here
  config_json TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);

-- agents table (migration):
-- model_provider_id INTEGER REFERENCES model_providers(id)
-- model_id TEXT
```

## AGENT.md export (B3)

```yaml
## Configuration
- **Runtime:** hermes-workspace
- **Model provider:** ollama-cloud
- **Model id:** llama3.3
```

JSON config blob may include:

```json
{
  "runtime": "hermes-workspace",
  "model_provider": "ollama-cloud",
  "model_id": "llama3.3"
}
```

## Governance: `model_change`

When an agent or runtime requests a different model:

1. Create `decisions` row with `type: model_change`.
2. `details` JSON: `{ "agent_id": 1, "from_model": "llama3.3", "to_model": "qwen2.5:14b", "provider_slug": "ollama-local", "severity": "med" }`.
3. Operator approves → update agent `model_id` (and optionally provider) → audit log.

Agent-runtime may POST `model_change` decisions; only operator+ applies the agent update.

## Settings UI (B3)

**Settings → Model providers** (new tab or section under Harness):

- List providers, enable/disable, edit base URL + default model
- API key: field documents **env var name** on the Pi/server (`OLLAMA_API_KEY`), not the secret in SQLite
- Test connection: optional `GET /api/model-providers/:id/health` (ping base URL / models list)

**Settings → Harness** stays for **runtime URLs** (Hermes, OpenClaw, Honcho).

## Honcho peers (unchanged)

Planned Honcho `hosts` for CLI runtimes share the same user peer (`yoshi`); model choice does not change Honcho workspace — only which inference backend the harness calls.

## Related

- [PHASE_B_PLAN.md](./PHASE_B_PLAN.md) — milestone B3
- [GOVERNANCE.md](./GOVERNANCE.md) — `model_change` approvals
- [PROXMOX_RUNTIME_STACK.md](./PROXMOX_RUNTIME_STACK.md)
