// ============================================================================
// web_ui.h — single-page web dashboard for the whole rig, hosted on Board C
//
// Brings up WiFi (SoftAP by default) and a small synchronous web server that
// serves one HTML page plus a /api/status JSON endpoint aggregating all three
// radios: 802.15.4 (local), WiFi/BLE (Board A) and sub-GHz (Board B via A).
// ============================================================================
#pragma once

#include <Arduino.h>

void webBegin();
void webPump();                 // service HTTP clients; call from loop()
const char* webIp();
const char* webSsid();
