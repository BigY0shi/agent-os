// S34 Jarvis chat upgrades (Nexora C6, on Jarvis), offline, stubbed brain.
//   A. sessions: named (title seeded + rename), listed, resumable after a "restart"
//      (DB handle closed and reopened, warm session dropped); "New conversation"
//      keeps the previous one listed, nothing archived or deleted
//   B. effort: per session, on the row; survives the restart; a change rebuilds
//      the warm session (done.sessionRebuilt === "effort") and reaches the SDK
//      options; the ask route and PATCH validate it; a new session takes the gear default
//   C. attachments: magic bytes decide (png/jpeg/webp in, text and gif out), the
//      size cap from settings refuses with the reason, files land under the
//      attachment dir, the upload route answers 413/415, and the brain pushes the
//      image as an image content block before the text; cli engine refuses loudly
//   D. wiring: overlay, gear, settings defaults, docs, migration 036
// The SDK's query() is swapped for a fake that reads the brain's streaming-input
// generator and answers with stream events, so the real pushed message is asserted.
// Run: npx tsx scripts/v2/smoke-jarvis-chat-upgrades.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const stamp = Date.now();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jchat-"));
process.env.AGENTIC_OS_DB = path.join(tmp, `agentos-smoke-jchat-${stamp}.db`);
const settingsFile = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_JARVIS_DIR = path.join(tmp, "jarvis");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
process.env.AGENTOS_MOCK_LLM = "1";
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // nothing listens: any recall/embed call fails fast
for (const k of ["OLLAMA_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[k];

const writeSettings = (obj) => fs.writeFileSync(settingsFile, JSON.stringify(obj, null, 2));
const baseSettings = (extra = {}) => ({
  jarvis: { engine: "sdk", cliAgent: "claude", chat: { defaultEffort: "", attachmentMaxMb: 4, attachmentDir: "" }, ...extra },
  memory: { ingestEnabled: false, embedProvider: "ollama-local", embedModel: "stub" },
});
writeSettings(baseSettings());

const db = await import("../../src/lib/v2/db.ts");
const conv = await import("../../src/lib/v2/jarvis/conversations.ts");
const att = await import("../../src/lib/v2/jarvis/attachments.ts");
const brain = await import("../../src/lib/v2/jarvis/brain.ts");
const { NextRequest } = await import("next/server");
const askRoute = await import("../../src/app/api/v2/jarvis/ask/route.ts");
const idRoute = await import("../../src/app/api/v2/jarvis/conversations/[id]/route.ts");
const attRoute = await import("../../src/app/api/v2/jarvis/attachments/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 400)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");
const ctxOf = (id) => ({ params: Promise.resolve({ id }) });

// ── fake SDK query: records boot options and every message the brain pushes ────
const boots = [];
const pushed = [];
let pushedThisTurn = null;
function fakeQuery({ prompt, options }) {
  boots.push(options);
  const it = prompt[Symbol.asyncIterator]();
  let phase = 0;
  return {
    async next() {
      if (phase === 0) {
        const { value } = await it.next();
        pushed.push(value);
        pushedThisTurn = value;
        phase = 1;
        return { done: false, value: { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "I see it. Noted." } } } };
      }
      phase = 0;
      return { done: false, value: { type: "result", total_cost_usd: 0.0001, is_error: false } };
    },
    async interrupt() {},
  };
}
brain.setJarvisQueryForTests(fakeQuery);

