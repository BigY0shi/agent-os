thread_id: 019f193d-57d1-7441-a0e1-2603dd2ebe5e
updated_at: 2026-06-30T20:27:41+00:00
rollout_path: C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T08-54-45-019f193d-57d1-7441-a0e1-2603dd2ebe5e.jsonl
cwd: \\?\C:\Users\Yoshi\Documents\Codex\HexMod-Hardware

# RV security architecture was refined from a Pi-heavy concept into an ESP32-centered event/alarm system with edge-AI camera options, while preserving Pi only where Linux/video storage is actually needed.

Rollout context: The user had a broad RV perimeter / tamper / human-detection project and repeatedly steered the design toward using the parts they already own: ESP32s, CrowTail ProtoBoards, I2C hubs, Pico/Banana Pi middle tiers, Luckfox boards, Seeed smart vision modules, and CrowPanel Advance displays. The main work was updating the handoff/spec docs so future work starts from the right architecture and hardware priority order.

## Task 1: RV perimeter human detection system architecture

Outcome: partial

Preference signals:

- When the assistant proposed a Pi-heavy hub, the user corrected it with: "I wouldn't mind doign like a Banan PI-Zero or a Pico on the main hub if we need a little more oomph than an ESP-32" and later "I'd rather burn those than a bunch of pi's" -> future default should avoid assuming Pi boards are the hub or edge nodes unless Linux/video storage is specifically needed.
- When the user added hardware inventory, they explicitly listed many ESP32s, CrowPanel boards, Luckfox boards, SenseCAP Watcher, K230 board, Grove AI Camera 2 / Grove Vision AI style hardware, and CrowPanel Advance units -> future runs should treat these as first-class design candidates rather than generic examples.
- When the user said the Luckfox is "the top of my list" and they'd rather burn it than "more expensive modules like the sensecap" -> future field-risk AI POC should start with Luckfox before risking premium modules.
- When the user said they could "hook all the things to CrowTail Proto Boards, and use I2C hubs" -> future v0.1 physical integration should prefer CrowTail ProtoBoards + I2C backplane for modularity.
- When the user asked about AI human detection and whether an ESP32 could host a web server / receive clips, the user implicitly wanted a local control/event API, but then the architecture was clarified to keep AI off the ESP32 hub and use it for dashboard/control only.

Reusable knowledge:

- The RV design settled into a layered model: sensor/camera nodes feed a central event/alarm hub, not a monolithic recorder.
- ESP32 is the default for hub, alarm, and sensor nodes; Pi is reserved for actual camera capture or heavyweight storage/web UI.
- Pico/Pico Display and Banana Pi Zero/M2 Zero are useful middle-tier hub options when ESP32 is too tight but Pi 4/5 is overkill.
- CrowTail ProtoBoards and I2C hubs are the preferred first integration layer for the hub and trailer tongue node.
- Not everything should go on I2C: MAX7219 matrix, microSD, buzzer, LoRa/SPI radios, and simple GPIO sensors should stay on dedicated interfaces.
- AI human detection should run on camera-capable/Linux/AI nodes or an optional Linux recorder, not on the ESP32 alarm hub.
- Smart edge-AI perception candidates to evaluate include SenseCAP Watcher, Grove Vision AI V2-style modules, Kendryte K230 boards, Luckfox camera setups, and 5in/7in CrowPanel Advance boards.
- For risky outdoor AI proof-of-concept work, Luckfox is now the first-choice disposable target before Pi/SenseCAP/CrowPanel hardware.

Failures and how to do differently:

- The first pass over-weighted Pi-based hub/recorder designs. Future similar planning should ask early whether the user wants a low-cost sacrificial edge node versus a premium module or Linux recorder.
- The assistant initially over-generalized CrowPanel/Pi roles. Future runs should separate: edge AI perception node, hub/control UI, and recorder/storage node.
- Some module identities are still unknown. Future work should verify the exact board/module model before treating vendor marketing claims as capabilities.

Reusable knowledge:

- The hub can be ESP32-S3 / ESP32-WROOM + SD, ESP32-P4 / ESP32-S3 CrowPanel, or a Pico/Banana Pi middle tier depending on how much compute/UI is required.
- The tongue node is a good place for mmWave, PIR, thermal, and tamper sensors using a CrowTail ProtoBoard + I2C hub backplane.
- The central hub should drive MAX7219 matrices, buzzer, and silence/ack/test/arm buttons, with compact JSONL/CSV event logs.
- CrowPanel Advance boards were recorded as dual-MCU units with a swappable module on each device; exact module identity still needs checking.
- Seeed docs were checked and the Watcher page and Grove Vision AI V2 page are reachable; Watcher docs include UART output and HTTP proxy / Node-RED style integrations, and Grove Vision AI V2 is an edge AI module that reports recognized results to a host.

References:

