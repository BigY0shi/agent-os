// SPEC-F I — smoke-anynotes: the AnyNotes backend (I1.1, I1.2, I2.1, I2.2,
// I3.1, I3.2), fully OFFLINE.
//
// Covers: store CRUD + the exile row (note AND thread) · all three classifyUrl
// branches · readability against scripts/v2/fixtures/article.html · capture
// failure degrading to a link-only note with meta.captureMode='fallback' (422,
// note still saved) · all three POST shapes (url / imageBase64 / text) · the
// media route serving a real file AND rejecting traversal with 400 · the
// memory-ingest gate ON and OFF · @jarvis detection creating a pending reply
// row while a plain reply does not · the jarvis worker's failure path filling
// the `error` column while the route stays 200.
//
// NOTHING here touches the network: ANYNOTES_OFFLINE=1 short-circuits every
// oEmbed/article fetch, and OLLAMA_URL points at a dead port so no model is
// reachable even by accident.
// Run: npx tsx scripts/v2/smoke-anynotes.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ── temp env BEFORE any src imports (smoke-agents-forge recipe) ──────────────
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-anynotes-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-anynotes-settings-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-anynotes-media-"));
process.env.AGENTIC_OS_ANYNOTES_DIR = notesDir;
process.env.ANYNOTES_OFFLINE = "1";              // no oEmbed / article fetches
process.env.OLLAMA_URL = "http://127.0.0.1:1";   // dead port — nothing may reach a live model

// memory.ingestEnabled=false parks the Memory V2 drain worker (rows stay
// PENDING) — the ANYNOTES gate under test is settings.anynotes.autoIngest,
// which decides whether a row is enqueued at all.
// memory.provider MUST be ollama-local: the cloud provider ignores OLLAMA_URL
// and dials https://ollama.com, which the jarvis-reply recall path would
// otherwise reach for. Local + the dead port above = genuinely offline.
// browser.wsPort 0 keeps ensureV2's CDP bridge off a real port.
const baseSettings = {
  memory: { ingestEnabled: false, provider: "ollama-local", embedProvider: "ollama-local" },
  capability: { browserEnabled: false },
  tasks: { timezone: "America/Chicago" },
  browser: { wsPort: 0, wsBind: "local", profiles: [], sessions: [] },
};
const writeSettings = (extra = {}) =>
  fs.writeFileSync(settingsFile, JSON.stringify({ ...baseSettings, ...extra }));
writeSettings(); // anynotes.* absent → DEFAULT_SETTINGS (autoIngest true, jarvisAgent claude)

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(
    `${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${JSON.stringify(extra).slice(0, 300)}]` : ""}`,
  );
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs = 60_000, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(stepMs);
  }
}

const { NextRequest } = await import("next/server.js");
const store = await import("../../src/lib/v2/anynotes/store.ts");
const capture = await import("../../src/lib/v2/anynotes/capture.ts");
const types = await import("../../src/lib/v2/anynotes/types.ts");
const listRoute = await import("../../src/app/api/anynotes/route.ts");
const idRoute = await import("../../src/app/api/anynotes/[id]/route.ts");
const repliesRoute = await import("../../src/app/api/anynotes/[id]/replies/route.ts");
const mediaRoute = await import("../../src/app/api/anynotes/media/[file]/route.ts");

const req = (url, method = "GET", body = null) =>
  new NextRequest(`http://127.0.0.1:3737${url}`, {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
const withId = (fn, id, r) => fn(r, { params: Promise.resolve({ id }) });

