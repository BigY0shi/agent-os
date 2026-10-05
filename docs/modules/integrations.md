# Integrations

Route: `/integrations` · UI: `src/components/v2/integrations/IntegrationsView.tsx` (with `ConnectDialog.tsx`, `AccountDetail.tsx`, `ToolsTab.tsx`, `RulesTab.tsx`, `IntegrationsSettings.tsx`, `toolUi/`) · Backend: `src/app/api/v2/integrations/`, `src/lib/v2/integrations/` (registry, connectors, oauth, sync, ingest, crypto, store)

Connects outside accounts to Agent OS. Connected accounts sync their activity (new emails, events, messages) into Agent OS, where it can go into Memory and fire Automations, and each account exposes tools you, Jarvis, automations and MCP callers can run. The connectors are Gmail, Google Calendar, Notion, GitHub, Slack and Buzz.

## Tabs and controls

### Connector grid

| Control | What it does |
|---|---|
| **sync on** / **sync off** | Master switch for scheduled syncs. A manual sync always runs. |
| **Configure** (gear, tooltip "Integrations Settings") | See Settings below. |
| Connector card | Name, status and one chip per connected account (with its last sync time or "no sync"). Clicking a chip opens the account. |
| **Connect** | Opens the connect dialog for that connector. |

### Connect dialog

| Control | What it does |
|---|---|
| **OAuth** / **API key** | Lane toggle, shown only for connectors that support both (Notion). |
| Redirect URI and Copy | For OAuth: the redirect URI to paste into the provider's developer console. Client id and secret fields appear if the connector has none saved yet. |
| **Authorize** | Starts OAuth (`/api/v2/integrations/oauth/start`) and sends you to the provider. You come back to `/integrations` with a success or error flag. |
| API key fields, **Connect** | Password fields defined by the connector, then connects (`/api/v2/integrations/<slug>/connect`). |
| **Connect** (local) | One-click connect for local connectors (Buzz). |

### Account detail

Six tabs: **overview**, **tools**, **activity**, **sync**, **rules**, **logs**.

| Control | What it does |
|---|---|
| overview: **Last sync**, **Sync now** | When it last synced; runs a sync now. |
| overview: **Auto activity read** | Scheduled sync and webhook processing for this account. Off means manual sync only. |
| overview: **Triggers enabled** | Lets this account's events fire automations. |
| overview: **Disconnect** | Disconnects the account; it then shows as "disconnected". |
| tools: **Filter tools...**, tool list, **input schema** | Browse the tools the connector offers and view a tool's input schema. |
| tools: **Try**, **raw JSON** / **form** | Builds arguments from the schema (or raw JSON) and runs the tool on this account. A destructive tool first shows an editable form with **Send** or **Decline** (Decline sends nothing), then the result with **Close**. Gmail's send tool gets a compose form. |
| activity | The last 50 accepted items. "Run a sync" hint when empty. |
| sync: **Sync now** | Sync run history, plus a manual sync. |
| rules: **Add rule**, **Save rule**, active checkbox | Memory rules for this account: plain-language text ("Only remember emails about invoices or contracts") with optional include and exclude regex. With no rules, everything synced is offered to Memory. |
| logs | Every tool call (from Try, automations or MCP) with ok or err and redacted arguments; click to expand. |

### Settings (Configure gear)

| Control | What it does |
|---|---|
| **OAuth callback origin** | Must exactly match the redirect URI registered with each provider (`<origin>/api/v2/integrations/oauth/callback`). |
| Sync master switch | Same as the header chip. |
| Connector picker, client id, client secret, webhook secret, **Save credentials** | Write-only credential fields per connector ("leave blank to keep"). The page only ever shows whether each one is configured. |

## How it works

- Accounts, activities, sync runs, rules and call logs are stored in the V2 SQLite database (`~/.agentic-os/agentos.db`). Account secrets and OAuth tokens are sealed with AES-256-GCM using the key file `~/.agentic-os/agentos.key`, created on first use. Decrypted values never reach logs or API responses.
- Connectors are built-in TypeScript modules (`src/lib/v2/integrations/connectors/`); nothing is downloaded and no CLI is spawned.
- Accepted activity is queued into Memory's ingestion queue (`src/lib/v2/integrations/ingest.ts`), filtered by the account's rules. Each activity is also an event on the V2 bus, which is what Automations listen to.
- OAuth needs the provider's client id and secret saved in Settings and a callback origin the provider accepts.
