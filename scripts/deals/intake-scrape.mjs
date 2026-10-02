// intake-scrape.mjs - visit pasted Upwork job URLs and hand back scraper-shaped
// records (roadmap S4 a).
//
//   node scripts/deals/intake-scrape.mjs <targets.json> <out.json>
//
// targets.json = [{ id, url }]; out.json = [{ id, url, page: { title, url, text },
// record | null, error? }]. `page` is what the caller runs detectLoginWall over;
// this script does NOT decide about walls, it reports what it saw. `record` is
// mergeRecord() from the owner's actor (Upwork-Leads/actor/src/parse.js), so the
// row is the same shape score_board.mjs and pitch.mjs already read.
//
// Env: UPWORK_ACTOR_DIR (required: where parse.js lives), UPWORK_COOKIE
// (optional: a logged-in session unlocks proposals), INTAKE_HEADLESS=1.
// Playwright resolves from THIS repo's node_modules; Chrome is the owner's real
// installed Chrome, the same channel the actor uses, because Cloudflare trusts it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const TARGETS_FILE = process.argv[2];
const OUT_FILE = process.argv[3];
const ACTOR_DIR = process.env.UPWORK_ACTOR_DIR || "";
const COOKIE = process.env.UPWORK_COOKIE || "";

if (!TARGETS_FILE || !OUT_FILE) { console.error("usage: intake-scrape.mjs <targets.json> <out.json>"); process.exit(2); }
if (!ACTOR_DIR || !fs.existsSync(path.join(ACTOR_DIR, "src", "parse.js"))) {
  console.error(`UPWORK_ACTOR_DIR must point at the actor (no src/parse.js under "${ACTOR_DIR}")`);
  process.exit(2);
}

const { parseDetailPage, mergeRecord, parseCookieHeader } = await import(pathToFileURL(path.join(ACTOR_DIR, "src", "parse.js")).href);
const targets = JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

const browser = await chromium.launch({
  channel: "chrome",
  headless: process.env.INTAKE_HEADLESS === "1",
  args: ["--disable-blink-features=AutomationControlled"],
});
const ctx = await browser.newContext();
if (COOKIE) { try { await ctx.addCookies(parseCookieHeader(COOKIE)); } catch (e) { console.error("BAD_COOKIE", e.message); } }
const page = await ctx.newPage();

try {
  for (const t of targets) {
    try {
      await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector('script[type="application/ld+json"], h1', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(rnd(2500, 5000)); // let Cloudflare clear and the SPA render
      const seen = await page.evaluate(() => ({
        title: document.title,
        h1: (document.querySelector("h1")?.innerText || "").trim(),
        url: location.href,
        text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 6000),
      }));
      const detail = await parseDetailPage(page);
      const tile = { uid: t.id, subId: `~02${t.id}`, title: seen.h1 || null, href: t.url, posted: null, tags: [] };
      const record = mergeRecord(tile, detail, "intake", new Date().toISOString());
      results.push({ id: t.id, url: t.url, page: { title: seen.title, url: seen.url, text: seen.text }, record });
      console.error("ok", t.id, seen.h1 || seen.title);
    } catch (e) {
      results.push({ id: t.id, url: t.url, page: null, record: null, error: e.message });
      console.error("fail", t.id, e.message);
    }
    await sleep(rnd(1500, 4000));
  }
} finally {
  await browser.close();
}
fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ done: true, count: results.length }));