// 1x1 transparent PNG.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ── §A store CRUD + exile (I1.1) ─────────────────────────────────────────────
console.log("\n── §A store CRUD + exile ──");
let exiledId = null;
{
  const note = store.createNote({
    type: "text",
    title: "Store smoke",
    contentMd: "A plain note written straight through the store layer.",
    labels: ["smoke", "store"],
    meta: { captureMode: "user" },
  });
  check("A1 createNote returns a 12-char id + parsed shape",
    /^[a-z0-9]{12}$/.test(note.id) && note.status === "inbox" &&
    note.labels.length === 2 && note.meta.captureMode === "user" &&
    note.episodeId === null && typeof note.capturedAt === "string", note);

  check("A2 capturedAt is TEXT UTC ISO (CONVENTIONS §1.4)",
    note.capturedAt === new Date(note.capturedAt).toISOString(), note.capturedAt);

  const listed = store.listNotes({ status: "inbox" });
  check("A3 listNotes finds it", listed.some((n) => n.id === note.id), listed.length);

  const patched = store.patchNote(note.id, { status: "kept", title: "Store smoke (kept)" });
  check("A4 patchNote lands status + title + updated_at",
    patched.status === "kept" && patched.title === "Store smoke (kept)" && !!patched.updatedAt, patched);
  check("A5 patched note leaves the inbox filter",
    !store.listNotes({ status: "inbox" }).some((n) => n.id === note.id));

  check("A6 label filter matches the whole element, not a substring",
    store.listNotes({ status: "all", label: "store" }).some((n) => n.id === note.id) &&
    !store.listNotes({ status: "all", label: "stor" }).some((n) => n.id === note.id));

  const q = store.listNotes({ status: "all", q: "straight through the store" });
  check("A7 q= searches title + content_md", q.some((n) => n.id === note.id), q.length);

  // Insertion order must hold even when every row lands in the SAME millisecond
  // — which is the normal case, since the replies route writes the human reply
  // and the pending @jarvis row back to back. Ordering by the random shortId()
  // tiebreak shuffled this ~25% of runs; 8 rows makes a regression certain to
  // fail rather than occasionally fail.
  // On a THROWAWAY note, so the burst can't perturb the pending/exile counts
  // the sections below assert against `note`.
  const orderNote = store.createNote({ type: "text", title: "order probe", contentMd: "x" });
  const burst = [];
  for (let i = 0; i < 8; i++) {
    burst.push(store.addReply({
      noteId: orderNote.id,
      author: i % 2 ? "jarvis" : "user",
      body: `burst-${i}`,
    }).id);
  }
  const got = store.listReplies(orderNote.id).map((r) => r.id);
  const stamps = store.listReplies(orderNote.id).map((r) => r.createdAt);
  check("A8 listReplies holds insertion order", JSON.stringify(got) === JSON.stringify(burst), { got, burst });
  check("A8b …and the burst really did collide on the timestamp (the case A8 guards)",
    new Set(stamps).size < 8, stamps);
  store.exileNote(orderNote.id);

  const r1 = store.addReply({ noteId: note.id, author: "user", body: "first" });
  store.addReply({ noteId: note.id, author: "jarvis", body: "", pending: true });
  check("A8c the real route pair (human + pending jarvis) keeps its order",
    store.listReplies(note.id)[0].id === r1.id);
  check("A9 pendingJarvisCount sees the queued row", store.pendingJarvisCount() === 1);

  const settled = store.setReplyResult(store.listReplies(note.id)[1].id, { body: "answered" });
  check("A10 setReplyResult clears pending and sets the body",
    settled.pending === false && settled.body === "answered" && settled.error === null, settled);

  const counts = store.countsByStatus();
  check("A11 countsByStatus covers every status key",
    counts.kept === 1 && counts.inbox === 0 && counts.archived === 0, counts);

  check("A12 exileNote succeeds", store.exileNote(note.id) === true);
  check("A13 ...the live row is gone", store.getNote(note.id) === null);
  const ex = store.getExiledNote(note.id);
  check("A14 ...and lives in anynotes_exile with exiled_at",
    !!ex && ex.title === "Store smoke (kept)" && typeof ex.exiledAt === "string", ex);
  const { getDb } = await import("../../src/lib/v2/db.ts");
  const exReplies = getDb()
    .prepare("SELECT * FROM anynote_replies_exile WHERE note_id = ?")
    .all(note.id);
  check("A15 the whole THREAD was exiled too (FK-safe, nothing destroyed)",
    exReplies.length === 2 && exReplies.every((r) => typeof r.exiled_at === "string"), exReplies.length);
  check("A16 exiling a missing note returns false", store.exileNote("nosuchnoteid") === false);
  exiledId = note.id;
}

