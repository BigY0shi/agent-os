// S28 Files (_design/jarvis-v3-plan.md; owner: "a Files tab to view and EDIT files right
// in the OS"). The files that shape each agent, from where they really live:
//   Jarvis   ~/.agentic-os/jarvis-persona.json                        (what jarvisPersona.ts reads)
//   Hermes   $HERMES_HOME (this machine: %LOCALAPPDATA%\hermes): SOUL.md, memories/*.md, config.yaml
//   Agents   ~/.agentic-os/agents/<id>/: system.md, agent.json, other top-level *.md
//   Skills   ~/.agentic-os/skills/<name>/SKILL.md
//
// Safety, in code:
//   - ALLOW-LIST: a file can be read or written only if it is in its agent's listing,
//     re-derived on every request; an id names (source, relative path) and nothing else.
//   - CONTAINMENT: the resolved real path must sit inside the source root's real path
//     (symlinks included), and no relative path may contain "..".
//   - NEVER SHOWN: .env*, auth*, *token*, *secret*, *credential*, *.pem, *.key, *.lock.
//   - SECRETS in config files (yaml / json) come back masked ("********"); a save that
//     keeps a mask gets the original value back, line by line, so a key never leaves
//     and is never overwritten with its mask (AGENTS.md "Credentials leave through
//     exactly one door").
//   - SENSITIVE files (they shape an agent) need an explicit confirm to save.
//   - Every save first keeps the previous version under ~/.agentic-os/file-versions/.
//   - A save is refused (409) when the file changed since it was read (sha256 of the raw
//     bytes the editor started from).
//   - JSON must parse and YAML must load before anything is written.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import yaml from "js-yaml";
import { isSecretPath, SECRET_PLACEHOLDER } from "@/lib/settingsRedact";

export type FileGroup = "identity" | "memory" | "configuration" | "skills";
export type FileFormat = "md" | "yaml" | "json" | "text";
export interface FileEntry { id: string; source: string; rel: string; name: string; group: FileGroup; sensitive: boolean; format: FileFormat; size: number; mtimeMs: number }
export interface FileSource { key: string; name: string; kind: "jarvis" | "hermes" | "agent" | "skills"; rootLabel: string; files: FileEntry[]; error?: string }

export class FilesError extends Error {
  constructor(message: string, public status = 400, public extra?: Record<string, unknown>) { super(message); }
}

const HOME = () => os.homedir();
const agenticDir = () => path.join(HOME(), ".agentic-os");
const agentsRoot = () => process.env.AGENTIC_OS_AGENTS_DIR?.trim() || path.join(agenticDir(), "agents");
const skillsRoot = () => process.env.AGENTIC_OS_SKILLS_DIR || path.join(agenticDir(), "skills");
// HERMES_HOME first (set on this machine); on Windows Hermes installs to %LOCALAPPDATA%\hermes, so
// that is the next place looked before the POSIX default ~/.hermes.
const hermesRoot = () => {
  const env = process.env.AGENTIC_OS_HERMES_HOME || process.env.HERMES_HOME;
  if (env) return env;
  const win = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "hermes") : "";
  return win && existsSync(win) ? win : path.join(HOME(), ".hermes");
};
const jarvisPersonaFile = () => process.env.AGENTIC_OS_JARVIS_PERSONA_FILE || path.join(agenticDir(), "jarvis-persona.json");
export const versionsRoot = () => process.env.AGENTIC_OS_FILE_VERSIONS_DIR || path.join(agenticDir(), "file-versions");

const DENY = /(^\.env)|auth|token|secret|credential|\.pem$|\.key$|\.lock$/i;
const formatOf = (name: string): FileFormat => (/\.md$/i.test(name) ? "md" : /\.ya?ml$/i.test(name) ? "yaml" : /\.json$/i.test(name) ? "json" : "text");

function entry(source: string, root: string, rel: string, group: FileGroup, sensitive: boolean): FileEntry | null {
  const name = path.basename(rel);
  if (DENY.test(name)) return null;
  const abs = path.join(root, rel);
  try {
    const st = statSync(abs);
    if (!st.isFile()) return null;
    return { id: `${source}::${rel.split(path.sep).join("/")}`, source, rel: rel.split(path.sep).join("/"), name, group, sensitive, format: formatOf(name), size: st.size, mtimeMs: st.mtimeMs };
  } catch { return null; }
}
const mdIn = (dir: string) => { try { return readdirSync(dir).filter((f) => /\.md$/i.test(f)); } catch { return []; } };

