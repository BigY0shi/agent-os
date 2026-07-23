import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import nodePath from "node:path";
import { config } from "./config";

// Cursor CLI (cursor-agent) doesn't ship an npm-style node shim — its .cmd/.ps1 launcher
// finds the latest versions/<v>/ and runs that version's BUNDLED node.exe + index.js.
// We replicate that here so we can spawn `node.exe index.js ...args` directly: a clean
// arg array (multiline-safe, no shell, no PowerShell re-parsing) using Cursor's own node.
// Version-proof — re-resolved every spawn, so a Cursor self-update just works.
function resolveCursorEntry(bin: string): { cmd: string; pre: string[] } | null {
  const base = nodePath.basename(bin).toLowerCase();
  if (base !== "cursor-agent.cmd" && base !== "cursor-agent.ps1" && base !== "agent.cmd") return null;
  const dir = nodePath.dirname(bin);
  const top = (n: string) => nodePath.join(dir, n);
  if (existsSync(top("node.exe")) && existsSync(top("index.js"))) {
    return { cmd: top("node.exe"), pre: [top("index.js")] };
  }
  const versionsDir = nodePath.join(dir, "versions");
  if (!existsSync(versionsDir)) return null;
  try {
    // Same filter Cursor's launcher uses — excludes the .zip and any junk in versions/.
    const re = /^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/;
    const versions = readdirSync(versionsDir).filter((n) => re.test(n)).sort().reverse();
    for (const v of versions) {
      const node = nodePath.join(versionsDir, v, "node.exe");
      const entry = nodePath.join(versionsDir, v, "index.js");
      if (existsSync(node) && existsSync(entry)) return { cmd: node, pre: [entry] };
    }
  } catch { /* fall through */ }
  return null;
}

// On Windows, npm-global CLIs (openclaw, kimi, grok, …) are .cmd/bash shims that Node's
// spawn can't execute directly (ENOENT), and routing a multiline-prompt arg through a
// shell mangles it. Resolve such a shim to its real Node entry so we spawn
// `node <entry> ...args` — a native exe with a clean arg array (no shell, multiline-safe).
// Native .exe bins (claude, agy, codex, hermes) pass straight through.
function resolveSpawn(bin: string): { cmd: string; pre: string[] } {
  if (process.platform !== "win32") return { cmd: bin, pre: [] };
  const cursor = resolveCursorEntry(bin);
  if (cursor) return cursor;
  if (/\.(exe|bat)$/i.test(bin)) return { cmd: bin, pre: [] };
  const cmdPath = /\.cmd$/i.test(bin) ? bin : (existsSync(bin + ".cmd") ? bin + ".cmd" : null);
  if (cmdPath && existsSync(cmdPath)) {
    try {
      const txt = readFileSync(cmdPath, "utf8");
      const m = txt.match(/node_modules[\\/][^"%\r\n]+\.(?:mjs|cjs|js)/i);
      if (m) {
        const entry = nodePath.join(nodePath.dirname(cmdPath), m[0]);
        if (existsSync(entry)) return { cmd: process.execPath, pre: [entry] };
      }
    } catch { /* fall through to raw bin */ }
  }
  return { cmd: bin, pre: [] };
}

// "fcc" is the Free Claude Code agent — it runs the same `claude` CLI but with
// the local fcc-server proxy env vars injected, routing requests to OpenRouter
// / NVIDIA NIM / Kimi / etc instead of api.anthropic.com.
// "codex" is OpenAI's Codex CLI (≥ 0.125 — supports `codex exec --json` for streaming).
export type AgentName = "claude" | "openclaw" | "hermes" | "antigravity" | "fcc" | "codex" | "cursor" | "pi" | "kimi" | "grok" | "ruflo" | "ant";

function binFor(agent: AgentName): string {
  // fcc is a virtual agent — it spawns the regular claude binary, just with
  // different env vars (see fccSpawnEnv in lib/fcc.ts).
  const key = agent === "fcc" ? "claude" : agent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bin = (config as any)[key];
  if (!bin) throw new Error(`${agent} is not installed or not configured. Set AGENTIC_OS_${key.toUpperCase()}_BIN or install the CLI.`);
  return bin;
}

// Build an env that agents can actually run subprocesses inside. The Next.js dev server's
// own process.env can be missing SHELL or have a stripped PATH, which causes Antigravity to
// crash mid-task with `fork/exec /bin/zsh: no such file or directory` and similar.
// We force SHELL + a baseline PATH covering all the standard macOS bin dirs + Homebrew + the
// user's local Node, so any tool the agent shells out to can be resolved.
// When the dashboard is launched from INSIDE another Claude Code process (or the
// Claude desktop app), the parent leaks CLAUDE_CODE_* / CLAUDE_AGENT_SDK_* vars that
// tell a spawned `claude` it's an SDK child whose OAuth token will be refreshed by a
// host. The dashboard isn't that host, so the token never refreshes → 401. We also
// drop an EMPTY ANTHROPIC_API_KEY/AUTH_TOKEN, which would otherwise override `claude
// login`. Net effect: agents spawn with the same clean env as a fresh terminal.
function sanitizeAgentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const k of Object.keys(env)) {
    if (k.startsWith("CLAUDE_CODE_") || k.startsWith("CLAUDE_AGENT_SDK")) delete env[k];
  }
  if (env.ANTHROPIC_API_KEY === "") delete env.ANTHROPIC_API_KEY;
  if (env.ANTHROPIC_AUTH_TOKEN === "") delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

function agentEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = process.env;
  // On Windows, NEVER rebuild PATH by splitting on ":" — that shreds "C:\..." into
  // "C" + "\...", corrupting the env so spawned agents can't resolve their own tools.
  // Windows already has a working PATH; pass it through untouched (+ the color flags).
  if (process.platform === "win32") {
    return sanitizeAgentEnv({ ...base, NO_COLOR: "1", FORCE_COLOR: "0", ...extra });
  }
  const ensurePath = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    `${process.env.HOME ?? "/Users/juliangoldie"}/.local/bin`,
    `${process.env.HOME ?? "/Users/juliangoldie"}/local/node/bin`,
    `${process.env.HOME ?? "/Users/juliangoldie"}/.kimi-code/bin`,
  ];
  const existing = (base.PATH ?? "").split(":").filter(Boolean);
  const merged = [...new Set([...existing, ...ensurePath])].join(":");
  return sanitizeAgentEnv({
    ...base,
    PATH: merged,
    SHELL: base.SHELL || "/bin/zsh",
    HOME: base.HOME || `/Users/${process.env.USER || "juliangoldie"}`,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    ...extra,
  });
}