// ── §B capture engine (I1.2) ─────────────────────────────────────────────────
console.log("\n── §B capture: classify + readability + degrade ──");
{
  check("B1 classifyUrl → tweet (x.com and twitter.com)",
    capture.classifyUrl("https://x.com/someone/status/123") === "tweet" &&
    capture.classifyUrl("https://www.twitter.com/someone/status/123") === "tweet");
  check("B2 classifyUrl → video (youtube.com and youtu.be)",
    capture.classifyUrl("https://www.youtube.com/watch?v=abc") === "video" &&
    capture.classifyUrl("https://youtu.be/abc") === "video");
  check("B3 classifyUrl → article (everything else)",
    capture.classifyUrl("https://example.com/posts/hello") === "article" &&
    capture.classifyUrl("not a url at all") === "article");

  const fixture = fs.readFileSync(
    path.join(process.cwd(), "scripts", "v2", "fixtures", "article.html"),
    "utf8",
  );
  const art = capture.extractArticleFromHtml(fixture, "https://example.com/fallbacks");
  check("B4 readability extracts the title from the fixture",
    !!art && art.mode === "readability" && /Quiet Cost of Fallbacks/.test(art.title), art?.title);
  check("B5 ...the byline", !!art && /Dana Restrepo/.test(art.author ?? ""), art?.author);
  check("B6 ...markdown body with the article prose", !!art && /fallback is a promise/i.test(art.contentMd),
    art?.contentMd.slice(0, 120));
  check("B7 ...og:site_name + og:image ride along",
    art?.site === "Agent OS Smoke Press" && art?.thumbUrl === "https://example.invalid/fixture-hero.png", {
      site: art?.site, thumb: art?.thumbUrl });
  check("B8 ...chrome/script/style stripped (no nav, no tracker, no footer)",
    !!art && !/__tracker|Sponsored: buy more servers|All rights reserved/.test(art.contentMd));

  const capped = capture.extractArticleFromHtml(fixture, "https://example.com/fallbacks", 200);
  check("B9 maxSnapshotChars caps the snapshot",
    !!capped && capped.contentMd.length < 300 && /snapshot truncated/.test(capped.contentMd),
    capped?.contentMd.length);

  check("B10 extractArticleFromHtml returns null on a bodyless doc",
    capture.extractArticleFromHtml("<html><head></head><body></body></html>", "https://example.com/x") === null);

  check("B11 ANYNOTES_OFFLINE=1 is in force", capture.isOffline() === true);
  const degraded = await capture.captureUrl("https://example.com/posts/hello");
  check("B12 offline capture DEGRADES instead of throwing",
    degraded.degraded === true && degraded.meta.captureMode === "fallback" &&
    degraded.type === "article" && degraded.contentMd === "https://example.com/posts/hello", degraded);
  check("B13 ...and says loudly why", /ANYNOTES_OFFLINE/.test(degraded.error ?? ""), degraded.error);
  const degradedTweet = await capture.captureUrl("https://x.com/a/status/1");
  check("B14 the degraded note keeps its classified type", degradedTweet.type === "tweet", degradedTweet.type);

  // saveScreenshot: caller errors are LOUD (throw), not degraded notes.
  let threw = "";
  try { capture.saveScreenshot("bm90LWFuLWltYWdl"); } catch (e) { threw = e.message; }
  check("B15 saveScreenshot THROWS on a non-image (config/caller error is loud)",
    /not a PNG, JPEG or WebP/.test(threw), threw);
}

