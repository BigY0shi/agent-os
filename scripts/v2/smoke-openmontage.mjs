// S9 smoke: the OpenMontage module, fully offline.
//
// Run: npx tsx scripts/v2/smoke-openmontage.mjs
//
// Rule 19: AGENTIC_OS_SETTINGS, AGENTIC_OS_RUNS_DIR and AGENTIC_OS_DB are
// redirected BEFORE any import. The "checkout" is a fake built in a temp dir
// (AGENT_GUIDE.md + pipeline_defs/*.yaml); python and the CLI agent are fakes
// injected through the exec / spawnAgent seams, so nothing on this machine is
// run, read or installed. The owner's real checkout is never touched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-openmontage-"));
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_RUNS_DIR = path.join(tmp, "runs");
process.env.AGENTIC_OS_DB = path.join(tmp, "agentos.db");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !extra ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 400)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// ---- the fake checkout -------------------------------------------------------
const repo = path.join(tmp, "OpenMontage");
fs.mkdirSync(path.join(repo, "pipeline_defs"), { recursive: true });
fs.writeFileSync(path.join(repo, "AGENT_GUIDE.md"), "# fake guide\n");
fs.writeFileSync(path.join(repo, "requirements.txt"), "pyyaml>=6.0\n");
fs.writeFileSync(path.join(repo, "pipeline_defs", "animated-explainer.yaml"), [
  "name: animated-explainer", 'version: "2.0"', "description: AI-produced explainer with research, narration, visuals, music.",
  "category: generated", "stability: production", "orchestration:", "  mode: executive-producer", "  budget_default_usd: 2.00",
  "stages:", "  - name: research", "    produces: [research_brief]", "  - name: script", "  - name: compose",
].join("\n"));
fs.writeFileSync(path.join(repo, "pipeline_defs", "framework-smoke.yaml"), "name: framework-smoke\nversion: \"1.0\"\ndescription: Minimal manifest.\ncategory: custom\nstages:\n  - name: research\n  - name: script\n");
fs.writeFileSync(path.join(repo, "pipeline_defs", "broken.yaml"), "name: broken\nstages: [unclosed\n");
fs.writeFileSync(path.join(repo, "pipeline_defs", "notes.txt"), "not a manifest");

const C = await import("../../src/lib/v2/openmontage/config.ts");
const P = await import("../../src/lib/v2/openmontage/pipelines.ts");
const D = await import("../../src/lib/v2/openmontage/doctor.ts");
const R = await import("../../src/lib/v2/openmontage/run.ts");
const PF = await import("../../src/lib/v2/openmontage/preflight.ts");
const M = await import("../../src/lib/moduleRuns.ts");
const S = await import("../../src/lib/settings.ts");

const cfgOf = (over = {}) => C.resolveOpenMontageConfig({ repoPath: repo, pythonBin: "fake-python", outputDir: path.join(tmp, "out"), agent: "claude", fallbackAgent: "codex", timeoutMin: 1, ...over });

