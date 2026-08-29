# SPEC C+D — Omnipresent Jarvis (C1–C6) & WebMCP Engine (D1–D5)

Status: IMPLEMENTATION-READY (written 2026-08-27, Ultraplan pass).
Inputs: `_design/agentos-v2/MASTER-PLAN.md`, `_design/agentos-v2/DOCS-CHEATSHEET.md`, recon digests (agent / integrations / current-repo), verified against the live tree.
Reference repo (READ-ONLY): `C:/Users/Yoshi/Documents/JulianGolde - AgenticOS/AgentOSCore`.
Target repo: `C:/Users/Yoshi/Documents/JulianGolde - AgenticOS/agent-os` (Next.js 16 App Router, React 19, TS, Windows host).

---

## 1. Scope & goals

### Workstream C — Omnipresent Jarvis

| ID | Item | This spec delivers |
|---|---|---|
| C1 | Global provider in root layout | `JarvisOmnipresence` (floating orb + overlay chatbox + transcript drawer) mounted in `src/app/layout.tsx`, available on every route |
| C2 | OS-global F13 hotkey | AutoHotkey v2 helper (startup task) → `POST /api/jarvis/hotkey` (own secret, proxy-exempt) → SSE push to the client → app fronted + overlay opens. In-app `keydown` listener as degraded path. Key configurable in settings |
| C2b | Chatbox-first capture | Voice transcribes LIVE into an EDITABLE text field. Key release / mic stop ends recording but NEVER sends. Explicit Enter/Send; Esc discards; `jarvis.voice.autoSend` toggle default **OFF**. Retrofitted onto the existing `/jarvis` page (JarvisView's `rec.onresult → ask()` auto-send removed) |
| C3 | Unified voice loop | One provider-agnostic hook contract (`useVoiceCapture`: `{status, partial, start, stop, cancel}` — upstream `use-voice-chat` shape) wrapping WebSpeech / OpenAI-Realtime / Kimi / Gemini-Live plumbing; settings gear for provider/model/persona/hotkey/autoSend |
| C4 | Brain (meta-agent loop) | **Flat-toolset** turn loop (recon finding: upstream removed gather_context/take_action — do NOT build the two-subagent model): persona doc (A6) + page context injected per turn; tools = internal MCP (F4) surface via in-process SDK MCP server; auto-ingest each exchange into Memory V2; conversations persisted in `agentos.db` |
| C5 | Page-context registry | Client-side registry: every page/module registers a lightweight descriptor (route, title, summary, visible entities). Sent per-request as `pageContext`, rendered as an `<active_page>` prompt block, **never persisted** (upstream privacy/staleness rule) |
| C6 | Jarvis spawns work | Tools that create a task (B), spawn a coding session (F3 exec/coding slot), open a browser session (E via F3) — all through the internal MCP hub, human-gated where destructive |

### Workstream D — WebMCP Engine

| ID | Item | This spec delivers |
|---|---|---|
| D1 | `/webmcp` page | Build / test / version / deploy MCP tool packages in-app |
| D2 | Package model | The documented integration contract: `spec` (name/key/auth/schedule/mcp type), tools (JSON-Schema inputs + annotations), handlers (SETUP/SYNC/PROCESS/GET_TOOLS/CALL_TOOL). Stored as **data** in SQLite; Monaco editor pane for JS handlers |
| D3 | Builder UX | Form-driven spec → tool designer → sandbox test runner (call with sample args, see result + logs) → publish to internal MCP hub (F4) or export a standalone stdio/CLI package |
| D4 | First deliverable | **`agentos` self-tools package**: tasks CRUD, pipeline ops, marketing ops, memory search/ingest, navigation, settings read — the tool surface that lets Jarvis drive the OS |
| D5 | Client-onboarding mode | Multi-tenant spec export with `${config:*}` credential placeholders (schema + export path now; UI later) |

**Non-goals here:** Memory V2 internals (SPEC-A), the `/api/mcp` transport itself and capability slots (SPEC-F foundations — we define the consumption contracts and ship a minimal hub shim if F4 lands after us), browser engine (SPEC-E), remote widget bundles (upstream `frontendUrl` loader — explicitly skipped, H2 is in-repo).

### Ground rules honored
- Rule 16: every knob below has a ConfigMenu surface backed by `src/lib/settings.ts`.
- Rule 17: Jarvis persona stays a data record (`jarvisPersona.ts` pattern); A6 persona **document** is content, not code; WebMCP tools/handlers are data.
- Rule 11: all model calls route through `cliComplete`/provider picker or the warm Claude Agent SDK session; fail loudly.
- Windows-first: every spawn through `sanitizeSpawnEnv`; no `fs.watch`; AHK over native hooks.
- Append-never-destroy: package "delete" = archive status + exile export dir; call logs append-only.

---

## 2. Data model (SQLite DDL)

All tables live in `~/.agentic-os/agentos.db`, created through the F1 migration runner in `src/lib/v2/db.ts` (this spec contributes migration files; it does not own the runner). Storage decision per Ultraplan brief: `better-sqlite3` + `sqlite-vec`. **Note:** recon found `better-sqlite3` is NOT currently in `package.json` (kanbanDb uses built-in `node:sqlite`) — F1 must resolve; this spec's DDL is engine-agnostic SQL and works on either.

```sql
-- migration: 00X_jarvis.sql -------------------------------------------------

CREATE TABLE IF NOT EXISTS jarvis_conversations (
  id            TEXT PRIMARY KEY,            -- uuid
  title         TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'overlay', -- overlay | page | hotkey | api
  created_at    TEXT NOT NULL,               -- ISO 8601
  updated_at    TEXT NOT NULL,
  active_stream_id TEXT,                     -- resume pattern (upstream activeStreamId)
  meta_json     TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS jarvis_messages (
  id              TEXT PRIMARY KEY,          -- uuid
  conversation_id TEXT NOT NULL REFERENCES jarvis_conversations(id),
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL,             -- plain text of the turn
  parts_json      TEXT NOT NULL DEFAULT '[]',-- [{type:'text'|'tool-<name>', toolCallId, input, output, state}]
  mode            TEXT NOT NULL DEFAULT 'text', -- text | voice  (voice flips spoken-mechanics prompt block)
  created_at      TEXT NOT NULL,
  meta_json       TEXT NOT NULL DEFAULT '{}' -- costUsd, turns, model, durationMs — real numbers only (honest-telemetry rule)
);
CREATE INDEX IF NOT EXISTS idx_jarvis_messages_conv ON jarvis_messages(conversation_id, created_at);

-- migration: 00Y_webmcp.sql -------------------------------------------------

CREATE TABLE IF NOT EXISTS webmcp_packages (
  id              TEXT PRIMARY KEY,          -- uuid
  slug            TEXT NOT NULL UNIQUE,      -- kebab, ^[a-z0-9][a-z0-9-]{1,40}$
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  icon            TEXT NOT NULL DEFAULT '',  -- emoji or lucide name
  kind            TEXT NOT NULL DEFAULT 'internal' CHECK (kind IN ('internal','export')),
  spec_json       TEXT NOT NULL DEFAULT '{}',-- Spec shape (§ port map: packages/types integration.ts, minus TUI)
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  current_version TEXT NOT NULL DEFAULT '0.0.0',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webmcp_tools (
  id                TEXT PRIMARY KEY,
  package_id        TEXT NOT NULL REFERENCES webmcp_packages(id),
  name              TEXT NOT NULL,           -- exactly the name advertised to agents (naming invariant, §8)
  description       TEXT NOT NULL DEFAULT '',
  input_schema_json TEXT NOT NULL DEFAULT '{"type":"object","properties":{}}',
  annotations_json  TEXT NOT NULL DEFAULT '{}', -- {readOnlyHint, destructiveHint, idempotentHint}
  handler_kind      TEXT NOT NULL CHECK (handler_kind IN ('internal','http','js')),
  handler_json      TEXT NOT NULL,           -- see Handler shapes below
  requires_approval INTEGER NOT NULL DEFAULT 0, -- 1 → human-gate in interactive contexts
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE(package_id, name)
);

CREATE TABLE IF NOT EXISTS webmcp_package_versions (
  id           TEXT PRIMARY KEY,
  package_id   TEXT NOT NULL REFERENCES webmcp_packages(id),
  version      TEXT NOT NULL,               -- semver, bumped on publish
  snapshot_json TEXT NOT NULL,              -- frozen {spec, tools[]} at publish time
  changelog    TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  UNIQUE(package_id, version)
);

CREATE TABLE IF NOT EXISTS webmcp_call_logs (          -- append-only (IntegrationCallLog pendant)
  id           TEXT PRIMARY KEY,
  package_slug TEXT NOT NULL,
  tool_name    TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT '',    -- jarvis | sandbox | mcp:<source-tag> | task:<id>
  args_json    TEXT NOT NULL DEFAULT '{}',  -- truncated to 4KB
  ok           INTEGER NOT NULL,
  result_snippet TEXT NOT NULL DEFAULT '',  -- first 1KB of result text
  error        TEXT,
  duration_ms  INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webmcp_logs_pkg ON webmcp_call_logs(package_slug, created_at);
```

### Handler shapes (`handler_json` by `handler_kind`)

```ts
// 'internal' — calls a code-shipped action from the internal registry (D4 path; safe)
{ action: "tasks.create" }                    // key into INTERNAL_ACTIONS registry

// 'http' — declarative request template (agentsHttpTool pattern; data-only)
{ method: "POST", url: "https://api.x.com/v1/{{arg:path}}",
  headers: { "Authorization": "Bearer {{secret:X_TOKEN}}" },
  bodyTemplate: { text: "{{arg:text}}" },     // {{arg:*}} from tool args, {{secret:*}} resolved
  resultPath: "data" }                        // server-side from ~/.agentic-os/secrets.json — model never sees keys

// 'js' — user-authored async function body, run in node:vm sandbox (advanced; builder-only)
{ code: "const r = await ctx.fetch(url); return { ok: true, data: await r.json() };",
  timeoutMs: 15000 }
// ctx surface: { args, fetch, secrets.get(name) -> resolved server-side, log(msg), settings (read-only), db: NONE }
```

### Settings additions (`src/lib/settings.ts` `Settings` interface)

```ts
jarvis: {
  kimiModel?: string;                 // EXISTING — keep
  brainEngine?: "claude-sdk" | "cli"; // default "claude-sdk"
  brainAgent?: string;                // when brainEngine="cli": claude|codex|cursor|... (cliComplete matrix)
  voiceProvider?: "webspeech" | "openai-realtime" | "kimi" | "gemini-live"; // default "webspeech"
  voice?: { autoSend?: boolean };     // default false — THE C2b toggle
  hotkey?: { key?: string; enabled?: boolean };  // default { key: "F13", enabled: true } (in-app listener)
  ttsProvider?: string;               // passthrough to existing /api/hermes/tts "auto"
};
webmcp: {
  sandboxTimeoutMs?: number;          // default 15000
  allowJsHandlers?: boolean;          // default true (single-user box); gates 'js' handler_kind creation
};
```

Hotkey helper secret: `~/.agentic-os/jarvis-hotkey.secret` (random 32 hex, generated on first `GET /api/jarvis/hotkey/setup`); surfaced in settings UI as "configured ✓" only (K1 precedent).

---

## 3. Module layout

```
src/lib/v2/jarvis/
  brain.ts              # JarvisBrainV2 warm session + turn loop (extends jarvisBrain.ts pattern)
  context.ts            # prompt assembly: identity → persona record → persona doc (A6) → skills → datetime → <active_page> → spoken-mechanics (voice mode)
  prompts.ts            # ported prompt blocks: spoken mechanics, tone defaults, active_page (verbatim from upstream voice-mode.ts)
  conversations.ts      # jarvis_conversations/messages CRUD over db.ts
  ingest.ts             # buildEpisodeBody + per-day session bucket id → Memory V2 addToQueue (SPEC-A API); no-op w/ loud log until A lands
  hotkeyBus.ts          # globalThis singleton: SSE subscriber set + fire(); consumed by hotkey routes
  tools.ts              # in-process SDK MCP server for the brain: wraps webmcp/execute.ts published internal packages + get_actions/execute_action meta-tools

src/lib/v2/webmcp/
  types.ts              # ported contract types (Spec, Message, IntegrationEventType, WidgetMeta dropped-TUI) 
  store.ts              # packages/tools/versions/logs CRUD over db.ts
  execute.ts            # executeTool(slug, toolName, args, {source, interactive}) → dispatch by handler_kind; call-log write; approval gate hook
  internalActions.ts    # INTERNAL_ACTIONS registry (D4 self-tools implementations)
  sandbox.ts            # node:vm runner for 'js' handlers (timeout, ctx surface, console capture)
  exporter.ts           # generate standalone package dir (IntegrationCLI-shaped index.mjs + package.json) → ~/.agentic-os/webmcp/exports/<slug>/
  hub.ts                # registration bridge to F4 /api/mcp (get_actions/execute_action); ships a minimal shim if F4 not yet landed

src/app/api/jarvis/
  ask/route.ts          # POST → SSE turn stream (v2 brain); GET → status
  hotkey/route.ts       # POST (helper, secret header) → hotkeyBus.fire(); GET setup → ensure secret
  hotkey/stream/route.ts# GET → SSE, pushes {type:'hotkey'} events to the client provider
  conversations/route.ts            # GET list, POST create
  conversations/[id]/route.ts       # GET messages (seq/after cursor), PATCH title
  # existing brain/ and persona/ routes stay untouched until C-retire task

src/app/api/webmcp/
  packages/route.ts                          # GET list, POST create
  packages/[slug]/route.ts                   # GET, PATCH (spec/status), POST action:'archive'
  packages/[slug]/tools/route.ts             # GET list, POST create
  packages/[slug]/tools/[name]/route.ts      # GET, PATCH, POST action:'disable'
  packages/[slug]/tools/[name]/test/route.ts # POST sandbox run
  packages/[slug]/publish/route.ts           # POST → version snapshot + hub register
  packages/[slug]/export/route.ts            # POST → exporter, returns path
  logs/route.ts                              # GET (filter pkg/tool/source, cursor)

src/app/webmcp/page.tsx                      # D1 page (client components below)

src/components/v2/jarvis/
  JarvisOmnipresence.tsx  # provider mounted in layout.tsx; owns overlay open state, hotkey SSE, page-context store
  JarvisOrb.tsx           # floating orb (bottom-right), status glow from brain state
  JarvisOverlay.tsx       # the C2b chatbox: editable textarea + mic + transcript-live-insert + Enter/Esc handling
  JarvisTranscriptDrawer.tsx # conversation history drawer (polls conversations API via usePollWhileVisible)
  useVoiceCapture.ts      # provider-agnostic hook {status, partial, error, start, stop, cancel} + onFinalChunk(text)
  voiceProviders/webspeech.ts | openaiRealtime.ts | kimi.ts | geminiLive.ts   # adapters over existing plumbing
  usePageContext.ts       # usePageContextDescriptor(desc) — registers/unregisters on mount; reads in overlay
  JarvisSettings.tsx      # ConfigMenu fields (rule 16): engine, agent, voice provider, autoSend, hotkey, secret status

src/components/v2/webmcp/
  WebmcpView.tsx          # page shell: package list rail + editor pane
  PackageList.tsx         # cards: name, slug, status pill, tool count, last call
  PackageEditor.tsx       # tabs: Spec | Tools | Test | Versions | Logs
  SpecForm.tsx            # form-driven spec (D3): name/key/description/auth kind/schedule/mcp type
  ToolDesigner.tsx        # name/description/schema builder (field rows → JSON Schema) + handler editor
  HandlerEditor.tsx       # kind picker; 'js' → Monaco pane (@monaco-editor/react); 'http' → template form; 'internal' → action picker
  SandboxRunner.tsx       # args form generated from input schema → run → result JSON + captured logs + duration
  VersionsPanel.tsx       # publish button, semver bump, changelog, version history
  CallLogsPanel.tsx       # webmcp_call_logs table w/ ok/error chips
  WebmcpSettings.tsx      # ConfigMenu: sandbox timeout, allowJsHandlers

scripts/v2/
  jarvis-hotkey.ahk       # AutoHotkey v2 helper (C2)
  install-jarvis-hotkey.md# install steps (shell:startup shortcut; no UAC)
  smoke-jarvis-hotkey.mjs # §9
  smoke-jarvis-ask.mjs
  smoke-webmcp.mjs
```

Sidebar: add `/webmcp` ("WebMCP", icon `Wrench`/`Hammer`) to `NAV` **and** to `ORCHESTRATION_ROUTES` set in `src/components/Sidebar.tsx` (Set-membership gotcha — missing the Set lands it in "Self").

New deps: `@monaco-editor/react` (+ its `monaco-editor` peer). No other new packages (MCP SDK `^1.29.0` already present; AHK is not an npm dep).

---

## 4. Port map

| Reference (AgentOSCore) | Our file | Strategy |
|---|---|---|
| `apps/webapp/app/services/agent/prompts/voice-mode.ts` (spoken mechanics 40-word cap, identifier transforms, tone block, active_page block) | `src/lib/v2/jarvis/prompts.ts` | **verbatim-adapt** (pure strings; rename CORE→Agent OS) |
| `services/agent/context.ts` — assembly order, `<identity>` prepended at runtime (never in editable persona), `<active_page>`, `<skills>` block | `src/lib/v2/jarvis/context.ts` | **pattern-only** (subset: identity → persona → skills → datetime → active_page; no colleagues/tasks blocks yet) |
| `services/agent-prompts.ts` — `renderPrompt` `{{TOKEN}}` model | `src/lib/v2/jarvis/context.ts` | **verbatim-adapt** (renderPrompt + fail-soft unknown tokens) |
| `services/agent/agents/core.ts` — FLAT tool map, stepCount cap, PQueue+truncate-inside-slot | `src/lib/v2/jarvis/brain.ts` + `tools.ts` | **pattern-only** (no Mastra; Claude Agent SDK `query()` warm session per `jarvisBrain.ts`, or cliComplete loop) |
| `apps/webapp/app/components/voice/voice-mic-button.tsx` — decoupled mic emitting `onTranscript`, caller decides insert-vs-send | `src/components/v2/jarvis/useVoiceCapture.ts` + `JarvisOverlay.tsx` | **pattern-only** — THE C2b seam; VoiceComposer's VAD auto-send is the **anti-pattern**, skip |
| `hooks/use-voice-chat.tsx` — uniform `{status, partial, start, stop, cancel}`; `components/voice/stt-providers.ts` registry `{id,label,isLocal,byokSupported,requiresNative}` | `useVoiceCapture.ts` + `voiceProviders/*` | **verbatim-adapt** (contract + registry shape; `requiresTauri`→`requiresNative:false`) |
| `routes/voice-widget.tsx` — `voice:final → sendTurn` line | JarvisOverlay | **skip the auto-send**; port only sentence-boundary TTS queue (`SENTENCE_BOUNDARY` regex + pending counter + barge-in cancel) into overlay TTS |
| `apps/tauri/src-tauri/src/voice_hotkey.rs` — global+local monitor duality, hold/tap grammar | `scripts/v2/jarvis-hotkey.ahk` + in-app keydown | **pattern-only** (Windows AHK; keep the "works when app frontmost" dedupe: helper suppresses when browser already focused? No — app-side dedupe, §8) |
| `routes/api.v1.voice.turn.tsx` — mode flag, screenContext per-request never persisted, resumable stream | `src/app/api/jarvis/ask/route.ts` | **pattern-only** (single-process SSE + AbortController map on globalThis; keep activeStreamId column for later resume) |
| `services/agent/conversation-ingest.ts` — `buildEpisodeBody` `<user>…</user><agent>…</agent>`, `{conversationId}-YYYY-MM-DD` bucket | `src/lib/v2/jarvis/ingest.ts` | **verbatim-adapt** (pure functions; user-tz day bucket) |
| `packages/types/src/integration.ts` + `oauth/params.ts` | `src/lib/v2/webmcp/types.ts` | **verbatim-adapt** (drop TUI widget variants; keep Spec/Message/EventType/OAuth2Params) |
| `packages/sdk/src/integrations/integration-cli.ts` — subcommand + NDJSON wire format | `src/lib/v2/webmcp/exporter.ts` (generated CLI stub) | **pattern-only** (we generate a file implementing it; we don't run it in-app) |
| `apps/webapp/app/utils/mcp/memory.ts` — `get_integrations`/`get_integration_actions`/`execute_integration_action` tool descriptions (UUID warnings, workflow contract) | `src/lib/v2/jarvis/tools.ts` + `webmcp/hub.ts` | **verbatim-adapt** (descriptions carry the agent workflow — keep the text, swap accountId→package slug) |
| `utils/mcp/prompts.ts` — INTEGRATION_ACTION_SELECTION_SYSTEM_PROMPT (dependency ordering, anti-hallucination, parse-failure→all-tools) | `src/lib/v2/webmcp/hub.ts` (`filterActions`) | **verbatim-adapt** (LLM call via provider router, temp 0.3, max ~500 tok; log loudly on fallback) |
| `utils/mcp/integration-operations.ts` — on-demand loading, PQueue caps, truncate-in-slot, call logging, `enrichAccountNotFound` self-correction | `src/lib/v2/webmcp/execute.ts` + `hub.ts` | **pattern-only** (single-process; keep concurrency cap 3 + truncation discipline) |
| `services/integrations/integration-runner.ts` — in-process `run(payload)` module loader | NOT ported for execution (handlers are data, not bundles) | **skip** (exporter emits the `run()` shape for D5 clients) |
| `integrations/gmail/src/frontend/tools/email-tool-ui.tsx` — two-phase ToolUI approve/edit | deferred to Human-Gate integration (B2/H); `requires_approval` column reserved | **skip now / pattern later** |
| `agentsHttpTool.ts` (target repo) — `{{secret:NAME}}` server-side resolution, `SENSITIVE_HTTP_RE` | `src/lib/v2/webmcp/execute.ts` ('http' kind) | **verbatim-adapt** (same secrets file + sensitive-endpoint gate) |
| `jarvisBrain.ts` (target repo) — warm SDK session, sentence streaming, interrupt-on-new-ask, env sanitize | `src/lib/v2/jarvis/brain.ts` | **verbatim-adapt** (add: streaming-input generator [SDK MCP tools REQUIRE it], tool events, conversation persistence, persona-doc block) |
| `JarvisView.tsx` (target repo) — recognizer lifecycle (wake-word loop, backoff, never-two-recognizers) | `voiceProviders/webspeech.ts` | **verbatim-adapt** lifecycle; **remove** `rec.onresult → ask()` auto-send |

---

## 5. API contracts

All routes: `runtime="nodejs"`, `dynamic="force-dynamic"`, `cache-control: no-store`, bodies via `req.json().catch()` + explicit 400s (house convention).

### Jarvis

**`POST /api/jarvis/ask`** → SSE (`text/event-stream`)
```ts
// Request
{ text: string;                       // required, the edited/final message
  conversationId?: string;            // omit → new conversation
  mode?: "text" | "voice";            // default "text"; "voice" appends spoken-mechanics block
  pageContext?: {                     // C5 — per-request only, NEVER stored
    route: string; title?: string; summary?: string;
    entities?: { type: string; id?: string; name: string }[];
  };
}
// SSE events (data: JSON per line)
{ type: "meta", conversationId, messageId }
{ type: "sentence", text }                          // streaming, sentence-split (TTS-ready)
{ type: "tool", name, state: "start"|"done"|"error", callId, inputPreview?, outputPreview? }
{ type: "navigate", route }                         // client provider performs router.push
{ type: "done", costUsd?, turns?, durationMs }      // real numbers or absent — never fabricated
{ type: "error", message }
```
`GET /api/jarvis/ask` → `{ status: "idle"|"busy", conversationId?, engine }`. A new POST while busy interrupts the running turn (jarvisBrain behavior preserved).

**`POST /api/jarvis/hotkey`** — called by the AHK helper. Headers: `x-jarvis-hotkey-secret: <hex>`. Body `{ key?: string }`. 401 on bad/missing secret; 204 on fire. **Must be added to the proxy exemption list** in `src/proxy.ts` (webhook pattern: exempt + own secret).
**`GET /api/jarvis/hotkey`** (cookie-authed) → `{ configured: boolean }`; `POST /api/jarvis/hotkey?setup=1` (cookie-authed) → generates/rotates secret file, returns `{ configured: true }` (never the secret itself; the AHK installer reads the file locally).
**`GET /api/jarvis/hotkey/stream`** (cookie-authed) → SSE `{ type: "hotkey", ts }` on every helper fire; heartbeat comment every 25s.

**`GET /api/jarvis/conversations`** → `{ conversations: [{ id, title, source, updatedAt, messageCount }] }` (latest 50).
**`POST /api/jarvis/conversations`** `{ title? }` → `{ id }`.
**`GET /api/jarvis/conversations/[id]?after=<messageId>`** → `{ messages: [...] }`.
**`PATCH /api/jarvis/conversations/[id]`** `{ title }` → `{ ok: true }`.

### WebMCP

```ts
GET  /api/webmcp/packages                       → { packages: PackageSummary[] }
POST /api/webmcp/packages { slug, name, description?, kind? } → { package } | 409 slug taken
GET  /api/webmcp/packages/[slug]                → { package, tools, versions }
PATCH /api/webmcp/packages/[slug] { name?, description?, icon?, spec?, status? } → { package }
POST /api/webmcp/packages/[slug] { action: "archive" }   → { ok }   // never hard-delete

GET  /api/webmcp/packages/[slug]/tools          → { tools }
POST /api/webmcp/packages/[slug]/tools
     { name, description, inputSchema, annotations?, handlerKind, handler, requiresApproval? }
     → { tool } | 409 name taken | 400 schema invalid (ajv-style validation, loud errors)
PATCH /api/webmcp/packages/[slug]/tools/[name]  → { tool }

POST /api/webmcp/packages/[slug]/tools/[name]/test { args } →
     { ok, result, logs: string[], durationMs, error? }   // sandbox context; source="sandbox" in call log

POST /api/webmcp/packages/[slug]/publish { bump: "patch"|"minor"|"major", changelog? }
     → { version, registered: boolean }        // registered=false + reason when F4 hub absent (loud, not silent)

POST /api/webmcp/packages/[slug]/export { mode: "internal"|"client" }   // client → ${config:*} placeholders (D5)
     → { path }                                 // ~/.agentic-os/webmcp/exports/<slug>/

GET  /api/webmcp/logs?pkg=&tool=&source=&before= → { logs, nextCursor }
```

### Internal MCP hub contract (consumed; F4-owned)

`src/lib/v2/webmcp/hub.ts` exports the seam both sides agree on:
```ts
export function listPublishedPackages(): { slug, name, description, toolCount }[];
export async function getActions(query: string, slugs?: string[]): Promise<ToolSchema[]>; // LLM-filtered 1–3 schemas; parse-fail → all + loud log
export async function executeAction(slug: string, tool: string, args: unknown,
  opts: { source: string; interactive: boolean }): Promise<McpTextResult>; // {content:[{type:'text',text}], isError?}
```
F4's `/api/mcp` route calls these three; Jarvis's in-process SDK MCP server (`jarvis/tools.ts`) calls the same three. Tool-name invariant: **a handler receives exactly the name advertised in its tool row** — no slug prefixing/stripping round-trip (upstream trap, §8).

---

## 6. UI

Style: existing muted-neobrutalist dashboard (CSS vars `--fg`/`--panel-border`, per-module accent hex, framer-motion, lucide). Polling via `usePollWhileVisible` only.

### C — Jarvis omnipresence (mounted in `src/app/layout.tsx`, sibling of `<HydrateFleet>` inside `<Shell>`)

```
<JarvisOmnipresence>                     // context provider, no chrome of its own
 ├─ <JarvisOrb/>                         // fixed bottom-right, 48px; glow = idle/listening/thinking/speaking
 ├─ <JarvisOverlay/>                     // centered modal card (max-w 640px), opened by orb click, F13 SSE, or in-app hotkey
 │   ├─ transcript strip (last agent reply, streaming sentences)
 │   ├─ **editable textarea** (autofocus)         ← C2b: live transcript INSERTS at cursor
 │   ├─ mic button (hold-to-talk + click-toggle) + status pill (recording/transcribing)
 │   ├─ footer: [Esc discards] [provider chip] [Send ⏎]
 │   └─ ConfigMenu gear → <JarvisSettings/>
 └─ <JarvisTranscriptDrawer/>            // right slide-over: conversation list + thread view
```

**C2b interaction contract (normative):**
1. Overlay opens → textarea focused, mic **not** hot (unless opened via hold-F13 while helper reports key-down — v1: never auto-hot; press-to-record only).
2. Mic press/hold → `useVoiceCapture.start()`; partials render ghost-gray at cursor; finalized chunks become real text at cursor.
3. Mic release/stop → `stop()`. **Nothing is sent.** User edits, re-records (appends), types.
4. `Enter` (no shift) or Send → POST `/api/jarvis/ask`; textarea clears; overlay stays open streaming the reply.
5. `Esc` → discard buffer + close overlay (no persistence of the draft).
6. `settings.jarvis.voice.autoSend === true` (default false) → step 3 additionally auto-sends the buffer iff non-empty. This is the ONLY auto-send path.

**/jarvis page retrofit:** `JarvisView.tsx` — remove the `rec.onresult → ask(t)` call; final transcripts append to the existing input state instead; the page's send button/Enter is the only dispatch. Wake-word mode keeps its recognizer loop but on wake opens the capture buffer rather than firing `ask`. `JarvisRealtime`/`JarvisKimiVoice` panels: transcripts route into the same editable buffer when `autoSend` off (their conversational realtime mode stays available behind their own explicit "Live conversation" toggle — realtime full-duplex is definitionally auto-send and is opt-in per session).

**Settings surface (rule 16)** in `<JarvisSettings/>` via ConfigMenu: brain engine + CLI agent picker, voice provider select (registry-driven; unavailable providers grayed with reason — see Opera note §8), autoSend toggle, hotkey key text field + enabled toggle, hotkey helper status ("helper secret configured ✓" + last-fire timestamp), TTS provider.

### D — `/webmcp` page

```
<WebmcpView>                              // accent suggestion: #b7852f (tool-brass)
 ├─ left rail <PackageList/>              // + New Package button (slug/name inline form)
 └─ <PackageEditor package=...>
     ├─ Tab: Spec      <SpecForm/>        // name, key(slug ro), description, icon, auth kind (none|api_key|oauth2 fields), schedule cron, mcp type
     ├─ Tab: Tools     tool table → <ToolDesigner/> per tool
     │                 // schema builder rows (name/type/required/description) ⇄ raw JSON Schema toggle
     │                 // <HandlerEditor/> : kind tabs — Internal (action dropdown from registry) | HTTP (template form) | JS (Monaco, dark theme)
     ├─ Tab: Test      <SandboxRunner/>   // arg form auto-rendered from schema, Run, result pane + logs + ms
     ├─ Tab: Versions  <VersionsPanel/>   // Publish (bump picker + changelog), history list, "registered on hub ✓/✗ reason"
     └─ Tab: Logs      <CallLogsPanel/>   // paged, ok/err chips, source column
```
Every configurable knob (sandbox timeout, allowJsHandlers) in `<WebmcpSettings/>` ConfigMenu on the page header.

---

## 7. Granular task list

Legend: each ≤ ~half-day. Deps in brackets. **V:** verification step.

### Phase C-0 — plumbing

- **C0.1** Settings + types: extend `Settings.jarvis` and add `Settings.webmcp` in `src/lib/settings.ts` (interface + `DEFAULT_SETTINGS`). No behavior change. [deps: none] **V:** `tsc` clean; `GET /api/settings` returns new defaults merged.
- **C0.2** Migrations: add `00X_jarvis.sql` + `00Y_webmcp.sql` DDL (section 2) to the F1 migration set in `src/lib/v2/db.ts`. If F1 not landed yet: create `src/lib/v2/db.ts` with the minimal migration runner (versioned `_migrations` table, WAL, `~/.agentic-os/agentos.db`) using the engine F1 decided — coordinate; do NOT fork a second runner. [deps: F1 or shim] **V:** node one-liner opens db, tables exist.
- **C0.3** `src/lib/v2/jarvis/hotkeyBus.ts`: globalThis singleton (`__jarvisHotkeyBus`) with `subscribe(cb)→off` and `fire(payload)`. [none] **V:** unit: two subscribers both receive fire.

### Phase C-1 — hotkey path (C2)

- **C1.1** `POST/GET /api/jarvis/hotkey/route.ts`: secret file ensure/rotate (`~/.agentic-os/jarvis-hotkey.secret`, crypto random 32B hex), POST validates `x-jarvis-hotkey-secret` (timing-safe compare) → `hotkeyBus.fire()` → 204. [C0.3] **V:** curl with wrong secret → 401; right secret → 204.
- **C1.2** Proxy exemption: add `/api/jarvis/hotkey` (POST only) to the exempt list in `src/proxy.ts`, same pattern as `/api/agents/hook/*`. **Do not exempt** `/hotkey/stream`. [C1.1] **V:** POST works with no cookie; GET stream without cookie → login redirect.
- **C1.3** `GET /api/jarvis/hotkey/stream/route.ts`: SSE subscribing to hotkeyBus; 25s heartbeat; cleanup on abort. [C0.3] **V:** `curl -N` open, POST hotkey in second shell, event arrives <200ms.
- **C1.4** `scripts/v2/jarvis-hotkey.ahk` (AutoHotkey v2): reads config block at top (`AppUrl := "http://127.0.0.1:3737"`, `Hotkey := "F13"`, secret loaded from `A_UserProfile "\.agentic-os\jarvis-hotkey.secret"`); on key: `WinActivate` first window whose title matches "Agent OS" (fallback: `Run AppUrl "?jarvis=1"`), then `Download`/WinHttp POST to `/api/jarvis/hotkey` with header. Include `#SingleInstance Force`. Plus `scripts/v2/install-jarvis-hotkey.md`: install AHK v2, create shortcut in `shell:startup` (no UAC). [C1.1] **V:** manual — press key with app in background: window fronts, endpoint logs fire.
- **C1.5** In-app degraded path: `useJarvisHotkey` inside `JarvisOmnipresence` — window `keydown` listener for `settings.jarvis.hotkey.key` (default F13) + SSE consumer from C1.3; **dedupe**: ignore SSE events arriving <400ms after a local keydown handled (the "global + local monitor" duality from upstream, app-side). [C1.3] **V:** with helper stopped, F13 in-app opens overlay; with helper running and app focused, exactly one open per press.

### Phase C-2 — capture UI (C1 + C2b + C3)

- **C2.1** `useVoiceCapture.ts` contract + registry: `VOICE_PROVIDERS: {id,label,isLocal,byokSupported,available():boolean|string}[]`; hook returns `{status:'idle'|'recording'|'transcribing'|'error', partial, error, start, stop, cancel}` and calls `onFinalChunk(text)`. [C0.1] **V:** storybook-less: unit-test a mock provider through the state machine.
- **C2.2** `voiceProviders/webspeech.ts`: port JarvisView recognizer lifecycle (single-recognizer guard, backoff restart, alias handling for wake words OUT — capture only). Feature-detect (`window.SpeechRecognition||webkitSpeechRecognition`); `available()` returns reason string when absent (Opera caveat §8). [C2.1] **V:** manual in Chrome: partials stream, stop finalizes, no dangling recognizer (second start works).
- **C2.3** `voiceProviders/kimi.ts` + `openaiRealtime.ts`: adapt `JarvisKimiVoice`/`JarvisRealtime` transcription plumbing to the hook contract — transcript-only (no reply generation): kimi = browser STT turn → text; realtime = data-channel transcript deltas accumulated as partials. `geminiLive.ts` stub returning `available:false "not wired yet"` until parity. [C2.1] **V:** provider switch in settings changes active adapter; each yields text into a test buffer.
- **C2.4** `JarvisOverlay.tsx`: the C2b chatbox per §6 contract — editable textarea, cursor-insert of partial (ghost span) + finalized chunks, mic hold/toggle, Enter/Esc handling, autoSend branch, framer-motion open/close. [C2.1] **V:** scripted Playwright-free manual checklist: record→release→NOT sent; edit→Enter→sent; Esc→discarded; toggle autoSend on→release sends.
- **C2.5** `JarvisOrb.tsx` + `JarvisOmnipresence.tsx`: provider with overlay state, hotkey hook (C1.5), page-context store (C4.4), orb status from `GET /api/jarvis/ask` via `usePollWhileVisible` (4s). Mount in `src/app/layout.tsx` next to `HydrateFleet`. [C2.4, C1.5] **V:** orb visible on `/`, `/pipeline`, `/marketing`; F13 opens overlay on each.
- **C2.6** `JarvisTranscriptDrawer.tsx` + conversations API routes (`conversations/route.ts`, `[id]/route.ts`) over `src/lib/v2/jarvis/conversations.ts`. [C0.2] **V:** create/list/read/rename round-trip via curl; drawer renders thread.
- **C2.7** `JarvisSettings.tsx` ConfigMenu section wired to `useSettings` (all §6 fields) incl. hotkey secret "configured ✓" (from `GET /api/jarvis/hotkey`). [C0.1] **V:** change provider in UI → settings.json updated → overlay uses it without rebuild.

### Phase C-3 — brain (C4 + C5 + C6)

- **C3.1** `src/lib/v2/jarvis/prompts.ts`: port spoken-mechanics / tone / active_page blocks from `AgentOSCore .../prompts/voice-mode.ts` (verbatim strings, renames). [none] **V:** snapshot test: blocks contain the 40-word rule and identifier transforms.
- **C3.2** `src/lib/v2/jarvis/context.ts`: `buildJarvisContext({personaRecord, personaDoc, pageContext, mode, skills})` → system prompt string: runtime `<identity>` block (NOT user-editable) → `personaPrompt()` (existing `jarvisPersona.ts`) → `<user-persona>` doc (A6 via a `getPersonaDoc()` seam that returns `null` until SPEC-A lands — render nothing, log once) → `withSkills` (module "jarvis") → `<current_datetime>` → `<active_page>` → voice blocks when `mode==="voice"`. [C3.1] **V:** unit: assembly order + persona-doc-absent path.
- **C3.3** `src/lib/v2/jarvis/tools.ts`: in-process SDK MCP server (`createSdkMcpServer` + `tool()`, agentsHttpTool pattern) exposing: `get_actions {query}` → `hub.getActions`, `execute_action {package, tool, arguments(JSON string)}` → `hub.executeAction({source:"jarvis", interactive:true})`, `memory_search`/`memory_ingest` passthroughs (loud "memory v2 not landed" text result until A), `create_task`, `navigate {route}` (emits a `navigate` SSE event, executes nothing server-side). Tool descriptions ported from upstream `utils/mcp/memory.ts` wording. [D2.x hub, C0.2] **V:** node script drives the SDK server's tools directly with sample args.
- **C3.4** `src/lib/v2/jarvis/brain.ts`: `JarvisBrainV2` on globalThis — Claude Agent SDK `query()` warm session cloned from `jarvisBrain.ts` **switched to streaming-input async-generator prompt** (REQUIRED for SDK MCP tools — verified gotcha), `mcpServers: { agentos: tools }`, system = C3.2 output refreshed per turn, sentence-split streaming preserved, interrupt-on-new-ask preserved, env via `sanitizeSpawnEnv`. Alternate engine `brainEngine:"cli"`: single-shot `cliComplete` with tools DISABLED (documented limitation: CLI lane = answer-only; tool lane requires claude-sdk) — fail loudly if a tool would be needed? No: just no tools registered. [C3.2, C3.3] **V:** ask "what packages do you have tools for?" → tool event stream shows `get_actions` call.
- **C3.5** `POST /api/jarvis/ask/route.ts`: SSE per §5; persists user+assistant rows (parts_json from tool events); AbortController map on globalThis (`__jarvisAskAborts`) — new ask interrupts prior. [C3.4, C2.6] **V:** `scripts/v2/smoke-jarvis-ask.mjs` (§9).
- **C3.6** `src/lib/v2/jarvis/ingest.ts`: `buildEpisodeBody({userText, agentText})` + `sessionBucketId(conversationId, tz)` (user local tz, `{id}-YYYY-MM-DD` — upstream fix, don't reuse bare conversationId) + `ingestExchange()` called fire-and-forget after each persisted turn → SPEC-A queue; until A lands, appends NDJSON to `~/.agentic-os/jarvis-pending-episodes.jsonl` so nothing is lost (append-never-destroy) and logs once per boot. [C3.5] **V:** two asks → two lines in pending file with correct bucket ids.
- **C3.7** C5 page-context: `usePageContext.ts` (`usePageContextDescriptor(desc)` registers into JarvisOmnipresence context on mount/unmount) + wire THREE pilot pages: Overview (`Overview.tsx`: route+today summary), Pipeline (`PipelineView.tsx`: visible deal names/stages), Marketing (`MarketingHub.tsx`: active campaign + tab). Overlay includes current descriptor in ask payload. Never persisted (assert: not written to jarvis_messages). [C2.5] **V:** on /pipeline ask "what's on this page?" → answer names visible deals; grep jarvis_messages content for a deal name from pageContext-only → absent.
- **C3.8** C6 spawn tools in `internalActions.ts` (registered under the `agentos` package, D4): `tasks.create` (SPEC-B store when landed; interim: hermes kanban CLI write path per house rule — writes via `hermes kanban`, never direct SQLite), `coding.spawn {prompt, cwd}` → F3 coding slot (interim: `spawnStream` via runner.ts claude with `--dangerously-skip-permissions` OFF, gated), `browser.open {url}` → F3/E seam (interim: loud "browser slot not landed"). All destructive ones `requires_approval=1`. [D4.1] **V:** Jarvis "create a task to X" → kanban card appears; approval-gated tools refuse without interactive flag.
- **C3.9** `/jarvis` page retrofit (C2b): edit `src/components/JarvisView.tsx` — `rec.onresult` final transcript appends to input buffer; dispatch only on explicit send or `voice.autoSend`; wake-word wake opens buffer; Realtime/Kimi panels behind explicit "Live conversation" opt-in. Existing `/api/hermes/jarvis` backend untouched. [C0.1] **V:** manual: PTT release does not fire a request (network tab), Enter does.

### Phase D — WebMCP Engine

- **D1.1** `src/lib/v2/webmcp/types.ts`: port contract types (Spec, Message, IntegrationEventType, Param/OAuth2Params) from `AgentOSCore/packages/types/src/integration.ts` (+`oauth/params.ts`), drop TUI fields; add our `WebmcpToolRow`, `HandlerSpec` unions. [none] **V:** `tsc` clean.
- **D1.2** `src/lib/v2/webmcp/store.ts`: CRUD for the four tables; slug/name regex guards (`safeId` pattern); archive-not-delete; version snapshot on publish. [C0.2] **V:** unit round-trip: create pkg → add tool → publish → snapshot frozen (later tool edit doesn't mutate snapshot).
- **D1.3** `src/lib/v2/webmcp/sandbox.ts`: `node:vm` runner — `vm.createContext` with ONLY `{args, ctx}` (`ctx.fetch` = global fetch, `ctx.secrets.get(name)` resolving `~/.agentic-os/secrets.json`/env server-side, `ctx.log` capturing to array); `Promise.race` timeout from `settings.webmcp.sandboxTimeoutMs`; errors → `{ok:false,error}` never throw across the API boundary. NOT a security boundary (single-user box) — documented as such; `allowJsHandlers=false` disables kind creation. [C0.1] **V:** unit: echo code runs; `while(true)` times out; `ctx.log` captured; `process` is undefined inside.
- **D1.4** `src/lib/v2/webmcp/execute.ts`: `executeTool(slug, name, args, {source, interactive})` — resolve tool from **published snapshot** for hub calls (drafts only via sandbox), validate args against input schema (loud 400-style error result), dispatch by kind ('internal' → registry; 'http' → template interpolation `{{arg:*}}`/`{{secret:*}}` + `SENSITIVE_HTTP_RE` gate from agentsHttpTool; 'js' → sandbox), truncate result to 32KB inside the (PQueue 3) slot, write `webmcp_call_logs` always. `requires_approval && interactive` → return approval-required result (Human-Gate wiring later; non-interactive → hard refuse, mirroring upstream's deliberate split inverted for safety). [D1.2, D1.3] **V:** unit per kind + log rows written on success and failure.
- **D1.5** `src/lib/v2/webmcp/hub.ts`: `listPublishedPackages` / `getActions(query)` (all published tools → provider-routed LLM filter with ported ACTION_SELECTION prompt, temp 0.3; JSON-parse fail → ALL tools + `console.error` loud) / `executeAction` → D1.4. Register with F4 `/api/mcp` if its registration seam exists (`globalThis.__agentosMcpHub` convention); else export the three functions and log "F4 hub not present — tools reachable via Jarvis only". [D1.4] **V:** node: seed two packages, `getActions("send a message")` returns ≤3 relevant schemas.
- **D2.1** API routes: packages + tools CRUD (`/api/webmcp/packages...` per §5) with ajv-lite schema validation (hand-rolled required/type checks — no new dep — or `zod` if already present; verify at task time). [D1.2] **V:** curl matrix: create/list/get/patch/409s/400s.
- **D2.2** API routes: `test` (sandbox, source="sandbox"), `publish` (semver bump + snapshot + hub refresh, returns `registered`), `export`, `logs` (cursor paging). [D1.3–D1.5] **V:** curl: test an echo tool → result+logs; publish → version row; logs endpoint pages.
- **D3.1** Page shell: `src/app/webmcp/page.tsx` + `WebmcpView.tsx` + `PackageList.tsx`; Sidebar NAV + `ORCHESTRATION_ROUTES` entries. [D2.1] **V:** page renders in correct sidebar section; create package from UI.
- **D3.2** `SpecForm.tsx` + `PackageEditor.tsx` tab shell. [D3.1] **V:** edit spec fields → PATCH persists → reload shows values.
- **D3.3** `ToolDesigner.tsx` + `HandlerEditor.tsx`: schema row-builder ⇄ raw JSON toggle; kind tabs; Monaco via `@monaco-editor/react` (add dep) for 'js' — lazy `next/dynamic` import (client-only, keeps bundle sane). [D3.2] **V:** author an echo 'js' tool fully from UI.
- **D3.4** `SandboxRunner.tsx`: auto-form from input schema (string/number/boolean/enum/JSON fallback textarea), run, result JSON viewer + logs + duration. [D3.3, D2.2] **V:** run echo tool from UI, see result.
- **D3.5** `VersionsPanel.tsx` + `CallLogsPanel.tsx` + `WebmcpSettings.tsx` ConfigMenu. [D3.2, D2.2] **V:** publish from UI shows version + hub-registered state; logs tab shows sandbox runs.
- **D4.1** `src/lib/v2/webmcp/internalActions.ts` + seed migration/boot-seed of the **`agentos` package** (idempotent: upsert by slug, only when absent or version bump): tools `tasks.create/list/update` (interim kanban-CLI backing, B-store when landed), `pipeline.list/status`, `marketing.campaigns.list`, `marketing.item.draft` (approval-stripping rule honored), `memory.search/ingest` (pending-file interim), `navigate`, `settings.get` (read-only, secrets redacted). Each with upstream-grade descriptions + annotations; destructive → `requires_approval=1`. [D1.4] **V:** `scripts/v2/smoke-webmcp.mjs` exercises 3 of them.
- **D4.2** Wire Jarvis to hub (close the loop): confirm C3.3 `get_actions`/`execute_action` resolve the seeded `agentos` package; overlay tool events render. [C3.4, D4.1] **V:** overlay: "list my pipeline deals" → `execute_action(agentos, pipeline.list)` in tool stream + correct answer.
- **D5.1** `exporter.ts`: generate `~/.agentic-os/webmcp/exports/<slug>/{index.mjs,package.json,README.md}` — `index.mjs` implements upstream `run(eventPayload)` switch (GET_TOOLS from snapshot, CALL_TOOL dispatch: 'http' templates inline; 'js' code inlined; 'internal' → stub throwing "internal actions are not exportable" listed in README) + IntegrationCLI-shaped subcommand entry (NDJSON stdout). `mode:"client"` replaces `{{secret:*}}` with `${config:*}` placeholders + config manifest in spec. [D1.2] **V:** export echo package; `node index.mjs get-tools --config {}` prints tool JSON; `call-tool` echoes.

### Retirement (after C stable)
- **CR.1** Point homepage `dashboard/JarvisModule` at `/api/jarvis/ask`; mark `/api/jarvis/brain` deprecated (keep serving; exile only when nothing references it). [C3.5] **V:** homepage module streams from new route.

**Dependency-critical path:** C0.2 → D1.2 → D1.4 → D1.5 → C3.3 → C3.4 → C3.5 → D4.2. UI phases (C2.x, D3.x) parallelize against it.

---

## 8. Risks & Windows-specific notes

1. **F13 doesn't exist on standard keyboards.** Yoshi's key is configurable (AHK config block + `settings.jarvis.hotkey.key`); AHK v2 accepts `F13`–`F24` from macro pads and any remap. Document `CapsLock` remap example in the install md.
2. **AHK vs uiohook-napi:** AHK chosen — no node-gyp/native build on the Next server, survives app restarts, trivially editable. uiohook-napi stays the documented fallback if Yoshi refuses an AHK install (it would live in `instrumentation.ts` boot — riskier: native module in the Next process).
3. **Browser focus limits:** the helper can front the Opera *window* but cannot focus a specific tab. Mitigation: title-match `"Agent OS"` (the app sets `document.title`); fallback opens a new tab at `/?jarvis=1` which `JarvisOmnipresence` reads to auto-open the overlay. Double-open dedupe per C1.5.
4. **Web Speech API in Opera:** Chromium-based Opera has historically shipped `webkitSpeechRecognition` **disabled** (no Google speech backend). `webspeech. available()` must feature-detect and return a reason; Kimi/OpenAI-Realtime providers are the capture path in Opera. Never silently no-op the mic (rule 11 spirit).
5. **SDK MCP tools require streaming-input prompts** (verified repo gotcha). C3.4 must convert jarvisBrain's queue-generator — it already IS a streaming generator; keep it, just add `mcpServers`.
6. **Every spawn through `sanitizeSpawnEnv`** — brain SDK session, cliComplete lane, exporter's verification `node` run in smoke tests. Inherited `PORT` = child hijacks :3737 (IPv6 bind trap).
7. **Tool-name invariant:** upstream's `<slug>_` prefix+strip round-trip is a trap; we store and dispatch the exact advertised name. `getActions` returns names namespaced as `"<slug>/<tool>"` in the *schema title* only, never mutating the callable name.
8. **`node:vm` is not a security boundary.** Sandbox = crash/timeout isolation for a single-user box, documented in-UI ("runs with server privileges"). `allowJsHandlers` toggle exists; secrets only via `ctx.secrets.get` (values never echoed into logs — snippet writer redacts values matching resolved secrets).
9. **proxy.ts fails closed:** forgetting the `/api/jarvis/hotkey` exemption makes the helper silently 302 → the AHK script must treat non-204 as failure and toast (`TrayTip`) so it's never a mystery.
10. **Draft-vs-published drift:** hub/Jarvis execute only published snapshots; the Test tab runs drafts. Publishing is the promotion gate — prevents Jarvis calling a half-edited handler.
11. **pageContext privacy:** per-request only; C3.7's verification includes the negative check (not persisted). Same rule as upstream screenContext.
12. **Foundations timing:** F1 (db runner), F4 (`/api/mcp` transport), SPEC-A (memory), SPEC-B (tasks) may land after us. Every seam has a loud interim: db shim (C0.2), hub-absent log (D1.5), pending-episodes JSONL (C3.6), kanban-CLI task backing (C3.8/D4.1). Nothing silently drops data.
13. **Monaco bundle weight:** load via `next/dynamic` `ssr:false` inside the Tools tab only; the /webmcp route otherwise stays light. If `@monaco-editor/react` fights Next 16, fallback is a `<textarea>` with mono font — ship the fallback behind the same `HandlerEditor` prop so the swap is one file.
14. **No `fs.watch`**, no dev-server restarts by us (rule 12), exile-never-delete for export dirs and archived packages.

---

## 9. Verification plan (`scripts/v2/`)

All scripts: plain node ESM (`.mjs`), read `AGENTOS_PASSWORD` from `.env.local` to mint the auth cookie (sha256 `agentos.v1:`+pw — proxy contract), target `http://127.0.0.1:3737`, exit non-zero on failure, print a one-line PASS/FAIL per check. They test the running dev server Yoshi already has up (rule 12/15: we never restart, never tell him to rebuild).

- **`smoke-jarvis-hotkey.mjs`**
  1. `POST /api/jarvis/hotkey?setup=1` (cookie) → configured. 2. Open SSE `/api/jarvis/hotkey/stream`. 3. POST `/api/jarvis/hotkey` with secret from file → expect SSE `{type:'hotkey'}` within 2s. 4. POST with bad secret → 401. 5. POST without cookie AND without secret → 401 (proxy exemption present but secret enforced).
- **`smoke-jarvis-ask.mjs`**
  1. POST `/api/jarvis/ask` `{text:"reply with the single word pong"}` → collect SSE → expect `meta`+`sentence`(contains pong)+`done`. 2. Re-ask with `conversationId` → 2 user rows via conversations API. 3. Ask with `pageContext:{route:"/pipeline",entities:[{type:"deal",name:"SMOKETEST-DEAL"}]}` asking "name the entity on this page" → answer contains SMOKETEST-DEAL; then fetch messages → assert "SMOKETEST-DEAL" absent from stored user `content`/`parts_json` (privacy check). 4. Assert `~/.agentic-os/jarvis-pending-episodes.jsonl` grew (or Memory V2 queue status if landed).
- **`smoke-webmcp.mjs`**
  1. POST create package `smoke-echo`. 2. POST tool `echo` (kind 'js', `return {echoed: args.text}`). 3. POST test `{args:{text:"hi"}}` → `result.echoed==="hi"`, durationMs>0. 4. POST publish patch → version `0.0.1`. 5. Hub check: `getActions("echo some text back")` via a thin debug route or direct node import → includes `echo`. 6. `execute_action` via Jarvis ask ("use the smoke-echo package's echo tool on the text 'roundtrip'") → tool event + reply contains roundtrip. 7. GET logs filtered `pkg=smoke-echo` → ≥2 rows (sandbox + jarvis sources). 8. POST export → `index.mjs` exists; spawn `node index.mjs get-tools --config "{}"` (through `sanitizeSpawnEnv`) → stdout JSON lists `echo`. 9. Cleanup: archive package (status flip, never delete).
- **Manual checklist (`_design/agentos-v2/ultraplan/CHECKLIST-C2b.md`, written by task C2.4):** the six-step C2b interaction contract + Opera provider-grayout + /jarvis-page no-auto-send network-tab check + AHK fronting from another app.

Phase exit = all three scripts PASS + `tsc` clean + Yoshi's build green.
