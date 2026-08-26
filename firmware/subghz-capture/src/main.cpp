// ============================================================================
// Sub-GHz Capture Unit (Board B of the dual-ESP rig) — main
//
// Drives a CC1101 as a passive sub-GHz listener: it sweeps the 433 MHz ISM band
// for carrier energy, then dwells on a listen frequency capturing raw OOK
// bursts. Findings are printed to USB serial and streamed over a one-way UART
// link to Board A (the 2.4 GHz unit), which aggregates and displays them.
//
// Receive-only: the CC1101 TX strobe is never issued.
// ============================================================================
#include <Arduino.h>
#include <SPI.h>

#include "config.h"
#include "link_proto.h"
#include "cc1101.h"
#include "spectrum.h"
#include "ook_capture.h"

namespace {

CC1101 g_radio;
HardwareSerial g_link(LINK_UART_NUM);

enum Phase { PHASE_SWEEP, PHASE_LISTEN };
Phase    g_phase = PHASE_SWEEP;
uint32_t g_phaseStart = 0;
uint32_t g_lastBeatMs = 0;

// Best above-gate step seen during the current sweep phase.
long g_sweepBestKhz = 0;
int  g_sweepBestRssi = -127;

void emit(const char* line) {
  Serial.println(line);   // USB serial (local debugging)
  g_link.println(line);   // UART link to Board A
}

void onSweepHit(long freqKhz, int rssiDbm) {
  if (rssiDbm > g_sweepBestRssi) {
    g_sweepBestRssi = rssiDbm;
    g_sweepBestKhz = freqKhz;
  }
}

void enterSweepPhase(uint32_t now) {
  g_phase = PHASE_SWEEP;
  g_phaseStart = now;
  g_sweepBestKhz = 0;
  g_sweepBestRssi = -127;
}

void enterListenPhase(uint32_t now) {
  g_phase = PHASE_LISTEN;
  g_phaseStart = now;
  g_radio.idle();
  g_radio.setFrequencyMHz(LISTEN_FREQ_MHZ);
  g_radio.enterRX();
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("Sub-GHz Capture Unit (Board B, receive-only)");

  g_link.begin(LINK_BAUD, SERIAL_8N1, LINK_RX_PIN, LINK_TX_PIN);

  // The CC1101 shares the SPI bus; we drive chip-select manually (SS = -1).
  SPI.begin(CC1101_SCK_PIN, CC1101_MISO_PIN, CC1101_MOSI_PIN, -1);

  if (!g_radio.begin(&SPI, CC1101_MISO_PIN, CC1101_CSN_PIN, CC1101_GDO0_PIN)) {
    Serial.println("ERROR: CC1101 not detected (check wiring/power).");
    // Keep running so the link heartbeat still shows the board is alive.
  } else {
    Serial.printf("CC1101 VERSION=0x%02X PARTNUM=0x%02X\n",
                  g_radio.readStatus(cc1101reg::VERSION),
                  g_radio.readStatus(cc1101reg::PARTNUM));
  }

  g_radio.configureOOK();
  ookBegin(CC1101_GDO0_PIN);

  enterSweepPhase(millis());
  g_lastBeatMs = millis();
  Serial.println("Capture started.");
}

void loop() {
  uint32_t now = millis();

  if (g_phase == PHASE_SWEEP) {
    // Run energy sweeps back-to-back for the whole sweep phase.
    spectrumSweepOnce(g_radio, onSweepHit);

    if (now - g_phaseStart >= SWEEP_PHASE_MS) {
      if (g_sweepBestKhz != 0) {
        char line[48];
        snprintf(line, sizeof(line), "E,%ld,%d", g_sweepBestKhz, g_sweepBestRssi);
        emit(line);
      }
      enterListenPhase(now);
    }
  } else {  // PHASE_LISTEN
    OokBurst burst;
    while (ookGetBurst(&burst)) {
      int rssi = g_radio.readRSSIdbm();
      char line[72];
      snprintf(line, sizeof(line), "O,%ld,%d,%u,%lu,%lu",
               (long)(LISTEN_FREQ_MHZ * 1000.0f), rssi,
               burst.pulses, (unsigned long)burst.shortestUs,
               (unsigned long)burst.durationUs);
      emit(line);
    }

    if (now - g_phaseStart >= LISTEN_PHASE_MS) {
      enterSweepPhase(now);
    }
  }

  // Link heartbeat so Board A can tell the daughterboard is connected.
  if (now - g_lastBeatMs >= 3000) {
    g_lastBeatMs = now;
    char line[24];
    snprintf(line, sizeof(line), "H,%lu", (unsigned long)(now / 1000));
    emit(line);
  }

  delay(1);
}
