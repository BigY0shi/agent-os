// ============================================================================
// vendor_lookup.h — small, offline lookup tables for attribution/decoding
//
// These are intentionally short, curated subsets (not the full IEEE OUI or
// Bluetooth SIG registries, which are megabytes). They cover the vendors most
// commonly seen in a lab and are enough to demonstrate byte-level attribution.
// ============================================================================
#pragma once

#include <Arduino.h>

// Look up a MAC OUI (first 3 bytes) -> vendor name. Returns nullptr if unknown.
const char* ouiVendor(const uint8_t mac[6]);

// Look up a BLE company identifier (little-endian 16-bit as advertised)
// -> company name. Returns nullptr if unknown.
const char* bleCompany(uint16_t companyId);

// Human-readable BLE "appearance" category (from the SIG appearance value).
const char* bleAppearance(uint16_t appearance);
