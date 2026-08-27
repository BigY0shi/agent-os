# SPEC E+F — Browser (E1-E4) + Agents Page (F1-F6)

Status: IMPLEMENTATION-READY (written 2026-08-27). Author: staff-eng spec pass for Ultraplan.
Covers: **Workstream E** (E1 profiles/sessions, E2 /browser page + CDP live view + headed handoff, E3 browser tools on capability layer, E4 domain allowlists / Opera isolation) and **Workstream F — Agents page** (F1 lifecycle, F2 hero viz + nav, F3 agent record, F4 creation wizard, F5 cards→detail tabs, F6 shared status band).

Naming note: the master plan reuses "F1-F4" for Phase-0 foundations. In this spec, **Fd1-Fd4** = foundations (db, events/scheduler, capability layer, internal MCP); bare **F1-F6** = Agents-page workstream items.

Reference repo (READ-ONLY): `C:/Users/Yoshi/Documents/JulianGolde - AgenticOS/AgentOSCore` (paths below abbreviated `AOC/`).
Target repo: `C:/Users/Yoshi/Documents/JulianGolde - AgenticOS/agent-os` (paths abbreviated by `src/...`).

---

## 1. Scope & goals

### E. Browser
- **E1** — Playwright-driven dedicated browser, fully separate from Yoshi's Opera. **Profiles** = persistent Chromium identities at `~/.agentic-os/browser-profiles/<name>` (max 5, defaults `personal|work|misc`). **Sessions** = named task→profile bindings (max 10) stored in `settings.browser` (rule 16 gear UI). Browser executable selectable: Playwright chromium (default) / Chrome / Brave / custom path — **Opera is deliberately NOT a detection target** (E4).
- **E2** — `/browser` page: session list with live flags, **CDP screencast live view** in-page (JPEG screencast over WS), URL bar + back/fwd/reload, **Take Control** input forwarding, **"Let me log in" headed handoff** (relaunch session headed on the desktop), close/kill controls.
- **E3** — the 18 upstream browser tools (`browser_navigate/snapshot/click/fill/type/press_key/select_option/screenshot/wait_for/evaluate/go_back/go_forward/scroll/close_session/close_all/list_sessions/create_session/delete_session`) implemented in `src/lib/v2/browser/tools.ts` and registered on the **Fd3 capability layer** `browser` slot + exposed through **Fd4 `/api/mcp`** — callable by Jarvis, Tasks (B2), and forged agents (F3).
- **E4** — Safety: (a) agent sessions can only ever launch from `~/.agentic-os/browser-profiles/*` — no code path accepts an arbitrary user-data-dir; (b) optional **per-session domain allowlist** enforced on top-level navigations; (c) audit rows for every session + tool call in `agentos.db`.

