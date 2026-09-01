import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSettings, writeSettings } from "../../settings";

/**
 * E1.2 — browser profiles & sessions config (port of AOC browser-config.ts).
 * Storage = settings.ts (settings.browser subtree, edited in the /browser gear —
 * rule 16) instead of the upstream preferences store. Profile dirs live under
 * ~/.agentic-os/browser-profiles.
 *
 * DELIBERATE DIVERGENCES from upstream:
 *  - exileProfile MOVES the profile dir to .exile/<stamp>_<name> — upstream
 *    deleteProfile ran fs.rmSync (house rule 1: nothing is ever destroyed).
 *  - NO Opera detection anywhere, and no opera browserType member. Opera is Yoshi's
 *    DAILY browser; the agent browser must stay fully isolated from it (E4.1
 *    invariant). Even though Opera is Chromium and would technically work,
 *    detecting/offering it would invite pointing agent sessions at his real
 *    profile. Chrome/Brave detection kept; Brave-preferred bias dropped.
 *  - upstream's string[]-session migration shims dropped (greenfield here).
 */

const MAX_PROFILES = 5;
/** Agent profiles are provisioned one-per-agent and are not the user's to
 *  manage, so they get their own headroom rather than eating MAX_PROFILES. */
const MAX_AGENT_PROFILES = 64;

/** `agent-1`, `agent-12`. Auto-provisioned; never a name a human types. */
export function isAgentProfileName(name: string): boolean {
  return /^agent-\d+$/.test(name);
}

function countUserProfiles(all: readonly string[]): number {
  return all.filter((p) => !isAgentProfileName(p)).length;
}
const MAX_SESSIONS = 10;
const DEFAULT_PROFILES = ["personal", "work", "misc"];
const NAME_RE = /^[a-zA-Z0-9_-]+$/;

export type BrowserType = "default" | "chrome" | "brave" | "custom";

export interface BrowserSessionConfig {
  name: string;
  profile: string;
  /** E4: empty/absent = unrestricted; else top-level navigations are restricted
   *  (host === entry or host endsWith "."+entry). */
  allowedDomains?: string[];
}

// win32-first paths (this box), darwin/linux kept from upstream for portability.
const CHROME_PATHS: Record<string, string[]> = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

const BRAVE_PATHS: Record<string, string[]> = {
  darwin: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
  linux: ["/usr/bin/brave-browser", "/usr/bin/brave", "/snap/bin/brave"],
  win32: [
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  ],
};

// ============ Profile directory root ============

/** Test override mirrors AGENTIC_OS_DB / AGENTIC_OS_SETTINGS — smokes must
 *  never create/exile dirs under the real home profile root. */
export function profilesRoot(): string {
  const override = process.env.AGENTIC_OS_BROWSER_PROFILES;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "browser-profiles");
}

/** THE single source for a session's user-data-dir (E4.1: manager.ts passes
 *  exactly this to launchPersistentContext — no code path accepts an arbitrary
 *  user-supplied directory). */
export function getProfileDir(profileName: string): string {
  if (!NAME_RE.test(profileName)) {
    // Defense in depth: a profile name can never traverse out of the root.
    throw new Error(`Invalid profile name "${profileName}"`);
  }
  return path.join(profilesRoot(), profileName);
}

// ============ Profiles ============

export function getConfiguredProfiles(): string[] {
  const profiles = readSettings().browser?.profiles;
  if (profiles && profiles.length > 0) return profiles.filter((p) => NAME_RE.test(p));
  return [...DEFAULT_PROFILES];
}

export function isProfileConfigured(name: string): boolean {
  return getConfiguredProfiles().includes(name);
}

