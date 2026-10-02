// S14: what the Skills & Workflows pop-up shows for one module, and the one place
// that switches a skill or workflow on or off for it. Used by /api/modules/kit and
// by Jarvis's module_kit tool, so both paths behave identically.

import { listInstalledSkills } from "@/lib/platformSkills";
import { readSettings, writeSettings } from "@/lib/settings";
import { getModule, type ModuleEntry } from "@/lib/moduleRegistry";
import { listWorkflows, activeWorkflowIds, setWorkflowActive, WorkflowError } from "@/lib/workflows";

export interface KitSkill { name: string; description: string; activeHere: boolean; activeGlobal: boolean }
export interface KitWorkflow { id: string; name: string; description: string; inputLabel?: string; agent: string; activeHere: boolean; activeGlobal: boolean }
export interface ModuleKit { module: ModuleEntry; skills: KitSkill[]; workflows: KitWorkflow[] }

export class KitError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function getModuleKit(moduleId: string): ModuleKit {
  const module = getModule(moduleId);
  if (!module) throw new KitError(`unknown module "${moduleId}"`, 404);
  const s = readSettings().skills ?? {};
  const here = new Set(s.modules?.[moduleId] ?? []);
  const global = new Set(s.global ?? []);
  const wf = activeWorkflowIds(moduleId);
  return {
    module,
    skills: listInstalledSkills()
      .map((k) => ({ ...k, activeHere: here.has(k.name), activeGlobal: global.has(k.name) }))
      .sort((a, b) => Number(b.activeHere || b.activeGlobal) - Number(a.activeHere || a.activeGlobal) || a.name.localeCompare(b.name)),
    workflows: listWorkflows().map((w) => ({
      id: w.id, name: w.name, description: w.description, inputLabel: w.inputLabel, agent: w.agent,
      activeHere: wf.here.includes(w.id), activeGlobal: wf.global.includes(w.id),
    })),
  };
}

export interface KitToggle { module: string; kind: "skill" | "workflow"; name: string; active: boolean; scope?: "module" | "global" }

export function setKitItem(t: KitToggle): ModuleKit {
  if (!getModule(t.module)) throw new KitError(`unknown module "${t.module}"`, 404);
  if (t.kind !== "skill" && t.kind !== "workflow") throw new KitError('kind must be "skill" or "workflow"');
  if (typeof t.active !== "boolean") throw new KitError("active must be true or false");
  const scope = t.scope ?? "module";
  if (scope !== "module" && scope !== "global") throw new KitError('scope must be "module" or "global"');

  if (t.kind === "workflow") {
    try { setWorkflowActive(t.name, scope === "global" ? "*" : t.module, t.active); }
    catch (e) { if (e instanceof WorkflowError) throw new KitError(e.message, e.status); throw e; }
    return getModuleKit(t.module);
  }

  if (!listInstalledSkills().some((k) => k.name === t.name)) throw new KitError(`no installed skill named "${t.name}"`, 404);
  const s = readSettings().skills ?? {};
  const current = scope === "global" ? [...(s.global ?? [])] : [...(s.modules?.[t.module] ?? [])];
  const next = t.active ? [...new Set([...current, t.name])] : current.filter((n) => n !== t.name);
  // writeSettings replaces arrays and merges objects, so only this one list changes.
  writeSettings(scope === "global" ? { skills: { global: next } } : { skills: { modules: { [t.module]: next } } });
  // writeSettings is best-effort on disk; read back and fail loudly if it did not land.
  const after = readSettings().skills ?? {};
  const landed = scope === "global" ? after.global ?? [] : after.modules?.[t.module] ?? [];
  if (landed.includes(t.name) !== t.active) throw new KitError("the settings file could not be saved; nothing changed", 500);
  return getModuleKit(t.module);
}
