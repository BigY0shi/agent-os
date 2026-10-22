# Automations

Route: `/automations` · UI: `src/components/v2/automations/AutomationsView.tsx`, `RuleBuilder.tsx`, `RunsDrawer.tsx` · Backend: `src/app/api/v2/automations/` (`route.ts`, `test`, `runs`), `src/lib/v2/automations/engine.ts`, `src/lib/v2/automations/types.ts`

Rules of the form "When [something happens] if [conditions] then [actions]". A rule listens for an event (for example a Gmail message received through a connected integration, a failed sync, or a new task), checks simple conditions on it, and then raises an attention item, creates a task, sends a notification, or runs an integration tool. There is no AI in this module: conditions are fixed string checks and templates are plain text substitution.

## Tabs and controls

### Rule list

| Control | What it does |
|---|---|
| **engine on** / **engine off** | Kill switch. When off, no rule fires; dry-run tests still work. |
| **New rule** | Opens the rule builder with an empty rule. |
| **Configure** (gear, tooltip "Automations Settings") | **Engine enabled** checkbox (the same kill switch) and a note on how rules are kept deterministic and how destructive tools are gated. |
| Rule sentence | Each rule reads as "When ... if ... then ...". |
| Toggle on a rule | "Active, click to pause" or "Paused, click to activate". |
| **Edit** | Opens the rule in the builder. |
| **Runs** | Opens the runs drawer for that rule. |
| Empty state | "No automation rules yet". |

### Rule builder

| Control | What it does |
|---|---|
| **Rule name** | Name of the rule. |
| **When** | Trigger picker: a known connector or system event, or **Custom event...**, which takes a slug (or "system") and an event type. |
| **If** | Condition rows of field, operator and value. Fields: `text`, `payload.*`, `account.slug`, `event`. Operators: eq, neq, contains, not_contains, starts_with, regex, gt, lt. All conditions must pass. **+ condition** adds a row; the trash icon removes one. |
| **Then** | Action rows. **+ action** adds one; the trash icon removes it. Kinds: **create_attention** (title and body templates, severity info, warn or urgent), **create_task** (title and description templates), **notify** (event type, default `automation.notify`, and message template), **run_tool** (an active integration account, a tool, and an args JSON template). Templates can use `{{text}}`, `{{payload.*}}` and `{{account.slug}}`. |
| Destructive confirm checkbox | Appears on a run_tool action whose tool is marked destructive: "confirm this rule may run the destructive tool ... unattended". Saving is refused without it. |
| **Test** section, **Test with sample payload** | Dry-runs the rule against the sample payload you type (`POST /api/v2/automations/test`). It shows "matched, would run: ..." or "conditions did not match", plus each condition's result. Nothing executes. |
| **Save rule** / **Cancel** | Saves the rule (validation errors show in the builder) or closes. |

### Runs drawer

| Control | What it does |
|---|---|
| Run list | The last 100 runs of the rule. A run is recorded whenever the trigger matches, with a result of ok, condition_miss or action_failed. |
| **detail** / **hide detail** | Expands one run's detail. |

## How it works

- Rules and runs are stored in the V2 SQLite database (`~/.agentic-os/agentos.db`, `automation_rules` and its runs table). The engine on/off switch is `automations.enabled` in the runtime settings store.
- The engine listens to every event on the V2 event bus. For integration activity the trigger key is the activity's event type (for example `GMAIL_MESSAGE_RECEIVED`); for other events it is the event type itself (`sync.failed`, `task.created`, any string). A rule's slug limits it to one connector; blank, `*` or `system` match anything.
- Regex conditions are checked at save time for length and nested quantifiers, so a bad pattern is refused rather than hanging the engine.
- Events emitted by the notify action are marked as coming from automations and never trigger rules, so rules cannot loop.
- Triggers from integrations only arrive when the account is connected and syncing in the Integrations module; run_tool uses those accounts' tools.
