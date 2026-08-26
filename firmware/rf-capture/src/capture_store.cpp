#include "capture_store.h"
#include "vendor_lookup.h"
#include <string.h>

namespace {

WifiAp       g_aps[MAX_WIFI_APS];
WifiStation  g_stations[MAX_WIFI_STATIONS];
BleDevice    g_ble[MAX_BLE_DEVICES];
CaptureStats g_stats;
SubGhzState  g_subghz;

// The WiFi promiscuous callback runs in the WiFi driver task, so table writes
// touched from there are wrapped in this portMUX critical section.
portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;

bool macEq(const uint8_t* a, const uint8_t* b) { return memcmp(a, b, 6) == 0; }

// Copy an SSID field (not NUL-terminated on the wire, max 32 bytes) into a
// fixed buffer, sanitising non-printable bytes so the OLED/serial stay sane.
void copySsid(char* dst, const char* src, uint8_t len) {
  if (len > 32) len = 32;
  for (uint8_t i = 0; i < len; i++) {
    uint8_t c = (uint8_t)src[i];
    dst[i] = (c >= 0x20 && c < 0x7F) ? (char)c : '.';
  }
  dst[len] = '\0';
}

}  // namespace

// Per-record key accessors, overloaded so findOrAcquire() can read the MAC/addr
// of any table entry without each record needing a shared base class.
static const uint8_t* mac_of(const WifiAp& e)      { return e.bssid; }
static const uint8_t* mac_of(const WifiStation& e) { return e.mac; }
static const uint8_t* mac_of(const BleDevice& e)   { return e.addr; }

// Find a used slot whose key matches, else the best slot to (re)use: first free
// slot, else the least-recently-seen entry (LRU eviction).
template <typename T, const uint8_t* (*KeyFn)(const T&)>
static T* findOrAcquire(T* table, uint16_t count, const uint8_t* key) {
  T* freeSlot = nullptr;
  T* lru = nullptr;
  for (uint16_t i = 0; i < count; i++) {
    T& e = table[i];
    if (e.used && memcmp(KeyFn(e), key, 6) == 0) return &e;
    if (!e.used && !freeSlot) freeSlot = &e;
    if (e.used && (!lru || e.lastSeenMs < lru->lastSeenMs)) lru = &e;
  }
  return freeSlot ? freeSlot : lru;
}

void storeInit() {
  memset(g_aps, 0, sizeof(g_aps));
  memset(g_stations, 0, sizeof(g_stations));
  memset(g_ble, 0, sizeof(g_ble));
  memset(&g_stats, 0, sizeof(g_stats));
  memset(&g_subghz, 0, sizeof(g_subghz));
}

void storeAddOrUpdateAp(const uint8_t bssid[6], const char* ssid, uint8_t ssidLen,
                        uint8_t channel, int8_t rssi, bool privacy) {
  portENTER_CRITICAL(&g_mux);
  g_stats.wifiFrames++;
  g_stats.wifiBeacons++;
  WifiAp* ap = findOrAcquire<WifiAp, mac_of>(g_aps, MAX_WIFI_APS, bssid);
  if (ap) {
    bool isNew = !ap->used || !macEq(ap->bssid, bssid);
    if (isNew) {
      memset(ap, 0, sizeof(*ap));
      memcpy(ap->bssid, bssid, 6);
    }
    copySsid(ap->ssid, ssid, ssidLen);
    ap->channel = channel;
    ap->rssi = rssi;
    ap->privacy = privacy;
    ap->beacons++;
    ap->lastSeenMs = millis();
    ap->used = true;
  }
  portEXIT_CRITICAL(&g_mux);
}

void storeAddOrUpdateStation(const uint8_t mac[6], const char* probedSsid,
                             uint8_t ssidLen, int8_t rssi) {
  portENTER_CRITICAL(&g_mux);
  g_stats.wifiFrames++;
  g_stats.wifiProbeReqs++;
  WifiStation* st = findOrAcquire<WifiStation, mac_of>(g_stations, MAX_WIFI_STATIONS, mac);
  if (st) {
    bool isNew = !st->used || !macEq(st->mac, mac);
    if (isNew) {
      memset(st, 0, sizeof(*st));
      memcpy(st->mac, mac, 6);
    }
    // A directed probe (non-empty SSID) reveals a remembered network -> leak.
    if (ssidLen > 0) {
      copySsid(st->probedSsid, probedSsid, ssidLen);
      g_stats.privacyLeaks++;
    }
    // Locally-administered bit (bit 1 of the first octet) => randomized MAC.
    st->randomizedMac = (mac[0] & 0x02) != 0;
    st->rssi = rssi;
    st->probes++;
    st->lastSeenMs = millis();
    st->used = true;
  }
  portEXIT_CRITICAL(&g_mux);
}

