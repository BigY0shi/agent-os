// ============================================================================
// IEEE 802.15.4 Capture + Web Hub (Board C) — main
//
// Passive Zigbee/Thread/Matter-over-Thread sniffer on the ESP32-C6's native
// 802.15.4 radio, with a live TFT dashboard and a web UI that also shows Board
// A's WiFi/BLE and Board B's sub-GHz telemetry (received over the UART uplink).
//
// Receive-only: never transmits 802.15.4, never joins a network. WiFi runs only
// a lightweight web server; the C6 shares one antenna between WiFi and 802.15.4,
// so heavy WiFi use is deliberately avoided here.
// ============================================================================
#include <Arduino.h>

#include "config.h"
#include "capture154.h"
#include "uplink.h"
#include "web_ui.h"
#include "display_ui.h"

namespace {

uint32_t g_lastDashMs = 0;

// Button state for short/long press.
bool     g_lastButton = HIGH;
uint32_t g_pressStart = 0;
bool     g_handled = false;
const uint32_t LONG_PRESS_MS = 800;

void handleButton(uint32_t now) {
  bool state = digitalRead(MODE_BUTTON_PIN);
  if (g_lastButton == HIGH && state == LOW) {   // press
    g_pressStart = now;
    g_handled = false;
  }
  if (state == LOW && !g_handled && (now - g_pressStart) >= LONG_PRESS_MS) {
    ieee154ToggleHop();                          // long press: resume auto-hop
    g_handled = true;
  }
  if (g_lastButton == LOW && state == HIGH) {    // release
    if (!g_handled && (now - g_pressStart) >= BUTTON_DEBOUNCE_MS) {
      ieee154NextChannel();                      // short press: lock next channel
    }
  }
  g_lastButton = state;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("Board C: 802.15.4 capture + web hub (receive-only)");

  pinMode(MODE_BUTTON_PIN, INPUT_PULLUP);

  uplinkBegin();

  // WiFi/web first, then 802.15.4, so coexistence initialises cleanly.
  webBegin();
  Serial.printf("Web UI: SSID '%s'  http://%s\n", webSsid(), webIp());

  ieee154Begin();

  if (!displayBegin()) {
    Serial.println("WARN: TFT init failed; running headless (serial + web only)");
  }

  Serial.println("Capture started. BOOT: short=lock/next channel, long=auto-hop.");
  g_lastDashMs = millis();
}

void loop() {
  uint32_t now = millis();

  handleButton(now);
  uplinkPump();
  ieee154Pump();
  ieee154Hop(now);
  webPump();

  if (now - g_lastDashMs >= DASHBOARD_REFRESH_MS) {
    g_lastDashMs = now;
    displayRender();
  }
}
