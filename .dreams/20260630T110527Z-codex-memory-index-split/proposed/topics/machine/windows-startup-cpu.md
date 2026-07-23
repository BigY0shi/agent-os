# Task Group: Windows startup and boot CPU investigation

scope: Reuse for "what is running at startup?" and "why is CPU high right after boot?" questions on this Windows machine, especially when the user is asking about the current session rather than historical configuration alone.
applies_to: cwd=C:\Users\Yoshi\Documents\Codex and machine-level Windows context; reuse_rule=safe for this machine and similar live startup investigations, but treat measured process lists and counters as time-specific

## Task 1: Investigate what starts with Windows and reconcile it with a current high-CPU complaint

### rollout_summary_files

- rollout_summaries/2026-06-04T20-03-55-iRHp-windows_startup_and_cpu_investigation.md (cwd=\\?\C:\Users\Yoshi\Documents\Codex, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\04\rollout-2026-06-04T13-03-54-01973bc8-d5ac-7e80-96ad-d5257da2795e.jsonl, updated_at=2026-06-04T20:03:55+00:00, thread_id=01973bc8-d5ac-7e80-96ad-d5257da2795e, success; startup inventory plus live CPU reconciliation)

### keywords

- StartupApproved, Win32_StartupCommand, LastBootUpTime, Fast Startup, Task Scheduler logon trigger, live CPU, Task Manager, Processor Utility

## User preferences

- When the user says the issue is happening "right now" after turning the machine on -> capture a short live trace immediately instead of only listing configured startup items. [Task 1]
- When the user asks what was in startup while also reporting high CPU -> do a combined startup-list + CPU-context investigation by default. [Task 1]

## Reusable knowledge

- `Win32_StartupCommand`, `HKCU/HKLM ...\Run`, Startup folder entries, `StartupApproved`, and Task Scheduler logon triggers were all relevant for a complete startup sweep on this machine. [Task 1]
- `Win32_OperatingSystem.LastBootUpTime` mattered because Fast Startup / resume can make "I just turned it on" ambiguous. [Task 1]
- Task Manager-aligned CPU reasoning on this machine benefited from `\\Processor Information(_Total)\\% Processor Utility` rather than raw cumulative process CPU alone. [Task 1]

## Failures and how to do differently

- Symptom: the startup list is correct but does not explain the user's live CPU complaint -> cause: configuration inventory and live activity were conflated -> fix: pair startup enumeration with a short real-time CPU/process sample. [Task 1]
- Symptom: "just turned it on" assumptions are wrong -> cause: Fast Startup or resume preserved session state -> fix: check `LastBootUpTime` before drawing boot-timing conclusions. [Task 1]
