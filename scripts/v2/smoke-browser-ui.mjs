// SPEC-E E2.4–E2.6 + E4.1(c) smoke: the /browser page UI contract (static
// file/regex checks, house *-ui pattern — the dynamic ticket/bridge/route legs
// live in smoke-browser-ws.mjs, the tool/config legs in smoke-browser.mjs).
// Covers: files + 'use client' + exports; the CDP client port's load-bearing
// mechanics (frame ack with the FRAME sessionId, rawKeyDown, JPEG q70
// everyNthFrame 2, viewport-override replay, getNavigationHistory back/fwd,
// omnibox coercion); CdpViewer contract (ticket fetch on mount + Reconnect
// re-mints, Take Control gates input, non-passive wheel, 150ms debounced
// ResizeObserver viewport, headed banner + Return to headless); wsBridge
// mechanics present in source; tickets contract; launch/handoff gating
// (chunk-2 decision); BrowserSettings covering EVERY settings.browser field
// (rule 16) + the LAN firewall copy text; Sidebar placement (NAV AND
// ORCHESTRATION_ROUTES — documented gotcha); audit drawer wired to the audit
// route; boot wiring.
// Run: npx tsx scripts/v2/smoke-browser-ui.mjs
import path from "node:path";
import fs from "node:fs";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

// ── files exist + 'use client' where required ───────────────────────────────
const clientComponents = [
  "src/components/v2/browser/CdpViewer.tsx",
  "src/components/v2/browser/SessionList.tsx",
  "src/components/v2/browser/BrowserView.tsx",
  "src/components/v2/browser/BrowserSettings.tsx",
];
for (const f of clientComponents) {
  check(`${f} exists`, exists(f));
  if (exists(f)) check(`${f} is 'use client'`, /^"use client";/.test(read(f)));
}
check("cdpClient.ts + useCdpScreencast.ts + shared.ts exist",
  exists("src/components/v2/browser/cdpClient.ts") &&
  exists("src/components/v2/browser/useCdpScreencast.ts") &&
  exists("src/components/v2/browser/shared.ts"));
check("lib files exist (tickets/wsBridge)",
  exists("src/lib/v2/browser/tickets.ts") && exists("src/lib/v2/browser/wsBridge.ts"));
check("/browser page renders BrowserView",
  exists("src/app/browser/page.tsx") && read("src/app/browser/page.tsx").includes("BrowserView"));

// ── cdpClient port mechanics ────────────────────────────────────────────────
const cdpClient = read("src/components/v2/browser/cdpClient.ts");
check("cdpClient pins binaryType arraybuffer", cdpClient.includes('binaryType = "arraybuffer"'));
check("cdpClient id-correlated send + per-sessionId listeners",
  cdpClient.includes("this.nextId++") && cdpClient.includes("listeners.get(sid)"));
check("cdpClient exports eventModifiers bitmask", /export function eventModifiers/.test(cdpClient));

// ── useCdpScreencast port mechanics (§4 verbatim list) ──────────────────────
const hook = read("src/components/v2/browser/useCdpScreencast.ts");
check("frame ack uses the FRAME's own sessionId (p.sessionId)",
  hook.includes('"Page.screencastFrameAck"') && hook.includes("{ sessionId: p.sessionId }"));
check("rawKeyDown for printable keys", hook.includes('"rawKeyDown"'));
check("JPEG q70 + everyNthFrame 2", hook.includes("quality = 70") && hook.includes('format: "jpeg"') && hook.includes("everyNthFrame: 2"));
check("viewport override replayed on attach (setDeviceMetricsOverride before startScreencast)",
  hook.includes("Emulation.setDeviceMetricsOverride") && hook.indexOf("Emulation.setDeviceMetricsOverride") < hook.indexOf('"Page.startScreencast"'));
check("back/fwd via Page.getNavigationHistory + navigateToHistoryEntry",
  hook.includes("Page.getNavigationHistory") && hook.includes("Page.navigateToHistoryEntry"));
check("omnibox coercion (https:// prefix + search fallback)",
  hook.includes("https://${trimmed}") && hook.includes("google.com/search?q="));
