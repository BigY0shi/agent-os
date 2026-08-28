import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sanitizeSpawnEnv } from "../../spawnEnv";
import { cliComplete } from "../../loopEngine";
import type { AgentName } from "../../runner";
import { checkExec, checkPath } from "./gate";
import type { GateOptions, SlotResult } from "./types";

/**
 * F3 slots. Every entry point gate-checks BEFORE spawning/touching anything.
 * Deny reasons name the alternative (exile, settings opt-in). Consumed by F4's
 * action registry and, later, by B (tasks), C (jarvis), E (browser page).
 */

const MAX_OUTPUT = 200_000;
const MAX_READ = 500_000;

// ---------------------------------------------------------------------------

export async function execSlot(
  opts: { command: string; cwd?: string; timeoutMs?: number },
  gate: GateOptions = {},
): Promise<SlotResult> {
  const decision = checkExec(opts.command, gate);
  if (!decision.allowed) {
    return { ok: false, output: "", error: decision.reason };
  }
  if (opts.cwd) {
    const pd = checkPath(opts.cwd, "exec", gate);
    if (!pd.allowed) return { ok: false, output: "", error: pd.reason };
  }

  const timeoutMs = Math.min(opts.timeoutMs ?? 120_000, 600_000);
  const isWin = process.platform === "win32";
  const [bin, args] = isWin
    ? ["cmd.exe", ["/d", "/s", "/c", opts.command]]
    : ["/bin/sh", ["-c", opts.command]];

  return new Promise<SlotResult>((resolve) => {
    const started = Date.now();
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: sanitizeSpawnEnv(process.env),
      windowsVerbatimArguments: isWin,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (isWin && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.stdout.on("data", (b) => {
      if (stdout.length < MAX_OUTPUT) stdout += b.toString();
    });
    child.stderr.on("data", (b) => {
      if (stderr.length < MAX_OUTPUT) stderr += b.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        output: stdout,
        error: timedOut
          ? `timed out after ${timeoutMs}ms`
          : code !== 0
            ? stderr.trim() || `exit code ${code}`
            : undefined,
        meta: { exitCode: code, durationMs: Date.now() - started, stderr: stderr.slice(0, 4000) },
      });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, output: stdout, error: String(e) });
    });
    child.stdin.on("error", () => {});
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------

export async function codingSlot(
  opts: { agent: string; prompt: string; cwd: string; timeoutMs?: number },
  gate: GateOptions = {},
): Promise<SlotResult> {
  const pd = checkPath(opts.cwd, "coding", gate);
  if (!pd.allowed) return { ok: false, output: "", error: pd.reason };
  try {
    const text = await cliComplete(opts.agent as AgentName, opts.prompt, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? 240_000,
      fullAccess: true,
    });
    return { ok: true, output: text };
  } catch (err) {
    return { ok: false, output: "", error: String(err) };
  }
}

// ---------------------------------------------------------------------------

function exileBeforeOverwrite(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const exileDir = path.join(path.dirname(filePath), ".exile", stamp);
  fs.mkdirSync(exileDir, { recursive: true });
  const dest = path.join(exileDir, path.basename(filePath));
  fs.copyFileSync(filePath, dest);
  return dest;
}

function* walk(dir: string, depth = 0): Generator<string> {
  if (depth > 8) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === ".exile") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full, depth + 1);
    else if (e.isFile()) yield full;
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/§§/g, ".*");
  return new RegExp(`${escaped}$`, "i");
}

export type FilesOp =
  | { op: "read"; path: string }
  | { op: "write"; path: string; content: string }
  | { op: "glob"; dir: string; pattern: string }
  | { op: "grep"; dir: string; query: string; filePattern?: string };

export async function filesSlot(input: FilesOp, gate: GateOptions = {}): Promise<SlotResult> {
  try {
    switch (input.op) {
      case "read": {
        const pd = checkPath(input.path, "files", gate);
        if (!pd.allowed) return { ok: false, output: "", error: pd.reason };
        if (!fs.existsSync(input.path)) return { ok: false, output: "", error: "file not found" };
        const content = fs.readFileSync(input.path, "utf8");
        return {
          ok: true,
          output: content.length > MAX_READ ? content.slice(0, MAX_READ) + "\n[truncated]" : content,
        };
      }
      case "write": {
        const pd = checkPath(input.path, "files", gate);
        if (!pd.allowed) return { ok: false, output: "", error: pd.reason };
        const exiled = exileBeforeOverwrite(input.path);
        fs.mkdirSync(path.dirname(input.path), { recursive: true });
        fs.writeFileSync(input.path, input.content, "utf8");
        return {
          ok: true,
          output: `wrote ${input.content.length} chars to ${input.path}`,
          meta: exiled ? { exiledPrevious: exiled } : undefined,
        };
      }
      case "glob": {
        const pd = checkPath(input.dir, "files", gate);
        if (!pd.allowed) return { ok: false, output: "", error: pd.reason };
        const re = globToRegex(input.pattern);
        const hits: string[] = [];
        for (const f of walk(input.dir)) {
          if (re.test(f.replace(/\\/g, "/")) || re.test(path.basename(f))) hits.push(f);
          if (hits.length >= 500) break;
        }
        return { ok: true, output: hits.join("\n"), meta: { count: hits.length } };
      }
      case "grep": {
        const pd = checkPath(input.dir, "files", gate);
        if (!pd.allowed) return { ok: false, output: "", error: pd.reason };
        const fileRe = input.filePattern ? globToRegex(input.filePattern) : null;
        const q = input.query.toLowerCase();
        const out: string[] = [];
        for (const f of walk(input.dir)) {
          if (fileRe && !fileRe.test(path.basename(f))) continue;
          let text: string;
          try {
            const stat = fs.statSync(f);
            if (stat.size > 2_000_000) continue;
            text = fs.readFileSync(f, "utf8");
          } catch {
            continue;
          }
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              out.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
              if (out.length >= 300) break;
            }
          }
          if (out.length >= 300) break;
        }
        return { ok: true, output: out.join("\n"), meta: { count: out.length } };
      }
    }
  } catch (err) {
    return { ok: false, output: "", error: String(err) };
  }
}

// ---------------------------------------------------------------------------

/**
 * E3.4 — the browser slot (SPEC-E). Gate = settings.capability.browserEnabled
 * (the /browser gear + Settings → Capabilities toggle): disabled ⇒ the tools
 * are absent from the manifest AND every dispatch returns CAPABILITY_DISABLED.
 * Tool-level audit (browser_tool_audit rows, redacted args, fill/type values
 * withheld) happens inside executeBrowserTool — every call, incl. denials.
 */
export async function browserSlot(
  toolName: string,
  args: Record<string, unknown>,
  info: { caller?: string; taskId?: string | null; agentId?: string | null } = {},
): Promise<SlotResult> {
  const { executeBrowserTool, isBrowserCapabilityEnabled } = await import("../browser/tools");
  if (!isBrowserCapabilityEnabled()) {
    return {
      ok: false,
      output: "",
      error:
        "CAPABILITY_DISABLED: the browser capability is off. Enable it in Settings → Capabilities.",
    };
  }
  const res = await executeBrowserTool(toolName, args, { ...info, skipCapabilityCheck: true });
  if (res.ok) {
    return { ok: true, output: JSON.stringify(res.result), meta: { tool: toolName } };
  }
  return {
    ok: false,
    output: "",
    error: `${res.error.code}: ${res.error.message}`,
    meta: { code: res.error.code },
  };
}
