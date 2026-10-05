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

// Skill SOURCES (owner, 2026-09-28: "all the skills in Claude, and ~/.skilldb/skills
// available for me to choose from"). Agent OS's own folder is the only writable one;
// Claude Code's user skills and the SkillDB library are read in place, never copied.
// On a name clash the earlier source wins (agentos > claude > skilldb). A smoke that
// redirects AGENTIC_OS_SKILLS_DIR gets NO extra sources unless it names them
// (AGENTIC_OS_CLAUDE_SKILLS_DIR / AGENTIC_OS_SKILLDB_DIR), so tests never read the
// owner's real libraries.
export type SkillSourceId = "agentos" | "claude" | "skilldb";
export interface SkillSource { id: SkillSourceId; label: string; dir: string; writable: boolean }
export function skillSources(): SkillSource[] {
  const smoke = !!process.env.AGENTIC_OS_SKILLS_DIR;
  const claudeDir = process.env.AGENTIC_OS_CLAUDE_SKILLS_DIR ?? (smoke ? "" : path.join(os.homedir(), ".claude", "skills"));
  const skilldbDir = process.env.AGENTIC_OS_SKILLDB_DIR ?? (smoke ? "" : path.join(os.homedir(), ".skilldb", "skills"));
  const out: SkillSource[] = [{ id: "agentos", label: "Agent OS", dir: SKILLS_DIR, writable: true }];
  if (claudeDir) out.push({ id: "claude", label: "Claude Code", dir: claudeDir, writable: false });
  if (skilldbDir) out.push({ id: "skilldb", label: "SkillDB", dir: skilldbDir, writable: false });
  return out;
}

// A skill name is its folder name. Letters, digits, spaces, _ and - only: no dots or
// separators, so a name can never walk out of its source folder.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,80}$/;

function skillFile(name: string): { file: string; source: SkillSource } | null {
  if (!NAME_RE.test(name)) return null;
  for (const source of skillSources()) {
    const file = path.join(source.dir, name, "SKILL.md");
    if (existsSync(file)) return { file, source };
  }
  return null;
}

// Cache skill bodies and descriptions by file + mtime so request-time reads stay cheap.
const cache = new Map<string, { mtimeMs: number; body: string }>();
const descCache = new Map<string, { mtimeMs: number; description: string }>();

function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (m ? raw.slice(m[0].length) : raw).trim();
}

/** The frontmatter description, including YAML folded/literal blocks (`description: >`). */
export function parseDescription(raw: string): string {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const head = fm ? fm[1] : raw.slice(0, 2000);
  const lines = head.split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i < 0) return "";
  let v = lines[i].replace(/^description:\s*/, "").trim();
  if (v === "" || /^[>|][-+]?$/.test(v)) {
    const more: string[] = [];
    for (const l of lines.slice(i + 1)) {
      if (/^\s+\S/.test(l)) more.push(l.trim());
      else if (l.trim() === "") continue;
      else break;
    }
    v = more.join(" ");
  }
  return v.replace(/^(["'])([\s\S]*)\1$/, "$2").slice(0, 300);
}

// The markdown body of one installed skill ("" if not installed / unreadable).
export function readSkillBody(name: string): string {
  const hitFile = skillFile(name);
  if (!hitFile) return "";
  try {
    const mtimeMs = statSync(hitFile.file).mtimeMs;
    const hit = cache.get(hitFile.file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.body;
    const body = stripFrontmatter(readFileSync(hitFile.file, "utf8")).slice(0, 24_000);
    cache.set(hitFile.file, { mtimeMs, body });
    return body;
  } catch { return ""; }
}

// All installed skills across every source (for the pop-up and Config menu toggles).
export function listInstalledSkills(): { name: string; description: string; source: SkillSourceId }[] {
  const seen = new Set<string>();
  const out: { name: string; description: string; source: SkillSourceId }[] = [];
  for (const source of skillSources()) {
    let names: string[];
    try { names = readdirSync(source.dir); } catch { continue; }
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (seen.has(name) || !NAME_RE.test(name)) continue;
      const file = path.join(source.dir, name, "SKILL.md");
      let description = "";
      try {
        const mtimeMs = statSync(file).mtimeMs; // also follows symlinked skill folders
        const hit = descCache.get(file);
        if (hit && hit.mtimeMs === mtimeMs) description = hit.description;
        else {
          description = parseDescription(readFileSync(file, "utf8"));
          descCache.set(file, { mtimeMs, description });
        }
      } catch { continue; } // no SKILL.md: not a skill
      seen.add(name);
      out.push({ name, description, source: source.id });
    }
  }
  return out;
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
  const clash = skillFile(name);
  if (clash) throw new SkillError(`a skill named ${name} already exists (${clash.source.label})`, 409);
  mkdirSync(dir, { recursive: true });
  const safeDescription = description.replace(/\r?\n/g, " ");
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${safeDescription}\n---\n\n${body}\n`, "utf8");
  return { name, description: safeDescription };
}
