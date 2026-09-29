// /api/settings key-material smoke, offline.
//   A. GET masks every secret: first 5 characters + "********" for long secrets,
//      "********" for short ones, "" stays ""; no fake key material anywhere in the body
//   B. PATCH: a masked value leaves the stored key untouched, a new value replaces it,
//      "" clears it, and the reply is masked too
//   C. reveal route: refuses the MCP header and a bearer, answers a plain (cookie-gated)
//      request, 404 when no secret exists; the value never lands in the log line
//   D. wiring: the Memory gear copies through the reveal route; Leads and Music key
//      fields know a mask from a typed key; proxy lets the MCP header through /api/mcp only
// The settings file is a temp file with fake secrets. Run: npx tsx scripts/v2/smoke-settings-secrets.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-settings-secrets-"));
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
const FAKE = {
  mcp: "amcp_FAKE_MCP_SECRET_0123456789abcdef",
  tavily: "tvly-FAKE_TAVILY_KEY_0123456789",
  apify: "apify_FAKE_TOKEN_0123456789",
  cookie: "sid=FAKE_SUNO_COOKIE_0123456789",
  short: "shortkey",
};
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({
  mcp: { secret: FAKE.mcp },
  leads: { tavilyKey: FAKE.tavily, apifyToken: FAKE.apify, perplexityKey: "", apifyActor: "some/actor" },
  music: { sunoCookie: FAKE.cookie, sunoApiKey: FAKE.short },
  jarvis: { hotkey: { key: "F13" } },
}), "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 260)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");
const stored = () => JSON.parse(read(process.env.AGENTIC_OS_SETTINGS));
// Everything past the 5-character preview is key material that must never appear; a
// short secret has no preview, so the whole value is checked.
const TAILS = Object.values(FAKE).map((v) => (v.length >= 16 ? v.slice(5) : v));
const leaks = (s) => TAILS.filter((t) => s.includes(t));

const red = await import("../../src/lib/settingsRedact.ts");
const route = await import("../../src/app/api/settings/route.ts");
const P = red.SECRET_PLACEHOLDER;

// ── A. GET ────────────────────────────────────────────────────────────────────
let res = await route.GET();
let text = await res.text();
let j = JSON.parse(text);
check("A1 GET 200, no-store", res.status === 200 && res.headers.get("cache-control") === "no-store");
check("A2 no key material anywhere in the GET body", leaks(text).length === 0, leaks(text));
check("A3 long secret shows its first 5 characters", j.settings.mcp.secret === "amcp_" + P && j.settings.leads.tavilyKey === "tvly-" + P, [j.settings.mcp.secret, j.settings.leads.tavilyKey]);
check("A4 short secret is the bare mask", j.settings.music.sunoApiKey === P);
check("A5 unset secret stays empty", j.settings.leads.perplexityKey === "");
check("A6 non-secret fields untouched", j.settings.leads.apifyActor === "some/actor" && j.settings.jarvis.hotkey.key === "F13");

// ── B. PATCH ──────────────────────────────────────────────────────────────────
const patch = (body) => route.PATCH(new Request("http://x/api/settings", { method: "PATCH", body: JSON.stringify(body) }));
res = await patch({ leads: { tavilyKey: j.settings.leads.tavilyKey, apifyToken: j.settings.leads.apifyToken, apifyActor: "other/actor" }, music: { sunoApiKey: P } });
text = await res.text();
check("B1 round-trip save of masked values keeps every stored key", stored().leads.tavilyKey === FAKE.tavily && stored().leads.apifyToken === FAKE.apify && stored().music.sunoApiKey === FAKE.short, stored());
check("B2 the non-secret field in the same save did change", stored().leads.apifyActor === "other/actor");
check("B3 PATCH reply is masked", leaks(text).length === 0 && JSON.parse(text).settings.leads.tavilyKey === "tvly-" + P);
await patch({ leads: { tavilyKey: "tvly-NEW_KEY_TYPED_BY_OWNER_99" } });
check("B4 a newly typed key replaces the stored one", stored().leads.tavilyKey === "tvly-NEW_KEY_TYPED_BY_OWNER_99");
await patch({ leads: { apifyToken: "" } });
check("B5 an empty value clears the key", stored().leads.apifyToken === "");
check("B6 a long value ending in the mask is a typed key, not a mask", !red.isMaskedSecret("abcdefghij" + P) && red.isMaskedSecret("tvly-" + P) && red.isMaskedSecret(P) && !red.isMaskedSecret("tvly-abc"));

// ── C. reveal route ───────────────────────────────────────────────────────────
const reveal = await import("../../src/app/api/v2/memory/mcp-secret/reveal/route.ts");
const logs = [];
const origInfo = console.info, origWarn = console.warn;
console.info = (...a) => logs.push(a.join(" "));
console.warn = (...a) => logs.push(a.join(" "));
const post = (headers = {}) => reveal.POST(new Request("http://x/api/v2/memory/mcp-secret/reveal", { method: "POST", headers }));
const refusedMcp = await post({ "x-agentos-mcp-secret": FAKE.mcp });
const refusedBearer = await post({ authorization: "Bearer anything" });
const ok = await post();
const okBody = await ok.json();
console.info = origInfo; console.warn = origWarn;
check("C1 the MCP header is refused (403)", refusedMcp.status === 403);
check("C2 a bearer is refused (403)", refusedBearer.status === 403);
check("C3 a plain session request gets the whole secret", ok.status === 200 && okBody.secret === FAKE.mcp && ok.headers.get("cache-control") === "no-store");
check("C4 every reveal and refusal is logged, never the value", logs.length === 3 && leaks(logs.join("\n")).length === 0, logs);
check("C5 reveal only takes POST", !("GET" in reveal));
const s = stored(); s.mcp = {}; fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify(s), "utf8");
console.info = () => {};
const none = await post();
console.info = origInfo;
check("C6 no secret yet -> 404", none.status === 404);

// ── D. wiring ─────────────────────────────────────────────────────────────────
const mem = read("src/components/v2/memory/MemorySettings.tsx");
check("D1 Memory gear copies through the reveal route", mem.includes('fetch("/api/v2/memory/mcp-secret/reveal", { method: "POST"'));
check("D2 Memory gear no longer reads the secret from /api/settings", !/settings\?\.mcp\?\.secret/.test(mem));
for (const [f, n] of [["src/components/LeadsSettings.tsx", 4], ["src/components/MusicSettings.tsx", 2]]) {
  const src = read(f);
  check(`D3 ${path.basename(f)}: ${n} key fields show the mask as text, a typed key as password`, (src.match(/type=\{isMaskedSecret\(\w+\) \? "text" : "password"\}/g) || []).length === n);
}
const proxy = read("src/proxy.ts");
check("D4 proxy lets the MCP header through /api/mcp only", /pathname\.startsWith\("\/api\/mcp"\) && request\.headers\.has\("x-agentos-mcp-secret"\)/.test(proxy) && !"/api/v2/memory/mcp-secret/reveal".startsWith("/api/mcp"));
const settingsRoute = read("src/app/api/settings/route.ts");
check("D5 /api/settings masks both replies and strips masks from saves", (settingsRoute.match(/redactSettings\(/g) || []).length === 2 && settingsRoute.includes("writeSettings(stripPlaceholders(patch))"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
