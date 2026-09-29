# Around every page

These are on every route (they are mounted once, in `src/app/layout.tsx` and `src/components/Shell.tsx`).

| Control | What it does |
|---|---|
| **Sidebar** | Every module, grouped. The current page is highlighted. |
| **Skills & workflows** (top bar) | Opens the pop-up for the module you are on: switch skills and workflows on for this module or for every module, run a workflow in place, or add a new one. It says so when a module's agent calls do not read skills yet. Skills come from Agent OS, Claude Code and SkillDB. |
| **Command palette** (top bar, Ctrl+K or Cmd+K) | Jump to any module or action by typing. |
| **Jarvis orb** (bottom right) | Its glow follows Jarvis's status. Click it to open the Jarvis chat overlay on top of the page you are on, so he can read and drive that page while you keep using it. |
| **F13** (or the key set in Jarvis settings) | Opens the Jarvis overlay from anywhere on the machine, through the global hotkey helper; an in-app keybind does the same when the page has focus. `?jarvis=1` in a URL opens it too. |
| **Runs tray** | Work that is running across modules (a brief being written, a digest being merged, a workflow): what it is, how long it has run, and STOP. |
| **The particle field** | The moving background. It pauses when the tab is hidden and holds still if your system asks for reduced motion. |

## Settings

Every module that can be configured has a gear on its page. Settings are stored in `~/.agentic-os/settings.json` and read on every request, so a change applies at once, with no rebuild and no restart. All of them are also in Jarvis > Control Room > Settings.
