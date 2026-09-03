// Runtime, user-editable settings for the dashboard's Self modules.
//
// Unlike lib/config.ts (CLI bin paths, read ONCE at server start), these are the
// per-module preferences the user changes from the UI config menus — which CLI agent
// a module uses, SEO target sites, the Video lab endpoint, Suno creds, Open Design
// ports, etc. They live in ~/.agentic-os/settings.json and are read/written at
// REQUEST time, so changing a setting takes effect immediately — no rebuild, no restart.
//
// Nothing here is an API key the project ships with; everything is the user's own
// CLI subscription selection or a local endpoint. The only "keys" are ones the user
// pastes themselves into a config field (e.g. an optional Suno third-party key).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { DEFAULT_HERMES3D } from "./v2/hermes3d/sceneDefaults";
import { defaultLaunchOptions, type LaunchModule, type LaunchOptions } from "./launchOptions";
import path from "node:path";
import os from "node:os";

/**
 * Jarvis's default ElevenLabs reply voice: Alfred "Bettany"sworth.
 *
 * A named default, not a generic one. Overridden per-install by
 * settings.jarvis.voice.ttsVoiceId, which the Jarvis voice picker now writes to
 * (it used to be component state, so every page change reset the voice to
 * Daniel).
 */
export const JARVIS_TTS_VOICE_ID = "I53oUivy0XU4VvbHHiX6";

/**
 * The Oracle's ElevenLabs voice: "Hermes, The Oracle", the owner's own sage
 * voice. Used only when oracle.voice.provider is "elevenlabs", or as the
 * labelled backup voice when Voicebox fails and oracle.voice.fallback allows
 * it. It used to be hardcoded in OracleView.tsx (S8 moved it here).
 */
export const ORACLE_ELEVEN_VOICE_ID = "Bu13R3bywbVy3lQswSJo";

/**
 * The Voicebox profile the Oracle speaks with by default. The owner cloned it
 * on 2026-09-02. A missing profile is an error that names the available ones
 * (lib/voicebox.ts resolveVoiceboxProfile), never a quiet swap to the studio's
 * first profile.
 */
export const ORACLE_VOICEBOX_PROFILE = "The Sage";

export interface SeoSite {
  label: string;
  url: string;        // the live site / repo this SEO content targets
  deployCmd?: string; // optional shell command to publish (run from the site dir)
  dir?: string;       // optional local working dir (site root) for the site
  postsDir?: string;  // optional explicit blog-posts dir (defaults to <dir>/src/blog/posts)
}

export interface Settings {
  // The CLI agent a module reaches for when it just needs "an agent" (id from /api/agents/list).
  defaultAgent: string;

  loop: { builder?: string; judge?: string };

  seo: {
    sites: SeoSite[];
    brand?: string;          // the user's brand/name (replaces the old hardcoded "Julian Goldie")
    author?: string;         // byline used in generated content
    audience?: string;       // who the content targets
    transcriptsDir?: string; // where SEO source transcripts live (defaults under the first site)
    skillPath?: string;      // path to the blog-post skill md (defaults under the first site)
    agent?: string;          // which CLI agent writes the articles (claude/codex/cursor/pi/hermes)
  };

  // Leads: which CLI agent does the reasoning (ICP, company finder, scoring) + which data
  // provider finds the leads. "ai" = the agent guesses companies (legacy). The others search/
  // scrape the web for real matches; keys are pasted here (these services need an API key).
  leads: {
    agent?: string;
    dataProvider?: "ai" | "agent" | "tavily" | "perplexity" | "firecrawl" | "apify";
    tavilyKey?: string;
    perplexityKey?: string;
    firecrawlKey?: string;
    apifyToken?: string;
    apifyActor?: string; // e.g. "apify/google-search-scraper" or a lead-gen actor id
  };

