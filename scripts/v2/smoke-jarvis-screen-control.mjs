// Offline browser + protocol checks. No app server, real credentials, or model calls.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Redirect every credential/config directory before importing the tool layer.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-screen-smoke-"));
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
import { build } from "esbuild";
import { chromium } from "playwright";
import { requestUi, resolveUi } from "../../src/lib/v2/jarvis/uiRequests.ts";
import { safeAppRoute } from "../../src/lib/v2/jarvis/uiProtocol.ts";
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log(`PASS ${label}`); };
for (const route of ["//evil.test", "/\\evil", "/api/settings", "/login", "https://evil.test", "/%2fexample.com"])
  check(!safeAppRoute(route), `reject route ${route}`);
check(safeAppRoute("/deals") && safeAppRoute("/hire?filter=new"), "internal routes accepted");
let event;
const pending = requestUi({ action: "inspect" }, e => { event = e; });
check(!resolveUi(event.id, "wrong", { ok: true }), "wrong token rejected");
check(resolveUi(event.id, event.token, { ok: true, text: "observed" }), "one-use acknowledgement accepted");
check((await pending).text === "observed", "browser result returned to caller");
check(!resolveUi(event.id, event.token, { ok: true }), "replay rejected");
check(!(await requestUi({ action: "click" }, () => {}, undefined, 10)).ok, "missing tab times out");
const abort = new AbortController();
const cancelled = requestUi({ action: "inspect" }, () => {}, abort.signal);
abort.abort(); check(!(await cancelled).ok, "cancel clears request");
// Real Deal Desk store: failed writes must not paint successful status/content.
const { useDesk } = await import("../../src/lib/upworkDeskStore.ts");
const originalFetch = globalThis.fetch;
try {
 useDesk.setState({ deals: [{ id: "test", status: "new", notes: "original", pitch: "original" }], error: null });
 globalThis.fetch = async () => Response.json({ ok: false, error: "fixture save rejected" }, { status: 500 });
 await useDesk.getState().move("test", "approved");
 check(useDesk.getState().deals[0].status === "new" && useDesk.getState().error.includes("rejected"), "failed status write never paints approval");
 await useDesk.getState().saveNotes("test", "modified");
 check(useDesk.getState().deals[0].notes === "original", "failed notes save preserves acknowledged value");
 await useDesk.getState().savePitch("test", "modified");
 check(useDesk.getState().deals[0].pitch === "original", "failed proposal save preserves acknowledged value");
 globalThis.fetch = async () => Response.json({ ok: true });
 await useDesk.getState().move("test", "approved");
 await useDesk.getState().saveNotes("test", "augmented");
 check(useDesk.getState().deals[0].status === "approved" && useDesk.getState().deals[0].notes === "augmented", "successful writes update acknowledged values");
} finally { globalThis.fetch = originalFetch; }
// Run the actual MCP handler against a deterministic browser callback.
const { buildJarvisToolHandlers, newTurnState } = await import("../../src/lib/v2/jarvis/tools.ts");
const state = newTurnState();
const handlers = buildJarvisToolHandlers({ state, emit: () => {} });
check((await handlers.ui_control.run({ action: "inspect" })).isError, "non-browser callers fail explicitly");
let uiCalls = 0;
state.uiRequest = async command => { uiCalls++; return { ok: true, action: command.action, text: "browser evidence" }; };
check((await handlers.ui_control.run({ action: "inspect" })).content[0].text.includes("browser evidence"), "MCP tool returns browser acknowledgement to model");
await handlers.navigate.run({ route: "/hire" });
check(uiCalls === 2, "legacy navigation uses acknowledged browser bridge");
state.integrationTainted = true;
check((await handlers.ui_control.run({ action: "click", target: "x" })).isError && uiCalls === 2, "integration taint cannot bypass action gate through UI");
check(!(await handlers.ui_control.run({ action: "inspect" })).isError, "inspection remains usable under taint");
const bundle = await build({ stdin: { contents: `
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {inspectUi, executeUi} from "./src/lib/v2/jarvis/uiClient";
import {useReadAloud} from "./src/lib/v2/jarvis/useReadAloud";
window.inspect = inspectUi;
window.execute = c => executeUi(c, route => history.pushState({}, "", route));
window.saved = "";
function Fixture() {
 const speech = useReadAloud("voicebox");
 window.readAloud = speech.read; window.stopReading = speech.stop;
 window.speechError = speech.error;

 const [notes, setNotes] = useState("Original notes");
 const [saved, setSaved] = useState("Original notes");
 const [status, setStatus] = useState("new");
 const [open, setOpen] = useState(false);
 const [question, setQuestion] = useState("");
 const [answer, setAnswer] = useState("");
 return <main><button onClick={()=>setOpen(true)}>Open First listing</button>
 {open && <section role="dialog" aria-label="First listing" data-jarvis-record="deal-1">
 <h2>First listing</h2><p>Debrief and scraped source description</p>
 <select aria-label="Listing status" value={status} onChange={e=>setStatus(e.target.value)}>
 {['new','approved','denied','dismissed'].map(s=><option key={s} value={s}>{s}</option>)}</select>
 <textarea aria-label="Listing notes" data-jarvis-saved-value={saved} value={notes} onChange={e=>setNotes(e.target.value)} onBlur={()=>{ window.saved=notes; setSaved(notes); }}/>
 <input aria-label="Question about this listing" value={question} onChange={e=>setQuestion(e.target.value)}/>
 <button onClick={()=>setAnswer('Answer to '+question)}>Ask</button><p>{answer}</p>
 <button disabled>Disabled action</button>
 <input type="password" value="secret-password" readOnly/>
 <textarea aria-label="API token" defaultValue="secret-token"/>
 <div data-jarvis-private>secret-section</div><div hidden>hidden-secret</div>
 <div data-jarvis-chrome>Assistant transcript should not be read</div>
 <a href="https://outside.test">External</a>
 <button onClick={()=>setOpen(false)}>Close listing</button>
 </section>}</main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser" });
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage();
 await page.route("**/*", route => {
   if (route.request().url() === "http://fixture.test/deals") return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' });
   return route.abort();
 });
 await page.goto("http://fixture.test/deals");
 await page.addScriptTag({ content: bundle.outputFiles[0].text });
 await page.getByText("Open First listing").waitFor();
 const inspect = () => page.evaluate(() => window.inspect());
 const act = command => page.evaluate(c => window.execute(c), command);
 let snap = await inspect();
 const control = label => { const c = snap.controls.find(c => c.name === label); assert.ok(c, `control ${label}`); return c.id; };
 snap = await act({ action: "click", target: control("Open First listing") });
 check(snap.text.includes("Debrief and scraped source description"), "open card reads listing source");
 check(!JSON.stringify(snap).includes("secret-") && !JSON.stringify(snap).includes("hidden-secret") && !snap.text.includes("Assistant transcript"), "private/hidden/assistant content excluded");
 const old = control("Listing notes");
 snap = await act({ action: "fill", target: old, value: "Original notes plus user augmentation" });
 check(snap.controls.some(c=>c.name === "Listing notes" && c.saved === true), "saved field exposes acknowledged value match");
 check(await page.evaluate(() => window.saved === "Original notes plus user augmentation"), "React controlled textarea commits augmented value on blur");
 check(!(await act({ action: "fill", target: old, value: "replay" })).ok, "stale write rejected");
 snap = await inspect();
 snap = await act({ action: "select", target: control("Listing status"), value: "approved" });
 check(snap.controls.some(c=>c.name === "Listing status" && c.value === "approved"), "approve selected listing");
 snap = await act({ action: "select", target: control("Listing status"), value: "denied" });
 check(snap.controls.some(c=>c.value === "denied"), "deny selected deal");
 snap = await act({ action: "select", target: control("Listing status"), value: "dismissed" });
 check(snap.controls.some(c=>c.value === "dismissed"), "Hire dismissal option");
 snap = await act({ action: "fill", target: control("Question about this listing"), value: "What is the scope?" });
 snap = await act({ action: "click", target: control("Ask") });
 check(snap.text.includes("Answer to What is the scope?"), "per-listing Q&A round trip");
 check(!(await act({ action: "click", target: control("Disabled action") })).ok, "disabled actions rejected");
 check(!(await act({ action: "click", target: control("External") })).ok, "external navigation rejected");
 const changed = control("Listing notes");
 await page.getByLabel("Listing notes").fill("User changed this since inspection");
 check(!(await act({ action: "fill", target: changed, value: "overwrite" })).ok, "concurrent user edit invalidates target");
 snap = await inspect();
 const moved = control("Listing notes");
 await act({ action: "navigate", route: "/hire" });
 check(!(await act({ action: "click", target: moved })).ok, "navigation invalidates controls");
 await page.evaluate(() => { document.querySelector('[role=dialog]').insertAdjacentHTML('beforeend', '<p>'+ 'long source '.repeat(2000) +'</p>'); });
 snap = await inspect();
 check(snap.nextOffset === 12000, "long page advertises continuation");
 const next = await act({ action: "inspect", offset: snap.nextOffset });
 check(next.text.length > 0 && next.offset === 12000, "long listing continuation readable");
 const longValue = 'preserve '.repeat(1000);
 snap = await inspect();
 snap = await act({ action: "fill", target: control("Listing notes"), value: longValue });
 const full = await act({ action: "inspect", target: control("Listing notes") });
 check(full.text === longValue, "full field read preserves text beyond preview");
 // Speech uses a deterministic audio/fetch seam, never a real TTS server.
 await page.evaluate(() => {
  window.ttsChunks = [];
  window.Audio = class {
   play() { setTimeout(()=>this.onended?.(), 1); return Promise.resolve(); }
   pause() {}
  };
  window.fetch = async (_url, init) => {
   const body = JSON.parse(init.body);
   window.ttsChunks.push(body);
   return { ok: true, json: async () => ({ audio: "fixture-audio" }) };
  };
 });
 const spoken = "Read the full listing and the answers. ".repeat(60);
 await page.evaluate(text => window.readAloud(text), spoken);
 const chunks = await page.evaluate(() => window.ttsChunks);
 check(chunks.map(c=>c.text).join("") === spoken && chunks.every(c=>c.provider === "voicebox"), "speech preserves every character and selected provider");
 await page.evaluate(async () => {
  window.fetch = async () => ({ ok: false, json: async () => ({ error: "Voicebox offline fixture" }) });
  await window.readAloud("Speak this");
 });
 await page.waitForTimeout(30);
 check((await page.evaluate(() => window.speechError)).includes("Voicebox offline"), "speech provider failures surface without fallback");
 console.log(`${checks} checks passed; offline browser fixture, speech seam and protocol only.`);
} finally { await browser.close(); }
