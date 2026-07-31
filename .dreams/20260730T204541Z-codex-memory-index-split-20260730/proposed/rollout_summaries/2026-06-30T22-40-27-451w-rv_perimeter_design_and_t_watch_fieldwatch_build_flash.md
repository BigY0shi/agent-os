thread_id: 019f1ab0-e32d-71e1-b840-fe69128db0a2
updated_at: 2026-07-01T21:43:02+00:00
rollout_path: C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T15-40-34-019f1ab0-e32d-71e1-b840-fe69128db0a2.jsonl
cwd: \\?\C:\Users\Yoshi\Documents\Codex\HexMod-Hardware

# Two hardware workstreams were advanced: an RV perimeter human-detection architecture was rewritten around cheap distributed nodes first, and a T-Watch S3 Plus FieldWatch firmware scaffold was built, fixed, compiled, and flashed successfully.

Rollout context: workspace was `C:\Users\Yoshi\Documents\Codex\HexMod-Hardware`. The user first asked for a concrete multi-node RV/yard human-detection system using mostly ESP32s, existing cameras, CrowTail/I2C where useful, and inexpensive edge-AI hardware before using Raspberry Pi boards. After that, the user pivoted to a T-Watch S3 Plus firmware build/flash workflow.

## Task 1: RV perimeter human-detection system design

Outcome: success

Preference signals:

- The user said: "I don't have any ESP32 camera nodes. They are all stand alone parts, I just would prefer not to burn expensive pi's onm a simple setup like a single camera." -> future designs should treat ESP32 as control/sensor/event hardware, not camera hosts, and should prefer cheap camera paths first.
- The user said: "Yes, the inside node should go off immediately on a high confidence occurance." -> immediate alarm behavior should be the default for high-confidence events.
- The user said the far lightpole camera is the farthest and suggested Tapo there, and that the other camera node is closer. -> future planning should prefer the existing Tapo camera or other low-cost camera path for the far node before spending a Pi.
- The user said power is "Batteries and/or solar" and Wi-Fi is spotty. -> future designs should assume battery/solar and local/backup event transport, not mains or always-good Wi-Fi.
- The user said: "Yes event driven clips only" and only on sensor trip or loud impulse. -> audio/video should be event-triggered, not continuous.
- The user inventory/corrections indicated many ESP32s, Pi boards, Banana Pi M2-class boards, Luckfox boards, CrowTail proto boards, and I2C hubs are available and should be used proportionately.

Key steps:

- Read the existing RV perimeter draft and rewrote the top-level architecture so the new v0.2 plan is authoritative and the old Pi-first sketch is preserved only as appendix context.
- Added a current design decision section that explicitly uses a four-node structure: lightpole camera node, near camera/thermal node, gate/fusion node, and inside alarm hub.
- Reframed the system around ESP32-based control/fusion nodes plus camera-capable hosts only where needed.
- Established a camera-host ranking that prefers the existing Tapo camera, then Luckfox, then dedicated smart-camera modules, then Banana Pi, with Raspberry Pi last for camera-only nodes.
- Added battery/solar power assumptions, event transport lanes (Wi-Fi/MQTT plus ESP-NOW/LoRa fallback), a detection scoring model, event-driven audio policy, and immediate buzzer/matrix/TFT behavior for score 9+ events.
- Kept CrowTail/I2C as the preferred integration method for low-speed sensors like MLX90640, RTC, fuel gauge, button expander, and IMU/vibration.
- Moved the earlier Pi-centric prototype plan into a clearly labeled superseded appendix and created a v0.2 build order that starts with the inside hub and gate-fusion node before cameras.

Failures and how to do differently:

- The original draft still leaned on Pi camera hosts and a generic camera-node model; the fix was to explicitly separate control/fusion nodes from camera hosts.
- The earlier architecture implied an ESP32 camera role that the user does not actually have hardware for; future work should not assume ESP32 camera boards unless the user says they exist.
- Audio recording needed to be constrained to event-driven clips only; future designs should keep the default tight unless the user asks for continuous capture.

Reusable knowledge:

- For this project, the default node split should be: ESP32 for sensor fusion/event handling, cheap camera host for capture/inference, Pi only when CSI/storage/heavier inference is justified.
- Tapo is acceptable as the first camera path for the far lightpole node if local access is possible.
- MLX90640/CrowTail/I2C is a good fit for low-speed thermal and support sensors; MAX7219, audio, and camera buses should stay off that I2C hub.
- Immediate alarm on high-confidence events is an explicit design requirement.

