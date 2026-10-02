// The environment check a run is gated on: repo, python, core dependencies,
// the CLI agent. Each check carries its own fix, and a failed check is a
// visible error on the page, never a silent no-op (AGENTS.md "Fail loudly").
//
// Nothing is installed here. Missing Python packages are reported with the
// exact pip command; the owner runs it (feature contract).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { assertRepo } from "./pipelines";
import { OpenMontageError, type OpenMontageConfig } from "./config";

export interface DoctorCheck { ok: boolean; label: string; detail: string; fix?: string }
export interface DoctorReport { ok: boolean; checks: DoctorCheck[] }

/** Minimal spawn-and-collect, injectable for the smoke. */
export type ExecFn = (bin: string, args: string[], opts: { cwd?: string; timeoutMs?: number }) => Promise<{ code: number | null; stdout: string; stderr: string; error?: string }>;

export const defaultExec: ExecFn = (bin, args, opts) => new Promise((resolve) => {
  let stdout = "", stderr = "";
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", NO_COLOR: "1" } });
  } catch (e) {
    resolve({ code: null, stdout, stderr, error: e instanceof Error ? e.message : String(e) });
    return;
  }
  const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, opts.timeoutMs ?? 20_000);
  child.stdout?.on("data", (b) => { stdout += b.toString(); });
  child.stderr?.on("data", (b) => { stderr += b.toString(); });
  child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, stdout, stderr, error: e.message }); });
  child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
});

// The packages every tool imports (OpenMontage requirements.txt, core block).
// Checked by import name, which is what actually fails at run time.
export const CORE_IMPORTS: Array<[pkg: string, mod: string]> = [
  ["pyyaml", "yaml"], ["pydantic", "pydantic"], ["jsonschema", "jsonschema"], ["python-dotenv", "dotenv"],
];

export function pipFix(cfg: Pick<OpenMontageConfig, "pythonBin" | "repoPath">): string {
  return `"${cfg.pythonBin}" -m pip install -r "${path.join(cfg.repoPath, "requirements.txt")}"`;
}

export async function runDoctor(cfg: OpenMontageConfig, opts: { exec?: ExecFn; agentInstalled?: (agent: string) => boolean } = {}): Promise<DoctorReport> {
  const exec = opts.exec ?? defaultExec;
  const checks: DoctorCheck[] = [];

  // 1. the checkout
  try {
    assertRepo(cfg.repoPath);
    checks.push({ ok: true, label: "Checkout", detail: cfg.repoPath });
  } catch (e) {
    const err = e as OpenMontageError;
    checks.push({ ok: false, label: "Checkout", detail: err.message, fix: err.fix });
    // Without the repo the python checks would only repeat the same fix.
    return { ok: false, checks };
  }

  // 2. python runs
  const py = await exec(cfg.pythonBin, ["-c", "import sys; print(sys.version.split()[0])"], { cwd: cfg.repoPath });
  if (py.error || py.code !== 0) {
    checks.push({
      ok: false, label: "Python", detail: `"${cfg.pythonBin}" did not run: ${py.error || py.stderr.trim() || `exit ${py.code}`}`,
      fix: `Install Python 3.10+ or set the gear's Python executable (on Windows the launcher is "python", or the checkout's .venv\\Scripts\\python.exe)`,
    });
    return { ok: false, checks };
  }
  const version = py.stdout.trim();
  const [maj, min] = version.split(".").map(Number);
  const okVersion = maj > 3 || (maj === 3 && min >= 10);
  checks.push({ ok: okVersion, label: "Python", detail: `${version} (${cfg.pythonBin})`, fix: okVersion ? undefined : "OpenMontage requires Python 3.10+" });

  // 3. the core dependencies, one import each so the report names the missing one
  const probe = CORE_IMPORTS.map(([, m]) => `try:\n import ${m}\nexcept Exception as e:\n missing.append('${m}')`).join("\n");
  const deps = await exec(cfg.pythonBin, ["-c", `missing=[]\n${probe}\nprint(','.join(missing))`], { cwd: cfg.repoPath });
  const missingMods = deps.stdout.trim().split(",").filter(Boolean);
  const missingPkgs = CORE_IMPORTS.filter(([, m]) => missingMods.includes(m)).map(([p]) => p);
  if (deps.error || deps.code !== 0) {
    checks.push({ ok: false, label: "Dependencies", detail: `dependency probe failed: ${deps.error || deps.stderr.trim()}`, fix: pipFix(cfg) });
  } else if (missingPkgs.length) {
    checks.push({ ok: false, label: "Dependencies", detail: `missing: ${missingPkgs.join(", ")}`, fix: pipFix(cfg) });
  } else {
    checks.push({ ok: true, label: "Dependencies", detail: CORE_IMPORTS.map(([p]) => p).join(", ") });
  }

  // 4. the CLI agent that will drive the run
  const installed = opts.agentInstalled ? opts.agentInstalled(cfg.agent) : true;
  checks.push({
    ok: installed, label: "Agent", detail: installed ? cfg.agent : `${cfg.agent} CLI is not installed`,
    fix: installed ? undefined : `Install the ${cfg.agent} CLI or pick another agent in the gear`,
  });

  // 5. the output dir (created on first run; a non-directory there is an error)
  if (fs.existsSync(cfg.outputDir) && !fs.statSync(cfg.outputDir).isDirectory()) {
    checks.push({ ok: false, label: "Output dir", detail: `${cfg.outputDir} is not a directory`, fix: "Point the gear's Output directory at a folder" });
  } else {
    checks.push({ ok: true, label: "Output dir", detail: cfg.outputDir + (fs.existsSync(cfg.outputDir) ? "" : " (will be created)") });
  }

  return { ok: checks.every((c) => c.ok), checks };
}