export function createProfile(name: string): { success: boolean; error?: string } {
  if (!NAME_RE.test(name)) {
    return {
      success: false,
      error: "Profile name must contain only alphanumeric characters, hyphens, and underscores",
    };
  }
  const current = getConfiguredProfiles();
  if (current.includes(name)) {
    return { success: false, error: `Profile "${name}" already exists` };
  }
  // MAX_PROFILES is a budget on the HUMAN's profiles. Agent profiles are
  // auto-provisioned infrastructure, one per agent, and counting them here made
  // the third agent unprovisionable: 3 defaults + a cap of 5 left exactly two
  // agent slots. An agent that cannot get a profile cannot browse at all, so
  // this cap must not be the thing that decides how many agents may exist.
  if (!isAgentProfileName(name) && countUserProfiles(current) >= MAX_PROFILES) {
    return {
      success: false,
      error: `Maximum ${MAX_PROFILES} personal profiles allowed. Current: ${current.filter((p) => !isAgentProfileName(p)).join(", ")}`,
    };
  }
  if (isAgentProfileName(name) && current.filter(isAgentProfileName).length >= MAX_AGENT_PROFILES) {
    return {
      success: false,
      error: `Maximum ${MAX_AGENT_PROFILES} agent profiles allowed — remove an agent before creating another.`,
    };
  }
  const browser = readSettings().browser ?? {};
  writeSettings({ browser: { ...browser, profiles: [...current, name] } });
  return { success: true };
}

/**
 * Remove a profile from config and EXILE its on-disk dir (rule 1 — upstream
 * fs.rmSync deliberately NOT ported). The dir moves to
 * `<profilesRoot>/.exile/<stamp>_<name>`; sessions bound to the profile are
 * removed from config. Returns the exile destination when a dir existed.
 */
export function exileProfile(name: string): { success: boolean; error?: string; exiledTo?: string } {
  const current = getConfiguredProfiles();
  if (!current.includes(name)) {
    return { success: false, error: `Profile "${name}" does not exist` };
  }
  const browser = readSettings().browser ?? {};
  const sessions = (browser.sessions ?? []).filter((s) => s.profile !== name);
  writeSettings({
    browser: { ...browser, profiles: current.filter((p) => p !== name), sessions },
  });

  const dir = getProfileDir(name);
  if (!fs.existsSync(dir)) return { success: true };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const exileDir = path.join(profilesRoot(), ".exile");
  fs.mkdirSync(exileDir, { recursive: true });
  const dest = path.join(exileDir, `${stamp}_${name}`);
  try {
    fs.renameSync(dir, dest); // MOVE, never rm (house rule 1)
    return { success: true, exiledTo: dest };
  } catch (err) {
    // Windows: a live Chromium holds file locks — refuse loudly rather than
    // half-move. Caller must close the session first.
    return {
      success: false,
      error: `Could not exile profile dir (is a session still running on it?): ${String(err)}`,
    };
  }
}

// ============ Sessions ============

export function getConfiguredSessions(): BrowserSessionConfig[] {
  const raw = readSettings().browser?.sessions ?? [];
  return raw.filter((s) => s && typeof s.name === "string" && typeof s.profile === "string");
}

export function isSessionConfigured(name: string): boolean {
  return getConfiguredSessions().some((s) => s.name === name);
}

export function getSessionConfig(name: string): BrowserSessionConfig | undefined {
  return getConfiguredSessions().find((s) => s.name === name);
}

export function createSessionConfig(
  name: string,
  profile: string,
  allowedDomains?: string[],
): { success: boolean; error?: string } {
  if (!NAME_RE.test(name)) {
    return {
      success: false,
      error: "Session name must contain only alphanumeric characters, hyphens, and underscores",
    };
  }
  if (!isProfileConfigured(profile)) {
    return {
      success: false,
      error: `Profile "${profile}" does not exist. Available: ${getConfiguredProfiles().join(", ")}`,
    };
  }
  const current = getConfiguredSessions();
  if (current.some((s) => s.name === name)) {
    return { success: false, error: `Session "${name}" already exists` };
  }
  if (current.length >= MAX_SESSIONS) {
    return { success: false, error: `Maximum ${MAX_SESSIONS} sessions allowed` };
  }
  const domains = (allowedDomains ?? [])
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean);
  const browser = readSettings().browser ?? {};
  const entry: BrowserSessionConfig = { name, profile };
  if (domains.length > 0) entry.allowedDomains = domains;
  writeSettings({ browser: { ...browser, sessions: [...current, entry] } });
  return { success: true };
}

/** Config removal ONLY — the profile dir (auth state) is always preserved. */
export function deleteSessionConfig(name: string): { success: boolean; error?: string } {
  const current = getConfiguredSessions();
  if (!current.some((s) => s.name === name)) {
    return { success: false, error: `Session "${name}" does not exist` };
  }
  const browser = readSettings().browser ?? {};
  writeSettings({ browser: { ...browser, sessions: current.filter((s) => s.name !== name) } });
  return { success: true };
}

