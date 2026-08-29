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

import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readSettings } from "@/lib/settings";

export const SKILLS_DIR = path.join(os.homedir(), ".agentic-os", "skills");

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
// wrapped upstream (e.g. a deals/hire route wrapped with module skills before the
// prompt reaches cliComplete's global wrap), so skills are never injected twice.
export const SKILLS_HEADER = "══ OPERATING SKILLS";

// Safe cap for call sites that send the prompt as a CLI ARGUMENT (not stdin): the
// block shares runner.ts's MAX_ARG_LEN (32k) budget with the prompt itself. The
// arg-based chat routes allow 16k of prompt + ~8.5k of packed history, so 6k of
// skills always leaves the total under the limit.
export const SKILL_ARG_SAFE_CHARS = 6_000;

// The injectable instruction block: global skills + the module's skills, concatenated.
// Returns "" when nothing applies, so call sites can prepend unconditionally.
// `maxChars` (for arg-length-capped call sites) trims the skill TEXT to fit while
// keeping the header/footer intact; ≤ overhead-sized caps return "" (prompt survives bare).
export function skillBlock(module?: string, maxChars?: number): string {
  const bodies = activeSkillNames(module)
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
export function withSkills(prompt: string, module?: string, maxChars?: number): string {
  if (prompt.startsWith(SKILLS_HEADER)) return prompt;
  const block = skillBlock(module, maxChars);
  return block ? `${block}\n${prompt}` : prompt;
}
