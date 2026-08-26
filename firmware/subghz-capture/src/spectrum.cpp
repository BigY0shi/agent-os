#include "spectrum.h"
#include "config.h"

long spectrumSweepOnce(CC1101& radio, SpectrumHitFn onHit) {
  long peakFreq = 0;
  int peakRssi = -127;

  for (long khz = SWEEP_START_KHZ; khz <= SWEEP_STOP_KHZ; khz += SWEEP_STEP_KHZ) {
    radio.idle();
    radio.setFrequencyMHz(khz / 1000.0f);
    radio.enterRX();
    delayMicroseconds(SWEEP_DWELL_US);   // let AGC/RSSI settle at the new freq

    int rssi = radio.readRSSIdbm();
    if (rssi > peakRssi) {
      peakRssi = rssi;
      peakFreq = khz;
    }
    if (rssi >= SWEEP_RSSI_GATE && onHit) {
      onHit(khz, rssi);
    }
  }
  return peakFreq;
}
