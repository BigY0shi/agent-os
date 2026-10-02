# How it works

## The app

A Next.js app served in production mode on port 3737 (`npm start`). It is started and restarted by the owner's launcher scripts in the repo root. Remote devices reach it over Tailscale; the microphone needs the HTTPS address (`tailscale serve`), because browsers only allow the mic on a secure page.

Two generations live side by side: the original modules (V1) and a rebuilt core (V2) on SQLite at `~/.agentic-os/agentos.db`. Modules move to V2 when there is a reason to, not before.

## Agents and models

Agents run on the CLIs you are already signed into (`claude`, `codex`, `hermes`, `agy` and others), so they bill your subscriptions rather than per-token keys. Where a module lets you pick a model or a provider, the choice is a setting, and a fallback only happens if you chose one; otherwise a missing key or an unreachable model is a clear error.

Jarvis keeps one warm session for a conversation, with his own tools (read and drive the page, memory, the module kit) and any MCP servers you switched on in Jarvis > MCP. Anything that came from outside (a web page, an email, a file) marks the turn, and on such a turn his write tools and external MCP tools are refused.

## Memory

Memory is self-hosted: SQLite plus local embeddings. Conversations and module work are ingested in the background. The same memory is offered to Claude Code over MCP (`/api/mcp`, tools `memory_search`, `memory_ingest`, `memory_about_user`).

## Work that runs

- **Runs**: module work is registered with a start, a status, a stop, and a result, and shown in the runs tray.
- **Missions**: a crew of CLI agents, each in its own scratch folder under `~/.agentic-os/missions/`, with a time limit, turn caps where the CLI has them, and an event log of what happened.
- **Standing orders**: every recurring job (scheduled tasks, agents' schedules, system jobs) in one place, with hold, run now and take off.

## Safety habits built in

- Removals are retired or exiled, not deleted; file edits keep the previous version.
- Saved keys never reach the browser in full.
- Every module has an offline smoke test (`scripts/v2/smoke-*.mjs`) that must pass before a change lands; each smoke redirects its data folders to a temp dir.
