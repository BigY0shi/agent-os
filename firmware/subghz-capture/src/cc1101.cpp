#include "cc1101.h"

using namespace cc1101reg;

namespace {
constexpr float XOSC_MHZ = 26.0f;   // standard CC1101 crystal
}

void CC1101::chipSelect() {
  _spi->beginTransaction(_spiSettings);
  digitalWrite(_csn, LOW);
  // The datasheet requires waiting for MISO (SO) to go low, signalling the
  // chip's crystal is stable and it is ready for the transfer.
  uint32_t start = micros();
  while (digitalRead(_miso) == HIGH) {
    if (micros() - start > 5000) break;  // fail open rather than hang forever
  }
}

void CC1101::chipDeselect() {
  digitalWrite(_csn, HIGH);
  _spi->endTransaction();
}

void CC1101::writeReg(uint8_t addr, uint8_t value) {
  chipSelect();
  _spi->transfer(addr);
  _spi->transfer(value);
  chipDeselect();
}

uint8_t CC1101::readReg(uint8_t addr) {
  chipSelect();
  _spi->transfer(addr | READ_BIT);
  uint8_t v = _spi->transfer(0x00);
  chipDeselect();
  return v;
}

uint8_t CC1101::readStatus(uint8_t addr) {
  // Status registers must be read with the burst bit set to disambiguate them
  // from the same-numbered command strobes.
  chipSelect();
  _spi->transfer(addr | READ_BIT | BURST_BIT);
  uint8_t v = _spi->transfer(0x00);
  chipDeselect();
  return v;
}

void CC1101::strobe(uint8_t cmd) {
  chipSelect();
  _spi->transfer(cmd);
  chipDeselect();
}

bool CC1101::begin(SPIClass* spi, uint8_t misoPin, uint8_t csnPin, uint8_t gdo0Pin) {
  _spi = spi;
  _miso = misoPin;
  _csn = csnPin;
  _gdo0 = gdo0Pin;

  pinMode(_csn, OUTPUT);
  digitalWrite(_csn, HIGH);
  pinMode(_gdo0, INPUT);

  // Manual reset sequence (datasheet 19.1): toggle CSn, then SRES.
  digitalWrite(_csn, LOW);
  delayMicroseconds(10);
  digitalWrite(_csn, HIGH);
  delayMicroseconds(45);
  strobe(SRES);
  delay(2);

  return present();
}

bool CC1101::present() {
  uint8_t version = readStatus(VERSION);
  // VERSION reads 0x14 (sometimes 0x04/0x17 on clones); 0x00/0xFF means no chip.
  return version != 0x00 && version != 0xFF;
}

void CC1101::setFrequencyMHz(float mhz) {
  // FREQ register = f_carrier * 2^16 / f_xosc.
  uint32_t freq = (uint32_t)((mhz * 65536.0f) / XOSC_MHZ);
  writeReg(FREQ2, (freq >> 16) & 0xFF);
  writeReg(FREQ1, (freq >> 8) & 0xFF);
  writeReg(FREQ0, freq & 0xFF);
}

void CC1101::configureOOK() {
  // ASK/OOK receive, asynchronous serial mode: GDO0 outputs the demodulated
  // bitstream, and no packet engine / sync word is used. Values are a common
  // SmartRF-derived 433.92 MHz OOK RX profile with a wide-ish RX filter; tune
  // MDMCFG3/4 (data rate + bandwidth) per the signal you are chasing.
  writeReg(IOCFG2, 0x0B);   // GDO2: serial clock (unused here)
  writeReg(IOCFG0, 0x0D);   // GDO0: asynchronous serial data output
  writeReg(FIFOTHR, 0x47);
  writeReg(PKTCTRL0, 0x30); // async serial mode, no CRC, infinite length
  writeReg(FSCTRL1, 0x06);
  writeReg(FSCTRL0, 0x00);

  setFrequencyMHz(433.92f);

  writeReg(MDMCFG4, 0x87);  // RX filter bandwidth
  writeReg(MDMCFG3, 0x93);  // data rate mantissa
  writeReg(MDMCFG2, 0x30);  // ASK/OOK, no sync word
  writeReg(MDMCFG1, 0x22);
  writeReg(MDMCFG0, 0xF8);
  writeReg(DEVIATN, 0x15);

  writeReg(MCSM0, 0x18);    // auto-calibrate when going from IDLE to RX
  writeReg(FOCCFG, 0x16);
  writeReg(WORCTRL, 0xFB);

  // AGC tuned for OOK: keep the receiver sensitive between pulses.
  writeReg(AGCCTRL2, 0x03);
  writeReg(AGCCTRL1, 0x00);
  writeReg(AGCCTRL0, 0x91);

  writeReg(FREND1, 0x56);
  writeReg(FREND0, 0x11);
  writeReg(FSCAL3, 0xE9);
  writeReg(FSCAL2, 0x2A);
  writeReg(FSCAL1, 0x00);
  writeReg(FSCAL0, 0x1F);
  writeReg(TEST2, 0x81);
  writeReg(TEST1, 0x35);
  writeReg(TEST0, 0x09);

  idle();
}

void CC1101::enterRX() {
  strobe(SRX);
}

void CC1101::idle() {
  strobe(SIDLE);
  strobe(SFRX);   // flush RX FIFO
}

int16_t CC1101::readRSSIdbm() {
  uint8_t raw = readStatus(RSSI);
  // Datasheet conversion: signed offset-binary, /2, minus ~74 dBm offset.
  int16_t dbm;
  if (raw >= 128) {
    dbm = ((int16_t)raw - 256) / 2 - 74;
  } else {
    dbm = ((int16_t)raw) / 2 - 74;
  }
  return dbm;
}
