// SPEC-C chunk-1 static smoke: C1/C2b UI contract + AHK helper + proxy wiring.
// Pure file/regex checks — no server, no DB.
//   - components exist + 'use client'; layout mounts JarvisOmnipresence
//   - ChatboxOverlay: NO auto-send on recognition result — every sendBuffer()
//     CALL SITE must sit on an Enter-keydown / onClick / autoSend-gated line;
//     the onFinalChunk insert path must not reach it; the capture hook itself
//     performs no network sends
//   - JarvisView retrofit: rec.onresult no longer calls ask() directly; the
//     autoSend gate (settings-read) exists in deliverTranscript
//   - AHK script: WinHttpRequest COM POST (never the Download function), reads
//     the secret file, has the subscribers==0 → open-tab branch, configurable
//     key line + CapsLock example
//   - proxy.ts hotkey exemption present (POST + x-agentos-hotkey-secret)
//   - every /api/* URL fetched by the new components maps to a real route file
// Run: npx tsx scripts/v2/smoke-jarvis-ui.mjs
import path from "node:path";
import fs from "node:fs";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

// ── files exist + 'use client' ──────────────────────────────────────────────
const clientFiles = [
  "src/components/v2/jarvis/JarvisOmnipresence.tsx",
  "src/components/v2/jarvis/ChatboxOverlay.tsx",
  "src/components/v2/jarvis/JarvisSettings.tsx",
  "src/lib/v2/jarvis/useVoiceCapture.ts",
];
for (const f of clientFiles) {
  check(`${f} exists`, exists(f));
  if (exists(f)) check(`${f} is 'use client'`, /^"use client";/.test(read(f)));
}
for (const f of [
  "src/lib/v2/jarvis/hotkeyBus.ts",
  "src/lib/v2/jarvis/hotkeySecret.ts",
  "src/app/api/jarvis/hotkey/route.ts",
  "src/app/api/jarvis/hotkey/stream/route.ts",
  "src/app/api/jarvis/hotkey/setup/route.ts",
  "scripts/v2/jarvis-hotkey.ahk",
]) {
  check(`${f} exists`, exists(f));
}

// ── layout mounts the omnipresence shell ────────────────────────────────────
const layout = read("src/app/layout.tsx");
check("layout.tsx imports JarvisOmnipresence", layout.includes('from "@/components/v2/jarvis/JarvisOmnipresence"'));
check("layout.tsx mounts <JarvisOmnipresence />", layout.includes("<JarvisOmnipresence />"));

// ── ChatboxOverlay: the C2b no-auto-send invariant ──────────────────────────
const overlay = read("src/components/v2/jarvis/ChatboxOverlay.tsx");
{
  const lines = overlay.split(/\r?\n/);
  const callSites = [];
  lines.forEach((line, i) => {
    if (/\bsendBuffer\(\)/.test(line)) callSites.push({ n: i + 1, line: line.trim() });
  });
  check("sendBuffer has call sites", callSites.length >= 3, callSites.length);
  const allowed = (l) => /Enter/.test(l) || /onClick/.test(l) || /autoSend/.test(l);
  const rogue = callSites.filter((c) => !allowed(c.line));
  check(
    "every sendBuffer() call site is Enter-keydown / onClick / autoSend-gated",
    rogue.length === 0,
    rogue,
  );
  // The recognition-result insert path must not dispatch.
  const finalIdx = overlay.indexOf("const onFinalChunk");
  const finalBlock = finalIdx >= 0 ? overlay.slice(finalIdx, overlay.indexOf("useVoiceCapture({", finalIdx)) : "";
  check("onFinalChunk handler exists", finalIdx >= 0);
  check("onFinalChunk NEVER calls sendBuffer (insert-only)", finalBlock !== "" && !finalBlock.includes("sendBuffer"));
  check("Esc discard confirms long drafts (>80 chars)", /DISCARD_CONFIRM_CHARS = 80/.test(overlay) && /window\.confirm/.test(overlay));
  check("autoSend branch is settings-gated (autoSendRef)", /if \(autoSendRef\.current\) sendBuffer\(\)/.test(overlay));
  check("overlay uses the C3 V2 ask lane (POST /api/v2/jarvis/ask)", overlay.includes('fetch("/api/v2/jarvis/ask"'));
  check("overlay ships pageContext from the C5 registry at send time", overlay.includes("getEffectivePageContext()"));
  check("overlay threads the conversationId from the meta event", overlay.includes("conversationIdRef"));
  check("overlay handles navigate events via router.push", overlay.includes('ev.type === "navigate"') && overlay.includes("router.push"));
}

