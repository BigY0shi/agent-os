// S37 Snapshots (Nexora C10): the knobs, the folders and the secret list.
//
// Every knob is a gear setting (rule 16): settings.snapshots { cadence, dir, keep,
// includeSecrets }, edited from the Snapshots card on Mission Control > Health. Nothing here
// is read at import time; every function reads settings per call so a change takes effect
// on the next snapshot without a restart.
//
// What a snapshot leaves out BY DEFAULT (the owner can turn "Include secrets" on):
//   - key and secret FILES under ~/.agentic-os (SECRET_FILES / SECRET_PATTERNS below)
//   - the secret FIELDS of settings.json and config.json (same rule as the /api/settings
//     mask, lib/settingsRedact.ts isSecretPath); the files themselves are kept with those
//     fields removed, and the manifest lists which ones
// Integration tokens live in the database as AES-GCM blobs whose key is agentos.key, a
// secret file, so the DB copy carries them unreadable unless the key is included too.
//
// What a snapshot never copies, whatever the setting (derived or live-only state):
//   the live database files (replaced by the backup-API copy), backups/ (the nightly DB
//   copies), .exile/, the process lock, heygen-cache/.

import os from "node:os";
import path from "node:path";
import { readSettings } from "../../settings";
import { isSecretPath } from "../../settingsRedact";

export type SnapshotCadence = "weekly" | "biweekly" | "monthly" | "off";
export const CADENCES: SnapshotCadence[] = ["weekly", "biweekly", "monthly", "off"];
export const CADENCE_LABEL: Record<SnapshotCadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  off: "Off",
};

export const DEFAULT_CADENCE: SnapshotCadence = "weekly";
export const DEFAULT_KEEP = 8;
export const MAX_KEEP = 200;

/** The RRULE each cadence schedules (Sunday / the 1st, 04:00 local, when the box is idle). */
export const CADENCE_RRULE: Record<Exclude<SnapshotCadence, "off">, string> = {
  weekly: "FREQ=WEEKLY;BYDAY=SU;BYHOUR=4;BYMINUTE=0",
  biweekly: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU;BYHOUR=4;BYMINUTE=0",
  monthly: "FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=4;BYMINUTE=0",
};

export interface SnapshotSettings {
  cadence: SnapshotCadence;
  dir: string; // "" = <home>/AgentOS-snapshots
  keep: number;
  includeSecrets: boolean;
}

export function snapshotSettings(): SnapshotSettings {
  const raw = (readSettings().snapshots ?? {}) as Partial<SnapshotSettings>;
  const cadence = CADENCES.includes(raw.cadence as SnapshotCadence) ? (raw.cadence as SnapshotCadence) : DEFAULT_CADENCE;
  const keepNum = Number(raw.keep);
  const keep = Number.isInteger(keepNum) && keepNum >= 1 && keepNum <= MAX_KEEP ? keepNum : DEFAULT_KEEP;
  return {
    cadence,
    dir: typeof raw.dir === "string" ? raw.dir.trim() : "",
    keep,
    includeSecrets: raw.includeSecrets === true,
  };
}

/** Expand a leading "~" the way the owner types paths. */
function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** The state folder a snapshot copies: ~/.agentic-os (AGENTIC_OS_SNAPSHOT_SOURCE for smokes). */
export function snapshotSourceDir(): string {
  const override = process.env.AGENTIC_OS_SNAPSHOT_SOURCE;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(os.homedir(), ".agentic-os");
}

/** Where snapshots land: the setting, else <home>/AgentOS-snapshots. Always outside the source. */
export function snapshotRootDir(settings: SnapshotSettings = snapshotSettings()): string {
  const chosen = settings.dir ? path.resolve(expandHome(settings.dir)) : path.join(os.homedir(), "AgentOS-snapshots");
  const src = snapshotSourceDir();
  const rel = path.relative(src, chosen);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(`snapshots: the snapshot folder (${chosen}) must be outside the state folder it copies (${src}). Change it in the Snapshots gear.`);
  }
  return chosen;
}

/** Secret FILES by exact relative path (posix separators, relative to ~/.agentic-os). */
export const SECRET_FILES: string[] = [
  "secrets.json", // Agents HTTP tool / {{secret:NAME}} values
  "session-secret.json", // login session signing secret
  "principals.json", // owner login credentials
  "agentos.key", // integrations AES key (tokens in the DB are unreadable without it)
  "ws-secret", // browser CDP bridge
  "rabbit.secret",
  "jarvis-hotkey.secret",
  "jarvis-glasses.token",
  "newsletter/config.json", // addy.io key
  "agentmail/config.json", // AgentMail key
];

/** Secret files by shape, anywhere under the state folder. */
export const SECRET_PATTERNS: { label: string; test: (rel: string) => boolean }[] = [
  { label: "*.env (buzz, suno, heygen, gemini, indexceptional)", test: (rel) => /\.env$/i.test(rel) },
  { label: "*.secrets.json (WebMCP package secrets)", test: (rel) => /\.secrets\.json$/i.test(rel) },
  { label: "*.secret, *.token, *.key, *.pem", test: (rel) => /\.(secret|token|key|pem)$/i.test(rel) },
  { label: "browser-profiles/ (logged-in browser sessions)", test: (rel) => rel === "browser-profiles" || rel.startsWith("browser-profiles/") },
];

/** Files whose secret FIELDS are removed (not the whole file) unless secrets are included. */
export const REDACTED_JSON_FILES = ["settings.json", "config.json"];

/** Never copied, whatever the setting: live or derived state with its own home. */
export const EXCLUDED_ALWAYS: { label: string; test: (rel: string) => boolean }[] = [
  { label: "backups/ (the nightly DB copies)", test: (rel) => rel === "backups" || rel.startsWith("backups/") },
  { label: ".exile/", test: (rel) => rel === ".exile" || rel.startsWith(".exile/") },
  { label: "agentos.lock", test: (rel) => rel === "agentos.lock" },
  { label: "heygen-cache/", test: (rel) => rel === "heygen-cache" || rel.startsWith("heygen-cache/") },
];

export function isSecretRel(rel: string): boolean {
  return SECRET_FILES.includes(rel) || SECRET_PATTERNS.some((p) => p.test(rel));
}

export function isExcludedRel(rel: string): boolean {
  return EXCLUDED_ALWAYS.some((p) => p.test(rel));
}

/**
 * Remove every secret-looking string field from a parsed JSON document (settings.json,
 * config.json). Returns the dotted paths removed so the manifest can list them.
 */
export function stripSecretFields(doc: unknown, prefix = "", removed: string[] = []): { doc: unknown; removed: string[] } {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { doc, removed };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" && v && isSecretPath(p)) {
      removed.push(p);
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) out[k] = stripSecretFields(v, p, removed).doc;
    else out[k] = v;
  }
  return { doc: out, removed };
}

/** The exclusion rules as the manifest and the docs state them. */
export function exclusionSummary(includeSecrets: boolean): { always: string[]; secrets: string[] } {
  return {
    always: EXCLUDED_ALWAYS.map((e) => e.label).concat(["the live database files (replaced by the backup-API copy)"]),
    secrets: includeSecrets ? [] : [...SECRET_FILES, ...SECRET_PATTERNS.map((p) => p.label), `secret fields of ${REDACTED_JSON_FILES.join(" and ")}`],
  };
}
