# IEEE 802.15.4 Capture + Web Hub (Board C)

The third board of the rig, on a **Waveshare ESP32-C6-LCD-1.47**. It uses the
ESP32-C6's **native 802.15.4 radio** to passively sniff **Zigbee / Thread /
6LoWPAN / Matter-over-Thread**, shows live scan metrics on the 1.47" TFT, and
hosts a **single web dashboard** that also displays Board A's WiFi/BLE and Board
B's sub-GHz telemetry (received over the UART uplink).

> Receive-only: it never transmits 802.15.4 and never joins a network. WiFi runs
> only a lightweight web server (see the antenna note below).

## Why the C6 hosts the web UI

The C6 shares one 2.4 GHz antenna between WiFi and 802.15.4, so it can't run
heavy WiFi capture and 802.15.4 capture at once. The rig sidesteps this: the C6
does 802.15.4 capture plus a *light* web server, while the actual WiFi/BLE
capture stays on Board A. Board A forwards its results (and Board B's) here over
UART, so one page shows all three radios.

```
B (sub-GHz) --UART--> A (WiFi/BLE) --UART--> C (802.15.4 + TFT + Web UI)
                                              └── phone/laptop on its WiFi
```

## Hardware & board variants

- **Non-touch ESP32-C6-LCD-1.47** (ST7789 controller) → build env **`esp32c6`** (default).
- **Touch ESP32-C6-Touch-LCD-1.47** (JD9853 + AXS5106L) → build env **`esp32c6_jd9853`**.
  Arduino_GFX has no dedicated JD9853 driver, so this panel is driven with the
  ST7789-compatible init + colour inversion (the same approach the ESPHome/HA
  community uses). Touch input is not used (the dashboard is display-only).
  Rotation/offset/colour may need a small tweak in `config.h` on some panels.

Pins (Waveshare defaults) are in [`src/config.h`](src/config.h): TFT on SPI
(SCLK 7, MOSI 6, CS 14, DC 15, RST 21, backlight 22), BOOT button GPIO9, and the
UART uplink on GPIO2 (RX). **Wire Board A's `LINK_TX_PIN` → this board's
`LINK_RX_PIN` (GPIO2) plus a common ground.** Move the link pins if they collide
with the onboard SD slot on your board.

## Build & flash

The C6 needs Arduino-ESP32 3.x, provided by the **pioarduino** platform (pinned
in [`platformio.ini`](platformio.ini)); the first build downloads it.

```bash
pio run -e esp32c6 -t upload -t monitor          # non-touch (ST7789)
pio run -e esp32c6_jd9853 -t upload -t monitor   # touch (JD9853)
```

## Using it

1. Power the board. By default it starts a WiFi access point **`RF-Capture-Rig`**
   (password `capture123` — change it in `config.h`).
2. Join that WiFi and browse to **http://192.168.4.1**. To join an existing lab
   network instead, set `WIFI_USE_STA 1` and the credentials in `config.h`.
3. The TFT shows the live 802.15.4 channel, frame-type counts, and the PANs on
   air; the web page adds Board A/B data. **BOOT button:** short press locks the
   next channel (stops hopping) for focused capture; long press resumes hopping.

## What it captures / decodes

- 802.15.4 MAC frames in promiscuous mode, classified as
  **beacon / data / ack / command**, with per-frame **RSSI, LQI, channel**.
- **PAN discovery**: destination PAN IDs seen on air, with signal and frame
  counts — this is how you spot the Zigbee/Thread networks around you.

### Honest limits
- This surfaces MAC-layer metadata and PANs. It does **not** decrypt or fully
  dissect Zigbee NWK/APS or Thread payloads on-device — for that, pair it with
  Wireshark (the reference firmwares linked in the repo README stream PCAP), and
  you must supply your own network key for your own network.
- If you need maximum 802.15.4 throughput for a capture, disable WiFi
  (`capture-priority`): set the AP off / don't open the web page, or build with
  the web server disabled — the antenna is then dedicated to 802.15.4.

## Web API

`GET /api/status` returns JSON aggregating all three radios (802.15.4 locally,
WiFi/BLE from Board A, sub-GHz from Board B). The dashboard page polls it once a
second.
