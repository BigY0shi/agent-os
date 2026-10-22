// Parakeet local STT lane, fully offline: lib/parakeet.ts, /api/stt/transcribe,
// /api/stt/health, the capture hook's recorder-lane wiring, defaults, launchers.
//
// Run: npx tsx scripts/v2/smoke-parakeet-stt.mjs
//
// Rule 19: AGENTIC_OS_SETTINGS is redirected BEFORE any import. globalThis.fetch is
// replaced with a fake Parakeet server, so nothing here touches 127.0.0.1:8881.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-parakeet-"));
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");
process.env.AGENTIC_OS_DB = path.join(dir, "test.db");
process.env.USERPROFILE = dir;
process.env.HOME = dir;
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({ memory: { ingestEnabled: false } }), "utf8");
let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !extra ? "" : `  [${extra}]`}`);
  if (!cond) failures++;
};

// ---- fake Parakeet server -----------------------------------------------------
const seen = [];
let scenario = "ok"; // ok | down | error | empty
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  seen.push({ host: u.hostname, path: u.pathname });
  if (scenario === "down") throw new TypeError("fetch failed");
  if (u.pathname === "/health") return Response.json({ ok: true, model: "nemo-parakeet-tdt-0.6b-v2", quantization: "int8", provider: "cpu", loaded: false });
  if (u.pathname === "/transcribe") {
    const fd = init.body;
    const file = fd?.get?.("file");
    if (scenario === "error") return Response.json({ ok: false, error: "ffmpeg could not decode the recording" }, { status: 200 });
    if (!file || !file.size) return Response.json({ ok: false, error: "empty recording" });
    if (scenario === "empty") return Response.json({ ok: true, text: "", duration: 0.1 });
    return Response.json({ ok: true, text: `heard ${file.size} bytes as ${file.name}`, duration: 2.5, seconds: 0.4 });
  }
  return new Response("not found", { status: 404 });
};

const { parakeetBase, parakeetTranscribe, parakeetHealth } = await import("../../src/lib/parakeet.ts");
const { writeSettings, readSettings } = await import("../../src/lib/settings.ts");
const transcribeRoute = await import("../../src/app/api/stt/transcribe/route.ts");
const healthRoute = await import("../../src/app/api/stt/health/route.ts");
const defaults = readSettings(); // before any section writes to the temp settings

// A. loopback assertion
check("default base is loopback 8881", parakeetBase() === "http://127.0.0.1:8881");
writeSettings({ stt: { parakeetUrl: "http://192.168.0.50:8881" } });
let threw = "";
try { parakeetBase(); } catch (e) { threw = String(e.message); }
check("a LAN Parakeet URL is refused before any request", /loopback/.test(threw));
writeSettings({ stt: { parakeetUrl: "http://localhost:8881/" } });
check("localhost is accepted and normalised", parakeetBase() === "http://localhost:8881");
writeSettings({ stt: { parakeetUrl: "" } });

// B. client
const clip = new Blob([new Uint8Array(1200)], { type: "audio/webm" });
const out = await parakeetTranscribe(clip, { filename: "recording.webm" });
check("transcribe posts the clip as `file` and returns text + duration", out.text === "heard 1200 bytes as recording.webm" && out.durationSec === 2.5);
scenario = "empty";
check("silence comes back as empty text, not an error", (await parakeetTranscribe(clip)).text === "");
scenario = "error";
threw = ""; try { await parakeetTranscribe(clip); } catch (e) { threw = String(e.message); }
check("server-side decode failure is surfaced with the server's words", /ffmpeg could not decode/.test(threw));
scenario = "down";
threw = ""; try { await parakeetTranscribe(clip); } catch (e) { threw = String(e.message); }
check("server down names the port and the launcher, no fallback", /8881/.test(threw) && /parakeet-start\.ps1/.test(threw));
scenario = "ok";
threw = ""; try { await parakeetTranscribe(new Blob([])); } catch (e) { threw = String(e.message); }
check("empty recording rejected client-side", /empty recording/.test(threw));
const health = await parakeetHealth();
check("health reports model + loaded flag, nothing secret", health.ok && health.model === "nemo-parakeet-tdt-0.6b-v2" && health.loaded === false);

// C. routes
const form = (blob) => { const fd = new FormData(); if (blob) fd.append("audio", blob, "recording.webm"); return new Request("http://app.local/api/stt/transcribe", { method: "POST", body: fd }); };
let res = await transcribeRoute.POST(form(clip));
let body = await res.json();
check("POST /api/stt/transcribe -> ok text, labelled parakeet", res.status === 200 && body.ok && body.provider === "parakeet" && /heard 1200 bytes/.test(body.text));
res = await transcribeRoute.POST(form(null));
check("POST without audio -> 400", res.status === 400);
res = await transcribeRoute.POST(new Request("http://app.local/api/stt/transcribe", { method: "POST", body: "nope" }));
check("POST non-multipart -> 400", res.status === 400);
scenario = "down";
res = await transcribeRoute.POST(form(clip)); body = await res.json();
check("POST with Parakeet down -> 502 with the reason", res.status === 502 && body.ok === false && /8881/.test(body.error));
res = await healthRoute.GET(); body = await res.json();
check("GET /api/stt/health with Parakeet down -> 502, ok:false", res.status === 502 && body.ok === false);
scenario = "ok";
res = await healthRoute.GET(); body = await res.json();
check("GET /api/stt/health -> model + loaded", res.status === 200 && body.model === "nemo-parakeet-tdt-0.6b-v2");
check("every request went to loopback", seen.length > 0 && seen.every((s) => ["127.0.0.1", "localhost"].includes(s.host)));

// D. wiring (source-level, the parts a browser would exercise)
const hook = fs.readFileSync("src/lib/v2/jarvis/useVoiceCapture.ts", "utf8");
const client = fs.readFileSync("src/lib/v2/jarvis/transcribeClient.ts", "utf8");
const gear = fs.readFileSync("src/components/v2/jarvis/JarvisSettings.tsx", "utf8");
check("capture hook lists Parakeet first as a local provider", /id: "parakeet", label: "Parakeet \(local, port 8881\)", isLocal: true/.test(hook) && hook.indexOf('id: "parakeet"') < hook.indexOf('id: "voicebox"'));
check("recorder lane is provider-generic (usesRecorder), no Voicebox-only branch", /usesRecorder\(info\)/.test(hook) && !/info\.id === "voicebox"\)/.test(hook));
check("hook hands the provider to the transcribe client", hook.includes("transcribeRecording(blob, info.id)"));
check("hook still performs no fetch of its own", !/fetch\(/.test(hook));
check("client maps parakeet -> /api/stt/transcribe and voicebox -> /api/voicebox/transcribe", /parakeet.*\/api\/stt\/transcribe/.test(client) && /voicebox.*\/api\/voicebox\/transcribe/.test(client));
const { transcribeEndpoint } = await import("../../src/lib/v2/jarvis/transcribeClient.ts");
threw = ""; try { transcribeEndpoint("webspeech"); } catch (e) { threw = String(e.message); }
check("client refuses a provider with no local transcriber", /No local transcriber/.test(threw));
check("defaults: mic = parakeet, reply voice = local Kokoro, not voicebox", defaults.jarvis.voice.provider === "parakeet" && defaults.jarvis.voice.ttsProvider === "local");
check("defaults: stt.parakeetUrl is loopback 8881", defaults.stt?.parakeetUrl === "http://127.0.0.1:8881");
check("gear shows Parakeet health + URL when selected (rule 16)", /provider === "parakeet"/.test(gear) && /\/api\/stt\/health/.test(gear) && /stt: \{ parakeetUrl/.test(gear));
const startBat = fs.readFileSync("Start Agent OS.bat", "utf8");
const restartPs = fs.readFileSync("agentos-restart.ps1", "utf8");
check("Start launcher calls parakeet-start.ps1", /parakeet-start\.ps1/.test(startBat));
check("Restart launcher stops 8881 and relaunches Parakeet", /LocalPort 8881/.test(restartPs) && /parakeet-start\.ps1/.test(restartPs));
check("parakeet-start.ps1 exists and targets 8881", fs.existsSync("parakeet-start.ps1") && /8881/.test(fs.readFileSync("parakeet-start.ps1", "utf8")));

console.log(failures ? `smoke-parakeet-stt: ${failures} FAILURES` : "smoke-parakeet-stt: all checks passed");
process.exit(failures ? 1 : 0);
