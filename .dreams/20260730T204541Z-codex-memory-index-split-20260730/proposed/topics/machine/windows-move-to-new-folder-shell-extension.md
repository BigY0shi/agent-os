# Task Group: Windows 11 Explorer "Move to New Folder" shell-extension workflow

scope: Reuse for follow-up work on the user's `MoveToNewFolder` Explorer tweak/plugin, especially when the goal is one-folder multi-select behavior in Windows 11 File Explorer rather than a one-command-per-item registry verb.
applies_to: cwd=C:\Users\Yoshi\MoveToNewFolder and related Windows shell-extension workflows; reuse_rule=safe for follow-up work on this plugin family, but treat install state, signing, and live Explorer behavior as machine-specific until revalidated

## Task 1: Review the original `.inf` verb and explain why it fails for multi-select

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-dsio-win11_explorer_move_to_new_folder_extension.md (cwd=\\?\C:\Users\Yoshi, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-fe7e-78e3-bc1e-19568dfd718c.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-fe7e-78e3-bc1e-19568dfd718c, success; reviewed original `.inf` and safer command shape)
- rollout_summaries/2026-06-25T04-29-11-LF4O-movetonewfolder_explorer_plugin_native_shell_extension.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\archived_sessions\rollout-2026-06-24T21-29-11-019efd09-fec0-7562-9d56-fc4297488706.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-fec0-7562-9d56-fc4297488706, success; same `.inf` failure pattern from the earlier pivot)

### keywords

- MoveToNewFolder, .inf, HKCR, AllFilesystemObjects, shell command, %L, %1, mkdir && move, multi-select

## Task 2: Build a smooth multi-select worker and stage the Win11-native route

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-fkfV-movetonewfolder_shell_verb_win11_com_msix_build.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\archived_sessions\rollout-2026-06-24T21-29-11-019efd09-fe83-7810-a2c1-aee1ce4f7b53.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-fe83-7810-a2c1-aee1ce4f7b53, uncertain; worker scripts and native-route scaffolding written before final verification)
- rollout_summaries/2026-06-25T04-29-11-LF4O-movetonewfolder_explorer_plugin_native_shell_extension.md (cwd=\\?\C:\Users\Yoshi\AppData\Local\Temp, rollout_path=C:\Users\Yoshi\.codex\archived_sessions\rollout-2026-06-24T21-29-11-019efd09-fec0-7562-9d56-fc4297488706.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-fec0-7562-9d56-fc4297488706, partial; HKCU worker plus sparse-MSIX direction)

### keywords

- MoveToNewFolder.ps1, launch.vbs, Install.ps1, Uninstall.ps1, HKCU\\Software\\Classes, mutex, Shell.Application, SelectedItems, YoshiTweaks.MoveToNewFolder, vcvars

## Task 3: Build and verify the sparse-MSIX `IExplorerCommand` plugin, icon, and second verb

### rollout_summary_files

- rollout_summaries/2026-06-25T04-29-11-dsio-win11_explorer_move_to_new_folder_extension.md (cwd=\\?\C:\Users\Yoshi, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-11-019efd09-fe7e-78e3-bc1e-19568dfd718c.jsonl, updated_at=2026-06-25T04:29:11+00:00, thread_id=019efd09-fe7e-78e3-bc1e-19568dfd718c, partial; build-verified native plugin with icon and second verb, but install not run live)

### keywords

- IExplorerCommand, sparse MSIX, AppxManifest.xml, makeappx, signtool, gdi32.lib, DllGetClassObject, DllCanUnloadNow, MoveToNewFolder.ico, open it verb

## User preferences

- When the user asks to "review this script" and then wants it to "select however many items" and "Bonus points if it prompts me for a name too" -> optimize for a real multi-select one-folder workflow, not a one-item registry tweak. [Task 1][Task 2]
- When the user says "YEah, spoec and create everything needed" -> once the design is agreed, provide the full artifact set rather than stopping at a sketch or partial spec. [Task 2]
- When the user says "Umm, yes to both!" about a custom icon and a second "open it" verb -> include those polish features when they materially improve the workflow. [Task 3]

## Reusable knowledge

- A plain `shell\\...\\command` Explorer verb runs once per selected item, so it cannot reliably aggregate a multi-selection into one target folder without extra coordination. [Task 1][Task 2]
- For the naive INF route, `cmd.exe /c md ... 2>nul & move ...` was safer than `mkdir ... && move ...`, and `%L` was the preferred path token over `%1`. [Task 1]
- The no-admin route here was HKCU registration with a worker that dedupes concurrent verb launches via a mutex and enumerates the real Explorer selection through COM. [Task 2]
- The toolchain on this machine supported the native route: VS 2022 Community, Windows SDK `10.0.26100`, `makeappx`, and `signtool`, with the build environment surfaced through `vcvars` rather than PATH. [Task 2][Task 3]
- The sparse-MSIX / `IExplorerCommand` build succeeded after linking `gdi32.lib`, producing `external\\MoveToNewFolder.dll` and `out\\MoveToNewFolder.msix`; the custom icon and second "Move to New Folder and open it" verb were also wired in. [Task 3]

## Failures and how to do differently

- Symptom: a simple INF verb works for one file but fails as soon as multiple items are selected -> cause: Explorer invokes the command once per selected item -> fix: pivot early to a worker/COM approach when one action must aggregate the full selection. [Task 1][Task 2]
- Symptom: the command silently stops moving later items -> cause: `mkdir && move` short-circuits when the folder already exists -> fix: decouple folder creation from move and suppress the expected already-exists error. [Task 1]
- Symptom: native build fails with `LNK2019` around `__imp_GetStockObject` -> cause: missing graphics import library -> fix: link `gdi32.lib`. [Task 3]
- Symptom: the build is green but real Explorer behavior is still unknown -> cause: the MSIX was not actually installed/clicked through Explorer in-session -> fix: do not claim end-to-end success until `Install.ps1` is run and the verb is tested live. [Task 3]
