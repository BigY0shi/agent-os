// SPEC-F chunk 2 — smoke-anynotes-ui: the AnyNotes UI (I3.3 view/cards/capture,
// I3.4 detail/thread/gear, I4.1 widget + attention.flag).
//
// §A-§G are STATIC contract checks (house *-ui pattern, smoke-agents-ui.mjs):
// files + 'use client'; sidebar NAV *and* the Workspace section Set; the gear's
// four settings keys; reuse-not-fork greps over the shared atoms; the widget
// registry entry + component map; components consuming the REAL backend types
// instead of redeclaring them; no secret/env references in client code.
//
// §H is DYNAMIC and fully OFFLINE (chunk-1's env recipe — a temp db, temp
// settings, temp media dir, ANYNOTES_OFFLINE=1, a dead OLLAMA_URL and
// memory.provider 'ollama-local', because the default 'ollama-cloud' provider
// IGNORES OLLAMA_URL and dials https://ollama.com): it proves the widget data
// fn returns the real payload and that anynote.reply.jarvis is mapped onto the
// published attention.flag contract.
// Run: npx tsx scripts/v2/smoke-anynotes-ui.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ── temp env BEFORE any src import (chunk-1 recipe) ─────────────────────────
const stamp = Date.now();
process.env.AGENTIC_OS_DB = path.join(os.tmpdir(), `agentos-smoke-anynotes-ui-${stamp}.db`);
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-anynotes-ui-settings-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_ANYNOTES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-anynotes-ui-media-"));
process.env.ANYNOTES_OFFLINE = "1";
process.env.OLLAMA_URL = "http://127.0.0.1:1";
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    memory: { ingestEnabled: false, provider: "ollama-local", embedProvider: "ollama-local" },
    capability: { browserEnabled: false },
    tasks: { timezone: "America/Chicago" },
    browser: { wsPort: 0, wsBind: "local", profiles: [], sessions: [] },
    anynotes: { autoIngest: false },
  }),
);

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(
    `${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 240)}` : ""}`,
  );
  if (!cond) failures++;
};

// ── §A files + 'use client' ─────────────────────────────────────────────────
console.log("\n§A files");
const clientComponents = [
  "src/components/v2/anynotes/AnyNotesView.tsx",
  "src/components/v2/anynotes/NoteCard.tsx",
  "src/components/v2/anynotes/CaptureBox.tsx",
  "src/components/v2/anynotes/NoteDetail.tsx",
  "src/components/v2/anynotes/AnyNotesSettings.tsx",
];
for (const f of clientComponents) {
  check(`${f} exists`, exists(f));
  if (exists(f)) check(`${f} is 'use client'`, /^"use client";/.test(read(f)));
}
check(
  "shared.ts exists and is client-safe (no node imports, no server store import)",
  exists("src/components/v2/anynotes/shared.ts") &&
    !/from "node:/.test(read("src/components/v2/anynotes/shared.ts")) &&
    !/anynotes\/store/.test(read("src/components/v2/anynotes/shared.ts")),
);
check("attention bridge exists (I4.1)", exists("src/lib/v2/anynotes/attention.ts"));

// ── §B page wiring ──────────────────────────────────────────────────────────
console.log("\n§B page wiring");
{
  check("src/app/anynotes/page.tsx exists", exists("src/app/anynotes/page.tsx"));
  const page = read("src/app/anynotes/page.tsx");
  check("/anynotes renders AnyNotesView", page.includes("AnyNotesView"));
  check(
    "/anynotes wraps the view in Suspense (useSearchParams CSR bailout)",
    page.includes("Suspense"),
  );
  check("page.tsx is a SERVER component (no 'use client')", !/^"use client";/.test(page));
}

// ── §C sidebar: NAV *and* the Workspace Set ─────────────────────────────────
console.log("\n§C sidebar");
{
  const sidebar = read("src/components/Sidebar.tsx");
  check('Sidebar NAV carries href "/anynotes"', /href: "\/anynotes"/.test(sidebar));
  const ws = sidebar.match(/const WORKSPACE_ROUTES = new Set\(\[([^\]]*)\]\)/);
  check("WORKSPACE_ROUTES contains /anynotes (else it silently lands in 'Self')",
    !!ws && ws[1].includes('"/anynotes"'), ws?.[1]);
  check("/anynotes is NOT in any other section Set",
    !new RegExp(`const (ORCHESTRATION|AGENT)_ROUTES = new Set\\(\\[[^\\]]*"/anynotes"`).test(sidebar));
}

// ── §D capture box: paste / drop / bookmarklet / ?capture= / 422-as-success ──
console.log("\n§D CaptureBox (I3.3)");
{
  const cb = read("src/components/v2/anynotes/CaptureBox.tsx");
  check("handles pasted clipboard image items", cb.includes("onPaste") && cb.includes("clipboardData") && cb.includes("i.kind === \"file\""));
  check("handles dropped files (onDrop + dataTransfer)", cb.includes("onDrop") && cb.includes("dataTransfer"));
  check("posts imageBase64 for images", cb.includes("imageBase64"));
  check("posts all three capture shapes (url / text / imageBase64)",
    cb.includes("{ url:") && cb.includes("{ text:") && cb.includes("imageBase64,"));
  check("treats 422 as SAVED-with-a-warning (chunk-1 handoff), not an error",
    /res\.status === 422 && j\?\.note/.test(cb) && cb.includes("setWarning"));
  check("bookmarklet modal offers the copyable javascript: snippet with ?capture=",
    cb.includes("javascript:window.open") && cb.includes("/anynotes?capture=") && cb.includes("encodeURIComponent(location.href)"));
  check("?capture= auto-capture fires once per value (ref guard, inside an effect)",
    cb.includes("pendingCapture") && cb.includes("consumed.current") && cb.includes("useEffect"));
}

// ── §E view: polling, filters, masonry, counts, deep links ──────────────────
console.log("\n§E AnyNotesView (I3.3)");
{
  const v = read("src/components/v2/anynotes/AnyNotesView.tsx");
  check("polls with usePollWhileVisible at 4s (SPEC-F §6)",
    v.includes("usePollWhileVisible") && /usePollWhileVisible\(refresh, 4000/.test(v));
  check("reads GET /api/anynotes with the real query params",
    v.includes("/api/anynotes?") && v.includes("status") && v.includes("type") && v.includes("label") && v.includes("q"));
  check("count chips use the route's SERVER-computed counts (never re-derived)",
    v.includes("counts[s]") && !/notes\.filter\(\s*\(n\)\s*=>\s*n\.status/.test(v));
  check("masonry grid is responsive CSS columns 1-4",
    /columns-1 sm:columns-2 lg:columns-3 xl:columns-4/.test(v));
  check("status tabs cover inbox/kept/archived/all", /\["inbox", "kept", "archived", "all"\]/.test(v));
  check("type pills come from NOTE_TYPES (backend enum, not a local list)", v.includes("NOTE_TYPES.map"));
  check("?note= opens the detail slide-over", v.includes('params.get("note")') && v.includes("<NoteDetail"));
  check("?capture= is handed to CaptureBox and scrubbed after use",
    v.includes('params.get("capture")') && v.includes("clearCaptureParam") && v.includes('sp.delete("capture")'));
  check("carries the rule-16 gear (ConfigMenu + AnyNotesSettings)",
    v.includes("ConfigMenu") && v.includes("AnyNotesSettings"));
  check("registers Jarvis page context (C5 convention)", v.includes("useJarvisPageContext"));
}

// ── §F detail + thread (I3.4) ───────────────────────────────────────────────
console.log("\n§F NoteDetail + ReplyThread (I3.4)");
{
  const d = read("src/components/v2/anynotes/NoteDetail.tsx");
  check("renders the snapshot as markdown", d.includes("ReactMarkdown") && d.includes("remarkGfm"));
  check("pending row renders the 'Jarvis is thinking…' shimmer",
    d.includes("r.pending") && d.includes("Jarvis is thinking") && d.includes("animate-pulse"));
  check("error row renders red inline (rule 11 — the string already names the agent)",
    /r\.error \?[\s\S]{0,200}#f87171/.test(d));
  check("composer has the @jarvis quick-chip using the backend JARVIS_MENTION regex",
    d.includes("JARVIS_MENTION") && d.includes("@jarvis"));
  check("labels editor PATCHes labels", d.includes("patch({ labels:"));
  check("status buttons PATCH status for all three statuses",
    /\["inbox", "kept", "archived"\] as NoteStatus\[\]/.test(d) && d.includes("patch({ status: s })"));
  check("delete is EXILE, described as recoverable (house rule)",
    d.includes('method: "DELETE"') && /recoverable/i.test(d));
  check("thread is polled (no SSE for replies — chunk-1 handoff)",
    d.includes("usePollWhileVisible") && !d.includes("EventSource"));
  check("media uses note.mediaPath verbatim through the media route",
    d.includes("/api/anynotes/media/${note.mediaPath}"));
}

// ── §G reuse-not-fork + gear keys + widget registration + no secrets ────────
console.log("\n§G reuse, gear, widget, hygiene");
{
  const all = clientComponents.map((f) => [f, read(f)]);

  // Shared atoms are IMPORTED, never re-declared under v2/anynotes.
  const dirFiles = fs
    .readdirSync(path.join(root, "src/components/v2/anynotes"))
    .map((f) => `src/components/v2/anynotes/${f}`);
  const forked = dirFiles.filter((f) =>
    /export function (SlideOver|EmptyState|StatusChip|fmtAgo|fmtDate)\b/.test(read(f)),
  );
  check("no forked copy of SlideOver/EmptyState/StatusChip/fmtAgo under v2/anynotes", forked.length === 0, forked);
  check("NoteDetail reuses the shared SlideOver shell",
    read("src/components/v2/anynotes/NoteDetail.tsx").includes('from "../memory/shared"'));
  check("view reuses the shared integrations atoms (EmptyState/StatusChip/inputStyle)",
    read("src/components/v2/anynotes/AnyNotesView.tsx").includes('from "../integrations/shared"'));
  check("gear reuses ConfigMenu primitives + AgentPicker (no bespoke picker)",
    read("src/components/v2/anynotes/AnyNotesSettings.tsx").includes('from "@/components/ConfigMenu"') &&
      read("src/components/v2/anynotes/AnyNotesSettings.tsx").includes('from "@/components/AgentPicker"'));

  // Components consume the REAL backend types rather than redeclaring them.
  // A DECLARATION (`interface Note {` / `type Reply =`) at line start — a
  // `type Note,` inside an import list is exactly what we WANT to see.
  const redeclared = all.filter(([, src]) =>
    /^\s*(export\s+)?(interface|type)\s+(Note|Reply)\s*[={]/m.test(src),
  );
  check("no component redeclares the Note/Reply shapes (types.ts is the contract)", redeclared.length === 0, redeclared.map(([f]) => f));
  check("view imports Note/NoteStatus/NoteType from the backend types module",
    read("src/components/v2/anynotes/AnyNotesView.tsx").includes('from "@/lib/v2/anynotes/types"'));
  const serverImporters = all.filter(([, src]) => /@\/lib\/v2\/anynotes\/(store|capture|ingest|jarvisReply|attention)/.test(src));
  check("no client component imports a server-only anynotes module", serverImporters.length === 0, serverImporters.map(([f]) => f));

  // Rule 16 — all four settings keys have a gear surface.
  const gear = read("src/components/v2/anynotes/AnyNotesSettings.tsx");
  for (const key of ["autoIngest", "jarvisAgent", "defaultStatus", "maxSnapshotChars"]) {
    check(`gear exposes settings.anynotes.${key}`, gear.includes(key));
  }
  const st = read("src/lib/settings.ts");
  check("settings.ts still declares all four anynotes defaults",
    st.includes("autoIngest: true") && st.includes('jarvisAgent: "claude"') &&
      st.includes('defaultStatus: "inbox"') && st.includes("maxSnapshotChars: 24000"));

  // I4.1 widget — registry entry is the SINGLE catalog slug (CONVENTIONS §8).
  const registry = read("src/lib/v2/widgets/registry.ts");
  const slugHits = registry.match(/slug: "anynotes-recent"/g) ?? [];
  check("anynotes-recent registered exactly ONCE (CONVENTIONS §8)", slugHits.length === 1, slugHits.length);
  check("registry description no longer says 'not built yet'", !/anynotes-recent[\s\S]{0,300}Not built yet/.test(registry));
  const wdata = read("src/lib/v2/widgets/data.ts");
  check("anynotes-recent data fn reads the real store (placeholder filled)",
    wdata.includes("anynotesRecentData") && wdata.includes("pendingJarvisCount") &&
      !/anynotesRecentData[\s\S]{0,200}workstream not built/.test(wdata));
  const wcomp = read("src/components/v2/home/widgetComponents.tsx");
  check("widget component map still has the anynotes-recent entry (no TODO tag)",
    wcomp.includes('"anynotes-recent": AnynotesRecentWidget') && !/V2-WIDGET-REGISTER/.test(wcomp));
  check("widget shows the pending-@jarvis count and links to the note deep link",
    wcomp.includes("pendingJarvis") && wcomp.includes("/anynotes?note="));

  // Secrets / env in client code.
  const offenders = all.filter(([, src]) =>
    /OLLAMA_API_KEY|AGENTOS_PASSWORD|secrets\.json|process\.env\.\w*(KEY|TOKEN|SECRET|PASSWORD)/.test(src),
  );
  check("no secret/env references in client components", offenders.length === 0, offenders.map(([f]) => f));
}

// ── §H dynamic, offline: widget payload + attention.flag mapping ────────────
console.log("\n§H live payload + attention.flag (offline)");
{
  const store = await import("../../src/lib/v2/anynotes/store.ts");
  const { getWidgetData } = await import("../../src/lib/v2/widgets/data.ts");
  const events = await import("../../src/lib/v2/events.ts");
  const attention = await import("../../src/lib/v2/anynotes/attention.ts");

  const note = store.createNote({ type: "text", title: "Widget fixture", contentMd: "hello" });
  store.addReply({ noteId: note.id, author: "user", body: "@jarvis what is this" });
  const pending = store.addReply({ noteId: note.id, author: "jarvis", body: "", pending: true });

  const data = await getWidgetData("anynotes-recent", { maxItems: 5 });
  check("widget data available:true with the fixture note", data.available === true && data.notes.length === 1, data);
  check("widget note carries id/type/title/capturedAt/replyCount",
    data.available === true &&
      data.notes[0].id === note.id &&
      data.notes[0].type === "text" &&
      data.notes[0].replyCount === 2 &&
      typeof data.notes[0].capturedAt === "string",
    data.available === true ? data.notes[0] : data);
  check("widget url is NULL for a text note (contract corrected — see the chunk record)",
    data.available === true && data.notes[0].url === null);
  check("pendingJarvis counts the still-generating reply", data.available === true && data.pendingJarvis === 1);

  // attention.flag mapping — the bridge subscribes, the reply event maps over.
  attention.ensureAnynotesAttention();
  const flags = [];
  const off = events.on("attention.flag", (e) => flags.push(e.payload));
  events.emit("anynote.reply.jarvis", { noteId: note.id, replyId: pending.id, ok: true }, "anynotes");
  events.emit("anynote.reply.jarvis", { noteId: note.id, replyId: `${pending.id}x`, ok: false }, "anynotes");
  events.emit("anynote.reply.jarvis", { replyId: "orphan" }, "anynotes"); // malformed → ignored
  off();

  check("one attention.flag per well-formed anynote.reply.jarvis (malformed ignored)", flags.length === 2, flags.length);
  const okFlag = flags[0];
  const badFlag = flags[1];
  check("flag carries the full CONVENTIONS §5 payload",
    !!okFlag && typeof okFlag.kind === "string" && typeof okFlag.severity === "string" &&
      typeof okFlag.title === "string" && typeof okFlag.route === "string" && typeof okFlag.dedupeKey === "string",
    okFlag);
  check("route deep-links the note (?note=<id>)", okFlag?.route === `/anynotes?note=${note.id}`, okFlag?.route);
  check("dedupeKey is per-reply (one row per reply, never per note)",
    okFlag?.dedupeKey === `anynote-reply:${pending.id}` && badFlag?.dedupeKey !== okFlag?.dedupeKey);
  check("ok:true → info, ok:false → warn", okFlag?.severity === "info" && badFlag?.severity === "warn",
    [okFlag?.severity, badFlag?.severity]);
  check("title names the note, not just its id", typeof okFlag?.title === "string" && okFlag.title.includes("Widget fixture"), okFlag?.title);
  check("ensureAnynotesAttention is idempotent (second call adds no second listener)", (() => {
    attention.ensureAnynotesAttention();
    const again = [];
    const off2 = events.on("attention.flag", (e) => again.push(e.payload));
    events.emit("anynote.reply.jarvis", { noteId: note.id, replyId: "second", ok: true }, "anynotes");
    off2();
    return again.length === 1;
  })());
  attention.stopAnynotesAttentionForTests();
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
