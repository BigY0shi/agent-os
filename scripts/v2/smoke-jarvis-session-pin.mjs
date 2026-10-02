// Jarvis warm-session persona pin, offline (2026-09-29).
// Root cause of the intermittent smoke-jarvis-brain "turn 2 reused the warm session"
// failure: every turn is ingested fire-and-forget, a finished ingest can rewrite the
// persona document (queue.ts post-COMPLETED personaTrigger), and the persona is part
// of the stable system prompt, so a rewrite that landed before the next message threw
// the warm session away mid-conversation.
//   A. the mechanism is real: a different persona gives a different stable prompt
//   B. the chain exists in code: ingest -> personaTrigger, persona in the stable prompt
//   C. the fix: brain.ts pins the persona per session and reports why it rebuilt
// Run: npx tsx scripts/v2/smoke-jarvis-session-pin.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-sessionpin-"));
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_SKILLS_DIR = path.join(tmp, "skills");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
process.env.AGENTIC_OS_JARVIS_DIR = path.join(tmp, "jarvis");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 260)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");

const ctx = await import("../../src/lib/v2/jarvis/context.ts");
const base = { skillPolicies: null, skillNames: [] };
const none = ctx.buildStableSystemPrompt({ ...base, personaDocContent: null });
const a = ctx.buildStableSystemPrompt({ ...base, personaDocContent: "Yoshi prefers short answers." });
const b = ctx.buildStableSystemPrompt({ ...base, personaDocContent: "Yoshi prefers short answers. He works late." });
check("A1 a persona appearing changes the stable prompt", none !== a);
check("A2 a persona update changes the stable prompt", a !== b);
check("A3 the same persona gives the same stable prompt", a === ctx.buildStableSystemPrompt({ ...base, personaDocContent: "Yoshi prefers short answers." }));

const queue = read("src/lib/v2/memory/queue.ts");
const persona = read("src/lib/v2/memory/persona.ts");
const brain = read("src/lib/v2/jarvis/brain.ts");
check("B1 a completed ingest runs the persona trigger", /setStage\(row\.id, "persona"\)[\s\S]{0,200}await personaTrigger\(episodeUuid\)/.test(queue));
check("B2 no persona yet -> the trigger generates one", /if \(!latestPersona\) \{\s*return \{\s*shouldGenerate: true/.test(persona));
check("B3 every turn is ingested fire-and-forget", /ingestExchange\(conv\.id, text, answer, run\.tainted\);/.test(brain) && /ingestFromModule\(\{[\s\S]{0,300}\}\)\.catch\(/.test(brain));

check("C1 the session carries its pinned persona", /personaDoc: string \| null;/.test(brain) && /bootSession\(conv\.id, freshStable, sig, freshPersona\)/.test(brain));
check("C2 same conversation -> the pinned persona builds the stable prompt", brain.includes("const personaDoc = prior && prior.conversationId === conv.id ? prior.personaDoc : currentPersonaDoc();") && brain.includes("buildStableSystemPrompt({ personaDocContent: personaDoc })"));
check("C3 the done event says why a session was rebuilt", /sessionRebuilt: rebuildReason/.test(brain) && /done\.sessionRebuilt = sdkRun\.sessionRebuilt \?\? null;/.test(brain));
check("C4 rebuild reasons are named", ["no-session", "conversation", "system-prompt", "tools"].every((r) => brain.includes(`"${r}"`)));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