// ============ Browser executable ============

export function detectChromePath(): string | null {
  for (const p of CHROME_PATHS[process.platform] ?? []) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function detectBravePath(): string | null {
  for (const p of BRAVE_PATHS[process.platform] ?? []) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * E4.1(b): this NEVER returns Opera, even though Opera is Chromium and is
 * installed on this machine — Opera is Yoshi's daily-driver browser and the
 * agent browser must remain isolated from it by construction, not by
 * configuration discipline. Do not add an Opera path table.
 */
export function detectAvailableBrowsers(): { type: BrowserType; path: string }[] {
  const found: { type: BrowserType; path: string }[] = [];
  const chrome = detectChromePath();
  if (chrome) found.push({ type: "chrome", path: chrome });
  const brave = detectBravePath();
  if (brave) found.push({ type: "brave", path: brave });
  return found;
}

export function getBrowserExecutable(): { type: BrowserType; path?: string } {
  const b = readSettings().browser ?? {};
  return { type: (b.browserType as BrowserType) || "default", path: b.browserExecutable };
}

export function setBrowserExecutable(
  type: BrowserType,
  customPath?: string,
): { success: boolean; error?: string } {
  let browserExecutable: string | undefined;
  if (type === "default") {
    browserExecutable = undefined;
  } else if (type === "chrome") {
    const p = detectChromePath();
    if (!p) return { success: false, error: "Chrome not found. Install it or use a custom path." };
    browserExecutable = p;
  } else if (type === "brave") {
    const p = detectBravePath();
    if (!p) return { success: false, error: "Brave not found. Install it or use a custom path." };
    browserExecutable = p;
  } else if (type === "custom") {
    if (!customPath) return { success: false, error: "Custom path is required" };
    if (!fs.existsSync(customPath)) {
      return { success: false, error: `Browser not found at: ${customPath}` };
    }
    browserExecutable = customPath;
  } else {
    return { success: false, error: `Unknown browser type "${type}"` };
  }
  const browser = readSettings().browser ?? {};
  writeSettings({ browser: { ...browser, browserType: type, browserExecutable } });
  return { success: true };
}

export function getMaxProfiles(): number {
  return MAX_PROFILES;
}

export function getMaxSessions(): number {
  return MAX_SESSIONS;
}

export function getDefaultProfiles(): string[] {
  return [...DEFAULT_PROFILES];
}

// ============ Playwright readiness ============

export async function isPlaywrightReady(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

// ============ Profile ownership (credential containment) ============
//
// The profile directory IS the credential boundary: cookies live on disk per
// profile, and getProfileDir() is the only thing that produces the
// user-data-dir handed to launchPersistentContext. So an ownership check here
// is not a rule an agent is asked to follow - it decides whether Chromium is
// ever pointed at that directory. There is no instruction to disobey.
//
// Storage is additive: `profiles` stays a string[] for every existing reader,
// and ownership rides alongside in `profileOwners`. A profile with no recorded
// owner belongs to the USER. That default is deliberately the strict one - an
// unmapped profile denies agents rather than admitting them.

import { credentialOwnerOf, currentUserRef, displayFor, persistsFor } from "@/lib/v2/identity/principals";

/** Profile name -> principal ref. Unmapped means the human owns it. */
function ownerMap(): Record<string, string> {
  const raw = (readSettings().browser as { profileOwners?: Record<string, string> } | undefined)?.profileOwners;
  return raw && typeof raw === "object" ? raw : {};
}

export function profileOwner(profileName: string): string {
  return ownerMap()[profileName] ?? currentUserRef();
}

export function setProfileOwner(profileName: string, principalRef: string): { success: boolean; error?: string } {
  if (!NAME_RE.test(profileName)) return { success: false, error: `Invalid profile name "${profileName}"` };
  if (!credentialOwnerOf(principalRef)) return { success: false, error: `Invalid principal "${principalRef}"` };
  const browser = readSettings().browser ?? {};
  writeSettings({ browser: { ...browser, profileOwners: { ...ownerMap(), [profileName]: principalRef } } });
  return { success: true };
}

export interface AccessDecision {
  allowed: boolean;
  /** Populated on denial. Written to be shown verbatim - see the tools layer. */
  reason?: string;
  ownerRef?: string;
}

/**
 * May `principalRef` use `profileName`?
 *
 * Compared by CREDENTIAL OWNER, not by exact ref, which is what makes sub-agent
 * inheritance work: agent 43A and agent 43 both resolve to agent:43, so a
 * sub-agent reaches its orchestrator's profile and nothing else.
 */
export function checkProfileAccess(profileName: string, principalRef: string): AccessDecision {
  const ownerRef = profileOwner(profileName);
  const mine = credentialOwnerOf(principalRef);
  const theirs = credentialOwnerOf(ownerRef);
  if (!mine) {
    return { allowed: false, ownerRef, reason: `"${principalRef}" is not a valid principal.` };
  }
  if (mine === theirs) return { allowed: true, ownerRef };
  return {
    allowed: false,
    ownerRef,
    // Loud and specific: says who was denied, what they wanted, who holds it,
    // and what to do. A generic "access denied" here would send someone
    // debugging the browser stack instead of the ownership record.
    reason:
      `${displayFor(principalRef)} cannot use the "${profileName}" browser profile - ` +
      `it belongs to ${displayFor(ownerRef)}. Credentials are contained per principal: ` +
      `an agent may only use its own profile (and its orchestrator's, if it is a sub-agent). ` +
      `Give this agent its own profile, or reassign ownership in Browser settings.`,
  };
}

/** The profile a principal is entitled to by default: its own, auto-named. */
export function ownProfileName(principalRef: string): string {
  const owner = credentialOwnerOf(principalRef);
  if (!owner) throw new Error(`Invalid principal "${principalRef}"`);
  return owner.replace(":", "-").toLowerCase();
}

/** Create (idempotently) the profile a principal owns, and record ownership. */
export function ensureOwnProfile(principalRef: string): { success: boolean; profile?: string; error?: string } {
  const name = ownProfileName(principalRef);
  if (!isProfileConfigured(name)) {
    const r = createProfile(name);
    if (!r.success) return { success: false, error: r.error };
  }
  const owned = setProfileOwner(name, principalRef);
  if (!owned.success) return { success: false, error: owned.error };
  return { success: true, profile: name };
}

// ============ Ephemeral profiles (the persist-credentials answer) ============

/**
 * Where a NON-persistent principal's Chromium actually runs.
 *
 * Until this existed, `persistCredentials: false` was cosmetic: every profile
 * went through launchPersistentContext against a durable directory, so an agent
 * the user had explicitly declined to keep signed in kept its cookies anyway.
 * The checkbox asserted something the runtime did not do.
 *
 * Ephemeral state lives under the OS temp root rather than being deleted from
 * the profile root, because rule 1 forbids destroying files and a wipe-per-
 * launch would either pile up exile folders or quietly delete user data. Temp
 * is the one place where "goes away on its own" is the documented contract.
 */
export function ephemeralProfileDir(profileName: string): string {
  if (!NAME_RE.test(profileName)) throw new Error(`Invalid profile name "${profileName}"`);
  // Scoped to the PROCESS, which is what makes this need no deletion at all.
  // Within one server run the dir is stable, so a headed login handoff followed
  // by a headless relaunch still works. After a restart the pid differs, so the
  // agent starts signed out - which is exactly what "keep signed in between
  // runs: off" means. Rule 1 stays intact: nothing is ever destroyed, the state
  // is simply never reused, and the OS temp cleaner reclaims it.
  return path.join(os.tmpdir(), "agentos-ephemeral-profiles", `${process.pid}-${profileName}`);
}

/**
 * THE user-data-dir for a launch. Preserves the E4.1 invariant: the launcher
 * still never accepts an arbitrary directory, it picks between exactly two
 * non-arbitrary ones, and which one is decided by the persistence answer rather
 * than by anything a caller passes in.
 */
export function resolveLaunchDir(profileName: string): { dir: string; persistent: boolean } {
  const owner = profileOwner(profileName);
  const persistent = persistsFor(owner);
  return { dir: persistent ? getProfileDir(profileName) : ephemeralProfileDir(profileName), persistent };
}
