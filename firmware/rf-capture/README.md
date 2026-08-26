# Passive RF Capture Unit (ESP32)

A **receive-only** 2.4 GHz wireless-security teaching instrument. It listens to
WiFi management frames (promiscuous mode + channel hopping) and BLE
advertisements (active scan), decodes them to the byte level, attributes
vendors/platforms, and highlights privacy-leakage signals — on a small OLED and
over USB serial.

> Intended for use only in an isolated lab you own/control, on devices you are
> authorized to observe. It is passive: it does **not** transmit 802.11/BLE
> frames, associate, inject, deauth, or jam. See [Scope & ethics](#scope--ethics).

## What the radios actually do (read this before wiring)

All capture is performed by the **ESP32's own 2.4 GHz radio**. That is the only
part that can demodulate WiFi and BLE.

| Radio | Band | Role in this project |
|-------|------|----------------------|
| **ESP32 WiFi/BLE (C3 / S3 / WROOM-32)** | 2.4 GHz | **Everything.** Promiscuous 802.11 capture + BLE scan. |
| NRF24L01+ | 2.4 GHz (proprietary GFSK) | **Not used.** Cannot demodulate WiFi; can only crudely catch some BLE *advertising* packets — worse than the ESP32 in every way. |
| CC1101 | sub-GHz (~300–928 MHz) | **Not used.** Physically can't tune to 2.4 GHz. Only relevant for a *separate* sub-GHz lab. |

So the two NRF24s soldered to the C3 SuperMini and any CC1101 contribute nothing
to WiFi/BLE capture. The firmware ignores them.

## Hardware

Works on any of these ESP32 variants (the capture code is identical):

- **ESP32-C3 SuperMini** — already-soldered board, zero extra wiring. `esp32c3`
- **ESP32-S3 DevKitC-1** — recommended (dual-core, more RAM, native USB). `esp32s3`
- **Classic ESP32-WROOM-32 / 32U / 32E** — the `-32U` has a u.FL external
  antenna for better range. `esp32dev`

Plus a **128×64 SSD1306 OLED** over I2C and the on-board **BOOT button** (cycles
OLED views). I2C pins per board are in [`src/config.h`](src/config.h); adjust
them to match your wiring.

## Build & flash (PlatformIO)

```bash
# pick the target that matches your board
pio run -e esp32c3            # ESP32-C3 SuperMini
pio run -e esp32s3            # ESP32-S3 DevKitC-1
pio run -e esp32dev           # classic ESP32-WROOM-32/32U/32E

# flash + open the serial monitor
pio run -e esp32c3 -t upload -t monitor
```

Serial is 115200 baud. On the C3/S3 it comes out of the native USB port.

To also hex-dump every raw frame/advertisement, build with
`-DDUMP_RAW_BYTES=1` (verbose).

## What it captures and decodes

**WiFi (management frames only):**
- Beacons / probe responses → BSSID, SSID (or `<hidden>`), channel, RSSI,
  and the Privacy bit (open vs encrypted BSS).
- Probe requests → station MAC, RSSI, and MAC-randomization detection (the
  locally-administered bit).
- **Privacy leak:** *directed* probe requests carry the name of a network the
  device has previously joined (its Preferred Network List). These are surfaced
  on the `Probe leaks` view and flagged `LEAK->"..."` in the serial log.

**BLE (advertisements + scan responses):**
- Device name, RSSI, connectable vs non-connectable.
- Manufacturer company ID → vendor, and a coarse **platform hint** (Apple/iOS,
  Microsoft/Windows, Google or Samsung/Android).
- Appearance value → device category (phone, watch, earbuds, HID, …).
- **Address privacy classification:** public / static-random (both stable and
  therefore *trackable*) vs resolvable / non-resolvable private (rotating).

Vendor/company/appearance names come from small curated tables in
[`src/vendor_lookup.cpp`](src/vendor_lookup.cpp) — extend them as needed.

### Honest limits (worth telling the class)
- Exact **OS version numbers** are generally *not* broadcast in beacons or
  advertisements. We infer vendor/platform from OUIs and BLE company IDs; treat
  "platform" as a hint, not ground truth.
- BLE **pairing/bond state** isn't observable passively. We report the
  observable state instead: connectable flag, address type, appearance.
- Modern phones randomize WiFi/BLE MACs, so counts of "devices" over-count a
  single phone that rotates its address. That behavior is itself a good lesson.

## How the shared antenna is handled

The ESP32 has one 2.4 GHz radio shared by WiFi and BLE. Rather than literally
transmitting on both at once (impossible), the controller's **software
coexistence** time-slices between the WiFi driver (hopping channels for
promiscuous capture) and the BLE controller (scanning). To the user it looks
simultaneous. NimBLE is used instead of Bluedroid so both stacks fit in RAM.

## On-device views (press BOOT to cycle)

1. **Summary** — WiFi channel, AP/station/BLE counts, probe + leak totals.
2. **WiFi APs** — recent access points (`*` = encrypted).
3. **Probe leaks** — networks devices are probing for (`~` randomized MAC,
   `!` global/real MAC).
4. **BLE devices** — address-type tag (`pub`/`sta`/`rpa`/`nrp`) + name/vendor.

## Scope & ethics

This is a passive lab tool for a wireless-security course. Capturing frames that
are broadcast in the clear is how sniffers, Wireshark, and `airodump-ng` work,
and it's standard coursework. Keep it that way:

- Use it only in an isolated lab, on your own/authorized devices.
- It is receive-only by design. Do not add transmit/inject/deauth/jam features.
- Broadcast metadata can still be personal (device names, home SSIDs in probe
  lists). Don't log or share captures of people who didn't consent.
