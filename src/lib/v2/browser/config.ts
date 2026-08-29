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
  if (current.length >= MAX_PROFILES) {
    return {
      success: false,
      error: `Maximum ${MAX_PROFILES} profiles allowed. Current: ${current.join(", ")}`,
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
