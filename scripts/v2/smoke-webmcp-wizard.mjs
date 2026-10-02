// S7 smoke: the WebMCP wizard (describe -> clarify/propose -> approve -> emit) with a
// MOCKED model (the `cli` seam) — never a real, billed CLI agent, never the network.
//   - temp DB / settings / webmcp dir (rule 19: never the live config)
//   - digest: questions + proposal land, persisted (a fresh read sees them)
//   - emit is refused before approval (409, zero model calls)
//   - approve (edited list), emit -> validated spec (5-10 tools, personas, no js),
//     apply -> a draft package + tool set in the store
//   - a bad emitted spec (12 tools / js code / two-job name) -> 422 with concrete
//     problems, draft stays approved; a drifted list -> 422
//   - proofread: bad JSON / invalid spec -> concrete problems with NO model call;
//     'looks good' only when the schema passes and the model found nothing
//   - fallback is labelled (provider / fellBackFrom / fallbackReason); "none" fails loudly
//   - file-level: migration 044, gear fields, docs rows, routes, WizardPanel mounted
// Run: npx tsx scripts/v2/smoke-webmcp-wizard.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const stamp = Date.now();
process.env.AGENTIC_OS_DB = path.join(os.tmpdir(), `agentos-smoke-wizard-${stamp}.db`);
process.env.AGENTIC_OS_SETTINGS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agentos-wizard-set-")), "settings.json");
process.env.AGENTIC_OS_WEBMCP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-wizard-wm-"));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));

const W = await import("../../src/lib/v2/webmcp/wizard.ts");
const store = await import("../../src/lib/v2/webmcp/store.ts");
const { NextRequest } = await import("next/server");
const listRoute = await import("../../src/app/api/v2/webmcp/wizard/route.ts");
const idRoute = await import("../../src/app/api/v2/webmcp/wizard/[id]/route.ts");
const emitRoute = await import("../../src/app/api/v2/webmcp/wizard/[id]/emit/route.ts");

const ctx = (id) => ({ params: Promise.resolve({ id }) });
const req = (url, method, body) =>
  new NextRequest(`http://127.0.0.1${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const json = async (res) => ({ status: res.status, json: await res.json() });

// ── the mocked model ─────────────────────────────────────────────────────────
const TOOLS = [
  { name: "list_invoices", purpose: "Lists open invoices for a customer.", persona: "bookkeeper", inputs: [{ name: "customer_id", type: "string", description: "Customer id", required: true }] },
  { name: "get_invoice", purpose: "Returns one invoice by id.", persona: "bookkeeper", inputs: [{ name: "invoice_id", type: "string", description: "Invoice id", required: true }] },
  { name: "send_reminder", purpose: "Emails a payment reminder for an invoice.", persona: "bookkeeper", inputs: [{ name: "invoice_id", type: "string", description: "Invoice id", required: true }], requiresApproval: true },
  { name: "list_customers", purpose: "Lists customers matching a search term.", persona: "sales", inputs: [{ name: "query", type: "string", description: "Search term", required: false }] },
  { name: "create_quote", purpose: "Drafts a quote for a customer.", persona: "sales", inputs: [{ name: "customer_id", type: "string", description: "Customer id", required: true }, { name: "lines", type: "array", description: "Line items", required: true }] },
  { name: "cash_summary", purpose: "Summarises cash in and out for a period.", persona: "owner", inputs: [{ name: "period", type: "string", description: "e.g. 2026-09", required: true }] },
];
const PROPOSAL = { scratchpad: "Three personas: bookkeeper, sales, owner. Six jobs; dropped 'export_pdf' (nobody asked).", questions: ["Which accounting system holds the invoices?", "Should reminders go out without a human check?"], serverName: "Invoice Desk", slug: "invoice-desk", summary: "Invoices, quotes and cash for a small shop.", tools: TOOLS };

const calls = [];
function mockCli(script) {
  // script(agent, kind) -> reply string | throws; kind is digest | emit | proofread
  return async (agent, prompt, opts) => {
    const kind = prompt.startsWith("You are designing") ? "digest" : prompt.startsWith("The user APPROVED") ? "emit" : prompt.startsWith("Proofread") ? "proofread" : "unknown";
    calls.push({ agent, kind, module: opts.module, prompt });
    return script(agent, kind, prompt);
  };
}
const good = mockCli((agent, kind, prompt) => {
  if (kind === "digest") return "Here you go:\n```json\n" + JSON.stringify(PROPOSAL) + "\n```";
  if (kind === "emit") {
    const p = JSON.parse(prompt.slice(prompt.indexOf("Approved proposal:\n") + 19, prompt.indexOf("\n\nTarget shape")));
    const spec = W.proposalToSpecSkeleton(p);
    spec.tools = spec.tools.map((t) => ({ ...t, handlerKind: "http", handlerConfig: { method: "GET", url: `https://books.example/api/${t.name}` } }));
    return JSON.stringify(spec);
  }
  if (kind === "proofread") return '{"problems":[],"notes":["consider a date filter on list_invoices"]}';
  throw new Error("unexpected prompt kind " + kind);
});
const agents = { agent: "claude", fallback: "codex" };

