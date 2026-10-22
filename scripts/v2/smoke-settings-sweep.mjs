// S30 settings sweep smoke, offline (owner 2026-09-30: "every parameter needs to be in the
// settings for every module"). For every parameter the sweep moved (_design/settings-sweep-audit.md):
//   A. with an empty settings file, the resolved value equals the OLD hardcoded value
//   B. changing the setting changes what the code uses (read per call, no restart)
//   C. precedence: the Ollama key/host/model from settings beat the environment; the Claude
//      model's env / config.json overrides still win (back-compat, in a child process because
//      config.ts reads them at import); config.json roomAgents is used only while settings has none
//   D. wiring: no reader bypasses the new modules, every gear has its fields, the docs say so,
//      the Ollama key is a secret to settingsRedact
// Nothing leaves the machine; HOME, the config file and every store point at a temp dir (rule 19).
// Run: npx tsx scripts/v2/smoke-settings-sweep.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-settings-sweep-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_CONFIG = path.join(tmp, "config.json");
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
for (const k of ["OLLAMA_API_KEY", "OLLAMA_CLOUD_KEY", "OLLAMA_CLOUD_HOST", "OLLAMA_CLOUD_MODEL", "OLLAMA_URL", "OLLAMA_HOST", "AGENTIC_OS_CLAUDE_MODEL", "GEMINI_LIVE_MODEL"]) delete process.env[k];
// config.json is read ONCE at import (lib/config.ts): give it a legacy roomAgents map so the
// labelled fallback can be seen, and no claudeModel so the setting path is the one under test.
fs.writeFileSync(process.env.AGENTIC_OS_CONFIG, JSON.stringify({ roomAgents: { pi: { model: "legacy-from-config-json" } } }), "utf8");
const write = (obj) => fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify(obj), "utf8");
write({});

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");

const S = await import("../../src/lib/settings.ts");
const OC = await import("../../src/lib/ollamaCloud.ts");
const CM = await import("../../src/lib/claudeModel.ts");
const R = await import("../../src/lib/agentRoom.ts");
const B = await import("../../src/lib/brainstorm.ts");
const JV = await import("../../src/lib/jarvisVoiceModels.ts");
const TP = await import("../../src/lib/thumbnailPrompt.ts");
const red = await import("../../src/lib/settingsRedact.ts");

// ── A. defaults equal the old hardcoded values ────────────────────────────────
check("A1 Claude chat model defaults to claude-opus-4-8 (source: default)", CM.claudeModel() === "claude-opus-4-8" && CM.DEFAULT_CLAUDE_MODEL === "claude-opus-4-8" && S.DEFAULT_SETTINGS.claude.model === "claude-opus-4-8" && CM.claudeModelSource() === "default", [CM.claudeModel(), CM.claudeModelSource()]);
check("A2 Ollama: no key, https://ollama.com, no default model, local 127.0.0.1:11434", OC.ollamaCloudKey() === null && OC.ollamaCloudKeySource() === null && OC.ollamaCloudHost() === "https://ollama.com" && OC.ollamaCloudDefaultModel() === "" && OC.ollamaCloudDefaultModel("qwen3-coder:480b") === "qwen3-coder:480b" && OC.ollamaLocalUrl() === "http://127.0.0.1:11434" && OC.ollamaLocalUrl("http://localhost:11434") === "http://localhost:11434");
const legacy = R.roomOverrides();
check("A3 Room: with no override in settings, config.json roomAgents is the labelled fallback", legacy.source === "config.json" && R.roomAgents().find((a) => a.id === "pi")?.model === "legacy-from-config-json", legacy);
check("A4 Room: every other agent is its shipped self; CLI turn limit 90 s", R.roomAgents().filter((a) => a.id !== "pi").every((a) => JSON.stringify(a) === JSON.stringify(R.ROOM_AGENTS.find((b) => b.id === a.id))) && R.roomCliTimeoutMs() === 90_000 && S.DEFAULT_SETTINGS.room.cliTimeoutSec === 90);
check("A5 Brainstorm seat limits 240 s / 180 s", JSON.stringify(B.brainstormTimeouts()) === JSON.stringify({ seatMs: 240_000, kimiMs: 180_000 }) && S.DEFAULT_SETTINGS.brainstorm.seatTimeoutSec === 240 && S.DEFAULT_SETTINGS.brainstorm.kimiTimeoutSec === 180);
check("A6 Jarvis voice lanes: gemini-live-2.5-flash-preview, gpt-realtime, gpt-4o-mini-transcribe, gpt-4o-mini-tts", JV.geminiLiveModel() === "gemini-live-2.5-flash-preview" && JV.openaiRealtimeModel() === "gpt-realtime" && JV.openaiTranscribeModel() === "gpt-4o-mini-transcribe" && JV.openaiTtsModel() === "gpt-4o-mini-tts");
check("A7 Thumbnails prompt model gpt-4o-mini", TP.thumbnailPromptModel() === "gpt-4o-mini");

