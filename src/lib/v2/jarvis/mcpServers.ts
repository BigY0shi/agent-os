// S16 (_design/jarvis-v3-plan.md): Jarvis's OWN external MCP servers, the ones the
// MCP tab installs. They are handed to the SDK brain next to its built-in `agentos`
// server.
//
// Safety, in code:
//   - Installed servers start DISABLED. Enabling one is an explicit act, and the UI
//     says what it means: those tools do not pass through Jarvis's capability gates or
//     the Human-Gate. They DO pass through the taint rule: brain.ts installs a
//     PreToolUse hook that denies every external MCP tool on a turn tainted by
//     integration content (the same rule Jarvis's own write tools obey).
//   - Header and env values (keys, tokens) live only in this file (mode 600 where the
//     platform honours it). No getter returns them: the public view carries names only
//     (AGENTS.md "Credentials leave through exactly one door"); the only place they are
//     read in full is sdkServers(), which builds the config handed to the SDK.
//   - Nothing is deleted: removing a server moves it to `retired`.
//
// Storage: ~/.agentic-os/jarvis/mcp-servers.json (AGENTIC_OS_JARVIS_DIR for smokes).

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

export type McpTransport = "http" | "stdio";

interface StoredServer {
  name: string;
  transport: McpTransport;
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled: boolean;
  source: string;
  description?: string;
  addedAt: string;
  updatedAt: string;
}
interface Store { version: 1; servers: StoredServer[]; retired: Array<StoredServer & { retiredAt: string }> }

/** What any caller outside the brain may see: no header or env VALUES. */
export interface PublicServer {
  name: string;
  transport: McpTransport;
  url?: string;
  command?: string;
  args?: string[];
  headerNames: string[];
  envNames: string[];
  enabled: boolean;
  source: string;
  description?: string;
  addedAt: string;
  updatedAt: string;
}

export class McpError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function jarvisDir(): string {
  return process.env.AGENTIC_OS_JARVIS_DIR || path.join(os.homedir(), ".agentic-os", "jarvis");
}
const file = () => path.join(jarvisDir(), "mcp-servers.json");

function load(): Store {
  if (!existsSync(file())) return { version: 1, servers: [], retired: [] };
  try {
    const s = JSON.parse(readFileSync(file(), "utf8")) as Partial<Store>;
    return { version: 1, servers: Array.isArray(s.servers) ? s.servers : [], retired: Array.isArray(s.retired) ? s.retired : [] };
  } catch (e) {
    throw new McpError(`mcp-servers.json is unreadable (${(e as Error).message}); fix or move ${file()}`, 500);
  }
}
function save(s: Store): void {
  mkdirSync(jarvisDir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file());
  try { chmodSync(file(), 0o600); } catch { /* best effort on Windows */ }
}

const toPublic = (s: StoredServer): PublicServer => ({
  name: s.name, transport: s.transport, url: s.url, command: s.command, args: s.args,
  headerNames: Object.keys(s.headers ?? {}), envNames: Object.keys(s.env ?? {}),
  enabled: s.enabled, source: s.source, description: s.description, addedAt: s.addedAt, updatedAt: s.updatedAt,
});

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const RESERVED = new Set(["agentos"]);
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function strMap(v: unknown, nameRe: RegExp, what: string): Record<string, string> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new McpError(`${what} must be an object of name -> value`);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!nameRe.test(k)) throw new McpError(`${what} name "${k}" is not allowed`);
    if (typeof val !== "string" || val.length > 4000) throw new McpError(`${what} "${k}" must be text up to 4000 characters`);
    out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface AddInput {
  name?: unknown; transport?: unknown; url?: unknown; command?: unknown; args?: unknown;
  headers?: unknown; env?: unknown; source?: unknown; description?: unknown; enabled?: unknown;
}

