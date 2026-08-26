// ============================================================================
// display_ui.h — 1.47" TFT dashboard for Board C (Arduino_GFX)
//
// Shows live 802.15.4 scan metrics plus a compact roll-up of the other radios
// and the web-UI address. Display controller (ST7789 vs JD9853) is chosen at
// build time via DISPLAY_ST7789 / DISPLAY_JD9853.
// ============================================================================
#pragma once

#include <Arduino.h>

bool displayBegin();
void displayRender();
