// Render ROADMAP.md as a standalone HTML checklist page.
//
//   node scripts/roadmap-page.mjs [out.html]
//
// Default output: ~/.agentic-os/roadmap.html (outside the repo, stable path so the
// published Artifact can be redeployed from the same file). Offline: reads the
// markdown, package.json, .next/BUILD_ID mtime and `git rev-parse` only.
//
// Markdown it understands (exactly what ROADMAP.md uses, nothing more):
//   # Title                         page title
//   intro paragraphs                until the first "## "
//   ## Section                      a group
//   - [ ] **S1. Name.** body        a slice (continuation lines indented 2 spaces)
//   - [x] ...                       a done slice
//   1. **State** -- text            numbered status line (walkthrough section)
//   - text                          plain bullet (backlog, done log)
// Inline: **bold**, `code`.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || path.join(os.homedir(), ".agentic-os", "roadmap.html");

const md = fs.readFileSync(path.join(ROOT, "ROADMAP.md"), "utf8").replace(/\r\n/g, "\n");

// ---- tree state (honest: unknown renders as unknown) ------------------------
function sh(cmd) { try { return execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } }
const head = sh("git rev-parse --short HEAD");
const headDate = sh("git log -1 --format=%ci");
const branch = sh("git rev-parse --abbrev-ref HEAD");
let pkgVersion = null;
try { pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version; } catch {}
let buildStamp = null;
try { buildStamp = fs.statSync(path.join(ROOT, ".next", "BUILD_ID")).mtime; } catch {}
const buildStale = buildStamp && headDate ? buildStamp < new Date(headDate) : null;

// ---- parse ------------------------------------------------------------------
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

const lines = md.split("\n");
let title = "Roadmap";
const intro = [];
const sections = [];
let cur = null;
let para = [];
const flushPara = () => { if (para.length) { (cur ? cur.blocks : intro).push({ kind: "p", text: para.join(" ") }); para = []; } };

for (const raw of lines) {
  const line = raw.replace(/\s+$/, "");
  if (line.startsWith("# ")) { title = line.slice(2).trim(); continue; }
  if (line.startsWith("## ")) { flushPara(); cur = { name: line.slice(3).trim(), blocks: [] }; sections.push(cur); continue; }
  const item = /^- \[( |x)\] (.*)$/.exec(line);
  if (item) {
    flushPara();
    cur.blocks.push({ kind: "slice", done: item[1] === "x", text: item[2] });
    continue;
  }
  const num = /^(\d+)\. (.*)$/.exec(line);
  if (num) { flushPara(); cur.blocks.push({ kind: "num", n: num[1], text: num[2] }); continue; }
  if (/^- /.test(line)) { flushPara(); cur.blocks.push({ kind: "li", text: line.slice(2) }); continue; }
  if (/^  \S/.test(line) && cur && cur.blocks.length && ["slice", "li", "num"].includes(cur.blocks.at(-1).kind)) {
    cur.blocks.at(-1).text += " " + line.trim();
    continue;
  }
  if (line === "") { flushPara(); continue; }
  para.push(line.trim());
}
flushPara();