References:

- [1] User wording: "I don't have any ESP32 camera nodes... prefer not to burn expensive pi's onm a simple setup like a single camera."
- [2] User wording: "Yes, the inside node should go off immediately on a high confidence occurance."
- [3] User wording: "Batteries and/or solar" and "Wi-Fi ... spotty sometimes"
- [4] Edited file: `RV-PERIMETER-HUMAN-DETECTION-SYSTEM.md` now has v0.2 architecture, build order, and an appendix of superseded v0.1 notes.
- [5] Learned rules appended in `AGENTS.md` capture: ESP32 default for RV sensor nodes, Luckfox first for risky AI cameras, and avoid spending Pi boards on simple camera nodes.

## Task 2: T-Watch S3 Plus FieldWatch firmware scaffold, build, and flash

Outcome: success

Preference signals:

- The user clarified they do not use an IDE and asked for the terminal command to build.
- The user said PlatformIO should be available and later confirmed the watch was plugged in, then asked to flash it.
- The user accepted a terminal-only workflow, so the repeatable default is PlatformIO CLI from the firmware folder, not an IDE.

Key steps:

- Created a starter PlatformIO firmware project under `firmware/t-watch-s3-plus-fieldwatch`.
- Initial build attempts exposed two real dependency issues:
  - `LilyGoLib` current `master` used newer ESP-IDF display-driver fields that did not compile against the official PlatformIO `espressif32@6.10.0` baseline.
  - Unused BLE/audio/example dependencies caused a compile failure via `ESP32 BLE Arduino`.
- Resolved the first issue by pinning `LilyGoLib` to `2eadcf7239a0e69fcfa37e6e8714eb611faa7b5c`, which is the parent commit before the display-driver compatibility change.
- Resolved the second issue by removing unused BLE/audio/example dependencies from the v0 scaffold, keeping the firmware lean.
- Rebuilt successfully; `pio run -e twatchs3` completed with `Environment twatchs3 SUCCESS` and produced `firmware.bin` and `firmware.elf`.
- When the user said the watch was plugged in, `pio device list` found the T-Watch on `COM6` with USB VID/PID `303A:1001`.
- Flashing with `pio run -e twatchs3 -t upload --upload-port COM6` succeeded, with hard reset via RTS.
- Post-flash, `COM6` still enumerated normally, confirming the device remained accessible after flashing.

Failures and how to do differently:

- The first platform choice (`pioarduino` / newer ESP32 core) exposed a Windows toolchain/path mismatch in this sandbox. The stable fix was to revert to the official PlatformIO `espressif32@6.10.0` baseline and pin the library instead.
- Long PlatformIO builds can leave `pio.exe` or monitor processes holding `.platformio` locks or the serial port. Future terminal sessions should be ready to stop stale `pio` processes before retrying.
- The short serial monitor attempt timed out and briefly held `COM6`; releasing the monitor process was necessary before re-checking the port.

Reusable knowledge:

- Build command:
  `cd C:\Users\Yoshi\Documents\Codex\HexMod-Hardware\firmware\t-watch-s3-plus-fieldwatch`
  `pio run -e twatchs3`
- Flash command used successfully:
  `pio run -e twatchs3 -t upload --upload-port COM6`
- `pio device list` is the fastest way to identify the watch port; in this run it was `COM6`.
- A minimal v0 firmware should avoid pulling in BLE/audio/example-only dependencies until they are actually needed.

References:

- [1] Final successful build output: `Environment twatchs3 SUCCESS` and `firmware.bin` under `.pio\build\twatchs3\`
- [2] Flash output: `Chip is ESP32-S3 (revision v0.2)` and `Writing ...` followed by `SUCCESS`
- [3] Device enumeration after flash: `COM6` / `USB VID:PID=303A:1001 SER=98:A3:16:F5:63:28`
- [4] Pinned dependency in `firmware/t-watch-s3-plus-fieldwatch/platformio.ini`: `https://github.com/Xinyuan-LilyGO/LilyGoLib.git#2eadcf7239a0e69fcfa37e6e8714eb611faa7b5c`
- [5] Removed unused dependencies from the PlatformIO config so the lean v0 build compiles cleanly.
