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
import { existsSync } from "node:fs";
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
