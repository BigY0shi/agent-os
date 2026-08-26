# Dual-ESP Passive RF Capture Rig

Two cooperating ESP32 boards that together passively capture across both the
2.4 GHz and sub-GHz bands for a wireless-security lab. Everything here is
**receive-only** — no transmit, associate, inject, deauth, or jam.

```
        2.4 GHz band                         sub-GHz band (~433 MHz)
   ┌───────────────────────┐            ┌───────────────────────────┐
   │  Board A: rf-capture   │            │  Board B: subghz-capture  │
   │  ESP32 (C3/S3/WROOM)   │            │  ESP32 + CC1101           │
   │  • WiFi promiscuous    │            │  • RSSI energy sweep      │
   │  • BLE active scan     │            │  • OOK burst capture      │
   │  • OLED + USB serial   │            │  • USB serial             │
   └───────────▲───────────┘            └─────────────┬─────────────┘
               │   one-way UART link (115200 8N1)      │
               └──────────  Board B TX → Board A RX ◄───┘
                            (+ common ground)
```

Board A also renders Board B's sub-GHz findings on its OLED (`SUBG` view) and in
its serial summary, so one screen shows both bands.

## The two projects

| Project | Board | Radio | Captures |
|---------|-------|-------|----------|
| [`rf-capture/`](rf-capture) | ESP32-C3 SuperMini / S3 / WROOM-32 | ESP32 built-in | WiFi mgmt frames, BLE advertisements |
| [`subghz-capture/`](subghz-capture) | ESP32-S3 (or C3 / WROOM-32) + CC1101 | CC1101 | sub-GHz energy sweep, OOK bursts |

Each has its own PlatformIO project and README. Build them independently.

## Which radio does what (important)

- **ESP32 built-in radio** → the only thing that can capture **WiFi/BLE** (2.4 GHz).
- **CC1101** → **sub-GHz only** (~300–928 MHz); cannot touch 2.4 GHz.
- **NRF24L01+** → proprietary 2.4 GHz; **not used** by either project (can't
  demodulate WiFi and is strictly worse than the ESP32 for BLE).

## Connecting the two boards

1. Wire **Board B `LINK_TX_PIN` → Board A `LINK_RX_PIN`** and connect the two
   boards' grounds together. The link is one-way (B talks, A listens).
2. Default link pins per board are in each project's `src/config.h`. On S3, that
   is Board B GPIO17 → Board A GPIO18.
3. Flash each board with the matching `-e` env, power both, and open Board A's
   OLED (press BOOT to reach the `SUBG` view) or either board's USB serial.

## Scope & ethics

A passive teaching instrument for a wireless-security course: capture of
in-the-clear broadcast/energy only, in an isolated lab, on authorized devices.
Keep it receive-only.
