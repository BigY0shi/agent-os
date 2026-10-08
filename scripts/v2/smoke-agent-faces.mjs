// S35 Agent faces smoke: the generated Rorschach marks (lib/agentFaces.ts), the per-agent
// seed store behind "New shape" / "Reset" (lib/v2/agentFaces/seeds.ts), the API route,
// the hand-drawn marks staying untouched, and the surfaces + docs that carry a mark.
// Offline: settings and DB are redirected to a temp dir before any import (rule 19).
// Run: npx tsx scripts/v2/smoke-agent-faces.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-agent-faces-"));
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "agentos.db");
process.env.AGENTIC_OS_AGENTS_DIR = path.join(tmp, "agents");

const F = await import("../../src/lib/agentFaces.ts");
const S = await import("../../src/lib/v2/agentFaces/seeds.ts");
const route = await import("../../src/app/api/v2/agent-faces/route.ts");
const { readSettings } = await import("../../src/lib/settings.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  -> ${JSON.stringify(extra).slice(0, 300)}`}`);
  if (!cond) failures++;
};
const read = (p) => fs.readFileSync(p, "utf8");

// ── A. determinism ────────────────────────────────────────────────────────────
const ids = ["6f2c3a9e-1b4d-4c8e-9f0a-2b3c4d5e6f70", "jarvis-crew-researcher", "hermes:profile:sage", "x"];
for (const id of ids) {
  const a = F.generateMark(id), b = F.generateMark(id);
  check(`A1 ${id.slice(0, 18)}: same id draws the same mark (paths, spots, colour)`, JSON.stringify(a) === JSON.stringify(b));
  check(`A2 ${id.slice(0, 18)}: the default seed is the id's hash and is flagged derived`, a.seed === F.hashId(id) && a.derived === true);
}
const m0 = F.generateMark(ids[0]);
const m1 = F.generateMark(ids[0], { seed: 12345 });
const m2 = F.generateMark(ids[0], { seed: 12345 });
check("A3 an explicit seed changes the shape, keeps the accent, and is flagged not derived", JSON.stringify(m1.paths) !== JSON.stringify(m0.paths) && m1.gradient === m0.gradient && m1.accent === m0.accent && m1.derived === false);
check("A4 the same explicit seed draws the same shape", JSON.stringify(m1) === JSON.stringify(m2));
check("A5 different ids draw different shapes and different hues", JSON.stringify(F.generateMark(ids[1]).paths) !== JSON.stringify(m0.paths) && F.generateMark(ids[1]).hue !== m0.hue);
check("A6 nothing in the mark depends on time or Math.random (two runs 5 ms apart match)", await (async () => { const x = JSON.stringify(F.generateMark("t")); await new Promise((r) => setTimeout(r, 5)); return x === JSON.stringify(F.generateMark("t")); })());

// ── B. geometry: symmetry, bounds, detail ─────────────────────────────────────
const sample = [];
for (let i = 0; i < 300; i++) sample.push(F.generateMark(`agent-${i}`, { detail: F.FACE_DETAILS[i % 3] }));
const asym = sample.filter((m) => !F.isMirrorSymmetric(m));
check(`B1 every one of ${sample.length} marks is mirror-symmetric about x=12 (paths and spots)`, asym.length === 0, asym.slice(0, 2).map((m) => m.id));
const outOfBox = sample.filter((m) => m.paths.some((d) => F.pathPoints(d).some((p) => p.x < 0 || p.x > 24 || p.y < 0 || p.y > 24)) || m.spots.some((s) => s.cx - s.r < 0 || s.cx + s.r > 24 || s.cy - s.r < 0 || s.cy + s.r > 24));
check("B2 every coordinate sits inside the 24x24 viewBox", outOfBox.length === 0, outOfBox.slice(0, 2).map((m) => m.id));
const wellFormed = sample.every((m) => m.paths.length > 0 && m.paths.every((d) => /^M [\d. ]+( C [\d. ]+){4,}( Z)$/.test(d)));
check("B3 every path is M, cubic segments, Z (smooth closed blobs, no straight edges)", wellFormed);
const crossesAxis = sample.every((m) => m.paths.every((d) => { const pts = F.pathPoints(d); return pts[0].x === 12 && pts.some((p) => p.x > 12) && pts.some((p) => p.x < 12); }));
check("B4 every blob starts on the axis and spans both halves", crossesAxis);
check("B5 detail knob: low 2 lobes, medium 3, high 4; spots come in pairs plus at most one axis spot", F.generateMark("d", { detail: "low" }).paths.length === 2 && F.generateMark("d", { detail: "medium" }).paths.length === 3 && F.generateMark("d", { detail: "high" }).paths.length === 4 && sample.every((m) => { const off = m.spots.filter((s) => s.cx !== 12).length; const on = m.spots.filter((s) => s.cx === 12).length; return off % 2 === 0 && on <= 1; }));
check("B6 an unknown detail value falls back to medium (never a crash)", F.generateMark("d", { detail: "ultra" }).detail === "medium" && F.normalizeFaceDetail(undefined) === "medium");
check("B7 the symmetry check itself rejects an asymmetric shape", !F.isMirrorSymmetric({ paths: ["M 12 2 C 14 3 16 5 15 8 C 14 10 13 12 12 14 C 11 12 9 10 8 8 C 7 5 10 3 12 2 Z"], spots: [] }));

