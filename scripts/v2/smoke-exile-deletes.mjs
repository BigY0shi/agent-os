// "Delete" means exile smoke, offline.
//   A. exileFile: moves into <root>/.exile/<stamp>/ keeping the relative path, null when
//      absent, throws for a path outside the root (never touches it)
//   B. Local builds, C. Agent Kanban, D. Music (audio + cover + sidecar together, and a
//      sidecar pointing outside the music folder is refused), E. Agent Room history:
//      each module's delete leaves the file recoverable under .exile and gone from its list
//   F. none of the four modules calls unlink any more
// HOME / USERPROFILE, the config file (vault) and every store point at a temp dir (rule 19);
// the Room leg refuses to run unless the vault resolves inside that temp dir.
// Run: npx tsx scripts/v2/smoke-exile-deletes.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-exile-"));
const vault = path.join(tmp, "vault");
fs.mkdirSync(vault, { recursive: true });
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_CONFIG = path.join(tmp, "config.json");
fs.writeFileSync(process.env.AGENTIC_OS_CONFIG, JSON.stringify({ vaultRoot: vault }), "utf8");
process.env.AGENTIC_OS_VAULT = vault;
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_LOCAL_BUILDS = path.join(tmp, "local-builds");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const exiled = (root) => {
  const d = path.join(root, ".exile");
  if (!fs.existsSync(d)) return [];
  const out = [];
  const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); e.isDirectory() ? walk(q) : out.push(path.relative(d, q).split(path.sep).join("/")); } };
  walk(d);
  return out;
};

// ── A ─────────────────────────────────────────────────────────────────────────
const { exileFile } = await import("../../src/lib/exileFile.ts");
const root = path.join(tmp, "unit");
fs.mkdirSync(path.join(root, "sub"), { recursive: true });
fs.writeFileSync(path.join(root, "sub", "a.txt"), "keep me", "utf8");
const dest = await exileFile(path.join(root, "sub", "a.txt"), root, "S1");
check("A1 the file moves to <root>/.exile/<stamp>/ with its relative path and content", dest === path.join(root, ".exile", "S1", "sub", "a.txt") && fs.readFileSync(dest, "utf8") === "keep me" && !fs.existsSync(path.join(root, "sub", "a.txt")));
check("A2 an absent file returns null", (await exileFile(path.join(root, "nope.txt"), root)) === null);
const outside = path.join(tmp, "outside.txt");
fs.writeFileSync(outside, "not yours", "utf8");
let threw = null;
try { await exileFile(outside, root); } catch (e) { threw = e; }
check("A3 a path outside the root throws and is left untouched", threw && /not inside/.test(threw.message) && fs.readFileSync(outside, "utf8") === "not yours");

// ── B ─────────────────────────────────────────────────────────────────────────
const LB = await import("../../src/lib/localBuilds.ts");
const lb = await LB.saveBuild({ title: "Calc", prompt: "a calculator", html: "<html>calc</html>" });
await LB.deleteBuild(lb.id);
const lbEx = exiled(process.env.AGENTIC_OS_LOCAL_BUILDS);
check("B1 Local builds: removed from the list, file kept under .exile", !(await LB.listBuilds()).some((b) => b.id === lb.id) && lbEx.some((f) => f.endsWith(`${lb.id}.html`)), lbEx);

// ── C ─────────────────────────────────────────────────────────────────────────
const KB = await import("../../src/lib/kanbanStore.ts");
const kroot = path.join(tmp, ".agentic-os", "agent-kanban");
check("C0 Agent Kanban's store is inside the temp home", KB.buildPath("x").startsWith(kroot));
await KB.recordBuild({ id: "kb-smoke-1", title: "Board", createdAt: Date.now() }, "<html>board</html>");
await KB.deleteBuild("kb-smoke-1");
const kbEx = exiled(kroot);
check("C1 Agent Kanban: removed from the list, file kept under .exile", !(await KB.listBuilds()).some((b) => b.id === "kb-smoke-1") && kbEx.some((f) => f.endsWith("builds/kb-smoke-1.html")), kbEx);

