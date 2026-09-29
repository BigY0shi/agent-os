# WebMCP

Route: `/webmcp` · UI: `src/components/v2/webmcp/WebmcpView.tsx` and its panels (`PackageEditor`, `SpecForm`, `ToolDesigner`, `TestRunner`, `VersionsPanel`, `LogsPanel`, `SecretsPanel`, `WebmcpSettings`) · Backend: `src/lib/v2/webmcp/`, `src/app/api/v2/webmcp/`

A builder for MCP tool packages. You group tools into a package, define each tool's inputs and what it calls, test it against the draft, and publish. Published tools go on the internal hub, where Jarvis and MCP clients find them as `<slug>/<tool>`. The seeded `agentos` package holds the app's own self-tools.

The header shows the package count and how many are published ("on the hub").

## Tabs and controls

### Page header and package list

| Control | What it does |
|---|---|
| **New package** | Opens the create form. |
| **slug (kebab-case)** / **Display name** | The package's id and its name. Enter in the name field creates it. |
| **Create draft** | Creates a draft package and selects it. |
| **Package card** (left rail) | Selects the package. Shows its status, version when published, slug, tool count and last update. |
| **Name field** and **Package description** | Edit the package's name and description. Saved when the field loses focus. Agents read the description. |
| **Delete draft** (drafts) | Asks first, then exiles the whole bundle to `~/.agentic-os/.exile/webmcp/`. |
| **Archive** (published) | Asks first, then unregisters its tools from the hub. Rows are kept. An archived package is read-only and cannot be published again. |

### Spec

| Control | What it does |
|---|---|
| **Auth kind** | None, API key, OAuth2 or Remote MCP. |
| **MCP type** | `stdio (CLI export)` or `http`. |
| **Schedule (cron frequency, optional)** | A cron string such as `*/15 * * * *`. |
| **Add field** (config manifest) | Adds a config field (NAME, Description, required). Each becomes a `${config:NAME}` placeholder in client-mode exports. |
| **Remove field** (trash icon) | Removes that row. |
| **Save spec** | Saves the spec. It is frozen into the next published version. |

### Tools

| Control | What it does |
|---|---|
| **Tool in the list** | Opens it for editing. A shield icon marks tools that need approval. |
| **New tool** | Starts a blank tool. |
| **Tool name (exact advertised name)** | The name agents call. |
| **Handler kind**: **internal** / **http** / **js** | What the tool runs. `js` is greyed out when **Allow JS handlers** is off in the gear. |
| **Description** | What agents read to choose this tool. |
| **Params** row builder, **Add field**, **req**, **-> raw JSON** / **-> field rows** | Build the input schema field by field, or edit it as raw JSON. Nested schemas stay in raw mode. |
| **Action key** (internal) | A registry action such as `tasks_create`, `exec_command` or another `<slug>/<tool>`. |
| **Method**, **URL**, **Headers**, **Body template** (http) | The request to make. `{{args.X}}` and `{{secret:NAME}}` are filled in at call time. |
| **Async function body** (js) | Code with `args` in scope. No fetch, process or require. |
| **requires human approval (destructive/state-changing)** | Marks the tool so calls from Jarvis wait for approval. |
| **Add tool** / **Save tool** | Saves into the draft set. The published version does not change until the next publish. |
| **Remove** | Asks, then removes the tool from the draft set. |

### Test

| Control | What it does |
|---|---|
| **Tool in the list** | Picks the tool to run. |
| **Argument form** or **Args (JSON object)**, **-> raw JSON** / **-> form** | Fill in arguments from the tool's schema, or as JSON. |
| **Run (draft)** | Runs the draft version of the tool through `/api/v2/webmcp/packages/<slug>/test`. Shows ok or failed, duration, output, any error and console lines. Approval is skipped here. |

### Versions

| Control | What it does |
|---|---|
| **Publish vN** | Asks first, then freezes the draft tools and spec into version N and puts them live on the hub. |
| **client** / **internal** | Export mode. Client turns secret references into `${config:*}` placeholders. Internal keeps `{{secret:*}}` references. |
| **Export vN** | Asks first, then writes `index.mjs`, `package.json` and `README.md` to `~/.agentic-os/webmcp/exports/<slug>/`. A previous export is exiled. Needs a published version. Secret values are never written. |
| Version list | Every published version and date. The current one is marked "live on hub". |

### Logs

| Control | What it does |
|---|---|
| **Refresh** | Reloads the package. |
| **Log row** | Expands to show the stored arguments (redacted, capped at 4 KB) and any error. |
| **Older** | Loads the next 50 older rows. |

### Secrets

| Control | What it does |
|---|---|
| **SECRET_NAME** / **value** / **Set** | Stores a secret for this package. The value is write-only and never shown again. Existing names are listed as "configured". |

### Gear (Configure, titled "WebMCP Settings")

| Control | What it does |
|---|---|
| **JS sandbox timeout (ms)** + **Save** | Time limit for `js` tools, default 5000, minimum 250. |
| **Allow JS handlers** | Allows creating `js` tools. The sandbox isolates crashes and timeouts only; code runs with server privileges. |
| **LLM-filtered tool discovery** | When on, tool discovery asks the memory provider's model to pick the 1 to 3 most relevant tools. When off, it uses keyword scoring. |

## How it works

- Packages, tools, versions and call logs live in the V2 SQLite database (tables `webmcp_packages`, `webmcp_tools`, `webmcp_package_versions`, `webmcp_call_logs`, `webmcp_approvals`). Settings live in `settings.webmcp`.
- Secret values live only in `~/.agentic-os/webmcp/<slug>.secrets.json`. They are resolved on the server at call time and masked out of logs.
- Tools are edited as a draft. Only the published snapshot is visible on the hub, which is served to MCP clients by `/api/mcp` and used in-process by Jarvis.
- Calls to approval-marked tools from Jarvis create a pending approval record instead of running. Approvals are not shown on this page.
