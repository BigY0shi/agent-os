# Skill & pipeline specification

Pipelines compose **skills** (from the `skills` inventory) into ordered or DAG-shaped workflows, aligned with skill-orchestration ideas (e.g. [ynulihao/AgentSkillOS](https://github.com/ynulihao/AgentSkillOS)).

## Pipeline document (`definition_json`)

Top-level shape:

```json
{
  "version": 1,
  "name": "string",
  "nodes": [
    {
      "id": "step1",
      "skillId": 12,
      "skillName": "optional-cache",
      "inputs": { "topic": "{{run.input.topic}}" },
      "notes": "optional"
    }
  ],
  "edges": [
    { "from": "step1", "to": "step2", "port": "default" }
  ]
}
```

### v1 simplified DAG

- If `edges` is empty or omitted, **nodes execute in array order** (linear pipeline).
- If `edges` present, execution order is a topological sort; cycles are rejected by API validation.

### Node fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Stable id within pipeline |
| `skillId` | yes* | FK to `skills.id` |
| `inputs` | no | JSON map passed to harness (opaque to DB) |
| `notes` | no | Human/agent notes |

\* `skillName` may be used only for documentation; resolution uses `skillId`.

## Skill metadata extensions (recommended)

Store in `skills` table columns where possible:

- `tags` (JSON array string)
- `io_schema` (JSON: input/output JSON-schema snippets)
- `required_tools` (JSON array of tool ids/names)

## Runs

`pipeline_runs` captures:

- `status`: `queued` | `running` | `succeeded` | `failed` | `cancelled`
- `input_json` / `output_json` (opaque execution payload)
- `started_at` / `finished_at`

## API

- `GET/POST /api/pipelines`
- `GET/PUT/DELETE /api/pipelines/:id`
- `GET/POST /api/pipelines/:id/runs`
