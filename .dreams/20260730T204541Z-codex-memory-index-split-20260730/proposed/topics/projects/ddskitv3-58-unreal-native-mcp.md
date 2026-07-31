# Task Group: DDSKitV3-58 5.8 Unreal native MCP startup, reconnect, and ProtoRaid level checks

scope: Reuse for `C:\UEfiles\DDSKit-UPDATE\DDSKitV3-58\DDSKitV3-58 5.8` sessions when the user wants project instructions read first, native `unreal-mcp` only, a quick readiness check, or confirmation of the active level before collaborative editor/PCG work.
applies_to: cwd=C:\UEfiles\DDSKit-UPDATE\DDSKitV3-58\DDSKitV3-58 5.8; reuse_rule=safe for follow-up Unreal-editor sessions in this project/worktree, but revalidate live MCP availability, tool latency, and the currently loaded level each run

## Task 1: Read `AGENTS.md` and verify native Unreal MCP connectivity, success

### rollout_summary_files

- rollout_summaries/2026-07-12T01-12-46-Is7B-unreal_mcp_connection_model_questions_protoraid_level_check.md (cwd=\\?\C:\UEfiles\DDSKit-UPDATE\DDSKitV3-58\DDSKitV3-58 5.8, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\07\11\rollout-2026-07-11T18-12-46-019f53e2-4a8c-7af0-aa71-1b5087626a77.jsonl, updated_at=2026-07-12T01:31:55+00:00, thread_id=019f53e2-4a8c-7af0-aa71-1b5087626a77, success; project startup rules and native Unreal MCP path were confirmed)

### keywords

- unreal-mcp, AGENTS.md, native MCP only, no PowerShell fallback, list_toolsets, connected and ready, DDSKitV3-58 5.8, SceneTools

## Task 2: Answer `/model` naming questions for the 5.6 family, success

### rollout_summary_files

- rollout_summaries/2026-07-12T01-12-46-Is7B-unreal_mcp_connection_model_questions_protoraid_level_check.md (cwd=\\?\C:\UEfiles\DDSKit-UPDATE\DDSKitV3-58\DDSKitV3-58 5.8, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\07\11\rollout-2026-07-11T18-12-46-019f53e2-4a8c-7af0-aa71-1b5087626a77.jsonl, updated_at=2026-07-12T01:31:55+00:00, thread_id=019f53e2-4a8c-7af0-aa71-1b5087626a77, success; concise model-ID mapping answered an interactive command test)

### keywords

- /model, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, exact model IDs, Terra, Unreal 5.8, PCG

## Task 3: Rerun the Unreal hook and confirm native connection, success

### rollout_summary_files

- rollout_summaries/2026-07-12T01-12-46-Is7B-unreal_mcp_connection_model_questions_protoraid_level_check.md (cwd=\\?\C:\UEfiles\DDSKit-UPDATE\DDSKitV3-58\DDSKitV3-58 5.8, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\07\11\rollout-2026-07-11T18-12-46-019f53e2-4a8c-7af0-aa71-1b5087626a77.jsonl, updated_at=2026-07-12T01:31:55+00:00, thread_id=019f53e2-4a8c-7af0-aa71-1b5087626a77, success; hook rerun was treated as a native MCP re-check)

### keywords

- rerun the hook, list_toolsets, unreal reconnect, native MCP latency, sequential MCP calls, connected and ready

## Task 4: Confirm the active level is `/Game/ProtoRaid` before collaborative build work, success

### rollout_summary_files

- rollout_summaries/2026-07-12T01-12-46-Is7B-unreal_mcp_connection_model_questions_protoraid_level_check.md (cwd=\\?\C:\UEfiles\DDSKit-UPDATE\DDSKitV3-58\DDSKitV3-58 5.8, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\07\11\rollout-2026-07-11T18-12-46-019f53e2-4a8c-7af0-aa71-1b5087626a77.jsonl, updated_at=2026-07-12T01:31:55+00:00, thread_id=019f53e2-4a8c-7af0-aa71-1b5087626a77, success; current-level query confirmed the new collaboration level)

### keywords

- ProtoRaid, /Game/ProtoRaid, get_current_level, SceneTools.get_current_level, PCG plugin, native editor tools, active level

## User preferences

- When the user says "Read `AGENTS.md` from this working directory before acting" -> treat the project instructions as mandatory startup state before using any Unreal tools. [Task 1]
- When the user says "Use native MCP only; no PowerShell/HTTP fallback. Say connected and ready, then wait." -> avoid fallback MCP plumbing, confirm readiness explicitly, and stop after the check instead of continuing unprompted. [Task 1]
- When the user asks "Is there a list of names?" and tests `/model gpt-5.6 Luna`, `/model gpt-5.5-sol`, and `/model gpt-5.6-sol` live -> keep model-name guidance concise, exact, and parseable. [Task 2]
- When the user says "Can you rerun the hook" -> interpret it as a request to re-check the native Unreal connection state, not to do unrelated setup. [Task 3]
- When the user says `I am making a new Level called "ProtoRaid" we are going to build a level together. Either with native tools or the PCG plugin` -> treat the workflow as collaborative level-building where either direct editor tools or PCG may be the right lane depending on the subtask. [Task 4]

## Reusable knowledge

- `AGENTS.md` in this project explicitly says to use native `unreal-mcp` for Unreal editor questions and not to hand-roll HTTP/PowerShell MCP calls. [Task 1]
- If `unreal-mcp` tools are unavailable in this repo, the first likely cause is the session was not opened from `C:/UEfiles/DDSKit-UPDATE/DDSKitV3-58/DDSKitV3-58 5.8/`; the recovery path is to start a new agent session from that directory. [Task 1]
- The fast path that worked for current-level checks was `editor_toolset.toolsets.scene.SceneTools.get_current_level`. [Task 1][Task 4]
- The relevant 5.6-family IDs captured in this run were `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`; `Terra` was the balanced middle model, and `gpt-5.6-sol` was the recommended fit for complex Unreal/PCG/editor work. [Task 2]
- Native Unreal MCP calls can be slow and still succeed; keep them sequential because the project instructions say not to overlap MCP calls. [Task 3][Task 4]
- At the time of this check, the active loaded level was `/Game/ProtoRaid`, confirmed through the native MCP current-level query. [Task 4]

## Failures and how to do differently

- Symptom: an Unreal helper session starts reaching for PowerShell/HTTP fallback MCP plumbing -> cause: repo-specific startup instructions were skipped -> fix: read `AGENTS.md` first and keep the workflow native `unreal-mcp` only when this project asks for it. [Task 1]
- Symptom: a native Unreal connection check looks stuck -> cause: `list_toolsets` / `get_current_level` can have noticeable editor latency -> fix: wait for the in-flight MCP call and avoid overlapping requests. [Task 3][Task 4]
- Symptom: `/model` advice causes more trial and error than needed -> cause: model IDs were explained loosely instead of as exact strings -> fix: answer with the exact lowercase hyphenated ID the user can paste directly. [Task 2]
