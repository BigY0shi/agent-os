// ============================================================================
// subghz_link.h — ingest the CC1101 daughterboard's UART stream (Board B)
//
// Reads newline-delimited ASCII CSV lines from the link UART and feeds them
// into the capture store. See link_proto.h for the line format. Optional: if no
// daughterboard is wired up, nothing arrives and the sub-GHz view stays idle.
// ============================================================================
#pragma once

#include <Arduino.h>

void subghzLinkBegin();

// Read and parse any pending link bytes. Call from loop().
void subghzLinkPump();