// ── B. changing the setting changes what the code uses ───────────────────────
write({
  claude: { model: "claude-sonnet-5-5" },
  ollama: { apiKey: "settings-key-0123456789abcdef", host: "https://ollama.example/", defaultModel: "m-from-settings", localUrl: "http://10.0.0.5:11434/" },
  room: { agents: { codex: { provider: "ollama", model: "glm-5.2:cloud" }, openclaw: { provider: "openai", baseUrl: "https://api.z.ai/api/paas/v4", apiKeyEnv: "GLM_API_KEY", model: "glm-4.6", noReasoning: true }, cursor: {} }, cliTimeoutSec: 30 },
  brainstorm: { seatTimeoutSec: 60, kimiTimeoutSec: 45 },
  jarvis: { voice: { geminiLiveModel: "g-live", openaiRealtimeModel: "rt-x", openaiTranscribeModel: "tr-x", openaiTtsModel: "tts-x" } },
  thumbnails: { promptModel: "gpt-5-mini" },
});
check("B1 Claude model follows the setting (source: settings)", CM.claudeModel() === "claude-sonnet-5-5" && CM.claudeModelSource() === "settings");
check("B2 Ollama key/host/default model/local URL follow the setting (trailing slashes dropped)", OC.ollamaCloudKey() === "settings-key-0123456789abcdef" && OC.ollamaCloudKeySource() === "settings" && OC.ollamaCloudHost() === "https://ollama.example" && OC.ollamaCloudDefaultModel("x") === "m-from-settings" && OC.ollamaLocalUrl() === "http://10.0.0.5:11434");
const ov = R.roomOverrides();
const codex = R.roomAgents().find((a) => a.id === "codex");
const oc = R.roomAgents().find((a) => a.id === "openclaw");
const pi = R.roomAgents().find((a) => a.id === "pi");
check("B3 Room overrides come from settings and config.json is no longer consulted", ov.source === "settings" && Object.keys(ov.agents).sort().join(",") === "codex,openclaw" && codex?.provider === "ollama" && codex?.model === "glm-5.2:cloud" && oc?.provider === "openai" && oc?.baseUrl === "https://api.z.ai/api/paas/v4" && oc?.apiKeyEnv === "GLM_API_KEY" && oc?.model === "glm-4.6" && oc?.noReasoning === true && pi?.model === "", { ov, codex, oc, pi });
check("B4 Room: an empty {} entry is not an override; CLI turn limit follows the setting", R.roomAgents().find((a) => a.id === "cursor")?.provider === "cli" && R.roomCliTimeoutMs() === 30_000);
check("B5 Brainstorm limits follow the setting", JSON.stringify(B.brainstormTimeouts()) === JSON.stringify({ seatMs: 60_000, kimiMs: 45_000 }));
check("B6 Jarvis voice lanes follow the setting", JV.geminiLiveModel() === "g-live" && JV.openaiRealtimeModel() === "rt-x" && JV.openaiTranscribeModel() === "tr-x" && JV.openaiTtsModel() === "tts-x");
check("B7 Thumbnails prompt model follows the setting", TP.thumbnailPromptModel() === "gpt-5-mini");
write({ room: { agents: { codex: null, openclaw: {} } } });
check("B8 Room: a null / empty entry clears the override (back to the shipped agent)", R.roomAgents().find((a) => a.id === "codex")?.provider === "cli" && R.roomAgents().find((a) => a.id === "openclaw")?.provider === "ollama");

// ── C. precedence ────────────────────────────────────────────────────────────
write({});
process.env.OLLAMA_API_KEY = "env-key-0123456789abcdef";
process.env.OLLAMA_CLOUD_HOST = "https://env.example";
process.env.OLLAMA_CLOUD_MODEL = "env-model";
process.env.OLLAMA_URL = "http://env-local:11434";
process.env.GEMINI_LIVE_MODEL = "env-gemini";
check("C1 blank settings fall back to the environment (key, host, model, local URL, Gemini)", OC.ollamaCloudKey() === "env-key-0123456789abcdef" && OC.ollamaCloudKeySource() === "env" && OC.ollamaCloudHost() === "https://env.example" && OC.ollamaCloudDefaultModel() === "env-model" && OC.ollamaLocalUrl() === "http://env-local:11434" && JV.geminiLiveModel() === "env-gemini");
write({ ollama: { apiKey: "settings-key-0123456789abcdef", host: "https://s.example", defaultModel: "s-model", localUrl: "http://s-local:11434" }, jarvis: { voice: { geminiLiveModel: "s-gemini" } } });
check("C2 a saved setting wins over the environment", OC.ollamaCloudKey() === "settings-key-0123456789abcdef" && OC.ollamaCloudHost() === "https://s.example" && OC.ollamaCloudDefaultModel() === "s-model" && OC.ollamaLocalUrl() === "http://s-local:11434" && JV.geminiLiveModel() === "s-gemini");
check("C3 the room's auto-model fallback is the shared default model, blank = the account's first model", read("src/lib/agentRoom.ts").includes("const pick = ollamaCloudDefaultModel() || models[0];"));
for (const k of ["OLLAMA_API_KEY", "OLLAMA_CLOUD_HOST", "OLLAMA_CLOUD_MODEL", "OLLAMA_URL", "GEMINI_LIVE_MODEL"]) delete process.env[k];

