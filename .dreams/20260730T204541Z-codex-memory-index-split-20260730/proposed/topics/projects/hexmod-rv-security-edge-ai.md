# Task Group: HexMod-Hardware RV security, edge-AI node planning, and inventory-first hardware defaults

scope: Reuse for RV perimeter / tamper / human-detection planning in `C:\Users\Yoshi\Documents\Codex\HexMod-Hardware`, especially when the user wants an ESP32-centered alarm/event hub, cheap sacrificial AI camera nodes, and planning grounded in boards already on hand.
applies_to: cwd=C:\Users\Yoshi\Documents\Codex\HexMod-Hardware; reuse_rule=safe for follow-up RV security and edge-AI planning in this workspace, but revalidate exact module identities, live vendor capabilities, and any Linux/video-storage assumptions before treating candidate boards as interchangeable

## Task 1: Redesign the RV perimeter human-detection system around cheap distributed nodes first, success

### rollout_summary_files

- rollout_summaries/2026-06-30T22-40-27-451w-rv_perimeter_design_and_t_watch_fieldwatch_build_flash.md (cwd=\\?\C:\Users\Yoshi\Documents\Codex\HexMod-Hardware, rollout_path=\\?\C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T15-40-34-019f1ab0-e32d-71e1-b840-fe69128db0a2.jsonl, updated_at=2026-07-01T21:43:02+00:00, thread_id=019f1ab0-e32d-71e1-b840-fe69128db0a2, success; the v0.2 architecture made cheap camera hosts, immediate inside alarms, and event-driven clips explicit)

### keywords

- RV perimeter, Tapo, MLX90640, batteries and/or solar, Wi-Fi spotty, event driven clips only, inside node, high confidence occurance, ESP-NOW, LoRa fallback

## Task 2: Refine the RV perimeter human-detection architecture around an ESP32 event hub, partial

### rollout_summary_files

- rollout_summaries/2026-06-30T15-54-38-8fUy-rv_security_edge_ai_esp32_hub_luckfox_first.md (cwd=\\?\C:\Users\Yoshi\Documents\Codex\HexMod-Hardware, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T08-54-45-019f193d-57d1-7441-a0e1-2603dd2ebe5e.jsonl, updated_at=2026-06-30T20:27:41+00:00, thread_id=019f193d-57d1-7441-a0e1-2603dd2ebe5e, partial; Pi-heavy assumptions were replaced with an ESP32-centered layered architecture)

### keywords

- RV perimeter, ESP32, event hub, alarm hub, Banana Pi M2 Zero, Pico Display, CrowTail ProtoBoard, I2C hub, MAX7219, human_candidate, Linux recorder

## Task 3: Choose edge-AI camera / perception node candidates with Luckfox first, partial

### rollout_summary_files

- rollout_summaries/2026-06-30T15-54-38-8fUy-rv_security_edge_ai_esp32_hub_luckfox_first.md (cwd=\\?\C:\Users\Yoshi\Documents\Codex\HexMod-Hardware, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T08-54-45-019f193d-57d1-7441-a0e1-2603dd2ebe5e.jsonl, updated_at=2026-06-30T20:27:41+00:00, thread_id=019f193d-57d1-7441-a0e1-2603dd2ebe5e, partial; candidate pool expanded while keeping exact capability verification open)

### keywords

- Luckfox, SenseCAP Watcher, Grove Vision AI V2, Grove AI Camera 2, K230, CrowPanel Advance, on-device inference, AI camera node, edge AI, person detection

## Task 4: Preserve the user inventory as planning input for future hardware decisions, success

### rollout_summary_files

- rollout_summaries/2026-06-30T15-54-38-8fUy-rv_security_edge_ai_esp32_hub_luckfox_first.md (cwd=\\?\C:\Users\Yoshi\Documents\Codex\HexMod-Hardware, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T08-54-45-019f193d-57d1-7441-a0e1-2603dd2ebe5e.jsonl, updated_at=2026-06-30T20:27:41+00:00, thread_id=019f193d-57d1-7441-a0e1-2603dd2ebe5e, success; inventory categories and notable boards were captured for reuse)

