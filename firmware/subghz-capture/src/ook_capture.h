// ============================================================================
// ook_capture.h — raw OOK burst capture from the CC1101 async data pin
//
// With the CC1101 in ASK/OOK async mode, GDO0 toggles with the demodulated
// on/off keying. We timestamp every edge in an interrupt, then group edges into
// "bursts" (transmissions) separated by silence, and summarise each burst:
// edge count, shortest pulse, and total duration. That is enough to recognise
// and fingerprint 433 MHz remotes/sensors without a per-protocol decoder.
// ============================================================================
#pragma once

#include <Arduino.h>

struct OokBurst {
  uint16_t pulses;      // number of edges in the burst
  uint32_t shortestUs;  // shortest pulse width (approx. base symbol time)
  uint32_t durationUs;  // first edge to last edge
};

// Attach the edge-timing interrupt to the GDO0 pin.
void ookBegin(uint8_t gdo0Pin);

// Drain captured edges and, if a completed burst is ready, fill *out and
// return true. Call repeatedly from loop().
bool ookGetBurst(OokBurst* out);
