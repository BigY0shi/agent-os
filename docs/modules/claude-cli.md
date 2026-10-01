# Claude

Route: `/claude` · UI: `src/app/claude/page.tsx`, `src/components/UnifiedChat.tsx`, `src/components/ClaudeWorkspace.tsx`, `src/components/ClaudeArtifacts.tsx`, `src/components/UltracodeView.tsx`, `src/components/ClaudeAnt.tsx`, `src/components/AntAgents.tsx` · Backend: `src/app/api/claude/` (`chat`, `workspace`, `preview`, `artifacts`, `ultracode`, `ant`), `src/lib/claudeWorkspace.ts`, `src/lib/claudeArtifacts.ts`, `src/lib/ultracodeRuns.ts`, `src/lib/antAgents.ts`

The Claude module drives your local `claude` CLI (Claude Code) from the dashboard. You can chat with it, browse the files it writes, publish HTML it built to a public link, run large "Ultracode" jobs and watch the subagents, and use the separate Claude Platform CLI (`ant`) for Managed Agents.

## Tabs and controls

The row of pill buttons at the top switches between six tabs: **Chat**, **Workspace**, **Artifacts**, **Ultracode**, **Ant CLI**, **Agents**.

### Chat

| Control | What it does |
|---|---|
| **Ultracode** | Toggle. When on, the next message runs the CLI with the Ultracode model and effort from `settings.ultracode` (default Opus 5.5 at xhigh, set on the Ultracode tab), and the run is captured so it shows up in the Ultracode tab. An orange warning box explains the extra token use while it is on. |
| **Logged · <time>** | Appears after a reply is saved to your Obsidian vault. Links to `/memory`. |
| **Clear** | Asks for confirmation, then empties this chat thread. |
| Mic button | Voice input (`VoiceButton`). Interim speech shows in the box with a `[voice]` marker, the final transcript replaces it. |
| Message box | Type a message. Ctrl/Cmd+Enter sends, Esc stops a running reply. |
| **Send** / **Stop** | Sends the message, or aborts the stream while Claude is replying. |

### Workspace

| Control | What it does |
|---|---|
| **Projects** list | One entry per folder in `~/.agentic-os/claude-projects/`, with file count and age. Polls every 8 seconds while the page is visible. |
| Refresh icon | Reloads the project list. |
| **Files** list | Files in the selected project. Click one to open it. |
| **preview** / **source** | Shown for `.html` files: render the page in a sandboxed iframe, or show its source. |
| Open-in-new-tab icon | Opens the file through `/api/claude/preview/<project>/<path>`. |
| **download** | Shown for binary files that cannot be previewed. |

Images, video and audio play inline. Other text files show as source.

### Artifacts

