// ============================================================================
// config.h — sub-GHz daughterboard pin map and capture tunables
//
// Board B of the dual-ESP rig. Drives a CC1101 over SPI and streams events to
// Board A (the 2.4 GHz unit) over a one-way UART link. It has no OLED; it logs
// to USB serial and to the link.
// ============================================================================
#pragma once

#include <Arduino.h>

// ----------------------------------------------------------------------------
// CC1101 SPI + control pins, and the UART link to Board A. Board-selected via
// a -DRFCAP_BOARD_* flag in platformio.ini (same convention as Board A).
// GDO0 carries the async demodulated bitstream and is read with an interrupt.
// ----------------------------------------------------------------------------
#if defined(RFCAP_BOARD_S3)
  #define CC1101_SCK_PIN   12
  #define CC1101_MISO_PIN  13
  #define CC1101_MOSI_PIN  11
  #define CC1101_CSN_PIN   10
  #define CC1101_GDO0_PIN   4
  #define LINK_TX_PIN      17     // -> Board A RX
  #define LINK_RX_PIN      18     // unused (link is one-way) but reserved
  #define LINK_UART_NUM     1
#elif defined(RFCAP_BOARD_C3)
  #define CC1101_SCK_PIN    4
  #define CC1101_MISO_PIN   5
  #define CC1101_MOSI_PIN   6
  #define CC1101_CSN_PIN    7
  #define CC1101_GDO0_PIN   3
  #define LINK_TX_PIN       1     // -> Board A RX
  #define LINK_RX_PIN       0
  #define LINK_UART_NUM     1
#elif defined(RFCAP_BOARD_CLASSIC)
  #define CC1101_SCK_PIN   18
  #define CC1101_MISO_PIN  19
  #define CC1101_MOSI_PIN  23
  #define CC1101_CSN_PIN    5
  #define CC1101_GDO0_PIN   4
  #define LINK_TX_PIN      17     // -> Board A RX
  #define LINK_RX_PIN      16
  #define LINK_UART_NUM     2
#else
  #error "No board selected: define RFCAP_BOARD_S3 / _C3 / _CLASSIC (see platformio.ini)"
#endif

// ----------------------------------------------------------------------------
// Capture scheduling. Each cycle: sweep the band for energy, then dwell on the
// primary listen frequency capturing OOK bursts.
// ----------------------------------------------------------------------------
#define SWEEP_PHASE_MS     1500    // energy sweep duration per cycle
#define LISTEN_PHASE_MS    6000    // OOK capture dwell per cycle
#define LISTEN_FREQ_MHZ    433.92f // primary OOK listen frequency

// Energy sweep: linear steps between START and STOP (kHz). Defaults cover the
// 433 MHz ISM band; widen/retune for 315 / 868 / 915 MHz work.
#define SWEEP_START_KHZ    433050L
#define SWEEP_STOP_KHZ     434790L
#define SWEEP_STEP_KHZ     60L
#define SWEEP_DWELL_US     800      // settle time before reading RSSI per step
#define SWEEP_RSSI_GATE    -90      // only report steps stronger than this dBm

// ----------------------------------------------------------------------------
// OOK burst detection (edge timing on GDO0).
// ----------------------------------------------------------------------------
#define OOK_EDGE_BUFFER    512      // ring buffer of edge timestamps
#define OOK_GAP_US         5000     // silence longer than this ends a burst
#define OOK_MIN_PULSES     8        // ignore noise: require this many edges
#define OOK_GLITCH_US      80       // ignore sub-glitch edges shorter than this