  video: {
    // "eidolon" = the user's local Eidolon LTX/WAN Video Studio (Pinokio). "cli" = a CLI
    // agent driving generation via its Higgsfield skill/MCP.
    backend?: "eidolon" | "cli";
    eidolonUrl?: string; // local endpoint of the Eidolon studio (Pinokio/Gradio)
    comfyUrl?: string;   // optional direct ComfyUI API endpoint
    model?: "ltx" | "wan";
    agent?: string;      // CLI agent id used when backend === "cli"
  };

  music: {
    backend?: "key" | "cookie";
    sunoApiKey?: string; // optional third-party Suno API key (user-pasted)
    sunoCookie?: string; // optional Suno account cookie (self-host suno-api style)
    sunoBaseUrl?: string;
  };

  opendesign: {
    webUrl?: string;     // the iframe UI (default http://127.0.0.1:7456)
    daemonUrl?: string;  // health-check daemon (default http://127.0.0.1:7455)
    launchCmd?: string;  // command to START Open Design (cross-platform; run via the OS shell)
    stopCmd?: string;    // command to STOP it
    installPath?: string; // working dir the launch/stop commands run from
  };

  // Paperclip launcher URL. Empty = auto-detect (http://<dashboard host>:3100). Override to a
  // specific LAN IP, a Tailscale MagicDNS name, or a custom domain.
  paperclip: { url?: string };

  // Per-module default agent overrides for the lighter modules.
  games: { agent?: string };
  thumbnails: { agent?: string; backend?: "cli" | "gpt-image" };
  notebook: { agent?: string; nlmBin?: string; notebookId?: string };
  kanban: { agent?: string; board?: string };

  // Deal Desk (S4). maxAgeDays: listings posted longer ago than this are dropped
  // when a scrape or a feed pull lands (the feed was pulling 3-4 week old jobs);
  // the age shows on every card. Rule 16: edited in the Deal Desk gear.
  deals: { maxAgeDays?: number };

  // Operating skills (~/.agentic-os/skills/<name>/SKILL.md) injected into agent prompts.
  // "global" = every agent call platform-wide; "modules" = extra skills per module key
  // (deals, hire, marketing, …). Toggled from the in-app Config menu (Skills section).
  skills: {
    global?: string[];
    modules?: Record<string, string[]>;
  };

  // Marketing Hub: which CLI agent plans/drafts, whether planning runs the 3-pass
  // council (lead plan → adversarial critic → revision), and which text-post
  // platforms are active. All editable from the Hub's gear (never config-file-only).
  marketing: {
    agent?: string;          // drafting/planning agent (claude/codex/cursor/pi/hermes)
    council?: boolean;       // 3-pass planning council vs single-pass plan
    criticAgent?: string;    // council critic (ideally a different lineage than `agent`)
    textPlatforms?: string[]; // active text-post platforms (linkedin/x/facebook/…)
    // Ideate backend: "local" = the in-hub CLI-agent chat; "buzz" = the riff lives in a
    // Buzz workspace channel (posts as the Agent OS bridge; your Buzz agents reply).
    ideateBackend?: "local" | "buzz";
    buzzChannel?: string;    // Buzz channel name or UUID (default: marketing-ideas)
  };

  // Pipeline: which provider (Ollama / CLI agent / MiniMax) drives the shape → reason → artifact flow.
  pipeline: {
    provider?: "ollama" | "cli" | "minimax";
    model?: string;           // for Ollama: which model to use (auto-detected if blank)
    ollamaUrl?: string;       // for Ollama: where the daemon is (default localhost:11434)
    agent?: string;           // for CLI: which agent (claude/codex/cursor/pi/hermes)
    minimaxKey?: string;      // for MiniMax: the API key
  };

