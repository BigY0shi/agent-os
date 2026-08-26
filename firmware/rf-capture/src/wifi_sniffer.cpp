#include "wifi_sniffer.h"
#include "capture_store.h"
#include "config.h"
#include "hexdump.h"

#include "esp_wifi.h"
#include "esp_event.h"
#include "nvs_flash.h"

namespace {

uint8_t  g_channel = WIFI_CHANNEL_MIN;
uint32_t g_lastHopMs = 0;

// 802.11 MAC header (management frames). Packed to match the on-air layout.
struct __attribute__((packed)) Dot11MgmtHeader {
  uint8_t  frameControl[2];
  uint16_t duration;
  uint8_t  addr1[6];   // receiver / destination
  uint8_t  addr2[6];   // transmitter / source (station for probe req)
  uint8_t  addr3[6];   // BSSID
  uint16_t seqCtrl;
};

enum : uint8_t {
  SUBTYPE_ASSOC_REQ    = 0x0,
  SUBTYPE_PROBE_REQ    = 0x4,
  SUBTYPE_PROBE_RESP   = 0x5,
  SUBTYPE_BEACON       = 0x8,
};

// Walk tagged parameters (Information Elements) looking for the SSID (tag 0).
// Writes the SSID pointer/length via out params; returns false if none found.
bool findSsid(const uint8_t* ies, int len, const char** ssidOut, uint8_t* ssidLen) {
  int i = 0;
  while (i + 2 <= len) {
    uint8_t tag = ies[i];
    uint8_t tagLen = ies[i + 1];
    if (i + 2 + tagLen > len) break;
    if (tag == 0) {  // SSID element
      *ssidOut = (const char*)&ies[i + 2];
      *ssidLen = tagLen;
      return true;
    }
    i += 2 + tagLen;
  }
  return false;
}

void handleBeaconOrProbeResp(const Dot11MgmtHeader* h, const uint8_t* body,
                             int bodyLen, int8_t rssi) {
  // Fixed params for beacon/probe-resp: timestamp(8) + interval(2) + caps(2).
  if (bodyLen < 12) return;
  uint16_t caps = body[10] | (body[11] << 8);
  bool privacy = (caps & 0x0010) != 0;   // Privacy subfield => encrypted BSS

  const char* ssid = "";
  uint8_t ssidLen = 0;
  findSsid(body + 12, bodyLen - 12, &ssid, &ssidLen);

  storeAddOrUpdateAp(h->addr3, ssid, ssidLen, g_channel, rssi, privacy);
}

void handleProbeReq(const Dot11MgmtHeader* h, const uint8_t* body, int bodyLen,
                    int8_t rssi) {
  // Probe request body is just tagged params; SSID may be empty (wildcard) or
  // a specific remembered network (directed probe -> PNL leak).
  const char* ssid = "";
  uint8_t ssidLen = 0;
  findSsid(body, bodyLen, &ssid, &ssidLen);
  storeAddOrUpdateStation(h->addr2, ssid, ssidLen, rssi);
}

void promiscuousCb(void* buf, wifi_promiscuous_pkt_type_t type) {
  if (type != WIFI_PKT_MGMT) return;
  const wifi_promiscuous_pkt_t* pkt = (const wifi_promiscuous_pkt_t*)buf;
  const int len = pkt->rx_ctrl.sig_len;
  if (len < (int)sizeof(Dot11MgmtHeader)) return;

  const Dot11MgmtHeader* h = (const Dot11MgmtHeader*)pkt->payload;
  const uint8_t fc0 = h->frameControl[0];
  const uint8_t frameType = (fc0 >> 2) & 0x3;   // 0 = management
  const uint8_t subtype = (fc0 >> 4) & 0xF;
  if (frameType != 0) return;

  const uint8_t* body = pkt->payload + sizeof(Dot11MgmtHeader);
  const int bodyLen = len - sizeof(Dot11MgmtHeader) - 4;  // minus trailing FCS
  if (bodyLen < 0) return;
  const int8_t rssi = pkt->rx_ctrl.rssi;

#if DUMP_RAW_BYTES
  hexDump("wifi-mgmt", pkt->payload, len);
#endif

  switch (subtype) {
    case SUBTYPE_BEACON:
    case SUBTYPE_PROBE_RESP:
      handleBeaconOrProbeResp(h, body, bodyLen, rssi);
      break;
    case SUBTYPE_PROBE_REQ:
      handleProbeReq(h, body, bodyLen, rssi);
      break;
    default:
      break;
  }
}

}  // namespace

void wifiSnifferBegin() {
  // esp_wifi needs NVS; the Arduino core usually inits it, but make sure.
  esp_err_t nvs = nvs_flash_init();
  if (nvs == ESP_ERR_NVS_NO_FREE_PAGES || nvs == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    nvs_flash_erase();
    nvs_flash_init();
  }

  wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
  esp_wifi_init(&cfg);
  esp_wifi_set_storage(WIFI_STORAGE_RAM);
  esp_wifi_set_mode(WIFI_MODE_NULL);   // no STA/AP: we only listen
  esp_wifi_start();

  // Capture management frames only — beacons, probe requests/responses, assoc.
  wifi_promiscuous_filter_t filter = {};
  filter.filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT;
  esp_wifi_set_promiscuous_filter(&filter);
  esp_wifi_set_promiscuous_rx_cb(&promiscuousCb);
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(g_channel, WIFI_SECOND_CHAN_NONE);
  g_lastHopMs = millis();
}

void wifiSnifferHop(uint32_t nowMs) {
  if (nowMs - g_lastHopMs < CHANNEL_DWELL_MS) return;
  g_lastHopMs = nowMs;
  g_channel++;
  if (g_channel > WIFI_CHANNEL_MAX) g_channel = WIFI_CHANNEL_MIN;
  esp_wifi_set_channel(g_channel, WIFI_SECOND_CHAN_NONE);
}

uint8_t wifiSnifferChannel() { return g_channel; }
