// S22 Voice mode smoke, offline (the tab is client code; no mic, no speaker here).
//   A. the roster: Jarvis and the Oracle always, plus every Mastermind specialist and
//      every crew agent, read from their real endpoints
//   B. the lanes: each member is answered by its own real route
//   C. speech: Parakeet in (useVoiceCapture, provider "parakeet"), Kokoro out
//      (/api/hermes/tts provider "local"); the one named voice exists in the TTS route
//   D. the face tells the truth: listening only while recording, speaking only while
//      audio plays, level from the audio itself, nothing random
//   E. "talk to <name>" switches instead of sending (the real pattern, run on phrases)
//   F. the dial: arrows / arrow keys / click / voice; no wheel binding (no scroll trap)
// Run: npx tsx scripts/v2/smoke-voice-mode.mjs
import fs from "node:fs";

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(extra).slice(0, 200)}]`}`);
  if (!cond) failures++;
};
const ui = fs.readFileSync("src/components/jarvis/VoiceTab.tsx", "utf8");
const hub = fs.readFileSync("src/components/jarvis/JarvisHub.tsx", "utf8");
const tts = fs.readFileSync("src/app/api/hermes/tts/route.ts", "utf8");

// A
check("A1 Voice tab registered in Jarvis", /key: "voice", label: "Voice"[^\n]*<VoiceTab \/>/.test(hub));
check("A2 Jarvis and the Oracle are always on the dial", /key: "jarvis",[^\n]*lane: "jarvis"/.test(ui) && /key: "oracle",[^\n]*lane: "oracle"/.test(ui));
check("A3 specialists and crew agents come from their real endpoints", ui.includes('fetch("/api/room/status"') && ui.includes('fetch("/api/v2/crew"'));

// B
check("B1 Jarvis answers over his ask lane (SSE sentences), keeping the conversation", ui.includes('fetch("/api/v2/jarvis/ask"') && ui.includes('ev.type === "sentence"') && ui.includes("jarvisConv.current = ev.conversationId"));
check("B2 the Oracle answers over /api/oracle", ui.includes('fetch("/api/oracle"'));
check("B3 a specialist answers alone over the room route", ui.includes("agents: [who.id]") && ui.includes('fetch("/api/room"'));
check("B4 a crew agent answers with a real run, polled to its end with a stated deadline", ui.includes("/api/v2/crew/${encodeURIComponent(who.id)}/chat") && ui.includes("no reply within 10 minutes"));
check("B5 an empty reply is an error, not silence", ui.includes('throw new Error("the reply came back empty")'));

// C
check("C1 speech in through Parakeet", ui.includes('useVoiceCapture({ provider: "parakeet", onFinalChunk: handleUtterance })'));
check("C2 speech out through Kokoro", ui.includes('provider: "local"') && ui.includes('fetch("/api/hermes/tts"'));
check("C3 the one named voice (bm_george) is a Kokoro voice this codebase already uses", tts.includes("bm_george") && /\^\[ab\]\[fm\]_\[a-z\]\+\$/.test(tts) && /^[ab][fm]_[a-z]+$/.test("bm_george"));
check("C4 a failed voice is said, not skipped", ui.includes("Could not speak the reply"));
check("C5 the mic being unavailable is said, typing still works", ui.includes("Microphone unavailable:") && ui.includes("Typed messages still work"));

// D
check("D1 listening only while recording", ui.includes('if (recording) setFace("listening")'));
check("D2 speaking only while audio plays, level from the audio", ui.includes('audio.onplay = () => { setFace("speaking"); tick(); };') && ui.includes("an.getByteFrequencyData(data)"));
check("D3 nothing random", !/Math\.random/.test(ui));

// E
const lit = /const sw = (\/\^\(\?:talk[^\n]*?\/i)\.exec\(t\);/.exec(ui);
check("E0 the switch pattern is present", !!lit, "not found");
if (lit) {
  const body = lit[1].slice(1, lit[1].lastIndexOf("/"));
  const re = new RegExp(body, "i");
  const cap = (s) => re.exec(s)?.[1];
  check("E1 'talk to Hermes' -> Hermes", cap("talk to Hermes") === "Hermes");
  check("E2 'switch over to the Oracle.' -> Oracle", cap("switch over to the Oracle.") === "Oracle");
  check("E3 a normal question is not a switch", cap("what should I talk about with the client?") === undefined && cap("Open the Deal Desk") === undefined);
}

// F
check("F1 arrow keys and buttons turn the dial", ui.includes('e.key === "ArrowLeft"') && ui.includes('aria-label="Previous"') && ui.includes('aria-label="Next"'));
check("F2 Space is push-to-talk, never while typing", ui.includes('e.code === "Space"') && ui.includes('el.tagName === "INPUT"'));
check("F3 no wheel handler on the dial (the page keeps its scroll)", !/onWheel|addEventListener\("wheel"/.test(ui));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
