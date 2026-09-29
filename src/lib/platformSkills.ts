// Platform operating skills — model-agnostic instruction blocks injected into agent
// prompts. A skill is plain data (~/.agentic-os/skills/<name>/SKILL.md, Claude-skill
// format: YAML frontmatter + markdown body); which skills apply where is a runtime
// SETTING (settings.skills, editable from the in-app Config menu), and the same text
// is injected into WHICHEVER agent/model runs — claude/codex/cursor/pi/hermes CLI,
// Ollama, MiniMax. No skill text ever lives in agent-specific prompt code.
//
// Wired 2026-08-16 for the user's four "polished" skills: better-agent (global,
// every agent platform-wide), launchworks-agent-os (deals/hire),
// ecommerce-growth-agent + strategic-narrative-positioning (marketing).

import { readFileSync, statSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readSettings } from "@/lib/settings";

// AGENTIC_OS_SKILLS_DIR redirects it for smokes, so a test never writes the owner's skills.
export const SKILLS_DIR = process.env.AGENTIC_OS_SKILLS_DIR || path.join(os.homedir(), ".agentic-os", "skills");

// Cache skill bodies by mtime so request-time reads stay cheap.
const cache = new Map<string, { mtimeMs: number; body: string }>();

function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (m ? raw.slice(m[0].length) : raw).trim();
}

// The markdown body of one installed skill ("" if not installed / unreadable).
export function readSkillBody(name: string): string {
  if (!/^[a-z0-9-]+$/.test(name)) return "";
  const file = path.join(SKILLS_DIR, name, "SKILL.md");
  try {
    const mtimeMs = statSync(file).mtimeMs;
    const hit = cache.get(name);
    if (hit && hit.mtimeMs === mtimeMs) return hit.body;
    const body = stripFrontmatter(readFileSync(file, "utf8")).slice(0, 24_000);
    cache.set(name, { mtimeMs, body });
    return body;
  } catch { return ""; }
}

// All installed skills (for the Config menu toggles).
export function listInstalledSkills(): { name: string; description: string }[] {
  try {
    return readdirSync(SKILLS_DIR)
      .filter((n) => existsSync(path.join(SKILLS_DIR, n, "SKILL.md")))
      .map((name) => {
        let description = "";
        try {
          const m = readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8").match(/^description:\s*(.+)$/m);
          description = (m?.[1] || "").slice(0, 300);
        } catch { /* listable anyway */ }
        return { name, description };
      });
  } catch { return []; }
}

// Which skill names apply for a module ("" / undefined = global-only).
export function activeSkillNames(module?: string): string[] {
  const s = readSettings().skills || {};
  const names = [...(s.global || [])];
  if (module && s.modules?.[module]) names.push(...s.modules[module]);
  return [...new Set(names)];
}

// First line of the injected block — used to detect a prompt that was already
// wrapped upstream, so skills are never injected twice. (Until 2026-09-28 this
// comment described a "global wrap" inside cliComplete that never existed; skills
// reach only call sites that pass a module: withSkills(prompt, module), or
// cliComplete(..., { module }) since S14.)
export const SKILLS_HEADER = "══ OPERATING SKILLS";

// Safe cap for call sites that send the prompt as a CLI ARGUMENT (not stdin): the
// block shares runner.ts's MAX_ARG_LEN (32k) budget with the prompt itself. The
// arg-based chat routes allow 16k of prompt + ~8.5k of packed history, so 6k of
// skills always leaves the total under the limit.
export const SKILL_ARG_SAFE_CHARS = 6_000;

// The injectable instruction block: global skills + the module's skills + any
// `extra` names a pre-launch drawer picked for THIS run (S3), concatenated.
// Returns "" when nothing applies, so call sites can prepend unconditionally.
// `maxChars` (for arg-length-capped call sites) trims the skill TEXT to fit while
// keeping the header/footer intact; ≤ overhead-sized caps return "" (prompt survives bare).
export function skillBlock(module?: string, maxChars?: number, extra: readonly string[] = []): string {
  const bodies = [...new Set([...activeSkillNames(module), ...extra])]
    .map((n) => ({ n, body: readSkillBody(n) }))
    .filter((x) => x.body);
  if (!bodies.length) return "";
  const head = "══ OPERATING SKILLS (standing instructions — follow them throughout) ══";
  const tail = "══ END OPERATING SKILLS ══";
  let body = bodies.map((x) => `### Operating skill: ${x.n}\n${x.body}`).join("\n\n");
  const overhead = [head, "", tail, ""].join("\n\n").length; // block size minus the body
  if (maxChars !== undefined && body.length + overhead > maxChars) {
    const marker = "\n…[skill trimmed to fit]";
    const room = maxChars - overhead - marker.length;
    if (room <= 0) return "";
    body = body.slice(0, room) + marker;
  }
  return [head, body, tail, ""].join("\n\n");
}

// Convenience: prefix a prompt with the applicable skills. A prompt that already
// starts with the block (wrapped by the caller) passes through untouched.
export function withSkills(prompt: string, module?: string, maxChars?: number, extra: readonly string[] = []): string {
  if (prompt.startsWith(SKILLS_HEADER)) return prompt;
  const block = skillBlock(module, maxChars, extra);
  return block ? `${block}\n${prompt}` : prompt;
}


// S14: only the skills switched on for THIS module (no global ones), as a block.
// Jarvis uses this: its stable prompt already names the global skills, and pulling
// every global body into a warm session on every page would bloat it.
export function moduleSkillBlock(module: string, maxChars?: number): string {
  const s = readSettings().skills || {};
  const names = [...new Set(s.modules?.[module] ?? [])];
  if (!names.length) return "";
  const bodies = names.map((n) => ({ n, body: readSkillBody(n) })).filter((x) => x.body);
  if (!bodies.length) return "";
  let body = bodies.map((x) => `### Operating skill: ${x.n}\n${x.body}`).join("\n\n");
  if (maxChars !== undefined && body.length > maxChars) body = body.slice(0, Math.max(0, maxChars - 24)) + "\n…[skill trimmed to fit]";
  return `<module_skills module="${module}">\n${body}\n</module_skills>`;
}

// S14: create a new file skill from the Skills & Workflows pop-up. Refuses to
// overwrite an existing skill (edit those in the Files page, where versions are kept).
export class SkillError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function createSkill(input: { name?: unknown; description?: unknown; body?: unknown }): { name: string; description: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new SkillError("name must be lowercase words joined by hyphens, e.g. brand-voice (up to 64 characters)");
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description || description.length > 300) throw new SkillError("description is required, up to 300 characters: say what the skill does and when it applies");
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > 24_000) throw new SkillError("body is required, up to 24000 characters");
  const dir = path.join(SKILLS_DIR, name);
  if (existsSync(path.join(dir, "SKILL.md"))) throw new SkillError(`a skill named ${name} already exists`, 409);
  mkdirSync(dir, { recursive: true });
  const safeDescription = description.replace(/\r?\n/g, " ");
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${safeDescription}\n---\n\n${body}\n`, "utf8");
  return { name, description: safeDescription };
}
