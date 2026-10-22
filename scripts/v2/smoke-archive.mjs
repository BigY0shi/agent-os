// S24 Crew archive smoke, offline. HOME / USERPROFILE and every store point at a temp
// dir, so the owner's real Oracle log, briefings, deals, conversations are never read.
//   A. one index over the stores: mission reports and step answers, Oracle, News Radar,
//      Brainstorm, Jarvis conversations; right labels, authors, words, dates; newest first
//   B. search reaches the text itself; the source filter works; lists carry no bodies
//   C. the reader returns the whole document with its metadata; unknown ids are 404
//   D. a store that cannot be read is reported, and the others still show
//   E. it is read-only: no store file changes; UI wiring
// Run: npx tsx scripts/v2/smoke-archive.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-archive-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_MISSIONS_DIR = path.join(tmp, "missions");
process.env.AGENTIC_OS_DESK = path.join(tmp, "desk.json");
process.env.UPWORK_LEADS_DIR = path.join(tmp, "Upwork-Leads");
process.env.AGENTIC_OS_RUNS_DIR = path.join(tmp, "runs");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_SKILLS_DIR = path.join(tmp, "skills");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");
const A = path.join(tmp, ".agentic-os");
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s, "utf8"); };

// Fixtures
w(path.join(A, "oracle", "log.json"), JSON.stringify({ items: [{ at: "2026-09-27T10:00:00.000Z", question: "Should I raise my rate?", answer: "Yes, by about twenty percent, because demand exceeds your capacity.", agent: "claude" }] }));
w(path.join(A, "news", "log.json"), JSON.stringify({ items: [{ at: "2026-09-28T08:00:00.000Z", topic: "Local AI models", overview: "Three notable releases this week.", merger: "claude", items: [{ headline: "Model X ships", summary: "Runs on a laptop", url: "https://example.invalid/x" }] }] }));
w(path.join(A, "brainstorm", "bs1.json"), JSON.stringify({ id: "bs1", topic: "Pricing page ideas", createdAt: Date.parse("2026-09-20T00:00:00Z"), updatedAt: Date.parse("2026-09-20T00:00:00Z"), brief: "Lead with outcomes; show the ramp offer first; zebra-striped comparison.", msgs: [] }));
const store = await import("../../src/lib/v2/missions/store.ts");
const mid = store.newMissionId();
store.saveMission({ id: mid, name: "Competitor pricing", objective: "o", successLooksLike: "s", priority: "normal", teamMode: "manual", seats: [{ id: "c1", agent: "claude", model: "opus", role: "r" }], limits: { timeLimitMin: 30, maxSteps: 2, reportLength: "brief" }, endAction: "review", stage: "delivered", planApproved: true, createdAt: Date.parse("2026-09-29T09:00:00Z"), finishedAt: Date.parse("2026-09-29T10:00:00Z"), deliveredAt: Date.parse("2026-09-29T10:00:00Z"), result: "## Report\nA costs ten dollars; B costs twelve.",
  plan: { rationale: "", guardrails: [], plannedAt: 1, steps: [{ id: "s1", title: "Research", seatId: "c1", brief: "b", dependsOn: [], status: "done", finishedAt: Date.parse("2026-09-29T09:30:00Z") }] } });
w(store.stepFile(mid, "s1", "md"), "Vendor A: $10/mo, vendor B: $12/mo (sources linked).\n");
const { ensureV2 } = await import("../../src/lib/v2/boot.ts");
ensureV2();
const conv = await import("../../src/lib/v2/jarvis/conversations.ts");
const c1 = conv.ensureConversation(undefined, { titleSeed: "Plan the week" });
conv.appendJarvisMessage({ conversationId: c1.id, role: "user", content: "What is on my plate this week?" });
conv.appendJarvisMessage({ conversationId: c1.id, role: "assistant", content: "Two deals to answer and the newsletter on Thursday." });
conv.appendJarvisMessage({ conversationId: c1.id, role: "system", content: "[internal] not shown" });

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const snapshot = () => fs.readdirSync(A, { recursive: true }).filter((p) => fs.statSync(path.join(A, p)).isFile()).map((p) => `${p}:${fs.statSync(path.join(A, p)).mtimeMs}`).sort().join("|");
const before = snapshot();

