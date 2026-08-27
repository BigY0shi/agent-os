import path from "node:path";
import { readSettings } from "../../settings";
import type { FolderScope, GateDecision, GateOptions } from "./types";

/**
 * F3 gate: allow/deny evaluation BEFORE any spawn or fs touch.
 * Built-in deny list = union of the gateway docs list, the settings.json deny
 * list, and the agents constitution. User deny (settings.capability.execDeny)
 * is additive; user allow ("Bash(<glob>)") is evaluated last.
 * strict mode (MCP/external callers): empty allow = deny-all, zero folders = deny.
 */

const BUILTIN_DENY: RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*\//i, // rm on absolute paths
  /\brm\s+-[a-z]*[rf]/i,
  /\brmdir\b/i,
  /\bunlink\b/i,
  /\bshred\b/i,
  /\bfind\b.*-delete/i,
  /\bremove-item\b/i,
  /(^|[;&|]\s*)del\s/i,
  /(^|[;&|]\s*)ri\s/i,
  /(^|[;&|]\s*)rd\s/i,
  /(^|[;&|]\s*)erase\s/i,
  /\bclear-content\b/i,
  /\bgit\s+push\s+.*(--force|-f\b)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b/i,
  /\bsudo\b/i,
  /\bchmod\s+777\b/i,
  /\bmkfs\b/i,
  /\bformat\s+[a-z]:/i,
  /\bcurl\b[^|]*\|\s*(ba)?sh\b/i,
  /\bwget\b[^|]*\|\s*(ba)?sh\b/i,
  /\biwr\b[^|]*\|\s*iex\b/i,
  /\binvoke-webrequest\b[^|]*\|\s*invoke-expression\b/i,
];

/** "Bash(<glob>)" → RegExp over the whole command string. */
function patternToRegex(pattern: string): RegExp | null {
  const m = pattern.trim().match(/^Bash\((.+)\)$/i);
  if (!m) return null;
  const glob = m[1];
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[\\s\\S]*");
  return new RegExp(`^${escaped}$`, "i");
}

export function checkExec(command: string, opts: GateOptions = {}): GateDecision {
  const cmd = command.trim();
  if (!cmd) return { allowed: false, reason: "empty command" };

  for (const re of BUILTIN_DENY) {
    if (re.test(cmd)) {
      return {
        allowed: false,
        reason: `blocked by built-in deny list (${re.source}). Destructive removal is never allowed — exile files instead (move to .exile/).`,
      };
    }
  }

  const cap = readSettings().capability ?? {};
  for (const p of cap.execDeny ?? []) {
    const re = patternToRegex(p) ?? new RegExp(p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(cmd)) {
      return { allowed: false, reason: `blocked by user deny pattern: ${p}` };
    }
  }

  const allow = (cap.execAllow ?? []).map(patternToRegex).filter((r): r is RegExp => !!r);
  if (allow.length === 0) {
    if (opts.strict) {
      return {
        allowed: false,
        reason:
          "exec allowlist is empty and this caller is external (MCP): deny-all. Add Bash(<glob>) patterns in Settings → Capabilities to opt commands in.",
      };
    }
    return { allowed: true }; // in-app permissive first-run
  }
  if (allow.some((re) => re.test(cmd))) return { allowed: true };
  return { allowed: false, reason: "command matches no allow pattern (Bash(<glob>) list)" };
}

export interface FolderHit {
  root: string;
  scopes: FolderScope[];
}

/** Resolve + prefix-check a path against settings.capability.folders. */
export function checkPath(p: string, scope: FolderScope, opts: GateOptions = {}): GateDecision & { folder?: FolderHit } {
  const folders = readSettings().capability?.folders ?? [];
  const resolved = path.resolve(p);

  if (folders.length === 0) {
    if (opts.strict) {
      return {
        allowed: false,
        reason:
          "no capability folders configured and this caller is external (MCP): deny. Register folders in Settings → Capabilities.",
      };
    }
    return { allowed: true }; // permissive first-run for in-app callers
  }

  for (const f of folders) {
    const root = path.resolve(f.path);
    const withSep = root.endsWith(path.sep) ? root : root + path.sep;
    const inside = resolved === root || resolved.startsWith(withSep);
    if (inside && f.scopes.includes(scope)) {
      return { allowed: true, folder: { root, scopes: f.scopes } };
    }
  }
  return {
    allowed: false,
    reason: `path '${resolved}' is outside every folder registered with scope '${scope}' (FOLDER_SCOPE_DENIED)`,
  };
}
