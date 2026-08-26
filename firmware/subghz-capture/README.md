# Sub-GHz Capture Unit (Board B)

The sub-GHz half of the dual-ESP rig. An ESP32 drives a **CC1101** as a
**receive-only** listener: it sweeps a sub-GHz ISM band for carrier energy, then
dwells on a listen frequency capturing raw **OOK** bursts. Findings go to USB
serial and stream over a one-way UART link to **Board A** (the 2.4 GHz WiFi/BLE
unit in [`../rf-capture`](../rf-capture)).

> Receive-only by design — the CC1101 transmit strobe is never issued. Use only
> in an isolated lab on signals you are authorized to observe.

## Why a second ESP + CC1101?

The CC1101 is a **sub-GHz** radio (~300–928 MHz); it physically cannot tune to
2.4 GHz, so it can't help with WiFi/BLE — that's Board A's job. Conversely, the
ESP32's own radio can't do sub-GHz, so sub-GHz needs the CC1101. Splitting the
two bands across two ESP32s keeps each capture loop simple and lets both run at
full tilt.

The daughterboard's ESP32 does **not** use its own radio at all (only SPI +
GPIO + one UART), so any ESP32 works. `esp32s3` is the default. ESP32-C5 works
too but its dual-band WiFi would be wasted here and its Arduino/PlatformIO
support is newer — treat C5 as experimental.

## What it captures

- **Energy sweep** — steps the CC1101 across `SWEEP_START_KHZ..SWEEP_STOP_KHZ`
  (default 433.05–434.79 MHz) reading RSSI at each step. Pure carrier-energy
  detection, so it works regardless of modulation. Reports the strongest
  above-gate frequency per sweep.
- **OOK burst capture** — with the CC1101 in ASK/OOK async mode, GDO0 carries
  the demodulated on/off keying. An interrupt timestamps every edge; edges are
  grouped into bursts (transmissions separated by silence) and summarised as
  *edge count / shortest pulse / duration*. That fingerprints 433 MHz remotes,
  doorbells, and sensors without a per-protocol decoder.

### Honest limits
- This is not a full protocol decoder (no manufacturer-specific demux). The OOK
  register profile (`configureOOK()` in [`src/cc1101.cpp`](src/cc1101.cpp)) is a
  reasonable 433.92 MHz starting point; tune `MDMCFG3/4` (data rate + RX
  bandwidth) for the specific signal you're chasing.
- Energy sweep RSSI is relative; the noise floor and `SWEEP_RSSI_GATE` will need
  adjusting per environment/antenna.

## Wiring (defaults for S3; see [`src/config.h`](src/config.h))

| CC1101 | ESP32-S3 |
|--------|----------|
| SCK  | GPIO12 |
| MISO (SO) | GPIO13 |
| MOSI (SI) | GPIO11 |
| CSN  | GPIO10 |
| GDO0 | GPIO4 |
| VCC / GND | 3V3 / GND |

Link to Board A: **Board B `LINK_TX_PIN` (GPIO17 on S3) → Board A `LINK_RX_PIN`**,
plus a shared ground. One-way, 115200 8N1.

## Build & flash

```bash
pio run -e esp32s3 -t upload -t monitor    # or esp32c3 / esp32dev
```

## Link output format

Newline-terminated ASCII CSV (see [`src/link_proto.h`](src/link_proto.h)):

```
E,<freq_khz>,<rssi_dbm>                              energy hit
O,<freq_khz>,<rssi_dbm>,<pulses>,<short_us>,<dur_us> OOK burst
H,<uptime_s>                                         heartbeat
```
