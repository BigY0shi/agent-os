// ============================================================================
// config.h — hardware pin map and capture tunables
//
// PROJECT: Passive RF Capture Unit (WiFi + BLE), ESP32-C3 SuperMini
// PURPOSE: Receive-only wireless-security lab instrument. It never transmits
//          802.11 or BLE frames; it only listens, parses, and displays.
// ============================================================================
#pragma once

#include <Arduino.h>

// ----------------------------------------------------------------------------
// OLED (SSD1306, I2C) + view button. Pins are board-specific; the target is
// selected by a -DRFCAP_BOARD_* flag in platformio.ini. Adjust the I2C pins
// below if your hand-wiring differs — they are the only board-dependent lines.
// ----------------------------------------------------------------------------
#define OLED_WIDTH      128
#define OLED_HEIGHT     64
#define OLED_RESET      -1
#define OLED_I2C_ADDR   0x3C

#if defined(RFCAP_BOARD_C3)
  // ESP32-C3 SuperMini OLED (already-soldered board).
  #define OLED_SDA_PIN    2
  #define OLED_SCL_PIN    3
  #define MODE_BUTTON_PIN 9      // BOOT button
#elif defined(RFCAP_BOARD_S3)
  // ESP32-S3 DevKitC-1 (hand-wired OLED).
  #define OLED_SDA_PIN    8
  #define OLED_SCL_PIN    9
  #define MODE_BUTTON_PIN 0      // BOOT button
#elif defined(RFCAP_BOARD_CLASSIC)
  // Classic ESP32-WROOM-32 / 32U / 32E (hand-wired OLED).
  #define OLED_SDA_PIN    21
  #define OLED_SCL_PIN    22
  #define MODE_BUTTON_PIN 0      // BOOT button
#else
  #error "No board selected: define RFCAP_BOARD_C3 / _S3 / _CLASSIC (see platformio.ini)"
#endif

// Active low, uses the internal pull-up. Cycles the on-screen view.
#define BUTTON_DEBOUNCE_MS 40

// ----------------------------------------------------------------------------
// WiFi channel hopping. 2.4 GHz channels 1..13 (14 is JP-only and rarely used).
// Each channel is dwelled on for CHANNEL_DWELL_MS before hopping.
// ----------------------------------------------------------------------------
#define WIFI_CHANNEL_MIN   1
#define WIFI_CHANNEL_MAX   13
#define CHANNEL_DWELL_MS   250

// ----------------------------------------------------------------------------
// BLE active scan. Active scan (vs passive) requests scan responses, which is
// where many devices put their full name / extra data.
// Window/interval are in 0.625 ms BLE units via NimBLE's ms helpers.
// ----------------------------------------------------------------------------
#define BLE_SCAN_ACTIVE       true
#define BLE_SCAN_INTERVAL_MS  90
#define BLE_SCAN_WINDOW_MS    90

// ----------------------------------------------------------------------------
// Housekeeping cadence.
// ----------------------------------------------------------------------------
#define DASHBOARD_REFRESH_MS  500     // OLED redraw interval
#define STATS_LOG_MS          5000    // periodic summary to serial
#define DEVICE_EXPIRY_MS      60000   // drop a device from the table if unseen

// ----------------------------------------------------------------------------
// Table sizes. Kept modest to fit C3 RAM; oldest/least-recently-seen entries
// are evicted when full.
// ----------------------------------------------------------------------------
#define MAX_WIFI_APS      48
#define MAX_WIFI_STATIONS 48
#define MAX_BLE_DEVICES   48

// Set to 1 to hex-dump every captured frame/advertisement to serial. Verbose;
// off by default so the structured log stays readable.
#ifndef DUMP_RAW_BYTES
#define DUMP_RAW_BYTES 0
#endif
