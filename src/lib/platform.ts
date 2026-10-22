// Cross-platform helpers.
//
// This codebase was authored on macOS and runs on Windows. The same three POSIX
// assumptions were re-implemented in ~15 files and broke every one of them here:
//   1. `open <target>`            — macOS only
//   2. `python3`                  — Windows ships `python` / `py`, not `python3`
//   3. PATH built by joining on ":" — Windows PATH is ";"-delimited, so gluing a
//      POSIX blob on corrupts the FIRST real entry and can break resolution
//
// Everything that launches a thing, finds Python, or extends PATH should use these
// instead of hand-rolling it again.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, accessSync, constants as fsConstants, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const IS_WIN = process.platform === "win32";
export const IS_MAC = process.platform === "darwin";

/** Resolve an executable on PATH. Uses `where` on Windows, `command -v` elsewhere. */
export function whichBin(cmd: string): string | null {
  try {
    const r = IS_WIN
      ? spawnSync("where", [cmd], { encoding: "utf8" })
      : spawnSync("command", ["-v", cmd], { encoding: "utf8", shell: "/bin/sh" });
    const first = (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first || null;
  } catch { return null; }
}

/**
 * Open a URL or an installed application, cross-platform.
 * Returns true if the launcher exited cleanly. Callers MUST validate/allow-list
 * `target` first — this does not sanitise it (no shell is used, so the risk is
 * launching an unintended target, not command injection).
 */
export function launchTarget(target: string, opts?: { isUrl?: boolean }): Promise<boolean> {
  const t = target.trim();
  const isUrl = opts?.isUrl ?? /^https?:\/\//i.test(t);
  let cmd: string;
  let args: string[];
  if (IS_WIN) {
    // `cmd /c start "" <target>` handles URLs and registered app names alike.
    // The empty "" is the window-title argument `start` requires.
    cmd = "cmd";
    args = ["/c", "start", "", t];
  } else if (IS_MAC) {
    cmd = "open";
    args = isUrl ? [t] : ["-a", t];
  } else {
    cmd = "xdg-open";
    args = [t];
  }
  return new Promise((resolve) => {
    try {
      const c = spawn(cmd, args, { stdio: "ignore" });
      c.on("close", (code) => resolve(code === 0));
      c.on("error", () => resolve(false));
    } catch { resolve(false); }
  });
}

/**
 * Find a usable Python interpreter.
 * Windows has `python`/`py` (and a `python3` App-Execution-Alias stub that opens the
 * Microsoft Store rather than running anything), so probing in the right order matters.
 * Override with AGENTIC_OS_PY_BIN.
 */
let _py: string | null | undefined;
export function pythonBin(): string | null {
  if (_py !== undefined) return _py;
  const override = process.env.AGENTIC_OS_PY_BIN?.trim();
  if (override && (existsSync(override) || whichBin(override))) return (_py = override);
  const candidates = IS_WIN ? ["python", "py", "python3"] : ["python3", "python"];
  for (const c of candidates) {
    const found = whichBin(c);
    if (!found) continue;
    // Skip the Windows Store alias stub (0-byte shim under WindowsApps).
    if (IS_WIN && /WindowsApps/i.test(found)) continue;
    return (_py = found);
  }
  return (_py = null);
}

/** Path to a virtualenv's python, honouring the per-OS venv layout. */
export function venvPython(venvDir: string): string | null {
  const p = IS_WIN
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python3");
  return existsSync(p) ? p : null;
}

/**
 * Extend PATH with extra directories, using the platform's own separator.
 * The old pattern — `[...posixDirs].join(":") + ":" + process.env.PATH` — is a bug on
 * Windows: it glues a ":"-joined blob onto a ";"-delimited PATH, corrupting the first
 * entry. On Windows we pass PATH through untouched unless Windows-specific dirs are
 * supplied, since Homebrew/POSIX dirs are meaningless here anyway.
 */
export function augmentPath(extraDirs: string[] = [], base = process.env.PATH ?? ""): string {
  const sep = IS_WIN ? ";" : ":";
  const usable = extraDirs.filter((d) => d && (!IS_WIN || existsSync(d)));
  if (!usable.length) return base;
  return [...usable, base].filter(Boolean).join(sep);
}

/** POSIX dirs commonly prepended for CLI tools — a no-op on Windows. */
export const POSIX_TOOL_DIRS = IS_WIN
  ? []
  : ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", path.join(os.homedir(), ".local", "bin")];

/**
 * Every match for `name` on a PATH, in PATH order, honouring PATHEXT on Windows.
 * A plain scan rather than `where` / `command -v`: those are themselves subprocesses
 * that need a PATH to be found on, which a caller handing us a custom PATH (a deploy
 * env, a smoke's temp bin) may not have.
 */
export function whichAll(name: string, envPath: string = process.env.PATH ?? ""): string[] {
  const sep = IS_WIN ? ";" : ":";
  const dirs = envPath.split(sep).map((d) => d.trim()).filter(Boolean);
  const exts = IS_WIN
    ? ["", ...((process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.trim()).filter(Boolean))]
    : [""];
  const out: string[] = [];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (!existsSync(p)) continue;
      if (!IS_WIN) { try { accessSync(p, fsConstants.X_OK); } catch { continue; } }
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

export interface ResolvedCli {
  /** What to hand to spawn(): a native exe (or node.exe for an npm shim). */
  cmd: string;
  /** Leading args spawn() needs before the caller's own (the shim's JS entry, or nothing). */
  pre: string[];
  /** The PATH entry that was found (the shim or exe), for logs. */
  found: string;
}

/**
 * Resolve a CLI name into something Node's spawn() can run WITHOUT a shell.
 *
 * On Windows an npm-installed CLI (netlify, npx, eleventy, ...) is a `.cmd` shim, and
 * `spawn("netlify", args)` fails instantly with ENOENT because CreateProcess only runs
 * .exe files; routing the call through a shell instead would mean string-concatenating
 * the args (global CLAUDE.md: never invoke a bare .CMD/.BAT from a subprocess). So, in
 * PATH order: a real `.exe` is used as is; a `.cmd` shim is read for the
 * `node_modules/.../*.js` entry it launches and we run `node <entry> ...args` ourselves
 * with a clean arg array (the same trick lib/runner.ts uses for the agent CLIs). Anything
 * else is an error that says what was found, never a silent fallback.
 * On macOS / Linux the first executable match is returned unchanged.
 * Re-resolved on every call (cheap), so an install or update is picked up without a restart.
 */
export function resolveCli(name: string, envPath: string = process.env.PATH ?? ""): ResolvedCli | { error: string } {
  const found = whichAll(name, envPath);
  if (!found.length) return { error: `${name} is not on PATH` };
  if (!IS_WIN) return { cmd: found[0], pre: [], found: found[0] };
  const exe = found.find((p) => /\.exe$/i.test(p));
  if (exe) return { cmd: exe, pre: [], found: exe };
  const shim = found.find((p) => /\.cmd$/i.test(p));
  if (!shim) return { error: `${name} was found only as ${found[0]}, which Node cannot run on Windows (no .exe or .cmd)` };
  let txt: string;
  try { txt = readFileSync(shim, "utf8"); } catch (e) { return { error: `could not read ${shim}: ${String(e)}` }; }
  // The same entry pattern lib/runner.ts reads out of the agent CLIs' shims. A shim can
  // name more than one script (Node's own npx.cmd runs npm-prefix.js first to locate
  // npx-cli.js); the CLI's entry is the last one that exists and is not that helper.
  const refs = [...txt.matchAll(/node_modules[\\/][^"%\r\n]+\.(?:mjs|cjs|js)/gi)].map((m) => m[0]);
  const entries = [...new Set(refs)]
    .filter((r) => !/npm-prefix\.js$/i.test(r))
    .map((r) => path.join(path.dirname(shim), r))
    .filter((p) => existsSync(p));
  if (!refs.length) return { error: `${shim} is a .cmd shim whose Node entry could not be found; Node cannot run .cmd files without a shell` };
  if (!entries.length) return { error: `${shim} points at ${refs.join(", ")}, which does not exist beside it` };
  return { cmd: process.execPath, pre: [entries[entries.length - 1]], found: shim };
}
