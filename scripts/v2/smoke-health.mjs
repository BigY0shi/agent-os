// S27 Health smoke, offline.
//   A. shape words are computed from the samples (flat / spiky / bursty / steady;
//      unknown with too few samples), never chosen for effect
//   B. the network counter parses `netstat -e`; an unreadable counter is null, not 0
//   C. the sampler: starts on first read, takes real samples, skips the first (no delta
//      yet), keeps at most 120, and exposes its interval
//   D. /api/v2/home/pulse?history=1 carries history + every drive; without it, neither
//   E. the view: "quiet and well" only when every check passes; Windows' missing load
//      average said plainly; an agents-only process filter; the view is named Health
// fetch is stubbed so no local service is probed; every store is a temp dir.
// Run: npx tsx scripts/v2/smoke-health.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-health-"));
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_RUNS_DIR = path.join(tmp, "runs");
process.env.AGENTIC_OS_AGENTS_DIR = path.join(tmp, "agents");
process.env.AGENTIC_OS_MISSIONS_DIR = path.join(tmp, "missions");
process.env.AGENTIC_OS_SKILLS_DIR = path.join(tmp, "skills");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");
globalThis.fetch = async () => { throw new Error("fetch failed"); };

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");
const S = await import("../../src/lib/hostSampler.ts");

// ── A ─────────────────────────────────────────────────────────────────────────
check("A1 too few samples -> unknown", S.shapeOf([5, 6, 7]) === "unknown");
check("A2 a range under 2 points -> flat", S.shapeOf([40, 40.5, 41, 40.2, 40.8, 40.1]) === "flat");
check("A3 calm with one spike -> spiky", S.shapeOf([5, 6, 5, 7, 6, 5, 70, 6, 5, 6, 5, 6]) === "spiky");
check("A4 jumping around -> bursty", S.shapeOf([5, 60, 8, 55, 10, 62, 7, 58, 9, 61]) === "bursty");
check("A5 moving smoothly -> steady", S.shapeOf([10, 12, 14, 16, 18, 20, 22, 24, 26, 28]) === "steady");
check("A6 network flatness is relative to its peak", S.shapeOf([1_000_000, 1_000_500, 1_000_200, 1_000_900, 1_000_100], true) === "flat");

// ── B ─────────────────────────────────────────────────────────────────────────
const sample = "Interface Statistics\r\n\r\n                           Received            Sent\r\n\r\nBytes                    1184126701      2763238186\r\nUnicast packets            12585856         8751836\r\n";
check("B1 netstat -e bytes = received + sent", S.parseNetstatE(sample) === 1184126701 + 2763238186);
check("B2 no Bytes row -> null, not 0", S.parseNetstatE("nothing here") === null);

// ── C ─────────────────────────────────────────────────────────────────────────
S.__resetSamplerForTests();
const h1 = await S.readHistory();
check("C1 the first read starts the sampler and hides the delta-less first sample", h1.samples.length === 0 && h1.intervalMs === 5000);
await S.takeSample();
await S.takeSample();
const h2 = await S.readHistory();
check("C2 real samples: cpu and memory are percentages", h2.samples.length === 2 && h2.samples.every((x) => x.cpu >= 0 && x.cpu <= 100 && x.mem > 0 && x.mem <= 100));
check("C3 shapes are reported per series", ["cpu", "mem", "disk", "net"].every((k) => typeof h2.shapes[k] === "string"));
for (let i = 0; i < 125; i++) await S.takeSample();
check("C4 at most 120 samples kept", (await S.readHistory()).samples.length <= 120);
S.__resetSamplerForTests();
const src = read("src/lib/hostSampler.ts");
check("C5 the sampler stops itself when nobody reads", src.includes("Date.now() - s.lastRead > IDLE_STOP") && src.includes("IDLE_STOP = 120_000"));

// ── D ─────────────────────────────────────────────────────────────────────────
const route = await import("../../src/app/api/v2/home/pulse/route.ts");
let j = await (await route.GET(new Request("http://x/api/v2/home/pulse"))).json();
check("D1 no history unless asked", !("history" in j) && !("drives" in j));
j = await (await route.GET(new Request("http://x/api/v2/home/pulse?history=1"))).json();
check("D2 history=1 carries history and every drive", j.history && Array.isArray(j.history.samples) && Array.isArray(j.drives) && j.drives.length >= 1 && j.drives.every((d) => d.totalBytes > 0));
check("D3 host facts include the kernel and the (null on Windows) load average", typeof j.host.release === "string" && (process.platform === "win32" ? j.host.loadavg === null : Array.isArray(j.host.loadavg)));
S.__resetSamplerForTests();

// ── E ─────────────────────────────────────────────────────────────────────────
const ui = read("src/components/v2/home/Cockpit.tsx");
check("E1 'quiet and well' only when nothing fails", ui.includes('failing.length === 0 ? "The machine is quiet and well"'));
check("E2 Windows' missing load average said plainly", ui.includes("Windows keeps no load average"));
check("E3 agents-only filter over named agent CLIs, and it is explained", ui.includes("AGENT_PROC") && ui.includes("Agents only = processes named after an agent CLI"));
check("E4 the four sparklines carry their shape word", ["Processor", "Memory", "Disk (system drive)", "Network"].every((l) => ui.includes(`<Spark label="${l}"`)) && ui.includes("hist?.shapes.net"));
check("E5 the view is named Health", read("src/components/Overview.tsx").includes('["pulse", "Health"]'));
check("E6 nothing random in the view", !/Math\.random/.test(ui));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
