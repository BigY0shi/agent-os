// Preflight: OpenMontage's own tool-registry report (`make preflight` in its
// Makefile), run with the gear's python as a module run so the tray shows it.
// It prints registry.provider_menu(): which tools are usable with the keys and
// binaries present in the checkout. Read-only; it installs nothing.
import { startModuleRun } from "@/lib/moduleRuns";
import { OpenMontageError, type OpenMontageConfig } from "./config";
import { defaultExec, runDoctor, type ExecFn } from "./doctor";
import { HREF, MODULE } from "./run";

export const PREFLIGHT_CODE = "from tools.tool_registry import registry; import json; registry.discover(); print(json.dumps(registry.provider_menu(), indent=2))";

export interface PreflightResult { ok: boolean; text: string; menu: unknown | null }

export function startPreflightRun(cfg: OpenMontageConfig, opts: { exec?: ExecFn; agentInstalled?: (a: string) => boolean } = {}): { id: string; promise: Promise<PreflightResult> } {
  const exec = opts.exec ?? defaultExec;
  const run = startModuleRun<PreflightResult>(
    { module: MODULE, label: "Preflight: OpenMontage tool registry", href: HREF },
    async (ctx) => {
      const doc = await runDoctor(cfg, { exec, agentInstalled: opts.agentInstalled });
      const bad = doc.checks.find((c) => !c.ok && c.label !== "Agent");
      if (bad) throw new OpenMontageError(`${bad.label}: ${bad.detail}${bad.fix ? ` :: fix: ${bad.fix}` : ""}`, { fix: bad.fix });
      ctx.log(`${cfg.pythonBin} -c "<tool registry discover>" in ${cfg.repoPath}`);
      const r = await exec(cfg.pythonBin, ["-c", PREFLIGHT_CODE], { cwd: cfg.repoPath, timeoutMs: 120_000 });
      if (r.error || r.code !== 0) {
        const tail = (r.stderr || r.error || "").trim().split("\n").slice(-3).join(" | ");
        throw new OpenMontageError(`preflight failed (exit ${r.code ?? "null"}): ${tail}`);
      }
      const text = r.stdout.trim();
      let menu: unknown = null;
      try { menu = JSON.parse(text); } catch { /* not JSON: the raw text is still the report */ }
      const lines = text.split("\n").length;
      ctx.log(`registry answered: ${lines} lines`);
      return { ok: true, text: text.slice(0, 60_000), menu };
    },
    { summarize: (r) => ({ ok: r.ok, lines: r.text.split("\n").length }) },
  );
  return { id: run.id, promise: run.promise };
}
