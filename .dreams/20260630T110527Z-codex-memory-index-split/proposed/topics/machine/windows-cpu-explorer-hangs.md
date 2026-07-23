# Task Group: Windows 11 CPU spike and Explorer folder-open hang troubleshooting

scope: Reuse for live Windows troubleshooting on this machine when Task Manager disagrees with shell counters, CPU seems abnormally high, or opening folders / Explorer hangs are part of the complaint.
applies_to: cwd=C:\Users\Yoshi\Documents\Codex and machine-level Windows context; reuse_rule=safe for similar live investigations on this machine, but treat exact hot processes and shell-extension evidence as time-specific unless rechecked

## Task 1: Reconcile high CPU readings and identify the live offender

### rollout_summary_files

- rollout_summaries/2026-06-04T01-40-57-OQX4-windows_cpu_spike_hapticservice_explorer_hangs.md (cwd=\\?\C:\Users\Yoshi\Documents\Codex, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\03\rollout-2026-06-03T18-40-56-019736d7-fd0a-7ba0-a992-f278c87fc054.jsonl, updated_at=2026-06-04T01:40:57+00:00, thread_id=019736d7-fd0a-7ba0-a992-f278c87fc054, success; utility-counter alignment and HapticService culprit)

### keywords

- Processor Utility, HapticService, svchost.exe, Task Manager mismatch, Get-Counter, live sampling

## Task 2: Investigate Explorer hangs when opening folders

### rollout_summary_files

- rollout_summaries/2026-06-04T01-40-57-OQX4-windows_cpu_spike_hapticservice_explorer_hangs.md (cwd=\\?\C:\Users\Yoshi\Documents\Codex, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\03\rollout-2026-06-03T18-40-56-019736d7-fd0a-7ba0-a992-f278c87fc054.jsonl, updated_at=2026-06-04T01:40:57+00:00, thread_id=019736d7-fd0a-7ba0-a992-f278c87fc054, success; shell-extension hypothesis supported by hang evidence)

### keywords

- explorer.exe hang, NCOverlays.dll, CoreSync_x64.dll, shell extensions, ProcDump, Adobe, Nextcloud, folder open

## User preferences

- When the user says Task Manager shows much higher CPU than the shell readout -> reconcile against the metric they are actually looking at instead of arguing from a different counter. [Task 1]
- When the symptom is "opening a folder" or Explorer locking up -> treat shell extensions and Explorer add-ins as a first-class path, not an afterthought. [Task 2]

## Reusable knowledge

- `\\Processor Information(_Total)\\% Processor Utility` matched the user's Task Manager reading better than `\\Processor(_Total)\\% Processor Time` in this environment. [Task 1]
- `HapticService` was the stable live CPU offender during the sampled investigation. [Task 1]
- The Explorer-hang evidence pointed toward shell extensions, especially Nextcloud and Adobe components (`NCOverlays.dll`, `CoreSync_x64.dll`). [Task 2]

## Failures and how to do differently

- Symptom: shell counters make CPU look lower than Task Manager -> cause: different metrics are being compared -> fix: align on `Processor Utility` first. [Task 1]
- Symptom: folder-open hangs get blamed on generic slowness -> cause: shell-extension hooks were not considered early enough -> fix: inspect Explorer add-ins and hang evidence before broad system speculation. [Task 2]
