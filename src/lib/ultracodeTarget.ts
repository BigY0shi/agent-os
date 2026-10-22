// What an Ultracode mission works on (owner, 2026-09-30: "have it ask for a folder or repo").
// A local folder is used where it is; a git repo URL is shallow-cloned into
// ~/.agentic-os/ultracode-repos (NOT the Claude scratch root, whose files the Workspace serves
// and previews). Either way the run keeps its own project folder as its cwd, the target is
// added with `--add-dir`, and readOnlyArgs() makes it really read-only: writes under it are
// denied by permission rules and the shell is off (verified live 2026-09-30 on this machine:
// a Write into the target was refused, a report in the cwd was written).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_ULTRACODE_EFFORT, DEFAULT_ULTRACODE_MODEL, isUltracodeEffort, isUltracodeModel, type UltracodeEffort,
} from "./ultracodeModels";

export interface UltracodeChoice { model: string; effort: UltracodeEffort }

/** The request's model/effort if given, else the Ultracode settings, else the defaults.
 *  Anything that is not a valid choice is an error (never silently swapped). */
export function ultracodeChoice(saved: { model?: string; effort?: string } | undefined, req: { model?: unknown; effort?: unknown }): UltracodeChoice {
  const model = String(req.model || saved?.model || DEFAULT_ULTRACODE_MODEL).trim();
  const effort = String(req.effort || saved?.effort || DEFAULT_ULTRACODE_EFFORT).trim();
  if (!isUltracodeModel(model)) throw new Error(`"${model}" is not a Claude model Ultracode can run (e.g. claude-opus-5-5, claude-sonnet-5-5, claude-fable-5-1, claude-opus-5).`);
  if (!isUltracodeEffort(effort)) throw new Error(`"${effort}" is not an effort level (low, medium, high, xhigh, max).`);
  return { model, effort };
}

export interface UltracodeTarget { dir: string; label: string; kind: "folder" | "repo" }

/** Where repo URLs are cloned. Outside the Claude scratch root on purpose (see above). */
export const ULTRACODE_REPOS_ROOT = process.env.AGENTIC_OS_ULTRACODE_REPOS ?? path.join(os.homedir(), ".agentic-os", "ultracode-repos");

const REPO_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[A-Za-z0-9._~\/-]+?(?:\.git)?\/?$/;

// Never let git wait on a credential prompt (it would hang the request): public https only.
function git(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-c", "credential.interactive=never", ...args], {
      timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]} failed: ${String(stderr || err.message).trim().slice(-300)}`));
      else resolve(String(stdout));
    });
  });
}

/** The URL in the one form we compare clones by (no .git, no trailing slash, lower case). */
export function normalizeRepoUrl(url: string): string {
  return url.trim().replace(/\.git\/?$|\/+$/g, "").toLowerCase();
}

/** Where a repo URL is cloned: one folder per repo under `reposRoot`, named from the host and
 *  the whole path plus a short hash of the full URL, so two repos can never share a folder.
 *  Throws for anything that is not an https git URL. */
export function repoCloneDir(url: string, reposRoot: string): string {
  if (!REPO_URL.test(url)) throw new Error(`"${url}" is not a repo URL Ultracode can clone (use an https:// git URL, e.g. https://github.com/owner/repo).`);
  const u = new URL(url);
  const slug = u.pathname.replace(/\.git\/?$|\/$/g, "").split("/").filter(Boolean).join("-").replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase().slice(0, 60) || "repo";
  const hash = createHash("sha1").update(normalizeRepoUrl(url)).digest("hex").slice(0, 8);
  return path.join(reposRoot, `${u.hostname.toLowerCase().replace(/[^a-z0-9.-]/g, "-")}-${slug}-${hash}`);
}

/** The --disallowedTools rule path for `dir` in the form the claude CLI matches on this OS:
 *  Windows C:\a\b -> //c/a/b/** (lower-case drive, forward slashes; the //C:/... form did NOT
 *  match in the live test), POSIX /a/b -> //a/b/**. */
export function permissionPathFor(dir: string): string {
  const win = /^([A-Za-z]):[\\/](.*)$/.exec(dir);
  if (win) return `//${win[1].toLowerCase()}/${win[2].split(String.fromCharCode(92)).join("/").replace(/\/+$/, "")}/**`;
  return `//${dir.replace(/^\/+/, "").replace(/\/+$/, "")}/**`;
}

/** CLI args that make the target read-only for the run: edits allowed in the mission's own
 *  folder (acceptEdits), denied under the target, and no shell (it could write anywhere). */
export function readOnlyArgs(dir: string): string[] {
  const rule = permissionPathFor(dir);
  return ["--permission-mode", "acceptEdits", "--disallowedTools", "Bash", `Edit(${rule})`, `Write(${rule})`, `NotebookEdit(${rule})`];
}

/**
 * Resolve the mission's target. `reposRoot` is where repo URLs are cloned (one folder per
 * repo, re-used and fast-forwarded on the next run). Throws a plain-language error for a
 * folder that does not exist, a file, or a URL that is not an https git URL.
 */
export async function resolveUltracodeTarget(input: string, reposRoot: string): Promise<UltracodeTarget> {
  const raw = input.trim();
  if (!raw) throw new Error("No folder or repo given.");
  if (/^https?:\/\//i.test(raw) || raw.startsWith("git@")) {
    const dest = repoCloneDir(raw, reposRoot);
    await mkdir(reposRoot, { recursive: true });
    if (existsSync(path.join(dest, ".git"))) {
      // Reuse only a clone of THIS repo, then move it to the remote's current tip. A shallow
      // `pull --ff-only` fails once upstream moves (the new tip is a fresh shallow root), so
      // fetch the tip and check it out; the clone is scratch and the run cannot write to it.
      const origin = (await git(["-C", dest, "remote", "get-url", "origin"], 30_000)).trim();
      if (normalizeRepoUrl(origin) !== normalizeRepoUrl(raw)) throw new Error(`${dest} is a clone of ${origin}, not ${raw}; move it aside and try again.`);
      await git(["-C", dest, "fetch", "--depth", "1", "origin", "HEAD"], 180_000);
      await git(["-C", dest, "checkout", "--detach", "--force", "FETCH_HEAD"], 60_000);
    } else if (existsSync(dest)) {
      throw new Error(`${dest} exists but is not a git checkout; move it aside and try again.`);
    } else {
      await git(["clone", "--depth", "1", "-c", "core.symlinks=false", "--", raw, dest], 300_000);
    }
    return { dir: dest, label: raw, kind: "repo" };
  }
  if (!path.isAbsolute(raw)) throw new Error(`"${raw}" is not an absolute folder path (e.g. C:\\Users\\you\\code\\project) or an https repo URL.`);
  if (!existsSync(raw)) throw new Error(`Folder not found: ${raw}`);
  if (!statSync(raw).isDirectory()) throw new Error(`${raw} is a file, not a folder.`);
  const dir = realpathSync(raw);
  return { dir, label: dir, kind: "folder" };
}

/** The line put in front of a targeted mission's prompt. */
export function targetNote(t: UltracodeTarget): string {
  return `The code to work on is in this ${t.kind === "repo" ? `clone of ${t.label}` : "folder"}: ${t.dir}\n`
    + "It is read-only for this run (writes there are denied and the shell is off). Read it from there; write your report and any other files into the current working folder.";
}
