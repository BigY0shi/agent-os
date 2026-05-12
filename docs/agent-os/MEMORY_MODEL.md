# Memory model

Cross-agent memory is modeled in layers similar to hierarchical memory systems (e.g. [BAI-LAB/MemoryOS](https://github.com/BAI-LAB/MemoryOS), [MemTensor/MemOS](https://github.com/MemTensor/MemOS)). v1 persists in SQLite; embeddings/vector backends are optional adapters.

## Layers

| Layer | Semantics | Typical TTL |
|-------|-----------|----------------|
| `working` | Session-scratch, high churn | hours–days |
| `mid` | Consolidated episodes, recurring context | days–weeks |
| `long` | Stable facts, preferences, SOPs | months+ |
| `artifact` | Pointers to blobs (paths, URLs, object keys) | until revoked |

## Operations

- **Upsert**: create or update a `memory_entries` row (content + metadata).
- **Promote**: move layer `working → mid → long` (implemented as `layer` update + optional `promoted_at`).
- **Retrieve**: keyword/tag filter + optional full-text later; returns ranked rows (v1: simple `LIKE` / tag match).
- **Tombstone**: `status = forgotten` with `forgotten_at` (retention policy applied by offline job later).

## Attribution

Each entry supports:

- `agent_id` (optional): originating agent
- `team_id` (optional string): logical grouping / department / squad
- `sensitivity`: `public` | `internal` | `confidential`

## Access log

`memory_access_log` records:

- `actor` (subject from auth: `api_key:…`, `user:…`, `system`)
- `action`: `read` | `write` | `promote` | `forget`
- `memory_id` (nullable for bulk retrieve)

## Promotion rules (recommended defaults)

1. **Working → mid**: after N references or explicit operator/agent flag.
2. **Mid → long**: requires human approval OR high confidence structured extraction (future worker).

Document automation in harness adapters, not only in UI.

## API

See `/api/memory` and `/api/memory/retrieve` route implementations.