### keywords

- COMPONENT-INVENTORY-SEED.md, inventory capture, SenseCAP Watcher, Whisplay, Luckfox Pico, CrowTail ProtoBoards, ESP32 stock, Banana Pi, Grove AI Camera

## Task 5: Update the project handoff to preserve the new RV security build order and defaults, success

### rollout_summary_files

- rollout_summaries/2026-06-30T15-54-38-8fUy-rv_security_edge_ai_esp32_hub_luckfox_first.md (cwd=\\?\C:\Users\Yoshi\Documents\Codex\HexMod-Hardware, rollout_path=C:\Users\Yoshi\.codex\sessions\2026\06\30\rollout-2026-06-30T08-54-45-019f193d-57d1-7441-a0e1-2603dd2ebe5e.jsonl, updated_at=2026-06-30T20:27:41+00:00, thread_id=019f193d-57d1-7441-a0e1-2603dd2ebe5e, success; `HANDOFF.md` and `AGENTS.md` were aligned with the new architecture)

### keywords

- HANDOFF.md, AGENTS.md, next best work, Luckfox first, ESP32 hub default, source discipline, RV vibration, bench-test block

## User preferences

- When the user said "I don't have any ESP32 camera nodes. They are all stand alone parts, I just would prefer not to burn expensive pi's onm a simple setup like a single camera." -> treat ESP32 as control/sensor/event hardware, not camera hosts, and prefer cheap camera paths before spending a Pi. [Task 1][Task 2]
- When the assistant proposed a Pi-heavy hub, the user corrected it: "I wouldn't mind doign like a Banan PI-Zero or a Pico on the main hub if we need a little more oomph than an ESP-32" -> for RV/security planning, do not default to Pi boards as the hub or edge nodes unless Linux/video storage is specifically needed. [Task 1][Task 2]
- When the user said "I'd rather burn those than a bunch of pi's, or even more expensive modules like the sensecap" -> treat cheap sacrificial hardware as the default for risky outdoor AI proof-of-concept work, with Luckfox ahead of Pi or premium modules. [Task 2][Task 3]
- When the user said the far lightpole camera could be Tapo and the closer node is only about 10-20 ft away -> prefer the existing Tapo or another low-cost camera path for the far node before spending a Pi. [Task 1]
- When the user said "Yes, the inside node should go off immediately on a high confidence occurance." -> immediate inside alarm behavior should be the default for high-confidence events. [Task 1]
- When the user said power is "Batteries and/or solar" and Wi-Fi is spotty -> assume battery/solar plus local or fallback event transport instead of mains and always-good Wi-Fi. [Task 1]
- When the user said "Yes event driven clips only" -> default to event-triggered clips, not continuous audio/video capture. [Task 1]
- When the user listed ESP32s, Luckfox boards, SenseCAP Watcher, Grove AI Camera / Grove Vision AI hardware, K230, CrowPanel Advance, CrowTail ProtoBoards, and I2C hubs -> future planning should treat owned inventory as the candidate set to design around before suggesting new purchases. [Task 1][Task 2][Task 3][Task 4]
- When the user said they could "hook all the things to CrowTail Proto Boards, and use I2C hubs" -> prefer a CrowTail ProtoBoard + I2C backplane for v0.1 modular integration instead of jumping straight to a custom monolithic wiring plan. [Task 1][Task 2]
- When the user asked whether an ESP32 could be the web server and receive clips for AI -> keep ESP32 as dashboard/control/event API by default, not as the full video-AI ingest engine. [Task 2]
- When the user wanted the handoff updated with the practical build order and current active workspace -> preserve `HANDOFF.md` and `AGENTS.md` as the continuity layer for evolving hardware defaults instead of letting them drift back to older repo copies. [Task 5]

## Reusable knowledge

