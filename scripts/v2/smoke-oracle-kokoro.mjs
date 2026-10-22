// Oracle on Kokoro smoke, offline (owner, 2026-09-30: "Add kokoro").
//   A. defaults: the Oracle speaks Kokoro (bm_lewis) unless the owner picks otherwise
//   B. /api/hermes/tts provider "kokoro": Kokoro answers -> provider "kokoro", its voice sent
//   C. Kokoro down + the Oracle's backup = ElevenLabs -> ElevenLabs speaks, labelled
//      (fellBackFrom "kokoro" + the reason); backup = none -> a 502 naming Kokoro, silence
//   D. Jarvis's plain "local" path is unchanged: no backup, no ElevenLabs call
//   E. the gear offers Kokoro first and marks Voicebox retired
// fetch is stubbed (Kokoro on 127.0.0.1:8880 and api.elevenlabs.io); nothing leaves the
// machine. HOME / USERPROFILE and every store point at a temp dir (rule 19), so neither the
// real Hermes .env nor the real settings are read.
// Run: npx tsx scripts/v2/smoke-oracle-kokoro.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-oracle-kokoro-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");
process.env.ELEVENLABS_API_KEY = "smoke-not-a-real-key";

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};

let kokoroUp = true;
const calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ u, body: init?.body ? String(init.body) : "" });
  if (u.startsWith("http://127.0.0.1:8880/tts")) {
    if (!kokoroUp) throw new Error("connect ECONNREFUSED 127.0.0.1:8880");
    return new Response(JSON.stringify({ ok: true, audio: "data:audio/wav;base64,UklGRg==" }), { status: 200 });
  }
  if (u.startsWith("https://api.elevenlabs.io/")) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  return new Response("not stubbed", { status: 599 });
};

const S = await import("../../src/lib/settings.ts");
const route = await import("../../src/app/api/hermes/tts/route.ts");
const speak = async (body) => { const r = await route.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };

// ── A ─────────────────────────────────────────────────────────────────────────
const od = S.DEFAULT_SETTINGS.oracle.voice;
check("A1 the Oracle defaults to Kokoro with bm_lewis (not Jarvis's bm_george)", od.provider === "kokoro" && od.kokoroVoice === "bm_lewis" && S.ORACLE_KOKORO_VOICE === "bm_lewis");

// ── B ─────────────────────────────────────────────────────────────────────────
let r = await speak({ text: "Patience is a strategy.", provider: "kokoro", voiceId: "bm_lewis", module: "oracle" });
const sent = calls.find((c) => c.u.startsWith("http://127.0.0.1:8880/tts"));
check("B1 Kokoro answers: provider kokoro, audio returned", r.status === 200 && r.j.provider === "kokoro" && /^data:audio/.test(r.j.audio || ""), r);
check("B2 the chosen Kokoro voice was sent", !!sent && JSON.parse(sent.body).voice === "bm_lewis", sent);

// ── C ─────────────────────────────────────────────────────────────────────────
kokoroUp = false;
calls.length = 0;
r = await speak({ text: "Patience is a strategy.", provider: "kokoro", voiceId: "bm_lewis", module: "oracle" });
check("C1 Kokoro down + backup ElevenLabs: ElevenLabs speaks, labelled with the reason", r.status === 200 && r.j.provider === "elevenlabs" && r.j.fellBackFrom === "kokoro" && /not answering|ECONNREFUSED/.test(r.j.fallbackReason || ""), r);
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({ oracle: { voice: { fallback: "none" } } }), "utf8");
calls.length = 0;
r = await speak({ text: "Patience is a strategy.", provider: "kokoro", voiceId: "bm_lewis", module: "oracle" });
check("C2 backup none: a 502 naming Kokoro, and ElevenLabs is never called", r.status === 502 && r.j.provider === "kokoro" && !calls.some((c) => c.u.includes("elevenlabs")), r);

// ── D ─────────────────────────────────────────────────────────────────────────
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");
calls.length = 0;
let threw = null;
try { r = await speak({ text: "Good evening, sir.", provider: "local", voiceId: "bm_george" }); } catch (e) { threw = e; }
check("D1 Jarvis's local path has no backup: no ElevenLabs call when Kokoro is down", !calls.some((c) => c.u.includes("elevenlabs")) && (threw !== null || r.status >= 500), { threw: String(threw), r });

// ── E ─────────────────────────────────────────────────────────────────────────
const ui = fs.readFileSync("src/components/OracleView.tsx", "utf8");
check("E1 the gear offers Kokoro first, its voice picker, and marks Voicebox retired", ui.indexOf('value="kokoro"') > -1 && ui.indexOf('value="kokoro"') < ui.indexOf('value="elevenlabs"') && /Voicebox \(retired\)/.test(ui) && /Kokoro voice/.test(ui));
check("E2 the page speaks Kokoro when nothing is saved", /provider \?\? "kokoro"/.test(ui));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
