import fs from "node:fs";
import path from "node:path";
import { SKILLS_DIR } from "../../platformSkills";
import { readSettings, writeSettings } from "../../settings";

/**
 * E3.5 — browser-driving skill seed. LANE CHOICE (decided + documented): this
 * is a FILE-lane skill (~/.agentic-os/skills/browser-driving/SKILL.md,
 * platformSkills.ts), NOT a v2_skills DB policy row — the spec registers it in
 * `settings.skills.modules.browser`, which is exactly platformSkills'
 * per-module map, and platformSkills.withSkills(prompt, "browser") is the
 * injection function CLI-agent lanes already run through. The DB lane
 * (skills/store.withSkills) injects ALL active policies with no module scoping,
 * which would put browser workflow rules in front of every task/Jarvis prompt.
 *
 * Content = verbatim-adapt of AOC gateway.ts "BROWSER TASK WORKFLOW"
 * (snapshot-first, refs-over-text, recovery ladder) + the spec's additions:
 * stop at login walls → request the headed handoff, headed for anti-bot,
 * confirm before irreversible actions.
 *
 * Idempotent: the SKILL.md is written only when absent (a user-edited file is
 * never overwritten), and the settings module registration is added only when
 * missing. Safe to call every boot.
 */

export const BROWSER_SKILL_NAME = "browser-driving";

const SKILL_MD = `---
name: browser-driving
description: Operating rules for driving the Agent OS browser tools (browser_*) — session setup, snapshot-first interaction, recovery ladder, login walls, and confirmation gates. Injected whenever an agent drives a browser session.
---

BROWSER TASK WORKFLOW (use when the intent needs a live website):

PHASE 1 — Set up the session:
1. Call browser_list_sessions to see configured sessions and profiles.
2. Pick a session whose profile matches the intent (personal vs work). If the intent doesn't specify, prefer "personal".
3. If no suitable session exists, call browser_create_session with a descriptive name and a profile.

PHASE 2 — Navigate:
1. Call browser_navigate with the URL.
   - Use headed: true for sites known to block headless browsers (ticketing, Amazon, anti-bot-protected sites). Default false otherwise.
   - A DOMAIN_BLOCKED error means the session has a domain allowlist — do NOT try to work around it; report which host was blocked and ask the user to edit the allowlist in Browser settings if the site is genuinely needed.
2. Call browser_wait_for with state: "domcontentloaded" (or "networkidle" for SPA-heavy sites) before doing anything else.

PHASE 3 — Discover before you act:
1. ALWAYS call browser_snapshot before the first interaction on a page. The snapshot returns the ARIA tree with refs you'll need for clicks/fills.
2. Re-snapshot after navigation, after a major DOM update, or when an element you expected isn't found.
3. Never click or fill blind — the snapshot is your source of truth for what's on screen.

PHASE 4 — Interact:
- Use browser_click / browser_fill / browser_type / browser_select_option with the ref from the snapshot when possible (refs are stable; text matching is fragile).
- After each interaction that triggers navigation or a state change, browser_wait_for again.
- When the user needs to SEE the result (price comparison, search results, a dashboard), call browser_screenshot at the end. The screenshot is your evidence — return it.

PHASE 5 — Recover:
- If a click fails: re-snapshot, find the element by a different ref or by text, retry once.
- If a page is blank or stuck: try browser_wait_for with networkidle, then re-snapshot.
- If a site requires login and the profile isn't logged in: STOP and report back — do NOT attempt to log in or guess credentials. Ask the user for a headed handoff ("Let me log in" on the /browser page relaunches the session visibly on the desktop); once they've logged in, the profile keeps the auth state and you can continue headless.
- If a site blocks the headless browser (endless captchas, blank shells): retry the navigation with headed: true before giving up.
- If the intent involves several search/booking sites and one fails, try the next.

CONFIRMATION:
- Read-only browsing → just do it.
- State-changing actions (booking, posting, paying, sending, deleting) → confirm with the user before the irreversible step. Never complete a purchase or submit a form with personal data without an explicit go-ahead.

WHAT TO RETURN:
- Read-only intents: structured findings as text (prices, dates, options) AND the screenshot as evidence.
- Action intents: a confirmation summary (what was done, on which site, with what parameters) AND a screenshot of the confirmation page.
- Failures: what was attempted, what failed, at which step, and a screenshot of the failed state.
`;

export function seedBrowserDrivingSkill(
  skillsDir: string = SKILLS_DIR,
): { wroteFile: boolean; registered: boolean } {
  let wroteFile = false;
  let registered = false;
  try {
    const dir = path.join(skillsDir, BROWSER_SKILL_NAME);
    const file = path.join(dir, "SKILL.md");
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, SKILL_MD, "utf8");
      wroteFile = true;
    }

    const skills = readSettings().skills ?? {};
    const modules = skills.modules ?? {};
    const browserList = modules.browser ?? [];
    if (!browserList.includes(BROWSER_SKILL_NAME)) {
      writeSettings({
        skills: {
          ...skills,
          modules: { ...modules, browser: [...browserList, BROWSER_SKILL_NAME] },
        },
      });
      registered = true;
    }
  } catch (err) {
    console.error("[browser/skillSeed] seed failed:", err);
  }
  return { wroteFile, registered };
}