// ── A. gear defaults ─────────────────────────────────────────────────────────
check("wizardAgents defaults: claude, fallback codex (rule 20)", W.wizardAgents(undefined).agent === "claude" && W.wizardAgents(undefined).fallback === "codex");
check("wizardAgents honours the gear", W.wizardAgents({ wizardAgent: "Hermes ", wizardFallback: "none" }).agent === "hermes" && W.wizardAgents({ wizardAgent: "Hermes ", wizardFallback: "none" }).fallback === "none");
check("WIZARD_AGENTS excludes antigravity (prints nothing to a pipe)", !W.WIZARD_AGENTS.includes("antigravity") && W.WIZARD_AGENTS.includes("claude") && W.WIZARD_AGENTS.includes("codex"));

// ── B. describe -> digest ────────────────────────────────────────────────────
const created = await json(await listRoute.POST(req("/api/v2/webmcp/wizard", "POST", { mode: "wizard", description: "A server for my shop's invoices, quotes and cash position.\nBookkeeper and sales use it." })));
check("POST wizard -> 201 draft at step describe", created.status === 201 && created.json.draft?.step === "describe" && created.json.draft.mode === "wizard", created);
const id = created.json.draft.id;
check("title is the first line of the description", created.json.draft.title.startsWith("A server for my shop"));

let d = await W.digestDraft(id, { cli: good, agents });
check("digest -> step clarify with 2 questions + 6-tool proposal", d.step === "clarify" && d.questions.length === 2 && d.proposal?.tools.length === 6, { step: d.step, q: d.questions.length });
check("digest reply labels the provider (claude, no fallback)", d.lastModel?.provider === "claude" && !d.lastModel.fellBackFrom);
check("digest prompt asks for a scratchpad and NO code", calls[0].kind === "digest" && /scratchpad/.test(calls[0].prompt) && /NO code/.test(calls[0].prompt));
check("the model runs with module 'webmcp' (skills wiring)", calls[0].module === "webmcp");
check("the proposal keeps the scratchpad and personas", /Three personas/.test(d.proposal.scratchpad) && d.proposal.tools.every((t) => t.persona));
check("digest wrote NO spec (never JSON before approval)", d.spec === null);
const fresh = W.getDraft(id);
check("persisted: a fresh read carries questions + proposal", fresh.questions.length === 2 && fresh.proposal?.tools.length === 6 && fresh.description.includes("invoices"));
check("GET /wizard lists the draft", (await json(await listRoute.GET())).json.drafts.some((x) => x.id === id));

// ── C. emit before approval is refused, with zero model calls ───────────────
const before = calls.length;
const early = await json(await emitRoute.POST(req(`/api/v2/webmcp/wizard/${id}/emit`, "POST"), ctx(id)));
check("emit before approval -> 409", early.status === 409 && /approve/i.test(early.json.error), early);
check("...and the model was not called", calls.length === before);

// ── D. answers survive a re-digest ──────────────────────────────────────────
const qid = d.questions[0].id;
const patched = await json(await idRoute.PATCH(req(`/api/v2/webmcp/wizard/${id}`, "PATCH", { answers: { [qid]: "QuickBooks" } }), ctx(id)));
check("PATCH answers -> stored on the question", patched.status === 200 && patched.json.draft.questions[0].answer === "QuickBooks", patched);
d = await W.digestDraft(id, { cli: good, agents });
check("re-digest keeps the typed answer for the same question", d.questions[0].answer === "QuickBooks");
check("re-digest prompt carried the answer", /A: QuickBooks/.test(calls[calls.length - 1].prompt));

