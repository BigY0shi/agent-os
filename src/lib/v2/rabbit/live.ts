// Rabbit R1 bridge — in-flight turns. A turn is "live" from the moment the
// completions route accepts it until the claude child exits. Kept on
// globalThis (not module state) so every route handler in the same Node
// process sees the same map — the same trick browser/wsBridge uses.

export interface LiveTurn {
  id: string;
  sessionId: string;
  model: string;
  preview: string;
  client: string;
  startedAt: string;
}

type G = typeof globalThis & { __agentosRabbitLive?: Map<string, LiveTurn> };

function map(): Map<string, LiveTurn> {
  const g = globalThis as G;
  if (!g.__agentosRabbitLive) g.__agentosRabbitLive = new Map();
  return g.__agentosRabbitLive;
}

export function liveStart(t: Omit<LiveTurn, "startedAt">): LiveTurn {
  const row: LiveTurn = { ...t, startedAt: new Date().toISOString() };
  map().set(t.id, row);
  return row;
}

export function liveEnd(id: string): void {
  map().delete(id);
}

export function liveTurns(): LiveTurn[] {
  return Array.from(map().values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
