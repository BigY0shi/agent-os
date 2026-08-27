# SPEC-F — AnyNotes (I) · Newsletter (K) · Marketing Hub upgrades (J) · Hermes 3D (L)

Status: IMPLEMENTATION-READY (written 2026-08-27, staff-engineer pass).
Inputs: `_design/agentos-v2/MASTER-PLAN.md`, `_design/agentos-v2/DOCS-CHEATSHEET.md`, recon digests (integrations / tasks / current-repo), read-only reference repo `..\AgentOSCore`.
Assumed foundations (owned by other Ultraplan specs, referenced here by contract only): **F1** `src/lib/v2/db.ts` (better-sqlite3 + sqlite-vec, `~/.agentic-os/agentos.db`, versioned migrations, WAL), **F2** `src/lib/v2/events.ts` (typed bus + persisted event log) and `src/lib/v2/scheduler.ts` (RRULE jobs, boot rehydration via `src/instrumentation.ts`), **A** Memory V2 (`ingestEpisode()`, labels), **H2** in-repo widget registry. Where a foundation is not yet merged, every task below states its degraded/standalone path so this workstream never blocks on them.

Hard rules honored throughout: rule 11 (provider routing via `cliComplete`, fail loudly), rule 16 (every knob has an in-app ConfigMenu surface), rule 17 (personas/prompts are editable data), exile-never-delete, `sanitizeSpawnEnv` on every spawn, `usePollWhileVisible` on every polling page, no server restarts (Yoshi rebuilds), never fabricate metrics.

---

## 1. Scope & goals

| ID | Item | This spec delivers |
|---|---|---|
| **I1** | AnyNotes model | SQLite-backed note {url, type, title, capturedAt, content snapshot, labels, status inbox/kept/archived, reply thread} |
| **I2** | Capture paths | Paste-a-URL box (oEmbed for tweets/YouTube, readability for articles), screenshot drop/paste, plain-text note; Opera bookmarklet snippet (copyable, no extension build) |
| **I3** | Inbox UI | `/anynotes` masonry/grid inbox, type/label/status filters, note detail with reply thread; replies can `@jarvis` → agent reply lands in-thread + attention event for Homepage H4 |
| **I4** | Memory ingestion | Every captured note (and every jarvis exchange on it) ingested into Memory V2 with `anynotes` + type labels so Jarvis recalls "that tweet about X" |
| **K1** | Accounts | Existing agent Gmail connected via Google OAuth (installed-app flow, refresh token persisted); addy.io REST client keyed from `~/.agentic-os/newsletter/config.json` (key NEVER shown/committed; settings UI renders "configured ✓" only) |
| **K2** | Subscription manager | Directory of newsletters (name, alias, topic, cadence, status), one-click "subscribe with alias" helper (creates addy alias, copies it, opens signup URL) |
| **K3** | Ingest + dedupe | Scheduled Gmail poll (ports upstream gmail `schedule.ts` watermark pattern), HTML→markdown parse, LLM item extraction, story dedupe via URL canonicalization + embedding cosine |
| **K4** | Edition builder | Daily F2 job compiles a sectioned "newspaper" with per-story source chips; `/newsletter` shows today + archive; `newsletter-latest` widget registered for H3 |
| **J1** | Campaign-first | Campaign becomes a routed first-class object: `/marketing/[slug]` detail page; hub list links into it |
| **J2** | Per-campaign tabs | Overview / Calendar (month grid, campaign-scoped) / Mini-Kanban (drag-drop: idea → drafting → approval → scheduled → posted) / Assets / Metrics (post counts computed, platform metrics manual entry — never fabricated) |
| **J3** | Cross-campaign rollup | `/api/marketing/rollup` merged calendar, deterministic color per campaign, rendered in hub Calendar tab |
| **J4** | Context wiring | Ideate chat + persona records injected into campaign-scoped drafting (already partly live); mandatory deterministic humanizer gate (em/en-dash scrub + verify) before any item can be approved |
| **L1** | Asset pipeline | `E:/Game Assets/SyntyStudio/Unreal/POLYGON_Office_SourceFiles_v4.zip` (verified on disk, 44.4 MB) → FBX → GLB with Draco; documented, scripted where automatable |
| **L2** | r3f scene | `/hermes-3d`: three.js/r3f office, Hermes avatar at desk, state-driven animation (idle/thinking/talking) wired to the F2 event bus (SSE) with poll fallback; click-to-talk into Hermes chat |
| **L3** | Budget + doc | `public/hermes3d/` ≤ 15 MB enforced by smoke script; pipeline doc at `_design/hermes3d/PIPELINE.md` |

Out of scope here (owned elsewhere): the widget grid itself (H2 — we only register widgets), Memory V2 internals (A), scheduler internals (F2), share-from-phone capture (later), Ghost/social auto-publish (marketing stays approval-gated draft/export).

---

## 2. Data model — SQLite DDL

All tables live in `~/.agentic-os/agentos.db`, created by numbered migrations registered in `src/lib/v2/db.ts`. Migration names below are indicative — take the next free numbers at implementation time. Embeddings are stored as `BLOB` (Float32Array, little-endian, dim from settings `memory.embedDim` default 768). If the sqlite-vec extension loaded successfully (F1 exposes `db.hasVec()`), a companion `vec0` virtual table is populated for KNN; otherwise brute-force cosine in JS over candidate rows (bounded scans below keep this cheap).

### Migration `anynotes` (workstream I)

```sql
CREATE TABLE IF NOT EXISTS anynotes (
  id            TEXT PRIMARY KEY,                 -- nanoid(12)
  url           TEXT,                             -- null for screenshot/text notes
  type          TEXT NOT NULL CHECK (type IN ('tweet','article','video','screenshot','text')),
  title         TEXT NOT NULL DEFAULT '',
  author        TEXT,                             -- tweet author / article byline
  site          TEXT,                             -- hostname or provider name
  content_md    TEXT NOT NULL DEFAULT '',         -- snapshot: oEmbed text / readability md / user text
  media_path    TEXT,                             -- relative path under ~/.agentic-os/anynotes/media/
  thumb_url     TEXT,                             -- remote thumbnail (oEmbed/og:image), display-only
  status        TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','kept','archived')),
  labels        TEXT NOT NULL DEFAULT '[]',       -- JSON string[]
  meta          TEXT NOT NULL DEFAULT '{}',       -- JSON: {oembed?, og?, ocr?, captureMode}
  episode_id    TEXT,                             -- Memory V2 episode id once ingested (I4)
  captured_at   TEXT NOT NULL,                    -- ISO
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_anynotes_inbox ON anynotes(status, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_anynotes_type  ON anynotes(type,   captured_at DESC);

CREATE TABLE IF NOT EXISTS anynote_replies (
  id           TEXT PRIMARY KEY,
  note_id      TEXT NOT NULL REFERENCES anynotes(id),
  author       TEXT NOT NULL CHECK (author IN ('user','jarvis')),
  body         TEXT NOT NULL,
  pending      INTEGER NOT NULL DEFAULT 0,        -- 1 = jarvis reply queued/being generated
  error        TEXT,                              -- loud failure surface (rule 11)
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_anynote_replies ON anynote_replies(note_id, created_at);
```

Note bodies never get deleted: "archive" is a status; a destructive request exiles the row to `anynotes_exile` (same columns + `exiled_at`), created in the same migration.