// ── E. approve (edited list) ────────────────────────────────────────────────
const edited = { ...d.proposal, tools: d.proposal.tools.map((t) => (t.name === "cash_summary" ? { ...t, name: "cash_position" } : t)) };
const approved = await json(await idRoute.PATCH(req(`/api/v2/webmcp/wizard/${id}`, "PATCH", { action: "approve", proposal: edited }), ctx(id)));
check("approve with an edited list -> step approved, edit kept", approved.status === 200 && approved.json.draft.step === "approved" && approved.json.draft.proposal.tools.some((t) => t.name === "cash_position"), approved);
const tooFew = await json(await idRoute.PATCH(req(`/api/v2/webmcp/wizard/${id}`, "PATCH", { action: "approve", proposal: { ...edited, tools: edited.tools.slice(0, 4) } }), ctx(id)));
check("approve with 4 tools -> 400 (5-10 rule)", tooFew.status === 400 && /5-10/.test(tooFew.json.error), tooFew);
const badName = W.validateProposal({ ...edited, tools: [...edited.tools.slice(0, 5), { name: "fetch_and_send", purpose: "x", persona: "p", inputs: [] }] });
check("validateProposal flags a two-job name", !badName.ok && badName.problems.some((p) => /chains two jobs/.test(p)), badName.problems);

// ── F. emit after approval -> validated spec -> apply ───────────────────────
d = await W.emitDraft(id, { cli: good, agents });
check("emit -> step emitted with a spec", d.step === "emitted" && d.spec && d.spec.tools.length === 6, { step: d.step });
const v = W.validateWizardSpec(d.spec);
check("emitted spec passes validateWizardSpec", v.ok, v.problems);
check("emitted spec: every tool has a persona and no js", d.spec.tools.every((t) => t.persona && t.handlerKind !== "js"));
check("emitted spec: strict spec_json shape", d.spec.spec.authKind === "none" && d.spec.spec.mcpType === "stdio");
check("emit prompt is the approved list, no code requested", /APPROVED/.test(calls[calls.length - 1].prompt) && /write NO code/.test(calls[calls.length - 1].prompt));
const applied = W.applyDraft(id);
check("apply -> package created with the emitted tools", applied.slug === "invoice-desk" && store.listTools(store.getPackage("invoice-desk").id).length === 6);
check("apply -> spec_json saved on the package", store.getPackage("invoice-desk").spec?.authKind === "none");
check("apply -> approval flag + persona carried into the tool rows", (() => { const t = store.getTool(store.getPackage("invoice-desk").id, "send_reminder"); return t.requiresApproval && /\[bookkeeper\]/.test(t.description); })());
check("apply twice -> 409 slug taken", (() => { try { W.applyDraft(id); return false; } catch (e) { return e.status === 409; } })());

// ── G. a bad emitted spec is refused with concrete problems ─────────────────
const bad = mockCli((agent, kind, prompt) => {
  const p = JSON.parse(prompt.slice(prompt.indexOf("Approved proposal:\n") + 19, prompt.indexOf("\n\nTarget shape")));
  const spec = W.proposalToSpecSkeleton(p);
  spec.tools = [...spec.tools, ...Array.from({ length: 6 }, (_, i) => ({ ...spec.tools[0], name: `extra_${i}` }))];
  spec.tools[0] = { ...spec.tools[0], name: "fetch_and_send", handlerKind: "js", handlerConfig: { code: "return 1" } };
  return JSON.stringify(spec);
});
const d2 = W.createDraft({ mode: "wizard", description: "same shop" });
await W.digestDraft(d2.id, { cli: good, agents });
W.approveDraft(d2.id);
let err = null;
try { await W.emitDraft(d2.id, { cli: bad, agents }); } catch (e) { err = e; }
check("bad emitted spec -> 422", err?.status === 422, err?.message);
const after = W.getDraft(d2.id);
check("...problems name the 12-tool count, the js code and the two-job name", after.emitProblems.some((p) => /12 tools/.test(p)) && after.emitProblems.some((p) => /'js' carries code/.test(p)) && after.emitProblems.some((p) => /chains two jobs/.test(p)), after.emitProblems);
check("...draft stays approved with no spec (retry or edit the list)", after.step === "approved" && after.spec === null);
const drift = mockCli((agent, kind, prompt) => {
  const p = JSON.parse(prompt.slice(prompt.indexOf("Approved proposal:\n") + 19, prompt.indexOf("\n\nTarget shape")));
  const spec = W.proposalToSpecSkeleton(p);
  spec.tools = [...spec.tools.slice(1), { ...spec.tools[0], name: "surprise_tool" }];
  return JSON.stringify(spec);
});
err = null;
try { await W.emitDraft(d2.id, { cli: drift, agents }); } catch (e) { err = e; }
check("a spec that drops/adds tools vs the approved list -> 422 drift", err?.status === 422 && /missing from the emitted spec/.test(err.message) && /not in the approved list/.test(err.message), err?.message);