check("wheel deltaMode scaling (line/page)", hook.includes("deltaMode === 1") && hook.includes("deltaMode === 2"));
check("Ctrl editor-command variants added (Windows box)", hook.includes("e.ctrlKey && !e.metaKey && !e.altKey"));
check("bridge close codes surfaced to the user (4400/4404/4502)",
  hook.includes("4400") && hook.includes("4404") && hook.includes("4502"));

// ── CdpViewer contract ──────────────────────────────────────────────────────
const viewer = read("src/components/v2/browser/CdpViewer.tsx");
check("viewer fetches a ticket on mount (POST /api/v2/browser/ticket)", viewer.includes('"/api/v2/browser/ticket"'));
check("Reconnect RE-MINTS (reconnect → fetchTicket)", /const reconnect = \(\) => fetchTicket\(\)/.test(viewer));
check("Take Control gates mouse forwarding", viewer.includes('hasControl && dispatchMouse("mousePressed"'));
check("Take Control gates keyboard wiring (effect on hasControl)", viewer.includes("if (!hasControl) return;"));
check("non-passive wheel listener with preventDefault",
  viewer.includes("{ passive: false }") && viewer.includes("e.preventDefault();"));
check("ResizeObserver → debounced 150ms setViewport", viewer.includes("ResizeObserver") && viewer.includes("setTimeout(apply, 150)"));
check("URL-input focus guard (isUrlFocusedRef via onFocus/onBlur)", viewer.includes("isUrlFocusedRef"));

// ── BrowserView: empty states, headed banner, audit drawer (E4.1c) ─────────
const view = read("src/components/v2/browser/BrowserView.tsx");
check("headed state shows the on-desktop banner", /REAL browser window on the machine/.test(view));
check("[Return to headless] posts handoff headed:false",
  view.includes("Return to headless") && view.includes("handoff(current.name, false)"));
check("Launch/handoff wired to the v2 routes",
  view.includes('"/api/v2/browser/launch"') && view.includes('"/api/v2/browser/handoff"'));
check("audit drawer lists /api/v2/browser/audit rows", view.includes("/api/v2/browser/audit?limit=50"));
check("audit drawer polls with usePollWhileVisible", view.includes("usePollWhileVisible(refreshAudit, 5000"));
check("capability-disabled state surfaced (gating decision UX)", view.includes("browser capability is disabled"));
check("honest empty states (not running / no CDP endpoint)",
  view.includes("is not running") && view.includes("No CDP endpoint"));

// ── tickets.ts contract ─────────────────────────────────────────────────────
const tickets = read("src/lib/v2/browser/tickets.ts");
check("key = sha256(AGENTOS_PASSWORD + boot salt)", tickets.includes("AGENTOS_PASSWORD") && tickets.includes("pw + readOrCreateBootSalt()"));
check("salt = 32 random bytes persisted once at ~/.agentic-os/ws-secret",
  tickets.includes("randomBytes(32)") && tickets.includes('"ws-secret"'));
check("TTL 300s + 5s skew", tickets.includes("300_000") && tickets.includes("5_000"));
check("constant-time compare", tickets.includes("timingSafeEqual"));
check("fail-closed without a password", tickets.includes("if (!pw) return null"));
check("test override AGENTIC_OS_WS_SECRET", tickets.includes("AGENTIC_OS_WS_SECRET"));

// ── wsBridge.ts: the four mandatory mechanics + codes + bind ────────────────
const wsb = read("src/lib/v2/browser/wsBridge.ts");
check("mechanic 1: text-frame normalization (toString('utf8'))", wsb.includes('toString("utf8")'));
check("mechanic 2: buffer-until-upstream-open then flush in order",
  wsb.includes("queue.push(frame)") && wsb.includes("for (const frame of queue)"));
check("mechanic 3: close-code sanitize 1000/3000-4999", wsb.includes("code >= 3000 && code <= 4999"));
check("mechanic 4: 25s pings both directions, cleared on close",
  wsb.includes("25_000") && wsb.includes("clientPing") && wsb.includes("upstreamPing") && wsb.includes("clearInterval(clientPing)"));