// ── A settings defaults ───────────────────────────────────────────────────────
console.log("\n── A settings defaults ──");
const d = S.DEFAULT_SETTINGS.openmontage;
check("A1 DEFAULT_SETTINGS.openmontage carries the five gear knobs", d && d.pythonBin === "python" && d.agent === "claude" && d.fallbackAgent === "codex" && d.timeoutMin === 90 && d.repoPath === "" && d.outputDir === "", d);
const rc = C.resolveOpenMontageConfig({});
check("A2 empty repo path resolves to <home>/Documents/OpenMontage", rc.repoPath === path.join(os.homedir(), "Documents", "OpenMontage") && rc.defaulted.repoPath, rc.repoPath);
check("A3 empty output dir resolves to <repo>/projects", rc.outputDir === path.join(rc.repoPath, "projects") && rc.defaulted.outputDir, rc.outputDir);
check("A4 python defaults to \"python\" (never python3), timeout 90, claude with codex fallback", rc.pythonBin === "python" && rc.timeoutMin === 90 && rc.agent === "claude" && rc.fallbackAgent === "codex");
const rc2 = C.resolveOpenMontageConfig({ repoPath: repo, outputDir: "   ", fallbackAgent: "none", timeoutMin: -5, pythonBin: " .venv/Scripts/python.exe " });
check("A5 gear values win and are trimmed; a bad timeout falls back to the default", rc2.repoPath === path.resolve(repo) && rc2.fallbackAgent === "none" && rc2.timeoutMin === 90 && rc2.pythonBin === ".venv/Scripts/python.exe" && !rc2.defaulted.repoPath);
const settingsSrc = read("src/lib/settings.ts");
check("A6 settings.ts declares the openmontage block with repoPath, pythonBin, outputDir, agent, fallbackAgent, timeoutMin", /openmontage\?: \{[\s\S]*?repoPath\?: string;[\s\S]*?pythonBin\?: string;[\s\S]*?outputDir\?: string;[\s\S]*?agent\?: string;[\s\S]*?fallbackAgent\?: "codex" \| "none";[\s\S]*?timeoutMin\?: number;/.test(settingsSrc));

// ── B pipeline discovery ──────────────────────────────────────────────────────
console.log("\n── B pipeline discovery from pipeline_defs/ ──");
const { pipelines, broken } = P.listPipelines(repo);
check("B1 two manifests parsed, sorted by id; the .txt is ignored", pipelines.map((p) => p.id).join(",") === "animated-explainer,framework-smoke", pipelines.map((p) => p.id));
const ae = pipelines[0];
check("B2 name, version, description, category, stability, budget and stages come from the YAML", ae.name === "animated-explainer" && ae.version === "2.0" && /narration/.test(ae.description) && ae.category === "generated" && ae.stability === "production" && ae.budgetUsd === 2 && ae.stages.join(",") === "research,script,compose", ae);
check("B3 a manifest without orchestration has budgetUsd null and category from the file", pipelines[1].budgetUsd === null && pipelines[1].category === "custom" && pipelines[1].stages.length === 2);
check("B4 the broken manifest is reported, not dropped", broken.length === 1 && broken[0].file === "broken.yaml" && broken[0].error.length > 0, broken);
check("B5 findPipeline returns the manifest by id", P.findPipeline(repo, "framework-smoke").file.endsWith("framework-smoke.yaml"));
let e404 = null; try { P.findPipeline(repo, "nope"); } catch (e) { e404 = e; }
check("B6 an unknown pipeline is a 404 that lists the real ids", e404 && e404.status === 404 && /animated-explainer, framework-smoke/.test(e404.fix), e404 && e404.fix);
let e400 = null; try { P.findPipeline(repo, "../etc"); } catch (e) { e400 = e; }
check("B7 a path-shaped id is a 400", e400 && e400.status === 400);

// ── C the missing repo ────────────────────────────────────────────────────────
console.log("\n── C missing repo / python / dependency are loud errors with the fix ──");
let eMissing = null; try { P.listPipelines(path.join(tmp, "nowhere")); } catch (e) { eMissing = e; }
check("C1 a missing checkout throws OpenMontageError 503 naming the path and the git clone fix", eMissing && eMissing.name === "OpenMontageError" && eMissing.status === 503 && /not found at/.test(eMissing.message) && /git clone https:\/\/github.com\/calesthio\/OpenMontage.git/.test(eMissing.fix), eMissing && eMissing.message);
fs.mkdirSync(path.join(tmp, "notarepo"));
let eNotRepo = null; try { P.listPipelines(path.join(tmp, "notarepo")); } catch (e) { eNotRepo = e; }
check("C2 a folder without AGENT_GUIDE.md / pipeline_defs is refused with a pointer to the gear", eNotRepo && /AGENT_GUIDE\.md/.test(eNotRepo.message) && /Repo path/.test(eNotRepo.fix));

// a fake python: scripted per call
const fakeExec = (script) => {
  const calls = [];
  const fn = async (bin, args, opts) => {
    calls.push({ bin, args, cwd: opts.cwd });
    return script(bin, args, calls.length);
  };
  fn.calls = calls;
  return fn;
};
const pyOk = (versionOut = "3.11.0", missing = "") => fakeExec((bin, args) => {
  if (bin !== "fake-python") return { code: null, stdout: "", stderr: "", error: "spawn ENOENT" };
  if (/sys\.version/.test(args[1])) return { code: 0, stdout: `${versionOut}\n`, stderr: "" };
  if (/missing=\[\]/.test(args[1])) return { code: 0, stdout: `${missing}\n`, stderr: "" };
  if (/tool_registry/.test(args[1])) return { code: 0, stdout: JSON.stringify({ tts: ["piper_tts"], image_generation: ["pexels_image"] }, null, 2), stderr: "" };
  return { code: 1, stdout: "", stderr: "unexpected" };
});

const docMissingRepo = await D.runDoctor(cfgOf({ repoPath: path.join(tmp, "nowhere") }), { exec: pyOk() });
check("C3 doctor: missing checkout fails the first check and stops (python never run)", !docMissingRepo.ok && docMissingRepo.checks.length === 1 && docMissingRepo.checks[0].label === "Checkout" && /git clone/.test(docMissingRepo.checks[0].fix));
const docNoPy = await D.runDoctor(cfgOf({ pythonBin: "python3" }), { exec: pyOk() });
check("C4 doctor: a python that does not run is a failed Python check naming the binary and the gear", !docNoPy.ok && docNoPy.checks.some((c) => c.label === "Python" && !c.ok && /"python3" did not run/.test(c.detail) && /Python executable/.test(c.fix)), docNoPy.checks);
const docDeps = await D.runDoctor(cfgOf(), { exec: pyOk("3.11.0", "pydantic,dotenv"), agentInstalled: () => true });
const depCheck = docDeps.checks.find((c) => c.label === "Dependencies");
check("C5 doctor: missing packages are named by pip name with the exact install command", !docDeps.ok && depCheck && !depCheck.ok && depCheck.detail === "missing: pydantic, python-dotenv" && depCheck.fix === `"fake-python" -m pip install -r "${path.join(repo, "requirements.txt")}"`, depCheck);
const docOld = await D.runDoctor(cfgOf(), { exec: pyOk("3.9.7"), agentInstalled: () => true });
check("C6 doctor: Python 3.9 fails the version floor", !docOld.ok && docOld.checks.some((c) => c.label === "Python" && !c.ok && /3\.10\+/.test(c.fix)));
const docNoAgent = await D.runDoctor(cfgOf(), { exec: pyOk(), agentInstalled: (a) => a !== "claude" });
check("C7 doctor: a missing CLI agent is a failed Agent check", !docNoAgent.ok && docNoAgent.checks.some((c) => c.label === "Agent" && !c.ok && /claude CLI is not installed/.test(c.detail)));
const docOk = await D.runDoctor(cfgOf(), { exec: pyOk(), agentInstalled: () => true });
check("C8 doctor: everything present is ok with five checks, python run from the checkout", docOk.ok && docOk.checks.length === 5 && docOk.checks.every((c) => c.ok) && /3\.11\.0/.test(docOk.checks[1].detail), docOk.checks);
check("C9 doctor ran python inside the checkout", pyOk().calls.length === 0 && docOk.checks[0].detail === path.resolve(repo));

// ── D a pipeline run through a fake agent ─────────────────────────────────────
console.log("\n── D the run: module run, streamed log, outputs listed ──");
function fakeChild(script) {
  const ch = new EventEmitter();
  ch.stdout = new PassThrough();
  ch.stderr = new PassThrough();
  ch.killed = false;
  ch.kill = () => { ch.killed = true; setImmediate(() => ch.emit("close", null)); return true; };
  setImmediate(() => script(ch));
  return ch;
}
const sj = (o) => JSON.stringify(o) + "\n";
function fakeSpawn(behaviour) {
  const calls = [];
  const fn = (agent, args, opts) => {
    calls.push({ agent, args, cwd: opts.cwd, input: opts.input });
    return behaviour(agent, args, opts, calls.length);
  };
  fn.calls = calls;
  return fn;
}
const waitRun = async (started) => { try { await started.promise; } catch { /* the run record carries it */ } return M.getModuleRun(started.id); };

const spawnOk = fakeSpawn((agent, args, opts) => fakeChild((ch) => {
  const projectDir = path.join(cfgOf().outputDir, /Project id: (\S+)/.exec(opts.input)[1]);
  ch.stdout.write(sj({ type: "system", subtype: "init", model: "claude-opus-4-8" }));
  ch.stdout.write(sj({ type: "assistant", message: { content: [{ type: "text", text: "Reading the manifest.\nStarting research." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "python -c 'print(1)'" } }] } }));
  ch.stdout.write(sj({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "1" }] } }));
  ch.stderr.write("some warning\n");
  fs.mkdirSync(path.join(projectDir, "renders"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "renders", "final.mp4"), Buffer.alloc(2048));
  fs.writeFileSync(path.join(projectDir, "checkpoint_script.json"), "{}");
  fs.writeFileSync(path.join(projectDir, "script.json"), "{}");
  ch.stdout.write(sj({ type: "result", subtype: "success", num_turns: 7, total_cost_usd: 0.12, result: "all done\nFINAL: renders/final.mp4" }));
  ch.emit("close", 0);
}));
const started = R.startPipelineRun({ pipelineId: "animated-explainer", brief: "A 60-second explainer about how neural networks learn, calm narration." }, cfgOf(), { spawnAgent: spawnOk, agentInstalled: () => true });
check("D1 startPipelineRun returns a run id, the pipeline and a project id derived from the brief + date", typeof started.id === "string" && started.pipeline.id === "animated-explainer" && /^a-60-second-explainer-\d{8}$/.test(started.projectId), started.projectId);
const live = M.getModuleRun(started.id);
check("D2 the run is registered at once as module \"openmontage\" with an href to the page", live && live.module === "openmontage" && live.href === "/openmontage" && live.status === "running" && /^animated-explainer: A 60-second/.test(live.label), live && live.label);
const done = await waitRun(started);
const texts = done.events.map((e) => e.text);
check("D3 the run finished \"done\"", done.status === "done", done.status + " " + done.error);
check("D4 claude was spawned in the checkout with stream-json and the prompt on stdin", spawnOk.calls.length === 1 && spawnOk.calls[0].agent === "claude" && spawnOk.calls[0].cwd === path.resolve(repo) && spawnOk.calls[0].args.includes("stream-json") && spawnOk.calls[0].args.includes("--verbose") && spawnOk.calls[0].args.includes("--dangerously-skip-permissions"), spawnOk.calls[0] && spawnOk.calls[0].args);
const prompt = spawnOk.calls[0].input;
check("D5 the prompt names the manifest, the project workspace, the brief and the unattended rules", /pipeline_defs\/animated-explainer\.yaml/.test(prompt) && prompt.includes(`Project id: ${started.projectId}`) && prompt.includes(path.join(cfgOf().outputDir, started.projectId)) && /neural networks learn/.test(prompt) && /Rule Zero/.test(prompt) && /MISSING: /.test(prompt) && /\$2/.test(prompt) && /Do not install anything/.test(prompt));
check("D6 live log: session start, the text, the tool call, stderr and the result line were streamed into ctx.log", texts.some((t) => /claude session started \(claude-opus-4-8\)/.test(t)) && texts.some((t) => /Reading the manifest\. Starting research\. \| > Bash python -c/.test(t)) && texts.some((t) => t === "stderr: some warning") && texts.some((t) => /result: success, 7 turns, \$0\.12 :: FINAL: renders\/final\.mp4/.test(t)), texts);
check("D7 tool_result echoes are not logged", !texts.some((t) => /tool_result/.test(t)));
check("D8 the rendered output is listed from the project folder (renders/ first), with the checkpoint stage", done.result && done.result.outputs.length === 1 && done.result.outputs[0].rel === "renders/final.mp4" && done.result.outputs[0].bytes === 2048 && done.result.stages.join() === "script" && done.result.agent === "claude" && done.result.fellBackFrom === null, done.result);
check("D9 the run's last line counts the rendered files", /claude exited 0; 1 rendered file\(s\), 1 checkpoint\(s\)/.test(texts[texts.length - 1]), texts[texts.length - 1]);
const projects = R.listProjects(cfgOf().outputDir);
check("D10 listProjects shows the project with its render", projects.length === 1 && projects[0].id === started.projectId && projects[0].outputs[0].rel === "renders/final.mp4" && projects[0].stages.join() === "script");