### Migration `newsletter` (workstream K)

```sql
CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id           TEXT PRIMARY KEY,                  -- nanoid(12)
  name         TEXT NOT NULL,
  topic        TEXT,                              -- freeform topic tag, drives alias description + sectioning hint
  alias_id     TEXT,                              -- addy.io alias UUID
  alias_email  TEXT,                              -- e.g. x7f2@yoshi.addy.io
  signup_url   TEXT,
  cadence      TEXT NOT NULL DEFAULT 'unknown' CHECK (cadence IN ('daily','weekly','monthly','unknown')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','dead')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT
);

CREATE TABLE IF NOT EXISTS newsletter_emails (
  id              TEXT PRIMARY KEY,
  gmail_id        TEXT NOT NULL UNIQUE,           -- Gmail message id → natural idempotency
  thread_id       TEXT,
  subscription_id TEXT REFERENCES newsletter_subscriptions(id),  -- matched by to_addr == alias_email, else null
  from_addr       TEXT, to_addr TEXT, subject TEXT,
  received_at     TEXT NOT NULL,                  -- ISO from internalDate
  content_md      TEXT NOT NULL DEFAULT '',       -- turndown output, boilerplate-stripped
  parse_status    TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending','parsed','failed','skipped')),
  parse_error     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nl_emails_recv ON newsletter_emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_nl_emails_ps   ON newsletter_emails(parse_status);

CREATE TABLE IF NOT EXISTS newsletter_stories (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  canonical_url TEXT,                             -- null when the item has no link
  summary       TEXT NOT NULL DEFAULT '',
  topic         TEXT,                             -- section assigned at edition build
  embedding     BLOB,                             -- Float32Array of title+summary
  first_seen    TEXT NOT NULL,                    -- YYYY-MM-DD (edition-date bucketing)
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nl_stories_url
  ON newsletter_stories(canonical_url) WHERE canonical_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nl_stories_seen ON newsletter_stories(first_seen);

CREATE TABLE IF NOT EXISTS newsletter_story_sources (
  story_id    TEXT NOT NULL REFERENCES newsletter_stories(id),
  email_id    TEXT NOT NULL REFERENCES newsletter_emails(id),
  source_name TEXT NOT NULL,                      -- subscription name or from_addr fallback
  item_url    TEXT,                               -- the source's own (uncanonicalized) link
  item_title  TEXT,
  PRIMARY KEY (story_id, email_id)
);

CREATE TABLE IF NOT EXISTS newsletter_editions (
  date       TEXT PRIMARY KEY,                    -- YYYY-MM-DD
  built_at   TEXT NOT NULL,
  content    TEXT NOT NULL                        -- JSON EditionDoc (see §5)
);

CREATE TABLE IF NOT EXISTS newsletter_state (     -- sync watermark + misc, gmail schedule.ts pattern
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
-- keys used: lastSyncTime (unix ms), lastEditionDate
```

### J and L: no new DDL

Per the current-repo recon judgment ("don't migrate existing modules preemptively"), **Marketing stays on its JSON file store** (`~/.agentic-os/marketing/campaigns/<slug>.json`). J extends the `Campaign` type in place (see §5). Hermes 3D has no persistence beyond settings.

---

## 3. Module layout

```
src/lib/v2/anynotes/
  store.ts            -- CRUD over anynotes/anynote_replies (better-sqlite3 via v2/db)
  capture.ts          -- URL classification + oEmbed + readability + screenshot save
  jarvisReply.ts      -- @jarvis reply generation (cliComplete + memory search + ingest)
src/lib/v2/newsletter/
  config.ts           -- reads ~/.agentic-os/newsletter/config.json (addyio + google blocks); "configured" booleans only ever leave the server
  addy.ts             -- addy.io REST client (create/list/toggle aliases)
  gmail.ts            -- OAuth2 client (googleapis), token persistence, incremental fetch (ports upstream schedule.ts)
  parse.ts            -- HTML→md (turndown), boilerplate strip, LLM item extraction (provider-routed)
  dedupe.ts           -- canonicalizeUrl(), embedStory(), findDuplicate()
  edition.ts          -- buildEdition(date), sectioning, EditionDoc shape
  store.ts            -- CRUD over the newsletter_* tables
  jobs.ts             -- registers 'newsletter.sync' + 'newsletter.edition' with F2 scheduler
src/lib/v2/marketing/
  assets.ts           -- campaign asset files under ~/.agentic-os/marketing/assets/<slug>/
  metrics.ts          -- MetricEntry append/list on the campaign JSON; computed post counts
  rollup.ts           -- merged calendar across campaigns + deterministic campaign color
  humanize.ts         -- deterministic em/en-dash scrub + verifier (J4 gate)
src/lib/v2/hermes3d/
  state.ts            -- server: derives HermesActivityState; emits hermes.state events

src/app/api/anynotes/route.ts                    -- GET list / POST capture
src/app/api/anynotes/[id]/route.ts               -- GET / PATCH (status, labels, title) / DELETE→exile
src/app/api/anynotes/[id]/replies/route.ts       -- GET thread / POST reply (may trigger jarvis)
src/app/api/anynotes/media/[file]/route.ts       -- serves saved screenshots (path-guarded)
src/app/api/newsletter/subscriptions/route.ts    -- GET / POST (creates addy alias)
src/app/api/newsletter/subscriptions/[id]/route.ts -- PATCH / DELETE→paused+alias off
src/app/api/newsletter/sync/route.ts             -- POST manual "sync now"; GET sync status
src/app/api/newsletter/edition/route.ts          -- GET ?date= (default latest) / POST rebuild
src/app/api/newsletter/gmail/auth/route.ts       -- GET → begins OAuth (returns auth URL)
src/app/api/newsletter/gmail/callback/route.ts   -- GET → code exchange, persists refresh token
src/app/api/marketing/campaigns/[slug]/assets/route.ts  -- GET list / POST upload (multipart) / DELETE→exile
src/app/api/marketing/campaigns/[slug]/metrics/route.ts -- GET / POST manual entry
src/app/api/marketing/rollup/route.ts            -- GET merged calendar
src/app/api/hermes3d/state/route.ts              -- GET current state (poll fallback for the scene)

src/app/anynotes/page.tsx
src/app/newsletter/page.tsx
src/app/marketing/[slug]/page.tsx                -- campaign detail (tabs)
src/app/hermes-3d/page.tsx

src/components/v2/anynotes/{AnyNotesView.tsx, NoteCard.tsx, NoteDetail.tsx, CaptureBox.tsx, AnyNotesSettings.tsx}
src/components/v2/newsletter/{NewsletterView.tsx, EditionReader.tsx, SubscriptionManager.tsx, NewsletterSettings.tsx, NewsletterWidget.tsx}
src/components/v2/marketing/{CampaignDetail.tsx, CampaignOverviewTab.tsx, CampaignCalendar.tsx, CampaignKanban.tsx, CampaignAssets.tsx, CampaignMetrics.tsx, RollupCalendar.tsx}
src/components/v2/hermes3d/{HermesOffice.tsx (client, r3f Canvas), HermesAvatar.tsx, useHermesState.ts, Hermes3DSettings.tsx}

public/hermes3d/{office.glb, hermes.glb, draco/*}  -- ≤ 15 MB total
scripts/v2/{smoke-anynotes.mjs, smoke-newsletter.mjs, smoke-marketing.mjs, smoke-hermes3d.mjs}
scripts/v2/hermes3d/{01-extract.ps1, 02-convert.mjs, README.md}
_design/hermes3d/PIPELINE.md
```

