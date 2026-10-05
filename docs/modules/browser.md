# Browser

Route: `/browser` · UI: `src/components/v2/browser/BrowserView.tsx`, `SessionList.tsx`, `CdpViewer.tsx`, `BrowserSettings.tsx` · Backend: `src/lib/v2/browser/`, `src/app/api/v2/browser/`

The agent browser. Agents drive Chromium through named sessions, and this page lets you watch them live, take over the mouse and keyboard, and open a visible window when a site needs you to log in. It is kept separate from your everyday browser: profiles live under `~/.agentic-os/browser-profiles`, and Opera is never offered as the executable.

The header shows how many sessions are live. If the browser capability is off, a yellow banner says Launch, handoff and tools are disabled until you turn it on in the gear.

## Tabs and controls

### Sessions rail (left)

Each row shows the session name, a live dot (green when running), a **headed** tag when it is a visible window, its profile, the domain allowlist count (or "open"), and the current URL.

| Control | What it does |
|---|---|
| **Session row** | Selects the session and shows it in the main viewer. |
| **Launch** (not running) | Starts the session headless via `/api/v2/browser/launch`. Disabled while the capability is off. |
| **Let me log in** | Relaunches the session as a real, visible window on the Windows desktop (`/api/v2/browser/handoff` with `headed: true`). Log in there directly. |
| **Return to headless** (headed sessions) | Relaunches headless. Cookies and logins stay in the profile. |
| **Close** (running) | Closes the browser for that session through the `browser_close_session` tool. |
| **X** (not running) | Removes the session config. The profile folder and its logins are kept. |
| **New session** | Opens the create form. Disabled at the maximum of 10 sessions. |
| **session name** | Letters, digits, `_` and `-`. |
| **Profile picker** | Which profile the session uses. |
| **allowed domains** | Optional comma separated list. Empty means any site. |
| **Create** / **Cancel** | Saves the new session, or closes the form. |

### Live view (main panel)

Shown when the selected session is running headless and has a CDP endpoint. Otherwise the panel explains why there is nothing to show (not running, headed on the desktop, or no CDP endpoint, in which case Close and Launch again).

| Control | What it does |
|---|---|
| **Back** / **Forward** / **Reload** | Browser navigation for the remote page. |
| **URL box** | Type a URL or search and press Enter to navigate. |
| **Status dot and text** | Connecting, Disconnected, or the error. |
| **Take control** / **Release** | Turns forwarding of your mouse, wheel and keyboard to the remote page on or off. Off by default, so the view is watch only. |
| **Reconnect** | Shown after a disconnect or error. Mints a new ticket and reconnects. |
| **Return to headless** (headed panel) | Same as the rail button. |

### Audit drawer (bottom)

| Control | What it does |
|---|---|
| **Audit - recent browser tool calls** | Expands a list of the last 50 tool calls: tool, session, caller, time, error, and an argument preview. Typed values are withheld, only field names are shown. Polls every 5 seconds while open. |

### Gear (Configure)

| Control | What it does |
|---|---|
| **Browser capability enabled** | One switch for everything that starts or drives Chromium: tools, Launch and handoff. |
| **WS port** | Port for the live view bridge, default 3738 (0 means pick any free port). Saved with **Save**. |
| **Bind** | `local (127.0.0.1)` or `lan (0.0.0.0)`. With lan, a copy button gives the PowerShell firewall rule for port 3738. Saves on change. |
| **default** / **chrome** / **brave** / **custom** | Which executable to launch. Default is Playwright's Chromium. Chrome and Brave are greyed out when not detected. |
| **Custom executable path** | Shown for custom. Saved when the field loses focus. |
| **Profiles (n/5)** list, **Exile** | Exile moves the profile folder into `browser-profiles/.exile/` (never deleted) and removes sessions bound to it. |
| **new profile name**, **Add** | Creates a profile. Up to 5 personal profiles. |
| **Session domain allowlists**, **Save** | Edit each session's allowed domains. Subdomains are included. |

## How it works

- Sessions, profiles, executable choice and port live in the `browser` section of the runtime settings store (`src/lib/settings.ts`). The capability switch is `capability.browserEnabled`.
- Running browsers are Playwright persistent contexts held in server memory, so a server restart ends them. Profile data on disk survives.
- The live view is a CDP screencast relayed over a WebSocket bridge on the WS port. Each connection needs a ticket from `/api/v2/browser/ticket`, valid for 5 minutes and signed with a secret stored at `~/.agentic-os/ws-secret`.
- Agents use tools such as `browser_navigate`, `browser_click`, `browser_type`, `browser_fill`, `browser_snapshot`, `browser_screenshot` and `browser_evaluate` through `/api/v2/browser/tool`. Every call is written to the `browser_tool_audit` table in the V2 SQLite database.
- Domain allowlists limit top-level navigation only. The page itself calls them a guardrail, not a security boundary.
- The headed window opens on the host PC's desktop, not inside this page. If you reach Agent OS from another device you will not see it.
