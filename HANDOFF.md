# Agent-OS Dashboard — Session Handoff Instructions

**Date:** April 12, 2026
**Project:** Agent-OS Next.js Dashboard
**Location:** `C:\Users\Yoshi\Documents\Claude\Projects\DevOps\agent-os`
**User:** Yoshi (robbyjdenton@gmail.com)

---

## PROJECT OVERVIEW

Agent-OS is a Next.js 14 dashboard for managing an AI agent workforce structured as a corporate hierarchy. The dashboard facilitates the full agent lifecycle — from conceptual brainstorming through to refined, deploy-ready AGENT.md and SKILL.md specification files.

**Tech stack:** Next.js 14, Tailwind CSS, SQLite via sql.js, lucide-react icons
**Theme:** Dark mode with orange accent (#F97316)
**Target deployment:** Raspberry Pi tablet (kiosk mode) + desktop browser

The agents are used across **CrewAI**, **OpenClaw**, and planned future frameworks (Nemo Claw, Hermes Agent). These run on Yoshi's Proxmox cluster. The dashboard is NOT just a tracker — it's a scaffolding and refinement pipeline.

---

## WHAT WAS COMPLETED (SESSION 2 — April 12, 2026)

### Bug Fixes & API Migrations (ALL DONE)

1. **Skills API migrated to SQLite** — `/api/skills/route.js` rewritten from mock arrays to `getDb()`. Handles skills (default), tools (`?resource=tools`), and MCP servers (`?resource=mcp-servers`) all via SQLite.

2. **Tasks API migrated to SQLite** — `/api/tasks/route.js` rewritten. Full CRUD with agent_name JOIN, auto `completed_at` on status change to done/rejected.

3. **Decisions API migrated to SQLite** — `/api/decisions/route.js` rewritten. Supports `?action=approve` and `?action=reject` query params on PUT with resolver tracking.

4. **Content API migrated to SQLite** — `/api/content/route.js` rewritten. Full CRUD with feedback fields (vote, tags, comment). Supports `preview_text` alias for backward compat.

5. **Tools API response format fixed** — `/api/tools/route.js` GET now returns bare array instead of `{ tools: [...] }` wrapper (matches what skills page expects).

6. **MCP Servers API response format fixed** — `/api/mcp-servers/route.js` GET now returns bare array instead of `{ servers: [...] }`.

7. **Agents API filtering enhanced** — `GET /api/agents` now supports `?framework=` param and cross-field matching (department↔section, harness↔framework).

8. **Pipeline delete button fixed** — Added `group` class to kanban card parent div so `group-hover:opacity-100` works for the delete button.

9. **Dashboard Details button wired up** — Added `detailsDecision` state + modal to show decision details with approve/reject actions. Fixed `handleDecision` to send proper JSON body.

### Priority 1: Agent Scaffold Form Redesign (DONE)

Completely rewrote `app/agents/page.js` with:

**New scaffold form (12 fields with helper text):**
- Name (required), Role, Department (C-Suite select, required), Goal (textarea)
- Vibe (text + preset archetype buttons), System Prompt (large textarea, 8 rows)
- Framework (select — CrewAI, OpenClaw, Claude Code, LangChain, AutoGen, OpenAI Assistants, Nemo Claw, Hermes Agent, Custom)
- Assigned Tools (checkbox multi-select from /api/tools)
- Assigned Skills (checkbox multi-select from /api/skills)
- Memory (toggle button), Agent Type (Worker/Manager radio), Stage (Ideate/Build/Test/Deploy/Observe)

**Fleet view updated:**
- Groups agents by department (CEO → CHRO) with department icons and colors
- Cards show: name, role, goal preview, framework badge, stage badge, manager indicator
- Filters: Department dropdown (replaces Section), Framework dropdown (replaces Harness)
- Search works across name, role, and goal

**Detail view updated:**
- Header shows all new metadata (department, framework, stage, type)
- Settings tab shows/edits all new fields
- Export .md button + Copy .md button in header

### Priority 2: Skills/Tools Page Redesign (DONE)

Rewrote `app/skills/page.js` with two-column layout:
- **Left column:** Skills list with search, add/edit/delete, SKILL.md export (download + clipboard copy)
- **Right column:** Tools list with search, add/edit/delete
- **Bottom section:** MCP Servers grid with start/stop controls
- All modals have helper text on form fields
- Color-coded add buttons (orange for skills, blue for tools, purple for MCP)

### Priority 3: .md Export (DONE)

**Agent .md export:**
- Download as `agent-name-agent.md` file
- Copy to clipboard button
- Format: Identity section, Goal, Vibe, System Prompt, Tools, Skills, Config

**Skill .md export:**
- Download as `skill-name-SKILL.md` file
- Copy to clipboard button
- Format: YAML frontmatter (name, description) + markdown body (Process Steps, Guidelines, Trigger Keywords)

### Touch/Tablet UI Optimization (DONE)

Added to `globals.css`:
- `@media (pointer: coarse)` rules: 44px+ touch targets, 16px input fonts (no zoom), larger buttons, always-visible hover actions, wider scrollbar
- Pi tablet landscape (1024px + coarse): 2-column grids, larger cards, modal max-width adjustments
- Pi tablet portrait (640px + coarse): single-column stacking
- Kiosk fullscreen mode: hidden scrollbar, hidden cursor

### Raspberry Pi Deployment (DONE)

Created `deploy-pi.sh` script that:
1. Installs Node.js 20 (if needed)
2. Copies app files and builds Next.js production bundle
3. Creates systemd service (`agent-os.service`) — auto-start on boot, auto-restart on failure
4. Sets up Chromium kiosk mode — fullscreen, no UI chrome, touch events enabled, auto-launch on desktop login
5. Creates manual `~/start-kiosk.sh` launcher
6. Supports `--kiosk-only` and `--app-only` flags

---

## FILES CHANGED THIS SESSION

| File | Change |
|------|--------|
| `app/api/skills/route.js` | **Rewritten** — mock data → SQLite, handles skills/tools/mcp-servers |
| `app/api/tasks/route.js` | **Rewritten** — mock data → SQLite with agent_name JOIN |
| `app/api/decisions/route.js` | **Rewritten** — mock data → SQLite with approve/reject actions |
| `app/api/content/route.js` | **Rewritten** — mock data → SQLite with feedback fields |
| `app/api/tools/route.js` | Fixed GET response format (bare array) |
| `app/api/mcp-servers/route.js` | Fixed GET response format (bare array) |
| `app/api/agents/route.js` | Added framework filter param, cross-field matching |
| `app/agents/page.js` | **Rewritten** — full scaffold form redesign, C-Suite departments, .md export |
| `app/skills/page.js` | **Rewritten** — two-column layout, SKILL.md export, helper text |
| `app/page.js` | Added decision details modal, fixed handleDecision JSON body |
| `app/pipeline/page.js` | Added `group` class to kanban cards for delete button visibility |
| `app/globals.css` | Added touch/tablet optimization rules + kiosk mode styles |
| `deploy-pi.sh` | **New** — Pi deployment script (systemd + Chromium kiosk) |

---

## WHAT STILL NEEDS TO BE DONE

### Remaining from original handoff (now lower priority)
1. **Settings page "Save" is a no-op** — `handleSave()` just shows success message, no API call
2. **MCP Start/Stop is UI-only** — `toggleMcpServer()` now persists status to DB but doesn't actually spawn/kill processes
3. **Content feedback votes** — PUT endpoint works but the content page may need UI wiring
4. **Dashboard pending approvals** — Uses data from /api/dashboard which aggregates from decisions table; verify it picks up new decisions

### Harness Integration (Future)
- **CrewAI connector**: Generate `agents.yaml` and `tasks.yaml` from dashboard data, push to Proxmox cluster
- **OpenClaw connector**: Similar spec export for OpenClaw running agents
- **NemoClaw / Hermes Agent**: Placeholder framework options added, need spec formats defined
- **Live agent status**: Polling or WebSocket to Proxmox for real agent status (running, idle, errored)

### Raspberry Pi Next Steps
1. **Test on actual Pi hardware** — Run `deploy-pi.sh` on the Pi
2. **Screen rotation** — May need `display_rotate=1` in `/boot/config.txt` depending on tablet orientation
3. **Auto-login** — Pi may need `raspi-config` → Boot → Desktop autologin enabled
4. **Network config** — If Pi connects to Proxmox cluster, configure endpoint URLs

---

## ARCHITECTURE NOTES

### Database
- SQLite via `sql.js` (JavaScript SQLite compiled to WASM)
- Wrapper in `lib/db.js` provides better-sqlite3-compatible API
- DB file at `data/agent-os.db` — auto-created with seed data on first run
- `_saveRawDb()` writes to disk after every mutation
- **ALL API routes now use SQLite** — no more mock data arrays

### Key patterns
- All pages are client components ('use client')
- API routes use `export const dynamic = 'force-dynamic'` to prevent caching
- Modal component: `<Modal isOpen={bool} onClose={fn} title="..." size="md|lg|xl|2xl">`
- Shared form renderer: `renderFormFields()` used by both scaffold modal and settings edit
- Department constants: `DEPARTMENTS` array in agents/page.js
- Framework constants: `FRAMEWORKS` array in agents/page.js

### Styling
- Tailwind with custom surface color scale (surface-100 through surface-950)
- Orange accent: `orange-500` (#F97316) / `orange-600`
- Font stack: Inter (body), Fira Code (mono), Space Grotesk (headings)
- Touch media queries for Pi tablet

---

## IMPORTANT: Clean DB Start

The `data/agent-os.db` file has the OLD schema. After these code changes:

**Recommended:** Delete `data/agent-os.db` and let it re-seed with new schema:
```bash
cd C:\Users\Yoshi\Documents\Claude\Projects\DevOps\agent-os
del data\agent-os.db
npm run dev
```

The migration function in `lib/db.js` will add missing columns to an existing DB, but seed agents won't have the new department/framework values. A fresh DB is cleaner.

---

## PI DEPLOYMENT QUICK START

```bash
# On the Raspberry Pi:
cd ~
git clone <your-repo-url> agent-os
cd agent-os
chmod +x deploy-pi.sh
./deploy-pi.sh

# Or if files are already on the Pi:
./deploy-pi.sh --app-only    # Just the service
./deploy-pi.sh --kiosk-only  # Just the browser kiosk
```

---

## GIT / GITHUB SETUP

```bash
cd C:\Users\Yoshi\Documents\Claude\Projects\DevOps\agent-os

# Remove old broken .git if it exists
rmdir /s /q .git

# Fresh init
git init -b main

# .gitignore
echo .next/ > .gitignore
echo node_modules/ >> .gitignore
echo data/agent-os.db >> .gitignore

# Create repo
gh repo create agent-os --private --source=. --remote=origin

# Commit and push
git add -A
git commit -m "Agent-OS v2: full scaffold redesign, SQLite migration, Pi deployment"
git push -u origin main
```
