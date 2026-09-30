# Open Design

Route: `/opendesign` · UI: `src/components/OpenDesignView.tsx`, `src/components/OpenDesignSettings.tsx` · Backend: `src/app/api/opendesign/` (`status`, `control`, `projects`, `preview/[...path]`)

A wrapper around Open Design, a separate open-source design tool that runs on your machine and generates prototypes, dashboards, decks, images and motion graphics from a sentence. This page starts and stops it, embeds its studio, and lists the designs it has made. The design work itself happens inside Open Design, using whichever agent you pick in its own settings.

## Tabs and controls

The header shows a status pill: "checking...", "running · <host:port>" or "offline". The rest of the page depends on that state.

### Header (always)

| Control | What it does |
|---|---|
| **Configure** (gear) | Opens "Open Design settings": **Web UI URL** (the studio to embed), **Daemon URL** (used for the health check), **Launch command**, **Stop command** (optional), **Working directory** (where the commands run). Saved to the `opendesign` section of `~/.agentic-os/settings.json`. |

### When offline

| Control | What it does |
|---|---|
| **Start Open Design** | Runs your **Launch command** through the OS shell (cmd.exe on Windows), in the working directory, with a 2-minute limit. Reads "starting the container..." while it runs. Without a launch command, it shows an error telling you to add one in the gear. Output or errors appear in a red box. |
| **Re-check** | Runs the health check now. |
| Feature tiles | Prototypes, Dashboards, Decks, Images, HyperFrames, 150 design systems. Descriptive only, not clickable. |

### When running

| Control | What it does |
|---|---|
| **Studio** / **Workspace** | Tabs. Workspace shows a count of projects. |
| Reload icon | On Studio only. Reloads the embedded studio. |
| **Pop out** | Opens the Web UI URL in a new window. |
| **Stop** | Runs your **Stop command**. If none is set, it does nothing on the server and reports "No stop command configured." The page shows offline right away either way; the next health check puts it back to running if Open Design is still up. |

**Studio** embeds the Open Design web UI in an iframe. It stays loaded when you switch to Workspace, so switching tabs does not reset your session.

**Workspace** ("Your designs"):

| Control | What it does |
|---|---|
| Refresh icon | Reloads the project list. |
| Project cards | A live preview (if rendered), the kind (deck, prototype, dashboard, image, video, hyperframe) and "example" for bundled examples, and the name. Click a rendered card to open the full design in a new tab; click an unrendered one to go to the Studio. |
| Trash icon ("Delete this design") | On hover. After a confirm, asks Open Design to delete the project for good (its database row and rendered folder). |
| **Open the Studio →** | Shown when there are no designs yet. |

## How it works

- Health: the page calls `/api/opendesign/status` every 6 seconds, which probes the **Daemon URL** (default `http://127.0.0.1:7455`). Once running, it takes 4 missed checks in a row before the page flips to offline, so a slow check while Open Design is busy does not tear down the studio.
- The studio iframe loads the **Web UI URL** (default `http://127.0.0.1:7456`).
- The project list and delete are proxied through `/api/opendesign/projects` to the **Daemon URL**'s `/api/projects` (the same setting the health check uses), because the daemon sends no CORS headers.
- Rendered designs are read from `~/open-design/.od/projects/<id>/index.html` and served through `/api/opendesign/preview/<id>`.
- If no launch or stop command is set, the server falls back to `~/open-design/od-host-start.sh` and `od-host-stop.sh` when those exist (a macOS setup).
- Open Design must be installed separately. The page text says it runs on Node 24 with no API keys, and that its own Settings > Execution picks which CLI agent it drives.