const AR = await import("../../src/lib/v2/archive/archive.ts");
AR.__resetArchiveCacheForTests();
let L = await AR.listArchive();
const by = (src) => L.docs.filter((d) => d.source === src);

// ── A ─────────────────────────────────────────────────────────────────────────
check("A1 mission report and the seat's answer are both there", by("mission").length === 1 && by("mission-step").length === 1 && by("mission-step")[0].author === "claude (opus)");
check("A2 Oracle consultation: question as title, the agent as author", by("oracle")[0]?.title === "Should I raise my rate?" && by("oracle")[0].author === "Oracle (claude)");
check("A3 News Radar briefing with its items in the text", by("news")[0]?.title === "Local AI models" && by("news")[0].preview.includes("Model X ships"));
check("A4 Brainstorm brief", by("brainstorm")[0]?.title === "Pricing page ideas");
check("A5 Jarvis conversation, system lines left out", by("jarvis").length === 1 && by("jarvis")[0].preview.includes("You: What is on my plate") && !by("jarvis")[0].preview.includes("[internal]"));
check("A6 word counts are real", by("oracle")[0].words === "Yes, by about twenty percent, because demand exceeds your capacity.".split(/\s+/).length);
check("A7 newest first", L.docs.every((d, i, a) => i === 0 || (a[i - 1].at ?? 0) >= (d.at ?? 0)));
check("A8 counts per source", L.bySource.oracle === 1 && L.bySource.news === 1 && L.total === L.docs.length);
check("A9 links point at where each lives", by("oracle")[0].href === "/jarvis?tab=oracle" && by("jarvis")[0].href.startsWith("/jarvis?c="));

// ── B ─────────────────────────────────────────────────────────────────────────
L = await AR.listArchive({ q: "b costs twelve" }); // only in the report body, not its title
check("B1 search reaches the body text", L.docs.length === 1 && L.docs[0].source === "mission");
L = await AR.listArchive({ source: "news" });
check("B2 source filter", L.docs.length === 1 && L.docs[0].source === "news");
check("B3 lists carry no bodies", L.docs.every((d) => !("body" in d) && !("meta" in d)));

// ── C ─────────────────────────────────────────────────────────────────────────
const full = await AR.readArchiveDoc(`mission-step:${mid}:s1`);
check("C1 the reader returns the whole document and its metadata", full?.body.includes("Vendor A: $10/mo") && full.meta.Mission === "Competitor pricing" && full.meta.Step === "Research");
const route = await import("../../src/app/api/v2/archive/route.ts");
check("C2 unknown id is 404", (await route.GET(new Request("http://x/api/v2/archive?id=oracle:nope"))).status === 404);
const r = await route.GET(new Request("http://x/api/v2/archive?q=newsletter"));
check("C3 route search", (await r.json()).docs.some((d) => d.source === "jarvis"));

// ── D ─────────────────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(A, "news", "log.json"), "{broken", "utf8");
L = await AR.listArchive({ fresh: true });
check("D1 an unreadable store is reported by name", typeof L.errors.news === "string");
check("D2 and the other stores still show", L.bySource.oracle === 1 && L.bySource.mission === 1 && !L.bySource.news);
fs.writeFileSync(path.join(A, "news", "log.json"), JSON.stringify({ items: [] }), "utf8");

// ── E ─────────────────────────────────────────────────────────────────────────
const beforeNoNews = before.split("|").filter((x) => !x.startsWith(`news${path.sep}log.json`)).join("|");
const after = snapshot().split("|").filter((x) => !x.startsWith(`news${path.sep}log.json`)).join("|");
check("E1 read-only: no store file was written", after === beforeNoNews, { before: beforeNoNews.slice(0, 200), after: after.slice(0, 200) });
const hub = fs.readFileSync("src/components/jarvis/JarvisHub.tsx", "utf8");
const ui = fs.readFileSync("src/components/jarvis/ArchiveTab.tsx", "utf8");
check("E2 Archive tab registered", /key: "archive", label: "Archive"[^\n]*<ArchiveTab \/>/.test(hub));
check("E3 cards show source, author, words and date; the reader links to where it lives", ui.includes("{d.words.toLocaleString()} words") && ui.includes("Open where it lives"));
check("E4 unreadable stores are named on the page", ui.includes("Could not read:"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
