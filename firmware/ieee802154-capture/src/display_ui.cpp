#include "display_ui.h"
#include "config.h"
#include "capture154.h"
#include "uplink.h"
#include "web_ui.h"

#include <Arduino_GFX_Library.h>

// This Arduino_GFX version prefixes its colour macros with RGB565_.
#define BLACK    RGB565_BLACK
#define WHITE    RGB565_WHITE
#define CYAN     RGB565_CYAN
#define GREEN    RGB565_GREEN
#define YELLOW   RGB565_YELLOW
#define ORANGE   RGB565_ORANGE
#define DARKGREY RGB565_DARKGREY

namespace {

Arduino_DataBus* g_bus = new Arduino_ESP32SPI(
    TFT_DC_PIN, TFT_CS_PIN, TFT_SCLK_PIN, TFT_MOSI_PIN, GFX_NOT_DEFINED);

// The non-touch board uses a true ST7789. The touch board's JD9853 controller
// has no dedicated driver in Arduino_GFX, but this 172x320 panel is ST7789-init
// compatible (the same trick the ESPHome/Home-Assistant community uses); the
// only difference is that the JD9853 needs its colours inverted (see begin()).
Arduino_GFX* g_gfx = new Arduino_ST7789(
    g_bus, TFT_RST_PIN, 0 /*rotation*/, true /*IPS*/,
    TFT_WIDTH, TFT_HEIGHT, TFT_COL_OFFSET, TFT_ROW_OFFSET);

bool g_ready = false;

void line(int16_t y, uint16_t color, const char* text) {
  g_gfx->setTextColor(color);
  g_gfx->setCursor(4, y);
  g_gfx->print(text);
}

}  // namespace

bool displayBegin() {
  pinMode(TFT_BL_PIN, OUTPUT);
  digitalWrite(TFT_BL_PIN, HIGH);      // backlight on
  if (!g_gfx->begin()) {
    g_ready = false;
    return false;
  }
  g_ready = true;
#if defined(DISPLAY_JD9853)
  g_gfx->invertDisplay(true);   // touch-panel JD9853 needs inverted colours
#endif
  g_gfx->fillScreen(BLACK);
  g_gfx->setTextSize(2);
  line(8, CYAN, "RF Rig");
  g_gfx->setTextSize(1);
  line(34, WHITE, "802.15.4 capture");
  return true;
}

void displayRender() {
  if (!g_ready) return;

  Stats154 st = ieee154Stats();
  UpstreamState up = uplinkState();
  char buf[40];

  g_gfx->fillScreen(BLACK);
  g_gfx->setTextSize(2);
  line(6, CYAN, "RF Rig");

  g_gfx->setTextSize(1);
  snprintf(buf, sizeof(buf), "802.15.4  ch %u %s", ieee154Channel(),
           ieee154AutoHop() ? "hop" : "LOCK");
  line(30, WHITE, buf);

  snprintf(buf, sizeof(buf), "frames %lu  pans %u",
           (unsigned long)st.total, ieee154PanCount());
  line(44, GREEN, buf);
  snprintf(buf, sizeof(buf), "b%lu d%lu a%lu c%lu",
           (unsigned long)st.beacons, (unsigned long)st.data,
           (unsigned long)st.acks, (unsigned long)st.cmds);
  line(56, WHITE, buf);

  // Top PANs (up to 5)
  int16_t y = 74;
  uint16_t n = ieee154PanCount();
  if (n > 5) n = 5;
  for (uint16_t i = 0; i < n; i++) {
    const Pan154* p = ieee154PanAt(i);
    if (!p) break;
    snprintf(buf, sizeof(buf), "0x%04X c%u %ddBm f%lu", p->panId, p->channel,
             p->rssi, (unsigned long)p->frames);
    line(y, YELLOW, buf);
    y += 12;
  }
  if (n == 0) { line(y, DARKGREY, "(scanning...)"); y += 12; }

  // Board A / B roll-up
  y += 6;
  g_gfx->drawFastHLine(0, y, TFT_WIDTH, DARKGREY);
  y += 6;
  bool aUp = up.seen && (millis() - up.lastMs) < LINK_STALE_MS;
  line(y, aUp ? GREEN : DARKGREY, aUp ? "Board A: UP" : "Board A: --");
  y += 12;
  if (up.seen) {
    snprintf(buf, sizeof(buf), "WiFi ch%u AP%u ST%u", up.wifiChannel, up.aps,
             up.stations);
    line(y, WHITE, buf); y += 12;
    snprintf(buf, sizeof(buf), "BLE%u probe%lu", up.ble,
             (unsigned long)up.probes);
    line(y, WHITE, buf); y += 12;
    snprintf(buf, sizeof(buf), "leaks %lu", (unsigned long)up.leaks);
    line(y, up.leaks ? ORANGE : WHITE, buf); y += 12;
    snprintf(buf, sizeof(buf), "SubG %s %ldkHz",
             up.subghzAlive ? "up" : "--", up.subghzPeakKhz);
    line(y, WHITE, buf); y += 12;
  }

  // Web address footer
  y = TFT_HEIGHT - 26;
  g_gfx->drawFastHLine(0, y, TFT_WIDTH, DARKGREY);
  y += 4;
  snprintf(buf, sizeof(buf), "AP:%s", webSsid());
  line(y, CYAN, buf); y += 12;
  snprintf(buf, sizeof(buf), "http://%s", webIp());
  line(y, CYAN, buf);
}