// ---- render -----------------------------------------------------------------
function renderSlice(b) {
  const m = /^\*\*([A-Z]\d+)\. (.+?)\*\*\s*(.*)$/.exec(b.text);
  const id = m ? m[1] : "";
  const name = m ? m[2] : b.text;
  const body = m ? m[3] : "";
  return `<li class="slice ${b.done ? "is-done" : ""}">
  <span class="box" aria-hidden="true">${b.done ? "&#10003;" : ""}</span>
  <div class="slice-main">
    <div class="slice-head"><span class="id">${esc(id)}</span><span class="name">${inline(name)}</span></div>
    ${body ? `<p class="slice-body">${inline(body)}</p>` : ""}
  </div>
</li>`;
}
function renderNum(b) {
  const m = /^\*\*([^*]+)\*\*\s*[-—]+\s*(.*)$/.exec(b.text);
  const state = m ? m[1] : "";
  const text = m ? m[2] : b.text;
  const cls = state.toLowerCase().replace(/\s+/g, "-");
  return `<li class="num"><span class="n">${b.n}</span><span class="chip chip-${cls}">${esc(state)}</span><span>${inline(text)}</span></li>`;
}
function renderBlocks(blocks) {
  let out = "", list = null;
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const b of blocks) {
    if (b.kind === "p") { close(); out += `<p>${inline(b.text)}</p>`; }
    else if (b.kind === "slice") { if (list !== "ul") { close(); out += `<ul class="slices">`; list = "ul"; } out += renderSlice(b); }
    else if (b.kind === "num") { if (list !== "ol") { close(); out += `<ol class="nums">`; list = "ol"; } out += renderNum(b); }
    else if (b.kind === "li") { if (list !== "ul") { close(); out += `<ul class="plain">`; list = "ul"; } out += `<li>${inline(b.text)}</li>`; }
  }
  close();
  return out;
}

const counts = {};
for (const s of sections) counts[s.name] = s.blocks.filter((b) => b.kind === "slice" && !b.done).length;
const doneCount = sections.reduce((n, s) => n + s.blocks.filter((b) => b.kind === "slice" && b.done).length, 0)
  + (sections.find((s) => s.name === "Done")?.blocks.filter((b) => b.kind === "li").length || 0);

const fmt = (d) => d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown";
const buildLine = buildStamp
  ? `Running build stamped ${fmt(buildStamp)}${buildStale === null ? "" : buildStale ? ", older than HEAD" : ", current"}`
  : "No .next/BUILD_ID found";

