# Agent OS

A self-hosted operations dashboard for running work with AI agents.

Everything runs on my own hardware against my own CLI subscriptions. There is no vendor backend, no account, and no telemetry. Nothing is sent anywhere I did not send it.

## What it actually is

Two layers, live at the same time on purpose.

**V1** is the module surface: 48 pages covering deal flow, outreach, content, research, agents, and infrastructure. It grew fast and works.

**V2 ("CORE")** is a ground-up rebuild underneath it on SQLite, with an event bus, a scheduler, capability gates, and a real data layer. Modules move onto it as they get rebuilt rather than all at once, so both layers coexist and that is deliberate.

Current state: 360 API routes, 21 schema migrations, 68 offline smoke suites.

## The parts that matter

**Agents.** Build an agent in the Forge, give it triggers, run it, and watch the transcript stream. Lifecycle gates keep an untested agent out of production. Runs orphaned by a restart are reconciled at boot rather than left hanging.

**Memory.** An episodic temporal knowledge graph with an ingestion queue and vector search, so an agent can recall what happened without being handed the whole history.

**Browser agents.** Agents drive a real Chromium through a domain allowlist, with a live view. Credentials are contained by construction: each principal gets its own profile directory, and an agent can only ever reach its own, or its orchestrator's if it is a sub-agent. Sub-agents inherit their parent's identity and folder, so agent 43 spawns 43A and 43B and they share what 43 is signed into. The check sits where the browser's user-data directory is chosen, so it decides whether Chromium opens a directory at all rather than asking an agent to behave.

**Jarvis.** An assistant that is present on every page, with voice input and a warm session, backed by a persona stored as editable data rather than baked into prompt code.

**Tasks, WebMCP, integrations, newsletter, marketing.** Approval-gated task workflow; a tool-package exporter and hub; Gmail, Calendar, Notion, GitHub and Slack connectors driving an automations engine; a newsletter engine that dedupes across sources; a marketing command center with an approval gate before anything deploys.

## Module docs

Every module, every tab and every control is documented, written from the code: see the index at [docs/modules/README.md](docs/modules/README.md), plus [Start here](docs/guide/start-here.md), [Around every page](docs/guide/around-every-page.md) and [How it works](docs/guide/how-it-works.md). The same pages are the app's in-app Guide at `/guide`.

## Running it

Requires Node and a local agent CLI. It runs on Windows natively.

```
npm install
npm run dev
```

Then open http://localhost:3737.

Config lives in `~/.agentic-os/`, outside the repo, so an update never touches settings or keys. Anything configurable is exposed through an in-app gear menu rather than a config file you have to hand-edit.

For LAN access, the app binds beyond localhost behind a password gate. Useful for driving it from a phone on the same network, and not something to expose further than that.

## Working on it

Contracts for anyone (human or agent) touching this code live in `AGENTS.md`: how work lands, what a module owes, and the rules that came out of things going wrong. Read it first.

Every module ships a smoke suite under `scripts/v2/`, runnable offline with no network, no dev server, and no live credentials:

```
npx tsx scripts/v2/smoke-<module>.mjs
```

They assert against real artifacts rather than against what a build step claimed it did. A smoke that touches a credential directory redirects it to a temp path first, and one of them greps its siblings to enforce that, because remembering was not enough the first time.

Versioning is enforced rather than remembered:

```
npm run version:check     # fails if commits landed but the version did not move
npm run version:bump      # feat -> minor, fix -> patch
npm run version:release   # prints the tag commands and release notes
```

Release notes live in the GitHub release body. `CHANGELOG.md` in the history is inherited from upstream and is not maintained here.

## Provenance

This started from Julian Goldie's Agentic OS and has diverged substantially. V2 is a rebuild rather than a patch, and the modules, data layer, and security model are my own work. Upstream's original material is preserved in the git history.

## Licence

No licence is granted. This is a personal project, published for my own use and reference, and default copyright applies. If you want to use any of it, ask.
