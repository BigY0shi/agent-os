// A2.1 smoke: (1) OFFLINE — the exported structured-output parser's three
// fallback paths (raw JSON / <output>-wrapped / prose-with-JSON-block) plus
// loud-failure cases; (2) ONLINE — one low unstructured call + one structured
// round trip against a reachable Ollama (local preferred, cloud if
// OLLAMA_API_KEY is set). Skips the online half LOUDLY with exit 0 when no
// provider is reachable — network state isn't a code failure.
// Run: npx tsx scripts/v2/smoke-llm.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Temp env BEFORE imports — never touch the live DB/settings (house rule).
const tmp = path.join(os.tmpdir(), `agentos-smoke-llm-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-llm-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;

const { z } = await import("zod");

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};
const cleanup = () => {
  try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
};
const finish = () => {
  cleanup();
  console.log(failures === 0 ? "\nsmoke-llm: ALL PASS" : `\nsmoke-llm: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
};

// ---------------------------------------------------------------------------
// Part 1 — OFFLINE parser coverage (no network, must always run)
// ---------------------------------------------------------------------------
const { parseStructured, extractOutputTag } = await import("../../src/lib/v2/memory/llm.ts");
const schema = z.object({ answer: z.string() });

// path 1: raw JSON
check("parser path 1: direct JSON", parseStructured('{"answer":"pong"}', schema).answer === "pong");
// path 2: <output>-wrapped
check(
  "parser path 2: <output> tag",
  parseStructured('Sure, here you go:\n<output>\n{"answer":"pong"}\n</output>\nDone!', schema).answer === "pong",
);
// path 3: prose with a bare JSON block
check(
  "parser path 3: {...} block in prose",
  parseStructured('Here is the JSON you asked for: {"answer":"pong"} — hope that helps!', schema).answer === "pong",
);
// nested braces survive the block extraction
const nested = z.object({ outer: z.object({ inner: z.string() }) });
check(
  "parser path 3: nested braces",
  parseStructured('result: {"outer":{"inner":"x"}} trailing', nested).outer.inner === "x",
);
// markdown-fenced JSON lands via path 3 too
check(
  "parser: markdown-fenced JSON",
  parseStructured('```json\n{"answer":"pong"}\n```', schema).answer === "pong",
);
// no JSON at all -> loud throw with raw tail
let threwNoJson = false;
try {
  parseStructured("I could not produce any structured output, sorry.", schema);
} catch (e) {
  threwNoJson = /no JSON found/.test(e.message) && /Raw tail/.test(e.message);
}
check("parser throws loudly when no JSON found (tail included)", threwNoJson);
// JSON parses but fails schema -> loud throw naming the field
let threwBadSchema = false;
try {
  parseStructured('{"answer": 42}', schema);
} catch (e) {
  threwBadSchema = /schema validation/.test(e.message) && /answer/.test(e.message);
}
check("parser throws loudly on schema mismatch", threwBadSchema);
// extractOutputTag helper
check("extractOutputTag pulls inner text", extractOutputTag("x <output> NOTHING_TO_REMEMBER </output>") === "NOTHING_TO_REMEMBER");
check("extractOutputTag null when absent", extractOutputTag("no tags here") === null);

// ---------------------------------------------------------------------------
// Part 2 — ONLINE provider round trip (skip loudly when unreachable)
// ---------------------------------------------------------------------------
const OLLAMA_LOCAL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
let providerCfg = null; // { provider, model, label }

// Prefer local Ollama with an installed (non-embed) chat model.
try {
  const tags = await fetch(`${OLLAMA_LOCAL}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (tags.ok) {
    const data = await tags.json();
    const model = (data.models || []).map((m) => m.name).find((n) => !/embed/i.test(n));
    if (model) providerCfg = { provider: "ollama-local", model, label: `ollama-local (${model})` };
    else console.log("      local Ollama up but no non-embed chat model installed — trying cloud.");
  }
} catch {
  /* local not reachable */
}

// Fall back to Ollama Cloud when a key is present and the API answers.
if (!providerCfg && process.env.OLLAMA_API_KEY) {
  try {
    const probe = await fetch("https://ollama.com/api/tags", {
      headers: { authorization: `Bearer ${process.env.OLLAMA_API_KEY}` },
      signal: AbortSignal.timeout(6000),
    });
    if (probe.ok) providerCfg = { provider: "ollama-cloud", model: "", label: "ollama-cloud (settings defaults)" };
  } catch {
    /* cloud not reachable */
  }
}

if (!providerCfg) {
  console.log(
    "SKIP  no reachable LLM provider (local Ollama down / no chat model, and no working OLLAMA_API_KEY) — " +
      "online modelCall smoke skipped. Start Ollama (`ollama serve` + pull a chat model) and re-run.",
  );
  finish();
}

// Point settings.memory at the reachable provider (temp settings file only).
const memory = { provider: providerCfg.provider };
if (providerCfg.model) {
  memory.modelLow = providerCfg.model;
  memory.modelMedium = providerCfg.model;
}
fs.writeFileSync(settingsFile, JSON.stringify({ memory }, null, 2));

const { modelCall, modelCallText } = await import("../../src/lib/v2/memory/llm.ts");
console.log(`      online provider: ${providerCfg.label}`);

try {
  const text = await modelCallText(
    [{ role: "user", content: "Reply with the single word: pong" }],
    "low",
    { timeoutMs: 120_000, temperature: 0 },
  );
  check(`low unstructured call returns non-empty ("${text.slice(0, 40)}")`, text.trim().length > 0);
} catch (e) {
  check(`low unstructured call threw: ${e.message}`, false);
}

try {
  const out = await modelCall(
    [
      {
        role: "user",
        content: 'Answer this question as JSON with a single string field "answer": what sound does ping expect back?',
      },
    ],
    "low",
    { schema, timeoutMs: 120_000, temperature: 0 },
  );
  check(`structured call round-trips zod schema (answer="${String(out.answer).slice(0, 40)}")`, typeof out.answer === "string" && out.answer.length > 0);
} catch (e) {
  check(`structured call threw: ${e.message}`, false);
}

finish();