const html = `<title>${esc(title)} for Agent OS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=Source+Sans+3:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --ground:#F2F4F7; --surface:#FFFFFF; --line:#D9DEE5; --ink:#16202B; --muted:#5B6774;
  --accent:#0E7C86; --accent-ink:#0A5C64; --good:#2F7D4F; --good-bg:#E3F2E8; --warn:#9A6412; --warn-bg:#FBF0DC;
  --stale:#A33A2C; --stale-bg:#FBE6E2; --code-bg:#E9EDF2;
  --display:"Manrope",system-ui,sans-serif; --body:"Source Sans 3","Segoe UI",system-ui,sans-serif; --mono:"IBM Plex Mono",Consolas,monospace;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --ground:#0F141A; --surface:#161D25; --line:#28323D; --ink:#E6EBF0; --muted:#8A96A3;
  --accent:#3FB8C4; --accent-ink:#7FD3DB; --good:#6CC08B; --good-bg:#17301F; --warn:#E0A94A; --warn-bg:#33270F;
  --stale:#F08A7A; --stale-bg:#3A1C17; --code-bg:#1F2934;
}}
:root[data-theme="dark"]{
  --ground:#0F141A; --surface:#161D25; --line:#28323D; --ink:#E6EBF0; --muted:#8A96A3;
  --accent:#3FB8C4; --accent-ink:#7FD3DB; --good:#6CC08B; --good-bg:#17301F; --warn:#E0A94A; --warn-bg:#33270F;
  --stale:#F08A7A; --stale-bg:#3A1C17; --code-bg:#1F2934;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--body);font-size:17px;line-height:1.55}
main{max-width:46rem;margin:0 auto;padding:2.5rem 1.25rem 5rem}
h1{font-family:var(--display);font-weight:800;font-size:2.1rem;letter-spacing:-0.02em;margin:0 0 .35rem;text-wrap:balance}
h2{font-family:var(--display);font-weight:700;font-size:1.05rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:2.6rem 0 .9rem;display:flex;align-items:baseline;gap:.6rem}
h2 .count{font-family:var(--mono);font-weight:500;font-size:.8rem;color:var(--accent-ink);letter-spacing:0;text-transform:none}
p{margin:0 0 .9rem;max-width:65ch}
code{font-family:var(--mono);font-size:.86em;background:var(--code-bg);padding:.08em .35em;border-radius:3px}
.eyebrow{font-family:var(--mono);font-size:.8rem;color:var(--muted);margin-bottom:1rem}
.state{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.6rem;margin:1.4rem 0 .4rem}
.state div{background:var(--surface);border:1px solid var(--line);padding:.7rem .9rem}
.state .k{display:block;font-family:var(--mono);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem}
.state .v{font-family:var(--mono);font-size:.95rem;font-variant-numeric:tabular-nums}
.state .stale .v{color:var(--stale)} .state .current .v{color:var(--good)}
.intro{margin-top:1.4rem;color:var(--muted)}
ul.slices,ul.plain,ol.nums{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.6rem}
.slice{display:grid;grid-template-columns:1.5rem 1fr;gap:.7rem;background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);padding:.85rem 1rem}
.slice.is-done{border-left-color:var(--good);opacity:.75}
.box{width:1.15rem;height:1.15rem;margin-top:.2rem;border:1.5px solid var(--muted);display:grid;place-items:center;font-size:.8rem;color:var(--good)}
.is-done .box{border-color:var(--good)}
.slice-head{display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}
.id{font-family:var(--mono);font-size:.78rem;font-weight:500;color:var(--accent-ink);letter-spacing:.04em}
.name{font-family:var(--display);font-weight:700;font-size:1.05rem}
.slice-body{margin:.35rem 0 0;font-size:.97rem;color:var(--ink)}
ol.nums li{display:grid;grid-template-columns:1.3rem auto 1fr;gap:.6rem;align-items:baseline;background:var(--surface);border:1px solid var(--line);padding:.6rem .9rem}
.n{font-family:var(--mono);font-size:.8rem;color:var(--muted)}
.chip{font-family:var(--mono);font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;padding:.15em .5em;border-radius:2px;white-space:nowrap}
.chip-done{background:var(--good-bg);color:var(--good)} .chip-in-progress{background:var(--warn-bg);color:var(--warn)} .chip-next{background:var(--code-bg);color:var(--muted)}
ul.plain li{padding:.35rem 0 .35rem 1rem;border-left:2px solid var(--line);font-size:.97rem}
footer{margin-top:3rem;font-family:var(--mono);font-size:.75rem;color:var(--muted)}
</style>
<main>
  <div class="eyebrow">Agent OS &middot; ${esc(branch || "unknown branch")}</div>
  <h1>${esc(title)}</h1>
  <div class="state">
    <div><span class="k">HEAD</span><span class="v">${esc(head || "unknown")}</span></div>
    <div><span class="k">package.json</span><span class="v">${esc(pkgVersion ? "v" + pkgVersion : "unknown")}</span></div>
    <div class="${buildStale === null ? "" : buildStale ? "stale" : "current"}"><span class="k">Running build</span><span class="v">${buildStamp ? (buildStale ? "older than HEAD" : "current") : "unknown"}</span></div>
    <div><span class="k">Open slices</span><span class="v">${Object.values(counts).reduce((a, b) => a + b, 0)}</span></div>
  </div>
  <p class="eyebrow">${esc(buildLine)}</p>
  <div class="intro">${renderBlocks(intro)}</div>
  ${sections.map((s) => `<section>
    <h2>${esc(s.name)}${counts[s.name] ? `<span class="count">${counts[s.name]} open</span>` : s.name === "Done" ? `<span class="count">${doneCount}</span>` : ""}</h2>
    ${renderBlocks(s.blocks)}
  </section>`).join("\n")}
  <footer>Rendered ${fmt(new Date())} from ROADMAP.md by scripts/roadmap-page.mjs</footer>
</main>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${html.length} bytes, ${sections.length} sections)`);
