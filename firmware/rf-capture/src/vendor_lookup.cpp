#include "vendor_lookup.h"

namespace {

struct OuiEntry {
  uint8_t prefix[3];
  const char* name;
};

// Curated subset of common consumer/vendor OUIs (IEEE MA-L assignments).
const OuiEntry kOui[] = {
  {{0x3C, 0x22, 0xFB}, "Apple"},
  {{0xF0, 0x18, 0x98}, "Apple"},
  {{0xA4, 0x83, 0xE7}, "Apple"},
  {{0xDC, 0xA6, 0x32}, "Raspberry Pi"},
  {{0xB8, 0x27, 0xEB}, "Raspberry Pi"},
  {{0xE4, 0x5F, 0x01}, "Raspberry Pi"},
  {{0x00, 0x1A, 0x11}, "Google"},
  {{0x3C, 0x5A, 0xB4}, "Google"},
  {{0xF4, 0xF5, 0xD8}, "Google"},
  {{0x50, 0x02, 0x91}, "Espressif"},
  {{0x24, 0x0A, 0xC4}, "Espressif"},
  {{0x7C, 0xDF, 0xA1}, "Espressif"},
  {{0xB4, 0xE6, 0x2D}, "Espressif"},
  {{0x34, 0xAB, 0x95}, "Samsung"},
  {{0x00, 0x12, 0xFB}, "Samsung"},
  {{0x5C, 0x0A, 0x5B}, "Samsung"},
  {{0xC8, 0x3A, 0x35}, "Tenda"},
  {{0x00, 0x0C, 0x29}, "VMware"},
  {{0x00, 0x50, 0x56}, "VMware"},
  {{0x40, 0xB0, 0x76}, "Asus"},
  {{0x2C, 0xF0, 0x5D}, "Micro-Star (MSI)"},
  {{0xD8, 0x3A, 0xDD}, "Raspberry Pi"},
  {{0x00, 0x1D, 0x0F}, "TP-Link"},
  {{0x50, 0xC7, 0xBF}, "TP-Link"},
  {{0xEC, 0x08, 0x6B}, "TP-Link"},
  {{0xF4, 0xEC, 0x38}, "TP-Link"},
  {{0x00, 0x25, 0x9C}, "Cisco-Linksys"},
  {{0xC0, 0x56, 0x27}, "Belkin"},
  {{0x18, 0xFE, 0x34}, "Espressif"},
  {{0xAC, 0xDE, 0x48}, "Private (locally administered sample)"},
};

struct CompanyEntry {
  uint16_t id;
  const char* name;
};

// Curated subset of Bluetooth SIG "Company Identifiers".
const CompanyEntry kCompany[] = {
  {0x004C, "Apple"},
  {0x0006, "Microsoft"},
  {0x00E0, "Google"},
  {0x0075, "Samsung"},
  {0x0087, "Garmin"},
  {0x000F, "Broadcom"},
  {0x0059, "Nordic Semiconductor"},
  {0x0499, "Ruuvi"},
  {0x0157, "Anhui Huami (Amazfit/Xiaomi)"},
  {0x038F, "Xiaomi"},
  {0x0157, "Huami"},
  {0x02E5, "Espressif"},
  {0x0A12, "Sony"},
  {0x0131, "Cypress"},
  {0x004F, "APT (Qualcomm aptX)"},
  {0x0110, "Fitbit"},
  {0x0171, "Amazon"},
  {0x0822, "Adafruit"},
  {0x0A0A, "Tile"},
};

struct AppearanceEntry {
  uint16_t value;
  const char* name;
};

// SIG appearance values are 16-bit; the high 10 bits are the category.
const AppearanceEntry kAppearanceCategory[] = {
  {0x00, "Unknown"},
  {0x01, "Phone"},
  {0x02, "Computer"},
  {0x03, "Watch"},
  {0x04, "Clock"},
  {0x05, "Display"},
  {0x06, "Remote Control"},
  {0x07, "Eye-glasses"},
  {0x08, "Tag"},
  {0x09, "Keyring"},
  {0x0A, "Media Player"},
  {0x0B, "Barcode Scanner"},
  {0x0C, "Thermometer"},
  {0x0D, "Heart Rate Sensor"},
  {0x0E, "Blood Pressure"},
  {0x0F, "HID (keyboard/mouse)"},
  {0x10, "Glucose Meter"},
  {0x11, "Running/Walking Sensor"},
  {0x12, "Cycling"},
  {0x21, "Pulse Oximeter"},
  {0x22, "Weight Scale"},
  {0x23, "Personal Mobility"},
  {0x25, "Insulin Pump"},
  {0x31, "Outdoor Sports"},
  {0x51, "Earbuds/Headset"},
};

}  // namespace

const char* ouiVendor(const uint8_t mac[6]) {
  for (const auto& e : kOui) {
    if (e.prefix[0] == mac[0] && e.prefix[1] == mac[1] && e.prefix[2] == mac[2]) {
      return e.name;
    }
  }
  return nullptr;
}

const char* bleCompany(uint16_t companyId) {
  for (const auto& e : kCompany) {
    if (e.id == companyId) {
      return e.name;
    }
  }
  return nullptr;
}

const char* bleAppearance(uint16_t appearance) {
  uint16_t category = appearance >> 6;  // top 10 bits
  for (const auto& e : kAppearanceCategory) {
    if (e.value == category) {
      return e.name;
    }
  }
  return "Unknown";
}