export function addServer(input: AddInput): PublicServer {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!NAME_RE.test(name)) throw new McpError("name must be 2-40 lowercase letters, digits or hyphens");
  if (RESERVED.has(name)) throw new McpError(`"${name}" is Jarvis's built-in server`);
  const transport = input.transport;
  if (transport !== "http" && transport !== "stdio") throw new McpError('transport must be "http" or "stdio"');
  const s = load();
  if (s.servers.some((x) => x.name === name)) throw new McpError(`a server named ${name} is already installed`, 409);
  const now = new Date().toISOString();
  const rec: StoredServer = {
    name, transport, enabled: input.enabled === true, addedAt: now, updatedAt: now,
    source: typeof input.source === "string" && input.source.length <= 120 ? input.source : "custom",
    description: typeof input.description === "string" ? input.description.slice(0, 300) : undefined,
  };
  if (transport === "http") {
    let u: URL;
    try { u = new URL(String(input.url ?? "")); } catch { throw new McpError("url must be a full http(s) address"); }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new McpError("url must be http or https");
    rec.url = u.toString();
    rec.headers = strMap(input.headers, HEADER_NAME, "header");
  } else {
    const command = typeof input.command === "string" ? input.command.trim() : "";
    // A program, not a shell line: no pipes, redirects, chaining or substitution.
    if (!command || command.length > 400 || /[|&;<>`$]/.test(command)) throw new McpError("command must be a program name or path, with arguments listed separately");
    rec.command = command;
    if (input.args !== undefined) {
      if (!Array.isArray(input.args) || input.args.length > 40 || !input.args.every((a) => typeof a === "string" && a.length <= 400)) throw new McpError("args must be a list of up to 40 strings");
      rec.args = input.args as string[];
    }
    rec.env = strMap(input.env, ENV_NAME, "env");
  }
  s.servers.push(rec);
  save(s);
  return toPublic(rec);
}

export function listServers(): PublicServer[] { return load().servers.map(toPublic); }
export function listRetired(): Array<PublicServer & { retiredAt: string }> { return load().retired.map((r) => ({ ...toPublic(r), retiredAt: r.retiredAt })); }

export function setEnabled(name: string, enabled: boolean): PublicServer {
  const s = load();
  const rec = s.servers.find((x) => x.name === name);
  if (!rec) throw new McpError(`no installed server named ${name}`, 404);
  rec.enabled = enabled; rec.updatedAt = new Date().toISOString();
  save(s);
  return toPublic(rec);
}

export function retireServer(name: string): void {
  const s = load();
  const i = s.servers.findIndex((x) => x.name === name);
  if (i < 0) throw new McpError(`no installed server named ${name}`, 404);
  const [rec] = s.servers.splice(i, 1);
  s.retired.push({ ...rec, enabled: false, retiredAt: new Date().toISOString() });
  save(s);
}

export function restoreServer(name: string): PublicServer {
  const s = load();
  const i = s.retired.findIndex((x) => x.name === name);
  if (i < 0) throw new McpError(`no retired server named ${name}`, 404);
  if (s.servers.some((x) => x.name === name)) throw new McpError(`a server named ${name} is installed again already`, 409);
  const [r] = s.retired.splice(i, 1);
  const { retiredAt: _drop, ...rec } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  s.servers.push({ ...rec, enabled: false, updatedAt: new Date().toISOString() });
  save(s);
  return toPublic(rec);
}

/** BRAIN ONLY: the enabled servers as SDK configs, secrets included. */
export function sdkServers(): Record<string, { type: "http"; url: string; headers?: Record<string, string> } | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }> {
  const out: ReturnType<typeof sdkServers> = {};
  for (const s of load().servers) {
    if (!s.enabled) continue;
    out[s.name] = s.transport === "http"
      ? { type: "http", url: s.url!, ...(s.headers ? { headers: s.headers } : {}) }
      : { type: "stdio", command: s.command!, ...(s.args ? { args: s.args } : {}), ...(s.env ? { env: s.env } : {}) };
  }
  return out;
}

/** Changes whenever the enabled set or any of its configs changes (forces a fresh
 *  brain session), without putting secret values into the signature itself. */
export function externalSignature(): string {
  const enabled = load().servers.filter((s) => s.enabled);
  return createHash("sha256").update(JSON.stringify(enabled.map((s) => [s.name, s.transport, s.url, s.command, s.args, s.updatedAt]))).digest("hex").slice(0, 16);
}

/** External tool names look like mcp__<server>__<tool>; the built-in one is agentos. */
export function isExternalMcpTool(toolName: string): boolean {
  const m = /^mcp__([^_]+(?:-[^_]+)*)__/.exec(toolName);
  return !!m && m[1] !== "agentos";
}
