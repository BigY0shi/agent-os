import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import {
  getProfileDir,
  getBrowserExecutable,
  getSessionConfig,
  profilesRoot,
} from "./config";
import { recordSessionRow, closeSessionRow } from "./audit";

/**
 * E1.3 — browser session manager (port of AOC browser-manager.ts).
 * Cross-request state lives on globalThis.__agentosBrowser (Next dev-server
 * module-instance convention). CDP endpoint capture = DevToolsActivePort poll
 * + /json/version (Browser.wsEndpoint() doesn't exist for
 * launchPersistentContext launches).
 */

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  sessionName: string;
  profile: string;
  profileDir: string;
  headed: boolean;
  createdAt: number;
  cdpWsEndpoint?: string;
  cdpHttpEndpoint?: string;
  cdpPort?: number;
}

interface BrowserState {
  sessions: Map<string, BrowserSession>;
  locksCleared: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __agentosBrowser: BrowserState | undefined;
}

function state(): BrowserState {
  if (!globalThis.__agentosBrowser) {
    globalThis.__agentosBrowser = { sessions: new Map(), locksCleared: false };
  }
  return globalThis.__agentosBrowser;
}

/** E4/E3.3 host matcher: host === entry, or host ends with "."+entry
 *  (suffix match — sub.example.com passes an "example.com" entry). */
export function isHostAllowed(host: string, allowedDomains: string[] | undefined): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowedDomains.some((raw) => {
    const entry = raw.toLowerCase().replace(/\.$/, "");
    return h === entry || h.endsWith("." + entry);
  });
}

// ---------------------------------------------------------------------------
// Stale SingletonLock clearing (§8 risk 2)

const SINGLETON_FILES = ["SingletonLock", "SingletonCookie", "SingletonSocket"];

/**
 * POSIX: Chromium writes SingletonLock as a symlink targeting `<host>-<pid>` —
 * stale when the host differs or the pid is dead (upstream logic, kept).
 * win32: the singleton files are ordinary files, not symlinks (readlinkSync
 * throws EINVAL/UNKNOWN) — a lock left behind by a dead process just exists.
 * The win32 branch treats any singleton file on a profile with NO live session
 * in OUR map as stale.
 */
