# Settings sweep audit (S30)

Owner rule, 2026-09-30: "Every parameter needs to be in the settings for every module."
This is the Phase A inventory for `feat-s30-settings-sweep`: every hardcoded model id,
provider choice, fallback, URL/port, timeout, retry count and threshold a user could
reasonably want to change, with where it lives today and where it goes. Line numbers are
from the tree at v2.55.0 (commit adfccd4), read 2026-10-01.

Verdicts:

- **move** = becomes a settings key read per request, editable in that module's gear, with
  the default equal to today's value. Implemented in Phase B (one commit per batch, see the
  Phase B column).
- **leave** = not a real tunable (protocol constant, display label, test seam, an internal
  guard whose only sensible value is the one it has), with the reason.

Already in settings before this slice (not listed again): everything in `DEFAULT_SETTINGS`
(`src/lib/settings.ts`), including Loop (v2.52.0), Idea Engine seats (v2.54.0), Ultracode
(v2.55.0), Memory tiers and backfill, Hire and Agents model dials, Deal Desk screen/dossier
models, Jarvis voice providers, Oracle voice, Voicebox, Parakeet, Pipeline provider/model/
URL, Marketing, Newsletter, Browser, Tasks.

Out of scope (owner): SEO (parked), Nexora, any UI redesign.

## 1. Shared: Ollama Cloud and local Ollama (Phase B batch 1)