// input validation
let eBrief = null; try { R.startPipelineRun({ pipelineId: "animated-explainer", brief: "   " }, cfgOf(), { spawnAgent: spawnOk, agentInstalled: () => true }); } catch (e) { eBrief = e; }
check("D11 an empty brief is a 400 before anything starts", eBrief && eBrief.status === 400 && spawnOk.calls.length === 1);
let eProj = null; try { R.startPipelineRun({ pipelineId: "animated-explainer", brief: "x", projectId: "Bad Id!" }, cfgOf(), { spawnAgent: spawnOk, agentInstalled: () => true }); } catch (e) { eProj = e; }
check("D12 a bad project id is a 400", eProj && eProj.status === 400 && /project id/.test(eProj.message));

// a non-zero exit
const spawnFail = fakeSpawn(() => fakeChild((ch) => { ch.stdout.write("working\n"); ch.emit("close", 2); }));
const failed = await waitRun(R.startPipelineRun({ pipelineId: "framework-smoke", brief: "fail please", projectId: "fail-1" }, cfgOf({ agent: "codex" }), { spawnAgent: spawnFail, agentInstalled: () => true }));
check("D13 a CLI that exits non-zero is an error run naming the code and the folder", failed.status === "error" && /codex exited with code 2/.test(failed.error) && failed.events.some((e) => e.text === "working"), failed.error);
check("D14 codex gets its exec args with the prompt on stdin", spawnFail.calls[0].args[0] === "exec" && spawnFail.calls[0].args.includes("-") && spawnFail.calls[0].input.includes("fail please"));

