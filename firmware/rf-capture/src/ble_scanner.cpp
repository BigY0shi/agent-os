#include "ble_scanner.h"
#include "capture_store.h"
#include "vendor_lookup.h"
#include "config.h"
#include "hexdump.h"

#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <string.h>

namespace {

// Compact, POD snapshot of one advertisement, passed from the NimBLE host task
// to the loop task via a queue. Pointers are deliberately avoided so it can be
// copied by value into the queue.
struct BleObservation {
  uint8_t  addr[6];        // display order (MSB first)
  uint8_t  addrType;       // 0 = public, 1 = random, 2/3 = identity
  int8_t   rssi;
  bool     connectable;
  bool     haveName;
  char     name[33];
  bool     haveCompany;
  uint16_t companyId;
  bool     haveAppearance;
  uint16_t appearance;
};

QueueHandle_t g_queue = nullptr;

BleAddrKind classifyAddress(uint8_t addrType, uint8_t msbOctet) {
  if (addrType == 0) return RFADDR_PUBLIC;
  if (addrType == 2) return RFADDR_PUBLIC;              // resolved identity
  // Random address: the top two bits of the MSB select the sub-type.
  switch (msbOctet >> 6) {
    case 0b11: return RFADDR_RANDOM_STATIC;
    case 0b01: return RFADDR_RANDOM_RESOLVABLE;
    case 0b00: return RFADDR_RANDOM_NONRESOLV;
    default:   return RFADDR_UNKNOWN;
  }
}

const char* platformHint(uint16_t companyId) {
  switch (companyId) {
    case 0x004C: return "Apple / iOS-macOS";
    case 0x0006: return "Microsoft / Windows";
    case 0x00E0: return "Google / Android";
    case 0x0075: return "Samsung / Android";
    default:     return nullptr;
  }
}

class ScanCallbacks : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice* dev) override {
    BleObservation obs;
    memset(&obs, 0, sizeof(obs));

    // NimBLEAddress stores bytes LSB-first; copy into display order (MSB-first).
    NimBLEAddress addr = dev->getAddress();
    const uint8_t* native = addr.getNative();
    for (int i = 0; i < 6; i++) obs.addr[i] = native[5 - i];
    obs.addrType = addr.getType();
    obs.rssi = dev->getRSSI();

    // ADV_IND (0) and ADV_DIRECT_IND (1) are the connectable advertising types.
    uint8_t advType = dev->getAdvType();
    obs.connectable = (advType == 0 || advType == 1);

    if (dev->haveName()) {
      obs.haveName = true;
      std::string n = dev->getName();
      strncpy(obs.name, n.c_str(), sizeof(obs.name) - 1);
    }

    if (dev->haveManufacturerData()) {
      std::string md = dev->getManufacturerData();
      if (md.length() >= 2) {
        obs.haveCompany = true;
        obs.companyId = (uint8_t)md[0] | ((uint8_t)md[1] << 8);
      }
#if DUMP_RAW_BYTES
      hexDump("ble-mfg", (const uint8_t*)md.data(), md.length());
#endif
    }

    if (dev->haveAppearance()) {
      obs.haveAppearance = true;
      obs.appearance = dev->getAppearance();
    }

    if (g_queue) {
      // Non-blocking: if the loop task is behind, drop the oldest observations
      // rather than stalling the BLE host task.
      xQueueSend(g_queue, &obs, 0);
    }
  }
};

ScanCallbacks g_callbacks;

}  // namespace

void bleScannerBegin() {
  g_queue = xQueueCreate(24, sizeof(BleObservation));

  NimBLEDevice::init("");
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(&g_callbacks, /*wantDuplicates=*/true);
  scan->setActiveScan(BLE_SCAN_ACTIVE);
  scan->setInterval(BLE_SCAN_INTERVAL_MS);
  scan->setWindow(BLE_SCAN_WINDOW_MS);
  scan->setMaxResults(0);            // callback-only; do not retain a results list
  scan->start(0, nullptr, false);    // 0 = scan forever
}

void bleScannerPump() {
  if (!g_queue) return;
  BleObservation obs;
  while (xQueueReceive(g_queue, &obs, 0) == pdTRUE) {
    BleAddrKind kind = classifyAddress(obs.addrType, obs.addr[0]);
    BleDevice* dev = storeAddOrUpdateBle(obs.addr, kind, obs.rssi);
    if (!dev) continue;

    dev->connectable = obs.connectable;
    if (obs.haveName && obs.name[0]) {
      strncpy(dev->name, obs.name, sizeof(dev->name) - 1);
      dev->name[sizeof(dev->name) - 1] = '\0';
    }
    if (obs.haveCompany) {
      dev->companyId = obs.companyId;
      dev->company = bleCompany(obs.companyId);
      dev->platformHint = platformHint(obs.companyId);
    }
    if (obs.haveAppearance) {
      dev->appearance = bleAppearance(obs.appearance);
    }
  }
}
