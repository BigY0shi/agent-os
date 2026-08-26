#include "subghz_link.h"
#include "capture_store.h"
#include "config.h"
#include <string.h>
#include <stdlib.h>

namespace {

HardwareSerial g_link(LINK_UART_NUM);
char     g_buf[96];
uint8_t  g_len = 0;

void parseLine(char* line) {
  if (line[0] == '\0') return;
  char type = line[0];
  if (line[1] != ',') {
    if (type == 'H') { storeSubghzHeartbeat(); }   // "H,<uptime>" or bare
    return;
  }

  // Tokenise the comma-separated fields after the type tag.
  char* fields[6] = {nullptr};
  uint8_t n = 0;
  char* p = strtok(line + 2, ",");
  while (p && n < 6) {
    fields[n++] = p;
    p = strtok(nullptr, ",");
  }

  switch (type) {
    case 'E':  // E,<freq_khz>,<rssi_dbm>
      if (n >= 2) storeSubghzEnergy(atol(fields[0]), atoi(fields[1]));
      break;
    case 'O':  // O,<freq_khz>,<rssi_dbm>,<pulses>,<short_us>,<dur_us>
      if (n >= 5) {
        storeSubghzOok(atol(fields[0]), atoi(fields[1]),
                       (uint16_t)atol(fields[2]),
                       (uint32_t)atol(fields[3]), (uint32_t)atol(fields[4]));
      }
      break;
    case 'H':
      storeSubghzHeartbeat();
      break;
    default:
      break;
  }
}

}  // namespace

void subghzLinkBegin() {
  g_link.begin(LINK_BAUD, SERIAL_8N1, LINK_RX_PIN, LINK_TX_PIN);
  g_len = 0;
}

void subghzLinkPump() {
  while (g_link.available()) {
    char c = (char)g_link.read();
    if (c == '\n' || c == '\r') {
      g_buf[g_len] = '\0';
      if (g_len > 0) parseLine(g_buf);
      g_len = 0;
    } else if (g_len < sizeof(g_buf) - 1) {
      g_buf[g_len++] = c;
    } else {
      g_len = 0;  // overflow: drop the malformed line
    }
  }
}
