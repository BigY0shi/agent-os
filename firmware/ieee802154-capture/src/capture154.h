// ============================================================================
// capture154.h — passive IEEE 802.15.4 capture on the ESP32-C6 native radio
//
// Runs the 802.15.4 radio in promiscuous mode and channel-hops 11..26. Parses
// each MAC frame far enough to classify it (beacon/data/ack/command) and to
// learn the PAN IDs on air with their RSSI/LQI. Zigbee, Thread, 6LoWPAN and
// Matter-over-Thread all ride on 802.15.4, so this sees them all.
//
// Receive-only: it never transmits and never joins a network.
// ============================================================================
#pragma once

#include <Arduino.h>

struct Pan154 {
  uint16_t panId;
  uint8_t  channel;
  int8_t   rssi;
  uint8_t  lqi;
  uint32_t frames;
  uint32_t lastSeenMs;
  bool     used;
};

struct Stats154 {
  uint32_t total;
  uint32_t beacons;
  uint32_t data;
  uint32_t acks;
  uint32_t cmds;
};

void ieee154Begin();

// Drain captured frames into the store; call from loop().
void ieee154Pump();

// Advance the channel if auto-hop is on and the dwell elapsed; call from loop().
void ieee154Hop(uint32_t nowMs);

// Button actions.
void ieee154NextChannel();   // lock to the next channel (disables auto-hop)
void ieee154ToggleHop();     // re-enable auto-hop

uint8_t  ieee154Channel();
bool     ieee154AutoHop();
Stats154 ieee154Stats();
uint16_t ieee154PanCount();
const Pan154* ieee154PanAt(uint16_t visibleIndex);
