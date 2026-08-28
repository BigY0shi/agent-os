# Hardware: Flipper protoboard backpack (hand-wire plan)

You already have Flipper GPIO protoboard backpacks and spare add-on protoboards.
This is the **jumper list** to hand-wire. No custom PCB.

Receive-only. UART is **3.3 V, 115200 8N1**. **Common ground is mandatory.**
Do not share SPI between the ESP32s.

## Flipper radios vs this backpack

Flipper onboard RF is short-range (tiny CC1101 antenna, modest NFC/RFID/IR).
That is why people use GPIO add-ons. **Keep Board B.** This backpack *is* that
add-on: an external CC1101, plus WiFi/BLE and 802.15.4 the Flipper cannot do.

| Need | Flipper stock | On this backpack |
|------|---------------|------------------|
| Sub-GHz | Weak internal CC1101 | **Board B** external CC1101 |
| WiFi / BLE | None | **Board A** |
| Zigbee / Thread | None | **Board C** (ESP32-C6) |
| NFC / RFID / IR | Weak onboard | Leave stock; not this project |

**Do not power the ESP32s from the Flipper.** Pin **9 = 3.3 V**, pin **1 = 5 V**
(5 V is off until `GPIO → 5V on GPIO`). Those rails are for one small module.
Three ESP32s belong on a **USB 5 V → 3.3 V ≥1 A buck** on the backpack. Share
**GND only** with the Flipper (pins **8, 11, or 18**).

## What sits where

The Waveshare C6 LCD and a C3 SuperMini are whole modules. They sit **on** the
protoboard (header or hot-glue + Dupont), they are not soldered down as chips.

**Use the large Flipper backpack as the hub** (GPIO plug + power + UART +
whatever modules fit). If A or C is physically too big, park it on a **second
protoboard** and run a 4-wire pigtail (3V3, GND, TX, RX) — same netlist.

Recommended first build (fits a roomy backpack):

| Piece | On the backpack |
|-------|-----------------|
| USB-C 5 V in + 3.3 V buck ≥1 A | Yes — 3V3 and GND buses |
| Board B: ESP32-S3 + CC1101 + whip | Yes — this is the Flipper radio upgrade |
| Board A: C3 SuperMini (OLED already on it) | Yes if it fits; else second proto |
| Board C: Waveshare ESP32-C6-LCD-1.47 | Usually a second proto or the far end of the backpack (TFT needs clearance) |
| Flipper 2×9 GPIO | Plug only: GND + UART. No 3V3/5V from Flipper |

## Flipper GPIO pins you actually use