  // ── Model dials for the 2026-07 modules ─────────────────────────────────────
  // User model policy: Kimi K2.6 for chat/agentic seats, K2.7 Code for coding.
  // Empty string = the module's built-in default (blank kimiModel = auto-resolve
  // preferring k2.6; blank claude models = the pinned CLAUDE_MODEL).
  brainstorm: { kimiModel?: string };                       // the council's Kimi seat
  // Jarvis: Kimi brain model + SPEC-C C2/C2b voice-capture + hotkey knobs
  // (all surfaced in the Jarvis gear — rule 16).
  jarvis: {
    kimiModel?: string;                                     // Kimi voice provider's brain
    // SPEC-C C3 brain engine: "sdk" = warm Claude Agent SDK session with tools
    // (memory/hub/registry/navigate); "cli" = answer-only fallback via cliComplete
    // + memory recall, NO tools (clearly meta-tagged in the stream).
    engine?: "sdk" | "cli";
    cliAgent?: string;     // cli-lane agent id (claude/codex/cursor/… per cliComplete matrix)
    voice?: {
      provider?: "webspeech" | "kimi" | "openai-realtime" | "gemini-live" | "voicebox";
      autoSend?: boolean;    // C2b: mic release auto-sends — default FALSE (review-first)
      pushToTalk?: boolean;  // true = hold-to-record; false = click-to-toggle
      // The ELEVENLABS reply voice. Distinct from `provider` above, which picks
      // the live-voice BACKEND. Lives in settings rather than component state
      // because it previously reset to the hardcoded default on every remount.
      ttsVoiceId?: string;
      // Which backend SPEAKS the reply. "voicebox" is the local studio (the
      // voice engine since 2026-09-02); "auto" is the old cascade in
      // /api/hermes/tts. Never silently substituted: a down provider errors.
      ttsProvider?: "voicebox" | "auto" | "local" | "elevenlabs" | "openai";
      // What happens when Voicebox fails. Yoshi's call (2026-09-02): keep
      // ElevenLabs as the backup. It is a CHOSEN fallback, and the TTS response
      // labels it (provider + fellBackFrom + fallbackReason); "none" = report.
      ttsFallback?: "elevenlabs" | "none";
    };
    hotkey?: {
      key?: string;          // in-app fallback keybind (default "F13")
      enabled?: boolean;     // in-app keydown listener on/off
    };
  };
  contentEngine: { kimiModel?: string };                    // the kimi slot in the generation rotation
  // The Oracle's voice (S8; rule 16: every field in the Oracle's own gear).
  // provider picks who speaks; voiceboxProfile is a studio profile id or name;
  // elevenVoiceId is the ElevenLabs voice for provider "elevenlabs" AND for the
  // labelled backup. fallback is the Oracle's OWN choice (rule 20), independent
  // of jarvis.voice.ttsFallback: the TTS route reads it when the request says
  // module: "oracle".
  oracle: {
    voice?: {
      provider?: "voicebox" | "elevenlabs";
      voiceboxProfile?: string;
      elevenVoiceId?: string;
      fallback?: "elevenlabs" | "none";
    };
  };
  // Voicebox, the local AI vocal studio (lib/voicebox.ts). url is asserted
  // loopback in code; profile is an id or a name (blank = first profile);
  // engine blank = the profile's own default; timeoutMs bounds one synthesis
  // (CPU boxes load a model on first use, which can take minutes).
  voicebox: { url?: string; profile?: string; engine?: string; timeoutMs?: number };
  // The corner tray that keeps module runs visible after their page is gone
  // (components/RunsTray.tsx). autoDismissSec 0 = keep finished runs until
  // dismissed by hand. Gear lives in the tray itself.
  runsTray: { enabled?: boolean; autoDismissSec?: number };

