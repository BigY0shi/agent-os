// ============================================================================
// spectrum.h — passive sub-GHz energy sweep using the CC1101 RSSI register
//
// Steps the CC1101 across a frequency band, reads RSSI at each step, and
// reports steps whose energy exceeds a gate. This is a pure carrier-energy
// scan; it does not demodulate packets, so it works regardless of modulation.
// ============================================================================
#pragma once

#include <Arduino.h>
#include "cc1101.h"

// Callback invoked for each above-gate step: (freq_kHz, rssi_dBm).
typedef void (*SpectrumHitFn)(long freqKhz, int rssiDbm);

// Sweep the configured band once, invoking onHit for above-gate steps and
// returning the peak (strongest) frequency seen (kHz), or 0 if none.
long spectrumSweepOnce(CC1101& radio, SpectrumHitFn onHit);
