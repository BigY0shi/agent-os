// A2.2 smoke: every ported prompt file exports non-empty prompt text; the
// NOTHING_TO_REMEMBER contract survives in normalize; userName defaults to
// "Yoshi". Pure compute (no DB, no network). Run: npx tsx scripts/v2/smoke-prompts.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Temp env BEFORE imports — never touch the live DB/settings (house rule).
const tmp = path.join(os.tmpdir(), `agentos-smoke-prompts-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-prompts-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

const flat = (messages) => messages.map((m) => m.content).join("\n");

const ctx = {
  episodeContent: "I moved to LA last week and I prefer dark mode.",
  source: "smoke",
  episodeTimestamp: "2026-08-27T00:00:00.000Z",
  sessionContext: "",
  relatedMemories: "",
  entityTypes: "Person, Organization, Place",
};

// ---- normalize ----
const normalize = await import("../../src/lib/v2/memory/prompts/normalize.ts");
{
  const msgs = normalize.normalizePrompt(ctx);
  const text = flat(msgs);
  check("normalizePrompt returns system+user messages", msgs.length === 2 && text.length > 1000);
  check("normalize keeps NOTHING_TO_REMEMBER contract", text.includes("NOTHING_TO_REMEMBER"));
  check("normalize keeps <output> tag instructions", text.includes("<output>") && text.includes("</output>"));
  check("normalize defaults userName to Yoshi", text.includes("The user in this conversation is: Yoshi"));
  check(
    "normalize honors explicit userName",
    flat(normalize.normalizePrompt({ ...ctx, userName: "Julian" })).includes("The user in this conversation is: Julian"),
  );
  const doc = flat(normalize.normalizeDocumentPrompt(ctx));
  check("normalizeDocumentPrompt non-empty + NOTHING_TO_REMEMBER", doc.length > 500 && doc.includes("NOTHING_TO_REMEMBER"));
}

// ---- extract-world / extract-voice ----
const extractWorld = await import("../../src/lib/v2/memory/prompts/extract-world.ts");
const extractVoice = await import("../../src/lib/v2/memory/prompts/extract-voice.ts");
{
  const w = flat(extractWorld.extractWorldPrompt(ctx));
  check("extractWorldPrompt non-empty", w.length > 1000);
  check("extract-world defaults userName to Yoshi", w.includes('"Yoshi" IS the user'));
  check("ExtractWorldSchema exported (zod)", typeof extractWorld.ExtractWorldSchema?.safeParse === "function");
  const v = flat(extractVoice.extractVoicePrompt(ctx));
  check("extractVoicePrompt non-empty", v.length > 1000);
  check("extract-voice defaults userName to Yoshi", v.includes("The user is: Yoshi"));
  check("ExtractVoiceSchema exported (zod)", typeof extractVoice.ExtractVoiceSchema?.safeParse === "function");
}

// ---- reflect-world / reflect-voice ----
const reflectWorld = await import("../../src/lib/v2/memory/prompts/reflect-world.ts");
const reflectVoice = await import("../../src/lib/v2/memory/prompts/reflect-voice.ts");
{
  const facts = [{ source: "Yoshi", predicate: "lives in", target: "LA", fact: "Yoshi lives in LA", event_date: null }];
  check("reflectWorldPrompt non-empty", flat(reflectWorld.reflectWorldPrompt(facts, ctx.episodeContent)).length > 500);
  check("ReflectWorldSchema exported (zod)", typeof reflectWorld.ReflectWorldSchema?.safeParse === "function");
  check(
    "reflectVoicePrompt non-empty",
    flat(reflectVoice.reflectVoicePrompt([{ fact: "Yoshi prefers dark mode" }], ctx.episodeContent)).length > 500,
  );
  check("ReflectVoiceSchema exported (zod)", typeof reflectVoice.ReflectVoiceSchema?.safeParse === "function");
}

// ---- classify-world / classify-voice ----
const classifyWorld = await import("../../src/lib/v2/memory/prompts/classify-world.ts");
const classifyVoice = await import("../../src/lib/v2/memory/prompts/classify-voice.ts");
{
  const facts = [{ source: "Yoshi", predicate: "lives in", target: "LA", fact: "Yoshi lives in LA", event_date: null }];
  const w = flat(classifyWorld.classifyWorldPrompt(facts));
  check("classifyWorldPrompt non-empty", w.length > 500);
  check("classify-world defaults userName to Yoshi", w.includes('"Yoshi" IS the user'));
  check("ClassifyWorldSchema exported (zod)", typeof classifyWorld.ClassifyWorldSchema?.safeParse === "function");
  const v = flat(classifyVoice.classifyVoicePrompt([{ fact: "Yoshi prefers dark mode" }]));
  check("classifyVoicePrompt non-empty", v.length > 500);
  check("ClassifyVoiceSchema exported (zod)", typeof classifyVoice.ClassifyVoiceSchema?.safeParse === "function");
}

// ---- statements / nodes / aspect-resolution ----
const statements = await import("../../src/lib/v2/memory/prompts/statements.ts");
const nodes = await import("../../src/lib/v2/memory/prompts/nodes.ts");
const aspectResolution = await import("../../src/lib/v2/memory/prompts/aspect-resolution.ts");
{
  check(
    "resolveStatementPrompt non-empty",
    flat(
      statements.resolveStatementPrompt({
        episodeContent: ctx.episodeContent,
        newStatements: [],
        similarStatements: [],
        referenceTime: ctx.episodeTimestamp,
      }),
    ).length > 300,
  );
  check(
    "dedupeNodes non-empty",
    flat(nodes.dedupeNodes({ episodeContent: ctx.episodeContent, previousEpisodes: [], extracted_nodes: [] })).length > 300,
  );
  const a = flat(
    aspectResolution.aspectResolutionPrompt(
      [{ id: "n1", fact: "Yoshi prefers dark mode", aspect: "Preference" }],
      [{ id: "e1", fact: "Yoshi likes dark themes", aspect: "Preference", score: 0.8 }],
    ),
  );
  check("aspectResolutionPrompt non-empty", a.length > 300);
  check("AspectResolutionSchema exported (zod)", typeof aspectResolution.AspectResolutionSchema?.safeParse === "function");
}

try {
  fs.rmSync(settingsDir, { recursive: true, force: true });
} catch {}
console.log(failures === 0 ? "\nsmoke-prompts: ALL PASS" : `\nsmoke-prompts: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