// ── H. proofread (write-my-own) ─────────────────────────────────────────────
const own = W.createDraft({ mode: "own" });
check("own-mode draft title", own.mode === "own" && own.title === "Write my own JSON");
let n = calls.length;
let pr = await W.proofreadDraft(own.id, "{ not json", { cli: good, agents });
check("proofread bad JSON -> problems, no model call", pr.proofread.verdict === "problems" && /not valid JSON/.test(pr.proofread.problems[0]) && calls.length === n, pr.proofread);
const invalidSpec = { package: { slug: "Bad Slug", name: "" }, spec: { authKind: "none", extra: 1 }, tools: [{ name: "a", description: "", inputSchema: { type: "string" } }, { name: "a", description: "x and then y", inputSchema: {}, handlerKind: "js" }, { name: "b", description: "ok", inputSchema: { type: "object", properties: {}, required: ["z"] } }] };
pr = await W.proofreadDraft(own.id, JSON.stringify(invalidSpec), { cli: good, agents });
const P = pr.proofread.problems;
check("proofread invalid spec -> verdict problems, no model call", pr.proofread.verdict === "problems" && calls.length === n);
check("...names the slug, the name, the unknown spec key, the tool count", P.some((p) => /package\.slug/.test(p)) && P.some((p) => /package\.name/.test(p)) && P.some((p) => /spec\.extra/.test(p)) && P.some((p) => /3 tools: a server carries 5-10/.test(p)), P);
check("...names the duplicate, the missing persona, the js code, the two-job description, the bad required field", P.some((p) => /appears twice/.test(p)) && P.some((p) => /persona is required/.test(p)) && P.some((p) => /'js' carries code/.test(p)) && P.some((p) => /lists a second job/.test(p)) && P.some((p) => /required field 'z'/.test(p)), P);
check("proofread result persisted on the own draft", W.getDraft(own.id).proofread?.problems.length === P.length && W.getDraft(own.id).ownSpecText.includes("Bad Slug"));
const goodSpec = JSON.stringify(d.spec);
pr = await W.proofreadDraft(own.id, goodSpec, { cli: good, agents });
check("proofread valid spec + clean model review -> 'looks good' with the note", pr.proofread.verdict === "looks good" && pr.proofread.problems.length === 0 && pr.proofread.notes.length === 1 && pr.proofread.model?.provider === "claude", pr.proofread);
check("...the model was asked (schema passed) with a no-code brief", calls[calls.length - 1].kind === "proofread" && /write no code/.test(calls[calls.length - 1].prompt));
const picky = mockCli(() => '{"problems":["send_reminder and create_quote both need an approval gate"],"notes":[]}');
pr = await W.proofreadDraft(own.id, goodSpec, { cli: picky, agents });
check("proofread valid spec + model problems -> verdict problems (never 'looks good')", pr.proofread.verdict === "problems" && pr.proofread.problems.length === 1);
const appliedOwn = W.applyDraft(own.id, { slug: "invoice-desk-own" });
check("own-mode apply -> package from the pasted spec", appliedOwn.slug === "invoice-desk-own" && store.listTools(store.getPackage("invoice-desk-own").id).length === 6);
check("PATCH ownSpecText clears the stale proofread", (() => { const x = W.updateDraft(own.id, { ownSpecText: "{}" }); return x.proofread === null && x.ownSpecText === "{}"; })());

// ── I. fallback is the owner's choice and is labelled ───────────────────────
const flaky = mockCli((agent) => { if (agent === "claude") throw new Error("claude: rate limited"); return "```json\n" + JSON.stringify(PROPOSAL) + "\n```"; });
const d3 = W.createDraft({ mode: "wizard", description: "shop again" });
const fb = await W.digestDraft(d3.id, { cli: flaky, agents });
check("primary fails -> fallback answers and the reply says so", fb.lastModel?.provider === "codex" && fb.lastModel.fellBackFrom === "claude" && /rate limited/.test(fb.lastModel.fallbackReason), fb.lastModel);
err = null;
try { await W.digestDraft(d3.id, { cli: flaky, agents: { agent: "claude", fallback: "none" } }); } catch (e) { err = e; }
check("fallback 'none' -> loud 502 naming the gear", err?.status === 502 && /no fallback set/.test(err.message), err?.message);
err = null;
try { await W.digestDraft(d3.id, { cli: mockCli(() => { throw new Error("down"); }), agents }); } catch (e) { err = e; }
check("both fail -> error carries both reasons", err?.status === 502 && /claude failed/.test(err.message) && /fallback codex failed too/.test(err.message), err?.message);
err = null;
try { await W.digestDraft(d3.id, { cli: mockCli(() => "   "), agents: { agent: "claude", fallback: "claude" } }); } catch (e) { err = e; }
check("empty reply with no distinct fallback -> 502 'returned nothing'", err?.status === 502 && /returned nothing/.test(err.message), err?.message);
err = null;
try { await W.digestDraft(d3.id, { cli: good, agents: { agent: "antigravity", fallback: "none" } }); } catch (e) { err = e; }
check("an agent outside the wizard list is refused", err && /not a wizard agent/.test(err.message), err?.message);