### F. Agents page
- **F1** — lifecycle `ideation → forge → test → deployed → observed` layered onto the existing agents module (`agentsStore/Runtime/Triggers` stay the run engine; we EXTEND `AgentDef`, we do not fork it).
- **F2** — hero section: live visualization of every agent (where it is, current run/task, animated status) + nav actions **Deploy Agent**, **Forge Agent**, **Forge Harness**, plus Registry & Runs.
- **F3** — agent record grows: persona (model-agnostic data, `jarvisPersona.ts` pattern), **harness** (selected from a harness library — ralph/fable/feat-loop-style definitions stored as DATA, rule 17), tools (from WebMCP/Fd4 registry), connectors (from G, graceful when G absent), model/provider override, schedule/triggers, lifecycle status.
- **F4** — creation wizard where **harness selection, tool selection, and connector selection are first-class steps** (Yoshi's explicit requirement).
- **F5** — compact cards lower on the page → click → tabbed detail `/agents/[id]`: Overview / Runs & Sessions / Tasks / Tools & Connectors / Memory / Settings.
- **F6** — status feeds from the Fd2 event bus; **shared `<StatusBand/>` component** used identically by the Tasks-page Agents section (B4): green running / blue idle / amber waiting-on-me / red error / gray offline.

### Non-goals
- No multi-gateway/remote gateway support (single machine; capability layer is in-process — Fd3 spec owns the manifest/slot contracts).
- No Yjs/collab, no Redis, no Mastra. No changes to `agentsRuntime.ts` gate/approval machinery beyond additive harness/persona injection.
- Tasks-tab content and Memory-tab content on the agent detail page render real data only when workstreams B and A exist; until then they render an honest "not wired yet" state (house style: never fabricate).

---

## 2. Data model — SQLite DDL

All tables live in `~/.agentic-os/agentos.db` via `getDb()` from `src/lib/v2/db.ts` (Fd1 spec owns migrations; these are migration entries this spec contributes). Agent *definitions* remain authoritative in `~/.agentic-os/agents/<id>/agent.json` (existing store, extended §5.2) — SQLite holds the queryable/event-shaped V2 objects only.

```sql
-- migration: e_browser_1
CREATE TABLE IF NOT EXISTS browser_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_name  TEXT NOT NULL,
  profile_name  TEXT NOT NULL,
  created_by    TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'jarvis' | 'task:<taskId>' | 'agent:<agentId>'
  task_id       TEXT,                          -- B-workstream linkage, nullable
  agent_id      TEXT,                          -- F-workstream linkage, nullable
  created_at    INTEGER NOT NULL,              -- epoch ms
  last_used_at  INTEGER,
  closed_at     INTEGER                        -- NULL while the row's launch is (possibly) live
);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_name ON browser_sessions(session_name);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_task ON browser_sessions(task_id);

CREATE TABLE IF NOT EXISTS browser_tool_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  session_name  TEXT NOT NULL,
  tool          TEXT NOT NULL,                 -- 'browser_navigate', ...
  caller        TEXT NOT NULL DEFAULT 'user',  -- same vocabulary as created_by
  args_preview  TEXT,                          -- JSON, capped 2KB (full payloads never stored)
  ok            INTEGER NOT NULL,              -- 1/0
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_browser_audit_ts ON browser_tool_audit(ts);

-- migration: f_agents_1
CREATE TABLE IF NOT EXISTS harnesses (
  id          TEXT PRIMARY KEY,                -- kebab id, e.g. 'ralph-loop'
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'loop',    -- 'loop' | 'oneshot' | 'council' | 'custom'
  definition  TEXT NOT NULL,                   -- JSON HarnessDef (see §5.3) — pure data, rule 17
  builtin     INTEGER NOT NULL DEFAULT 0,      -- seeded rows; editable but not deletable (exile via UI = builtin stays, user copy wins)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_status_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  status   TEXT NOT NULL,                      -- 'running' | 'idle' | 'waiting' | 'error' | 'offline'
  run_id   TEXT,
  detail   TEXT                                -- short human line: 'run started (gmail trigger)', 'approval pending: http_request'
);
CREATE INDEX IF NOT EXISTS idx_agent_status_agent_ts ON agent_status_events(agent_id, ts);
```

### Settings additions (`src/lib/settings.ts` — rule 16; every field surfaced in a gear)

```ts
browser: {
  wsPort?: number;                    // WS bridge port, default 3738 (see §5.1)
  browserType?: "default" | "chrome" | "brave" | "custom";  // NO opera option — E4
  browserExecutable?: string;         // only when browserType === "custom"
  profiles?: string[];                // default ["personal","work","misc"], max 5, name /^[a-zA-Z0-9_-]+$/
  sessions?: {
    name: string;                     // /^[a-zA-Z0-9_-]+$/, max 10
    profile: string;
    allowedDomains?: string[];        // E4: empty/absent = unrestricted; else top-level navs restricted (eTLD+1 suffix match)
  }[];
};
agentsPage: {
  heroPollMs?: number;                // default 4000 (SSE preferred; poll is fallback)
  defaultHarness?: string;            // harness id preselected in the wizard
};
```

---

## 3. Module layout

```
src/lib/v2/browser/
  config.ts          # profiles/sessions CRUD over settings.ts; profile dirs; exe detection (no Opera)
  manager.ts         # globalThis.__agentosBrowser session map; launch/close; CDP endpoint capture; win32 lock clearing
  tools.ts           # the 18 tools: schemas + handlers + allowlist guard + audit writes
  tickets.ts         # HMAC ticket mint/verify for the WS bridge (port of AOC auth.ts ticket pair)
  wsBridge.ts        # ws.Server on settings.browser.wsPort, booted from instrumentation.ts; CDP proxy
  audit.ts           # browser_sessions / browser_tool_audit row writers (thin, never throws)

src/lib/v2/agents/
  harnesses.ts       # HarnessDef type + CRUD over harnesses table + seedBuiltins() + renderHarness()
  lifecycle.ts       # AgentDefV2 field helpers, lifecycle transitions, back-compat read of old agent.json
  statusFeed.ts      # subscribes Fd2 event bus (fallback: derives from run registry) → agent_status_events + live snapshot

src/app/api/v2/browser/
  profiles/route.ts        # GET, POST, DELETE
  sessions/route.ts        # GET (configured + live-flag), POST (create), DELETE
  launch/route.ts          # POST — idempotent headless launch
  handoff/route.ts         # POST — relaunch headed / re-launch headless after login
  tool/route.ts            # POST — dispatch one browser tool (server-side callers use lib directly)
  ticket/route.ts          # POST — mint WS ticket for a session
  audit/route.ts           # GET — recent audit rows for the page

src/app/api/v2/harnesses/route.ts        # GET, POST, PATCH  (exile-not-delete)
src/app/api/v2/agents/status/route.ts    # GET — SSE stream of status snapshots + events
src/app/api/agents/...                   # existing routes untouched; PATCH body accepts new AgentDefV2 fields

src/app/browser/page.tsx                 # /browser
src/app/agents/page.tsx                  # existing — becomes the new composition (hero + wizard entry + cards)
src/app/agents/[id]/page.tsx             # NEW tabbed detail

src/components/v2/browser/
  BrowserView.tsx       # page shell: session rail + viewer + gear
  SessionList.tsx
  CdpViewer.tsx         # port of AOC cdp-viewer.tsx
  cdpClient.ts          # port of AOC cdp-client.ts
  useCdpScreencast.ts   # port of AOC use-cdp-screencast.ts
  BrowserSettings.tsx   # ConfigMenu children (profiles, sessions, exe, wsPort, allowlists)

src/components/v2/agents/
  AgentsHero.tsx        # live viz + Deploy/Forge/Forge Harness nav
  AgentCardsGrid.tsx    # compact cards
  ForgeWizard.tsx       # multi-step creation wizard (modal/slide-over)
  HarnessLibrary.tsx    # Forge Harness surface: list + JSON/def editor
  AgentDetail.tsx       # tab shell for /agents/[id]
  tabs/{OverviewTab,RunsTab,TasksTab,ToolsTab,MemoryTab,SettingsTab}.tsx

src/components/v2/StatusBand.tsx   # F6 — shared with Tasks page (B4 imports this exact file)

scripts/v2/
  smoke-browser.mjs
  smoke-agents-forge.mjs
```

Conventions honored: every route `runtime="nodejs"`, `dynamic="force-dynamic"`, `no-store`; every client poller uses `usePollWhileVisible`; all cross-request state on `globalThis` (`__agentosBrowser`, `__agentosBrowserWss`, `__agentosAgentStatus`); client-safe types live in `src/lib/v2/browser/typesClient.ts` + additions to `src/lib/agentsTypes.ts` (NO node imports — enforced convention).

---

## 4. Port map (AOC → agent-os)

| Reference file (AOC/) | Our file | Strategy |
|---|---|---|
| `packages/cli/src/utils/browser-config.ts` | `src/lib/v2/browser/config.ts` | **verbatim-adapt** — swap preferences store → `settings.ts`; profile root → `~/.agentic-os/browser-profiles`; drop Brave-preferred bias; NO Opera path ever added; keep MAX 5/10, name regex, migration-free (greenfield) |
| `packages/cli/src/utils/browser-manager.ts` | `src/lib/v2/browser/manager.ts` | **verbatim-adapt** — sessionMap → `globalThis.__agentosBrowser`; `captureCdpEndpoint` (DevToolsActivePort poll + `/json/version`) ports unchanged (works on win32); `clearStaleProfileLocks` gets a **win32 branch** (§8); add `taskId/agentId/caller` plumbed to audit rows |
| `packages/cli/src/server/tools/browser-tools.ts` | `src/lib/v2/browser/tools.ts` | **verbatim-adapt** — all 18 handler bodies + JSON schemas; `resolveLocator` (ref wins over text) unchanged; ADD: allowlist guard in `browser_navigate`, audit write per call, `browser_create_session` also inserts a `browser_sessions` row (upstream webapp behavior, collapsed in-process) |
| `packages/cli/src/server/api/browser/cdp.ts` | `src/lib/v2/browser/wsBridge.ts` | **pattern-only** — same 4 load-bearing mechanics (text-frame normalization, early-frame buffering, close-code sanitizing 1005/1006/1015→1000, codes 4400/4404/4502) but hosted on our own `ws.Server` (no Fastify), ticket-authed |
| `packages/cli/src/server/api/auth.ts` (HMAC ticket pair only) | `src/lib/v2/browser/tickets.ts` | **verbatim-adapt** — `base64url(JSON({sid,exp})) + "." + base64url(HMAC-SHA256(key, payload))`, TTL 5 min, +5s skew, bound to one session. Key = sha256 of `AGENTOS_PASSWORD` + a boot salt persisted at `~/.agentic-os/ws-secret` (fail-closed if password unset, matching proxy.ts) |
| `apps/webapp/app/components/browser/cdp-client.ts` | `src/components/v2/browser/cdpClient.ts` | **verbatim** — minimal CDP client (id-correlated send, per-sessionId listeners, `binaryType='arraybuffer'`, eventModifiers bitmask); only `buildCdpWsUrl` rewritten → `ws://<host>:<wsPort>/cdp/<session>?ticket=...` |
| `apps/webapp/app/components/browser/use-cdp-screencast.ts` | `src/components/v2/browser/useCdpScreencast.ts` | **verbatim** — attach flow, JPEG q70 everyNthFrame 2, **frame ack with frame.sessionId**, `rawKeyDown` for printables, deltaMode wheel scaling, `Emulation.setDeviceMetricsOverride` replay, `Page.getNavigationHistory` back/fwd. Keep the Mac editor-shortcut `commands:[]` mapping (harmless) and add Ctrl variants |
| `apps/webapp/app/components/browser/cdp-viewer.tsx` | `src/components/v2/browser/CdpViewer.tsx` | **verbatim-adapt** — swap Remix UI kit for our Tailwind/CSS-var styling; keep URL-input focus guard, Take Control toggle, non-passive wheel preventDefault, ResizeObserver→debounced 150ms setViewport |
| `apps/webapp/app/services/gateway/browser-cdp-proxy.server.ts` | (folded into `wsBridge.ts`) | **pattern-only** — the 25s heartbeat on both hops; auth = ticket instead of cookie; no workspace membership |
| Prisma `BrowserSession` row semantics | `browser_sessions` table | **pattern-only** — idempotent insert on create_session success; rows are history, Chromium SingletonLock stays the real exclusivity |
| `apps/webapp/app/services/agent/agents/gateway.ts` (BROWSER WORKFLOW prompt block) | seeded as data: `~/.agentic-os/skills/browser-driving/SKILL.md` + harness snippet | **verbatim-adapt** — snapshot-first rules, ref-over-text, recovery ladder, stop-at-login-walls, headed-for-anti-bot; injected via `withSkills(prompt,'browser')` per rule 17 (never baked into provider code) |
| `packages/gateway-protocol/src/manifest.ts` (browser slot shape) | consumed from Fd3 spec | **skip here** — Fd3 owns manifest/slot; we register `{ slot:'browser', tools: BROWSER_TOOLS }` against its API |
| upstream `/agents` UI (none — F is our design) | `src/components/v2/agents/*` | **greenfield** — reuse in-repo `AgentsView.tsx` patterns (approval cards, run transcript polling with seq cursors) rather than AOC |

---

## 5. API contracts

All JSON; errors `{ error: string }` with 4xx/5xx; success shapes below. Server-side callers (capability layer, Jarvis, Tasks engine) import `src/lib/v2/browser/tools.ts` directly — the HTTP routes exist for the UI and for LAN clients.

### 5.1 Browser

```
GET  /api/v2/browser/profiles
  → { profiles: string[], max: 5, browser: { type, path? }, detected: {type,path}[] }
POST /api/v2/browser/profiles        { name }                → { ok: true }
DELETE /api/v2/browser/profiles      { name }                → { ok: true }   // profile DIR is EXILED (rule 1), not rm -rf (diverges from upstream deleteProfile)

GET  /api/v2/browser/sessions
  → { sessions: { name, profile, allowedDomains?, live, cdpReady, headed, currentUrl? }[], max: 10 }
POST /api/v2/browser/sessions        { name, profile, allowedDomains?, taskId?, agentId? } → { ok: true }
DELETE /api/v2/browser/sessions      { name }                → { ok: true }   // config removed; profile data preserved

POST /api/v2/browser/launch          { session }             → { ok, session: { name, profile, cdpReady } }
  // idempotent, always-headless (mirrors AOC POST /api/browser/launch)

POST /api/v2/browser/handoff         { session, headed: boolean }
  → { ok, session: { name, headed, cdpReady } }
  // headed:true  = force-relaunch visible on the desktop ("let me log in")
  // headed:false = relaunch headless after the human finishes; profile keeps the auth state

POST /api/v2/browser/tool
  { tool: "browser_navigate" | ... (18), args: object, caller?: string }
  → { ok: true, result: unknown } | { ok: false, error: { code, message } }
  // codes: TOOL_NOT_FOUND | SESSION_NOT_CONFIGURED | DOMAIN_BLOCKED | TOOL_ERROR | CAPABILITY_DISABLED
  // NOTE upstream lesson: tool-level failures (e.g. locator miss) return ok:false with the message,
  // HTTP 400 — never throw away stdout-equivalent payloads.

POST /api/v2/browser/ticket          { session }
  → { wsUrl: "ws://<reqHost>:<wsPort>/cdp/<session>?ticket=<t>", expiresAt }
  // host taken from the request's Host header so LAN clients get a reachable URL

GET  /api/v2/browser/audit?limit=100&session=<name>
  → { rows: { ts, session_name, tool, caller, ok, error?, args_preview }[] }
```

**Tool arg shapes** (verbatim from AOC browser-tools.ts): every tool takes `session: string`; `navigate {url, headed?}`, `click/fill/type/select_option {element, ref?}` (+`value`/`text`/`values`), `press_key {key}`, `screenshot {}` → `{ base64, mimeType }`, `wait_for {state}`, `evaluate {script}`, `scroll {deltaX?, deltaY?}`, `create_session {session, profile}`, `list_sessions {}` → `{ profiles, sessions:[{name,profile,live}], maxProfiles, maxSessions }`.

**WS bridge** (`ws://host:3738`): path `/cdp/<session>`, query `ticket`. Bidirectional browser-level CDP relay to the captured `webSocketDebuggerUrl`. Server → client and client → server frames are ALWAYS text (UTF-8 JSON). Close codes: 4400 bad/expired ticket, 4404 session not running / no CDP endpoint, 4502 upstream error, 1000 normal. 25s ping both hops. `perMessageDeflate: false`.

### 5.2 Agents

`AgentDef` (in `src/lib/agentsTypes.ts`) gains OPTIONAL fields — old `agent.json` files parse unchanged:

```ts
export type AgentLifecycle = "ideation" | "forge" | "test" | "deployed" | "retired";
export interface AgentDefV2Fields {
  lifecycle?: AgentLifecycle;          // absent = "deployed" (every pre-existing agent is live)
  harnessId?: string;                  // FK into harnesses table; absent = plain single-run (today's behavior)
  persona?: AgentPersona;              // inline record, jarvisPersona shape (rule 17)
  toolIds?: string[];                  // WebMCP/Fd4 tool package ids; absent = today's {mcp, browser} only
  connectorIds?: string[];             // G-workstream connector ids; tolerated-unknown until G exists
  provider?: { kind: "sdk" } | { kind: "cli"; agent: string } | { kind: "ollama"; model: string };
                                       // absent = "sdk" (current agentsRuntime path). cli/ollama run through
                                       // cliComplete/loopEngine — rule 11, fail loudly.
  browserSessions?: string[];          // browser session names this agent may drive (E3∩F3)
}
export interface AgentPersona {        // mirrors JarvisPersona
  name: string; voiceRules: string; audience?: string;
  bannedPhrases: string[]; ctaStyle?: string;
}
```

```
GET  /api/v2/harnesses               → { harnesses: HarnessRow[] }
POST /api/v2/harnesses               { name, description, kind, definition } → { harness }
PATCH /api/v2/harnesses              { id, ...patch }        → { harness }
DELETE /api/v2/harnesses             { id }                  → { ok }   // builtin rows refuse; user rows exiled to table column `exiled_at`? NO — simpler: definition JSON gets {exiled:true}; list filters. Never DROP rows.

GET  /api/v2/agents/status           // SSE
  data: { type: "snapshot", agents: { agentId, name, status, runId?, detail?, since }[] }
  data: { type: "event", agentId, status, runId?, detail, ts }
  // snapshot on connect, then events; client falls back to 4s polling GET ?once=1 when SSE drops
```

**HarnessDef JSON** (the `definition` column — pure data, editable in HarnessLibrary):

```ts
interface HarnessDef {
  systemPreamble: string;        // prepended to the agent's system.md at run start
  loop?: { maxIterations: number; stopWhen: string; reviewPrompt?: string };  // ralph-style
  phases?: { name: string; prompt: string; gate?: "approval" | "none" }[];    // feat-loop-style
  pollCadenceSec?: number;
  notes?: string;
}
```

Seed rows (`seedBuiltins()`, idempotent by id): `oneshot-plain` (empty preamble — today's behavior), `ralph-loop` (iterate-until-done + self-review, distilled from the `ralph-harness` skill), `fable-harness` (distilled from `fable-harness` skill), `feat-loop` (plan→build→verify phases with an approval gate, distilled from `feat-loop` skill). Distillation = copy the skill's operating rules into `systemPreamble`/`phases` as plain text; no skill file references at runtime.

**Harness injection point**: `agentsRuntime.ts` `startRun()` — where `system.md` is read today, render `renderHarness(def, harness, persona)` = `persona block + harness.systemPreamble + system.md`. One function, additive, provider-agnostic (rule 17). `loop`/`phases` semantics are executed by re-prompting within the existing single `query()` session (loop) or sequential runs (phases) — **phase gates reuse the existing approval queue** (`queueApproval` with reason `"gated"`).

---

## 6. UI

Style: existing muted-neobrutalist dashboard — CSS vars (`--fg`, `--panel-border`), per-module accent hex, framer-motion, lucide icons. Accents: **Browser `#38bdf8`** (sky), **Agents keeps `#a78bfa`**.

### /browser (E2)

```
<BrowserView>
├─ Header row: title "Browser" · live-session count · <ConfigMenu accent="#38bdf8"> → <BrowserSettings/>
├─ Left rail <SessionList>                      (w-64)
│    per session: name, profile chip, ●live dot, allowlist badge (n domains | open),
│    buttons: Open (select) · Launch · Headed ("Let me log in") · Close
│    footer: + New session (name + profile picker + optional domain list)
├─ Main <CdpViewer wsUrl>                       (flex-1)
│    toolbar: ← → ⟳ · URL input (omnibox coercion) · status dot ·
│             [Take control ⇄ Release] · [Reconnect] · [Return to headless]  ← shown while headed
│    canvas: screencast (letterboxed, bg --panel)
│    empty states: "session not running → Launch" / "no CDP endpoint (relaunch)" / "headed on desktop —
│                  interact in the real window; view resumes when returned to headless"
└─ Bottom drawer: Audit (last 50 tool calls, usePollWhileVisible 5s)
```

`BrowserSettings` (ConfigMenu children, rule 16): profiles list (add/exile, max 5), browser executable picker (Default/Chrome/Brave/Custom+path, with detected paths shown), WS port field, per-session allowedDomains editor. `SkillsSection` auto-appends as everywhere.

Sidebar: add `{ href: "/browser", label: "Browser", accent: "#38bdf8" }` to `NAV` **and** to the `ORCHESTRATION_ROUTES` Set (documented gotcha: missing the Set lands it in "Self").

### /agents (F2, F5)

```
<AgentsPage>
├─ <AgentsHero>
│   ├─ action nav (right): [Deploy Agent] [Forge Agent] [Forge Harness] [Registry & Runs ↓scroll]
│   ├─ live canvas: one node per agent — avatar dot pulsing by status color, name,
│   │   location chip ("gmail trigger" / "browser: research" / "idle"), current run line,
│   │   animated edges agent→module while running (framer-motion layout anims; no fabricated positions —
│   │   location derives ONLY from run events: trigger kind, tool in flight, browser session in use)
│   └─ data: /api/v2/agents/status SSE (poll fallback usePollWhileVisible heroPollMs)
├─ Approvals strip (existing pattern from AgentsView — unchanged)
├─ <AgentCardsGrid>  (F5 compact cards)
│   card: name · <StatusBand/> · lifecycle chip · harness chip · trigger summary ·
│         last run relative time · current/upcoming task line (from B when present, else last trigger)
│   click → /agents/[id]
└─ footer: Registry & Runs (existing run list, kept)
```

- **Deploy Agent** = wizard opened at the review step for an existing `lifecycle:"test"` agent (promote to `deployed`, enable triggers).
- **Forge Agent** = full `<ForgeWizard/>`.
- **Forge Harness** = `<HarnessLibrary/>` slide-over: harness cards + editor (name/kind/description + structured fields for preamble/loop/phases; raw JSON toggle).

`<ForgeWizard/>` steps (F4 — each step is a first-class screen, Back/Next, state held client-side, single POST at the end):
1. **Idea** — name, one-liner, freeform ideation notes (stored to `system.md` scaffold); "draft with AI" button → `cliComplete` via `settings.defaultAgent`.
2. **Persona** — AgentPersona form (voice rules, banned phrases…) or "none".
3. **Harness** — pick from library (cards w/ kind + description) or jump to Forge Harness. Required step; default `oneshot-plain`.
4. **Tools** — checkboxes: inherit MCP fleet (existing), browser (choose allowed sessions from E1 list), WebMCP packages (from Fd4 registry; empty-state links to /webmcp).
5. **Connectors** — from G registry; honest empty state "No connectors yet — Integrations workstream" until G ships.
6. **Permissions & model** — permissionMode (existing MODE_META cards), intelligence, provider override.
7. **Triggers** — existing trigger editor (manual/webhook/gmail/webwatch/filewatch/schedule NL-or-cron).
8. **Review & Test** — summary; [Create in Test] → creates agent `lifecycle:"test"`, triggers disabled, fires ONE manual test run inline (existing run transcript component); [Deploy] appears when a test run finishes `done`.

`/agents/[id]` (`<AgentDetail/>` tabs):
- **Overview** — status band, lifecycle stepper (ideation→forge→test→deployed, clickable transitions guarded: deploy requires ≥1 successful run), description, persona/harness summary cards, quick actions (Run now, Pause = `enabled:false`, Exile).
- **Runs & Sessions** — existing runs list + transcript viewer (seq-cursor polling, reuse from AgentsView) + browser sessions rows (`browser_sessions WHERE agent_id`), each with "open in /browser" link.
- **Tasks** — B-workstream tasks where `agentId` matches; pre-B: honest empty state.
- **Tools & Connectors** — current grants, edit inline (same controls as wizard steps 4-5).
- **Memory** — pre-A: link to the agent's `memory/facts.md`/`journal.md` (existing files rendered read-only); post-A: endUserId-scoped Memory V2 view.
- **Settings** — full AgentDef editor (existing fields + V2 fields) + danger zone (Exile agent — existing exile path).

### `<StatusBand/>` (F6 — shared file, B4 imports it)

```tsx
// src/components/v2/StatusBand.tsx  (client-safe, zero node imports)
export type BandStatus = "running" | "idle" | "waiting" | "error" | "offline";
export const BAND_COLORS: Record<BandStatus, string> = {
  running: "#34d399", idle: "#60a5fa", waiting: "#fbbf24", error: "#f87171", offline: "#9ca3af",
};
export function StatusBand({ status, label, pulse }: { status: BandStatus; label?: string; pulse?: boolean });
// 4px left border-band + tinted bg + optional pulsing dot; sizes sm|md via className passthrough.
```

Mapping from run reality (in `statusFeed.ts`, single source of truth): active run → `running`; run parked on approval → `waiting`; enabled, no active run → `idle`; last run `error` and no newer success → `error`; `enabled:false` or lifecycle `test|ideation|forge|retired` → `offline` (label carries the lifecycle word). Note this REPLACES per-surface re-derivation; the existing `STATUS_COLORS` in `agentsTypes.ts` stays for run-row chips.

---

## 7. Granular task list

Legend: each task ≤ ~half-day, cold-startable. Deps in brackets. Verification = the check the implementer runs before marking done. Phase-0 foundations (Fd1 db.ts, Fd2 events.ts, Fd3 capability layer, Fd4 /api/mcp) are OTHER specs; where they're missing at build time, the noted fallback applies.

### E1 — profiles & sessions

- **E1.1 Dependencies + settings subtree.** `npm i playwright ws && npm i -D @types/ws`; run `npx playwright install chromium` once and record the note in README-v2. Add `browser` + `agentsPage` subtrees to `Settings` interface + `DEFAULT_SETTINGS` in `src/lib/settings.ts` (defaults: wsPort 3738, browserType "default", profiles ["personal","work","misc"], sessions []). No other files.
  *Verify:* `npx tsc --noEmit` clean; `node -e "require('playwright')"` OK; GET `/api/settings` shows the new subtree.
- **E1.2 `src/lib/v2/browser/config.ts`.** Port AOC `browser-config.ts`: `getConfiguredProfiles/createProfile/exileProfile/getConfiguredSessions/createSessionConfig/deleteSessionConfig/getProfileDir` (root `~/.agentic-os/browser-profiles`), `detectChromePath/detectBravePath` (win32 paths from AOC), `getBrowserExecutable/setBrowserExecutable`, `isPlaywrightReady`. Storage = `readSettings()/writeSettings()` instead of preferences. **exileProfile moves the dir to `~/.agentic-os/browser-profiles/.exile/<stamp>_<name>` (rule 1) — never `fs.rmSync` like upstream.** No Opera detection anywhere.
  *Verify:* unit exercise via `node --experimental-strip-types` scratch script or `scripts/v2/smoke-browser.mjs --config-only`: create profile, list, exile, confirm dir moved.
- **E1.3 `src/lib/v2/browser/manager.ts`.** Port AOC `browser-manager.ts`: `getOrLaunchSession(name, headed=false)`, `launchSession(name, headed)` (force-relaunch), `closeSession/closeAllSessions/getLiveSessions/getSessionCdpInfo`, `captureCdpEndpoint` (DevToolsActivePort poll ≤5s → `/json/version`), `--remote-debugging-port=0` arg always. Session map on `globalThis.__agentosBrowser`. `clearStaleProfileLocks()` with win32 branch (§8) called lazily on first manager use (no boot hook needed). Launch env: plain (Playwright spawns Chromium itself — `sanitizeSpawnEnv` not required, but strip `PORT` from the env passed via `launchOptions.env` if we ever set it; do not set it).
  *Verify:* `scripts/v2/smoke-browser.mjs --launch`: launch session on profile `misc`, assert `cdpReady:true` within 8s, `GET /json/version` reachable, close, relaunch.
- **E1.4 `src/lib/v2/browser/audit.ts`** [needs Fd1 `getDb()`; fallback: no-op stubs with a loud one-time `console.warn`]. `recordSessionRow`, `touchSession`, `closeSessionRow`, `recordToolCall` (args_preview JSON.stringify capped 2048 chars, secrets never present in browser tool args by design). Contribute migrations `e_browser_1` to `db.ts`.
  *Verify:* sqlite3 CLI / node:sqlite read shows rows after a scripted create+navigate.

### E3 — tools (built before the page so the page can drive them)

- **E3.1 `src/lib/v2/browser/tools.ts` part 1 (core interaction).** Port from AOC `browser-tools.ts`: `browser_navigate` (incl. `headed` param for anti-bot), `browser_snapshot` (`page.locator('body').ariaSnapshot()`), `browser_click/fill/type/select_option` with `resolveLocator` (ref → `page.locator(ref)`, else `getByText(element,{exact:false})`; type = `pressSequentially`), `browser_press_key`, `browser_wait_for`. Each handler: resolve session via manager, run, `recordToolCall`. Export `BROWSER_TOOLS: { name, description, inputSchema }[]` (schemas copied from AOC).
  *Verify:* smoke script: navigate example.com → snapshot contains "Example Domain" → click by text works.
- **E3.2 tools part 2 (rest of the 18).** `browser_screenshot` (base64 PNG + mimeType), `browser_evaluate` (`page.evaluate(new Function('return ('+script+')'))` — audited), `browser_go_back/forward`, `browser_scroll` (`mouse.wheel`), `browser_close_session/close_all/list_sessions/create_session/delete_session` (create also `recordSessionRow`; delete = config removal only, profile preserved).
  *Verify:* smoke: screenshot returns decodable PNG; list_sessions shows `live:true`.
- **E3.3 Allowlist guard (E4).** In `browser_navigate` (and the CdpViewer URL bar path — enforced server-side in ticket-scoped nav? No: viewer navs go over raw CDP, see §8 risk 6): if the session config has non-empty `allowedDomains`, parse target URL host, allow iff host === entry or host endsWith "."+entry; else return `{ok:false, error:{code:"DOMAIN_BLOCKED", message:"<host> is not on this session's allowlist (…list…). Edit in Browser settings."}}`. Plus defense-in-depth: on launch, `context.route('**/*', ...)` aborting `resourceType()==='document'` main-frame requests to non-allowlisted hosts (subresources unrestricted — CDNs must load).
  *Verify:* smoke: session with `allowedDomains:["example.com"]` → navigate example.com OK, navigate github.com → DOMAIN_BLOCKED, and a page link-click to a blocked host is aborted (route guard).
- **E3.4 Capability-layer + MCP registration** [needs Fd3/Fd4; fallback: export the registration functions and leave a TODO wire-in noted in the Fd3 spec's task list]. Register `BROWSER_TOOLS` under the `browser` slot manifest; slot-disabled ⇒ tools absent from manifest AND `/api/v2/browser/tool` returns `CAPABILITY_DISABLED` (mirror upstream 404-not-just-strip behavior). Expose through `/api/mcp` with `?source=` tagging. Approval policy: browser tools are non-gated by default; `browser_evaluate` matches Fd3's audit-everything rule.
  *Verify:* MCP client (Claude Code `claude mcp` or scripts/v2 harness) lists browser_* and executes list_sessions.
- **E3.5 Browser-driving skill seed.** Write `~/.agentic-os/skills/browser-driving/SKILL.md` seeding script (idempotent, part of smoke setup) adapting AOC's gateway sub-agent BROWSER WORKFLOW: snapshot-before-first-interaction, re-snapshot after nav, refs-over-text, recovery ladder, stop at login walls → request headed handoff, confirm before irreversible actions. Registered in `settings.skills.modules.browser`.
  *Verify:* `withSkills("x","browser")` output contains the block once (dedupe sentinel intact).

### E2 — /browser page + live view

- **E2.1 `src/lib/v2/browser/tickets.ts`.** Port AOC HMAC ticket mint/verify: key = `sha256(AGENTOS_PASSWORD + readOrCreateBootSalt())`, salt persisted at `~/.agentic-os/ws-secret` (32B random, created once, mode-irrelevant on win32). `mintTicket(session)` → `{ticket, expiresAt}` TTL 300s; `verifyTicket(ticket, session)` constant-time compare, +5s skew. Fail-closed when `AGENTOS_PASSWORD` unset (matches proxy.ts).
  *Verify:* unit: mint→verify OK; tampered payload, wrong session, expired all fail.
- **E2.2 `src/lib/v2/browser/wsBridge.ts` + boot.** `ensureBrowserWs()` creating one `ws.Server` on `globalThis.__agentosBrowserWss`, listening `0.0.0.0:settings.browser.wsPort` (default 3738), `perMessageDeflate:false`. Called from `src/instrumentation.ts` `register()` alongside `ensureScheduler()`. On connection: parse `/cdp/<session>?ticket=`, verify (else close 4400); `getSessionCdpInfo` (else 4404); dial upstream CDP ws. The four mechanics, all mandatory: (1) every relayed frame `.toString('utf8')` sent as TEXT; (2) buffer client frames until upstream `open`, then flush in order; (3) close-code sanitize — forward only 1000 or 3000-4999, else send 1000; (4) 25s ping timers both directions, cleared on close. Upstream error mid-stream → close client 4502.
  *Verify:* smoke: `new WebSocket(wsUrl)` (node `ws`), send `Browser.getVersion` id 1 → JSON response id 1 arrives as text; second concurrent client also works (browser-level CDP is multi-client).
- **E2.3 Ticket + HTTP routes.** Implement `src/app/api/v2/browser/{profiles,sessions,launch,handoff,tool,ticket,audit}/route.ts` per §5.1 contracts (thin wrappers over config/manager/tools/tickets/audit; `handoff` = `launchSession(name, headed)` + audit note). Ticket route builds `wsUrl` from the request Host header's hostname + wsPort.
  *Verify:* curl sequence: create profile→session→launch→ticket returns ws URL; tool navigate + screenshot roundtrip 200.
- **E2.4 Client CDP port.** `cdpClient.ts` + `useCdpScreencast.ts` ported verbatim per §4 (ack with FRAME sessionId; rawKeyDown; JPEG q70; viewport override replay; getNavigationHistory back/fwd; omnibox URL coercion).
  *Verify:* used by E2.5; standalone: Storybook-less — a temporary `/browser` stub page renders frames from a launched session.
- **E2.5 `CdpViewer.tsx` + `SessionList.tsx` + `BrowserView.tsx` + page.** Compose per §6. Viewer fetches ticket on mount + on Reconnect (tickets are single-TTL; reconnect re-mints). Take Control toggle gates input forwarding; wheel listener `{passive:false}`. Headed state shows the "interact on desktop" banner + [Return to headless] → `/handoff {headed:false}`.
  *Verify:* manual + `scripts/v2/smoke-browser.mjs --e2e`: launch, open /browser, see live frames (script asserts ≥1 screencastFrame within 5s via its own WS attach), type in URL bar navigates.
- **E2.6 Settings gear + sidebar.** `BrowserSettings.tsx` inside `<ConfigMenu title="Browser" accent="#38bdf8">` covering EVERY `settings.browser` field (rule 16); add `/browser` to `NAV` + `ORCHESTRATION_ROUTES` in `src/components/Sidebar.tsx`.
  *Verify:* toggle browserType → persisted via PATCH /api/settings; sidebar shows Browser under Agent Orchestration (not "Self").

### E4 — safety hardening (beyond E3.3)

- **E4.1 Opera-isolation invariant + audit surfacing.** (a) Grep-provable invariant: `launchPersistentContext` is called in exactly ONE file (`manager.ts`) and its dir argument is exactly `getProfileDir(profile)` — add a comment-anchored lint note + smoke assertion that no code path passes user input as a directory. (b) `detectAvailableBrowsers` never returns Opera even though Opera is Chromium (comment why: Yoshi's daily browser, E4). (c) Audit drawer on /browser (GET /audit) + closed-session rows get `closed_at`.
  *Verify:* `grep -rn "launchPersistentContext" src/` → 1 hit; smoke asserts audit rows exist for every tool call in the run.

### F — Agents page

- **F1.1 Types + store back-compat.** Add `AgentLifecycle`, `AgentDefV2Fields`, `AgentPersona`, `BandStatus` to `src/lib/agentsTypes.ts` (client-safe). `agentsStore.ts`: read tolerates absent fields (spread defaults: `lifecycle: "deployed"`); write round-trips them. Existing routes' PATCH accepts the new fields (they already pass through the AgentDef object — verify and extend validation).
  *Verify:* tsc clean; existing agents still list; PATCH with `lifecycle:"test"` persists to agent.json.
- **F1.2 `src/lib/v2/agents/lifecycle.ts`.** `transitionLifecycle(agentId, to)` with guards: →`deployed` requires ≥1 run with status `done` (scan run metas) AND at least the manual trigger; →`test` disables triggers (sets `enabled:false` semantics? NO — keep `enabled` orthogonal: test agents are `enabled:true` but `agentsTriggers` tick SKIPS agents whose lifecycle ∈ {ideation,forge,test,retired} — one-line filter in the tick loop); `retired` = exile-adjacent soft state (agent stays on disk).
  *Verify:* unit script: forge agent in test → trigger tick doesn't fire it; after a done run, deploy succeeds, tick fires.
- **F2.1 `src/lib/v2/agents/statusFeed.ts`** [Fd2 event bus preferred; REQUIRED fallback built first: derive from the run registry + approvals registry that `agentsRuntime.ts` already maintains on globalThis]. `getStatusSnapshot(): AgentStatus[]` (mapping per §6 StatusBand rules) + `subscribe(cb)` — when Fd2 exists, also emit `agent.status` bus events and insert `agent_status_events` rows on every transition (dedupe: only on change). Hook points: `agentsRuntime` run start/end/error + approval queue/resolve (wrap, don't rewrite — export a `notifyStatus()` called from the 4 existing sites).
  *Verify:* start a manual run → snapshot shows `running` then `idle`; queue an approval (ask-mode agent) → `waiting`; rows land in agent_status_events.
- **F2.2 SSE route `src/app/api/v2/agents/status/route.ts`.** Snapshot event on connect, then change events via `subscribe`; heartbeat comment every 25s; `?once=1` returns JSON snapshot (poll fallback).
  *Verify:* `curl -N` shows snapshot + a live transition during a manual run.
- **F6.1 `src/components/v2/StatusBand.tsx`.** Per §6 exactly (client-safe, exported BAND_COLORS). PR note to the B-spec implementer: B4 imports this file — do not fork.
  *Verify:* renders all 5 states in /agents cards; tsc clean with no node imports.
- **F3.1 `src/lib/v2/agents/harnesses.ts` + routes.** HarnessDef type, CRUD on the `harnesses` table, `seedBuiltins()` (4 seeds per §5.2, idempotent, called lazily on first GET), `renderHarness(agentDef, harness, persona): string` (persona block via a single renderer function — the ONLY record→prompt site, jarvisPersona pattern), `/api/v2/harnesses` route.
  *Verify:* GET seeds+returns 4 builtins; POST/PATCH roundtrip; renderHarness snapshot test in smoke script.
- **F3.2 Harness/persona injection into runs.** In `agentsRuntime.ts` at system-prompt assembly: if `harnessId`, load + `renderHarness`; if `provider` is cli/ollama, route the run's completions through `cliComplete`/`ollama` (rule 11 — unresolvable provider throws loudly, run status `error`, NEVER silent SDK fallback). `loop` harness: after each completed turn, if stopWhen unmet and iteration < max, re-prompt within the same query stream; `phases`: sequential prompts, `gate:"approval"` parks on the existing approval queue.
  *Verify:* forge a test agent with `ralph-loop`, run manual, transcript shows ≥2 iterations then stop; a `phases` harness with a gate produces an approval card.
- **F4.1 `ForgeWizard.tsx` shell + steps 1-3.** Slide-over/modal, step machine (local state), Idea / Persona / Harness screens per §6. Harness step fetches `/api/v2/harnesses`; "Forge Harness" deep-link opens HarnessLibrary.
  *Verify:* wizard opens from hero nav, steps navigate, state survives back/forward.
- **F4.2 Wizard steps 4-8 + create.** Tools (inherit-MCP, browser incl. session multi-select from `/api/v2/browser/sessions`, WebMCP list from Fd4 registry route — tolerate 404 with empty state), Connectors (G registry or empty state), Permissions & model, Triggers (reuse existing trigger editor markup from AgentsView), Review & Test. Create = existing POST /api/agents create route + PATCH V2 fields + `lifecycle:"test"`; Test run = existing manual-run route, transcript inline (reuse run-transcript component); Deploy button → `transitionLifecycle`.
  *Verify:* `scripts/v2/smoke-agents-forge.mjs`: API-driven forge→test-run→deploy of a trivial "echo the date" agent completes end-to-end.
- **F4.3 `HarnessLibrary.tsx`.** Card list + editor (structured fields + raw-JSON toggle + validate-on-save against HarnessDef shape); builtins editable-but-not-deletable, user rows "delete" = exiled flag.
  *Verify:* edit a builtin's preamble, next run of an agent using it reflects the change.
- **F2.3 `AgentsHero.tsx`.** Per §6: nodes from the status SSE, framer-motion animated; location chip derives strictly from real signals (last trigger kind / in-flight tool name from latest run event / linked browser session live flag) — absent signal renders "—" (honest-telemetry house style). Nav buttons wired (Deploy opens wizard-at-review listing test agents; Forge opens wizard; Forge Harness opens library).
  *Verify:* with 2 agents (one running), hero shows distinct states live; killing the run flips the node within one event.
- **F5.1 `AgentCardsGrid.tsx` + page recomposition.** `src/app/agents/page.tsx` renders Hero → approvals strip (existing) → cards grid → existing Registry & Runs. Existing AgentsView pieces are extracted/reused, not duplicated (approval cards + run list become shared components under `src/components/v2/agents/` if extraction is cheap; else AgentsView remains mounted for those sections below the new hero/cards — implementer's call, but NO duplicated fetch logic).
  *Verify:* page renders with 0 agents (empty states), with existing pre-V2 agents (defaults applied), interactions from the old page still work.
- **F5.2 `/agents/[id]` detail tabs.** `src/app/agents/[id]/page.tsx` + `AgentDetail.tsx` + six tab components per §6. Runs tab reuses the seq-cursor transcript polling; Sessions sub-list from `browser_sessions WHERE agent_id`; Tasks/Memory tabs render guarded empty states pre-B/pre-A.
  *Verify:* navigate from a card; each tab loads without error both for a fresh forge-wizard agent and a legacy agent.
- **F5.3 Settings tab + exile.** Full editor posting to existing PATCH; danger zone uses the existing exile route.
  *Verify:* rename agent, change harness, exile → agent disappears from grid, dir present under `agents/.exile/`.

### Cross-cutting

- **X.1 `scripts/v2/smoke-browser.mjs`** — see §9.
- **X.2 `scripts/v2/smoke-agents-forge.mjs`** — see §9.
- **X.3 Docs stub** `_design/agentos-v2/NOTES-E-F.md` — one page: ports chosen, firewall command, Opera invariant, harness seed provenance. (Working notes, not a report.)

**Suggested order:** E1.1 → E1.2 → E1.3 → E3.1 → E3.2 → E3.3 → E2.1 → E2.2 → E2.3 → E2.4 → E2.5 → E2.6 → E1.4 → E3.4 → E3.5 → E4.1 → X.1 ‖ then F1.1 → F2.1 → F2.2 → F6.1 → F3.1 → F3.2 → F1.2 → F4.1 → F4.2 → F4.3 → F2.3 → F5.1 → F5.2 → F5.3 → X.2. E and F are independent except F4.2's browser-session picker (tolerates E absent with an empty state).

---

## 8. Risks & Windows-specific notes

1. **No WS upgrade in Next 16 route handlers** → we run a **secondary in-process `ws.Server` on port 3738** started from `instrumentation.ts`. Same Node process ⇒ it sees `globalThis.__agentosBrowser`. Risks: (a) port collision — fail loudly at boot with the exact conflict message; port configurable in settings; (b) **proxy.ts password gate does NOT cover :3738** — that's why every connection requires an HMAC ticket minted by a password-gated API route; (c) LAN use needs a firewall rule: `New-NetFirewallRule -DisplayName "AgentOS Browser WS" -Direction Inbound -LocalPort 3738 -Protocol TCP -Action Allow` (document in NOTES, surface in BrowserSettings as copyable text). (d) `next dev` restarts the process on config changes — bridge re-created by `ensureBrowserWs()` idempotently; live viewers reconnect via the Reconnect button.
2. **SingletonLock on win32 is not a symlink** — AOC's `readlinkSync` parse is POSIX. Win32 branch: if `SingletonLock`/`SingletonCookie`/`SingletonSocket` exist and no live session in our map uses that profile, delete the lock files (`fs.rmSync` on lock files only is permitted — they are Chromium runtime droppings, not user data; note this exception explicitly in code comments referencing rule 1). Chromium on Windows largely self-heals; run the clearer lazily before launch, never mid-session.
3. **CDP frames must be TEXT** and every screencast frame must be **acked with the frame's own sessionId**; close codes 1005/1006/1015 are receive-only. These three upstream-verified gotchas are encoded as mandatory mechanics in E2.2/E2.4 — regressions here look like "blank viewer" or "Chromium closes instantly"; check these first.
4. **Headed handoff on a remote-control session** (memory rule 14): the headed Chromium window opens on the Windows desktop — visible over remote control (normal window, not secure desktop), so this is fine remotely, but the UI banner should say the window is on the desktop, not embedded.
5. **One profile = one Chromium.** Two sessions on the same profile fight over the lock; `manager.ts` must refuse to launch a second live session on a profile already used by a live session, with a clear error naming the holder. (Upstream relies on the lock; we pre-check the map for a better message.)
6. **Allowlist ≠ sandbox.** The route-interception guard covers agent-driven navs and page-initiated navs, but a human in Take Control drives raw CDP past `browser_navigate` — the context-level `context.route` document guard still applies (it's context-wide), which is why E3.3 installs it at launch, not per-tool. `browser_evaluate` can still fetch cross-origin within the page; allowlists are a guardrail, not a security boundary — say so in the settings UI copy.
7. **Playwright download size / first-run**: `npx playwright install chromium` (~130MB) is a one-time manual step; `isPlaywrightReady()` gates the UI with an install hint instead of a crash. If corporate Chrome exists, `browserType:"chrome"` skips the download entirely.
8. **Foundations drift**: this spec consumes Fd1 `getDb()`, Fd2 bus, Fd3 slot registration, Fd4 MCP registry. Every consumption site has a specified fallback (loud no-op audit, run-registry-derived status feed, deferred registration, empty wizard lists) so E/F build and demo standalone — Phase 7 in the master plan assumes foundations exist, but do not hard-block.
9. **`node:sqlite` vs `better-sqlite3`**: recon confirmed better-sqlite3 is NOT installed; kanbanDb uses built-in `node:sqlite`. This spec is agnostic — it uses `getDb()` from Fd1's `db.ts` whatever it wraps. Flag to the Fd1 spec owner; if Fd1 lands on `node:sqlite`, keep the `process.getBuiltinModule("node:sqlite")` webpack dodge from `kanbanWorkspace.ts`.
10. **Existing agents keep working**: every AgentDef change is optional-field-additive; the triggers tick filter (F1.2) defaults absent lifecycle to `deployed` so nothing pre-existing stops firing. Test this explicitly (F1.1 verify).
11. **No `fs.watch`** anywhere (unreliable on Windows — house rule); nothing in this spec needs it.
12. **Output caps**: screenshots/base64 through the MCP/tool layer should be size-noted (a full-page PNG can be MBs); `browser_screenshot` returns viewport-only (upstream behavior), audit stores no image bytes.

---

## 9. Verification plan (`scripts/v2/`)

Both scripts: plain Node ESM, `node scripts/v2/<name>.mjs`, hit `http://127.0.0.1:3737` with the `AGENTOS_PASSWORD` cookie (same sha256 scheme as proxy.ts), exit non-zero on first failure, print a ✅/❌ table. They assume the dev server is ALREADY running (rule 12: never start/restart it ourselves — print a clear message if unreachable).

**`smoke-browser.mjs`** (flags `--config-only`, `--launch`, `--e2e`; default = all):
1. Settings roundtrip: PATCH a scratch profile name in, GET it back, PATCH out.
2. Profile CRUD: create `smoke_p`, list contains it, exile, dir moved under `.exile/`.
3. Session CRUD + launch: create `smoke_s`→`misc`; POST /launch → `cdpReady:true` ≤8s.
4. Tools: navigate `https://example.com` → snapshot contains "Example Domain" → screenshot decodes as PNG → evaluate `document.title` returns "Example Domain" → list_sessions shows live.
5. Allowlist: create `smoke_locked` with `allowedDomains:["example.com"]`; navigate example.com OK; navigate `https://github.com` → `DOMAIN_BLOCKED`.
6. Live view: POST /ticket; open WS with `ws` pkg; send `Target.setDiscoverTargets` before... (deliberately immediately, exercising early-frame buffering); attach to the page target, `Page.startScreencast`; assert ≥1 `Page.screencastFrame` within 5s; ack it; close 1000.
7. Handoff: POST handoff headed:true → session relaunches (new `createdAt`), headed:false returns headless, prior cookies still present (set a cookie via evaluate in step 4, assert it survived — this is the E-workstream acceptance test in miniature: "log in once, stay logged in").
8. Audit: GET /audit shows rows for every tool call above; browser_sessions rows exist with closed_at set after close_all.
9. Cleanup: close_all, delete smoke sessions (configs), exile smoke profile.

**`smoke-agents-forge.mjs`**:
1. Harness seeds: GET /api/v2/harnesses → the 4 builtins present.
2. Forge via API: create agent `smoke-echo` (system.md "Reply with today's date and stop", harnessId `oneshot-plain`, lifecycle `test`, trigger manual only, permissionMode bypass, intelligence fast).
3. Test-gate: attempt lifecycle→`deployed` BEFORE any run → 409/guard error.
4. Run: fire manual run; poll run events by seq cursor until `result`; assert status `done`.
5. Status feed: during step 4, GET `/api/v2/agents/status?once=1` at start and end → `running` then `idle`; agent_status_events grew.
6. Deploy: lifecycle→`deployed` now succeeds; triggers-tick eligibility flag flips (read back agent.json).
7. Harness loop: PATCH agent to `ralph-loop` (maxIterations 2), run manual, assert transcript contains ≥2 assistant turns (loop executed) and terminates.
8. Detail surfaces: GET existing per-agent routes for runs list (used by RunsTab) return the smoke run.
9. Cleanup: exile `smoke-echo` via the existing exile route; assert gone from list, present under `agents/.exile/`.

Acceptance (mirrors master-plan Verify lines): **E** — "agent logs into a test site once headed, then completes a headless authenticated flow; live view streams" = smoke steps 6-7 plus a manual pass on a real login site. **F** — "forge a trivial agent end-to-end, deploy on a schedule, watch it in the hero viz" = smoke-agents-forge + manually adding a `schedule` trigger ("every 15 minutes") post-deploy and watching the hero node pulse on the next tick.
