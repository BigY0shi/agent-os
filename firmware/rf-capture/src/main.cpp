// ============================================================================
// Passive RF Capture Unit — main
//
// Receive-only wireless-security lab instrument for an isolated ("fortified")
// lab. It listens to 2.4 GHz WiFi management frames (promiscuous mode, channel
// hopping) and BLE advertisements (active scan), decodes them to the byte
// level, attributes vendors/platforms, flags privacy leaks, and shows a live
// dashboard on the OLED plus a structured log on USB serial.
//
// It NEVER transmits 802.11 or BLE frames, never associates, never injects.
// ============================================================================
#include <Arduino.h>

#include "config.h"
#include "capture_store.h"
#include "vendor_lookup.h"
#include "wifi_sniffer.h"
#include "ble_scanner.h"
#include "display_ui.h"
#include "subghz_link.h"

namespace {

uint32_t g_lastDashboardMs = 0;
uint32_t g_lastStatsMs = 0;

// Button edge/debounce state.
bool     g_lastButton = HIGH;
uint32_t g_lastButtonMs = 0;

void handleButton(uint32_t nowMs) {
  if (nowMs - g_lastButtonMs < BUTTON_DEBOUNCE_MS) return;
  bool state = digitalRead(MODE_BUTTON_PIN);
  if (g_lastButton == HIGH && state == LOW) {   // falling edge = press
    displayNextView();
    g_lastButtonMs = nowMs;
  }
  g_lastButton = state;
}

void macToStr(const uint8_t* m, char* out) {
  sprintf(out, "%02X:%02X:%02X:%02X:%02X:%02X", m[0], m[1], m[2], m[3], m[4], m[5]);
}

// Periodic structured decode to serial: what we have learned so far, with the
// byte-level attribution (OUI vendor, BLE company/appearance, address privacy).
void logSummary() {
  CaptureStats s = storeStats();
  Serial.println();
  Serial.println("================ CAPTURE SUMMARY ================");
  Serial.printf("frames:%lu beacons:%lu probes:%lu ble-adv:%lu leaks:%lu\n",
                (unsigned long)s.wifiFrames, (unsigned long)s.wifiBeacons,
                (unsigned long)s.wifiProbeReqs, (unsigned long)s.bleAdverts,
                (unsigned long)s.privacyLeaks);

  char mac[18];

  Serial.printf("-- WiFi APs (%u) --\n", storeApCount());
  for (uint16_t i = 0; i < storeApCount(); i++) {
    const WifiAp* ap = storeApAt(i);
    if (!ap) break;
    macToStr(ap->bssid, mac);
    const char* vendor = ouiVendor(ap->bssid);
    Serial.printf("  %s ch%-2u %ddBm %s ssid=\"%s\" vendor=%s\n",
                  mac, ap->channel, ap->rssi, ap->privacy ? "ENC" : "open",
                  ap->ssid[0] ? ap->ssid : "<hidden>",
                  vendor ? vendor : "?");
  }

  Serial.printf("-- Stations / probe leaks (%u) --\n", storeStationCount());
  for (uint16_t i = 0; i < storeStationCount(); i++) {
    const WifiStation* st = storeStationAt(i);
    if (!st) break;
    macToStr(st->mac, mac);
    const char* vendor = ouiVendor(st->mac);
    Serial.printf("  %s %ddBm mac=%s probes=%lu",
                  mac, st->rssi, st->randomizedMac ? "randomized" : "GLOBAL",
                  (unsigned long)st->probes);
    if (st->probedSsid[0]) {
      Serial.printf("  LEAK->\"%s\"", st->probedSsid);
    }
    if (vendor) Serial.printf("  vendor=%s", vendor);
    Serial.println();
  }

  Serial.printf("-- BLE devices (%u) --\n", storeBleCount());
  for (uint16_t i = 0; i < storeBleCount(); i++) {
    const BleDevice* d = storeBleAt(i);
    if (!d) break;
    macToStr(d->addr, mac);
    const char* privacy;
    switch (d->addrKind) {
      case RFADDR_PUBLIC:            privacy = "public(trackable)"; break;
      case RFADDR_RANDOM_STATIC:     privacy = "static(trackable)"; break;
      case RFADDR_RANDOM_RESOLVABLE: privacy = "resolvable-private"; break;
      case RFADDR_RANDOM_NONRESOLV:  privacy = "nonresolvable-private"; break;
      default:                       privacy = "?"; break;
    }
    Serial.printf("  %s %ddBm %s %s name=\"%s\"",
                  mac, d->rssi, d->connectable ? "conn" : "nonconn", privacy,
                  d->name[0] ? d->name : "");
    if (d->company)      Serial.printf(" company=%s", d->company);
    if (d->platformHint) Serial.printf(" platform=%s", d->platformHint);
    if (d->appearance)   Serial.printf(" type=%s", d->appearance);
    Serial.println();
  }

  SubGhzState sg = storeSubghz();
  bool alive = sg.linkSeen && (millis() - sg.lastLinkMs) < LINK_STALE_MS;
  Serial.printf("-- Sub-GHz link: %s --\n",
                alive ? "UP" : (sg.linkSeen ? "STALE" : "not connected"));
  if (sg.energyHits) {
    Serial.printf("  energy peak %ld kHz %d dBm (hits=%lu)\n",
                  sg.lastEnergyKhz, sg.lastEnergyRssi,
                  (unsigned long)sg.energyHits);
  }
  if (sg.ookBursts) {
    Serial.printf("  last OOK %ld kHz %d dBm pulses=%u short=%luus dur=%luus (bursts=%lu)\n",
                  sg.ookFreqKhz, sg.ookRssi, sg.ookPulses,
                  (unsigned long)sg.ookShortestUs,
                  (unsigned long)sg.ookDurationUs,
                  (unsigned long)sg.ookBursts);
  }
  Serial.println("=================================================");
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(MODE_BUTTON_PIN, INPUT_PULLUP);

  Serial.println();
  Serial.println("Passive RF Capture Unit (receive-only)");
  Serial.println("WiFi promiscuous + BLE active scan");

  storeInit();

  if (!displayBegin()) {
    Serial.println("WARN: OLED not found at 0x3C; running headless over serial");
  }

  // Bring up the WiFi sniffer first, then BLE. Both share the 2.4 GHz radio;
  // the ESP32 controller's software coexistence time-slices between them.
  wifiSnifferBegin();
  bleScannerBegin();

  // Optional sub-GHz daughterboard link (Board B). Harmless if none attached.
  subghzLinkBegin();

  Serial.println("Capture started. Press BOOT to cycle OLED views.");
  g_lastDashboardMs = g_lastStatsMs = millis();
}

void loop() {
  uint32_t now = millis();

  handleButton(now);
  wifiSnifferHop(now);
  bleScannerPump();
  subghzLinkPump();

  if (now - g_lastDashboardMs >= DASHBOARD_REFRESH_MS) {
    g_lastDashboardMs = now;
    storeExpireStale(now);
    displayRender(wifiSnifferChannel());
  }

  if (now - g_lastStatsMs >= STATS_LOG_MS) {
    g_lastStatsMs = now;
    logSummary();
  }

  delay(5);
}