// STOP
const spawnHang = fakeSpawn(() => fakeChild((ch) => { ch.stdout.write("hanging\n"); }));
const hung = R.startPipelineRun({ pipelineId: "framework-smoke", brief: "hang", projectId: "hang-1" }, cfgOf(), { spawnAgent: spawnHang, agentInstalled: () => true });
await new Promise((r) => setTimeout(r, 30));
const stopped = M.stopModuleRun(hung.id, "owner");
const hungRun = await waitRun(hung);
check("D15 STOP kills the child and the run is \"stopped\", never \"done\"", stopped && hungRun.status === "stopped" && spawnHang.calls.length === 1, hungRun.status);

// ── E the labelled fallback (rule 20) ─────────────────────────────────────────
console.log("\n── E fallback: owner-chosen, labelled, only when the primary cannot start ──");
const spawnAny = fakeSpawn(() => fakeChild((ch) => { ch.stdout.write("ran\n"); ch.emit("close", 0); }));
const fb = await waitRun(R.startPipelineRun({ pipelineId: "framework-smoke", brief: "fallback test", projectId: "fb-1" }, cfgOf(), { spawnAgent: spawnAny, agentInstalled: (a) => a === "codex" }));
check("E1 claude not installed + fallback codex: codex runs and the result says so", fb.status === "done" && fb.result.agent === "codex" && fb.result.fellBackFrom === "claude" && /not installed/.test(fb.result.fallbackReason) && spawnAny.calls[0].agent === "codex" && fb.events.some((e) => /^fallback: claude is not installed, running codex instead/.test(e.text)), fb.result);
const spawnBoom = fakeSpawn((agent) => { if (agent === "claude") throw new Error("spawn claude ENOENT"); return fakeChild((ch) => { ch.stdout.write("ran\n"); ch.emit("close", 0); }); });
const fb2 = await waitRun(R.startPipelineRun({ pipelineId: "framework-smoke", brief: "spawn error", projectId: "fb-2" }, cfgOf(), { spawnAgent: spawnBoom, agentInstalled: () => true }));
check("E2 a primary that cannot START falls back, labelled with the spawn error", fb2.status === "done" && fb2.result.agent === "codex" && fb2.result.fellBackFrom === "claude" && /ENOENT/.test(fb2.result.fallbackReason) && spawnBoom.calls.length === 2);
const none = await waitRun(R.startPipelineRun({ pipelineId: "framework-smoke", brief: "no fallback", projectId: "fb-3" }, cfgOf({ fallbackAgent: "none" }), { spawnAgent: spawnAny, agentInstalled: (a) => a === "codex" }));
check("E3 fallback \"none\": a missing primary is an error with the fix, nothing is spawned", none.status === "error" && /claude CLI is not installed/.test(none.error) && spawnAny.calls.length === 1, none.error);
const spawnStartedThenDied = fakeSpawn(() => fakeChild((ch) => { ch.stdout.write("started\n"); ch.emit("close", 1); }));
const died = await waitRun(R.startPipelineRun({ pipelineId: "framework-smoke", brief: "died", projectId: "fb-4" }, cfgOf(), { spawnAgent: spawnStartedThenDied, agentInstalled: () => true }));
check("E4 a primary that started and then failed is NOT re-run on the fallback", died.status === "error" && spawnStartedThenDied.calls.length === 1 && /claude exited with code 1/.test(died.error));

