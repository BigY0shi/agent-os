# Paperclip

Route: `/paperclip` · UI: `src/app/paperclip/page.tsx`, `src/components/PaperclipSettings.tsx` · Backend: none in Agent OS (the only stored value is `settings.paperclip.url` in `src/lib/settings.ts`)

A launcher for Paperclip, your AI-company workspace. Paperclip is a separate app with its own login, so this page does not embed it. It works out Paperclip's address and opens it in a new tab.

## Tabs and controls

| Control | What it does |
|---|---|
| **Open Paperclip** | Opens Paperclip's home page in a new tab. The address it will open is shown underneath. |
| **Issues** | Opens `<address>/issues` in a new tab. |
| **Dashboard** | Opens `<address>/dashboard` in a new tab. |
| **Org** | Opens `<address>/org` in a new tab. |
| **Costs** | Opens `<address>/costs` in a new tab. |
| **Configure** (gear, titled "Paperclip settings") | Opens the settings panel. |

### Gear

| Control | What it does |
|---|---|
| **Paperclip URL** | A fixed address for Paperclip, such as a LAN IP, a Tailscale name or a domain. Leave blank to auto-detect. Trailing slashes are removed. |
| **Save** | Saves the address to the settings store. |

## How it works

- With no URL set, the address is `http://<the host you opened Agent OS on>:3100`. On this PC that is `http://localhost:3100`; from a phone on the LAN it is the PC's LAN IP. It always uses plain `http` and port 3100, so if you reach Agent OS through an HTTPS front (for example Tailscale serve) set the URL in the gear.
- The page does not check whether Paperclip is running. If the new tab fails to load, start Paperclip with `Start Paperclip Server.bat` in the repo root (and stop it with `Stop Paperclip.bat`).
- Paperclip runs in LAN mode and asks you to sign in once per device. That login belongs to Paperclip, not to Agent OS.
