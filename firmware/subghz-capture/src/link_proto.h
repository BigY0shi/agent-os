// ============================================================================
// link_proto.h — one-way UART link format (daughter -> main board)
//
// Board B (this sub-GHz unit) streams newline-terminated ASCII CSV lines to
// Board A (the 2.4 GHz capture unit). The link is intentionally one directional
// and human-readable so it can be debugged with any serial monitor.
//
// Wiring: Board B TX -> Board A RX, plus a common ground. 115200 8N1.
//
// Line formats (fields comma-separated, '\n' terminated):
//   E,<freq_khz>,<rssi_dbm>                       energy/activity hit
//   O,<freq_khz>,<rssi_dbm>,<pulses>,<short_us>,<dur_us>   OOK burst captured
//   H,<uptime_s>                                  heartbeat (link alive)
//
// An identical copy of this header lives in the rf-capture project so both
// sides agree on the format.
// ============================================================================
#pragma once

#define LINK_BAUD 115200