async function ask(input) {
  const events = [];
  pushedThisTurn = null;
  let thrown = null;
  let conversationId = null;
  try {
    conversationId = (await brain.askJarvisV2(input, (ev) => events.push(ev))).conversationId;
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e);
  }
  return {
    events,
    conversationId,
    thrown,
    meta: events.find((e) => e.type === "meta"),
    done: events.find((e) => e.type === "done"),
    error: events.find((e) => e.type === "error"),
    answer: events.filter((e) => e.type === "sentence").map((e) => e.text).join(" "),
    message: pushedThisTurn,
  };
}
const textOf = (msg) => (msg?.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");

// Images: a real 1x1 PNG, plus bytes that only carry the other signatures.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4, 0), Buffer.from("WEBPVP8 "), Buffer.alloc(16, 2)]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32, 3)]);
const TEXT = Buffer.from("this is not an image, whatever the name says\n".repeat(4));

// ══ A. sessions ═══════════════════════════════════════════════════════════════
console.log("── A. named, listed, resumable; new conversation keeps the old one");
db.ensureDb();
const cols = db.getDb().prepare("PRAGMA table_info(jarvis_conversations)").all().map((r) => r.name);
const mcols = db.getDb().prepare("PRAGMA table_info(jarvis_messages)").all().map((r) => r.name);
check("A0 migration 036 added effort + attachments_json", cols.includes("effort") && mcols.includes("attachments_json"), { cols, mcols });

const first = await ask({ text: "Plan the garage rebuild with me", channel: "overlay" });
check("A1 first ask starts a session and streams the fake answer", first.conversationId && first.meta?.conversationId === first.conversationId && first.answer === "I see it. Noted.", first);
const row1 = conv.getConversation(first.conversationId);
check("A2 the first words name the session", row1?.title === "Plan the garage rebuild with me", row1);
check("A3 rename sticks and is what the list shows", conv.renameConversation(first.conversationId, "Garage")?.title === "Garage" && conv.listConversations().find((c) => c.id === first.conversationId)?.title === "Garage");

const second = await ask({ text: "Something unrelated: tax deadlines", channel: "overlay" }); // = "New conversation": no id
check("A4 'New conversation' is a second row, the first still listed and live", second.conversationId !== first.conversationId
  && conv.listConversations().map((c) => c.id).includes(first.conversationId)
  && conv.getConversation(first.conversationId)?.archivedAt === null
  && conv.sessionCounts().live === 2, conv.sessionCounts());
check("A5 the second session is a cold boot of its own (warm session was on the first)", second.done?.sessionRebuilt === "conversation", second.done);

// "Server restart": close the DB handle and drop the warm session; the rows must still be there.
db.__closeForTests();
await brain.resetJarvisBrain();
const after = conv.listConversations();
check("A6 after the restart both sessions are listed with their messages", after.length === 2 && conv.listMessages(first.conversationId).length === 2 && conv.getConversation(first.conversationId)?.title === "Garage", after);
const resumed = await ask({ text: "where were we?", conversationId: first.conversationId, channel: "overlay" });
check("A7 resume after the restart rebuilds and replays the earlier turn", resumed.conversationId === first.conversationId && resumed.done?.sessionRebuilt === "no-session"
  && textOf(resumed.message).includes("<conversation_history>") && textOf(resumed.message).includes("Plan the garage rebuild with me"), textOf(resumed.message).slice(0, 300));

// ══ B. effort ═════════════════════════════════════════════════════════════════
console.log("── B. per-session thinking effort");
const e1 = await ask({ text: "think hard about this", effort: "high", channel: "overlay" });
check("B1 effort on the ask lands on the row, in meta, and in the SDK options", conv.getConversation(e1.conversationId)?.effort === "high" && e1.meta?.effort === "high" && boots.at(-1)?.effort === "high", { meta: e1.meta, boot: boots.at(-1)?.effort });
db.__closeForTests();
check("B2 effort survives the restart (read back from the reopened DB)", conv.getConversation(e1.conversationId)?.effort === "high");
const e2 = await ask({ text: "now quicker", effort: "low", conversationId: e1.conversationId });
check("B3 a changed effort rebuilds the warm session with the new level", e2.done?.sessionRebuilt === "effort" && boots.at(-1)?.effort === "low" && conv.getConversation(e1.conversationId)?.effort === "low", e2.done);
const e3 = await ask({ text: "and again", conversationId: e1.conversationId });
check("B4 an ask that says nothing about effort keeps the session's choice and the warm session", e3.done?.sessionRebuilt === null && conv.getConversation(e1.conversationId)?.effort === "low", e3.done);
const e4 = await ask({ text: "back to default", effort: null, conversationId: e1.conversationId });
check("B5 effort null clears it (model default): rebuilt, no effort key in the options", e4.done?.sessionRebuilt === "effort" && conv.getConversation(e1.conversationId)?.effort === null && !("effort" in boots.at(-1)), { boot: Object.keys(boots.at(-1)) });

writeSettings(baseSettings({ chat: { defaultEffort: "medium", attachmentMaxMb: 4, attachmentDir: "" } }));
const e5 = await ask({ text: "a fresh one", channel: "overlay" });
check("B6 a new session with no effort given takes the gear's default", conv.getConversation(e5.conversationId)?.effort === "medium" && e5.meta?.effort === "medium");
writeSettings(baseSettings());

let r = await idRoute.PATCH(new NextRequest(`http://x/api/v2/jarvis/conversations/${e1.conversationId}`, { method: "PATCH", body: JSON.stringify({ effort: "max" }) }), ctxOf(e1.conversationId));
check("B7 PATCH { effort } sets it", r.status === 200 && (await r.json()).conversation.effort === "max" && conv.getConversation(e1.conversationId)?.effort === "max");
r = await idRoute.PATCH(new NextRequest(`http://x/api/v2/jarvis/conversations/${e1.conversationId}`, { method: "PATCH", body: JSON.stringify({ effort: "turbo" }) }), ctxOf(e1.conversationId));
check("B8 PATCH with a bad effort is 400 and names the levels", r.status === 400 && /low, medium, high, xhigh, max/.test((await r.json()).error));
r = await idRoute.PATCH(new NextRequest(`http://x/api/v2/jarvis/conversations/${e1.conversationId}`, { method: "PATCH", body: JSON.stringify({ effort: "" }) }), ctxOf(e1.conversationId));
check("B9 PATCH { effort: '' } clears it", r.status === 200 && conv.getConversation(e1.conversationId)?.effort === null);
r = await idRoute.PATCH(new NextRequest(`http://x/api/v2/jarvis/conversations/nope`, { method: "PATCH", body: JSON.stringify({ effort: "low" }) }), ctxOf("nope"));
check("B10 PATCH effort on an unknown id is 404", r.status === 404);
r = await askRoute.POST(new Request("http://x/api/v2/jarvis/ask", { method: "POST", body: JSON.stringify({ text: "hi", effort: "turbo" }) }));
check("B11 the ask route rejects a bad effort before anything runs", r.status === 400 && /effort must be one of/.test((await r.json()).error));
check("B12 the gear's effort list matches the store's", JSON.stringify(conv.JARVIS_EFFORTS) === JSON.stringify(["low", "medium", "high", "xhigh", "max"]));

// ══ C. attachments ════════════════════════════════════════════════════════════
console.log("── C. image attachments");
const dir = att.attachmentsDir();
// (On Windows the temp dir is itself under the home dir, so "not under home" is not the test;
//  "not under ~/.agentic-os" is.)
check("C1 the attachment dir is under the redirected jarvis dir, not the real ~/.agentic-os", dir.startsWith(process.env.AGENTIC_OS_JARVIS_DIR) && !dir.includes(".agentic-os"), dir);
const png = att.storeAttachment({ name: "shot.png", bytes: PNG });
check("C2 a real PNG is stored by magic bytes and lands on disk", png.mime === "image/png" && png.bytes === PNG.length && png.name === "shot.png" && fs.existsSync(path.join(dir, `${png.id}.png`)), png);
check("C3 jpeg and webp are accepted by their bytes, named by their bytes not the filename",
  att.storeAttachment({ name: "a.bin", bytes: JPEG }).mime === "image/jpeg" && att.storeAttachment({ name: "b", bytes: WEBP }).mime === "image/webp");
const refuse = (input) => { try { att.storeAttachment(input); return null; } catch (e) { return e; } };
let err = refuse({ name: "photo.png", bytes: TEXT });
check("C4 a text file named .png is refused as not an image (415) with the reason", err?.name === "AttachmentRefused" && err.status === 415 && /not an image/.test(err.message), err?.message);
err = refuse({ name: "anim.gif", bytes: GIF });
check("C5 gif is refused (only png, jpeg, webp)", err?.status === 415, err?.message);
check("C6 the default cap is 4 MB", att.attachmentMaxBytes() === 4 * 1024 * 1024);
writeSettings(baseSettings({ chat: { defaultEffort: "", attachmentMaxMb: 0.0001, attachmentDir: "" } }));
err = refuse({ name: "big.png", bytes: Buffer.concat([PNG, Buffer.alloc(200)]) });
check("C7 over the cap from settings is refused (413) and the reason says the cap", err?.status === 413 && /too large/.test(err.message) && /cap is/.test(err.message), err?.message);
const customDir = path.join(tmp, "elsewhere");
writeSettings(baseSettings({ chat: { defaultEffort: "", attachmentMaxMb: 4, attachmentDir: customDir } }));
const moved = att.storeAttachment({ name: "x.png", bytes: PNG });
check("C8 the attachment folder setting is honoured", fs.existsSync(path.join(customDir, `${moved.id}.png`)) && att.getAttachment(moved.id)?.mime === "image/png");
writeSettings(baseSettings());
check("C9 an id that is not on disk reads back as null; a non-uuid id never touches the filesystem", att.getAttachment(moved.id) === null && att.getAttachment("../../etc/passwd") === null);

// the upload route
const post = async (bytes, name, type) => {
  const fd = new FormData();
  fd.append("file", new File([bytes], name, { type }));
  const res = await attRoute.POST(new Request("http://x/api/v2/jarvis/attachments", { method: "POST", body: fd }));
  return { status: res.status, body: await res.json() };
};
let up = await post(PNG, "paste.png", "image/png");
check("C10 POST multipart png answers the ref", up.status === 200 && up.body.attachment?.mime === "image/png" && up.body.attachment.name === "paste.png" && fs.existsSync(path.join(dir, `${up.body.attachment.id}.png`)), up);
const uploadedId = up.body.attachment?.id;
up = await post(TEXT, "notes.png", "image/png");
check("C11 POST a text file with an image name and type is 415 with the reason", up.status === 415 && /not an image/.test(up.body.error), up);
writeSettings(baseSettings({ chat: { defaultEffort: "", attachmentMaxMb: 0.0001, attachmentDir: "" } }));
up = await post(Buffer.concat([PNG, Buffer.alloc(200)]), "big.png", "image/png");
check("C12 POST over the cap is 413 with the cap in the reason", up.status === 413 && /too large/.test(up.body.error), up);
writeSettings(baseSettings());
r = await attRoute.POST(new Request("http://x/api/v2/jarvis/attachments", { method: "POST", body: JSON.stringify({ nope: 1 }), headers: { "content-type": "application/json" } }));
check("C13 POST without multipart is 400", r.status === 400);
r = await attRoute.GET();
check("C14 GET reports the cap in bytes", (await r.json()).maxBytes === 4 * 1024 * 1024);

// the brain: the image reaches the SDK as an image block, the row keeps the ref
const before = conv.sessionCounts().messages;
const withImage = await ask({ text: "what is in this picture?", attachments: [{ id: uploadedId, name: "paste.png" }], channel: "overlay" });
const content = withImage.message?.message?.content ?? [];
check("C15 the pushed user message carries an image block FIRST, then the text", content[0]?.type === "image" && content[0].source?.type === "base64" && content[0].source.media_type === "image/png" && content.at(-1)?.type === "text" && /what is in this picture/.test(content.at(-1).text), content.map((b) => b.type));
check("C16 the image block's bytes are the stored file's bytes", content[0]?.source?.data === PNG.toString("base64"));
const userRow = conv.listMessages(withImage.conversationId).find((m) => m.role === "user");
check("C17 the user row keeps the attachment ref (id, name, mime, bytes), not the bytes", userRow?.attachments?.length === 1 && userRow.attachments[0].id === uploadedId && userRow.attachments[0].mime === "image/png" && userRow.attachments[0].bytes === PNG.length && !userRow.content.includes("base64"), userRow?.attachments);
check("C18 the answer streamed as usual", withImage.answer === "I see it. Noted." && withImage.done && !withImage.error);
const plain = await ask({ text: "and without a picture", conversationId: withImage.conversationId });
check("C19 the next turn without an attachment pushes text only", (plain.message?.message?.content ?? []).every((b) => b.type === "text"));
await brain.resetJarvisBrain();
const replay = await ask({ text: "remind me", conversationId: withImage.conversationId });
check("C20 a resumed session names the earlier image in history, does not replay its bytes", /\[image attached: paste\.png\]/.test(textOf(replay.message)) && !textOf(replay.message).includes(PNG.toString("base64").slice(0, 20)) && (replay.message?.message?.content ?? []).every((b) => b.type === "text"));

const countBefore = conv.sessionCounts().messages;
const missing = await ask({ text: "see this?", attachments: [{ id: "00000000-0000-4000-8000-000000000000", name: "gone.png" }] });
check("C21 an unknown attachment id fails loudly and persists nothing", /not found/.test(missing.thrown ?? "") && conv.sessionCounts().messages === countBefore, missing.thrown);
writeSettings(baseSettings({ engine: "cli" }));
const cli = await ask({ text: "see this?", attachments: [{ id: uploadedId, name: "paste.png" }] });
check("C22 the cli engine refuses attachments with the reason and persists nothing", /sdk engine/.test(cli.thrown ?? "") && /text-only/.test(cli.thrown ?? "") && conv.sessionCounts().messages === countBefore, cli.thrown);
writeSettings(baseSettings());
r = await askRoute.POST(new Request("http://x/api/v2/jarvis/ask", { method: "POST", body: JSON.stringify({ text: "hi", attachments: [{ id: uploadedId }, { id: uploadedId }] }) }));
check("C23 the ask route allows one image per message", r.status === 400 && /one image per message/.test((await r.json()).error));
r = await askRoute.POST(new Request("http://x/api/v2/jarvis/ask", { method: "POST", body: JSON.stringify({ text: "hi", attachments: "x" }) }));
check("C24 the ask route rejects a non-array attachments field", r.status === 400);
check("C25 messages seeded in A are intact (C ran on its own sessions)", conv.sessionCounts().messages > before);

// ══ D. wiring ═════════════════════════════════════════════════════════════════
console.log("── D. wiring: overlay, gear, settings, docs, migration");
const overlay = read("src/components/v2/jarvis/ChatboxOverlay.tsx");
check("D1 the overlay keeps the session id across reloads (localStorage), and forgets a session that is gone", overlay.includes('OVERLAY_SESSION_KEY = "agentos.jarvis.overlay.conversation"') && overlay.includes("localStorage.setItem(OVERLAY_SESSION_KEY") && overlay.includes("localStorage.getItem(OVERLAY_SESSION_KEY") && overlay.includes("localStorage.removeItem(OVERLAY_SESSION_KEY"));
const newConvBody = overlay.slice(overlay.indexOf("const newConversation = useCallback"), overlay.indexOf("const commitRename"));
check("D2 'New conversation' clears the thread and never archives or deletes", newConvBody.includes("conversationIdRef.current = null") && !newConvBody.includes("DELETE") && !newConvBody.includes("fetch("));
check("D3 the overlay names the session (rename via PATCH { title })", overlay.includes("commitRename") && overlay.includes('body: JSON.stringify({ title })') && overlay.includes("setSessionTitle(data.conversation?.title"));
check("D4 the overlay sends the effort on every ask and PATCHes it on change; loads it on resume", overlay.includes('effort: effortRef.current || ""') && overlay.includes("body: JSON.stringify({ effort: next })") && overlay.includes('setEffort(data.conversation?.effort ?? "")') && overlay.includes("EFFORT_OPTIONS.map"));
check("D5 the overlay uploads to the attachments route, pastes images, sends the ref, shows refusals", overlay.includes('fetch("/api/v2/jarvis/attachments", { method: "POST", body: fd })') && overlay.includes("onPaste=") && overlay.includes("attachments: [{ id: pending.id, name: pending.name }]") && overlay.includes("Attachment refused:") && overlay.includes('accept="image/png,image/jpeg,image/webp"'));
const gear = read("src/components/v2/jarvis/JarvisSettings.tsx");
check("D6 the gear has the three chat knobs", gear.includes("Default thinking effort") && gear.includes("Attachment size cap (MB)") && gear.includes("Attachment folder") && gear.includes("patchChat({ defaultEffort") && gear.includes("patchChat({ attachmentMaxMb") && gear.includes("patchChat({ attachmentDir"));
const S = await import("../../src/lib/settings.ts");
const chatDefaults = S.DEFAULT_SETTINGS?.jarvis?.chat ?? S.readSettings().jarvis?.chat;
check("D7 settings defaults: effort unset, 4 MB, default folder", chatDefaults && chatDefaults.defaultEffort === "" && chatDefaults.attachmentMaxMb === 4 && chatDefaults.attachmentDir === "", chatDefaults);
const doc = read("docs/modules/jarvis.md");
check("D8 the docs cover the orb chat controls", /^### Orb chat/m.test(doc) && doc.includes("**think:** select") && doc.includes("Paperclip") && doc.includes("**New conversation**") && doc.includes("**Default thinking effort**") && doc.includes("**Attachment size cap (MB)**") && doc.includes("**Attachment folder**"));
const schema = read("src/lib/v2/dbSchema.ts");
check("D9 migration 036 is contributed, not edited in place", /version: 36,\s*\n\s*name: "jarvis_chat_upgrades"/.test(schema) && schema.includes("ALTER TABLE jarvis_conversations ADD COLUMN effort TEXT") && schema.includes("ALTER TABLE jarvis_messages ADD COLUMN attachments_json TEXT"));
const brainSrc = read("src/lib/v2/jarvis/brain.ts");
check("D10 the brain keys the warm session on effort and passes it to the SDK", brainSrc.includes('session.effort !== conv.effort ? "effort"') && brainSrc.includes("...(effort ? { effort } : {})"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
