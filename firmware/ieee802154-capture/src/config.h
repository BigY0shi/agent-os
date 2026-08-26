// ============================================================================
// config.h — Board C (ESP32-C6-LCD-1.47) pin map and capture tunables
//
// Board C of the rig: 802.15.4 sniffer + web hub with a 1.47" TFT. Pins below
// match the Waveshare ESP32-C6-LCD-1.47; adjust the LINK pins to a free header
// pin on your board if they collide with the SD card slot.
// ============================================================================
#pragma once

#include <Arduino.h>

// ----------------------------------------------------------------------------
// 1.47" TFT (172x320). Non-touch board uses ST7789; touch board uses JD9853.
// Write-only SPI (no MISO needed for the panel).
// ----------------------------------------------------------------------------
#define TFT_WIDTH        172
#define TFT_HEIGHT       320
#define TFT_SCLK_PIN     7
#define TFT_MOSI_PIN     6
#define TFT_CS_PIN       14
#define TFT_DC_PIN       15
#define TFT_RST_PIN      21
#define TFT_BL_PIN       22     // backlight (active high)
#define TFT_COL_OFFSET   34     // 172-wide panel is centred in the 240 GRAM
#define TFT_ROW_OFFSET   0

// Onboard WS2812 RGB LED (status blink); harmless if unused.
#define RGB_LED_PIN      8

// ----------------------------------------------------------------------------
// BOOT button — cycles the capture channel / toggles auto-hop.
// ----------------------------------------------------------------------------
#define MODE_BUTTON_PIN  9
#define BUTTON_DEBOUNCE_MS 40

// ----------------------------------------------------------------------------
// UART uplink from Board A (Board A TX -> this board's LINK_RX_PIN + common GND).
// One-way; we only receive. Pick free header pins if these clash with the SD slot.
// ----------------------------------------------------------------------------
#define LINK_RX_PIN      2
#define LINK_TX_PIN      3      // reserved; link is one-way
#define LINK_UART_NUM    1
#define LINK_BAUD        115200
#define LINK_STALE_MS    8000

// ----------------------------------------------------------------------------
// IEEE 802.15.4 capture. 2.4 GHz channels are 11..26. Auto-hop dwells on each
// channel; the BOOT button locks a channel for focused capture.
// ----------------------------------------------------------------------------
#define IEEE154_CH_MIN   11
#define IEEE154_CH_MAX   26
#define IEEE154_DWELL_MS 4000
#define MAX_PANS         24
#define PAN_EXPIRY_MS    120000

// ----------------------------------------------------------------------------
// Web UI. SoftAP by default (join this SSID, browse to 192.168.4.1). Set
// WIFI_USE_STA to 1 and fill creds to join an existing lab network instead.
// ----------------------------------------------------------------------------
#define WIFI_USE_STA     0
#define WIFI_AP_SSID     "RF-Capture-Rig"
#define WIFI_AP_PASSWORD "capture123"     // >= 8 chars; change for your lab
#define WIFI_STA_SSID    "your-lab-ssid"
#define WIFI_STA_PASSWORD "your-lab-pass"

#define DASHBOARD_REFRESH_MS 500
