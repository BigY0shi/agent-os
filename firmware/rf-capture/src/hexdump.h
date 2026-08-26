// ============================================================================
// hexdump.h — byte-level dump of a captured frame/advertisement to serial
//
// Prints a classic offset / hex / ASCII layout so students can correlate the
// parsed fields with the raw bytes on the wire.
// ============================================================================
#pragma once

#include <Arduino.h>

inline void hexDump(const char* label, const uint8_t* data, int len) {
  Serial.printf("--- %s (%d bytes) ---\n", label, len);
  for (int off = 0; off < len; off += 16) {
    Serial.printf("%04x  ", off);
    for (int i = 0; i < 16; i++) {
      if (off + i < len) Serial.printf("%02x ", data[off + i]);
      else Serial.print("   ");
    }
    Serial.print(" |");
    for (int i = 0; i < 16 && off + i < len; i++) {
      uint8_t c = data[off + i];
      Serial.print((c >= 0x20 && c < 0x7F) ? (char)c : '.');
    }
    Serial.println("|");
  }
}