// ── capture hook: capture-only, loud Opera grayout ──────────────────────────
const hook = read("src/lib/v2/jarvis/useVoiceCapture.ts");
check("useVoiceCapture performs NO network sends", !/fetch\(|XMLHttpRequest|EventSource/.test(hook));
// The Voicebox lane transcribes a finished recording through a separate helper;
// that helper may reach ONLY the local transcribe route, never the brain.
const transcribe = read("src/lib/v2/jarvis/transcribeClient.ts");
check("transcribeClient posts only to /api/voicebox/transcribe", (transcribe.match(/fetch\(/g) || []).length === 1 && transcribe.includes("/api/voicebox/transcribe") && !/jarvis\/ask|\/api\/v2\/jarvis/.test(transcribe));
check("useVoiceCapture hands the transcript to the caller, never to the brain", hook.includes("transcribeRecording") && !/jarvis\/ask/.test(hook));
check("useVoiceCapture never references sendBuffer", !hook.includes("sendBuffer"));
check("Opera SpeechRecognition trap detected with a reason", / OPR\\\//.test(hook) && /Opera ships SpeechRecognition disabled/.test(hook));
check(
  "provider registry has all four ids",
  ["webspeech", "kimi", "openai-realtime", "gemini-live"].every((id) => hook.includes(`"${id}"`)),
);
check("stub providers return a reason (never a silent no-op)", /not wired yet/.test(hook));

// ── JarvisView retrofit: no auto-send-on-release ────────────────────────────
const jv = read("src/components/JarvisView.tsx");
{
  const onresultCallsAsk = /onresult\s*=\s*\(e\)\s*=>\s*\{[^\n]*\bask\(/.test(jv);
  check("JarvisView rec.onresult no longer calls ask() inline", !onresultCallsAsk);
  check("JarvisView routes transcripts through deliverTranscript", (jv.match(/deliverTranscript\(/g) || []).length >= 3);
  check("deliverTranscript gates ask() behind voiceAutoSendRef", /voiceAutoSendRef\.current\)\s*\{\s*setStatus[^\n]*ask\(/.test(jv));
  check("JarvisView reads settings.jarvis.voice.autoSend", jv.includes("jarvis?.voice?.autoSend"));
}

// ── settings defaults (rule 16 + C2b default OFF) ───────────────────────────
const settings = read("src/lib/settings.ts");
check("settings default autoSend: false", /autoSend: false/.test(settings));
check("settings default pushToTalk: true", /pushToTalk: true/.test(settings));
check("settings default hotkey F13 enabled", /hotkey: \{ key: "F13", enabled: true \}/.test(settings));
const jarvisSettingsCmp = read("src/components/v2/jarvis/JarvisSettings.tsx");
check("JarvisSettings gear surfaces provider/autoSend/pushToTalk/hotkey",
  ["provider", "autoSend", "pushToTalk", "hotkey"].every((k) => jarvisSettingsCmp.includes(k)));
check("JarvisSettings links the helper setup route", jarvisSettingsCmp.includes("/api/jarvis/hotkey/setup"));

// ── AHK helper mechanics (CONVENTIONS §10) ──────────────────────────────────
const ahk = read("scripts/v2/jarvis-hotkey.ahk");
{
  check("AHK uses WinHttpRequest COM for the POST", ahk.includes("WinHttp.WinHttpRequest.5.1"));
  const codeLines = ahk.split(/\r?\n/).filter((l) => !l.trim().startsWith(";"));
  check("AHK never uses the Download function (cannot POST)", !codeLines.some((l) => /\bDownload\b/.test(l)));
  check("AHK reads the secret file", ahk.includes("jarvis-hotkey.secret") && ahk.includes("FileRead"));
  check("AHK sends the x-agentos-hotkey-secret header", ahk.includes("x-agentos-hotkey-secret"));
  check("AHK has the subscribers==0 → open-tab branch", /subscribers\s*=\s*0/.test(ahk) && ahk.includes("?jarvis=1"));
  check("AHK fronting is best-effort WinActivate", ahk.includes("WinActivate"));
  check("AHK key is configurable at the top (F13 default + CapsLock example)",
    /JarvisKey := "F13"/.test(ahk) && ahk.includes("CapsLock"));
  check("AHK is v2 + single-instance", ahk.includes("#Requires AutoHotkey v2.0") && ahk.includes("#SingleInstance Force"));
  check("AHK non-204/200 failures TrayTip loudly", ahk.includes("TrayTip"));
}

// ── proxy exemption ─────────────────────────────────────────────────────────
const proxy = read("src/proxy.ts");
check("proxy.ts exempts POST /api/jarvis/hotkey with the secret header",
  proxy.includes('"/api/jarvis/hotkey"') &&
  proxy.includes('request.method === "POST"') &&
  proxy.includes('"x-agentos-hotkey-secret"'));
check("proxy.ts does NOT exempt the SSE stream", !proxy.includes("/api/jarvis/hotkey/stream"));

// ── fetch URLs ↔ real routes ────────────────────────────────────────────────
const apiUrls = new Set();
for (const f of clientFiles) {
  const src = read(f);
  for (const m of src.matchAll(/(?:fetch|EventSource)\(\s*[`"'](\/api\/[^"'`?\s]+)/g)) apiUrls.add(m[1]);
  for (const m of src.matchAll(/href="(\/api\/[^"?\s]+)"/g)) apiUrls.add(m[1]);
}
check("new components reference at least 4 API endpoints", apiUrls.size >= 4, [...apiUrls]);
for (const url of apiUrls) {
  // Template-literal params (`/x/${id}`) map onto Next dynamic segments ([id]).
  const segments = url.split("/").filter(Boolean).map((s) => (s.startsWith("${") ? "[id]" : s));
  const routeFile = path.join("src", "app", ...segments, "route.ts");
  check(`route file exists for ${url}`, exists(routeFile), routeFile);
}

console.log(failures === 0 ? "\nsmoke-jarvis-ui: ALL PASS" : `\nsmoke-jarvis-ui: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
