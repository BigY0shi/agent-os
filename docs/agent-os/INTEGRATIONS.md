# Integrations

Optional engines extend the control plane **without forking** core contracts.

## Memory backends

| Pattern | When to use |
|---------|-------------|
| **SQLite default** | Single-node, Pi, dev — control-plane catalog & governance |
| **Honcho (LXC)** | Dialectic user model for Hermes + multi-harness peers ([HONCHO.md](./HONCHO.md)) |
| **Vector DB** | Semantic retrieval at scale (pgvector, Chroma, etc.) |
| **MemoryOS-style MCP** | External long-term memory service ([BAI-LAB/MemoryOS](https://github.com/BAI-LAB/MemoryOS)) |

Integration approach:

1. Keep `/api/memory/*` as the **canonical** API for agents.
2. Add a small **adapter service** that mirrors those endpoints into external stores (future `services/` folder).
3. Store `embedding_ref` / `external_id` on `memory_entries` for dual-write or index pointers.

## Harness runtimes

Production layout (Proxmox LXCs): [PROXMOX_RUNTIME_STACK.md](./PROXMOX_RUNTIME_STACK.md).

| Runtime | Primary UI | Gateway | Notes |
|---------|------------|---------|-------|
| **Hermes Workspace** | `:3000` | `:8642` | Full app—not Nous `hermes dashboard` (`:9119`) |
| **OpenClaw** | — | ~`:18789` | Agent OS fills orchestration/governance gap |
| **Honcho** | Honcho dashboard / API | Honcho API | Shared memory; Hermes connected today |

See [../harness-sdk.md](../harness-sdk.md) for push/pull bundle format (OpenClaw, Hermes skills, etc.).

## MCP

Agent clients can call MCP tools that wrap the same operations as HTTP (parity with MemoryOS MCP tools: add / retrieve / profile). A reference server may be added under `services/memory-mcp/` in a later milestone.

## Ecosystem references (patterns only)

- [EverMind-AI/EverOS](https://github.com/EverMind-AI/EverOS)
- [holaboss-ai/holaOS](https://github.com/holaboss-ai/holaOS)
- [Q00/ouroboros](https://github.com/Q00/ouroboros)
- [craft-ai-agents/craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss)
- [buildermethods/agent-os](https://github.com/buildermethods/agent-os)

Treat these as **design bibliography**, not vendored dependencies.