// ── C. hand-drawn marks untouched ─────────────────────────────────────────────
const avatar = read("src/components/AgentAvatar.tsx");
const styleKeys = [...avatar.matchAll(/^  ([a-z]+): \{\r?$/gm)].map((m) => m[1]);
check("C1 AgentAvatar STYLE still holds exactly the 13 hand-drawn agents, and HAND_DRAWN_AGENT_IDS lists the same set", styleKeys.length === 13 && JSON.stringify([...styleKeys].sort()) === JSON.stringify([...F.HAND_DRAWN_AGENT_IDS].sort()), styleKeys);
check("C2 Claude's four-point star path is byte-identical", avatar.includes('d="M12 2 L13.6 9 L21 10.4 L13.6 12.4 L12 22 L10.4 12.4 L3 10.4 L10.4 9 Z"'));
check("C3 Codex's six-petal rosette is byte-identical", avatar.includes('<path d="M12 4 C 16 6, 16 10, 12 12 C 8 10, 8 6, 12 4 Z" />') && avatar.includes('<path d="M5 8.5 C 8 6.5, 11.5 8, 12 12 C 8 14.5, 5 12.5, 5 8.5 Z" />'));
check("C4 the other brand marks are still there (OpenClaw claw, Hermes wings, Gemini star, Cursor arrow, Grok X)", ['d="M5 4 C 8 8, 8 14, 5 19"', "M12 3 L12 21 M12 5 C 8 8, 6 7, 4 5", 'd="M12 4 L13 10 L18 12 L13 14 L12 20 L11 14 L6 12 L11 10 Z"', 'd="M5 3 L5 18 L9 14 L11.5 20 L14 19 L11.5 13 L17 13 Z"', 'd="M6.5 5 L17.5 19 M17.5 5 L6.5 19"'].every((s) => avatar.includes(s)));
check("C5 an unknown id routes to the generated mark, never a letter or a blank", /if \(!s\) return <GeneratedAvatar/.test(avatar) && !/icon: null/.test(avatar));
check("C6 agentColor / agentBg / agentLabel answer for any id", avatar.includes("STYLE[agent as AgentKey]?.accent ?? accentFor(") && avatar.includes("STYLE[agent as AgentKey]?.label ?? String(agent)"));
check("C7 hasHandDrawnMark: claude yes, a UUID no", F.hasHandDrawnMark("claude") && F.hasHandDrawnMark("codex") && !F.hasHandDrawnMark(ids[0]));

// ── D. seed store: re-roll persists, reset restores ───────────────────────────
const id = ids[0];
check("D1 no seeds and detail medium on a fresh settings file", Object.keys(S.readFaceSeeds()).length === 0 && S.readFaceDetail() === "medium");
check("D2 markFor(id) with no seed is the id-derived mark", JSON.stringify(S.markFor(id)) === JSON.stringify(F.generateMark(id)));
const rr = S.rerollFaceSeed(id);
check("D3 reroll returns a new seed that differs from the id's hash and a mark drawn from it", typeof rr.seed === "number" && rr.seed !== F.hashId(id) && rr.mark.seed === rr.seed && rr.mark.derived === false && F.isMirrorSymmetric(rr.mark));
check("D4 the seed is on disk in settings.agents.faces.seeds (survives a reload)", JSON.parse(read(process.env.AGENTIC_OS_SETTINGS)).agents.faces.seeds[id] === rr.seed);
// A server restart is a fresh module instance reading the same file: re-import with a cache-busting query.
const S2 = await import(pathToFileURL(path.resolve("src/lib/v2/agentFaces/seeds.ts")).href + `?restart=${Date.now()}`);
check("D5 a fresh module instance (server restart) reads the same seed and draws the same shape", S2.readFaceSeeds()[id] === rr.seed && JSON.stringify(S2.markFor(id).paths) === JSON.stringify(rr.mark.paths));
const rr2 = S.rerollFaceSeed(id);
check("D6 a second reroll changes the seed again", rr2.seed !== rr.seed && JSON.stringify(rr2.mark.paths) !== JSON.stringify(rr.mark.paths));
const rs = S.resetFaceSeed(id);
check("D7 reset returns the id-derived shape and the reader shows no override", rs.seed === null && rs.mark.derived === true && JSON.stringify(rs.mark) === JSON.stringify(F.generateMark(id)) && S.readFaceSeeds()[id] === undefined);
check("D8 reset is spelled null on disk (deepMerge cannot drop a key) and the other settings survived", JSON.parse(read(process.env.AGENTIC_OS_SETTINGS)).agents.faces.seeds[id] === null && readSettings().agents.requireTestRun === true);
check("D9 every write went to the temp settings file, not the live one", process.env.AGENTIC_OS_SETTINGS.startsWith(tmp) && fs.existsSync(process.env.AGENTIC_OS_SETTINGS));

// ── E. API route ──────────────────────────────────────────────────────────────
const post = (body) => route.POST(new Request("http://x/api/v2/agent-faces", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
let r = await post({ id: ids[1], action: "reroll" }); let j = await r.json();
check("E1 POST reroll answers ok with the id, a numeric seed and a symmetric mark", r.status === 200 && j.ok && j.id === ids[1] && typeof j.seed === "number" && F.isMirrorSymmetric(j.mark));
const rerolled = j.seed;
r = await route.GET(); j = await r.json();
check("E2 GET lists the stored seed and the detail setting", r.status === 200 && j.ok && j.seeds[ids[1]] === rerolled && j.detail === "medium" && j.seeds[id] === undefined);
r = await post({ id: ids[1], action: "reset" }); j = await r.json();
check("E3 POST reset answers seed null and the id-derived mark", r.status === 200 && j.ok && j.seed === null && j.mark.derived === true);
r = await post({ id: "../etc", action: "reroll" });
check("E4 a bad id is a 400", r.status === 400 && (await r.json()).ok === false);
r = await post({ id: ids[1], action: "delete" });
check("E5 an unknown action is a 400", r.status === 400);
r = await post("{not json");
check("E6 a bad body is a 400", r.status === 400);

// ── F. surfaces and docs ──────────────────────────────────────────────────────
const surfaces = {
  "src/components/jarvis/CrewTab.tsx": [/<AgentAvatar agent=\{a\.id\} name=\{a\.name\} size=\{22\}/, /<AgentAvatar agent=\{agent\.id\} name=\{agent\.name\} size=\{28\}/],
  "src/components/jarvis/VoiceTab.tsx": [/<AgentAvatar agent=\{x\.id\} name=\{x\.name\}/],
  "src/components/v2/home/Cockpit.tsx": [/<AgentAvatar agent=\{l\.markId\} name=\{l\.name\}/],
  "src/components/v2/agents/AgentCardsGrid.tsx": [/<AgentAvatar agent=\{a\.id\} name=\{a\.name\} size=\{28\}/],
  "src/components/v2/agents/AgentsPageV2.tsx": [/<AgentAvatar agent=\{a\.id\} name=\{a\.name\} size=\{18\}/],
  "src/components/v2/agents/AgentsHero.tsx": [/<AgentAvatar agent=\{e\.agentId\} name=\{e\.name\}/],
  "src/components/v2/agents/AgentDetail.tsx": [/<AgentAvatar agent=\{agent\.id\} name=\{agent\.name\} size=\{36\}/, /New shape/, /Reset shape/, /faces\.reroll\(id\)/, /faces\.reset\(id\)/],
  "src/components/v2/agents/AgentsSettings.tsx": [/label="Mark detail"/, /FACE_DETAILS\.map/],
};
for (const [file, res] of Object.entries(surfaces)) {
  const t = read(file);
  check(`F1 ${path.basename(file)} draws the mark / carries its control`, res.every((re) => re.test(t)), res.filter((re) => !re.test(t)).map(String));
}
const docs = read("docs/modules/agents-page.md");
check("F2 agents-page.md documents Mark detail, New shape and Reset shape", /\*\*Mark detail\*\*/.test(docs) && /\| \*\*New shape\*\* \|/.test(docs) && /\| \*\*Reset shape\*\* \|/.test(docs));
check("F3 jarvis.md Crew and mission-control.md Orchestration mention the mark", /Roster cards and the chat header carry the agent's mark/.test(read("docs/modules/jarvis.md")) && /with its mark and live status/.test(read("docs/modules/mission-control.md")));
check("F4 settings.ts declares agents.faces with the medium default", /faces\?: \{\s*detail\?: "low" \| "medium" \| "high";/.test(read("src/lib/settings.ts")) && /faces: \{ detail: "medium", seeds: \{\} \}/.test(read("src/lib/settings.ts")));
check("F5 the pure generator imports nothing from node (safe for the client bundle)", !/from "node:|require\(/.test(read("src/lib/agentFaces.ts")));

console.log(failures === 0 ? "\nsmoke-agent-faces: all green" : `\nsmoke-agent-faces: ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