// ── D ─────────────────────────────────────────────────────────────────────────
const MU = await import("../../src/lib/musicStudio.ts");
check("D0 Music's folder is inside the temp home", MU.MUSIC_ROOT.startsWith(tmp));
fs.mkdirSync(MU.MUSIC_ROOT, { recursive: true });
fs.writeFileSync(path.join(MU.MUSIC_ROOT, "song.mp3"), "audio", "utf8");
fs.writeFileSync(path.join(MU.MUSIC_ROOT, "song.jpg"), "cover", "utf8");
fs.writeFileSync(path.join(MU.MUSIC_ROOT, "song.json"), JSON.stringify({ id: "t-1", title: "Song", audioFile: "song.mp3", coverFile: "song.jpg" }), "utf8");
check("D1 deleteTrack reports success", (await MU.deleteTrack("t-1")) === true);
const muEx = exiled(MU.MUSIC_ROOT);
const stamps = new Set(muEx.map((f) => f.split("/")[0]));
check("D2 audio, cover and sidecar exiled together in one batch", ["song.mp3", "song.jpg", "song.json"].every((n) => muEx.some((f) => f.endsWith(`/${n}`))) && stamps.size === 1, muEx);
check("D3 and gone from the music folder", !["song.mp3", "song.jpg", "song.json"].some((n) => fs.existsSync(path.join(MU.MUSIC_ROOT, n))));
fs.writeFileSync(path.join(MU.MUSIC_ROOT, "evil.json"), JSON.stringify({ id: "t-evil", title: "x", audioFile: "../../outside.txt" }), "utf8");
let evil = null;
try { await MU.deleteTrack("t-evil"); } catch (e) { evil = e; }
check("D4 a sidecar pointing outside the music folder is refused, the outside file untouched", !!evil && fs.readFileSync(outside, "utf8") === "not yours");

// ── E ─────────────────────────────────────────────────────────────────────────
const VW = await import("../../src/lib/vaultWriter.ts");
if (!VW.AGENTIC_DIR || !path.resolve(VW.AGENTIC_DIR).startsWith(path.resolve(tmp))) {
  check("E0 the vault resolves inside the temp dir (Room leg refused otherwise)", false, VW.AGENTIC_DIR);
} else {
  const AR = await import("../../src/lib/agentRoom.ts");
  const convos = path.join(VW.AGENTIC_DIR, "Agent Room", "conversations");
  await AR.saveConversation({ id: "room-smoke-1", title: "Standup", ts: Date.now(), msgs: [{ key: 1, who: "you", text: "Morning, crew." }] });
  check("E1 the Room thread was saved in the temp vault", fs.existsSync(path.join(convos, "room-smoke-1.json")));
  check("E2 deleteConversation reports success", (await AR.deleteConversation("room-smoke-1")) === true);
  const arEx = exiled(convos);
  check("E3 the thread is gone from the list and kept under .exile", !(await AR.listConversations()).some((c) => c.id === "room-smoke-1") && arEx.some((f) => f.endsWith("room-smoke-1.json")), arEx);
  check("E4 deleting a thread that isn't there reports false", (await AR.deleteConversation("room-smoke-nope")) === false);
}

// ── G. Pipeline "Remove from board" (the route did not exist before) ──────────
if (VW.AGENTIC_DIR && path.resolve(VW.AGENTIC_DIR).startsWith(path.resolve(tmp))) {
  const PL = await import("../../src/lib/pipeline.ts");
  const del = await import("../../src/app/api/pipeline/delete/route.ts");
  const post = (body) => del.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
  const item = { slug: "smoke-idea", title: "Smoke idea", stage: "inbox", route: "idea", created: new Date().toISOString(), tags: [], body: "An idea." };
  await PL.writeItem(item);
  check("G0 the Pipeline item exists in the temp vault", !!(await PL.readItem("smoke-idea")));
  let r = await post({ slug: "smoke-idea" });
  let j = await r.json();
  check("G1 /api/pipeline/delete exists and exiles the item", r.status === 200 && j.ok === true && /^\.exile\/[^/]+\/items\/smoke-idea\.md$/.test(j.exiledTo), j);
  check("G2 the file is kept under Pipeline/.exile and gone from the board", fs.existsSync(path.join(PL.PIPELINE_DIR, j.exiledTo || "x")) && !(await PL.readItem("smoke-idea")) && !(await PL.listItems()).some((i) => i.slug === "smoke-idea"));
  r = await post({ slug: "smoke-idea" });
  check("G3 removing it again is a 404", r.status === 404);
  r = await post({ slug: "../../etc/passwd" });
  check("G4 a bad slug is refused (404), nothing moved", r.status === 404);
}

