# Audit Console

Route: `/audit` · UI: `src/components/AuditConsole.tsx`, `src/components/AuditBrief.tsx` · Backend: `src/lib/auditEngine.ts`, `src/app/api/audit/` (`route.ts`, `run`, `intake`, `warroom`)

A control panel for the Business Audit Engine, a separate project that runs multi-agent business audits. From here you add clients, fill in their brief, start audit runs and watch progress. The engine owns all audit data. This page only starts its commands and reads the results back.

## Tabs and controls

### Main view

| Control | What it does |
|---|---|
| **Refresh** | Re-reads the client list from the engine. |
| **New client** | Opens a **Business name** field. **Create** adds the client in the engine and opens its brief. **Cancel** closes the field. |
| **Ensemble passes** | How many full passes an **Audit** runs, 1 to 6, default 3. Agreement between passes is the confidence signal. |
| Client table | One row per client: name and slug, **State**, **Stage**, and **Brief** status (`ready`, `lean` or `blocked`). |
| **Audit** | Starts a run (Machine 1) with the chosen number of passes. Disabled when the brief is blocked. For a `lean` brief it runs outside-in on public evidence. |
| **Distill** | Starts Machine 2, which merges the passes into a judged 9-file packet. |
| **War Room** | Generates the client readout from the packet. |
| **View** | Opens the generated readout (`war-room.html`) in a new tab. |
| **Brief** | Opens the brief editor for that client. |

Only one job can run at a time. While it runs, all Audit, Distill and War Room buttons are disabled.

### Live job panel

Shown when a job has run or is running. It lists the action, client, passes, elapsed time and stage, any error, a chip per engine agent with its status (hover for validation and warning count), a chip per pass with its state, and the last lines of engine output. It polls every 5 seconds while the job runs.

### Brief editor

| Control | What it does |
|---|---|
| **Back** / **Done** | Returns to the client table. |
| **Save brief** | Sends the brief to the engine and shows the result of its check. Saving is never blocked, even when fields are missing. |
| Check banner | "Brief is complete. Ready to run.", or which fields are missing or still hold placeholder text. Flagged fields get a yellow border. |
| One text box per brief field | The fields come from the engine. List fields take one item per line. Structured fields (funnel metrics, channel history) take JSON; invalid JSON is saved as text and flagged. |
| **Ensemble passes** (Run defaults) | The client's default pass count. |
| **1A** / **3A** / **3B** | Optional modules: 1A lead harvest, 3A deployment, 3B creative. |

## How it works

- Every action runs `node cli.mjs <command>` inside the engine folder: `list`, `new`, `intake`, `status`, and the long jobs `run`, `distill` and `warroom`. The engine folder is `AUDIT_ENGINE_DIR`, or `C:\Users\Yoshi\Documents\BusinessAuditEngine` when that is not set. If `cli.mjs` is not there, the page shows an error.
- Long jobs run in the background. The start request returns at once and the page polls `/api/audit/run`. Job progress is held in server memory, so reloading the page picks the job back up, but restarting Agent OS loses the job view (the engine's own files are unaffected).
- Brief edits are passed to `cli.mjs intake <slug> --set` on stdin. Agent OS never writes engine files itself.
- **View** serves `clients/<slug>/war-room.html` from the engine folder. It only works after **War Room** has produced that file.
- Which models the engine uses, and what they cost, is decided by the engine, not by this page.