/** Every source with its allow-listed files. Pure listing: nothing is read. */
export function listSources(): FileSource[] {
  const out: FileSource[] = [];

  // Jarvis
  const jp = jarvisPersonaFile();
  out.push({ key: "jarvis", name: "Jarvis", kind: "jarvis", rootLabel: path.dirname(jp), files: [entry("jarvis", path.dirname(jp), path.basename(jp), "identity", true)].filter((x): x is FileEntry => !!x),
    ...(existsSync(jp) ? {} : { error: `No persona file yet (${path.basename(jp)}): Jarvis is running on his built-in persona. It is created the first time his persona is saved.` }) });

  // Hermes
  const hr = hermesRoot();
  const hFiles: (FileEntry | null)[] = [entry("hermes", hr, "SOUL.md", "identity", true)];
  const memDir = path.join(hr, "memories");
  for (const f of mdIn(memDir)) hFiles.push(entry("hermes", hr, path.join("memories", f), /^user\.md$/i.test(f) ? "identity" : "memory", /^user\.md$/i.test(f)));
  hFiles.push(entry("hermes", hr, "config.yaml", "configuration", true));
  out.push({ key: "hermes", name: "Hermes", kind: "hermes", rootLabel: hr, files: hFiles.filter((x): x is FileEntry => !!x), ...(existsSync(hr) ? {} : { error: `not found at ${hr}` }) });

  // Agent OS agents
  const ar = agentsRoot();
  let ids: string[] = [];
  try { ids = readdirSync(ar).filter((d) => /^[A-Za-z0-9-]{8,64}$/.test(d)); } catch { /* none yet */ }
  for (const id of ids) {
    const root = path.join(ar, id);
    let name = id;
    try { name = (JSON.parse(readFileSync(path.join(root, "agent.json"), "utf8")) as { name?: string }).name || id; } catch { /* keep id */ }
    const files: (FileEntry | null)[] = [entry(`agent:${id}`, root, "system.md", "identity", true)];
    for (const f of mdIn(root)) if (f !== "system.md") files.push(entry(`agent:${id}`, root, f, "memory", false));
    files.push(entry(`agent:${id}`, root, "agent.json", "configuration", true));
    out.push({ key: `agent:${id}`, name, kind: "agent", rootLabel: root, files: files.filter((x): x is FileEntry => !!x) });
  }

  // Skills
  const sr = skillsRoot();
  let skills: string[] = [];
  try { skills = readdirSync(sr).filter((d) => /^[A-Za-z0-9][A-Za-z0-9 _-]{0,80}$/.test(d)); } catch { /* none */ }
  out.push({ key: "skills", name: "Skills (Agent OS)", kind: "skills", rootLabel: sr, files: skills.map((s) => entry("skills", sr, path.join(s, "SKILL.md"), "skills", true)).filter((x): x is FileEntry => !!x) });
  return out;
}

function rootFor(source: string): string {
  if (source === "jarvis") return path.dirname(jarvisPersonaFile());
  if (source === "hermes") return hermesRoot();
  if (source === "skills") return skillsRoot();
  const m = /^agent:([A-Za-z0-9-]{8,64})$/.exec(source);
  if (m) return path.join(agentsRoot(), m[1]);
  throw new FilesError("unknown source", 400);
}

/** Resolve an id against the CURRENT listing, then prove the real path is contained. */
export function resolve(id: string): { entry: FileEntry; abs: string } {
  if (typeof id !== "string" || !id.includes("::")) throw new FilesError("bad file id", 400);
  const [source, rel] = [id.slice(0, id.indexOf("::")), id.slice(id.indexOf("::") + 2)];
  if (!rel || rel.split("/").some((p) => p === ".." || p === "") || path.isAbsolute(rel)) throw new FilesError("bad file path", 400);
  const src = listSources().find((s) => s.key === source);
  const e = src?.files.find((f) => f.rel === rel);
  if (!e) throw new FilesError("that file is not one this page can open", 404);
  const root = rootFor(source);
  const abs = path.join(root, ...rel.split("/"));
  const realRoot = realpathSync(root), realAbs = realpathSync(abs);
  const inside = path.relative(realRoot, realAbs);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw new FilesError("path escapes its folder", 403);
  return { entry: e, abs: realAbs };
}

