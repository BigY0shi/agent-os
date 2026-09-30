# Skills

Route: `/skills` · UI: `src/components/v2/skills/SkillsView.tsx`, `src/components/v2/skills/SkillEditor.tsx` · Backend: `src/app/api/v2/skills/`, `src/lib/v2/skills/store.ts`

Standing policies you write once and every agent prompt follows: short markdown rules such as "never send outreach without approval". Active policies are injected, in list order, into V2 task execution and into Jarvis's context, whichever model runs them.

These are not the same as the file-based skills (`SKILL.md` folders) that the **Skills & workflows** pop-up in the top bar switches on per module. The two systems exist side by side on purpose; see Mission Control for the pop-up.

## Tabs and controls

| Control | What it does |
|---|---|
| **New skill** | Opens the editor with an empty policy. |
| **Configure** (gear, tooltip "Skills settings") | Shows a note: policy skills live in the OS database and are injected into V2 task execution and Jarvis prompts (active ones only, in list order, capped at about 8k characters), while the file-based operating skills that front the CLI-agent lanes are turned on per module (each module's **Skills & workflows** button) or in Jarvis, Control Room, **Skills & workflows**. It has no settings of its own. |
| Power button on a row | "Active, click to deactivate" or "Inactive, click to activate". Only active policies are injected. |
| **Move up** / **Move down** | Reorders the policy. Order is the injection order. |
| **Edit** | Opens the editor for that policy. |
| Empty state | "No policy skills yet" when the list is empty; an error names `/api/v2/skills` if the server cannot be reached. |

### Editor (slide-over)

| Control | What it does |
|---|---|
| **Title** | Required, for example "Outreach voice rules". |
| **Description** | One line: what this policy governs. |
| **Policy (markdown)** | The text that gets injected. |
| **Active (injected into prompts)** | Whether it is used. |
| **Create** / **Save** | Creates a new policy or saves changes. |
| **Cancel** | Closes without saving. |
| **Archive**, then **Yes, archive** / **No** | Soft-archive: the row is kept in the database but leaves the list and the prompts. Only shown for an existing policy. |

## How it works

- Policies are rows in the `v2_skills` table of the V2 SQLite database (`~/.agentic-os/agentos.db`), read and written through `/api/v2/skills` and `/api/v2/skills/<id>`. The list refreshes while the page is visible.
- `withSkills()` in `src/lib/v2/skills/store.ts` renders the active policies as one block and prepends it to task-execution prompts; Jarvis places the same block in the skills slot of his context. The block is capped at about 8,000 characters, so keep policies short and put the most important first.
- Archive is a soft delete through `DELETE /api/v2/skills/<id>`; nothing is removed from the database.
- The file-based skills live in `~/.agentic-os/skills/<name>/SKILL.md` (plus read-only sources in `~/.claude/skills` and `~/.skilldb/skills`) and are managed from the top-bar pop-up and the Jarvis Control Room, not from this page.