// The Claude overrides are read once at import (lib/config.ts), so each case runs in a fresh
// child process with the same temp dirs: settings says sonnet, the override must still win.
write({ claude: { model: "claude-sonnet-5-5" } });
const helper = path.join(tmp, "claude-model-probe.mjs");
fs.writeFileSync(helper, `const m = await import(${JSON.stringify(pathToFileURL(path.resolve("src/lib/claudeModel.ts")).href)});\nconsole.log(JSON.stringify({ model: m.claudeModel(), source: m.claudeModelSource() }));\n`, "utf8");
const probe = (extraEnv) => {
  const env = { ...process.env, ...extraEnv };
  const r = process.platform === "win32"
    ? spawnSync("cmd", ["/c", "npx", "tsx", helper], { env, encoding: "utf8", cwd: process.cwd() })
    : spawnSync("npx", ["tsx", helper], { env, encoding: "utf8", cwd: process.cwd() });
  const line = (r.stdout || "").trim().split(/\r?\n/).pop() || "";
  try { return JSON.parse(line); } catch { return { error: (r.stderr || r.stdout || "").slice(-300) }; }
};
const envCase = probe({ AGENTIC_OS_CLAUDE_MODEL: "claude-env-pin" });
check("C4 AGENTIC_OS_CLAUDE_MODEL still overrides the setting (source: env)", envCase.model === "claude-env-pin" && envCase.source === "env", envCase);
fs.writeFileSync(process.env.AGENTIC_OS_CONFIG, JSON.stringify({ claudeModel: "claude-config-pin" }), "utf8");
const cfgCase = probe({});
check("C5 config.json claudeModel still overrides the setting (source: config.json)", cfgCase.model === "claude-config-pin" && cfgCase.source === "config.json", cfgCase);
fs.writeFileSync(process.env.AGENTIC_OS_CONFIG, "{}", "utf8");
const plainCase = probe({});
check("C6 with neither override, the setting is what runs", plainCase.model === "claude-sonnet-5-5" && plainCase.source === "settings", plainCase);

