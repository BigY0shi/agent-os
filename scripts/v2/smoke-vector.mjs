// F1.3 smoke: vector.ts provider contract over a temp DB.
// Run: npx tsx scripts/v2/smoke-vector.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = path.join(os.tmpdir(), `agentos-smoke-vec-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;

const { __closeForTests } = await import("../../src/lib/v2/db.ts");
const vec = await import("../../src/lib/v2/memory/vector.ts");

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

const dim = 768;
const unit = (i) => {
  const v = new Array(dim).fill(0);
  v[i] = 1;
  return v;
};
const mix = (a, b, wa, wb) => {
  const v = new Array(dim).fill(0);
  v[a] = wa; v[b] = wb;
  const n = Math.hypot(wa, wb);
  return v.map((x) => x / n);
};

vec.upsert("episode", "e1", unit(0));
vec.upsert("episode", "e2", mix(0, 1, 0.9, 0.1));
vec.upsert("episode", "e3", unit(5));
check("count = 3", vec.count("episode") === 3);

const hits = vec.search("episode", unit(0), { limit: 3 });
check("search order e1,e2,e3", hits.map((h) => h.uuid).join(",") === "e1,e2,e3");
check("score(e1) = 1", Math.abs(hits[0].score - 1) < 1e-6);
check("score(e2) ≈ 0.99388", Math.abs(hits[1].score - 0.9938837) < 1e-4);

const thresholded = vec.search("episode", unit(0), { limit: 3, threshold: 0.5 });
check("threshold 0.5 drops orthogonal", thresholded.length === 2);

const excluded = vec.search("episode", unit(0), { limit: 3, excludeUuids: ["e1"] });
check("excludeUuids drops e1", !excluded.some((h) => h.uuid === "e1"));

const scores = vec.batchScore("episode", unit(0), ["e1", "e3", "ghost"]);
check("batchScore returns Map(2)", scores.size === 2);
check("batchScore e1=1", Math.abs(scores.get("e1") - 1) < 1e-6);
check("batchScore e3=0", Math.abs(scores.get("e3")) < 1e-6);

// upsert overwrite: move e3 near e1, order should change
vec.upsert("episode", "e3", mix(0, 5, 0.99, 0.01));
const hits2 = vec.search("episode", unit(0), { limit: 3 });
check("upsert overwrite reorders (e3 now 2nd)", hits2[1].uuid === "e3");
check("count still 3 after overwrite", vec.count("episode") === 3);

const g = vec.get("episode", "e1");
check("get returns Float32Array(768)", g instanceof Float32Array && g.length === 768 && g[0] === 1);
check("get missing returns null", vec.get("episode", "nope") === null);

vec.remove("episode", "e2");
check("remove drops to 2", vec.count("episode") === 2);
check("removed uuid gone from search", !vec.search("episode", unit(0), { limit: 5 }).some((h) => h.uuid === "e2"));

let threw = false;
try { vec.search("not-a-ns", unit(0), { limit: 1 }); } catch { threw = true; }
check("unknown namespace throws", threw);

__closeForTests();
try { fs.rmSync(tmp); fs.rmSync(tmp + "-wal", { force: true }); fs.rmSync(tmp + "-shm", { force: true }); } catch {}

console.log(failures === 0 ? "\nsmoke-vector: ALL PASS" : `\nsmoke-vector: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