// ── F preflight (python) ──────────────────────────────────────────────────────
console.log("\n── F preflight through the gear's python ──");
const pfExec = pyOk();
const pf = PF.startPreflightRun(cfgOf(), { exec: pfExec, agentInstalled: () => true });
const pfRes = await pf.promise;
const pfRun = M.getModuleRun(pf.id);
check("F1 preflight runs the tool-registry one-liner in the checkout and parses the menu", pfRes.ok && pfRes.menu && pfRes.menu.tts[0] === "piper_tts" && pfExec.calls.some((c) => /tool_registry/.test(c.args[1]) && c.cwd === path.resolve(repo)) && pfRun.status === "done", pfRes);
const pfBad = PF.startPreflightRun(cfgOf(), { exec: pyOk("3.11.0", "yaml"), agentInstalled: () => true });
let pfErr = null; try { await pfBad.promise; } catch (e) { pfErr = e; }
check("F2 preflight with a missing dependency fails before running the registry, carrying the pip fix", pfErr && /Dependencies: missing: pyyaml/.test(pfErr.message) && /-m pip install -r/.test(pfErr.fix) && M.getModuleRun(pfBad.id).status === "error");

// ── G unit: prompt + stream summary + ids ─────────────────────────────────────
console.log("\n── G helpers ──");
check("G1 summarizeStreamLine: a non-JSON line passes through trimmed", R.summarizeStreamLine("  plain text \n") === "plain text");
check("G2 summarizeStreamLine: an assistant turn with only whitespace text is skipped", R.summarizeStreamLine(sj({ type: "assistant", message: { content: [{ type: "text", text: "  " }] } })) === null);
check("G3 defaultProjectId: four words of the brief + the date", /^make-me-a-video-\d{8}$/.test(R.defaultProjectId("Make me a video about cats!!")));
check("G4 validProjectId accepts slugs, refuses paths and uppercase", R.validProjectId("abc-1_2") && !R.validProjectId("../x") && !R.validProjectId("Abc"));
let eAgent = null; try { R.agentArgs("pi"); } catch (e) { eAgent = e; }
check("G5 an unwired agent is a 400 naming the wired ones", eAgent && eAgent.status === 400 && /claude, codex, cursor or hermes/.test(eAgent.message));
const outsidePrompt = R.buildPrompt(ae, "b", "p-1", cfgOf({ outputDir: path.join(tmp, "elsewhere") }));
const insidePrompt = R.buildPrompt(ae, "b", "p-1", cfgOf({ outputDir: "" }));
check("G6 the prompt warns when the output dir is outside the checkout's projects/ (Backlot will not see it), and not otherwise", /Backlot board will not see it/.test(outsidePrompt) && !/Backlot board will not see it/.test(insidePrompt));