  // Pre-launch drawer (S3): the last-used launch options per module, so the
  // drawer opens pre-filled. Shape and validation live in lib/launchOptions.ts;
  // the route honors the body, and the drawer persists here on Launch (rule 16).
  launch: Partial<Record<LaunchModule, LaunchOptions>>;
  // The Agents module's intelligence dial → concrete claude model ids.
  agentsModels: { fast?: string; standard?: string; deep?: string };
  // Hire Engine analysis models: cheap triage sweep + full brief/pitch writer
  // + the Gmail draft clerk (tool-use competent, sonnet-tier by default).
  hire: { triageModel?: string; briefModel?: string; draftModel?: string };
  // Idea Engine: model dials per seat tier + radar/daily config.
  ideaEngine: {
    kimiModel?: string;        // sizing/clustering seat (Ollama Cloud)
    researchModel?: string;    // web research + judge (claude)
    writerModel?: string;      // dossier writer; blank = pinned CLAUDE_MODEL
    redditSubs?: string;       // comma-separated, radar pain mining
    seedTerms?: string;        // comma-separated seeds for trends/autocomplete
    dailyEnabled?: boolean;
    dailyHour?: number;        // local hour 0-23
  };

  // ---- V2 foundations (SPEC-A; ultraplan/CONVENTIONS.md) ----
  memory?: {
    provider?: "ollama-cloud" | "ollama-local" | "cli" | "minimax" | "openai-compat";
    modelLow?: string;
    modelMedium?: string;
    embedProvider?: "ollama-local" | "ollama-cloud";
    embedModel?: string;          // changing after data exists requires scripts/v2/reembed.mjs
    ingestEnabled?: boolean;
    compactionEnabled?: boolean;
    personaAutoUpdate?: boolean;
    tokenBudget?: number;
    labelRouterThreshold?: number;
    // S5 legacy backfill (gear): how many undrived legacy episodes one run
    // takes, and which LOCAL Ollama chat model derives them. Never a hosted model.
    backfillLimit?: number;
    backfillModel?: string;
    // Which server derives them. 'ollama-local' is Ollama on :11434;
    // 'openai-compat' is any OpenAI-wire server (LM Studio, llama.cpp, vLLM) at
    // openaiCompatUrl - the path for models Ollama cannot serve at all, such as
    // Bonsai 27B, which needs a llama.cpp fork. Embeddings stay on Ollama
    // either way (embedProvider above), so a real run needs Ollama up too.
    backfillProvider?: "ollama-local" | "openai-compat";
    // Base URL of the OpenAI-compatible server, /v1 segment included.
    // A key, if the server wants one, comes from OPENAI_COMPAT_API_KEY in the
    // environment and is never stored here.
    openaiCompatUrl?: string;
  };
  capability?: {
    folders?: { path: string; scopes: ("files" | "coding" | "exec")[] }[];
    execAllow?: string[];         // "Bash(<glob>)"; empty = all non-denied (in-app); MCP path is deny-all when empty
    execDeny?: string[];          // additive to built-in deny list
    browserEnabled?: boolean;
  };
  mcp?: { secret?: string };
  scheduler?: { tickSeconds?: number };
  // SPEC-B tasks: the SINGLE timezone source for schedule interpretation
  // (CONVENTIONS §10) + the Ready editing buffer before a run starts.
  tasks?: {
    timezone?: string;         // IANA zone; changing it recalculates active schedules (B4.7)
    editingBufferSec?: number; // Ready buffer before execution starts
    // B2 execution engine (additive):
    planApproval?: "always" | "auto";  // global plan-approval gate
    autoApprove?: { categories?: string[]; maxSteps?: number }; // per-category skip (task metadata.category)
    maxStepsPerRun?: number;   // hard cap on plan steps executed per run (default 12)
    runTimeoutMin?: number;    // wall-clock budget per run + boot stuck-recovery threshold (default 30)
    runMode?: "steps" | "sdk"; // 'sdk' is a NOT_IMPLEMENTED seam for chunk 3+
    emptyTaskGc?: boolean;     // buffer-expiry GC of abandoned Untitled daily tasks (default true)
    // B3 recurring seed tasks: per-seed enable toggle (default false — nothing
    // fires until enabled in the Tasks gear). Keys match seeds.ts settingsKey.
    seeds?: Record<string, { enabled?: boolean }>;
  };
  // SPEC-B B5 scratchpad (/today): @jarvis mention-scan idle debounce.
  scratchpad?: {
    mentionDebounceSec?: number; // default 8
  };
  // SPEC-C D1/D2 WebMCP Engine (gear panel lands with the D3 builder UI).
  webmcp?: {
    sandboxTimeoutMs?: number; // 'js' handler wall-clock cap (default 5000)
    allowJsHandlers?: boolean; // gates creation of 'js' handler tools (default true — single-user box)
    llmGetActions?: boolean;   // D1.5: LLM-filtered getActions (default true; off = keyword scorer)
  };
  // SPEC-D G2 integrations runtime (gear panel lands with the G1 /integrations UI).
  integrations?: {
    callbackOrigin?: string;   // OAuth redirect origin — must match provider app registration
                               // (default http://localhost:3737 — see v2/integrations/constants.ts;
                               //  redirectUri = <origin>/api/v2/integrations/oauth/callback)
    syncEnabled?: boolean;     // master kill switch for SCHEDULED syncs (default true; manual sync always runs)
  };
  // SPEC-D H4 attention aggregator (hero UI lands in Phase 6; store/collectors live).
  attention?: {
    pollMs?: number;           // collector tick cadence (default 60000, min 5000)
    muteKinds?: string[];      // kinds hidden from the attention API/hero (rows still recorded)
  };
  // SPEC-D G5 automations engine (gear panel on /automations).
  automations?: {
    enabled?: boolean;         // kill switch: false = rules never fire (default true; /test dry-runs still work)
  };
  // SPEC-D H2 home widget grid. `cells` unset = the DEFAULT_HOME_CELLS const in
  // src/lib/v2/widgets/types.ts (fallback at read time so default-layout changes
  // reach untouched installs — deliberately NOT copied into DEFAULT_SETTINGS).
  home?: {
    cells?: Array<{
      id: string;
      widgetSlug: string;
      size: "S" | "M" | "L";
      order: number;
      config?: Record<string, unknown>;
    }>;
    showScratchpad?: boolean;  // H1.1 (chunk 2) Overview ScratchpadSlot toggle
  };
  // SPEC-E E1 browser workstream (every field surfaced in the /browser gear — rule 16).
  // NO "opera" browserType option, ever: Opera is Yoshi's daily browser and the agent
  // browser must stay fully isolated from it (E4.1 invariant).
  browser?: {
    wsPort?: number;                    // CDP WS bridge port (E2.2), default 3738
    browserType?: "default" | "chrome" | "brave" | "custom";
    browserExecutable?: string;         // only when browserType === "custom"
    profiles?: string[];
    // Profile name -> principal ref ("user:U1", "agent:43"). A profile with no
    // entry belongs to the USER: the strict default, so an unmapped profile
    // denies agents rather than admitting them. See lib/v2/browser/config.ts.
    profileOwners?: Record<string, string>;                // max 5, /^[a-zA-Z0-9_-]+$/
    sessions?: {
      name: string;                     // /^[a-zA-Z0-9_-]+$/, max 10
      profile: string;
      allowedDomains?: string[];        // E4: empty/absent = unrestricted; else eTLD+1 suffix match on top-level navs
    }[];
    wsBind?: "local" | "lan";           // E2.2 bridge bind (CONVENTIONS §9.2), default local
  };
  // SPEC-E F workstream (Agents page — chunk 2+).
  agentsPage?: {
    heroPollMs?: number;                // default 4000 (SSE preferred; poll fallback)
    defaultHarness?: string;            // harness id preselected in the Forge wizard
  };
  // CONVENTIONS §11 deploy gate. requireTestRun=true → promoting to "deployed"
  // without a successful test run is a HARD 409; false → it succeeds with a
  // WARNING surfaced in the UI. Default true (the shipped chunk-3 guard) —
  // ASK-YOSHI flag: CONVENTIONS §11 suggests warning as the default; flip in
  // the Agents gear.
  agents?: {
    requireTestRun?: boolean;
    /** Per-run ceiling in dollars and tokens. `enabled: false` lifts both, which
     *  is a real setting for a long-horizon run rather than a loophole; a limit
     *  <= 0 leaves that one dimension unbounded. Enforced at the harness loop
     *  boundary so a run that trips it KEEPS its work and says why it stopped.
     *  See lib/v2/agents/spendCap.ts. */
    spendCap?: { enabled?: boolean; maxUsd?: number; maxTokens?: number };
    // A background run has no chat window; when an agent needs a decision only
    // the user can make it emits the ASK-USER marker and the run parks on the
    // approvals queue until you reply.
    askUser?: {
      enabled?: boolean;    // default true — inject the protocol + park on the marker
      heuristic?: boolean;  // default FALSE — also park when a turn merely ENDS in "?"
      timeoutMin?: number;  // default 240 (4h, matching the approval park)
    };
  };
  // SPEC-F I — AnyNotes. Rule 16: every knob here gets an in-app gear
  // (AnyNotesSettings, chunk 2); nothing is config-file-only.
  anynotes?: {
    autoIngest?: boolean;      // I2.2 Memory V2 ingest gate (default true)
    jarvisAgent?: string;      // AgentPicker id routed through cliComplete (rule 11: no silent fallback)
    defaultStatus?: "inbox" | "kept" | "archived"; // status a fresh capture lands in
    maxSnapshotChars?: number; // cap on the stored content_md snapshot
  };
  // SPEC-F K — Newsletter. Rule 16: every knob here gets an in-app gear
  // (NewsletterSettings, chunk 4). NOTHING secret lives here — the addy.io key
  // stays in ~/.agentic-os/newsletter/config.json, read only by
  // src/lib/v2/newsletter/config.ts, which hands out booleans.
  newsletter?: {
    syncEnabled?: boolean;      // master kill switch for SCHEDULED syncs (manual always runs)
    syncRrule?: string;         // K3.3 schedule (default FREQ=MINUTELY;INTERVAL=30)
    editionEnabled?: boolean;   // kill switch for the SCHEDULED daily edition (manual rebuild always runs)
    editionTime?: string;       // HH:MM local — K4.1 daily edition build
    sections?: string[];        // edition section names (K4.1)
    dedupeThreshold?: number;   // K3.2 embedding cosine floor (default 0.86)
    dedupeWindowDays?: number;  // K3.2 bounded candidate scan (default 3)
    trackerHosts?: string[];    // hosts whose links are redirect wrappers to unwrap
    parseAgent?: string;        // AgentPicker id routed through cliComplete (rule 11)
    lookbackDays?: number;      // first-sync window when there is no watermark (default 1)
    addyDomain?: string;        // display/hint only — e.g. "yoshi.addy.io"
    gmailAccountId?: string;    // which SPEC-D gmail integration account to sync (CONVENTIONS §7)
    gmailLabel?: string;        // optional Gmail label filter for unknown-alias mail
  };

