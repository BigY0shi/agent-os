#include "ook_capture.h"
#include "config.h"

namespace {

// Lock-free single-producer (ISR) / single-consumer (loop) ring of edge times.
volatile uint32_t g_edges[OOK_EDGE_BUFFER];
volatile uint16_t g_head = 0;   // written by ISR
uint16_t          g_tail = 0;   // read by loop

// Decoder state carried across ookGetBurst() calls.
bool     g_burstActive = false;
uint32_t g_burstStart = 0;
uint32_t g_lastEdge = 0;
uint16_t g_pulses = 0;
uint32_t g_shortest = 0xFFFFFFFF;

// Completed-burst FIFO so fast back-to-back transmissions are not lost.
OokBurst g_done[8];
uint8_t  g_doneHead = 0;
uint8_t  g_doneTail = 0;

void IRAM_ATTR onEdge() {
  uint16_t next = (uint16_t)((g_head + 1) % OOK_EDGE_BUFFER);
  if (next != g_tail) {          // drop edges if the consumer falls behind
    g_edges[g_head] = micros();
    g_head = next;
  }
}

void pushDone(uint32_t endTime) {
  if (g_pulses >= OOK_MIN_PULSES) {
    uint8_t next = (uint8_t)((g_doneHead + 1) % 8);
    if (next != g_doneTail) {
      g_done[g_doneHead].pulses = g_pulses;
      g_done[g_doneHead].shortestUs =
          (g_shortest == 0xFFFFFFFF) ? 0 : g_shortest;
      g_done[g_doneHead].durationUs = endTime - g_burstStart;
      g_doneHead = next;
    }
  }
  g_burstActive = false;
  g_pulses = 0;
  g_shortest = 0xFFFFFFFF;
}

void feed(uint32_t t) {
  if (!g_burstActive) {
    g_burstActive = true;
    g_burstStart = t;
    g_lastEdge = t;
    g_pulses = 1;
    return;
  }
  uint32_t delta = t - g_lastEdge;
  if (delta >= OOK_GAP_US) {
    // Silence gap: close the current burst, then start a new one at t.
    pushDone(g_lastEdge);
    g_burstActive = true;
    g_burstStart = t;
    g_pulses = 1;
  } else {
    if (delta >= OOK_GLITCH_US) {
      g_pulses++;
      if (delta < g_shortest) g_shortest = delta;
    }
  }
  g_lastEdge = t;
}

}  // namespace

void ookBegin(uint8_t gdo0Pin) {
  pinMode(gdo0Pin, INPUT);
  attachInterrupt(digitalPinToInterrupt(gdo0Pin), onEdge, CHANGE);
}

bool ookGetBurst(OokBurst* out) {
  // Consume any pending edges.
  while (g_tail != g_head) {
    uint32_t t = g_edges[g_tail];
    g_tail = (uint16_t)((g_tail + 1) % OOK_EDGE_BUFFER);
    feed(t);
  }
  // Close a burst that ended in trailing silence (no edge for OOK_GAP_US).
  if (g_burstActive && (micros() - g_lastEdge) >= OOK_GAP_US) {
    pushDone(g_lastEdge);
  }
  // Pop one completed burst if available.
  if (g_doneTail != g_doneHead) {
    *out = g_done[g_doneTail];
    g_doneTail = (uint8_t)((g_doneTail + 1) % 8);
    return true;
  }
  return false;
}
