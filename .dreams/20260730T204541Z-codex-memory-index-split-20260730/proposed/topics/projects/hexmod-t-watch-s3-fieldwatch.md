# Task Group: HexMod-Hardware T-Watch S3 Plus FieldWatch PlatformIO build and flash

scope: Reuse for `C:\Users\Yoshi\Documents\Codex\HexMod-Hardware\firmware\t-watch-s3-plus-fieldwatch` work when the user wants terminal-first build, dependency triage, device detection, and flashing guidance for the T-Watch S3 Plus.
applies_to: cwd=C:\Users\Yoshi\Documents\Codex\HexMod-Hardware; reuse_rule=safe for follow-up work on this exact FieldWatch PlatformIO project and closely related T-Watch S3 Plus firmware sessions, but revalidate COM port, PlatformIO platform version, and library compatibility if the project dependencies change

## Task 1: Create, compile, and flash a starter FieldWatch firmware for T-Watch S3 Plus, success

### rollout_summary_files

- rollout_summaries/2026-06-30T22-40-27-451w-rv_perimeter_design_and_t_watch_fieldwatch_build_flash.md (cwd=\\?\C:\Users\Yoshi\Documents\Codex\HexMod-Hardware, rollout_path=\\?\C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T15-40-34-019f1ab0-e32d-71e1-b840-fe69128db0a2.jsonl, updated_at=2026-07-01T21:43:02+00:00, thread_id=019f1ab0-e32d-71e1-b840-fe69128db0a2, success; the starter firmware built cleanly and flashed to COM6 after dependency pinning and PlatformIO cleanup)

### keywords

- T-Watch S3 Plus, FieldWatch, PlatformIO, pio run -e twatchs3, COM6, LilyGoLib, espressif32@6.10.0, ESP32 BLE Arduino, USB VID:PID=303A:1001, firmware.bin

## User preferences

- When the user asked for the build command and said they do not use an IDE -> default to terminal and PlatformIO CLI instructions, not IDE walkthroughs. [Task 1]
- When the user said the watch was plugged in and asked to flash it -> proceed to port detection and upload instead of stopping at compile-only instructions. [Task 1]

## Reusable knowledge

- The stable build path for this project was the official PlatformIO `espressif32@6.10.0` baseline plus `LilyGoLib` pinned to `2eadcf7239a0e69fcfa37e6e8714eb611faa7b5c`. [Task 1]
- Successful build command:
  `cd C:\Users\Yoshi\Documents\Codex\HexMod-Hardware\firmware\t-watch-s3-plus-fieldwatch`
  `pio run -e twatchs3` [Task 1]
- Successful flash command:
  `pio run -e twatchs3 -t upload --upload-port COM6` [Task 1]
- `pio device list` is the fastest way to identify the watch port; in this run the watch enumerated as `COM6` with `USB VID:PID=303A:1001`. [Task 1]
- The lean v0 scaffold compiled after removing unused BLE, audio, and example dependencies; the build artifacts were written to `.pio\build\twatchs3\firmware.bin` and `.pio\build\twatchs3\firmware.elf`. [Task 1]

## Failures and how to do differently

- Symptom: `LilyGoLib` fails against the display-driver API on the default setup -> cause: current `master` was too new for PlatformIO `espressif32@6.10.0` -> fix: pin `LilyGoLib` to `2eadcf7239a0e69fcfa37e6e8714eb611faa7b5c` for this project baseline. [Task 1]
- Symptom: a pioarduino or newer-core experiment breaks the Windows toolchain path -> cause: the alternative platform wiring was less stable in this sandbox than the official PlatformIO baseline -> fix: prefer official `espressif32@6.10.0` plus a library pin before escalating platform changes. [Task 1]
- Symptom: build or monitor retries fail because the port or `.platformio` files are still busy -> cause: stale `pio.exe` or serial monitor processes held locks -> fix: stop stale PlatformIO or monitor processes before retrying build, monitor, or upload. [Task 1]
