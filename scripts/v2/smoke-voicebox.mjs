// Voicebox client + /api/hermes/tts "voicebox" branch, fully offline.
//
// Run: npx tsx scripts/v2/smoke-voicebox.mjs
//
// Rule 19: AGENTIC_OS_SETTINGS is redirected BEFORE any import. globalThis.fetch
// is replaced with a fake studio, so nothing here touches 127.0.0.1:17493 or any
// other host; section F asserts that every URL the client tried was loopback.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-voicebox-"));
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");
// The ElevenLabs backup path reads the key from ~/.hermes/profiles/<active>/.env
// FIRST and the environment second. Point "home" at the temp dir before any
// import so the real profile is never opened, then supply a smoke key via env.
process.env.USERPROFILE = dir;
process.env.HOME = dir;
process.env.ELEVENLABS_API_KEY = "smoke-eleven-key";
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({ memory: { ingestEnabled: false } }), "utf8");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !extra ? "" : `  [${extra}]`}`);
  if (!cond) failures++;
};

// ---- fake studio ------------------------------------------------------------
const PROFILES = [
  { id: "p-yoshi", name: "Yoshi", description: "clone", language: "en", default_engine: "chatterbox_turbo", voice_type: "cloned" },
  // Trailing space on purpose: the studio keeps names as typed (the real "Alfred " had one).
  { id: "p-morgan", name: "Morgan ", description: null, language: "en", default_engine: null, voice_type: "designed" },
];
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]); // "RIFF" + junk
const seen = [];          // every URL the client requested
const generateBodies = []; // every /generate body
let scenario = "ok";      // ok | stall | fail | empty
let sseErrored = false;

function sse(events, { hang = false, signal } = {}) {
  const stream = new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      if (!hang) c.close();
      signal?.addEventListener("abort", () => { sseErrored = true; try { c.error(Object.assign(new Error("aborted"), { name: "AbortError" })); } catch { /* closed */ } });
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const headersSeen = [];
let elevenMode = "ok";   // ok | fail
const elevenCalls = [];  // { key } for every request that reached the fake ElevenLabs
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.elevenlabs.io") {
    elevenCalls.push({ key: init.headers?.["xi-api-key"] ?? null, voice: u.pathname.split("/").at(-1) });
    if (elevenMode === "fail") return new Response(JSON.stringify({ detail: "invalid api key" }), { status: 401 });
    return new Response(new Uint8Array([0x49, 0x44, 0x33, 9, 9]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  }
  seen.push(u.toString());
  headersSeen.push(init.headers ?? {});
  const p = u.pathname;
  if (p === "/health") return Response.json({ status: "healthy", model_loaded: true, gpu_available: false, backend_type: "pytorch", backend_variant: "cpu" });
  if (p === "/profiles") return Response.json(PROFILES);
  if (p === "/generate" && init.method === "POST") {
    generateBodies.push(JSON.parse(init.body));
    return Response.json({ id: "g1", status: "generating" });
  }
  if (p === "/generate/g1/status") {
    if (scenario === "stall") return sse([{ status: "loading_model" }], { hang: true, signal: init.signal });
    if (scenario === "fail") return sse([{ status: "generating" }, { status: "failed", error: "CUDA out of memory" }]);
    return sse([{ status: "loading_model" }, { status: "generating" }, { status: "completed", duration: 1.5 }]);
  }
  if (p === "/audio/g1") {
    if (scenario === "stall") return new Response("Internal Server Error", { status: 500 });
    if (scenario === "empty") return new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "audio/wav" } });
    return new Response(WAV, { status: 200, headers: { "content-type": "audio/wav" } });
  }
  if (p === "/transcribe" && init.method === "POST") {
    const fd = init.body;
    const f = fd.get("file");
    return Response.json({ text: `heard ${f.size} bytes via ${fd.get("model") ?? "default"}`, duration: 2.25 });
  }
  return new Response("not found", { status: 404 });
};

const S = await import("../../src/lib/settings.ts");
const V = await import("../../src/lib/voicebox.ts");

// ---- A. base URL is asserted loopback ---------------------------------------
console.log("-- A: loopback assertion --");
check("default base is loopback", V.voiceboxBase() === "http://127.0.0.1:17493", V.voiceboxBase());
S.writeSettings({ voicebox: { url: "http://192.168.0.99:17493" } });
let threw = null;
try { V.voiceboxBase(); } catch (e) { threw = String(e.message); }
check("remote URL throws", !!threw && /loopback/.test(threw), threw ?? "no throw");
try { await V.listVoiceboxProfiles(); threw = null; } catch (e) { threw = String(e.message); }
check("no request leaves for a remote URL", !!threw && !seen.some((u) => u.includes("192.168")), seen.join(","));
S.writeSettings({ voicebox: { url: "http://localhost:17493" } });
check("localhost accepted", V.voiceboxBase() === "http://localhost:17493");

// ---- B. profiles + resolution ------------------------------------------------
console.log("-- B: profiles --");
const profiles = await V.listVoiceboxProfiles();
check("two profiles mapped", profiles.length === 2 && profiles[0].engine === "chatterbox_turbo" && profiles[1].engine === null);
check("resolve by id", (await V.resolveVoiceboxProfile("p-morgan")).id === "p-morgan");
check("resolve by name, case-insensitive", (await V.resolveVoiceboxProfile("yoshi")).id === "p-yoshi");
check("resolve by name ignores the studio's trailing whitespace", (await V.resolveVoiceboxProfile("morgan")).id === "p-morgan");
check("resolve empty -> first profile", (await V.resolveVoiceboxProfile("")).id === "p-yoshi");
S.writeSettings({ voicebox: { profile: "Morgan" } });
check("resolve empty -> settings default", (await V.resolveVoiceboxProfile(undefined)).id === "p-morgan");
try { await V.resolveVoiceboxProfile("nobody"); threw = null; } catch (e) { threw = String(e.message); }
check("unknown profile names the options", !!threw && /Yoshi, Morgan/.test(threw), threw ?? "no throw");
S.writeSettings({ voicebox: { profile: "" } });

// ---- C. synthesize follows the SSE stream, then fetches audio --------------
console.log("-- C: synthesize --");
const out = await V.voiceboxSynthesize("Agent OS is online.", { profile: "Yoshi" });
check("data URI carries the studio's mime", out.audio.startsWith("data:audio/wav;base64,"), out.audio.slice(0, 30));
check("bytes round-trip", Buffer.from(out.audio.split(",")[1], "base64").equals(Buffer.from(WAV)));
check("duration from the terminal event", out.durationSec === 1.5 && out.generationId === "g1");
check("profile engine forwarded", generateBodies.at(-1).engine === "chatterbox_turbo" && generateBodies.at(-1).profile_id === "p-yoshi", JSON.stringify(generateBodies.at(-1)));
check("client id header on every request", headersSeen.length > 0 && headersSeen.every((h) => h["X-Voicebox-Client-Id"] === "agent-os"));
await V.voiceboxSynthesize("x", { profile: "Morgan", engine: "qwen" });
check("explicit engine wins over a profile without one", generateBodies.at(-1).engine === "qwen");
S.writeSettings({ voicebox: { engine: "kokoro" } });
await V.voiceboxSynthesize("x", { profile: "Morgan" });
check("settings engine used when the caller has none", generateBodies.at(-1).engine === "kokoro");
S.writeSettings({ voicebox: { engine: "" } });

// ---- D. failure modes are loud, never a fallback ---------------------------
console.log("-- D: failures --");
scenario = "fail";
try { await V.voiceboxSynthesize("x"); threw = null; } catch (e) { threw = String(e.message); }
check("studio error surfaces verbatim", !!threw && /CUDA out of memory/.test(threw), threw ?? "no throw");
scenario = "stall";
try { await V.voiceboxSynthesize("x", { timeoutMs: 400 }); threw = null; } catch (e) { threw = String(e.message); }
check("timeout reports the last status seen", !!threw && /still loading_model after/.test(threw), threw ?? "no throw");
check("the stalled stream was actually aborted", sseErrored);
scenario = "empty";
try { await V.voiceboxSynthesize("x"); threw = null; } catch (e) { threw = String(e.message); }
check("empty audio is an error, not a silent clip", !!threw && /empty audio/.test(threw), threw ?? "no throw");
scenario = "ok";
try { await V.voiceboxSynthesize("   "); threw = null; } catch (e) { threw = String(e.message); }
check("blank text rejected before any request", !!threw && /nothing to say/.test(threw));

// ---- E. transcribe -----------------------------------------------------------
console.log("-- E: transcribe --");
const t = await V.voiceboxTranscribe(new Blob([new Uint8Array(1234)]), { model: "whisper-turbo" });
check("transcript + duration back", t.text === "heard 1234 bytes via whisper-turbo" && t.durationSec === 2.25, JSON.stringify(t));
try { await V.voiceboxTranscribe(new Blob([])); threw = null; } catch (e) { threw = String(e.message); }
check("empty recording rejected", !!threw && /empty recording/.test(threw));

// ---- F. the TTS route's voicebox branch + isolation --------------------------
console.log("-- F: route + isolation --");
S.writeSettings({ jarvis: { voice: { ttsFallback: "none" } } });
const route = await import("../../src/app/api/hermes/tts/route.ts");
const res = await route.POST(new Request("http://local/api/hermes/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello", provider: "voicebox", voiceId: "Yoshi" }) }));
const rj = await res.json();
check("route returns a data URI for provider voicebox", res.ok && typeof rj.audio === "string" && rj.audio.startsWith("data:audio/wav"), JSON.stringify(rj).slice(0, 120));
scenario = "fail";
const bad = await route.POST(new Request("http://local/api/hermes/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello", provider: "voicebox" }) }));
const bj = await bad.json();
check("route: with the backup off, the studio's reason comes back", bad.status === 502 && /CUDA/.test(bj.error ?? "") && elevenCalls.length === 0, JSON.stringify(bj));
scenario = "ok";
check("every request went to loopback", seen.length > 0 && seen.every((u) => /^http:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(u)), seen.find((u) => !/127\.0\.0\.1|localhost/.test(u)) ?? "");
check("nothing hosted was contacted", !seen.some((u) => /elevenlabs|openai|minimax|api\./.test(u)));

// ---- G. the chosen backup: ElevenLabs, labelled ----------------------------
console.log("-- G: ElevenLabs backup (owner's choice, labelled) --");
S.writeSettings({ jarvis: { voice: { ttsFallback: "elevenlabs", ttsVoiceId: "VOICE0000000000000001" } } });
scenario = "fail";
const fb = await route.POST(new Request("http://local/api/hermes/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello", provider: "voicebox" }) }));
const fj = await fb.json();
check("backup speaks when the studio fails", fb.ok && typeof fj.audio === "string" && fj.audio.startsWith("data:audio/mp3"), JSON.stringify(fj).slice(0, 160));
check("response names the provider that actually spoke", fj.provider === "elevenlabs" && fj.fellBackFrom === "voicebox" && /CUDA/.test(fj.fallbackReason ?? ""), JSON.stringify({ p: fj.provider, f: fj.fellBackFrom, r: fj.fallbackReason }));
check("backup used the smoke key, not a real one", elevenCalls.length === 1 && elevenCalls[0].key === "smoke-eleven-key", JSON.stringify(elevenCalls));
check("backup used the configured reply voice", elevenCalls[0]?.voice === "VOICE0000000000000001", elevenCalls[0]?.voice);
elevenMode = "fail";
const both = await route.POST(new Request("http://local/api/hermes/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello", provider: "voicebox" }) }));
const bothj = await both.json();
check("both failing -> 502 naming both reasons", both.status === 502 && /Voicebox failed/.test(bothj.error) && /ElevenLabs backup also failed/.test(bothj.error), JSON.stringify(bothj));
scenario = "ok"; elevenMode = "ok";
const okAgain = await route.POST(new Request("http://local/api/hermes/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello", provider: "voicebox" }) }));
const okj = await okAgain.json();
check("studio healthy -> the backup is not consulted", okAgain.ok && okj.provider === "voicebox" && !okj.fellBackFrom && elevenCalls.length === 2, `eleven calls: ${elevenCalls.length}`);
check("the real Hermes profile was never opened", !fs.existsSync(path.join(dir, ".hermes")) && process.env.USERPROFILE === dir);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
