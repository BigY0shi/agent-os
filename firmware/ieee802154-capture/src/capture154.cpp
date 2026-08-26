#include "capture154.h"
#include "config.h"

#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <string.h>

#include "esp_ieee802154.h"

namespace {

// Raw frame snapshot passed from the radio callback to the loop task.
struct RawFrame {
  uint8_t len;
  uint8_t psdu[127];
  int8_t  rssi;
  uint8_t lqi;
  uint8_t channel;
};

QueueHandle_t g_queue = nullptr;

Pan154   g_pans[MAX_PANS];
Stats154 g_stats;

uint8_t  g_channel = IEEE154_CH_MIN;
bool     g_autoHop = true;
uint32_t g_lastHopMs = 0;

void applyChannel(uint8_t ch) {
  g_channel = ch;
  esp_ieee802154_set_channel(ch);
}

Pan154* findOrAcquirePan(uint16_t panId) {
  Pan154* freeSlot = nullptr;
  Pan154* lru = nullptr;
  for (uint16_t i = 0; i < MAX_PANS; i++) {
    Pan154& p = g_pans[i];
    if (p.used && p.panId == panId) return &p;
    if (!p.used && !freeSlot) freeSlot = &p;
    if (p.used && (!lru || p.lastSeenMs < lru->lastSeenMs)) lru = &p;
  }
  return freeSlot ? freeSlot : lru;
}

// Parse the MAC header enough to get frame type and destination PAN ID.
// Returns frame type (0..3); sets *destPan if a destination PAN is present.
uint8_t parseFrame(const uint8_t* psdu, uint8_t len, uint16_t* destPan,
                   bool* havePan) {
  *havePan = false;
  if (len < 3) return 0xFF;

  uint16_t fcf = psdu[0] | (psdu[1] << 8);
  uint8_t frameType = fcf & 0x07;
  uint8_t destMode = (fcf >> 10) & 0x03;   // 0 none, 2 short, 3 extended
  uint8_t srcMode = (fcf >> 14) & 0x03;

  // Acks carry no addressing; nothing more to extract.
  if (frameType == 0x02) return frameType;

  uint8_t idx = 3;  // skip FCF (2) + sequence number (1)
  if (destMode != 0) {
    if (idx + 2 > len) return frameType;
    *destPan = psdu[idx] | (psdu[idx + 1] << 8);
    *havePan = true;
    idx += 2;                               // dest PAN
    idx += (destMode == 2) ? 2 : 8;         // dest address
  }
  (void)srcMode;  // src PAN/addr parsing not needed for PAN discovery
  return frameType;
}

void IRAM_ATTR onReceive(uint8_t* frame, esp_ieee802154_frame_info_t* info) {
  if (!g_queue || !frame) return;
  RawFrame rf;
  rf.len = frame[0];                        // PHR: PSDU length
  if (rf.len > sizeof(rf.psdu)) rf.len = sizeof(rf.psdu);
  memcpy(rf.psdu, &frame[1], rf.len);
  rf.rssi = info ? info->rssi : 0;
  rf.lqi = info ? info->lqi : 0;
  rf.channel = info ? info->channel : g_channel;
  BaseType_t hpw = pdFALSE;
  xQueueSendFromISR(g_queue, &rf, &hpw);
  if (hpw) portYIELD_FROM_ISR();
}

}  // namespace

// The driver calls this weak symbol when a frame is received.
extern "C" void esp_ieee802154_receive_done(uint8_t* frame,
                                            esp_ieee802154_frame_info_t* frame_info) {
  onReceive(frame, frame_info);
}

void ieee154Begin() {
  memset(g_pans, 0, sizeof(g_pans));
  memset(&g_stats, 0, sizeof(g_stats));
  g_queue = xQueueCreate(24, sizeof(RawFrame));

  esp_ieee802154_enable();
  esp_ieee802154_set_promiscuous(true);
  esp_ieee802154_set_rx_when_idle(true);
  applyChannel(IEEE154_CH_MIN);
  esp_ieee802154_receive();
  g_lastHopMs = millis();
}

void ieee154Pump() {
  if (!g_queue) return;
  RawFrame rf;
  while (xQueueReceive(g_queue, &rf, 0) == pdTRUE) {
    uint16_t destPan = 0;
    bool havePan = false;
    uint8_t type = parseFrame(rf.psdu, rf.len, &destPan, &havePan);

    g_stats.total++;
    switch (type) {
      case 0x00: g_stats.beacons++; break;
      case 0x01: g_stats.data++; break;
      case 0x02: g_stats.acks++; break;
      case 0x03: g_stats.cmds++; break;
      default: break;
    }

    if (havePan && destPan != 0xFFFF) {  // 0xFFFF = broadcast PAN, not a network
      Pan154* p = findOrAcquirePan(destPan);
      if (p) {
        if (!p->used || p->panId != destPan) {
          memset(p, 0, sizeof(*p));
          p->panId = destPan;
        }
        p->channel = rf.channel;
        p->rssi = rf.rssi;
        p->lqi = rf.lqi;
        p->frames++;
        p->lastSeenMs = millis();
        p->used = true;
      }
    }
  }

  // Expire PANs not heard for a while.
  uint32_t now = millis();
  for (uint16_t i = 0; i < MAX_PANS; i++) {
    if (g_pans[i].used && (now - g_pans[i].lastSeenMs) > PAN_EXPIRY_MS) {
      g_pans[i].used = false;
    }
  }
}

void ieee154Hop(uint32_t nowMs) {
  if (!g_autoHop) return;
  if (nowMs - g_lastHopMs < IEEE154_DWELL_MS) return;
  g_lastHopMs = nowMs;
  uint8_t next = g_channel + 1;
  if (next > IEEE154_CH_MAX) next = IEEE154_CH_MIN;
  applyChannel(next);
}

void ieee154NextChannel() {
  g_autoHop = false;
  uint8_t next = g_channel + 1;
  if (next > IEEE154_CH_MAX) next = IEEE154_CH_MIN;
  applyChannel(next);
}

void ieee154ToggleHop() {
  g_autoHop = !g_autoHop;
  g_lastHopMs = millis();
}

uint8_t  ieee154Channel() { return g_channel; }
bool     ieee154AutoHop() { return g_autoHop; }
Stats154 ieee154Stats()   { return g_stats; }

uint16_t ieee154PanCount() {
  uint16_t n = 0;
  for (uint16_t i = 0; i < MAX_PANS; i++) if (g_pans[i].used) n++;
  return n;
}

const Pan154* ieee154PanAt(uint16_t visibleIndex) {
  uint16_t seen = 0;
  for (uint16_t i = 0; i < MAX_PANS; i++) {
    if (g_pans[i].used) {
      if (seen == visibleIndex) return &g_pans[i];
      seen++;
    }
  }
  return nullptr;
}
