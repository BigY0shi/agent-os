# Integrations

Optional engines extend the control plane **without forking** core contracts.

## Memory backends

| Pattern | When to use |
|---------|-------------|
| **SQLite default** | Single-node, Pi, dev |
| **Vector DB** | Semantic retrieval at scale (pgvector, Chroma, etc.) |
| **MemoryOS-style MCP** | External long-term memory service ([BAI-LAB/MemoryOS](https://github.com/BAI-LAB/MemoryOS)) |

Integration approach:

1. Keep `/api/memory/*` as the **canonical** API for agents.
2. Add a small **adapter service** that mirrors those endpoints into external stores (future `services/` folder).
3. Store `embedding_ref` / `external_id` on `memory_entries` for dual-write or index pointers.

## Harness runtimes

See [../harness-sdk.md](../harness-sdk.md) for push/pull bundle format (CrewAI, OpenClaw, etc.).

## MCP

Agent clients can call MCP tools that wrap the same operations as HTTP (parity with MemoryOS MCP tools: add / retrieve / profile). A reference server may be added under `services/memory-mcp/` in a later milestone.

## Ecosystem references (patterns only)

- [EverMind-AI/EverOS](https://github.com/EverMind-AI/EverOS)
- [holaboss-ai/holaOS](https://github.com/holaboss-ai/holaOS)
- [Q00/ouroboros](https://github.com/Q00/ouroboros)
- [craft-ai-agents/craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss)
- [buildermethods/agent-os](https://github.com/buildermethods/agent-os)

Treat these as **design bibliography**, not vendored dependencies.
