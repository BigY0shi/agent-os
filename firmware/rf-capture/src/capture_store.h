// ============================================================================
// capture_store.h — in-memory tables of everything we have observed
//
// All access happens from the Arduino loop task except the WiFi promiscuous
// callback, which runs in the WiFi driver context. Updates from the callback
// are guarded by a small critical section (see capture_store.cpp).
// ============================================================================
#pragma once

#include <Arduino.h>
#include "config.h"

// ----------------------------------------------------------------------------
// WiFi access point (learned from beacons / probe responses).
// ----------------------------------------------------------------------------
struct WifiAp {
  uint8_t bssid[6];
  char ssid[33];        // up to 32 bytes + NUL; empty string = hidden
  uint8_t channel;
  int8_t rssi;
  bool privacy;         // Privacy bit set in capabilities (encrypted)
  uint32_t beacons;
  uint32_t lastSeenMs;
  bool used;
};

// ----------------------------------------------------------------------------
// WiFi station/client (learned mostly from probe requests).
// probedSsid holds the most recent *directed* probe SSID — a privacy leak, as
// it reveals a network the device has previously joined (its PNL).
// ----------------------------------------------------------------------------
struct WifiStation {
  uint8_t mac[6];
  char probedSsid[33];
  int8_t rssi;
  bool randomizedMac;   // locally-administered bit set => randomized/private
  uint32_t probes;
  uint32_t lastSeenMs;
  bool used;
};

// ----------------------------------------------------------------------------
// BLE device (learned from advertisements / scan responses).
// ----------------------------------------------------------------------------
// Names are prefixed RFADDR_ to avoid clashing with NimBLE's BLE_ADDR_* macros.
enum BleAddrKind : uint8_t {
  RFADDR_PUBLIC = 0,          // globally unique, trackable
  RFADDR_RANDOM_STATIC,       // stable for a power cycle
  RFADDR_RANDOM_RESOLVABLE,   // privacy: rotates, resolvable with IRK
  RFADDR_RANDOM_NONRESOLV,    // privacy: rotates, non-resolvable
  RFADDR_UNKNOWN
};

struct BleDevice {
  uint8_t addr[6];
  char name[33];
  BleAddrKind addrKind;
  uint16_t companyId;        // 0xFFFF = none seen
  const char* company;       // resolved name or nullptr
  const char* appearance;    // resolved category or nullptr
  const char* platformHint;  // e.g. "Apple Continuity", "Microsoft Swift Pair"
  bool connectable;
  int8_t rssi;
  uint32_t adverts;
  uint32_t lastSeenMs;
  bool used;
};

// ----------------------------------------------------------------------------
// Aggregate counters for the dashboard / summary log.
// ----------------------------------------------------------------------------
struct CaptureStats {
  uint32_t wifiFrames;
  uint32_t wifiBeacons;
  uint32_t wifiProbeReqs;
  uint32_t bleAdverts;
  uint32_t privacyLeaks;   // directed probes + public/static BLE addresses
};

// ----------------------------------------------------------------------------
// Sub-GHz state reported by the CC1101 daughterboard over the UART link.
// ----------------------------------------------------------------------------
struct SubGhzState {
  bool     linkSeen;        // any link line ever received
  uint32_t lastLinkMs;      // millis() of the last line received
  long     lastEnergyKhz;   // strongest swept frequency
  int      lastEnergyRssi;
  uint32_t energyHits;
  long     ookFreqKhz;      // last OOK burst
  int      ookRssi;
  uint16_t ookPulses;
  uint32_t ookShortestUs;
  uint32_t ookDurationUs;
  uint32_t ookBursts;
};

void storeInit();

// WiFi ingest (called from promiscuous callback context).
void storeAddOrUpdateAp(const uint8_t bssid[6], const char* ssid, uint8_t ssidLen,
                        uint8_t channel, int8_t rssi, bool privacy);
void storeAddOrUpdateStation(const uint8_t mac[6], const char* probedSsid,
                             uint8_t ssidLen, int8_t rssi);

// BLE ingest (called from loop task).
BleDevice* storeAddOrUpdateBle(const uint8_t addr[6], BleAddrKind kind, int8_t rssi);

// Maintenance / access.
void storeExpireStale(uint32_t nowMs);
CaptureStats storeStats();
uint16_t storeApCount();
uint16_t storeStationCount();
uint16_t storeBleCount();

// Read-only snapshots for rendering (index-based; skips unused slots).
const WifiAp* storeApAt(uint16_t visibleIndex);
const WifiStation* storeStationAt(uint16_t visibleIndex);
const BleDevice* storeBleAt(uint16_t visibleIndex);

// Sub-GHz link ingest (called from loop task as UART lines arrive).
void storeSubghzEnergy(long freqKhz, int rssiDbm);
void storeSubghzOok(long freqKhz, int rssiDbm, uint16_t pulses,
                    uint32_t shortestUs, uint32_t durationUs);
void storeSubghzHeartbeat();
SubGhzState storeSubghz();          // linkAlive is computed against LINK_STALE_MS
