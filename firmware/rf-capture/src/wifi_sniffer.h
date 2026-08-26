// ============================================================================
// wifi_sniffer.h — receive-only 802.11 capture via ESP32 promiscuous mode
//
// Puts the ESP32 WiFi driver in NULL mode + promiscuous, filters for MANAGEMENT
// frames only, and hops channels. It parses beacons / probe responses (APs) and
// probe requests (stations). It never associates and never transmits.
// ============================================================================
#pragma once

#include <Arduino.h>

void wifiSnifferBegin();

// Advance the capture channel if the dwell time has elapsed. Call from loop().
void wifiSnifferHop(uint32_t nowMs);

// Current 2.4 GHz channel being listened on.
uint8_t wifiSnifferChannel();