// ── H. Studio searches + talks, Ultracode runs, Artifacts (owner 2026-09-30: "fix 7") ──
{
  const SH = await import("../../src/lib/studioHistory.ts");
  const srec = await SH.saveSearch({ query: "agent os", answer: "x", sources: [], createdAt: Date.now() });
  check("H0 the search was saved under the temp home", fs.existsSync(path.join(SH.SEARCHES_DIR, `${srec.id}.json`)) && SH.SEARCHES_DIR.startsWith(tmp));
  check("H1 Studio: deleting a search exiles it", (await SH.deleteSearch(srec.id)) === true && !fs.existsSync(path.join(SH.SEARCHES_DIR, `${srec.id}.json`)) && exiled(SH.SEARCHES_DIR).some((f) => f.endsWith(`${srec.id}.json`)));
  await SH.saveTalk({ id: "talk-smoke-1", title: "t", turns: [], createdAt: Date.now(), updatedAt: Date.now() });
  check("H2 Studio: deleting a Talk conversation exiles it", (await SH.deleteTalk("talk-smoke-1")) === true && exiled(SH.TALKS_DIR).some((f) => f.endsWith("talk-smoke-1.json")));

  process.env.AGENTIC_OS_ULTRACODE_RUNS = path.join(tmp, "ultracode-runs");
  const UR = await import("../../src/lib/ultracodeRuns.ts");
  const run = UR.newRun({ id: "uc-smoke-1", prompt: "audit", model: "claude-opus-5-5", ultracode: true });
  await UR.saveRun(run);
  check("H3 Ultracode: deleting a run exiles its replay", (await UR.deleteRun("uc-smoke-1")) === true && !(await UR.getRun("uc-smoke-1")) && exiled(UR.ULTRACODE_RUNS_ROOT).some((f) => f.endsWith("uc-smoke-1.json")));

  // Artifacts: PATH points at an empty folder, so `netlify` cannot be found and every deploy
  // fails: exactly the failure paths that used to leave a page listed as live.
  const emptyBin = path.join(tmp, "empty-bin"); fs.mkdirSync(emptyBin, { recursive: true });
  process.env.PATH = emptyBin;
  const ag = path.join(tmp, ".agentic-os");
  fs.mkdirSync(path.join(ag, "loop-builds"), { recursive: true });
  fs.writeFileSync(path.join(ag, "artifacts-site.json"), JSON.stringify({ siteId: "smoke-site", name: "smoke", baseUrl: "https://smoke.invalid" }), "utf8");
  fs.writeFileSync(path.join(ag, "loop-builds", "calc.html"), "<html><head><title>Calc</title></head><body>calc</body></html>", "utf8");
  const AR2 = await import("../../src/lib/claudeArtifacts.ts");
  check("H4 Artifacts' published folder is inside the temp home", AR2.PUBLISHED_DIR.startsWith(tmp));
  const pub = await AR2.publish("loop:calc.html");
  const listed = await AR2.listPublished?.() ?? JSON.parse(fs.readFileSync(path.join(AR2.PUBLISHED_DIR, "manifest.json"), "utf8"));
  const pubExiled = exiled(ag);
  check("H5 a failed deploy publishes nothing: error says so, nothing listed, the copy moved out of published/",
    pub.ok === false && /nothing was published/.test(pub.error || "") && listed.length === 0 &&
    !fs.existsSync(path.join(AR2.PUBLISHED_DIR, "calc")) && pubExiled.some((f) => /published\/calc\/index\.html$/.test(f)), { pub, listed, pubExiled });
  // Seed a "live" page (as if an earlier deploy worked), then fail to unpublish it.
  fs.mkdirSync(path.join(AR2.PUBLISHED_DIR, "live-page"), { recursive: true });
  fs.writeFileSync(path.join(AR2.PUBLISHED_DIR, "live-page", "index.html"), "<html>live</html>", "utf8");
  fs.writeFileSync(path.join(AR2.PUBLISHED_DIR, "manifest.json"), JSON.stringify([{ slug: "live-page", title: "Live", source: "loop:calc.html", url: "https://smoke.invalid/live-page/", publishedAt: 1, bytes: 17 }]), "utf8");
  const un = await AR2.unpublish("live-page");
  const after = JSON.parse(fs.readFileSync(path.join(AR2.PUBLISHED_DIR, "manifest.json"), "utf8"));
  check("H6 a failed unpublish keeps the page where it was and still listed (it is still live)",
    un.ok === false && /still live/.test(un.error || "") && after.some((i) => i.slug === "live-page") && fs.readFileSync(path.join(AR2.PUBLISHED_DIR, "live-page", "index.html"), "utf8") === "<html>live</html>", { un, after });
  check("H7 no exile folder was created inside published/ (it would be deployed)", !fs.existsSync(path.join(AR2.PUBLISHED_DIR, ".exile")));
  const left = ["src/lib/studioHistory.ts", "src/lib/ultracodeRuns.ts", "src/lib/claudeArtifacts.ts"].filter((p) => /unlink\(|await rm\(/.test(fs.readFileSync(p, "utf8")));
  check("H8 none of the three still calls unlink or rm", left.length === 0, left);
}

// ── F ─────────────────────────────────────────────────────────────────────────
const srcs = ["src/lib/agentRoom.ts", "src/lib/kanbanStore.ts", "src/lib/localBuilds.ts", "src/lib/musicStudio.ts"];
const still = srcs.filter((p) => /\bunlink\b/.test(fs.readFileSync(p, "utf8")));
check("F1 none of the four modules calls unlink", still.length === 0, still);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