// ── J. helpers + lifecycle ──────────────────────────────────────────────────
check("extractJson tolerates preamble + fences", W.extractJson("Sure!\n```json\n{\"a\":1}\n```\nDone.").a === 1 && W.extractJson("noise {\"b\":[1,2]} trailing").b.length === 2);
check("extractJson refuses a reply with no object", (() => { try { W.extractJson("no json here"); return false; } catch (e) { return e.status === 502; } })());
const reopened = W.reopenDraft(id);
check("reopen an emitted draft -> clarify, spec dropped", reopened.step === "clarify" && reopened.spec === null);
const edit = W.updateDraft(d2.id, { description: "changed after approval" });
check("editing the description after approval reopens the draft", edit.step === "clarify" && edit.spec === null);
const disc = await json(await idRoute.PATCH(req(`/api/v2/webmcp/wizard/${d3.id}`, "PATCH", { action: "discard" }), ctx(d3.id)));
check("discard archives (row kept, hidden from the list)", disc.status === 200 && disc.json.draft.archivedAt && !W.listDrafts().some((x) => x.id === d3.id) && W.listDrafts({ includeArchived: true }).some((x) => x.id === d3.id));
check("a discarded draft refuses further steps (409)", (() => { try { W.approveDraft(d3.id); return false; } catch (e) { return e.status === 409; } })());
check("GET unknown draft -> 404", (await json(await idRoute.GET(req("/api/v2/webmcp/wizard/nope", "GET"), ctx("nope")))).status === 404);
check("PATCH unknown action -> 400", (await json(await idRoute.PATCH(req(`/api/v2/webmcp/wizard/${id}`, "PATCH", { action: "launch" }), ctx(id)))).status === 400);

// ── K. file-level wiring (rule 16 gear, docs table, UI mounted) ─────────────
const dbSchema = read("src/lib/v2/dbSchema.ts");
check("migration 044 'webmcp_wizard' creates webmcp_wizard_drafts", /version: 44,\s*\r?\n\s*name: "webmcp_wizard"/.test(dbSchema) && dbSchema.includes("CREATE TABLE IF NOT EXISTS webmcp_wizard_drafts"));
const settingsSrc = read("src/lib/settings.ts");
check("settings.webmcp types wizardAgent + wizardFallback", settingsSrc.includes("wizardAgent?: string") && settingsSrc.includes("wizardFallback?: string"));
const gear = read("src/components/v2/webmcp/WebmcpSettings.tsx");
check("WebmcpSettings surfaces wizardAgent + wizardFallback (rule 16)", gear.includes("wizardAgent") && gear.includes("wizardFallback"));
const view = read("src/components/v2/webmcp/WebmcpView.tsx");
check("WebmcpView mounts the WizardPanel behind a Wizard toggle", view.includes("<WizardPanel") && /Wizard/.test(view));
const panel = exists("src/components/v2/webmcp/WizardPanel.tsx") ? read("src/components/v2/webmcp/WizardPanel.tsx") : "";
check("WizardPanel offers Wizard and Write-my-own modes", ['create("wizard")', 'create("own")', "New wizard", "Write my own"].every((s) => panel.includes(s)));
check("WizardPanel walks describe -> clarify -> approve -> emit (+ apply, proofread)", ['post("digest")', 'action: "approve"', 'post("emit")', "/apply", 'post("proofread"'].every((s) => panel.includes(s)));
check("WizardPanel shows who answered (provider + fellBackFrom)", panel.includes("fellBackFrom") && panel.includes("provider"));
for (const f of ["route.ts", "[id]/route.ts", "[id]/digest/route.ts", "[id]/emit/route.ts", "[id]/apply/route.ts", "[id]/proofread/route.ts"]) {
  check(`route exists: wizard/${f}`, exists(`src/app/api/v2/webmcp/wizard/${f}`));
}
const doc = read("docs/modules/webmcp.md");
check("docs/modules/webmcp.md documents the Wizard controls + gear fields", /### Wizard/.test(doc) && /Wizard agent/.test(doc) && /Wizard fallback/.test(doc) && /Write my own/.test(doc));

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
