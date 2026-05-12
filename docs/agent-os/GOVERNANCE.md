# Governance & autonomy

This control plane supports **permissioned autonomy**: agents propose actions; humans or policy approve. Concepts align with autonomy-with-guardrails patterns (e.g. [ninjahawk/hollow-agentOS](https://github.com/ninjahawk/hollow-agentOS)) and safety lifecycles (e.g. [PhyAgentOS/PhyAgentOS](https://github.com/PhyAgentOS/PhyAgentOS)).

## Roles (`lib/authz.js`)

| Role | Typical use |
|------|-------------|
| `admin` | Full access |
| `operator` | Approvals, memory write, pipeline run |
| `agent-runtime` | Memory read/write (scoped), pipeline run create, proposals |
| `viewer` | Read-only |

## API authentication (v1)

- Header: `Authorization: Bearer <token>` or `x-api-key: <token>`.
- Env: `AGENT_OS_API_KEYS` as JSON map `{ "token": "role" }`.
- If unset/empty, local dev defaults to **`admin`** (no breakage).

## Formal requests

**Decisions** (`decisions` table) support extended `type` values:

- `deployment`, `budget`, `content`, `config`, `outreach` (legacy)
- `tool_publish`, `infra_change`, `model_change`, `data_access`

Use `details` JSON for structured payloads: `{ "severity": "low|med|high", "scope": "repo:...", "evidence": ["memory:123"] }`.

## Tool lifecycle

- `tool_proposals`: draft spec/code, risk class, tests checklist.
- `tool_releases`: semver + artifact reference after approval.
- `safety_events`: violations, mitigations, overrides.

## Goals & opinions

- `agent_goals`: prioritized stack of goals with status.
- `agent_opinions`: structured claims with confidence + optional `memory_id` evidence link.

## Audit

All sensitive routes should call `appendAuditLog` (see `lib/audit.js`) with actor, action, resource, metadata.