BleDevice* storeAddOrUpdateBle(const uint8_t addr[6], BleAddrKind kind, int8_t rssi) {
  // Called from the loop task only; no critical section needed for the BLE
  // table, but stats are shared with the WiFi callback so guard those.
  BleDevice* dev = findOrAcquire<BleDevice, mac_of>(g_ble, MAX_BLE_DEVICES, addr);
  if (!dev) return nullptr;
  bool isNew = !dev->used || !macEq(dev->addr, addr);
  if (isNew) {
    memset(dev, 0, sizeof(*dev));
    memcpy(dev->addr, addr, 6);
    dev->companyId = 0xFFFF;
    // Public and static-random addresses are stable identifiers => trackable.
    if (kind == RFADDR_PUBLIC || kind == RFADDR_RANDOM_STATIC) {
      portENTER_CRITICAL(&g_mux);
      g_stats.privacyLeaks++;
      portEXIT_CRITICAL(&g_mux);
    }
  }
  dev->addrKind = kind;
  dev->rssi = rssi;
  dev->adverts++;
  dev->lastSeenMs = millis();
  dev->used = true;
  portENTER_CRITICAL(&g_mux);
  g_stats.bleAdverts++;
  portEXIT_CRITICAL(&g_mux);
  return dev;
}

template <typename T>
static void expireTable(T* table, uint16_t count, uint32_t nowMs) {
  for (uint16_t i = 0; i < count; i++) {
    if (table[i].used && (nowMs - table[i].lastSeenMs) > DEVICE_EXPIRY_MS) {
      table[i].used = false;
    }
  }
}

void storeExpireStale(uint32_t nowMs) {
  portENTER_CRITICAL(&g_mux);
  expireTable(g_aps, MAX_WIFI_APS, nowMs);
  expireTable(g_stations, MAX_WIFI_STATIONS, nowMs);
  portEXIT_CRITICAL(&g_mux);
  expireTable(g_ble, MAX_BLE_DEVICES, nowMs);
}

CaptureStats storeStats() {
  portENTER_CRITICAL(&g_mux);
  CaptureStats s = g_stats;
  portEXIT_CRITICAL(&g_mux);
  return s;
}

static uint16_t countUsed(const void* table, uint16_t count, size_t stride,
                          size_t usedOffset) {
  uint16_t n = 0;
  const uint8_t* base = (const uint8_t*)table;
  for (uint16_t i = 0; i < count; i++) {
    if (*(const bool*)(base + i * stride + usedOffset)) n++;
  }
  return n;
}

uint16_t storeApCount() {
  return countUsed(g_aps, MAX_WIFI_APS, sizeof(WifiAp), offsetof(WifiAp, used));
}
uint16_t storeStationCount() {
  return countUsed(g_stations, MAX_WIFI_STATIONS, sizeof(WifiStation), offsetof(WifiStation, used));
}
uint16_t storeBleCount() {
  return countUsed(g_ble, MAX_BLE_DEVICES, sizeof(BleDevice), offsetof(BleDevice, used));
}

template <typename T>
static const T* nthUsed(const T* table, uint16_t count, uint16_t visibleIndex) {
  uint16_t seen = 0;
  for (uint16_t i = 0; i < count; i++) {
    if (table[i].used) {
      if (seen == visibleIndex) return &table[i];
      seen++;
    }
  }
  return nullptr;
}

const WifiAp*      storeApAt(uint16_t i)      { return nthUsed(g_aps, MAX_WIFI_APS, i); }
const WifiStation* storeStationAt(uint16_t i) { return nthUsed(g_stations, MAX_WIFI_STATIONS, i); }
const BleDevice*   storeBleAt(uint16_t i)     { return nthUsed(g_ble, MAX_BLE_DEVICES, i); }

// ---- sub-GHz link ingest (loop task only; no cross-task access) ------------
void storeSubghzEnergy(long freqKhz, int rssiDbm) {
  g_subghz.linkSeen = true;
  g_subghz.lastLinkMs = millis();
  g_subghz.lastEnergyKhz = freqKhz;
  g_subghz.lastEnergyRssi = rssiDbm;
  g_subghz.energyHits++;
}

void storeSubghzOok(long freqKhz, int rssiDbm, uint16_t pulses,
                    uint32_t shortestUs, uint32_t durationUs) {
  g_subghz.linkSeen = true;
  g_subghz.lastLinkMs = millis();
  g_subghz.ookFreqKhz = freqKhz;
  g_subghz.ookRssi = rssiDbm;
  g_subghz.ookPulses = pulses;
  g_subghz.ookShortestUs = shortestUs;
  g_subghz.ookDurationUs = durationUs;
  g_subghz.ookBursts++;
}

void storeSubghzHeartbeat() {
  g_subghz.linkSeen = true;
  g_subghz.lastLinkMs = millis();
}

SubGhzState storeSubghz() { return g_subghz; }