// ── H static: the page, the sidebar, the title, the doc ───────────────────────
console.log("\n── H static wiring ──");
const sidebar = read("src/components/Sidebar.tsx");
check("H1 Sidebar NAV has /openmontage with the Clapperboard icon", /href: "\/openmontage", label: "OpenMontage", icon: <Clapperboard/.test(sidebar));
check("H2 /openmontage is in ARTIST_ROUTES (Artist's Corner)", /ARTIST_ROUTES = new Set\(\[[^\]]*"\/openmontage"/.test(sidebar));
const meta = await import("../../src/lib/pageMeta.ts");
check("H3 pageMeta titles the route OpenMontage (TopBar title)", meta.TITLES["/openmontage"] && meta.TITLES["/openmontage"].title === "OpenMontage" && meta.metaFor("/openmontage").title === "OpenMontage");
check("H4 the page renders OpenMontageStudio", /import OpenMontageStudio from "@\/components\/OpenMontageStudio"/.test(read("src/app/openmontage/page.tsx")) && /<OpenMontageStudio \/>/.test(read("src/app/openmontage/page.tsx")));
const studio = read("src/components/OpenMontageStudio.tsx");
for (const r of ["/api/openmontage", "/api/openmontage/run", "/api/openmontage/preflight"]) {
  check(`H5 ${r} is fetched by the page and exists`, studio.includes(`"${r}"`) && fs.existsSync(path.join(root, "src/app", r, "route.ts")));
}
check("H6 the page polls /api/runs/:id and offers STOP", /\/api\/runs\/\$\{/.test(studio) && /action: "stop"/.test(studio));
check("H7 the page shows the fix for a failed check and never installs", /Nothing is installed from this page/.test(studio) && /c\.fix/.test(studio));
check("H8 the route files export only handlers (no helper exports Next would reject)", !/export function agentInstalled/.test(read("src/app/api/openmontage/route.ts")));
const gear = read("src/components/OpenMontageSettings.tsx");
check("H9 the gear exposes repo path, python bin, output dir, agent, fallback and timeout", ["Repo path", "Python executable", "Output directory", "CLI agent", "Fallback agent", "Run timeout"].every((l) => gear.includes(`label="${l}`)) && /save\(\{ openmontage: \{/.test(gear));
const doc = read("docs/modules/openmontage.md");
check("H10 docs/modules/openmontage.md names the route and documents every gear control", /^Route: `\/openmontage`/m.test(doc) && /^## Tabs and controls/m.test(doc) && /^## How it works/m.test(doc) && ["Repo path", "Python executable", "Output directory", "CLI agent", "Fallback agent", "Run timeout", "Preflight", "Run pipeline"].every((l) => doc.includes(l)));
check("H11 the module index lists the doc", read("docs/modules/README.md").includes("(openmontage.md)"));
check("H12 no em or en dashes in the doc's prose", !/[–—]/.test(doc.replace(/`[^`\n]*`/g, "")));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
