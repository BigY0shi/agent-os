# Task Group: Codex local skill creation, validation, and transfer packaging

scope: Reuse for local skill-authoring work when the user wants a Codex skill built from an existing plugin/index pattern, validated quickly, and handed off as an installable folder or zip instead of loose notes.
applies_to: cwd=C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os and local skill work under C:\Users\Yoshi\.codex\skills; reuse_rule=safe for future local Codex skill creation and packaging on this machine, but revalidate exact helper script paths and any destination/archive path before reuse

## Task 1: Create a `robust-product-design` local skill from the `product-design:index` pattern, success

### rollout_summary_files

- rollout_summaries/2026-06-30T13-24-13-VQ2G-robust_product_design_skill_created_and_zipped.md (cwd=\\?\C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T06-24-20-019f18b3-a39c-7ee1-b020-a8449a11f18e.jsonl, updated_at=2026-07-03T09:18:14+00:00, thread_id=019f18b3-a39c-7ee1-b020-a8449a11f18e, success; local skill created, rewritten into a grounded router, and validated)

### keywords

- robust-product-design, product-design:index, skill-creator, SKILL.md, agents/openai.yaml, quick_validate.py, init_skill.py, local-skills, product-design

## Task 2: Zip the local skill for transfer, success

### rollout_summary_files

- rollout_summaries/2026-06-30T13-24-13-VQ2G-robust_product_design_skill_created_and_zipped.md (cwd=\\?\C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T06-24-20-019f18b3-a39c-7ee1-b020-a8449a11f18e.jsonl, updated_at=2026-07-03T09:18:14+00:00, thread_id=019f18b3-a39c-7ee1-b020-a8449a11f18e, success; skill folder bundled and archive contents verified)

### keywords

- robust-product-design.zip, Compress-Archive, ZipFile::OpenRead, installable skill folder, transfer bundle, C:\tmp\robust-product-design.zip

## User preferences

- When the user asks for a new skill and says it should be "like `product-design:index`" -> mirror the referenced plugin/router style instead of producing a generic help doc. [Task 1]
- When the user accepts a local skill approach and later asks to zip it -> default to an installable skill folder plus transferable archive, not just a loose `SKILL.md`. [Task 1][Task 2]
- When the user asks whether both files are needed, treat that as a packaging question and bundle the whole skill folder if `agents/openai.yaml` adds useful metadata. [Task 2]

## Reusable knowledge

- `skill-creator` expects `SKILL.md` with only `name` and `description` in frontmatter; `agents/openai.yaml` is optional but useful for UI metadata and default prompt behavior. [Task 1]
- The fast validation path was `quick_validate.py`, and it passed for `C:\Users\Yoshi\.codex\skills\robust-product-design`. [Task 1]
- The installed skill path from this run was `C:\Users\Yoshi\.codex\skills\robust-product-design`, and the skill name intentionally stayed lowercase/hyphenated. [Task 1]
- The archive handoff path from this run was `C:\tmp\robust-product-design.zip`, and the verified contents were `robust-product-design/SKILL.md` plus `robust-product-design/agents/openai.yaml`. [Task 2]

## Failures and how to do differently

- Symptom: the generated default prompt loses the `$robust-product-design` token -> cause: PowerShell strips or interpolates the `$...` text during init arguments -> fix: quote or escape the prompt carefully and verify the generated file after initialization. [Task 1]
- Symptom: the first draft reads like a generic template -> cause: the generated scaffold was not yet rewritten around the referenced plugin/index pattern -> fix: tighten the skill into a lean router/workflow skill with explicit grounded-design guardrails before validating. [Task 1]