check("codes 4400/4404/4502 emitted", wsb.includes("4400") && wsb.includes("4404") && wsb.includes("4502"));
check("perMessageDeflate disabled on both hops", (wsb.match(/perMessageDeflate: false/g) ?? []).length >= 2);
check("bind local → 127.0.0.1 (lan opt-in)", wsb.includes('"127.0.0.1"') && wsb.includes('"0.0.0.0"'));
check("port conflict fails LOUDLY", wsb.includes("EADDRINUSE") && /PORT CONFLICT/.test(wsb));

// ── routes: ticket + handoff exist; launch-gating decision in force ─────────
check("ticket route exists and reads the Host header",
  exists("src/app/api/v2/browser/ticket/route.ts") && read("src/app/api/v2/browser/ticket/route.ts").includes('req.headers.get("host")'));
check("handoff route exists and calls launchSession(name, headed)",
  exists("src/app/api/v2/browser/handoff/route.ts") && read("src/app/api/v2/browser/handoff/route.ts").includes("launchSession(session, headed"));
const launchRoute = read("src/app/api/v2/browser/launch/route.ts");
check("launch route GATED behind the browser capability (chunk-2 decision)",
  launchRoute.includes("isBrowserCapabilityEnabled") && launchRoute.includes("CAPABILITY_DISABLED"));
const handoffRoute = read("src/app/api/v2/browser/handoff/route.ts");
check("handoff route gated too (consistent)", handoffRoute.includes("isBrowserCapabilityEnabled"));
for (const r of ["ticket", "handoff"]) {
  const src = read(`src/app/api/v2/browser/${r}/route.ts`);
  check(`${r} route follows the house idiom (nodejs/force-dynamic/no-store/ensureV2)`,
    src.includes('runtime = "nodejs"') && src.includes('dynamic = "force-dynamic"') && src.includes("no-store") && src.includes("ensureV2()"));
}

// ── BrowserSettings: EVERY settings.browser field (rule 16) ────────────────
const gear = read("src/components/v2/browser/BrowserSettings.tsx");
for (const field of ["wsPort", "wsBind", "browserType", "browserExecutable", "profiles", "sessions", "allowedDomains"]) {
  check(`gear covers settings.browser.${field}`, gear.includes(field));
}
check("gear surfaces the capability toggle (page is gated on it)", gear.includes("browserEnabled"));
check("gear carries the LAN firewall copy text (shown for wsBind lan)",
  gear.includes("New-NetFirewallRule") && gear.includes('wsBind === "lan"'));
check("gear says allowlists are a guardrail, not a boundary", /guardrail, not a security boundary/.test(gear));
// The gear's only mention of Opera is the explanatory "never offered" copy —
// assert the SELECTABLE browserType list has no opera member (E4.1 invariant).
check("no opera browserType option in the gear",
  /\(\["default", "chrome", "brave", "custom"\] as const\)/.test(gear) && !/["']opera["']/.test(gear));
check("BrowserView mounts the gear inside ConfigMenu with the sky accent",
  view.includes("<ConfigMenu") && view.includes("BrowserSettings"));

// ── SessionList per §6 ──────────────────────────────────────────────────────
const rail = read("src/components/v2/browser/SessionList.tsx");
check("rail: live dot + profile chip + allowlist badge", rail.includes("cdpReady") && rail.includes("allowedDomains"));
check("rail: Launch / 'Let me log in' / Close controls",
  rail.includes("Launch") && rail.includes("Let me log in") && rail.includes("Close"));
check("rail: + New session footer (name + profile + optional domains)", rail.includes("New session"));

// ── Sidebar placement (documented gotcha: NAV alone lands in 'Self') ───────
const sidebar = read("src/components/Sidebar.tsx");
check("Sidebar NAV has /browser with the sky accent",
  /href: "\/browser"/.test(sidebar) && sidebar.includes("#38bdf8"));
check("/browser is in ORCHESTRATION_ROUTES (Agent Orchestration section)",
  /ORCHESTRATION_ROUTES = new Set\(\[[^\]]*"\/browser"/.test(sidebar));

// ── boot wiring ─────────────────────────────────────────────────────────────
const boot = read("src/lib/v2/boot.ts");
check("boot.ts wires ensureBrowserWs (E2.2)", boot.includes("ensureBrowserWs"));
check("ws + playwright kept external (serverExternalPackages)",
  read("next.config.ts").includes('"ws"') && read("next.config.ts").includes('"playwright"'));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