// ── §C POST capture: all three shapes (I2.1) ─────────────────────────────────
console.log("\n── §C POST /api/anynotes — url | imageBase64 | text ──");
let urlNoteId = null, imageNoteId = null, textNoteId = null, mediaFile = null;
{
  const urlRes = await listRoute.POST(req("/api/anynotes", "POST", {
    url: "https://example.com/posts/hello", labels: ["smoke"],
  }));
  const urlJson = await urlRes.json();
  urlNoteId = urlJson.note?.id ?? null;
  check("C1 url shape → 422 offline (extraction failed) but the note IS saved",
    urlRes.status === 422 && !!urlNoteId && /extraction failed/.test(urlJson.error ?? ""), urlJson.error);
  check("C2 ...saved as a link-only fallback note",
    urlJson.note.type === "article" && urlJson.note.meta.captureMode === "fallback" &&
    urlJson.note.url === "https://example.com/posts/hello", urlJson.note);

  const imgRes = await listRoute.POST(req("/api/anynotes", "POST", {
    imageBase64: `data:image/png;base64,${PNG_1x1}`, imageName: "pasted.png",
  }));
  const imgJson = await imgRes.json();
  imageNoteId = imgJson.note?.id ?? null;
  mediaFile = imgJson.note?.mediaPath ?? null;
  check("C3 imageBase64 shape → 200 screenshot note with a mediaPath",
    imgRes.status === 200 && imgJson.note.type === "screenshot" &&
    /^[a-z0-9]+\.png$/.test(mediaFile ?? ""), imgJson.note);
  check("C4 ...the file really landed under the media dir",
    fs.existsSync(path.join(notesDir, "media", mediaFile ?? "")));

  const textRes = await listRoute.POST(req("/api/anynotes", "POST", {
    text: "Remember to wire the anynotes-recent widget in chunk two of this build.",
  }));
  const textJson = await textRes.json();
  textNoteId = textJson.note?.id ?? null;
  check("C5 text shape → 200 text note titled from the first line",
    textRes.status === 200 && textJson.note.type === "text" &&
    /anynotes-recent widget/.test(textJson.note.title), textJson.note);

  const both = await listRoute.POST(req("/api/anynotes", "POST", { url: "https://a.example", text: "x" }));
  check("C6 two shapes at once → 400", both.status === 400);
  const none = await listRoute.POST(req("/api/anynotes", "POST", {}));
  check("C7 no shape at all → 400", none.status === 400);
  const badUrl = await listRoute.POST(req("/api/anynotes", "POST", { url: "file:///C:/Windows/win.ini" }));
  check("C8 non-http(s) url → 400 (no filesystem capture path exists)", badUrl.status === 400);
  const badImg = await listRoute.POST(req("/api/anynotes", "POST", { imageBase64: "bm90LWFuLWltYWdl" }));
  check("C9 non-image base64 → 400, loud (not a degraded note)", badImg.status === 400);

  const listRes = await listRoute.GET(req("/api/anynotes?status=all&limit=100"));
  const listJson = await listRes.json();
  check("C10 GET ?status=all returns the three captures + counts",
    [urlNoteId, imageNoteId, textNoteId].every((id) => listJson.notes.some((n) => n.id === id)) &&
    typeof listJson.counts.inbox === "number", listJson.notes.length);
  const typed = await (await listRoute.GET(req("/api/anynotes?status=all&type=screenshot"))).json();
  check("C11 GET ?type= narrows",
    typed.notes.length === 1 && typed.notes[0].id === imageNoteId, typed.notes.length);

  const one = await withId(idRoute.GET, textNoteId, req(`/api/anynotes/${textNoteId}`));
  const oneJson = await one.json();
  check("C12 GET /:id returns note + (empty) thread",
    one.status === 200 && oneJson.note.id === textNoteId && Array.isArray(oneJson.replies) &&
    oneJson.replies.length === 0, oneJson);

  const patched = await withId(idRoute.PATCH, textNoteId,
    req(`/api/anynotes/${textNoteId}`, "PATCH", { status: "kept", labels: ["chunk2", "chunk2", " todo "] }));
  const patchedJson = await patched.json();
  check("C13 PATCH status + labels (trimmed + deduped)",
    patched.status === 200 && patchedJson.note.status === "kept" &&
    JSON.stringify(patchedJson.note.labels) === JSON.stringify(["chunk2", "todo"]), patchedJson.note);
  const badPatch = await withId(idRoute.PATCH, textNoteId,
    req(`/api/anynotes/${textNoteId}`, "PATCH", { status: "deleted" }));
  check("C14 PATCH with an unknown status → 400", badPatch.status === 400);
  const badId = await withId(idRoute.GET, "../evil", req("/api/anynotes/..%2Fevil"));
  check("C15 traversal-shaped note id → 400 (never reaches a query)", badId.status === 400);
  const missing = await withId(idRoute.GET, "zzzzzzzzzzzz", req("/api/anynotes/zzzzzzzzzzzz"));
  check("C16 unknown note id → 404", missing.status === 404);

  const del = await withId(idRoute.DELETE, urlNoteId, req(`/api/anynotes/${urlNoteId}`, "DELETE"));
  check("C17 DELETE → exile, not destruction",
    del.status === 200 && (await del.json()).exiled === true && !!store.getExiledNote(urlNoteId));
}

