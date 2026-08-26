#include "display_ui.h"
#include "capture_store.h"
#include "vendor_lookup.h"
#include "config.h"

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

namespace {

Adafruit_SSD1306 g_display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);
bool    g_ready = false;
UiView  g_view = VIEW_SUMMARY;

const char* addrKindShort(BleAddrKind k) {
  switch (k) {
    case RFADDR_PUBLIC:            return "pub";
    case RFADDR_RANDOM_STATIC:     return "sta";
    case RFADDR_RANDOM_RESOLVABLE: return "rpa";
    case RFADDR_RANDOM_NONRESOLV:  return "nrp";
    default:                       return "?";
  }
}

void header(const char* title) {
  g_display.clearDisplay();
  g_display.setTextSize(1);
  g_display.setTextColor(SSD1306_WHITE);
  g_display.setCursor(0, 0);
  g_display.println(title);
  g_display.drawFastHLine(0, 9, OLED_WIDTH, SSD1306_WHITE);
  g_display.setCursor(0, 12);
}

void renderSummary(uint8_t wifiChannel) {
  CaptureStats s = storeStats();
  header("Passive RF Capture");
  g_display.printf("WiFi ch:%-2u APs:%u\n", wifiChannel, storeApCount());
  g_display.printf("Stations:%u\n", storeStationCount());
  g_display.printf("BLE devices:%u\n", storeBleCount());
  g_display.printf("Probes:%lu\n", (unsigned long)s.wifiProbeReqs);
  g_display.printf("Leaks:%lu", (unsigned long)s.privacyLeaks);
}

void renderWifiAps() {
  header("WiFi APs");
  uint16_t n = storeApCount();
  uint16_t shown = n < 5 ? n : 5;
  for (uint16_t i = 0; i < shown; i++) {
    const WifiAp* ap = storeApAt(i);
    if (!ap) break;
    const char* ssid = ap->ssid[0] ? ap->ssid : "<hidden>";
    g_display.printf("%c%.13s c%u\n", ap->privacy ? '*' : ' ', ssid, ap->channel);
  }
  if (n == 0) g_display.println("(listening...)");
}

void renderWifiLeaks() {
  header("Probe leaks");
  uint16_t n = storeStationCount();
  uint16_t shown = n < 5 ? n : 5;
  uint16_t drawn = 0;
  for (uint16_t i = 0; i < n && drawn < shown; i++) {
    const WifiStation* st = storeStationAt(i);
    if (!st) break;
    if (!st->probedSsid[0]) continue;   // only show devices leaking a network
    g_display.printf("%c %.15s\n", st->randomizedMac ? '~' : '!', st->probedSsid);
    drawn++;
  }
  if (drawn == 0) g_display.println("(no directed probes)");
}

void renderBle() {
  header("BLE devices");
  uint16_t n = storeBleCount();
  uint16_t shown = n < 5 ? n : 5;
  for (uint16_t i = 0; i < shown; i++) {
    const BleDevice* d = storeBleAt(i);
    if (!d) break;
    const char* label = d->name[0] ? d->name
                      : (d->company ? d->company : "(unknown)");
    g_display.printf("%s %.11s\n", addrKindShort(d->addrKind), label);
  }
  if (n == 0) g_display.println("(scanning...)");
}

}  // namespace

bool displayBegin() {
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  if (!g_display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    g_ready = false;
    return false;
  }
  g_ready = true;
  g_display.clearDisplay();
  g_display.setTextSize(1);
  g_display.setTextColor(SSD1306_WHITE);
  g_display.setCursor(0, 0);
  g_display.println("Passive RF Capture");
  g_display.println("receive-only");
  g_display.display();
  return true;
}

void displayNextView() {
  g_view = (UiView)((g_view + 1) % VIEW_COUNT);
}

void displayRender(uint8_t wifiChannel) {
  if (!g_ready) return;
  switch (g_view) {
    case VIEW_SUMMARY:     renderSummary(wifiChannel); break;
    case VIEW_WIFI_APS:    renderWifiAps(); break;
    case VIEW_WIFI_LEAKS:  renderWifiLeaks(); break;
    case VIEW_BLE:         renderBle(); break;
    default: break;
  }
  g_display.display();
}
