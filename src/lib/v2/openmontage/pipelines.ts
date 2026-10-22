// Pipeline discovery: the YAML manifests in <repo>/pipeline_defs/.
//
// A manifest (docs/ARCHITECTURE.md "Pipeline Manifests") carries name, version,
// description, category, stability, orchestration.budget_default_usd and a
// stages[] list. Only what the page shows is read; the rest stays in the file.
// The checkout is the source of truth: nothing is cached, nothing is hardcoded,
// so a pipeline the owner adds shows up on the next load.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { OpenMontageError } from "./config";

export interface PipelineDef {
  /** The file stem, e.g. "animated-explainer"; what a run is started with. */
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  stability: string;
  budgetUsd: number | null;
  stages: string[];
  file: string;
}

export const PIPELINE_DIR = "pipeline_defs";

/** Throws OpenMontageError when the checkout is not where the gear says. */
export function assertRepo(repoPath: string): void {
  const guide = path.join(repoPath, "AGENT_GUIDE.md");
  const defs = path.join(repoPath, PIPELINE_DIR);
  if (!fs.existsSync(repoPath)) {
    throw new OpenMontageError(`OpenMontage checkout not found at ${repoPath}`, {
      fix: `git clone https://github.com/calesthio/OpenMontage.git "${repoPath}"  (or point the gear's Repo path at your clone)`,
    });
  }
  if (!fs.existsSync(guide) || !fs.existsSync(defs)) {
    throw new OpenMontageError(`${repoPath} exists but is not an OpenMontage checkout (no AGENT_GUIDE.md or ${PIPELINE_DIR}/)`, {
      fix: "Point the gear's Repo path at the folder that holds AGENT_GUIDE.md and pipeline_defs/",
    });
  }
}

function s(v: unknown, fallback = ""): string { return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback; }

export function parsePipeline(id: string, text: string, file: string): PipelineDef {
  const doc = (yaml.load(text) ?? {}) as Record<string, unknown>;
  const stagesRaw = Array.isArray(doc.stages) ? doc.stages : [];
  const stages = stagesRaw
    .map((st) => (st && typeof st === "object" ? s((st as Record<string, unknown>).name) : ""))
    .filter(Boolean);
  const orch = doc.orchestration && typeof doc.orchestration === "object" ? (doc.orchestration as Record<string, unknown>) : {};
  const b = Number(orch.budget_default_usd);
  return {
    id,
    name: s(doc.name, id),
    version: s(doc.version),
    description: s(doc.description).trim(),
    category: s(doc.category, "custom"),
    stability: s(doc.stability, ""),
    budgetUsd: Number.isFinite(b) ? b : null,
    stages,
    file,
  };
}

/** Every *.yaml in pipeline_defs/, sorted by id. A manifest that fails to parse
 *  is reported in `broken`, never silently dropped. */
export function listPipelines(repoPath: string): { pipelines: PipelineDef[]; broken: { file: string; error: string }[] } {
  assertRepo(repoPath);
  const dir = path.join(repoPath, PIPELINE_DIR);
  const pipelines: PipelineDef[] = [];
  const broken: { file: string; error: string }[] = [];
  for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/i.test(n)).sort()) {
    const file = path.join(dir, f);
    const id = f.replace(/\.ya?ml$/i, "");
    try {
      pipelines.push(parsePipeline(id, fs.readFileSync(file, "utf8"), file));
    } catch (e) {
      broken.push({ file: f, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { pipelines, broken };
}

export function findPipeline(repoPath: string, id: string): PipelineDef {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new OpenMontageError(`bad pipeline id: ${JSON.stringify(id)}`, { status: 400 });
  const { pipelines } = listPipelines(repoPath);
  const p = pipelines.find((x) => x.id === id);
  if (!p) throw new OpenMontageError(`pipeline "${id}" is not in ${path.join(repoPath, PIPELINE_DIR)}`, {
    status: 404,
    fix: `Pick one of: ${pipelines.map((x) => x.id).join(", ") || "(none found)"}`,
  });
  return p;
}