function lockIsStale(profileDir: string): boolean {
  const lockPath = path.join(profileDir, "SingletonLock");
  if (process.platform === "win32") {
    return SINGLETON_FILES.some((f) => fs.existsSync(path.join(profileDir, f)));
  }
  let target: string;
  try {
    target = fs.readlinkSync(lockPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    return true; // exists but unparseable — treat as stale
  }
  const dash = target.lastIndexOf("-");
  if (dash < 0) return true;
  const host = target.slice(0, dash);
  const pid = Number(target.slice(dash + 1));
  if (host !== os.hostname()) return true;
  if (!Number.isFinite(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

/**
 * Walk every profile under profilesRoot() and remove stale Chromium singleton
 * files. Profiles with a LIVE session in our map are never touched — within a
 * running process the sessionMap is the source of truth and Chromium manages
 * its own locks. Called lazily before the first launch (no boot hook needed).
 *
 * NOTE on rule 1 (never delete): fs.rmSync here targets ONLY the three
 * Chromium singleton lock files — runtime droppings of a dead process, not
 * user data. This is the one sanctioned rm in the browser workstream
 * (SPEC-E §8 risk 2 explicitly permits it); exiling a lock file would wedge
 * Chromium exactly the same as leaving it.
 */
export function clearStaleProfileLocks(): { cleared: string[] } {
  const root = profilesRoot();
  const cleared: string[] = [];
  if (!fs.existsSync(root)) return { cleared };

  const liveProfiles = new Set([...state().sessions.values()].map((s) => s.profile));

  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return { cleared };
  }
  for (const entry of entries) {
    if (entry === ".exile") continue;
    if (liveProfiles.has(entry)) continue;
    const profileDir = path.join(root, entry);
    try {
      if (!fs.statSync(profileDir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!lockIsStale(profileDir)) continue;
    for (const name of SINGLETON_FILES) {
      try {
        fs.rmSync(path.join(profileDir, name), { force: true }); // lock files only — see note above
      } catch {
        /* best effort */
      }
    }
    cleared.push(entry);
    console.log(`[browser] cleared stale profile lock for "${entry}"`);
  }
  return { cleared };
}

// ---------------------------------------------------------------------------
// CDP endpoint capture

async function captureCdpEndpoint(
  profileDir: string,
): Promise<{ port: number; wsEndpoint: string; httpEndpoint: string } | null> {
  const portFile = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(portFile)) {
        const contents = fs.readFileSync(portFile, "utf8").trim();
        const portStr = contents.split("\n")[0];
        const port = portStr ? parseInt(portStr, 10) : NaN;
        if (Number.isFinite(port) && port > 0) {
          const httpEndpoint = `http://127.0.0.1:${port}`;
          const res = await fetch(`${httpEndpoint}/json/version`);
          if (res.ok) {
            const body = (await res.json()) as { webSocketDebuggerUrl?: string };
            if (body.webSocketDebuggerUrl) {
              return { port, wsEndpoint: body.webSocketDebuggerUrl, httpEndpoint };
            }
          }
        }
      }
    } catch {
      /* try again */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.warn(`[browser] no CDP endpoint after 5s for ${profileDir}`);
  return null;
}

// ---------------------------------------------------------------------------
// Launch

export interface LaunchCallerInfo {
  caller?: string; // 'user' | 'jarvis' | 'task:<id>' | 'agent:<id>' | 'mcp:<source>'
  taskId?: string | null;
  agentId?: string | null;
}

/**
 * E4.1 INVARIANT — the ONLY launchPersistentContext call in the codebase.
 * Its user-data-dir argument is EXACTLY getProfileDir(profile) resolved from
 * the session's CONFIG — no code path accepts an arbitrary directory, so an
 * agent can never point a session at Yoshi's Opera (or any other) profile.
 * smoke-browser.mjs grep-asserts the single call site.
 */
async function doLaunch(
  sessionName: string,
  headed: boolean,
  info: LaunchCallerInfo,
): Promise<{ session?: BrowserSession; error?: string }> {
  const sessionConfig = getSessionConfig(sessionName);
  if (!sessionConfig) {
    return {
      error: `Session "${sessionName}" is not configured. Create it in Browser settings (or browser_create_session).`,
    };
  }

  // §8 risk 5: one profile = one Chromium. Refuse a second live session on a
  // profile already held, naming the holder.
  for (const live of state().sessions.values()) {
    if (live.profile === sessionConfig.profile && live.sessionName !== sessionName) {
      return {
        error: `Profile "${sessionConfig.profile}" is already in use by live session "${live.sessionName}". Close it first or bind this session to another profile.`,
      };
    }
  }

  // Lazy stale-lock pass on first manager use this process (§8 risk 2).
  if (!state().locksCleared) {
    state().locksCleared = true;
    try {
      clearStaleProfileLocks();
    } catch (err) {
      console.warn("[browser] stale-lock clearing failed:", err);
    }
  }

  try {
    const { chromium } = await import("playwright");
    const profileDir = getProfileDir(sessionConfig.profile);
    fs.mkdirSync(profileDir, { recursive: true });

    const browserConfig = getBrowserExecutable();
    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless: !headed,
      args: ["--remote-debugging-port=0"],
      // NOTE: no `env` is passed — Playwright spawns Chromium itself. If env
      // is ever added here, strip PORT first (E1.3 note).
    };
    if (browserConfig.type !== "default" && browserConfig.path) {
      launchOptions.executablePath = browserConfig.path;
    }

    const context = await chromium.launchPersistentContext(profileDir, launchOptions);

    // E3.3 defense-in-depth (installed iff the session HAS an allowlist —
    // CONVENTIONS §10): abort main-frame DOCUMENT navigations to hosts off
    // the allowlist. Context-wide, so it also covers page link-clicks and a
    // human driving raw CDP in Take Control. Subresources stay unrestricted
    // (CDNs must load). This is a guardrail, not a security boundary (§8
    // risk 6) — browser_evaluate can still fetch cross-origin in-page.
    const allowed = sessionConfig.allowedDomains;
    if (allowed?.length) {
      await context.route("**/*", (route) => {
        const req = route.request();
        let isMainFrameDoc = false;
        try {
          isMainFrameDoc =
            req.resourceType() === "document" &&
            req.isNavigationRequest() &&
            !req.frame().parentFrame();
        } catch {
          isMainFrameDoc = false; // service-worker requests have no frame
        }
        if (isMainFrameDoc) {
          let host = "";
          try {
            host = new URL(req.url()).hostname;
          } catch {
            /* non-URL scheme — let Chromium handle it */
          }
          if (host && !isHostAllowed(host, allowed)) {
            void route.abort("blockedbyclient");
            return;
          }
        }
        void route.continue();
      });
    }

    context.on("close", () => {
      state().sessions.delete(sessionName);
      closeSessionRow(sessionName);
    });

    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await captureCdpEndpoint(profileDir);

    const session: BrowserSession = {
      context,
      page,
      sessionName,
      profile: sessionConfig.profile,
      profileDir,
      headed,
      createdAt: Date.now(),
      cdpPort: cdp?.port,
      cdpWsEndpoint: cdp?.wsEndpoint,
      cdpHttpEndpoint: cdp?.httpEndpoint,
    };

    state().sessions.set(sessionName, session);
    recordSessionRow({
      sessionName,
      profileName: sessionConfig.profile,
      createdBy: info.caller ?? "user",
      taskId: info.taskId ?? null,
      agentId: info.agentId ?? null,
    });
    return { session };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to launch browser" };
  }
}

/** Idempotent: returns the live session, or launches one (headless unless asked). */
export async function getOrLaunchSession(
  sessionName: string,
  headed = false,
  info: LaunchCallerInfo = {},
): Promise<{ session?: BrowserSession; error?: string }> {
  const existing = state().sessions.get(sessionName);
  if (existing) {
    if (existing.page.isClosed()) {
      try {
        existing.page = await existing.context.newPage();
      } catch (err) {
        // Context died underneath us — drop and relaunch.
        state().sessions.delete(sessionName);
        void err;
        return doLaunch(sessionName, headed, info);
      }
    }
    return { session: existing };
  }
  return doLaunch(sessionName, headed, info);
}

/** Force-relaunch (used by the E2 headed handoff): closes any live instance first. */
export async function launchSession(
  sessionName: string,
  headed: boolean,
  info: LaunchCallerInfo = {},
): Promise<{ session?: BrowserSession; error?: string }> {
  const existing = state().sessions.get(sessionName);
  if (existing) {
    await existing.context.close().catch(() => {});
    state().sessions.delete(sessionName);
    closeSessionRow(sessionName);
  }
  return doLaunch(sessionName, headed, info);
}

export async function closeSession(
  sessionName: string,
): Promise<{ success: boolean; error?: string }> {
  const session = state().sessions.get(sessionName);
  if (!session) {
    return { success: false, error: `Session "${sessionName}" is not running` };
  }
  try {
    await session.context.close();
    state().sessions.delete(sessionName);
    closeSessionRow(sessionName);
    return { success: true };
  } catch (err) {
    state().sessions.delete(sessionName);
    closeSessionRow(sessionName);
    return { success: false, error: err instanceof Error ? err.message : "Failed to close session" };
  }
}

export async function closeAllSessions(): Promise<{ success: boolean }> {
  const names = [...state().sessions.keys()];
  await Promise.allSettled(names.map((name) => closeSession(name)));
  return { success: true };
}

export function getLiveSessions(): string[] {
  return [...state().sessions.keys()];
}

export function getLiveSession(sessionName: string): BrowserSession | undefined {
  return state().sessions.get(sessionName);
}

/** Live CDP info for the E2 WS bridge; null when not running / not captured. */
export function getSessionCdpInfo(
  sessionName: string,
): { wsEndpoint: string; httpEndpoint: string; port: number } | null {
  const s = state().sessions.get(sessionName);
  if (!s || !s.cdpWsEndpoint || !s.cdpHttpEndpoint || !s.cdpPort) return null;
  return { wsEndpoint: s.cdpWsEndpoint, httpEndpoint: s.cdpHttpEndpoint, port: s.cdpPort };
}
