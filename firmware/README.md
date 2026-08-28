# Multi-ESP Passive RF Capture Rig

Cooperating ESP32 boards that together passively capture across the 2.4 GHz WiFi
band, sub-GHz ISM, and 802.15.4 (Zigbee/Thread) for a wireless-security lab.
Everything here is **receive-only** — no transmit, associate, inject, deauth, or
jam.

```
  sub-GHz (~433 MHz)         2.4 GHz WiFi/BLE           802.15.4 (Zigbee/Thread)
 ┌────────────────────┐   ┌────────────────────┐   ┌──────────────────────────┐
 │ Board B: subghz-    │   │ Board A: rf-capture│   │ Board C: ieee802154-     │
 │  capture            │   │ ESP32 (C3/S3/WROOM)│   │  capture (ESP32-C6-LCD)  │
 │ ESP32 + CC1101      │   │ • WiFi promiscuous │   │ • 802.15.4 promiscuous   │
 │ • RSSI energy sweep │   │ • BLE active scan  │   │ • 1.47" TFT dashboard    │
 │ • OOK burst capture │   │ • OLED + USB serial│   │ • Web UI (all 3 radios)  │
 └─────────┬──────────┘   └─────────┬──────────┘   └────────────▲─────────────┘
           │  UART (B TX→A RX)      │  UART (A TX→C RX)          │
           └───────────────────────┴────────────────────────────┘
                     one-way telemetry chain: B → A → C
                                                    │
                                        phone/laptop │ joins Board C's WiFi
                                                    ▼  and opens the dashboard
```

Board A shows Board B's sub-GHz data on its own OLED (`SUBG` view). Board C
aggregates **all three** radios onto one **web dashboard** and shows live
802.15.4 metrics on its colour TFT.

## The three projects

| Project | Board | Radio | Captures |
|---------|-------|-------|----------|
| [`rf-capture/`](rf-capture) | ESP32-C3 SuperMini / S3 / WROOM-32 | ESP32 built-in | WiFi mgmt frames, BLE advertisements |
| [`subghz-capture/`](subghz-capture) | ESP32-S3 (or C3 / WROOM-32) + CC1101 | CC1101 | sub-GHz energy sweep, OOK bursts |
| [`ieee802154-capture/`](ieee802154-capture) | Waveshare ESP32-C6-LCD-1.47 | ESP32-C6 native 802.15.4 | Zigbee/Thread PANs, MAC frames; **hosts the web UI** |

Each has its own PlatformIO project and README. Build them independently.

## Which radio does what (important)

- **ESP32 (C3/S3/WROOM) built-in radio** → captures **WiFi/BLE** (2.4 GHz).
- **ESP32-C6 built-in radio** → adds a native **802.15.4** radio for
  **Zigbee/Thread/Matter-over-Thread** (the C3/S3/WROOM can't do this).
- **CC1101** → **sub-GHz only** (~300–928 MHz); cannot touch 2.4 GHz.
- **NRF24L01+** → proprietary 2.4 GHz; **not used** by any project.

Note: the C6 shares one antenna between WiFi and 802.15.4, so it hosts the web
server (light WiFi use) while the heavy WiFi/BLE capture stays on Board A.

## Connecting the boards

Hand-wire plan for a **Flipper GPIO protoboard backpack** (power, jumper list,
host tap): **[HARDWARE.md](HARDWARE.md)**.

The telemetry chain is one-way: **B → A → C**.

1. **Board B → Board A:** wire `LINK_TX_PIN` (B) → `LINK_RX_PIN` (A) + common GND.
2. **Board A → Board C:** wire `LINK_TX_PIN` (A) → `LINK_RX_PIN` (C, GPIO2) + common GND.
3. Tee Board A’s TX to Flipper **pin 14 (RX)** + GND (pin 11). Do **not** take
   3.3 V or 5 V from the Flipper — onboard radios are weak; this backpack *is*
   the GPIO add-on. Details in [HARDWARE.md](HARDWARE.md).
4. Flash each board with its matching `-e` env, power the backpack from USB,
   then join Board C's WiFi (`RF-Capture-Rig`) and open **http://192.168.4.1**.
   Any subset works on its own — a missing upstream board just shows as
   "not connected".

## Scope & ethics

A passive teaching instrument for a wireless-security course: capture of
in-the-clear broadcast/energy only, in an isolated lab, on authorized devices.
Keep it receive-only.