Numbers are the standard Flipper 18-pin header ([expansion UART](https://developer.flipper.net/flipperzero/doxygen/expansion_protocol.html): USART **13 TX / 14 RX**). Most proto backpacks label them.

| Flipper pin | Name | On this backpack |
|-------------|------|------------------|
| 1 | 5 V | **NC** (do not feed the ESP rail) |
| 8, 11, 18 | GND | **Tie to backpack GND** (one is enough; 11 is convenient) |
| 9 | 3.3 V | **NC** |
| 13 | USART TX | **NC** unless you later send commands into the rig |
| 14 | USART RX | **TAP_TX** — listen to Board A’s uplink |
| 15 / 16 | LPUART TX/RX | Spare; ignore |
| 2–7, 10, 12, 17 | GPIO / SPI / I2C / 1-Wire | Free for a future NFC/IR add-on; do not steal for this UART |

Flipper app for a laptop: **GPIO → USB-UART Bridge**, UART pins **13/14**.
TX/RX are from the Flipper’s point of view: **rig TAP_TX → Flipper pin 14**.

## Power (solder this first)

1. USB-C breakout **5 V** and **GND** onto the backpack.
2. Buck converter: VIN=5 V, GND=GND, VOUT adjusted to **3.3 V** before connecting any ESP32.
3. Fat 3V3 bus and fat GND bus (22 AWG or a copper pour). Every module’s 3V3/GND lands here.
4. Flipper pin **11 (GND)** → backpack GND. Stop. Do not jumper Flipper 9 or 1.

## UART daisy-chain (then the host tap)

Default firmware pins below. If you built a board as C3 vs S3 vs WROOM, use the
tables at the end instead.

```
Board B ESP32-S3 GPIO17 (LINK_TX)
        │
        ├──► Board A LINK_RX     C3 SuperMini GPIO0   (or S3 GPIO18)
        │
Board A LINK_TX                  C3 GPIO1  (or S3 GPIO17)
        │
        ├──► Board C GPIO2 (LINK_RX)     Waveshare C6
        │
        └──► Flipper pin 14 (RX)         host tap  [same net as A TX]
```

That is **three signal wires** plus ground. Board C `LINK_TX` (GPIO3) stays unused.

### Jumper list (recommended combo: B=S3, A=C3 SuperMini, C=C6)

Solder/Dupont, then check continuity **before** applying 3.3 V.

| # | From | To | Net |
|---|------|----|-----|
| 1 | USB-C GND | buck GND, 3V3-regulator GND, all module GNDs, Flipper pin 11 | GND |
| 2 | USB-C 5 V | buck VIN | 5V |
| 3 | buck VOUT 3.3 V | Board B 3V3, Board A 3V3, Board C 3V3 | 3V3 |
| 4 | Board B GPIO17 | Board A GPIO0 | B→A UART |
| 5 | Board A GPIO1 | Board C GPIO2 | A→C UART |
| 6 | Board A GPIO1 | Flipper pin 14 | TAP (same as #5 — tee the wire) |
| 7 | Board B CC1101 per SPI table | (on Board B only) | see below |

Wires 5 and 6 are the **same net**: one wire from A GPIO1, split to C GPIO2 and
Flipper 14.

## Board B CC1101 (on the backpack, next to the S3)

Keep SPI traces short. Antenna at the **edge**, away from the C6/C3 2.4 GHz
antennas.

| CC1101 | ESP32-S3 |
|--------|----------|
| SCK | GPIO12 |
| MISO (SO) | GPIO13 |
| MOSI (SI) | GPIO11 |
| CSN | GPIO10 |
| GDO0 | GPIO4 |
| VCC | 3V3 bus |
| GND | GND bus |

## Board C and a second protoboard

If the 1.47" TFT does not fit the backpack, use a spare add-on protoboard:

| Pigtail (4 cores) | Backpack hub | C6 board |
|-------------------|--------------|----------|
| GND | GND bus | GND |
| 3V3 | 3V3 bus | 3V3 |
| A TX | Board A GPIO1 | C6 GPIO2 |
| (optional spare) | — | C6 GPIO3 unused |

Same for Board A if the SuperMini is bulky: 3V3, GND, B TX→A RX (GPIO0), A TX out (GPIO1).

## Antenna / layout on a roomy backpack

- CC1101 whip: one end of the board.
- C3 / C6 onboard antennas: opposite end, not parallel and touching.
- Do not coil the UART jumpers into a loop around an antenna.

## Bring-up

1. Power backpack from USB **with Flipper unplugged**. Measure 3.3 V.
2. Flash each ESP32 over its own USB (see firmware READMEs).
3. Plug Flipper onto the backpack GPIO. **GPIO → USB-UART Bridge**, pins 13/14,
   115200. You should see Board A’s `WA,` / `WS,` lines (and Board B `E,`/`O,`/`H,`
   if you tapped B instead — default tap is A’s uplink).
4. Join Board C AP `RF-Capture-Rig` → http://192.168.4.1

## Alternate pin tables (if A or B is not the recommended MCU)

### B `LINK_TX` → A `LINK_RX`

| B MCU | B TX | A MCU | A RX |
|-------|------|-------|------|
| S3 | 17 | C3 | 0 |
| S3 | 17 | S3 | 18 |
| S3 | 17 | WROOM | 16 |
| C3 | 1 | C3 | 0 |
| WROOM | 17 | WROOM | 16 |

### A `LINK_TX` → C `LINK_RX` (C6 is always GPIO2)

| A MCU | A TX |
|-------|------|
| C3 | 1 |
| S3 | 17 |
| WROOM | 17 |

If C6 GPIO2 hits the SD slot on your wiring, move `LINK_RX_PIN` in
`ieee802154-capture/src/config.h` and the jumper together.

## Pineapple Pager / laptop

Same TAP_TX net (Board A GPIO1): USB-UART adapter RX ← TAP_TX, GND ← GND.
Pineapple is for **WiFi**; this backpack adds **sub-GHz + 802.15.4**. Wireshark
belongs on a laptop, not on the Flipper or Pager GUI.

## Scope

Passive lab capture only. This backpack does not add Flipper transmit/replay.
