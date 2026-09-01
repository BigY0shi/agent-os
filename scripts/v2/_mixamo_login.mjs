// Headed login handoff for the "mixamo" Agent Browser profile.
//
// Option A per Yoshi 2026-08-31: he authenticates once in a VISIBLE window;
// launchPersistentContext keeps the session in the profile dir on disk, so
// every later (headless) run inherits it. No credential ever passes through
// the agent, and no Agent OS app password is needed — this talks to the
// profile directory directly rather than through the 401-gated HTTP API.
//
// getProfileDir() is imported from the app's own config so the path is exactly
// the one the server's browser module will use later. Raw launchPersistentContext
// is used instead of manager.doLaunch() because this standalone process wants
// none of the manager's db/audit/CDP machinery — only the profile.

import { chromium } from "playwright";

const cfg = await import("../../src/lib/v2/browser/config.ts");

const PROFILE = "mixamo";

if (!cfg.isProfileConfigured(PROFILE)) {
  const r = cfg.createProfile(PROFILE);
  console.log(r.success ? `[setup] profile "${PROFILE}" registered` : `[setup] profile: ${r.error}`);
} else {
  console.log(`[setup] profile "${PROFILE}" already registered`);
}

if (!cfg.getSessionConfig?.(PROFILE)) {
  const r = cfg.createSessionConfig?.(PROFILE, PROFILE, ["mixamo.com", "adobe.com", "auth.services.adobe.com"]);
  if (r) console.log(r.success ? `[setup] session "${PROFILE}" registered (mixamo.com + adobe auth)` : `[setup] session: ${r.error}`);
}

const profileDir = cfg.getProfileDir(PROFILE);
console.log(`[setup] profile dir: ${profileDir}`);

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: null,
  args: ["--start-maximized"],
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto("https://www.mixamo.com/", { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("");
console.log("  ==> A Chromium window is open. Sign in to Mixamo (Adobe) there.");
console.log("  ==> When you are signed in, just CLOSE the window.");
console.log("");

// Resolve when the human closes the window — that is the "done" signal.
await new Promise((resolve) => {
  context.on("close", resolve);
  const t = setInterval(() => {
    if (context.pages().length === 0) { clearInterval(t); resolve(); }
  }, 2000);
});

console.log("[done] window closed — session saved to the profile dir.");
process.exit(0);
