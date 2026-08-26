#include "uplink.h"
#include "config.h"
#include <string.h>
#include <stdlib.h>

namespace {

HardwareSerial g_link(LINK_UART_NUM);
UpstreamState  g_state;
char     g_buf[128];
uint8_t  g_len = 0;

void parseLine(char* line) {
  // Expect a 2-char tag then a comma, e.g. "WA," or "WS,".
  if (line[0] != 'W' || line[1] == '\0' || line[2] != ',') return;
  char which = line[1];

  char* fields[8] = {nullptr};
  uint8_t n = 0;
  char* p = strtok(line + 3, ",");
  while (p && n < 8) { fields[n++] = p; p = strtok(nullptr, ","); }

  if (which == 'A' && n >= 6) {
    g_state.wifiChannel = (uint8_t)atoi(fields[0]);
    g_state.aps      = (uint16_t)atoi(fields[1]);
    g_state.stations = (uint16_t)atoi(fields[2]);
    g_state.ble      = (uint16_t)atoi(fields[3]);
    g_state.probes   = (uint32_t)atol(fields[4]);
    g_state.leaks    = (uint32_t)atol(fields[5]);
    g_state.seen = true;
    g_state.lastMs = millis();
  } else if (which == 'S' && n >= 4) {
    g_state.subghzAlive     = atoi(fields[0]) != 0;
    g_state.subghzPeakKhz   = atol(fields[1]);
    g_state.subghzPeakRssi  = atoi(fields[2]);
    g_state.subghzOokBursts = (uint32_t)atol(fields[3]);
    g_state.seen = true;
    g_state.lastMs = millis();
  }
}

}  // namespace

void uplinkBegin() {
  memset(&g_state, 0, sizeof(g_state));
  g_link.begin(LINK_BAUD, SERIAL_8N1, LINK_RX_PIN, LINK_TX_PIN);
  g_len = 0;
}

void uplinkPump() {
  while (g_link.available()) {
    char c = (char)g_link.read();
    if (c == '\n' || c == '\r') {
      g_buf[g_len] = '\0';
      if (g_len > 0) parseLine(g_buf);
      g_len = 0;
    } else if (g_len < sizeof(g_buf) - 1) {
      g_buf[g_len++] = c;
    } else {
      g_len = 0;
    }
  }
}

UpstreamState uplinkState() { return g_state; }