- The current RV design uses a four-node split: lightpole camera node, near camera/thermal node, gate/fusion node, and inside alarm hub. The durable role split is still camera/perception nodes -> ESP32 event/alarm hub -> alarm/display/logging, with an optional Linux recorder only for heavy storage or richer web UI. [Task 1][Task 2]
- ESP32 is the default for hub, alarm, and simple sensor nodes; Pico/Pico Display and Banana Pi Zero/M2 Zero are middle-tier hub options when ESP32 is too tight but Pi 4/5 is overkill. [Task 1][Task 2]
- The camera-host order for this project is: existing Tapo first, then Luckfox, then dedicated smart-camera modules, then Banana Pi M2-class boards, then Raspberry Pi only when camera/storage/inference justify it. [Task 1]
- AI human detection should run on camera-capable/Linux/AI nodes or an optional recorder, not on the ESP32 hub. A useful contract is for the camera node to send `human_candidate` metadata plus an optional thumbnail or clip reference to the hub. [Task 2][Task 3]
- Event transport should assume Wi-Fi/MQTT when available plus ESP-NOW or LoRa fallback because battery/solar power and spotty Wi-Fi are part of the baseline. [Task 1]
- High-confidence score 9+ events should immediately drive the inside buzzer, matrix, or TFT alert path. [Task 1]
- CrowTail ProtoBoards and I2C hubs are the preferred first integration layer for the hub and trailer tongue node. MLX90640, RTC, fuel gauge, button expander, and IMU/vibration sensors fit well there, but MAX7219, microSD, buzzer, audio, LoRa/SPI radios, and camera buses should stay on dedicated interfaces instead of being forced onto I2C. [Task 1][Task 2]
- Current smart-perception candidate pool for this workspace includes Luckfox camera setups, SenseCAP Watcher, Grove Vision AI V2-style modules, Grove AI Camera 2-style hardware, Kendryte K230 boards, and 5in/7in CrowPanel Advance boards. [Task 2][Task 3]
- `COMPONENT-INVENTORY-SEED.md` is now the reusable inventory source for cameras/vision, sensors, vibration/IMU, displays/UI, MCU stock, radios/networking, and power/build basics in this RV-security planning track. [Task 4]
- `HANDOFF.md` now preserves the practical next step order: bench-test the Luckfox camera path first, then compare SenseCAP Watcher, Grove AI Camera, K230, and CrowPanel Advance only if Luckfox is weak or blocked. [Task 5]

## Failures and how to do differently

- Symptom: the architecture drifts into Pi-first camera hosts or generic camera-node assumptions -> cause: the design did not keep camera hosts separate from ESP32 control/fusion nodes -> fix: keep the v0.2 split explicit and bias toward ESP32 hub + cheap camera host unless Linux storage or heavier inference is specifically needed. [Task 1][Task 2]
- Symptom: the plan assumes ESP32 camera boards the user does not actually have -> cause: the hardware inventory and the phrase "stand alone parts" were not respected early enough -> fix: do not assign camera-host duties to ESP32 unless the user explicitly says ESP32 camera boards exist. [Task 1]
- Symptom: hub, edge-AI node, and recorder roles get blurred together -> cause: CrowPanel, Pi, and ESP32 capabilities were over-generalized -> fix: keep edge perception, hub/control UI, and recorder/storage as separate roles until a board is proven to cover more than one cleanly. [Task 2][Task 3]
- Symptom: continuous audio/video capture sneaks back in as the default -> cause: clip policy was not kept explicit -> fix: preserve the "event driven clips only" rule unless the user asks for continuous recording. [Task 1]
- Symptom: a board marketed as "AI" is treated like a drop-in camera inference node -> cause: SDK/examples and camera/model path were not verified -> fix: confirm the actual host interface and real inference examples before assigning production roles, especially for CrowPanel Advance and similar marketing-heavy boards. [Task 3]
- Symptom: planning guidance hardens around the wrong exact module names -> cause: several items in the inventory are still only partially identified -> fix: preserve wording like "exact model to verify" until silkscreen, module docs, or vendor pages confirm the board. [Task 3][Task 4]
- Symptom: future hardware docs drift back to old repo assumptions or generic shopping lists -> cause: inventory capture and handoff defaults were not kept current -> fix: update `COMPONENT-INVENTORY-SEED.md`, `HANDOFF.md`, and `AGENTS.md` in the same run whenever the architecture or candidate pool changes materially. [Task 4][Task 5]