// ── §D media route (I2.1 path guard) ─────────────────────────────────────────
console.log("\n── §D media route: serve + traversal guard ──");
{
  const ok = await mediaRoute.GET(req(`/api/anynotes/media/${mediaFile}`),
    { params: Promise.resolve({ file: mediaFile }) });
  const bytes = Buffer.from(await ok.arrayBuffer());
  check("D1 serves the saved png with the right content-type",
    ok.status === 200 && ok.headers.get("content-type") === "image/png" && bytes.length > 0, ok.status);
  check("D2 ...and the bytes are the PNG we wrote",
    bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG", bytes.slice(0, 4).toString("hex"));

  for (const [label, file] of [
    ["..%2f (encoded)", "..%2fsettings.json"],
    ["../ (decoded)", "../settings.json"],
    ["..\\ (windows)", "..\\settings.json"],
    ["absolute path", "C:\\Windows\\win.ini"],
    ["nested", "sub/dir/x.png"],
    ["wrong extension", "notes.txt"],
    ["malformed encoding", "%E0%A4%A"],
  ]) {
    const res = await mediaRoute.GET(req("/api/anynotes/media/x"),
      { params: Promise.resolve({ file }) });
    check(`D3 media traversal/format guard rejects ${label} → 400`, res.status === 400, res.status);
  }

  const gone = await mediaRoute.GET(req("/api/anynotes/media/deadbeef.png"),
    { params: Promise.resolve({ file: "deadbeef.png" }) });
  check("D4 a well-formed but absent filename → 404", gone.status === 404);
  check("D5 mediaFilePath resolves inside the media root",
    capture.mediaFilePath(mediaFile) === path.join(notesDir, "media", mediaFile));
}

// ── §E memory-ingest gate, ON and OFF (I2.2) ─────────────────────────────────
console.log("\n── §E memory ingest gate ──");
{
  const ingest = await import("../../src/lib/v2/anynotes/ingest.ts");
  check("E1 default settings → autoIngest ON", ingest.autoIngestEnabled() === true);

  const onRes = await listRoute.POST(req("/api/anynotes", "POST", {
    text: "Ingest gate ON: this body is comfortably longer than the twenty character floor.",
  }));
  const onId = (await onRes.json()).note.id;
  const ingested = await until(() => {
    const n = store.getNote(onId);
    return n && n.episodeId ? n : null;
  }, 15_000);
  check("E2 autoIngest ON → the note carries a Memory V2 queue handle",
    !!ingested?.episodeId, ingested?.meta ?? store.getNote(onId));
  if (ingested?.episodeId) {
    const { getDb } = await import("../../src/lib/v2/db.ts");
    const row = getDb()
      .prepare("SELECT source, session_id FROM ingestion_queue WHERE id = ?")
      .get(ingested.episodeId);
    check("E3 ...and a real ingestion_queue row exists with source 'anynotes'",
      row?.source === "anynotes" && /^anynotes-\d{4}-\d{2}-\d{2}$/.test(row?.session_id ?? ""), row);
  } else {
    check("E3 ...and a real ingestion_queue row exists with source 'anynotes'", false, "no episodeId");
  }

  writeSettings({ anynotes: { autoIngest: false } });
  check("E4 settings flip is read at request time", ingest.autoIngestEnabled() === false);
  const offRes = await listRoute.POST(req("/api/anynotes", "POST", {
    text: "Ingest gate OFF: this body is also comfortably longer than the floor.",
  }));
  const offId = (await offRes.json()).note.id;
  await sleep(1200); // give the fire-and-forget ingest every chance to misbehave
  const offNote = store.getNote(offId);
  check("E5 autoIngest OFF → nothing queued, episodeId stays null",
    offNote.episodeId === null, offNote);

  // A too-short body is SKIPPED honestly, not silently dropped.
  writeSettings();
  const shortNote = store.createNote({ type: "text", title: "hi", contentMd: "hi" });
  const outcome = await ingest.ingestNote(shortNote);
  check("E6 a sub-minimum episode body is skipped with a stated reason",
    /Memory V2 requires 20/.test(outcome.skipped ?? "") &&
    typeof store.getNote(shortNote.id).meta.ingestSkipped === "string", outcome);

  writeSettings({ anynotes: { autoIngest: false } }); // keep the rest of the run quiet
}

// ── §F replies + @jarvis detection (I3.2) ────────────────────────────────────
console.log("\n── §F replies route + @jarvis detection ──");
{
  check("F1 mentionsJarvis matches on a word boundary, case-insensitively",
    types.mentionsJarvis("hey @Jarvis what is this") === true &&
    types.mentionsJarvis("@jarvis") === true &&
    types.mentionsJarvis("email me at me@jarvisson.com") === false &&
    types.mentionsJarvis("no mention here") === false);
  check("F2 ...and is stable across repeated calls (no /g lastIndex bug)",
    types.mentionsJarvis("@jarvis hi") === true && types.mentionsJarvis("@jarvis hi") === true);

  const plain = await withId(repliesRoute.POST, textNoteId,
    req(`/api/anynotes/${textNoteId}/replies`, "POST", { body: "just a note to self" }));
  const plainJson = await plain.json();
  check("F3 a plain reply → 200, jarvisQueued false",
    plain.status === 200 && plainJson.jarvisQueued === false, plainJson);
  check("F4 ...and NO jarvis row was created",
    store.listReplies(textNoteId).every((r) => r.author === "user"),
    store.listReplies(textNoteId).map((r) => r.author));

  const emptyBody = await withId(repliesRoute.POST, textNoteId,
    req(`/api/anynotes/${textNoteId}/replies`, "POST", { body: "   " }));
  check("F5 an empty reply body → 400", emptyBody.status === 400);
  const noNote = await withId(repliesRoute.POST, "zzzzzzzzzzzz",
    req("/api/anynotes/zzzzzzzzzzzz/replies", "POST", { body: "hello" }));
  check("F6 replying to an unknown note → 404", noNote.status === 404);
  const exiledReply = await withId(repliesRoute.POST, exiledId,
    req(`/api/anynotes/${exiledId}/replies`, "POST", { body: "hello" }));
  check("F7 replying to an EXILED note → 404 (it is out of the live table)", exiledReply.status === 404);
}

// ── §G jarvis worker failure path (I3.1, rule 11) ────────────────────────────
// The configured agent is deliberately not a wired CLI: cliComplete throws, the
// reply row's `error` column is populated, and NOTHING silently falls back to a
// local model. The POST that started it still returned 200.
console.log("\n── §G jarvis worker: loud failure, route still 200 ──");
{
  writeSettings({ anynotes: { autoIngest: false, jarvisAgent: "definitely-not-a-wired-agent" } });

  const res = await withId(repliesRoute.POST, textNoteId,
    req(`/api/anynotes/${textNoteId}/replies`, "POST", { body: "@jarvis summarize this note" }));
  const json = await res.json();
  check("G1 an @jarvis reply → 200 with jarvisQueued true",
    res.status === 200 && json.jarvisQueued === true && !!json.jarvisReplyId, json);

  const queued = store.getReply(json.jarvisReplyId);
  check("G2 the pending jarvis row exists IMMEDIATELY (the thinking bubble)",
    queued.author === "jarvis" && queued.pending === true && queued.body === "" && queued.error === null,
    queued);

  const settled = await until(() => {
    const r = store.getReply(json.jarvisReplyId);
    return r && !r.pending ? r : null;
  }, 90_000);
  check("G3 the worker settles the row (never leaves it thinking forever)", !!settled, "timed out");
  check("G4 failure lands in the `error` column, loudly naming the agent",
    !!settled?.error && /definitely-not-a-wired-agent/.test(settled.error), settled?.error);
  check("G5 ...and no fabricated body was written (rule 11: no silent fallback)",
    settled?.body === "", settled?.body);

  const { recent } = await import("../../src/lib/v2/events.ts");
  const evts = recent({ types: ["anynote.captured", "anynote.reply.jarvis"], limit: 50 });
  check("G6 anynote.captured events were emitted for the captures",
    evts.filter((e) => e.type === "anynote.captured").length >= 3, evts.length);
  const replyEvt = evts.find((e) => e.type === "anynote.reply.jarvis");
  check("G7 anynote.reply.jarvis emitted with ok:false (I4.1 turns this into attention)",
    replyEvt?.payload.replyId === json.jarvisReplyId && replyEvt?.payload.ok === false, replyEvt?.payload);

  const threadRes = await withId(repliesRoute.GET, textNoteId, req(`/api/anynotes/${textNoteId}/replies`));
  const thread = (await threadRes.json()).replies;
  check("G8 GET thread surfaces the error to the UI",
    threadRes.status === 200 && thread.some((r) => r.author === "jarvis" && r.error), thread.length);
}

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}  (temp db: ${tmpDb}, media: ${notesDir})`,
);
process.exit(failures === 0 ? 0 : 1); // route imports hold ensureV2 timers
