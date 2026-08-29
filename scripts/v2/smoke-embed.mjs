// F1.5 smoke: real Ollama embeddings. Skips LOUDLY (exit 0 with warning) when
// Ollama is unreachable — network state isn't a code failure.
// Run: npx tsx scripts/v2/smoke-embed.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = path.join(os.tmpdir(), `agentos-smoke-embed-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-embed-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");

const { getEmbeddings } = await import("../../src/lib/v2/memory/embed.ts");
const { __closeForTests } = await import("../../src/lib/v2/db.ts");

const cleanup = () => {
  __closeForTests();
  try { fs.rmSync(tmp, { force: true }); fs.rmSync(tmp + "-wal", { force: true }); fs.rmSync(tmp + "-shm", { force: true }); fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
};

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

try {
  const probe = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(3000) });
  if (!probe.ok) throw new Error(`ollama probe ${probe.status}`);
} catch (e) {
  console.log(`SKIP  local Ollama not reachable at 127.0.0.1:11434 (${e.message}) — embed smoke skipped. Start Ollama and re-run.`);
  cleanup();
  process.exit(0);
}

try {
  const [dog, puppy, sheet] = await getEmbeddings(["a small dog", "a puppy", "quarterly revenue spreadsheet"]);
  check("dim = 768", dog.length === 768);
  const norm = Math.sqrt(dog.reduce((s, x) => s + x * x, 0));
  check("L2-normalized (|v| ≈ 1)", Math.abs(norm - 1) < 1e-4);
  const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  check("cos(dog,puppy) > cos(dog,spreadsheet)", cos(dog, puppy) > cos(dog, sheet));
  console.log(`      cos(dog,puppy)=${cos(dog, puppy).toFixed(3)} cos(dog,sheet)=${cos(dog, sheet).toFixed(3)}`);
} catch (e) {
  if (String(e).includes("pull")) {
    console.log(`SKIP  ${e.message}`);
    cleanup();
    process.exit(0);
  }
  check(`embed threw: ${e.message}`, false);
}

cleanup();
console.log(failures === 0 ? "\nsmoke-embed: ALL PASS" : `\nsmoke-embed: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
