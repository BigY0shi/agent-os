// ============================================================================
// uplink.h — ingest Board A's consolidated telemetry over the UART link
//
// Board A (WiFi/BLE) forwards a summary of its own capture plus Board B's
// sub-GHz stats up to Board C. Board C stores the latest values so the web UI
// can present all three radios on one page.
//
// Line formats (see link_proto.h):
//   WA,<wifiCh>,<aps>,<stations>,<ble>,<probes>,<leaks>
//   WS,<linkAlive>,<peakKhz>,<peakRssi>,<ookBursts>
// ============================================================================
#pragma once

#include <Arduino.h>

struct UpstreamState {
  bool     seen;
  uint32_t lastMs;
  // Board A WiFi/BLE
  uint8_t  wifiChannel;
  uint16_t aps;
  uint16_t stations;
  uint16_t ble;
  uint32_t probes;
  uint32_t leaks;
  // Board B sub-GHz (relayed by A)
  bool     subghzAlive;
  long     subghzPeakKhz;
  int      subghzPeakRssi;
  uint32_t subghzOokBursts;
};

void uplinkBegin();
void uplinkPump();               // parse pending UART bytes; call from loop()
UpstreamState uplinkState();
