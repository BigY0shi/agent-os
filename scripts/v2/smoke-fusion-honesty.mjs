// Fusion + Sakana honesty smoke, offline. The two "panel" modules share one design, so
// every check runs against both.
//   A. the waiting card shows no invented state: no hardcoded panel chips, no stage text or
//      progress bar driven by the elapsed seconds; the interval only ticks the real clock
//   B. the status line comes from events the route actually sent
//   C. every preset fills the box (no empty template that does nothing)
//   D. the route, against a stubbed provider (fetch replaced, nothing leaves the machine):
//      "accepted" only after a 200, before the first text; the text relayed as sent; an
//      HTTP error sends no "accepted"; no key is a loud error
// HOME / USERPROFILE and every store point at a temp dir (rule 19), so the routes' key
// lookup (~/.hermes/...) can never read the owner's real keys.
// Run: npx tsx scripts/v2/smoke-fusion-honesty.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-fusion-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
delete process.env.OPENROUTER_API_KEY;
delete process.env.SAKANA_API_KEY;

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};

const MODULES = [
  { tag: "Fusion", view: "src/components/FusionView.tsx", route: "../../src/app/api/fusion/chat/route.ts", keyEnv: "OPENROUTER_API_KEY", host: "https://openrouter.ai/", noKey: /No OpenRouter key/ },
  { tag: "Sakana", view: "src/components/SakanaView.tsx", route: "../../src/app/api/sakana/chat/route.ts", keyEnv: "SAKANA_API_KEY", host: "https://api.sakana.ai/", noKey: /No Sakana key/ },
];

const sse = (chunks) => new ReadableStream({
  start(c) {
    const enc = new TextEncoder();
    for (const t of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`));
    c.enqueue(enc.encode("data: [DONE]\n\n"));
    c.close();
  },
});
const readEvents = async (res) => (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const realFetch = globalThis.fetch;

for (const M of MODULES) {
  const t = M.tag;
  // ── A ───────────────────────────────────────────────────────────────────────
  const ui = fs.readFileSync(M.view, "utf8");
  check(`${t} A1 no hardcoded panel of model names`, !/Opus 4\.8|Gemini 3|"Grok"|Fable 5|Sakana panel/.test(ui) && !/\bPANEL\b/.test(ui));
  check(`${t} A2 no stage text chosen by elapsed seconds`, !/stageFor|elapsed\s*[<>]=?|[<>]=?\s*elapsed/.test(ui));
  check(`${t} A3 no fake progress bar`, !/fusion-shimmer/.test(ui));
  const intervals = [...ui.matchAll(/setInterval\(([^;]+)\)/g)].map((m) => m[1]);
  check(`${t} A4 the only interval ticks the real elapsed clock`, intervals.length === 1 && /^\(\)\s*=>\s*setElapsed\(Math\.floor\(\(Date\.now\(\) - start\) \/ 1000\)\)/.test(intervals[0]), intervals);
  check(`${t} A5 no setTimeout-driven state either`, !/setTimeout\(/.test(ui));
  check(`${t} A6 the card says plainly what the provider does not report`, /does not report which models are on the panel/.test(ui));

  // ── B ───────────────────────────────────────────────────────────────────────
  check(`${t} B1 the phase moves only on the route's status event`, /j\.t === "status" && j\.s === "accepted"\) \{ setPhase\("accepted"\)/.test(ui) && (ui.match(/setPhase\(/g) || []).length === 2);
  check(`${t} B2 the streaming label claims no judge`, !/Judge writing the verdict/.test(ui) && /Answer streaming/.test(ui));

  // ── C ───────────────────────────────────────────────────────────────────────
  const presetBlock = ui.slice(ui.indexOf("const PRESETS"), ui.indexOf("];", ui.indexOf("const PRESETS")));
  const qs = [...presetBlock.matchAll(/q:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  check(`${t} C1 every preset has a template`, qs.length >= 5 && qs.every((q) => q.trim().length > 20), qs.length);
  check(`${t} C2 the empty 'Ask the board' preset is gone`, !/name: "Ask the board", q: ""/.test(ui));
  check(`${t} C3 a preset click always fills the box`, /onClick=\{\(\) => setInput\(p\.q\)\}/.test(ui));

  // ── D ───────────────────────────────────────────────────────────────────────
  const route = await import(M.route);
  const req = () => new Request("http://x", { method: "POST", body: JSON.stringify({ prompt: "Is the sky blue?", history: [] }) });
  let seen = null;
  process.env[M.keyEnv] = "smoke-not-a-real-key";
  globalThis.fetch = async (url, init) => { seen = { url: String(url), auth: init?.headers?.Authorization }; return new Response(sse(["Mostly ", "yes."]), { status: 200 }); };
  let ev = await readEvents(await route.POST(req()));
  const firstD = ev.findIndex((e) => e.t === "d");
  const acc = ev.findIndex((e) => e.t === "status" && e.s === "accepted");
  check(`${t} D1 the stub was called at the provider with the test key (nothing else reached)`, seen?.url.startsWith(M.host) && seen.auth === "Bearer smoke-not-a-real-key", seen);
  check(`${t} D2 'accepted' arrives after the 200 and before the first text`, acc >= 0 && firstD > acc, ev);
  check(`${t} D3 the text is relayed exactly as sent`, ev.filter((e) => e.t === "d").map((e) => e.c).join("") === "Mostly yes." && ev.at(-1).t === "done");
  check(`${t} D4 the route invents no other status`, ev.filter((e) => e.t === "status").length === 1);

  globalThis.fetch = async () => new Response("rate limited", { status: 429 });
  ev = await readEvents(await route.POST(req()));
  check(`${t} D5 an HTTP error sends no 'accepted', and says what failed`, !ev.some((e) => e.t === "status") && ev.some((e) => e.t === "error" && /HTTP 429/.test(e.m)));

  delete process.env[M.keyEnv];
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("", { status: 500 }); };
  ev = await readEvents(await route.POST(req()));
  check(`${t} D6 no key: a loud error, and no request is made`, !called && ev.some((e) => e.t === "error" && M.noKey.test(e.m)) && !ev.some((e) => e.t === "status"));
  globalThis.fetch = realFetch;
}

const sak = fs.readFileSync("src/components/SakanaView.tsx", "utf8");
check("Sakana E1 its Clear button no longer asks about Fusion history", !/Fusion/.test(sak) && /Clear Sakana history\?/.test(sak));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