// ── D. wiring ────────────────────────────────────────────────────────────────
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []);
const srcFiles = walk("src");
const envReaders = srcFiles.filter((f) => !f.endsWith("ollamaCloud.ts") && /process\.env\.OLLAMA_(API_KEY|CLOUD_KEY|CLOUD_HOST|CLOUD_MODEL|URL)\b/.test(read(f)));
check("D1 no reader bypasses lib/ollamaCloud.ts for the Ollama key, host, model or local URL", envReaders.length === 0, envReaders);
const claudeConst = srcFiles.filter((f) => !/[\\/](claudeModel|config)\.ts$/.test(f) && /\bCLAUDE_MODEL\b(?!_OVERRIDE)/.test(read(f)));
check("D2 nothing imports the old CLAUDE_MODEL constant any more", claudeConst.length === 0, claudeConst);
check("D3 the old constant is gone from lib/config.ts (only the labelled override remains)", !/export const CLAUDE_MODEL\b/.test(read("src/lib/config.ts")) && read("src/lib/config.ts").includes("export const CLAUDE_MODEL_OVERRIDE"));
// (a gear placeholder may show the default; the server code may not carry its own copy)
const literalReaders = srcFiles.filter((f) => !f.endsWith("ollamaCloud.ts") && !/[\\/]components[\\/]/.test(f) && /"https:\/\/ollama\.com"/.test(read(f)));
check("D4 no server module keeps its own https://ollama.com literal", literalReaders.length === 0, literalReaders);
const gemini = read("src/app/api/hermes/realtime/gemini-session/route.ts"), session = read("src/app/api/hermes/realtime/session/route.ts"), tts = read("src/app/api/hermes/tts/route.ts"), thumb = read("src/lib/thumbnailPrompt.ts");
check("D5 the voice routes and the thumbnail prompt call the settings readers, no literal model in a request body", gemini.includes("model: geminiLiveModel()") && !gemini.includes("process.env.GEMINI_LIVE_MODEL") && session.includes("model: realtimeModel") && session.includes("transcription: { model: openaiTranscribeModel() }") && !/model: "gpt-/.test(session) && tts.includes("model: openaiTtsModel()") && !/model: "gpt-/.test(tts) && thumb.includes("model: thumbnailPromptModel()") && (thumb.match(/"gpt-4o-mini"/g) || []).length === 1);
check("D6 brainstorm and the room read their time limits per call", read("src/lib/brainstorm.ts").includes("brainstormTimeouts().kimiMs") && read("src/lib/brainstorm.ts").includes("brainstormTimeouts().seatMs") && read("src/lib/agentRoom.ts").includes("timeoutMs: roomCliTimeoutMs()"));
// gears
const ollamaGear = read("src/components/OllamaSettings.tsx");
check("D7 Ollama gear: key (masked-aware), host, default model, local URL; mounted on the Ollama page", ["Ollama Cloud key", "Ollama Cloud host", "Default model", "Local Ollama URL"].every((l) => ollamaGear.includes(`label="${l}"`)) && ollamaGear.includes("isMaskedSecret(apiKey)") && read("src/components/OllamaView.tsx").includes("<OllamaSettings />"));
const claudeGear = read("src/components/ClaudeModelSettings.tsx");
check("D8 Claude gear: the Ultracode model list plus Custom, refuses a non-claude id; mounted on the Claude chat", claudeGear.includes("ULTRACODE_MODELS.map") && claudeGear.includes("Custom") && claudeGear.includes("isUltracodeModel(model)") && claudeGear.includes('fetch("/api/claude/model"') && read("src/components/ClaudePanel.tsx").includes("<ClaudeModelSettings />"));
const roomGear = read("src/components/RoomSettings.tsx");
check("D9 Room gear: time limit + per-agent provider/model/base URL/key env var/no-reasoning; mounted in the Specialists rail", roomGear.includes("CLI reply time limit (seconds)") && ['value="cli"', 'value="ollama"', 'value="openai"'].every((v) => roomGear.includes(v)) && ["Base URL", "API key env var"].every((l) => roomGear.includes(`label="${l}"`)) && roomGear.includes("noReasoning") && read("src/components/MastermindView.tsx").includes("<RoomSettings overrideSource={overrideSource} />"));
check("D10 /api/room/status reports the override source", read("src/app/api/room/status/route.ts").includes("overrideSource"));
const jarvisView = read("src/components/JarvisView.tsx");
check("D11 Jarvis models gear carries the four voice-lane models", ["voice.geminiLiveModel", "voice.openaiRealtimeModel", "voice.openaiTranscribeModel", "voice.openaiTtsModel"].every((k) => jarvisView.includes(`key: "${k}"`)));
check("D12 Brainstorm gear carries both time limits as numbers", /key: "seatTimeoutSec"[^}]*type: "number"/.test(read("src/components/BrainstormView.tsx")) && /key: "kimiTimeoutSec"[^}]*type: "number"/.test(read("src/components/BrainstormView.tsx")));
check("D13 Thumbnails gear carries the prompt model", read("src/components/ThumbnailSettings.tsx").includes("promptModel: promptModel.trim()"));
check("D14 ModelSettings resolves dotted keys and numbers", read("src/components/ModelSettings.tsx").includes("f.key.split(\".\")") && read("src/components/ModelSettings.tsx").includes('f.type === "number"'));
check("D15 the Ollama key is a secret to settingsRedact (masked in every reply)", red.isSecretPath("ollama.apiKey") && red.redactSettings({ ollama: { apiKey: "ollam_0123456789abcdef" } }).ollama.apiKey === "ollam" + red.SECRET_PLACEHOLDER);
// docs
const doc = (f) => read(path.join("docs/modules", f));
check("D16 the docs name every new gear field", doc("ollama.md").includes("Ollama settings") && doc("ollama.md").includes("Local Ollama URL") && doc("claude-cli.md").includes("Claude model") && doc("room.md").includes("Room settings") && doc("room.md").includes("overrideSource") && doc("jarvis.md").includes("Gemini Live model") && doc("brainstorm.md").includes("CLI seat time limit") && doc("thumbnails.md").includes("Prompt model (OpenAI)"));
check("D17 the audit exists with a verdict for every section", fs.existsSync("_design/settings-sweep-audit.md") && (read("_design/settings-sweep-audit.md").match(/^## \d+\./gm) || []).length >= 14);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