| Control | What it does |
|---|---|
| **Gallery** | Opens the base URL of your artifacts site (only shown when a site is configured). |
| **Configure** (gear) | The Netlify site every Publish deploys to: **Netlify site ID**, **Site name**, **Base URL**. Saved to `settings.artifacts` and read per publish, so a change needs no restart. The header says which site is set, or that none is and that this gear is where to set it. The old `~/.agentic-os/artifacts-site.json` is read only while the site ID here is blank, and the header says so when that is the case. |
| **Built by your agents** | Every `.html` file in `~/.agentic-os/loop-builds/` and under `~/.agentic-os/claude-projects/` (up to 4 folders deep). Refresh icon reloads it. |
| **Publish** / **Update** | Copies the HTML into `~/.agentic-os/published/<slug>/index.html`, rebuilds the gallery page and runs `netlify deploy --prod`. The label reads **Update** when that source is already live. If the deploy fails, nothing is listed as published: the gallery and manifest are put back, and the new copy is moved out of the published folder (or the slug's previous page restored). Unpublish moves the page to `~/.agentic-os/.exile/<timestamp>/published/<slug>` (outside the deployed folder) and, if its deploy fails, puts it back and keeps it listed, since it is still live. |
| **Live links** | Everything in `~/.agentic-os/published/manifest.json`. |
| **Copy** / **Open** | Copies the public URL, or opens it. |
| Trash icon ("Take offline") | Asks for confirmation, removes the slug folder and manifest entry, then redeploys. |

### Ultracode

| Control | What it does |
|---|---|
| **Folder or repo** field | What a mission works on: an absolute local folder (read where it is) or an `https://` git repo URL (shallow-cloned into `~/.agentic-os/ultracode-repos/<host>-<path>-<hash>`, outside the folders the Workspace serves; a later run checks the clone's origin and moves it to the remote's current tip; git never prompts for credentials, so public repos only). It is passed to Claude with `--add-dir` and is read-only for the run: `--permission-mode acceptEdits` with Edit/Write/NotebookEdit denied under the target and the shell (Bash) turned off, while the run's own project folder stays writable for the report. A missing folder, a file or a non-https URL stops the launch with the reason. |
| Model + effort pickers | The Claude model (Opus 5.5, Sonnet 5.5, Fable 5.1, Opus 5) and the `--effort` level (low, medium, high, xhigh, max) for Ultracode runs. Saved to `settings.ultracode` on change (default Opus 5.5 at xhigh); the Chat tab's Ultracode toggle uses the same setting, and a resumed run keeps the model, effort and target it started with. |
| **Security audit**, **Find dead code**, **Build a showcase page**, **Stress-test a plan** | Preset missions. **Security audit** and **Find dead code** read code, so they stay disabled until the Folder or repo field is filled. Each posts a fixed prompt to `/api/claude/chat` with Ultracode on, in its own project folder (`ultracode-security`, `ultracode-deadcode`, `ultracode-showcase`, `ultracode-plan`). Hover shows the full prompt. |
| Custom mission box + **Launch** | Runs your own prompt the same way, in `ultracode-custom`. Enter also launches. |
| **Runs** list | Saved runs, newest first, with subagent count, cost, duration and age. Click to open. Refresh icon reloads, trash icon removes a run after confirmation (its replay moves to the runs folder's `.exile/<timestamp>/`, recoverable). |
| **Stop** | Shown on a running run. Kills the CLI process and marks the run stopped. |
| Swarm map | One node per subagent the run spawned, coloured by status (running, done, failed). While Claude is still planning with no subagents yet, a live text panel with an elapsed timer shows instead. |
| **Verdict trail**, **Your replies**, **Final answer** | The run's captured verdicts, your follow-up turns, and the result text (or streaming text while running). |
| Reply box + **Reply** | Continues the same Claude session with `--resume` and appends the turn to the same run. Disabled while a turn is running. Ctrl/Cmd+Enter sends. |

### Ant CLI

| Control | What it does |
|---|---|
| Status pill | **connected** (with version), **wrong 'ant' found** (Apache Ant is on the PATH instead), or **not connected**. |
| `ant` command box + **Run** | Runs an `ant` subcommand on the server and shows the output (pretty JSON when it parses). `--format json` is added unless you set a format. `auth login` and anything containing `delete`, `destroy` or `rm` is refused. |
| **Quick**: **Auth status**, **Models**, **Managed Agents**, **Sessions**, **Files** | Run `auth status`, `models list`, `beta:agents list`, `beta:sessions list`, `beta:files list`. |
| **What this unlocks** | Static description cards. Not controls. |

When not connected, the tab shows the install and `ant auth login` steps instead of the console.

### Agents

| Control | What it does |
|---|---|
| **Managed Agents** list | Agents from `ant beta:agents list`. Click one to select it. |
| **system** | Expands the selected agent's system prompt. |
| Task box + **Run** | Creates a session in a cloud environment named "Agent OS Cockpit" (created on first use), sends your prompt, then polls the trace every 2.5 seconds. |
| **Live trace** | Your message, thinking, tool calls, agent replies and the end state. |

If `ant` is not installed, this tab only shows a note pointing to the Ant CLI tab.

## How it works

- **Chat** posts to `/api/claude/chat`, which spawns `claude -p --model <model> --output-format=stream-json --include-partial-messages --verbose` and streams the NDJSON back. The model is `claude-opus-4-8` unless `AGENTIC_OS_CLAUDE_MODEL` or `claudeModel` in `~/.agentic-os/config.json` says otherwise. The CLI is found via `AGENTIC_OS_CLAUDE_BIN`, the config file, or `claude` on the PATH, and uses your own Claude login.
- `claude -p` has no memory between calls, so the route packs the last 24 turns (up to about 8,000 characters) into each prompt. Prompts over 16,000 characters are rejected.
- The chat thread lives in your browser's localStorage (key `agentic-os-chat-v2:claude`, last 50 messages). Each reply is also appended to `Agentic OS/Memories/<date>.md` in your Obsidian vault via `/api/memory/log`, when a vault is found.
- Chat runs in `~/.agentic-os/claude-projects/claude-default/` (override the root with `AGENTIC_OS_CLAUDE_SCRATCH`), which is why files Claude writes appear in Workspace.
- Ultracode runs are saved as JSON in `~/.agentic-os/ultracode-runs/` (override with `AGENTIC_OS_ULTRACODE_RUNS`). Token use and cost are also logged for the dashboard.
- Artifacts needs the `netlify` CLI on the PATH (`npm install -g netlify-cli`, then `netlify login` once in your own terminal) and a site set in the tab's Configure gear. Without a site, Publish says "Artifacts site not configured" and points at the gear; without the CLI it says "netlify CLI not found" with the install line, and nothing is listed as published. On Windows the npm-installed CLI is a `.cmd` shim, which the app resolves to `node` plus the CLI's entry itself (it never runs through a shell), the same way the SEO deploy does for `npx` and `netlify`.
- Ant CLI and Agents need Anthropic's Platform CLI `ant`, found via `AGENTIC_OS_ANT_BIN`, the config file, or the PATH, and logged in with `ant auth login` in your own terminal.
