// ============================================================================
// ble_scanner.h — receive-only BLE capture via NimBLE active scanning
//
// Runs a continuous active scan (requests scan responses to recover full device
// names). The scan callback runs in the NimBLE host task, so it only pushes a
// compact observation onto a queue; bleScannerPump() drains that queue from the
// loop task and updates the shared store. It never connects to any device.
// ============================================================================
#pragma once

#include <Arduino.h>

void bleScannerBegin();

// Drain queued advertisements into the store. Call from loop().
void bleScannerPump();