  // SPEC-F L — Hermes 3D. Rule 16: every knob gets an in-app gear
  // (Hermes3DSettings). `clips` is the state -> clip POOL map: the scene samples
  // one clip on entry to a state so idle varies instead of looping. Slugs must
  // match clip names baked into public/hermes3d/hermes.glb; the catalog and the
  // defaults live in src/lib/v2/hermes3d/clips.ts. deepMerge replaces arrays
  // wholesale, so an edited pool REPLACES the default rather than appending.
  hermes3d?: {
    showFps?: boolean;
    shadows?: boolean;
    talkingHoldMs?: number;              // how long "talking" holds after a response (default 4000)
    quality?: "full" | "lite";           // lite: no env lighting, half pixelRatio
    seatedCount?: number;                // idle bodies on chairs (default 4); 0 = office alone
    clips?: Record<string, string[]>;    // state -> eligible clip slugs
  };

  [extra: string]: unknown;
}

export const DEFAULT_SETTINGS: Settings = {
  // Pools intentionally omitted here — DEFAULT_CLIP_POOLS in
  // src/lib/v2/hermes3d/clips.ts is the single source of truth, so an untouched
  // install picks up new clips as they are baked instead of freezing the pool
  // into a settings file written months ago.
  hermes3d: { ...DEFAULT_HERMES3D },
  defaultAgent: "claude",
  loop: {},
  seo: { sites: [], brand: "", author: "", audience: "", agent: "claude" },
  leads: { agent: "claude", dataProvider: "ai" },
  video: { backend: "eidolon", eidolonUrl: "", comfyUrl: "http://127.0.0.1:8188", model: "ltx", agent: "claude" },
  music: { backend: "key", sunoApiKey: "", sunoCookie: "", sunoBaseUrl: "" },
  opendesign: { webUrl: "http://127.0.0.1:7456", daemonUrl: "http://127.0.0.1:7455", launchCmd: "", stopCmd: "", installPath: "" },
  paperclip: { url: "" },
  games: { agent: "claude" },
  thumbnails: { agent: "claude", backend: "cli" },
  notebook: { agent: "claude", nlmBin: "", notebookId: "" },
  kanban: { agent: "claude", board: "" },
  pipeline: { provider: "ollama", model: "", ollamaUrl: "", agent: "claude", minimaxKey: "" },
  deals: { maxAgeDays: 5 },
  skills: {
    global: ["better-agent"],
    modules: {
      deals: ["launchworks-agent-os"],
      hire: ["launchworks-agent-os"],
      marketing: ["ecommerce-growth-agent", "strategic-narrative-positioning"],
    },
  },
  marketing: { agent: "claude", council: true, criticAgent: "codex", textPlatforms: ["linkedin", "x", "facebook"], ideateBackend: "local", buzzChannel: "marketing-ideas" },
  brainstorm: { kimiModel: "kimi-k2.6" },
  jarvis: {
    kimiModel: "kimi-k2.6",
    engine: "sdk",
    cliAgent: "claude",
    voice: { provider: "webspeech", autoSend: false, pushToTalk: true, ttsVoiceId: JARVIS_TTS_VOICE_ID, ttsProvider: "voicebox", ttsFallback: "elevenlabs" },
    hotkey: { key: "F13", enabled: true },
  },
  contentEngine: { kimiModel: "kimi-k2.6" },
  oracle: { voice: { provider: "voicebox", voiceboxProfile: ORACLE_VOICEBOX_PROFILE, elevenVoiceId: ORACLE_ELEVEN_VOICE_ID, fallback: "elevenlabs" } },
  voicebox: { url: "http://127.0.0.1:17493", profile: "", engine: "", timeoutMs: 120_000 },
  runsTray: { enabled: true, autoDismissSec: 45 },
  launch: { "content-engine": defaultLaunchOptions("content-engine"), "agent-kanban": defaultLaunchOptions("agent-kanban") },
  agentsModels: { fast: "claude-haiku-4-5", standard: "claude-sonnet-5", deep: "" },
  hire: { triageModel: "claude-haiku-4-5", briefModel: "", draftModel: "claude-sonnet-5" },
  ideaEngine: {
    kimiModel: "kimi-k2.6",
    researchModel: "claude-sonnet-5",
    writerModel: "",
    redditSubs: "smallbusiness,Entrepreneur,SaaS,sweatystartup,agency",
    seedTerms: "ai automation,revops,local service software",
    dailyEnabled: false,
    dailyHour: 7,
  },
  memory: {
    provider: "ollama-cloud",
    modelLow: "kimi-k2.6:cloud",
    modelMedium: "glm-5.2:cloud",
    embedProvider: "ollama-local",
    embedModel: "nomic-embed-text",
    ingestEnabled: true,
    compactionEnabled: true,
    personaAutoUpdate: true,
    tokenBudget: 10000,
    labelRouterThreshold: 0.7,
    backfillLimit: 20,
    backfillModel: "bonsai:27b",
    backfillProvider: "ollama-local",
    openaiCompatUrl: "http://127.0.0.1:1234/v1",
  },
  capability: { folders: [], execAllow: [], execDeny: [], browserEnabled: false },
  mcp: {},
  scheduler: { tickSeconds: 30 },
  tasks: {
    timezone: "America/Chicago",
    editingBufferSec: 120,
    planApproval: "always",
    // Seed categories opted into unattended runs by default — the seeds
    // themselves ship disabled, so nothing fires until enabled in the gear.
    autoApprove: { categories: ["brief", "planning"] },
    maxStepsPerRun: 12,
    runTimeoutMin: 30,
    runMode: "steps",
    emptyTaskGc: true,
    seeds: {
      morningBrief: { enabled: false },
      eodWrapup: { enabled: false },
      sundayPlanning: { enabled: false },
      weeklyRetro: { enabled: false },
    },
  },
  scratchpad: { mentionDebounceSec: 8 },
  webmcp: { sandboxTimeoutMs: 5000, allowJsHandlers: true, llmGetActions: true },
  browser: {
    wsPort: 3738,
    browserType: "default",
    profiles: ["personal", "work", "misc"],
    sessions: [],
    wsBind: "local",
  },
  agentsPage: { heroPollMs: 4000 },
  agents: {
    requireTestRun: true,
    spendCap: { enabled: true, maxUsd: 5, maxTokens: 2_000_000 },
    // heuristic defaults OFF: a rhetorical closing question is common in agent
    // reports, and a false positive parks a finished run instead of completing
    // it. The marker is the reliable signal; the heuristic is the opt-in net.
    askUser: { enabled: true, heuristic: false, timeoutMin: 240 },
  },
  anynotes: {
    autoIngest: true,
    jarvisAgent: "claude",
    defaultStatus: "inbox",
    maxSnapshotChars: 24000,
  },
  newsletter: {
    syncEnabled: true,
    syncRrule: "FREQ=MINUTELY;INTERVAL=30",
    editionEnabled: true,
    editionTime: "06:30",
    sections: ["AI & Agents", "Dev & Tools", "Business", "Security", "Everything Else"],
    dedupeThreshold: 0.86,
    dedupeWindowDays: 3,
    parseAgent: "claude",
    lookbackDays: 1,
    addyDomain: "",
    gmailLabel: "",
  },
};

function settingsPath(): string {
  // Test override (smoke scripts must never touch the live settings file —
  // same rule as AGENTIC_OS_DB for agentos.db).
  const override = process.env.AGENTIC_OS_SETTINGS;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "settings.json");
}

// Deep-merge plain objects (arrays + scalars from `patch` win wholesale).
function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (Array.isArray(patch)) return patch as unknown as T;
  if (patch === null || typeof patch !== "object") return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const bv = (base as Record<string, unknown>)?.[k];
    if (v && typeof v === "object" && !Array.isArray(v) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      out[k] = deepMerge(bv, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function readSettings(): Settings {
  try {
    const p = settingsPath();
    if (!existsSync(p)) return structuredCloneSafe(DEFAULT_SETTINGS);
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return deepMerge(structuredCloneSafe(DEFAULT_SETTINGS), raw);
  } catch {
    return structuredCloneSafe(DEFAULT_SETTINGS);
  }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const current = readSettings();
  const next = deepMerge(current, patch);
  const p = settingsPath();
  try {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(next, null, 2), "utf8");
  } catch { /* best-effort; return the merged value regardless */ }
  return next;
}

// structuredClone exists in Node 18+, but guard for older runtimes.
function structuredCloneSafe<T>(v: T): T {
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}
