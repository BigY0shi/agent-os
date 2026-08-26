// ============================================================================
// display_ui.h — OLED dashboard with button-cycled views
// ============================================================================
#pragma once

#include <Arduino.h>

enum UiView : uint8_t {
  VIEW_SUMMARY = 0,   // counts + current WiFi channel
  VIEW_WIFI_APS,      // recent access points
  VIEW_WIFI_LEAKS,    // stations + the networks they probe for (PNL leaks)
  VIEW_BLE,           // recent BLE devices
  VIEW_COUNT
};

// Returns true if the OLED was found and initialised. If not, the unit still
// runs headless over serial.
bool displayBegin();

// Advance to the next view (called on button press).
void displayNextView();

// Redraw the current view.
void displayRender(uint8_t wifiChannel);