- [1] Updated docs: `RV-PERIMETER-HUMAN-DETECTION-SYSTEM.md`, `HANDOFF.md`, `COMPONENT-INVENTORY-SEED.md`, `AGENTS.md`
- [2] Key user steering: "I wouldn't mind doign like a Banan PI-Zero or a Pico on the main hub..." and "I'd rather burn those than a bunch of pi's, or even more expensive modules like the sensecap."
- [3] Smart perception candidates recorded: SenseCAP Watcher, Grove AI Camera / Grove Vision AI V2-style module, Kendryte K230 camera board, Luckfox camera setup, 5in and 7in CrowPanel Advance.
- [4] Verified docs URLs: `https://wiki.seeedstudio.com/grove_vision_ai_v2/`, `https://wiki.seeedstudio.com/watcher/`.

## Task 2: edge-AI camera / perception node selection

Outcome: partial

Preference signals:

- The user repeatedly said Luckfox is the preferred first target for field-risk AI camera testing, because it is cheap enough to "burn" compared with Pi, SenseCAP, or CrowPanel hardware.
- The user also wanted to preserve the possibility of using SenseCAP Watcher, Grove AI Camera 2 / Grove Vision AI V2-style modules, Kendryte K230 boards, and the two CrowPanel Advance displays as AI-capable devices, but without assuming they replace the camera nodes by default.

Reusable knowledge:

- A useful edge-AI split is: camera/AI node does person detection, sends compact `human_candidate` metadata plus optional thumbnail/clip reference; ESP32 hub receives and correlates events; optional Linux recorder stores full clips.
- The docs now explicitly say to evaluate edge-AI perception modules before assigning Pi boards to AI detection.
- For CrowPanel Advance, the docs treat them as AI-capable display/controller experiments only if their SDK/examples truly support on-device inference or a camera/model path; otherwise they remain UI/controllers.

References:

- [1] `RV-PERIMETER-HUMAN-DETECTION-SYSTEM.md` phase 1B added a bench-test block for dedicated edge-AI modules, including Luckfox, SenseCAP Watcher, Grove Vision AI V2-style modules, K230, and CrowPanel Advance.
- [2] The doc now states Luckfox is the first risky outdoor AI camera proof-of-concept target if its camera/model pipeline works.
- [3] The doc also records the CrowPanel Advance as AI-capable display/controller nodes, but not as proven inference devices yet.

## Task 3: inventory capture and documentation hygiene

Outcome: success

Preference signals:

- The user gave a detailed parts list and expected those parts to be preserved as planning input, not as a finalized BOM.
- The user volunteered exact counts and board families across several categories, indicating they want future planning to leverage what they already own before suggesting new purchases.

Reusable knowledge:

- `COMPONENT-INVENTORY-SEED.md` now captures relevant hardware inventory categories: cameras/vision, sensors, vibration/IMU, displays/UI, MCU stock, radios/networking, and power/build basics.
- The inventory specifically includes SenseCAP Watcher, Grove AI Camera / Grove Vision AI style hardware, K230 board, Whisplay module, CrowPanel Advance 5in/7in, Luckfox boards, CrowTail ProtoBoards, CrowTail I2C hubs, and many ESP32 / Pico / Banana Pi / Pi boards.

Failures and how to do differently:

- Exact module identity remains unverified for several items. Future runs should keep the wording as “exact model to verify” until the board silkscreen or module docs are confirmed.
- Some web claims were only partially verified. Future work should continue to distinguish between user inventory, vendor marketing, and confirmed host interfaces.

References:

- [1] `COMPONENT-INVENTORY-SEED.md` lines added for: SenseCAP Watcher, Grove AI Camera / Grove Vision AI-style module, Kendryte K230 board, Whisplay module, Luckfox Pico, and 5in/7in CrowPanel Advance.
- [2] `AGENTS.md` learned rules were added for ESP32-first hubs, middle-tier Pico/Banana Pi hub options, edge-AI module evaluation before Pi, and Luckfox-first risky outdoor AI proof-of-concept.

## Task 4: updated project handoff / future working defaults

Outcome: success

Preference signals:

- The user wanted the handoff to reflect the practical build order and the updated hardware priorities.
- The user accepted that the docs should preserve the current active workspace and not drift back to the old Agent OS repo copies.

Reusable knowledge:

- `HANDOFF.md` now captures the active direction: ESP32 hub by default, middle-tier Pico/Banana Pi if needed, Pi only for camera capture/heavy storage, CrowTail ProtoBoards + I2C hubs for modular wiring, and Luckfox first for risky outdoor AI camera POCs.
- The next best work is now framed as bench-testing the Luckfox camera setup first, then comparing SenseCAP Watcher, Grove AI Camera, K230, and CrowPanel Advance only if the Luckfox path is weak or blocked.

References:

- [1] `HANDOFF.md` updated sections: project 4 (RV perimeter detection), project 5 (RV vibration/tamper sensor), and source discipline / next best work.
- [2] Learned rule additions in `AGENTS.md` are the durable defaults for future RV security work.