One block, `settings.ollama`, edited in the Ollama Cloud page gear and read by every module
below through `src/lib/ollamaCloud.ts`. Settings win; the environment stays the fallback so
an existing `.env.local` keeps working.

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/app/api/ollama/chat/route.ts:14`, `src/app/api/ollama/models/route.ts:12`, `src/app/api/config/route.ts:20`, `src/lib/agentRoom.ts:26`, `src/lib/brainstorm.ts:75`, `src/lib/loopEngine.ts:203`, `src/lib/agentsRuntime.ts:718`, `src/lib/v2/memory/llm.ts:143`, `src/lib/v2/memory/embed.ts:14` | key from `OLLAMA_API_KEY` / `OLLAMA_CLOUD_KEY` env only | move | `ollama.apiKey` (write-only, masked by `settingsRedact.ts`) | `""` (env fallback) |
| `src/app/api/ollama/chat/route.ts:10`, `src/app/api/ollama/models/route.ts:6`, `src/lib/agentRoom.ts:24`, `src/lib/brainstorm.ts:73`, `src/lib/loopEngine.ts:201`, `src/lib/v2/memory/llm.ts:140` (literal `https://ollama.com`), `src/lib/v2/memory/embed.ts:16` (literal) | host from `OLLAMA_CLOUD_HOST` env or the literal | move | `ollama.host` | `""` (env, then `https://ollama.com`) |
| `src/app/api/ollama/chat/route.ts:11` | `OLLAMA_CLOUD_MODEL` env or `qwen3-coder:480b` when the page sends no model | move | `ollama.defaultModel` | `""` (env, then the route's `qwen3-coder:480b`) |
| `src/lib/agentRoom.ts:198` | `OLLAMA_CLOUD_MODEL` env, else the account's first model, for an "auto" room agent when no preference matches | move | `ollama.defaultModel` (same key; blank keeps "first listed model") | `""` |
| `src/lib/agentsRuntime.ts:715`, `src/lib/v2/memory/llm.ts:140`, `src/lib/v2/memory/embed.ts:21` | local daemon URL from `OLLAMA_URL` env or `http://127.0.0.1:11434` | move | `ollama.localUrl` | `""` (env, then `http://127.0.0.1:11434`) |
| `src/app/api/freeclaude/build/route.ts:21` | `OLLAMA_HOST` env or `http://localhost:11434` | move | `ollama.localUrl` (its own literal stays the last resort) | `""` |
| `src/lib/pipeline.ts:168` | `settings.pipeline.ollamaUrl`, then `OLLAMA_HOST`, then `http://localhost:11434` | leave | already a Pipeline gear field | |
| `src/app/api/ollama/models/route.ts:9` `PREFERRED` | the six coder tags listed first in the dropdown | leave | ordering only; every model the account has is listed, the dropdown remembers the choice | |
| `src/app/api/config/route.ts:27` | fleet card for Ollama Cloud shows `qwen3-coder:480b` | move | displays `ollama.defaultModel` (resolved) | |
| `src/lib/agentRoom.ts:159-160` `CODE_PREFS` / `CHAT_PREFS`, `src/lib/loopEngine.ts:216` prefs, `src/lib/brainstorm.ts:111` prefs | model preference regex lists | leave | the owner's model policy (memory `user-model-policy`); the feature contract keeps the auto lists | |

## 2. Claude chat model (Phase B batch 2)

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/lib/config.ts:296-299` `CLAUDE_MODEL` | `AGENTIC_OS_CLAUDE_MODEL` env, else `claudeModel` in `~/.agentic-os/config.json`, else `claude-opus-4-8`, read ONCE at server start | move | `claude.model` via `claudeModel()` in `src/lib/claudeModel.ts`; env and config.json still override (back-compat), picker on the Claude page | `claude-opus-4-8` |
| Every `CLAUDE_MODEL` import: `src/app/api/claude/chat/route.ts`, `api/config`, `api/deals/ask`, `api/deals/proposal`, `api/hire/ask`, `api/seo/generate`, `api/video/auto/script`, `api/video/hyperframes/init`, `src/lib/agentsRuntime.ts:49`, `dealBrief.ts`, `dealDossier.ts`, `dealResearch.ts`, `dealScreen.ts`, `hermesJarvis.ts`, `hireBrief.ts`, `ideaValidation.ts`, `jarvisBrain.ts`, `leadProviders.ts`, `loopEngine.ts`, `newsDigest.ts`, `newsRadar.ts`, `oracle.ts`, `v2/jarvis/brain.ts`, `v2/missions/runtime.ts` | the start-time constant | move | call `claudeModel()` per request | |
| `src/lib/jarvisBrain.ts:61`, `src/lib/v2/jarvis/brain.ts:263` `CLAUDE_MODEL \|\| "claude-sonnet-5"` | dead fallback (the constant is never empty) | move | `claudeModel()`; the dead `"claude-sonnet-5"` goes | |
| `src/app/api/claude/chat/route.ts:70` `"claude-default"` | the scratch project folder name | leave | a folder name, not a model | |

## 3. Agent Room / Mastermind (Phase B batch 3)

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/lib/agentRoom.ts:117-129` `applyOverride()` | per-agent `model` / `provider` / `baseUrl` / `apiKeyEnv` / `noReasoning` from `roomAgents` in `~/.agentic-os/config.json` | move | `room.agents[<id>]` with a Room gear; config.json is read only while `room.agents` is empty, and the code says so | `{}` |
| `src/lib/agentRoom.ts:270` `timeoutMs: 90_000` | CLI reply time limit per room turn | move | `room.cliTimeoutSec` | 90 |
| `src/lib/agentRoom.ts:238` `max_tokens: 1200`, `:253` `num_predict: 400`, `temperature: 0.75` | reply length and temperature | leave | the ROOM_SYSTEM prompt asks for 1 to 3 sentences; these caps exist to stop a reasoning model starving the reply, not to be tuned | |
| `src/lib/agentRoom.ts:82-109` `ROOM_AGENTS` names, colours, personas | the roster | leave | the module's identity; personas are the S25 "each agent is itself" contract. Model/provider per agent is the override above | |
| `src/lib/agentRoom.ts:177` `/api/tags` cache for the process lifetime | | leave | a cache, refreshed on restart | |
| `src/lib/agentRoom.ts:139-141` Hermes profile `.env` lookup for `apiKeyEnv` | | leave | the key NAME is the setting (`apiKeyEnv`); the value stays in the environment or the Hermes profile, never in settings | |

## 4. Brainstorm (Phase B batch 4)

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/lib/brainstorm.ts:73-76` | Ollama Cloud host and key from env | move | shared `ollama.host` / `ollama.apiKey` | |
| `src/lib/brainstorm.ts:171` `timeoutMs ?? 240_000` | CLI seat time limit | move | `brainstorm.seatTimeoutSec` (a launch-drawer timeout still wins per run) | 240 |
| `src/lib/brainstorm.ts:137` `180_000` | Kimi seat time limit | move | `brainstorm.kimiTimeoutSec` | 180 |
| `src/lib/brainstorm.ts:95` `AbortSignal.timeout(15_000)` | `/api/tags` listing guard | leave | a fetch guard on a listing call | |
| `src/lib/brainstorm.ts:135` `num_predict: 1000` | Kimi reply cap | leave | the prompts cap at 350 words; the cap only stops runaway output | |
| `src/lib/brainstorm.ts:82` 10-minute model-list cache | | leave | cache | |
| `src/lib/brainstorm.ts:19` `COUNCIL_SEATS` | the three seats | leave | the module's design (three lineages); the Kimi model is already a gear field | |

## 5. Content Engine

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/lib/contentEngine.ts:28` `GEN_ROTATION` | codex, kimi, claude rotation per item | leave | the multi-model mandate (Claude must not be the only model working); the Kimi model is a gear field, codex/claude run on the CLIs | |
| `src/lib/contentEngine.ts:56` | Kimi model from `settings.contentEngine.kimiModel` | leave | already a setting | |
| `src/lib/contentEngine.ts:66` fallback to Claude | a failed seat falls back to Claude, recorded in `by` | leave | the S3 launch drawer's "No fallback to Claude" guardrail already controls it per run, and the artifact labels who answered (rule 20) | |

## 6. Hire Engine

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/lib/hireBrief.ts:18` `"claude-haiku-4-5"`, `src/lib/hireDraft.ts:21` `"claude-sonnet-5"` | fallbacks when the gear field is blank; equal to `DEFAULT_SETTINGS.hire` | leave | already gear fields; the literal is the same default repeated for a blank field | |
| `src/lib/hireBrief.ts:19`, `src/lib/ideaValidation.ts:62`, `src/lib/dealScreen.ts:32`, `src/lib/dealDossier.ts:24` "blank = pinned CLAUDE_MODEL" | | move | blank now means `claudeModel()` (the Claude page setting) | |
| `src/lib/hireBrief.ts:92`, `src/lib/hireDraft.ts:63`, `src/app/api/hire/ask/route.ts:39` timeouts | per-call wall-clock caps | leave | internal guards; the long routes are wrapped by the runs tray with STOP (S3) | |

## 7. Agents runtime (`/agents`)

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/lib/agentsRuntime.ts:47-49` `modelFor()` fallbacks | `claude-haiku-4-5` / `claude-sonnet-5` / `CLAUDE_MODEL` when a tier is blank | move (deep tier only) | blank Deep = `claudeModel()`; fast/standard literals equal `DEFAULT_SETTINGS.agentsModels` and stay as the blank-field default | |
| `src/lib/agentsRuntime.ts:715-718` Ollama provider base URL + key | `OLLAMA_URL` / `OLLAMA_API_KEY` env | move | shared `ollama.localUrl` / `ollama.apiKey` | |
| `src/lib/agentsRuntime.ts:728` `240_000`, `:765` timeout | per-turn caps | leave | the run itself has `tasks.runTimeoutMin` and the spend cap; a per-turn cap is a guard | |

## 8. Memory (V2)

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/lib/v2/memory/llm.ts:66-67` `kimi-k2.6:cloud` / `glm-5.2:cloud` | blank-field fallbacks equal to `DEFAULT_SETTINGS.memory` | leave | already gear fields | |
| `src/lib/v2/memory/llm.ts:140-144`, `embed.ts:12-21` | cloud host literal, local URL and key from env | move | shared `ollama.host` / `ollama.localUrl` / `ollama.apiKey` | |
| `src/lib/v2/memory/embed.ts:40`, `backfill.ts:274,495`, `dbSchema.ts:233` `nomic-embed-text` | blank-field fallback for the embed model | leave | already a gear field; changing it after data exists needs `reembed.mjs` | |
| `src/app/api/v2/memory/backfill/route.ts:27`, `MemorySettings.tsx:150,178,266` `bonsai:27b` | blank-field fallback | leave | already a gear field | |
| `src/lib/v2/memory/llm.ts:180` `max_tokens` | | leave | protocol cap on structured output | |

## 9. Jarvis (voice lanes) (Phase B batch 4)

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/app/api/hermes/realtime/gemini-session/route.ts:61` | `GEMINI_LIVE_MODEL` env or `gemini-live-2.5-flash-preview` | move | `jarvis.voice.geminiLiveModel` (env stays a fallback) | `gemini-live-2.5-flash-preview` |
| `src/app/api/hermes/realtime/session/route.ts:62,91` | `gpt-realtime` | move | `jarvis.voice.openaiRealtimeModel` | `gpt-realtime` |
| `src/app/api/hermes/realtime/session/route.ts:70` | `gpt-4o-mini-transcribe` | move | `jarvis.voice.openaiTranscribeModel` | `gpt-4o-mini-transcribe` |
| `src/app/api/hermes/tts/route.ts:53` | `gpt-4o-mini-tts` | move | `jarvis.voice.openaiTtsModel` | `gpt-4o-mini-tts` |
| `src/app/api/hermes/realtime/session/route.ts:69` VAD `threshold 0.5`, `prefix_padding_ms 200`, `silence_duration_ms 280` | | leave | tuned by ear for the butler (the comment records why); a protocol detail of one lane | |
| `src/app/api/hermes/realtime/session/route.ts:52`, `tts/route.ts:49` voice name allow-lists | | leave | OpenAI's voice catalogue, validated; the voice itself is chosen per request | |
| `src/lib/jarvisBrain.ts:61`, `src/lib/v2/jarvis/brain.ts:263` | `CLAUDE_MODEL` | move | `claudeModel()` (section 2) | |
| `src/lib/settings.ts` `jarvis.glasses` timeouts, `jarvis.hotkey` | | leave | already settings | |

## 10. Thumbnails (Phase B batch 4)

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/lib/thumbnailPrompt.ts:76` | `gpt-4o-mini` writes the image prompt | move | `thumbnails.promptModel` | `gpt-4o-mini` |
| `src/lib/thumbnailPrompt.ts:70` `45_000`, `:78` `max_tokens: 700`, temperatures | | leave | guards and a prompt-length cap | |
| `src/components/ThumbnailStudio.tsx:66` `gpt-image-2` | the image model for the OpenAI backend | leave | the backend IS the model (the gear's "OpenAI gpt-image-2" option); the key lives in the skill's `.env`, by design | |

## 11. Pipeline

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/lib/pipeline.ts:166-172` provider, model, URL, agent | | leave | already the Pipeline gear | |
| `src/lib/pipeline.ts:222-228` `minimaxModel()` from `~/.fcc/.env` `PM_MODEL`, default `MiniMax-M3` | | leave | the MiniMax coding plan is the Hermes OAuth path; its model is that plan's own file, and the plan is not provisioned here (memory `user-model-policy`) | |
| `src/lib/pipeline.ts:259,301,377` timeouts | | leave | per-step guards; the run has STOP | |

## 12. Loop, Idea Engine, Deal Desk, Ultracode

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/lib/loopEngine.ts:201-204` host and key | env | move | shared `ollama.host` / `ollama.apiKey` | |
| `src/lib/loopEngine.ts:100` builder model | `CLAUDE_MODEL` | move | `claudeModel()` | |
| Loop rounds and time limits | | leave | already settings (v2.52.0) | |
| `src/lib/ideaValidation.ts:61` `claude-sonnet-5`, seats, kimi | | leave | already gear fields | |
| `src/lib/ideaRadar.ts`, `ideaDaily.ts` fetch guards and tick delays | | leave | guards; the daily hour is a setting | |
| `src/lib/dealScreen.ts:27` `MAX_SCREEN = 500` | runaway guard | leave | a board past 500 unjudged rows is a bug, not a preference | |
| `src/lib/ultracodeModels.ts` | the four models | leave | already the Ultracode setting; the same list feeds the Claude picker | |

## 13. Mission Control fleet (`/api/config`)

| Where | Today | Verdict | Settings key | Default |
|---|---|---|---|---|
| `src/app/api/config/route.ts:23` Claude card model | `CLAUDE_MODEL` | move | `claudeModel()` | |
| `src/app/api/config/route.ts:24-30` `gpt-5.5`, `openrouter`, `agy`, `composer`, `glm-5.2:cloud`, `openclaw` | fleet card captions | leave | display taglines for CLIs whose model is picked inside the CLI, not here | |

## 14. Other modules: timeouts, caps and guards (leave)

146 timeout, token-cap and retry literals were swept (`timeoutMs:`, `AbortSignal.timeout`,
`num_predict`, `max_tokens`, `setTimeout` over 4 s). The user-facing time limits are already
settings: Loop (`builderTimeoutSec` / `judgeTimeoutSec`), Tasks (`runTimeoutMin`), Jarvis
glasses (`timeoutSeconds`), Voicebox (`timeoutMs`), the S3 launch drawer's per-run timeout for
Content Engine and Kanban, and (this slice) Room and Brainstorm. The rest are left, by file,
with the reason:

| Files | Reason |
|---|---|
| `api/hermes/dashboard`, `api/opendesign/*`, `api/paperclip/*`, `api/seo/*`, `api/hire/enrich`, `lib/parakeet.ts`, `lib/fcc.ts`, `lib/jarvisBriefing.ts`, `lib/hermesPhone.ts`, `lib/agentsTriggers.ts:62`, `lib/ideaRadar.ts`, `lib/v2/integrations/**` | health probes and listing fetches (2 to 30 s). A longer wait does not make a down service answer; a shorter one makes a healthy one look down. |
| `api/claude/ant`, `api/deals/*`, `api/games/commission`, `api/hermes/*`, `api/marketing/ideate`, `api/openclaw/*`, `api/radar/*`, `api/run`, `api/thumbnails/labs`, `api/v2/agents/draft`, `api/video/labs`, `lib/antAgents.ts`, `lib/deal*.ts`, `lib/hermesJarvis.ts`, `lib/hermesMcp.ts`, `lib/hire*.ts`, `lib/leads.ts`, `lib/leadProviders.ts`, `lib/marketing.ts`, `lib/newsDigest.ts`, `lib/newsRadar.ts`, `lib/oracle.ts`, `lib/ruflo.ts`, `lib/ideaValidation.ts`, `lib/v2/missions/runtime.ts`, `lib/v2/webmcp/actionSelection.ts`, `lib/workflowRun.ts`, `lib/v2/jarvis/brain.ts:156` | one CLI or model call's wall-clock cap (1 to 5 min). The owner stops a run from the tray (S3); the cap only catches a hung child. |
| `lib/upworkDeskStore.ts`, `lib/ideaDaily.ts:100`, `lib/agentsTriggers.ts:249`, `lib/buzzBridge.ts` | poll and retry cadences of background tickers; the user-facing cadence (scheduler tick, attention poll, daily hour) is already a setting. |
| `lib/ultracodeProcs.ts:37`, `lib/videoAuto.ts:19` | kill grace periods. |
| `api/freeclaude/build` `max_tokens` / `num_predict`, `api/hermes/talk` `max_tokens`, `lib/newsDigest.ts:140`, `lib/newsRadar.ts:143` | output caps sized to the prompt's requested length. |
| `src/app/api/freeclaude/build/route.ts:22` `N2_MODEL = "nex-agi/nex-n2-pro:free"` | an OpenRouter model for the N2 engine. OpenRouter is not used anywhere (owner 2026-09-29, memory `agent-os-cli-only-routing`); the engine is dormant and is a retirement, not a setting. |
| `src/lib/v2/dbSchema.ts:233` `DEFAULT_EMBED_MODEL` | the schema's embed dimension anchor; the live value is `memory.embedModel`. |
| `src/app/api/translate/gemini-live/route.ts:18` key file path | a credential location, not a tunable (credentials leave through one door). |

## Phase B batches

1. **Ollama Cloud block** (section 1): `ollama.apiKey` masked, `host`, `defaultModel`,
   `localUrl`; `src/lib/ollamaCloud.ts`; gear on `/ollama`; every reader rewired;
   `smoke-settings-secrets` covers the key.
2. **Claude chat model** (section 2): `claude.model`, `src/lib/claudeModel.ts`, picker on the
   Claude page, every `CLAUDE_MODEL` site rewired (sections 6, 7, 9, 12, 13 rows marked move).
3. **Agent Room** (section 3): `room.agents` + `room.cliTimeoutSec`, Room gear, config.json as
   the labelled fallback.
4. **Brainstorm timeouts, Jarvis voice models, Thumbnails prompt model** (sections 4, 9, 10),
   `ModelSettings` learns nested keys, docs for every new field, `smoke-settings-sweep.mjs`.