Every route file: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";` + `cache-control: no-store` (repo convention). No new proxy.ts exemptions needed — nothing here takes inbound webhooks; the Gmail OAuth callback is a logged-in browser redirect so the password cookie is present.

Sidebar: add `/anynotes`, `/newsletter`, `/hermes-3d` to `NAV` in `src/components/Sidebar.tsx` AND to the correct section Sets (`/anynotes` + `/newsletter` → Workspace; `/hermes-3d` → whichever Set the hermes pages use — check `ORCHESTRATION_ROUTES`/`AGENT_ROUTES` membership or they silently land in "Self"). `/marketing/[slug]` inherits the existing `/marketing` entry.

New dependencies (all pure-JS, no native builds): `@mozilla/readability` + `linkedom` (article extraction, no jsdom weight), `turndown` (HTML→md, same lib upstream gmail uses), `googleapis` + `google-auth-library` (Gmail OAuth), `@react-three/fiber` + `@react-three/drei` (`three` is already installed). Dev-time only (not shipped): FBX2glTF binary under `tools/` (git-ignored).

---

## 4. Port map (AgentOSCore → ours)

| Reference (AgentOSCore) | Our file | Strategy |
|---|---|---|
| `integrations/gmail/src/schedule.ts` | `src/lib/v2/newsletter/gmail.ts` | **verbatim-adapt**: keep default 24h lookback, `after:<unixts>` query, skip ≤ lastSyncTime, watermark = latestEmailTime + 20s, watermark only advanced when messages processed. Query changes to `to:(*@<addy-domain>) OR label:newsletters after:<ts>`; Turndown config (strip style/script/iframe) copied as-is |
| `integrations/gmail/src/account-create.ts` + OAuth flow (`services/oauth/oauth.server.ts`) | `src/app/api/newsletter/gmail/auth|callback` | **pattern-only**: we need one fixed Google account, not the generic template engine. Installed-app OAuth via `google-auth-library` `OAuth2Client` (offline access, prompt=consent); state nonce persisted in `newsletter_state` (upstream's in-memory state store is a documented restart bug — do not copy) |
| `apps/webapp/app/trigger/utils/message-utils.ts` (`createActivities`) | `src/lib/v2/newsletter/store.ts` + events | **pattern-only**: activity→row→fanout becomes email→row→`events.emit('newsletter.email.ingested')`; Memory V2 ingest with sourceURL replaces webhook fanout |
| `apps/webapp/app/services/widgets/registry.server.ts` + `components.client.ts` | H2's registry (we add entries) | **pattern-only**: `newsletter-latest` and `anynotes-recent` widgets registered per H2's in-repo catalog contract |
| `apps/webapp/app/utils/schedule-utils.ts` (`computeNextRun`) | F2 scheduler (already ported there) | **skip here** — consume via `scheduler.register()` |
| `apps/webapp/app/services/skills.defaults.ts` / ingestion rules (`IngestionRule` + NOTHING_TO_REMEMBER) | `src/lib/v2/anynotes/jarvisReply.ts` prompt + newsletter parse prompt | **pattern-only**: user-rule text injected into the LLM normalize/parse prompts; add deterministic pre-filters (aliases match, sender allowlist) since LLM-only enforcement silently fails on weak models (documented gotcha) |
| `integrations/notion/src/mcp/index.ts` (error-swallowing MCP result shape) | n/a in this spec | **skip** (D/G workstreams). But adopt its error split: external-API errors soft (`parse_status='failed'` + parse_error), config/provider errors loud (throw → 500) |
| `apps/webapp/app/components/overview/` grid | H1/H2 | **skip** — we only ship widget components |
| Marketing: no upstream equivalent | `src/lib/marketing.ts` (existing, extended) | **greenfield extension** of our own P1 engine |
| Hermes 3D: no upstream equivalent | `src/components/v2/hermes3d/*` | **greenfield** (three/r3f); Synty FBX source pack is the asset input |

---

## 5. API contracts

Types below live in `src/lib/v2/anynotes/store.ts`, `src/lib/v2/newsletter/store.ts`, `src/lib/marketing.ts` (client-safe shapes re-exported from a types-only module if imported by components — follow the `agentsTypes.ts` no-node-imports convention: add `src/lib/v2/anynotes/types.ts`, `src/lib/v2/newsletter/types.ts`).

### AnyNotes

```
GET  /api/anynotes?status=inbox|kept|archived|all&type=&label=&q=&limit=60&before=<iso>
  → { notes: Note[] }            // Note = row shape, labels parsed to string[]
POST /api/anynotes
  body: { url?: string; text?: string; imageBase64?: string; imageName?: string; title?: string; labels?: string[] }
       // exactly one of url | text | imageBase64
  → 200 { note: Note }  | 400 { error } | 422 { error: "extraction failed: <why>", note?: Note }
       // 422 still saves a degraded link-only note (fallback capture) — the error tells the user extraction failed loudly
GET  /api/anynotes/:id            → { note, replies: Reply[] }
PATCH /api/anynotes/:id           body: { status?, labels?, title? } → { note }
DELETE /api/anynotes/:id          → exiles to anynotes_exile → { ok: true }
POST /api/anynotes/:id/replies    body: { body: string } → { reply: Reply, jarvisQueued: boolean }
       // jarvisQueued=true when body matches /@jarvis\b/i — a jarvis Reply row with pending=1 is inserted
       // and generation kicked off fire-and-forget; client polls the thread
GET  /api/anynotes/media/:file    → image bytes (filename regex-guarded ^[a-z0-9_-]+\.(png|jpg|webp)$, resolved+prefix-checked)
```

Events emitted (F2 bus): `anynote.captured {id,type,title}`, `anynote.reply.jarvis {noteId,replyId}` (H4 attention feed consumes the latter). Degraded path without F2: skip emits (store still authoritative).

### Newsletter

```
GET  /api/newsletter/subscriptions → { subscriptions: Subscription[], addyConfigured: boolean, gmailConnected: boolean }
POST /api/newsletter/subscriptions body: { name, topic?, signupUrl?, cadence? }
  → creates addy alias (description = "agentos-newsletter: <name>"), persists row
  → { subscription } | 502 { error: "addy.io: <status> <body-snippet>" }   // loud
PATCH /api/newsletter/subscriptions/:id  body: { name?, topic?, cadence?, status? } → { subscription }
       // status='paused' also deactivates the addy alias (PATCH /aliases/:id active=false)
POST /api/newsletter/sync         → runs one incremental sync now
  → { fetched: n, parsed: n, failed: n, newStories: n, merged: n, watermark: iso }
GET  /api/newsletter/sync         → { lastSyncTime, lastRun?: {…counts}, running: boolean }
GET  /api/newsletter/edition?date=YYYY-MM-DD  (default: latest)
  → { edition: EditionDoc | null, dates: string[] }   // dates = archive index
POST /api/newsletter/edition      body: { date? } → force (re)build → { edition }
GET  /api/newsletter/gmail/auth   → { authUrl }        // open in new tab
GET  /api/newsletter/gmail/callback?code=&state=       → 302 to /newsletter?gmail=connected (or ?gmail=error)
```

```ts
interface EditionDoc {
  date: string;                    // YYYY-MM-DD
  builtAt: string;
  sections: Array<{
    topic: string;                 // from settings.newsletter.sections
    stories: Array<{
      id: string; title: string; url?: string; summary: string;
      sources: Array<{ name: string; url?: string }>;   // the dedupe payoff: chips
    }>;
  }>;
  stats: { emails: number; stories: number; duplicatesMerged: number };
}
```

Scheduler registrations (`src/lib/v2/newsletter/jobs.ts`, called from the F2 boot path in `src/instrumentation.ts`):
- `newsletter.sync` — RRULE from `settings.newsletter.syncRrule` (default `FREQ=MINUTELY;INTERVAL=30`); no-ops loudly-logged when gmail not connected.
- `newsletter.edition` — daily at `settings.newsletter.editionTime` (default `06:30` local). Idempotent: skips if `newsletter_editions[today]` exists unless `force`.
Events: `newsletter.email.ingested`, `newsletter.edition.built {date, stories}` (H3 widget refresh trigger).

### Marketing (additive to existing routes)

Existing (unchanged): `/api/marketing/campaigns` (list/create/exile), `/api/marketing/plan`, `/api/marketing/item` (draft/status), `/api/marketing/personas`, `/api/marketing/ideate`, `/api/marketing/queue`.

```
GET  /api/marketing/campaigns/:slug            → { campaign }         // add GET-by-slug if not present
GET  /api/marketing/campaigns/:slug/assets     → { assets: Asset[] }
POST /api/marketing/campaigns/:slug/assets     multipart form (file) or { name, base64 }
  → { asset } ; files under ~/.agentic-os/marketing/assets/<slug>/<safe-name>; 25 MB/file cap
DELETE /api/marketing/campaigns/:slug/assets?name=  → exiles to marketing/.exile/<stamp>/assets/<slug>/ → { ok }
GET  /api/marketing/campaigns/:slug/metrics    → { computed: {byStatus: Record<ItemStatus,number>, byChannel:…, published: n}, entries: MetricEntry[] }
POST /api/marketing/campaigns/:slug/metrics    body: { date, platform, metric, value: number, note? } → { entries }
GET  /api/marketing/rollup?from=&to=           → { days: Record<'YYYY-MM-DD', Array<{slug,campaign,color,itemId,title,channel,status}>>, campaigns: Array<{slug,title,color,status}> }
```

```ts
// Campaign type extensions (src/lib/marketing.ts — additive, old JSON files stay valid)
interface Campaign { /* …existing… */ assets?: Asset[]; metricsEntries?: MetricEntry[]; color?: string; }
interface Asset { name: string; size: number; mime: string; added: string; }             // file lives on disk; JSON is the index
interface MetricEntry { date: string; platform: string; metric: string; value: number; note?: string; added: string; }
```

**J4 humanizer gate** (`src/lib/v2/marketing/humanize.ts`): `scrub(text) → {text, hits}` replaces `—`/`–` with `, `/`-` contextually; `verify(text) → string[]` returns remaining violations (em/en dashes + persona banned phrases). Wire into `setItemStatus("approve")`: run `verify(item.draft)`; violations → `throw Error("Humanizer gate: …")` with the list; `draftItem()` runs `scrub` on every draft before save and records `meta.humanized=true`. The humanizer *skill* pass stays a prompt-side instruction (already in persona banned lists); this gate is the deterministic backstop the memory rule demands.

Mini-Kanban column mapping (no new statuses — reuse `ItemStatus`): `idea`→Idea, `drafted`→Drafting/Approval (single "Awaiting approval" column, since drafted IS the approval queue state), `approved`→Approved, `scheduled`→Scheduled, `published`→Posted. Drag between columns calls the existing `/api/marketing/item` actions (`approve`, `unapprove`, `schedule`, `published`); illegal moves (idea→published) are rejected by the existing server guards and the card snaps back with the server's error toast.

### Hermes 3D

```
GET /api/hermes3d/state → { state: 'idle'|'thinking'|'talking'|'offline', since: iso, detail?: string }
```

`src/lib/v2/hermes3d/state.ts` keeps a `globalThis.__agentosHermes3d` record `{state, since, detail}`. Producers: wrap the existing `/api/hermes/chat` handler — on request start `setState('thinking', promptSnippet)`, on stream/response completion `setState('talking')` then `setState('idle')` after `settings.hermes3d.talkingHoldMs` (default 4000); TTS route may extend the talking hold. Each transition emits `hermes.state` on the F2 bus. Client `useHermesState.ts`: subscribe to the F2 SSE stream (`/api/v2/events/stream?types=hermes.state` — F2 contract) with `usePollWhileVisible(GET /api/hermes3d/state, 5000)` fallback when SSE is unavailable.

---

## 6. UI

Style: existing muted-neobrutalist dashboard — CSS vars (`--fg`, `--panel-border`), per-module accent hex, framer-motion, lucide icons. Every page ships a `<ConfigMenu>` gear (rule 16) whose fields PATCH `settings.<module>` via `useSettings()`. All polling through `usePollWhileVisible`.

### `/anynotes` (accent suggestion: `#e8a33d` amber)

```
AnyNotesView
├─ header: title + count chips (Inbox n / Kept n / Archived n) + ConfigMenu(AnyNotesSettings)
├─ CaptureBox — URL input + "Capture" btn; drag/drop + paste targets for images; expandable plain-text note area;
│               "bookmarklet" link opens a modal with the copyable Opera bookmarklet snippet
│               (javascript: window.open('<origin>/anynotes?capture='+encodeURIComponent(location.href)) — page auto-captures the param)
├─ filter row: status tabs · type pills (tweet/article/video/screenshot/text) · label select · search box
├─ masonry grid (CSS columns, 1-4 responsive): NoteCard = thumb/media, type icon, title, site+author, captured-at,
│               label chips, reply-count badge, hover actions (keep/archive/open)
└─ NoteDetail (right slide-over, same shell as ConfigMenu): full snapshot render (markdown), source link,
                labels editor, status buttons, ReplyThread (chronological bubbles; jarvis replies styled with
                the Jarvis accent; pending=1 renders a "Jarvis is thinking…" shimmer; error renders red inline),
                reply composer with an "@jarvis" quick-chip
```

Settings (settings.anynotes): `autoIngest` (default on), `jarvisAgent` (AgentPicker, default claude), `defaultStatus` (inbox), `maxSnapshotChars` (24000).

### `/newsletter` (accent suggestion: `#4d9de0` news-blue)

```
NewsletterView — tabs: Today's Edition · Archive · Subscriptions  (+ ConfigMenu(NewsletterSettings))
├─ EditionReader: masthead ("The Agent OS Daily — {date}", built-at, stats line), sections as newspaper columns
│   (2-col ≥ lg), story = headline(link) + summary + source chips ("TLDR", "Ben's Bites" …, chip = link to that
│   source's own url); duplicatesMerged surfaced in the stats line — honest numbers only
├─ Archive: date list (from GET edition.dates) → click loads that edition into the reader
├─ SubscriptionManager: table (name, alias with copy-btn, topic, cadence, status toggle, last-seen email date
│   derived from newsletter_emails — shown as "—" when none, never faked);
│   "+ Subscribe" flow: form (name, topic, signup URL) → POST creates alias → success panel shows the alias,
│   copies it to clipboard, and "Open signup ↗" button opens signupUrl in a new tab
└─ status strip: gmailConnected ? "Gmail ✓ (agent account)" : "Connect Gmail →" (starts OAuth);
                 addyConfigured ? "addy.io configured ✓" : "Key missing at ~/.agentic-os/newsletter/config.json"
                 (the key VALUE is never rendered anywhere)
```

Settings (settings.newsletter): `syncRrule`, `editionTime`, `sections` (string[], default ["AI & Agents","Dev & Tools","Business","Security","Everything Else"]), `dedupeThreshold` (0.86), `parseAgent` (AgentPicker), `lookbackDays` for first sync (default 1), `addyDomain` (display-only helper for the query filter).

`NewsletterWidget.tsx`: compact latest-edition card (top 5 headlines + source-chip counts) registered in the H2 widget registry as `newsletter-latest` (config schema: `{sections?: string[], maxStories?: number}`). `anynotes-recent` widget ditto (recent notes + unanswered-jarvis count).

### `/marketing/[slug]` (inherits marketing accent)

```
CampaignDetail — header: title, business badge, status, campaign color dot, back-to-hub; tab bar:
├─ Overview: goal, angle, channels, council plan (markdown), item-status summary bar, quick actions (Plan/Re-plan)
├─ Calendar: month grid (extract the hub's month grid into a shared component), items on their scheduledFor day,
│            campaign-scoped; click item → item drawer (existing draft/approve UI reused from MarketingHub)
├─ Kanban: CampaignKanban — 5 columns (Idea / Awaiting approval / Approved / Scheduled / Posted),
│          HTML5 drag-drop (greenfield per recon: pattern from Sidebar's draggable/onDragEnter/onDrop),
│          card = title, channel icon, platform, date; drop → fetch action → optimistic move → snap-back on error
├─ Assets: upload dropzone + grid of files (thumb for images, icon otherwise), copy-path btn, exile btn
└─ Metrics: computed block (post counts by status/channel — from items, always real) + manual-entry table
            (date/platform/metric/value/note, "+ add entry"), empty-state text: "No platform APIs wired — enter
            numbers manually. Nothing here is estimated."
Hub changes (MarketingHub.tsx): campaign cards link to /marketing/<slug>; hub Calendar tab now renders
RollupCalendar (all campaigns merged, item pill tinted with campaign color, legend of campaigns, click-through).
```

Campaign color: deterministic `color = PALETTE[hash(slug) % 8]` stored on the campaign on first read (editable in the campaign's gear later). Settings additions (settings.marketing): `rollupDefaultRange` (30d), existing agent/critic/council knobs remain.

### `/hermes-3d` (accent: Hermes module's existing accent)

```
page.tsx (server) → dynamic import of HermesOffice with ssr:false (three cannot SSR)
HermesOffice (client)
├─ <Canvas> — office.glb (static), hermes.glb avatar at the desk; DRACOLoader wired to /hermes3d/draco/
│   camera: fixed 3/4 isometric-ish with gentle idle drift; OrbitControls enabled but damped + zoom-clamped
│   lighting: one ambient + one directional, no shadows by default (settings toggle), background = CSS var panel color
├─ HermesAvatar: AnimationMixer, clips Idle/Thinking/Talking; crossfade 0.4s on state change from useHermesState;
│   'offline' → desaturated material + slumped idle; floating status chip above the desk (state + detail snippet)
├─ click avatar → opens a chat dock (right panel) posting to the existing /api/hermes/chat, whose activity
│   round-trips into the very state driving the animation (the demo loop)
└─ HUD: fps meter (drei <Stats> behind settings.hermes3d.showFps), state legend, ConfigMenu(Hermes3DSettings)
```

Settings (settings.hermes3d): `showFps` (off), `shadows` (off), `talkingHoldMs` (4000), `quality` (`full` | `lite` — lite skips env lighting + halves pixelRatio).

---

## 7. Granular task list

Dependencies: F1/F2 contracts where noted; otherwise tasks are independent. Each ≤ ~half a day. "Verify" = concrete check an implementing agent runs; `tsc --noEmit` clean is implied for every task.

### I — AnyNotes

- **I1.1 — Migration + store.** Add the `anynotes` migration to `src/lib/v2/db.ts`; write `src/lib/v2/anynotes/store.ts` (createNote, listNotes(filter), getNote, patchNote, exileNote, addReply, listReplies, setReplyResult) + `types.ts` (client-safe). Depends: F1 merged (if not: temporary local `openDb()` using the same better-sqlite3 handle pattern, swapped later).
  *Verify:* `node -e` script inserts/lists/patches/exiles a note; `anynotes_exile` row exists after exile.
- **I1.2 — Capture engine.** `src/lib/v2/anynotes/capture.ts`: `classifyUrl(url)` (x.com/twitter.com→tweet, youtube.com/youtu.be→video, else article); `captureTweet` via `https://publish.twitter.com/oembed?url=&omit_script=true` (extract author_name, html→text); `captureVideo` via `https://www.youtube.com/oembed?url=&format=json` (title, author, thumbnail_url); `captureArticle` via fetch (10s timeout, UA string) → `linkedom` parse → `@mozilla/readability` → `turndown` (strip style/script/iframe, upstream config) → cap at `maxSnapshotChars`; og:image/og:title fallback scrape. ALL failures degrade to a link-only note with `meta.captureMode='fallback'` and the 422 contract. `saveScreenshot(base64)` → `~/.agentic-os/anynotes/media/<id>.png`. Deps: adds `@mozilla/readability linkedom turndown`.
  *Verify:* unit-run against a local fixture HTML file (`file://` branch or direct function call with fixture string) — readability path returns title + md; oEmbed calls mocked-off with `ANYNOTES_OFFLINE=1` env respected.
- **I2.1 — Capture + list + detail routes.** `/api/anynotes` (GET/POST), `/api/anynotes/[id]` (GET/PATCH/DELETE→exile), `/api/anynotes/media/[file]` (regex + resolve-prefix guard, per kanbanWorkspace pattern). Emit `anynote.captured` when F2 present (dynamic import, try/catch).
  *Verify:* `curl` POST a URL + an imageBase64 + a text note → three rows with correct types; media route serves the png; traversal attempt (`..%2f`) → 400.
- **I2.2 — Memory ingestion (I4).** On successful capture and on each completed jarvis exchange, call Memory V2 `ingestEpisode({body: title+content_md, source:'anynotes', sourceURL:url, labels:['anynotes', type]})`; store returned `episode_id`. Gate on `settings.anynotes.autoIngest`. Degraded path pre-A: append the episode JSON to `~/.agentic-os/anynotes/pending-ingest.jsonl` and log loudly (A9-style importer drains it later).
  *Verify:* capture with autoIngest on → episode_id set (or pending-ingest line written); off → neither.
- **I3.1 — Jarvis reply worker.** `src/lib/v2/anynotes/jarvisReply.ts`: `generateReply(noteId, replyId)` — prompt = jarvis persona block (from `jarvisPersona.ts` `personaPrompt()`) + note snapshot + thread history + optional memory_search results; routed via `cliComplete(settings.anynotes.jarvisAgent)`; success → update reply row (pending=0, body), emit `anynote.reply.jarvis`; failure → pending=0 + `error` column set (loud in UI, rule 11). Fire-and-forget from the replies POST route (no queue infra needed; single-user).
  *Verify:* POST reply "@jarvis summarize this" on a captured article → within timeout the jarvis row flips pending→0 with non-empty body; kill the agent binary path in config → error column populated, route still 200.
- **I3.2 — Replies route + thread contract.** `/api/anynotes/[id]/replies` GET/POST per §5, `@jarvis` detection, `jarvisQueued` flag.
  *Verify:* POST without @jarvis → no jarvis row; with → pending jarvis row exists immediately.
- **I3.3 — AnyNotesView page.** `src/app/anynotes/page.tsx` + `AnyNotesView.tsx`, `NoteCard.tsx`, `CaptureBox.tsx` (incl. paste/drop image handling via `onPaste` clipboard items + bookmarklet modal + `?capture=` param auto-capture), filters, masonry grid, `usePollWhileVisible` (4s). Sidebar NAV + section-Set entries.
  *Verify:* Playwright/manual: paste a URL → card appears; drop a png → screenshot card; filters narrow; sidebar shows the page under Workspace (not "Self").
- **I3.4 — NoteDetail + thread UI + settings gear.** `NoteDetail.tsx` slide-over with markdown render, labels editor, ReplyThread (pending shimmer, error state), composer with @jarvis chip; `AnyNotesSettings.tsx` in ConfigMenu (autoIngest, jarvisAgent via AgentPicker, defaultStatus, maxSnapshotChars). 
  *Verify:* end-to-end: capture → open detail → @jarvis reply → jarvis answer renders; change jarvisAgent in gear → persisted in settings.json.
- **I4.1 — Widgets + attention.** `anynotes-recent` widget component + H2 registry entry (recent 5 + pending-jarvis count); `anynote.reply.jarvis` documented as an H4 attention source (H4 consumes from the event log — no extra code here beyond the emit). Depends: H2 exists; else ship the component, registry entry commented with TODO tag the H-implementer greps for (`V2-WIDGET-REGISTER`).
  *Verify:* widget renders standalone in the H2 grid (or storybook-style test page if H2 not merged).

### K — Newsletter

- **K1.1 — Config + addy client.** `config.ts` (read/validate `~/.agentic-os/newsletter/config.json`: `{addyio:{baseUrl,apiKey}, google?:{clientId,clientSecret,refreshToken?}}`; export `addyConfigured()`, `gmailConfigured()` — booleans only; NEVER return key material to any route). `addy.ts`: `createAlias(description)` → POST `/aliases` (Bearer), `listAliases()`, `setAliasActive(id,bool)`; non-2xx → throw with status + body snippet (loud).
  *Verify:* `node scripts/v2/smoke-newsletter.mjs --addy-ping` lists aliases against the live key (key already on disk); output shows counts only, never the key.
- **K1.2 — Migration + store.** `newsletter` migration in db.ts; `store.ts` CRUD + `newsletter_state` get/set helpers. Depends: F1 (same fallback as I1.1).
  *Verify:* insert subscription + email + story + source + edition via script; UNIQUE on gmail_id and canonical_url enforced (second insert rejected/ignored).
- **K1.3 — Gmail OAuth pair.** `/api/newsletter/gmail/auth` (build authUrl: scope `gmail.readonly`, access_type=offline, prompt=consent, state nonce → newsletter_state) + `/callback` (state check, code exchange, write refreshToken into config.json google block via `config.ts` writer, 302 back). `gmail.ts` exposes `getGmail()` returning an authorized `gmail_v1.Gmail` (auto-refresh via google-auth-library). Google Cloud prerequisite documented in the route's error message: create OAuth desktop/web client on the agent account, paste clientId/clientSecret into config.json (or via the settings gear which writes them server-side without ever echoing back).
  *Verify:* hit /auth → real Google consent URL; after browser consent, config.json has refreshToken; `getGmail().users.getProfile` returns the agent address.
- **K2.1 — Subscriptions routes + manager UI.** Routes per §5 (POST creates alias via K1.1; PATCH pause toggles alias). `SubscriptionManager.tsx` table + subscribe flow + status strip.
  *Verify:* create a subscription in the UI → addy dashboard shows the alias; pause → alias inactive; alias copy button puts the address on the clipboard.
- **K3.1 — Sync engine.** `gmail.ts` `syncOnce()`: port upstream `schedule.ts` verbatim-adapt — query `after:<watermark ?? now-lookbackDays>` + addressing filter (`to:` any known alias_email OR configured addyDomain), max 100 msgs, fetch full payload, HTML part → turndown md, subscription match by to_addr, insert rows (INSERT OR IGNORE on gmail_id), watermark = latest internalDate + 20s **only if ≥1 processed**. Per-message failures → `parse_status='failed'` + parse_error, never abort the batch; auth/config failures → throw loud.
  *Verify:* send two test mails to an alias, run POST /api/newsletter/sync twice → first run fetched=2, second fetched=0 (watermark held); rows have content_md.
- **K3.2 — Item extraction + dedupe.** `parse.ts` `extractItems(email)`: prompt (provider-routed via `cliComplete(settings.newsletter.parseAgent)`, `extractJsonObj` tolerant parse — reuse the marketing.ts helper by exporting it to `src/lib/v2/json.ts`) → `[{title, url?, summary}]` (cap 15/email). `dedupe.ts`: `canonicalizeUrl` (lowercase host, strip `utm_*|ref|fbclid|mc_cid|mc_eid` params, strip trailing slash/#fragment, unwrap `href=`/`url=` params on known tracker hosts list from settings); `findDuplicate(item)` — (1) exact canonical_url hit, (2) embedding cosine ≥ threshold vs stories with `first_seen ≥ today-3d` (bounded scan; sqlite-vec KNN when available). Embeddings via the Memory V2 embed contract (`embed(texts)` — Ollama local/cloud); if the embedder is down, dedupe degrades to URL-only and the sync result says so (`embedDegraded:true` — honest telemetry).
  *Verify:* smoke script feeds 3 fixture emails where two cover the same story (different utm links, reworded titles) → 1 story row with 2 story_sources; third distinct story separate.
- **K3.3 — Jobs registration.** `jobs.ts` registering `newsletter.sync` + `newsletter.edition` with the F2 scheduler; wired from instrumentation boot path. Degraded pre-F2: a `croner` fallback inside jobs.ts guarded by `globalThis.__agentosNewsletterCron` (pattern from agentsTriggers) with a `V2-SCHED-MIGRATE` comment tag.
  *Verify:* boot log line shows both jobs registered with next-run times; forcing system clock forward is NOT required — call the job fns directly in the smoke script.
- **K4.1 — Edition builder.** `edition.ts` `buildEdition(date)`: stories with `first_seen == date` (plus orphans from the prior day never included in an edition), section classification (single provider-routed call: stories list + settings.sections → JSON map; parse-failure fallback = subscription.topic → section, else "Everything Else" — logged loudly), assemble EditionDoc with real stats, upsert `newsletter_editions`, emit `newsletter.edition.built`. Idempotency guard per §5.
  *Verify:* after K3.2's fixtures, POST /api/newsletter/edition → EditionDoc with the merged story showing 2 source chips; second POST without force → returns existing (same builtAt).
- **K4.2 — Newsletter page.** `NewsletterView.tsx` (tabs), `EditionReader.tsx` (newspaper layout), archive; status strip; Sidebar entries; `usePollWhileVisible` for sync status.
  *Verify:* /newsletter renders the fixture edition; archive date click swaps editions; "Connect Gmail" appears when google block missing.
- **K4.3 — Settings gear + widget.** `NewsletterSettings.tsx` (syncRrule, editionTime, sections list editor, dedupeThreshold, parseAgent, lookbackDays; addy + gmail rendered as configured ✓ / not-configured with path hint — key values never rendered) ; `NewsletterWidget.tsx` + H2 registry entry (`newsletter-latest`).
  *Verify:* change editionTime in gear → settings.json updated → scheduler next-run reflects it after the F2 refresh tick; widget shows today's top stories.

### J — Marketing Hub upgrades

- **J1.1 — Campaign detail route + page shell.** `GET /api/marketing/campaigns/[slug]` (if the existing campaigns route lacks by-slug GET, add the dynamic segment); `src/app/marketing/[slug]/page.tsx` + `CampaignDetail.tsx` with tab bar; hub cards link through. Campaign `color` assigned on first read (PALETTE hash) and persisted.
  *Verify:* create campaign in hub → click card → detail page renders Overview with plan markdown; unknown slug → 404 panel.
- **J1.2 — Extract shared month-grid.** Pull the hub's calendar month grid into `src/components/v2/marketing/CampaignCalendar.tsx` taking `items: {date,title,color,onClick}[]` — used by campaign-scoped tab AND rollup. No behavior change to the hub in this task.
  *Verify:* hub Calendar tab renders identically (visual diff by eye); component takes injected items in the campaign page.
- **J2.1 — Mini-Kanban.** `CampaignKanban.tsx`: 5 columns per §5 mapping, HTML5 DnD (draggable cards, onDragOver/onDrop per column), drop → `/api/marketing/item` action → optimistic update + snap-back on error toast. Column accents follow the existing kanban COLUMNS palette.
  *Verify:* drag drafted→Approved fires approve and the card stays; drag idea→Posted rejected server-side and snaps back with the error message.
- **J2.2 — Assets.** `assets.ts` (safe-name regex `^[\w.-]{1,80}$`, resolve-prefix guard, 25 MB cap, exile-not-delete) + assets route (multipart via `req.formData()`) + `CampaignAssets.tsx` dropzone/grid.
  *Verify:* upload png + pdf → files on disk under assets/<slug>/, listed with sizes; exile moves to marketing/.exile/<stamp>/…; traversal name rejected.
- **J2.3 — Metrics.** `metrics.ts` (computed counts from items — real numbers only; manual MetricEntry append on campaign JSON) + route + `CampaignMetrics.tsx` with the no-fabrication empty state.
  *Verify:* POST an entry → persists in campaign JSON; computed block matches actual item statuses; no metric ever appears that wasn't computed or entered.
- **J3.1 — Rollup.** `rollup.ts` `rollup(from,to)` walking all campaigns → §5 shape; route; `RollupCalendar.tsx` replacing the hub Calendar tab content (legend, per-campaign tint, click-through to /marketing/[slug]?item=).
  *Verify:* two campaigns with items on the same day → both pills on that day in distinct colors; clicking one lands on the right campaign tab.
- **J4.1 — Humanizer gate.** `humanize.ts` scrub/verify per §5; wire `scrub` into `draftItem()` post-draft and `verify` into `setItemStatus("approve")`; also expose violations in the item drawer ("2 banned patterns fixed automatically" honesty line from `meta`).
  *Verify:* seed a draft containing an em dash + "game-changer" for payloadsco → approve throws listing both; after scrub+edit approve succeeds; grep the stored draft for `—|–` → empty.
- **J4.2 — Ideate wiring.** Add optional `campaignSlug` to the ideate backend request; when present, inject campaign goal/plan/persona into the ideate prompt and offer "Add to campaign as idea item" on ideate outputs (creates a ContentItem status `idea`).
  *Verify:* ideate with a campaign selected → generated idea lands in that campaign's Kanban Idea column.

### L — Hermes 3D

- **L1.1 — Extract + inventory.** `scripts/v2/hermes3d/01-extract.ps1`: `Expand-Archive` the SourceFiles zip to `E:/Game Assets/_work/polygon-office/` (never touch the zip in place); print an inventory (FBX files, texture files, sizes). Identify the pieces we need: one assembled office room OR modular walls/floor + desk + chair + shelf props + one character FBX (Synty source packs ship `Characters/` FBX with the standard Synty rig) + the master atlas texture.
  *Verify:* script output lists ≥1 character FBX and the atlas PNG; working dir exists; zip untouched.
- **L1.2 — Converter toolchain.** Download FBX2glTF (facebookincubator release, win64) to `tools/fbx2gltf.exe` (git-ignored, path recorded in `_design/hermes3d/PIPELINE.md`); `scripts/v2/hermes3d/02-convert.mjs` shells it (through `sanitizeSpawnEnv`) with `--draco --binary` per input FBX → `public/hermes3d/`; downscale the atlas to 1024² (fallback chain documented: `magick` if on PATH, else Paint/manual step — atlas is one texture so a manual resize is acceptable); rewrite the GLB's texture to the downscaled one (fbx2gltf embeds — simplest: resize BEFORE conversion in the working dir).
  *Verify:* `node scripts/v2/hermes3d/02-convert.mjs` produces .glb files; each opens in https://gltf-viewer.donmccurdy.com/ (manual spot check) ; per-file sizes printed.
- **L1.3 — Scene assembly + animations (documented manual Blender pass).** `_design/hermes3d/PIPELINE.md` steps: import modular FBX in Blender → assemble one small office (floor, 2-3 walls, desk, chair, shelf, 2-3 props) → export `office.glb` (draco, +Y up); character: import Synty character FBX → retarget three Mixamo clips (Idle, Thinking [e.g. "Standing Idle looking around"], Talking) onto the rig → export `hermes.glb` with the three named NLA actions. Keep the .blend at `_design/hermes3d/office.blend`. This task is a documented human-in-the-loop pass — flag to Yoshi when the Blender step is reached if no Blender automation is available.
  *Verify:* both GLBs load in the r3f scene (L2.2) and `hermes.glb` exposes animation clips named exactly `Idle`, `Thinking`, `Talking` (checked by smoke script parsing the GLB JSON chunk).
- **L2.1 — State plumbing.** `src/lib/v2/hermes3d/state.ts` (globalThis record + `setState` + event emit) ; `GET /api/hermes3d/state` ; instrument `/api/hermes/chat` (and TTS route if trivial) with start/stream/end transitions per §5. Additive wrapping only — no behavior change to hermes chat.
  *Verify:* curl the state route → idle; fire a hermes chat request → state flips thinking→talking→idle over the hold window (poll in a loop).
- **L2.2 — r3f scene.** Add `@react-three/fiber @react-three/drei`; copy three's draco decoder files to `public/hermes3d/draco/`; `HermesOffice.tsx` (Canvas, GLTF loads via drei `useGLTF` + DRACOLoader path, camera + OrbitControls clamps, lights per §6) ; `HermesAvatar.tsx` (useAnimations, crossfade on state) ; `useHermesState.ts` (SSE-first, poll fallback) ; page with `dynamic(() => …, {ssr:false})`. Sidebar entries.
  *Verify:* /hermes-3d renders the office at interactive framerate; DevTools performance shows ~60fps on the dev box; killing the SSE endpoint → poll fallback keeps state updating.
- **L2.3 — Interaction + settings.** Click-avatar chat dock posting to `/api/hermes/chat` (reuse the existing hermes chat fetch contract from HermesTalk/HermesPanel), floating state chip, `Hermes3DSettings.tsx` gear (showFps, shadows, talkingHoldMs, quality lite/full).
  *Verify:* clicking the avatar, sending "hello" → avatar goes thinking→talking while the reply streams into the dock.
- **L3.1 — Budget enforcement + doc.** `scripts/v2/smoke-hermes3d.mjs`: sum `public/hermes3d/**` bytes, fail > 15 MB; validate GLB magic + JSON chunk parses + animation clip names; finalize `_design/hermes3d/PIPELINE.md` (toolchain paths, re-export checklist, budget table per file).
  *Verify:* script exits 0 with a size table; artificially adding a 20 MB file makes it exit 1.

Suggested order inside this spec: I1→I3 (capture infra is shared groundwork), then K (reuses turndown/extraction + json helper), J anytime (independent), L1 early (asset pipeline has the human Blender step — start it in parallel so it's ready when L2 lands).

---

## 8. Risks & Windows-specific notes

- **better-sqlite3 is NOT yet in package.json** (recon-verified; kanbanDb uses node:sqlite). F1 owns the decision/install; every store task here has the "temporary local openDb" fallback but do not fork two DB layers for long — land F1 first if at all possible. If F1 chooses node:sqlite, our DDL is unchanged; only the handle import differs (`process.getBuiltinModule("node:sqlite")` webpack dodge per kanbanWorkspace).
- **sqlite-vec on Windows**: loadable-extension support is the open question (F1). Both dedupe (K3.2) and any note search ship with the brute-force cosine fallback path from day one; candidate sets are bounded (3-day story window) so JS cosine is fine at our volumes.
- **x.com oEmbed**: `publish.twitter.com/oembed` has been intermittently unreliable post-X-migration. The 422-with-degraded-note contract exists precisely for this; do NOT add a headless-browser fallback here (scope creep — Workstream E owns browser automation; leave a `V2-BROWSER-CAPTURE` TODO tag).
- **Google OAuth consent**: the OAuth client on the agent account will be in "Testing" publishing status — refresh tokens for test users expire after 7 days unless the app is set to Production (internal) or the client is a Desktop type with the account added as test user. Mitigation: document choosing "Desktop app" client + publishing status "In production" (no verification needed for gmail.readonly on your own account is NOT true — readonly gmail is a restricted scope; the practical route is Testing mode + re-consent, or an app password + IMAP fallback). **Fallback path speced**: if refresh-token churn becomes annoying, `gmail.ts` gains an IMAP mode (`imapflow` dep) using an app password in config.json — same store/watermark contract, flagged in settings as "IMAP mode". Decide at K1.3 time based on how the consent screen behaves.
- **addy.io key exposure**: the key already sits at `~/.agentic-os/newsletter/config.json`. It must never appear in responses, logs, client bundles, or this repo. `config.ts` is the only reader; routes get booleans. (The key was also pasted into an earlier chat context — worth rotating in the addy dashboard at some point; the config path makes rotation a one-file edit.)
- **Windows paths/spawns**: FBX2glTF shell-outs go through `sanitizeSpawnEnv` + full exe path (no PATH reliance); `Expand-Archive` handles the zip (no tar dependency); watch long paths in the Synty extract (enable `\\?\` prefix not needed if working dir stays shallow: `E:/Game Assets/_work/`).
- **Draco decoder files** must be copied into `public/hermes3d/draco/` (drei's default CDN URL violates the self-contained rule and dies offline); count them inside the 15 MB budget (~700 KB).
- **three SSR**: the r3f page must be `ssr:false` dynamic-imported or Next 16 will try to server-render WebGL and crash the route. Also Next 16 conventions: re-read `node_modules/next/dist/docs/` before writing the multipart assets route and the `[slug]` page (AGENTS.md warning — APIs differ from training data).
- **Marketing JSON concurrency**: campaign JSON read-modify-write from multiple routes (item status + metrics + assets) can race. Single-user risk is low; still, serialize writes through a per-slug in-process mutex in `marketing.ts` (`globalThis.__agentosMktLocks`) as part of J2.2/J2.3.
- **Event-bus coupling**: all `events.emit` calls are wrapped in dynamic-import try/catch so I/K/J/L build and run before F2 merges (degraded: no Homepage feed, pages still fully functional via their own APIs).
- **Fable-safety** (user CLAUDE.md rule 17): keep any AgentOSCore greps targeted during implementation; the digests above already contain the needed file map.

---

## 9. Verification plan (scripts/v2/)

All scripts run with `node scripts/v2/<name>.mjs` against the dev server origin from `AGENTOS_ORIGIN` env (default `http://localhost:3737`), sending the password cookie derived the same way login does (read `AGENTOS_PASSWORD` from `.env.local`). Each exits non-zero on failure and prints a one-line PASS/FAIL table (build-time regression surface, per master plan §0).

1. **smoke-anynotes.mjs** — offline-first: POST text note, POST fixture imageBase64, POST fixture-article capture with `ANYNOTES_OFFLINE=1` (capture.ts short-circuits network, uses `scripts/v2/fixtures/article.html`); assert 3 notes with correct types; PATCH status; POST "@jarvis …" reply → poll thread ≤ 90s for a jarvis body OR an error column (both count as "the loop ran"); exile → row in anynotes_exile. Flags: `--live-url <url>` runs a real capture.
2. **smoke-newsletter.mjs** — `--addy-ping` (list aliases, print count only); fixture mode: injects 3 fixture emails directly via store (two same-story), runs `parse.ts` with a stub extractor (`NEWSLETTER_STUB_PARSE=1` returns deterministic items — keeps the smoke test model-independent), runs dedupe → assert 2 stories, one with 2 sources; `buildEdition(today)` → assert EditionDoc stats {stories:2, duplicatesMerged:1}; rebuild without force → same builtAt. Live mode `--live`: real sync + real LLM parse.
3. **smoke-marketing.mjs** — create campaign via API, seed 2 items by writing the JSON (bypass planner — model-independent), drive item through drafted(with an em dash planted)→approve(expect humanizer throw)→scrubbed edit→approve→schedule→published; POST metric entry; upload + exile an asset; GET rollup → campaign appears with color; assert campaign JSON never lost prior fields (schema-additivity check).
4. **smoke-hermes3d.mjs** — size budget (≤ 15 MB), GLB magic/JSON-chunk validation, animation clip name assertions on hermes.glb, draco decoder files present, GET /api/hermes3d/state returns a valid state enum.

Manual pass per phase-exit (Yoshi): capture a real tweet/article/YT video and recall each via Jarvis (I acceptance); 3+ real newsletters in with one deduped overlap showing 2 chips (K acceptance); move a post idea→posted across both calendars (J acceptance); 60fps + live state flips while chatting (L acceptance).
