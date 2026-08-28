# Product spine: HaLow ↔ LoRa field nodes + PolyRadio

Locked decisions from the class / subscription / community-SKU brainstorm.
The capture rig under `rf-capture/`, `subghz-capture/`, and `ieee802154-capture/`
is a **separate lab track**. This doc is the **first commercial ship**.

## Two goals, one BOM

1. **Subscription boxes** — multi-step solder-up that ends in a working gadget
   (not a Heltec in a printed case): protoboard, MCUs, radios, battery, sensors,
   with lessons on buses, bands, power, and crypto.
2. **Community add-on** — the same netlist frozen as a Flipper GPIO backpack /
   PolyRadio AIO that can be kitted repeatedly.

Capture/pentest gear (HackRF, Pineapple, Ubertooth, etc.) stays **demo / class**,
not in the first kit.

## First ship: dual-path MANET (failover, not one magic chip)

There is **no** single IC that is both Wi-Fi HaLow (802.11ah) and LoRa.

| Path | Silicon | Role |
|------|---------|------|
| Fat IP | Quectel **FGH100M-H** (Morse MM6108), 902–928 MHz | 802.11ah when the link is good |
| Long-range fallback | Semtech **LR1121** (or SX1262) | LoRa when HaLow drops; LR1121 also does **LoRa on 2.4 GHz** (still LoRa, not 802.11) |

**Fail over to each other:** try HaLow → on loss/timeout/RSSI floor use LoRa
(915 and/or 2.4 on LR1121) → promote HaLow again when it returns. Same encrypted
payload, different bearer.

Do **not** market LR1121 as “802.11.” Its dual band is **LoRa sub-GHz + LoRa 2.4 GHz**.

US 915 LoRa and HaLow share the same neighborhood; FGH100M-H can hit ~27 dBm.
**Firmware mutex:** never HaLow TX while LoRa is in RX (and preferably never both
TX). Two antennas or a switched RF path.

## Why the nRF52840 is on the node

Not primarily for “more protocols on the poster.” For **power**.

| Domain | Parts | Power behavior |
|--------|-------|----------------|
| **Always-on** | **nRF52840** + **LR1121** | µA sleep; LoRa MANET / wake logic |
| **Fat, gated** | **ESP32-S3** + **FGH100M-H** (+ HaLow FEM rail) | Off behind a load switch until needed |

nRF is the power boss: sleep, LoRa fallback, decide when HaLow is worth the
battery, then rail-enable S3+HaLow. If HaLow never comes up, S3 never comes up.

nRF also covers BLE / 802.15.4 / Thread / Zigbee / ANT on the same 2.4 GHz radio
(timesliced). That is **not** 802.11 Wi-Fi. Real 2.4 GHz Wi-Fi, if claimed, is
the S3 (or a CYW43439 later).

## OTA (agreed)

| Firmware | How you update it |
|----------|-------------------|
| **nRF52840** | **Bluetooth DFU** (MCUboot / nRF Connect / phone or dongle in range). No LoRa firmware pipe. |
| **ESP32-S3** (+ HaLow stack) | **HaLow or USB** bulk transfer. |
| **LoRa** | Data + failover only — not for shipping images. |
| **USB** | Brick recovery and subscription box 1. |

Typical field sequence: nRF BLE DFU for the sleepy MCU; if an S3 image is
needed, BLE/local policy wakes the fat rail, S3 pulls over HaLow, then nRF
kills the rail again. Signed images + A/B (or equivalent) rollback required
before any remote update ships.

## Host topology (v1)

```
                    ┌─ load switch ─┐
LiPo ── buck 3V3 ──┤                ├─ ESP32-S3 ──SPI── FGH100M-H (HaLow)
         │         └────────────────┘
         ├── nRF52840 ──SPI── LR1121 (LoRa 915 / 2.4)
         │       │
         │       └── BLE DFU (phone / Flipper-era dongle)
         │
         └── Flipper GPIO: GND + USART only (pins 11 + 13/14)
             Never power the trio from Flipper 3V3/5V
```

HaLow on Morse wants a host (SPI/SDIO). v1 host for HaLow = **S3**, not the nRF.
Official 802.11s HaLow mesh is a **Linux** story; MCU first ship uses AP/STA or
S1G relay when available, with **LoRa as the real always-on MANET**.

## Subscription box arc (pair of nodes in box 1)

A single board is not a MANET demo. Ship **two** nodes with the same BOM.

| Stage | Add | Learn |
|-------|-----|--------|
| 1 | Proto, power, LiPo, blink/serial | Rails, flashing, USB recovery |
| 2 | nRF + LR1121 | SPI, LoRa airtime, keys, sleep current |
| 3 | BLE DFU | OTA without a cable |
| 4 | S3 + gated rail | Power domains, why the fat SoC stays off |
| 5 | FGH100M-H + mutex | HaLow bring-up, failover to LoRa |
| 6 | Optional sensors / Flipper tap | I2C, host vs radio |

Heltec V3/V4 / HT-HC33 = “integrated cousin” in the booklet, not the kit.

## Community SKU freeze

**PolyRadio / Flipper backpack** = same netlist as the finished subscription
node: nRF always-on + LR1121 + gated S3+HaLow, Flipper UART for status/recovery.
Protoboard kits first; rev-locked PCB when the wiring stops moving.

Test jig: BLE DFU works; LoRa ping between two boards; HaLow associates when
rail is on; sleep current under a published µA budget with fat rail off.

## Out of scope for first ship

- LoRa as OTA transport for S3 images  
- Marketing LR1121 as 802.11  
- Kitting HackRF / Pineapple / Ubertooth  
- Claiming simultaneous HaLow TX + LoRa RX on 915  

## Related docs

- Capture lab wiring: [HARDWARE.md](HARDWARE.md)  
- Capture projects: [README.md](README.md)  