export const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// ── masking secrets in config files ─────────────────────────────────────────
const YAML_LINE = /^(\s*(?:-\s+)?["']?([A-Za-z0-9_.-]+)["']?\s*:\s*)(.+?)\s*$/;
const JSON_LINE = /^(\s*"([^"]+)"\s*:\s*)"(.*)"(\s*,?)\s*$/;
function maskLine(line: string, fmt: FileFormat): { line: string; masked: boolean } {
  if (fmt === "yaml") {
    const m = YAML_LINE.exec(line);
    if (m && isSecretPath(m[2]) && !/^[|>]/.test(m[3]) && m[3] !== "''" && m[3] !== '""' && m[3].toLowerCase() !== "null") return { line: `${m[1]}${SECRET_PLACEHOLDER}`, masked: true };
  } else if (fmt === "json") {
    const m = JSON_LINE.exec(line);
    if (m && isSecretPath(m[2]) && m[3] !== "") return { line: `${m[1]}"${SECRET_PLACEHOLDER}"${m[4]}`, masked: true };
  }
  return { line, masked: false };
}
export function maskContent(raw: string, fmt: FileFormat): { content: string; masked: number } {
  if (fmt !== "yaml" && fmt !== "json") return { content: raw, masked: 0 };
  let n = 0;
  const content = raw.split("\n").map((l) => { const r = maskLine(l.replace(/\r$/, ""), fmt); if (r.masked) n++; return r.masked ? r.line + (l.endsWith("\r") ? "\r" : "") : l; }).join("\n");
  return { content, masked: n };
}
/** Put the original secret back wherever the edited text still holds the mask. */
export function unmaskContent(edited: string, raw: string, fmt: FileFormat): string {
  if (fmt !== "yaml" && fmt !== "json") return edited;
  const prefixOf = (l: string) => { const m = (fmt === "yaml" ? YAML_LINE : JSON_LINE).exec(l.replace(/\r$/, "")); return m ? m[1].trimEnd() : null; };
  const originals = new Map<string, string[]>();
  for (const l of raw.split("\n")) {
    const clean = l.replace(/\r$/, "");
    if (!maskLine(clean, fmt).masked) continue;
    const p = prefixOf(clean)!;
    originals.set(p, [...(originals.get(p) ?? []), clean]);
  }
  return edited.split("\n").map((l) => {
    const clean = l.replace(/\r$/, "");
    if (!clean.includes(SECRET_PLACEHOLDER)) return l;
    const p = prefixOf(clean);
    const q = p ? originals.get(p) : undefined;
    if (!q || !q.length) throw new FilesError(`a masked value on "${clean.trim().slice(0, 60)}" has no original to restore; type the real value or remove the line`, 400);
    return q.shift()! + (l.endsWith("\r") ? "\r" : "");
  }).join("\n");
}

// ── read / save ──────────────────────────────────────────────────────────────

export function readFile(id: string): { entry: FileEntry; content: string; hash: string; masked: number } {
  const { entry: e, abs } = resolve(id);
  const raw = readFileSync(abs, "utf8");
  const { content, masked } = maskContent(raw, e.format);
  return { entry: e, content, hash: sha(raw), masked };
}

function versionDir(e: FileEntry): string {
  return path.join(versionsRoot(), e.source.replace(/[^A-Za-z0-9_-]/g, "_"), ...e.rel.split("/"));
}
export function listVersions(id: string): string[] {
  const { entry: e } = resolve(id);
  try { return readdirSync(versionDir(e)).sort().reverse(); } catch { return []; }
}
export function countVersions(): number {
  const walk = (d: string): number => { let n = 0; try { for (const x of readdirSync(d, { withFileTypes: true })) n += x.isDirectory() ? walk(path.join(d, x.name)) : 1; } catch { /* none */ } return n; };
  return walk(versionsRoot());
}

export function saveFile(input: { id?: unknown; content?: unknown; baseHash?: unknown; confirm?: unknown }): { entry: FileEntry; hash: string; mtimeMs: number; versionKept: string } {
  if (typeof input.id !== "string") throw new FilesError("bad file id");
  if (typeof input.content !== "string") throw new FilesError("content must be text");
  if (input.content.length > 2_000_000) throw new FilesError("file too large for this editor (2 MB)");
  if (typeof input.baseHash !== "string") throw new FilesError("baseHash is required: save what you opened");
  const { entry: e, abs } = resolve(input.id);
  if (e.sensitive && input.confirm !== true) throw new FilesError(`this file shapes ${e.source === "skills" ? "every agent that uses this skill" : e.source}; confirm to save it`, 403);
  const raw = readFileSync(abs, "utf8");
  if (sha(raw) !== input.baseHash) {
    const { content } = maskContent(raw, e.format);
    throw new FilesError("the file changed since you opened it; your edit was not saved", 409, { current: content, hash: sha(raw) });
  }
  const next = unmaskContent(input.content, raw, e.format);
  if (e.format === "json") { try { JSON.parse(next); } catch (err) { throw new FilesError(`not valid JSON: ${(err as Error).message}`); } }
  if (e.format === "yaml") { try { yaml.load(next); } catch (err) { throw new FilesError(`not valid YAML: ${(err as Error).message.split("\n")[0]}`); } }
  if (next === raw) return { entry: e, hash: sha(raw), mtimeMs: statSync(abs).mtimeMs, versionKept: "" };
  // Keep the previous version first (exile-style copy; nothing is ever overwritten unkept).
  const vdir = versionDir(e);
  mkdirSync(vdir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const kept = path.join(vdir, `${stamp}${path.extname(e.name)}`);
  copyFileSync(abs, kept);
  const tmp = `${abs}.${process.pid}.tmp`;
  writeFileSync(tmp, next, "utf8");
  renameSync(tmp, abs);
  return { entry: { ...e, size: Buffer.byteLength(next), mtimeMs: statSync(abs).mtimeMs }, hash: sha(next), mtimeMs: statSync(abs).mtimeMs, versionKept: kept };
}
