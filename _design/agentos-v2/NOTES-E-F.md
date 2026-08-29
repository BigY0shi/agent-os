# NOTES — Workstreams E (Browser) + F (Agents page)

Working notes, not a report. Started Phase 7 chunk 1 (E1/E3/E4.1); E2 + F land in later chunks.

## Ports

- **CDP WS bridge: 3738** (`settings.browser.wsPort`, /browser gear). Not yet running — `wsBridge.ts` is chunk 2 (E2.2). Binds 127.0.0.1 by default (`settings.browser.wsBind: 'local' | 'lan'`, CONVENTIONS §9.2); every connection will require an HMAC ticket because proxy.ts's password gate does NOT cover :3738.
- Chromium's own CDP port is ephemeral (`--remote-debugging-port=0`), read per-launch from `<profileDir>/DevToolsActivePort` and confirmed via `http://127.0.0.1:<port>/json/version`.

## Firewall (LAN live-view only — chunk 2)

Only needed when `wsBind` is flipped to `lan`:

```powershell
New-NetFirewallRule -DisplayName "AgentOS Browser WS" -Direction Inbound -LocalPort 3738 -Protocol TCP -Action Allow
```

Surface this as copyable text in BrowserSettings (E2.6), shown only for 'lan'.

## Opera isolation invariant (E4.1)

- Opera is Yoshi's daily browser. It is **never** a detection target: `detectAvailableBrowsers()` in `src/lib/v2/browser/config.ts` knows only Chrome/Brave, `browserType` has no "opera" member, and there is no Opera path table to extend.
- `launchPersistentContext` is called in **exactly one place** (`src/lib/v2/browser/manager.ts` `doLaunch()`), and its user-data-dir argument is exactly `getProfileDir(profile)` under `~/.agentic-os/browser-profiles/` — `getProfileDir` rejects any name failing `/^[a-zA-Z0-9_-]+$/`, so no code path can point a session at an arbitrary directory (i.e. an Opera profile). `scripts/v2/smoke-browser.mjs` grep-asserts the single call site.
- Profile "deletion" is **exile**: the dir moves to `browser-profiles/.exile/<stamp>_<name>` (upstream's `fs.rmSync` deliberately not ported — house rule 1). The one sanctioned `rm` in this workstream is the three Chromium Singleton* lock files of a dead process (SPEC-E §8 risk 2).

## Provenance

- `config.ts` / `manager.ts` / `tools.ts` are verbatim-adapts of AgentOSCore (`packages/cli/src/utils/browser-config.ts`, `browser-manager.ts`, `packages/cli/src/server/tools/browser-tools.ts`) per SPEC-E §4; divergences: settings.ts storage, exile-not-rm, no Opera, allowlist guard (tool-level DOMAIN_BLOCKED + context.route document guard installed iff `allowedDomains?.length`), audit row per tool call, win32 stale-lock branch, one-profile-one-Chromium pre-check.
- The browser-driving skill (`~/.agentic-os/skills/browser-driving/SKILL.md`, seeded idempotently at boot, registered in `settings.skills.modules.browser` — FILE-skill lane) adapts the AOC gateway "BROWSER TASK WORKFLOW" prompt block + spec additions (login-wall stop → headed handoff, headed-for-anti-bot, confirm-before-irreversible).
- Migration **050 'browser_core'** (browser_sessions + browser_tool_audit, TEXT ISO timestamps per CONVENTIONS §1.4). Harness/agent-status tables (F workstream) will take later slots in 050–059.

## Deps

- `playwright` 1.62.1 + `ws` 8.21.3 (+ `@types/ws` dev) installed 2026-08-27; `npx playwright install chromium` done (Chromium 151 ~114 MB at `%LOCALAPPDATA%\ms-playwright\chromium-1234`). One-time manual step on a fresh machine; `isPlaywrightReady()` gates instead of crashing.

## Safety notes

- Allowlists are a guardrail, NOT a security boundary (§8 risk 6): `browser_evaluate` can still fetch cross-origin in-page; a human in Take Control drives raw CDP. The context-level document guard covers link-clicks/CDP navs; settings UI copy must say so.
- `browser_fill` / `browser_type` audit rows store the field NAME only — values never reach `browser_tool_audit` (CONVENTIONS §9.3).
- `browser_evaluate` approval for ask-mode agents (CONVENTIONS §9.5) is an F-workstream wire-in — TODO with F3.