const FLAG_PATTERN = /^[A-Za-z0-9_\-./:=,@+%]+$/;
const MAX_ARG_LEN = 32_000;

export function validateFlagArgs(args: readonly string[]): string[] {
  return args.filter((a) => typeof a === "string" && a.length < MAX_ARG_LEN && FLAG_PATTERN.test(a));
}

function safeArg(a: unknown): string | null {
  if (typeof a !== "string") return null;
  if (a.length === 0 || a.length > MAX_ARG_LEN) return null;
  if (a.includes("\0")) return null;
  return a;
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function run(
  agent: AgentName,
  args: readonly string[],
  opts: { timeoutMs?: number; cwd?: string; input?: string; extraEnv?: Record<string, string> } = {}
): Promise<RunResult> {
  const cleanArgs = args.map(safeArg).filter((a): a is string => a !== null);
  const started = Date.now();

  let bin: string;
  try { bin = binFor(agent); }
  catch (e) {
    return { ok: false, code: -1, stdout: "", stderr: String(e), durationMs: 0 };
  }

  return new Promise<RunResult>((resolve) => {
    const { cmd, pre } = resolveSpawn(bin);
    const child = spawn(cmd, [...pre, ...cleanArgs], {
      cwd: opts.cwd ?? process.env.HOME ?? process.env.USERPROFILE,
      env: agentEnv(opts.extraEnv ?? {}),
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, opts.timeoutMs ?? 15_000);

    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, code, stdout, stderr, durationMs: Date.now() - started });
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      resolve({ ok: false, code: -1, stdout, stderr: String(e), durationMs: Date.now() - started });
    });

    if (opts.input) child.stdin.write(opts.input);
    try { child.stdin.end(); } catch {}
  });
}

export function spawnStream(
  agent: AgentName,
  args: readonly string[],
  opts: { cwd?: string; input?: string; extraEnv?: Record<string, string> } = {}
): ChildProcessWithoutNullStreams {
  const bin = binFor(agent);
  const cleanArgs = args.map(safeArg).filter((a): a is string => a !== null);
  const { cmd, pre } = resolveSpawn(bin);
  const child = spawn(cmd, [...pre, ...cleanArgs], {
    cwd: opts.cwd ?? process.env.HOME ?? process.env.USERPROFILE,
    env: agentEnv(opts.extraEnv ?? {}),
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  if (typeof opts.input === "string" && opts.input.length > 0) {
    // Write the prompt to stdin (no OS arg-length limit, no per-arg cap).
    child.stdin.write(opts.input);
  }
  try { child.stdin.end(); } catch {}
  return child;
}
