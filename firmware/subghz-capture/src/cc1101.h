// ============================================================================
// cc1101.h — minimal, dependency-free CC1101 sub-GHz transceiver driver
//
// Only the receive-side features this project needs are implemented: reset,
// register/strobe access, frequency programming, an ASK/OOK RX configuration,
// RSSI readout, and async raw-data RX (GDO0 carries the demodulated bitstream).
//
// This driver is RX-only in practice — we never call the TX strobe. The board
// is a passive sub-GHz listener.
// ============================================================================
#pragma once

#include <Arduino.h>
#include <SPI.h>

class CC1101 {
 public:
  // Pins: SPI (miso needed explicitly for the chip-ready poll) plus chip-select
  // and GDO0 (async data / packet IRQ).
  bool begin(SPIClass* spi, uint8_t misoPin, uint8_t csnPin, uint8_t gdo0Pin);

  // True if the VERSION/PARTNUM status registers look like a real CC1101.
  bool present();

  // Program the carrier frequency (MHz). Valid sub-GHz ranges only
  // (300-348, 387-464, 779-928). Recalibrates on the next RX entry.
  void setFrequencyMHz(float mhz);

  // Load the ASK/OOK, async-serial RX register configuration.
  void configureOOK();

  // Enter/leave RX. idle() also flushes the RX FIFO.
  void enterRX();
  void idle();

  // Current RSSI in dBm (valid once RX has settled).
  int16_t readRSSIdbm();

  // Raw register / strobe access (exposed for the scanner and diagnostics).
  void    writeReg(uint8_t addr, uint8_t value);
  uint8_t readReg(uint8_t addr);
  uint8_t readStatus(uint8_t addr);
  void    strobe(uint8_t cmd);

  uint8_t gdo0Pin() const { return _gdo0; }

 private:
  void chipSelect();
  void chipDeselect();

  SPIClass* _spi = nullptr;
  uint8_t _miso = 0;
  uint8_t _csn = 0;
  uint8_t _gdo0 = 0;
  SPISettings _spiSettings{4000000, MSBFIRST, SPI_MODE0};
};

// ---- CC1101 register / strobe / status addresses (from the TI datasheet) ----
namespace cc1101reg {
enum : uint8_t {
  IOCFG2 = 0x00, IOCFG0 = 0x02, FIFOTHR = 0x03,
  SYNC1 = 0x04, SYNC0 = 0x05, PKTLEN = 0x06, PKTCTRL1 = 0x07, PKTCTRL0 = 0x08,
  FSCTRL1 = 0x0B, FSCTRL0 = 0x0C,
  FREQ2 = 0x0D, FREQ1 = 0x0E, FREQ0 = 0x0F,
  MDMCFG4 = 0x10, MDMCFG3 = 0x11, MDMCFG2 = 0x12, MDMCFG1 = 0x13, MDMCFG0 = 0x14,
  DEVIATN = 0x15, MCSM1 = 0x17, MCSM0 = 0x18,
  FOCCFG = 0x19, BSCFG = 0x1A,
  AGCCTRL2 = 0x1B, AGCCTRL1 = 0x1C, AGCCTRL0 = 0x1D,
  WORCTRL = 0x20, FREND1 = 0x21, FREND0 = 0x22,
  FSCAL3 = 0x23, FSCAL2 = 0x24, FSCAL1 = 0x25, FSCAL0 = 0x26,
  TEST2 = 0x2C, TEST1 = 0x2D, TEST0 = 0x2E,
  // Command strobes
  SRES = 0x30, SCAL = 0x33, SRX = 0x34, SIDLE = 0x36, SFRX = 0x3A, SNOP = 0x3D,
  // Status registers (read with the burst bit set)
  PARTNUM = 0x30, VERSION = 0x31, RSSI = 0x34, MARCSTATE = 0x35,
  PATABLE = 0x3E, FIFO = 0x3F,
};
constexpr uint8_t READ_BIT = 0x80;
constexpr uint8_t BURST_BIT = 0x40;
}  // namespace cc1101reg
