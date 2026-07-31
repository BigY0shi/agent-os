# Task Group: Windows Codex CLI integration and Paperclip probe diagnosis

scope: Reuse for Windows-side Codex CLI path/config questions and local app integrations like Paperclip, especially when the user wants the real installed path, `CODEX_HOME` mapping, or a direct explanation of why a hello probe times out.
applies_to: cwd=C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os and machine-level Windows Codex CLI workflows; reuse_rule=safe for similar Windows Codex/Paperclip integrations on this machine, but revalidate exact versioned WindowsApps paths and timeout timings on future runs

## Task 1: Map the real local Codex install path and `CODEX_HOME` for Paperclip, success

### rollout_summary_files

- rollout_summaries/2026-06-30T11-03-36-azp4-codex_home_and_paperclip_hello_probe_timeout.md (cwd=\\?\C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T04-03-36-019f1832-e606-7bd2-94ec-8c5017ee1afe.jsonl, updated_at=2026-06-30T13:00:45+00:00, thread_id=019f1832-e606-7bd2-94ec-8c5017ee1afe, success; install-path vs config-home mapping clarified)

### keywords

- Codex CLI, CODEX_HOME, Paperclip, codex.cmd, codex.ps1, Get-Command codex -All, WindowsApps, npm shim, install path

## Task 2: Reproduce and explain Paperclip’s slow Codex hello probe, success

### rollout_summary_files

- rollout_summaries/2026-06-30T11-03-36-azp4-codex_home_and_paperclip_hello_probe_timeout.md (cwd=\\?\C:\Users\Yoshi\Documents\JulianGolde - AgenticOS\agent-os, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T04-03-36-019f1832-e606-7bd2-94ec-8c5017ee1afe.jsonl, updated_at=2026-06-30T13:00:45+00:00, thread_id=019f1832-e606-7bd2-94ec-8c5017ee1afe, success; timeout traced to heavy config/MCP/hook startup overhead)

### keywords

- codex doctor, codex exec, Respond with hello, --ignore-user-config, timeout, MCP, hooks, Access is denied, skip-git-repo-check

## User preferences

- When the user asks for the “internal path link to where it is sinstalled,” they want the actual local executable/config path, not repo links or public docs. [Task 1]
- When the user says the current `CODEX_HOME` is erroring out, answer with the concrete env mapping they should use instead of a general explanation of Codex internals. [Task 1]
- When the user pastes probe logs, pivot quickly to reproducing the exact operational path locally instead of giving generic theory. [Task 2]

## Reusable knowledge

- On this machine, `Get-Command codex -All` resolves the local Codex CLI primarily to npm shims under `C:\Users\Yoshi\AppData\Roaming\npm\codex.ps1` and `C:\Users\Yoshi\AppData\Roaming\npm\codex.cmd`, with a versioned WindowsApps bundle path also present. [Task 1]
- `CODEX_HOME` is the Codex config/auth home, not the executable path; the working mapping here is `CODEX_HOME=C:\Users\Yoshi\.codex` and `CODEX_COMMAND=C:\Users\Yoshi\AppData\Roaming\npm\codex.cmd`. [Task 1][Task 2]
- A slow Paperclip hello probe in this setup is more likely to be Codex loading heavy config/MCP/hooks than an executable-path mistake. [Task 2]
- `codex exec "Respond with hello"` took about 67 seconds with full user config and printed many MCP/auth/connect errors before returning `hello`, while `codex exec --ignore-user-config ... "Respond with hello"` took about 15 seconds and returned `hello` cleanly. [Task 2]
- If Paperclip can pass extra Codex args, `exec --ignore-user-config --sandbox read-only --skip-git-repo-check` is the useful reduced-overhead shape preserved from this run. [Task 2]

## Failures and how to do differently

- Symptom: the answer drifts toward public links when the user asked for a local install path -> cause: install path and project URL were conflated -> fix: separate local executable/config paths from public links immediately. [Task 1]
- Symptom: a Codex hello probe looks hung even though auth is configured -> cause: user config, MCP servers, and hooks are delaying startup -> fix: reproduce with the real `CODEX_HOME`, then compare against `--ignore-user-config` before blaming the executable path. [Task 2]
- Symptom: reproducing the desktop-app timeout fails before the model runs with `Access is denied` -> cause: sandbox temp-dir policy interfered with Codex startup -> fix: separate sandbox/filesystem-policy failures from real app-behavior timing by testing outside the sandbox or in the real app context. [Task 2]
- Symptom: `codex exec` rejects a flag like `unexpected argument '--ask-for-approval' found` -> cause: flags were placed using top-level CLI assumptions instead of `exec`-specific syntax -> fix: check `codex exec --help` before composing the probe command. [Task 2]
