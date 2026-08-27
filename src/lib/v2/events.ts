import { getDb } from "./db";
import { now } from "./ids";
import type { V2Event, V2EventType } from "./eventTypes";

/**
 * F2 typed event bus: every emit persists to the events table (Homepage feed +
 * audit), fans out to in-process listeners, and feeds SSE subscribers via the
 * in-memory ring buffer. Lives on globalThis — Next may instantiate this module
 * once per bundle.
 */

type Listener = (event: V2Event) => void;

interface Bus {
  listeners: Map<string, Set<Listener>>; // type -> listeners; "*" = all
  ring: V2Event[]; // last RING_MAX events for SSE catch-up
  sseSubscribers: Set<(event: V2Event) => void>;
}

const RING_MAX = 200;

declare global {
  // eslint-disable-next-line no-var
  var __agentosBus: Bus | undefined;
}

function bus(): Bus {
  if (!globalThis.__agentosBus) {
    globalThis.__agentosBus = { listeners: new Map(), ring: [], sseSubscribers: new Set() };
  }
  return globalThis.__agentosBus;
}

export function emit(
  type: V2EventType,
  payload: Record<string, unknown> = {},
  source?: string,
): V2Event {
  const createdAt = now();
  const info = getDb()
    .prepare("INSERT INTO events(type, source, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(type, source ?? null, JSON.stringify(payload), createdAt);
  const event: V2Event = {
    id: Number(info.lastInsertRowid),
    type,
    source: source ?? null,
    payload,
    createdAt,
  };

  const b = bus();
  b.ring.push(event);
  if (b.ring.length > RING_MAX) b.ring.splice(0, b.ring.length - RING_MAX);

  for (const key of [type, "*"]) {
    const set = b.listeners.get(key);
    if (set) {
      for (const fn of set) {
        try {
          fn(event);
        } catch (err) {
          console.error(`[v2/events] listener for ${key} threw:`, err);
        }
      }
    }
  }
  for (const fn of b.sseSubscribers) {
    try {
      fn(event);
    } catch {
      /* subscriber cleanup happens on unsubscribe */
    }
  }
  return event;
}

/** Subscribe in-process. type "*" receives everything. Returns unsubscribe. */
export function on(type: V2EventType | "*", fn: Listener): () => void {
  const b = bus();
  if (!b.listeners.has(type)) b.listeners.set(type, new Set());
  b.listeners.get(type)!.add(fn);
  return () => b.listeners.get(type)?.delete(fn);
}

/** SSE fanout hook used by /api/v2/events/stream. Returns unsubscribe. */
export function subscribeSse(fn: (event: V2Event) => void): () => void {
  const b = bus();
  b.sseSubscribers.add(fn);
  return () => b.sseSubscribers.delete(fn);
}

/** Number of live SSE subscribers (used by the Jarvis hotkey helper contract). */
export function sseSubscriberCount(): number {
  return bus().sseSubscribers.size;
}

export interface RecentFilter {
  type?: string;
  types?: string[]; // CONVENTIONS §5: CSV filtering supported
  since?: string; // ISO
  limit?: number;
}

export function recent(filter: RecentFilter = {}): V2Event[] {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const where: string[] = [];
  const args: unknown[] = [];
  const types = filter.types?.length ? filter.types : filter.type ? [filter.type] : null;
  if (types) {
    where.push(`type IN (${types.map(() => "?").join(",")})`);
    args.push(...types);
  }
  if (filter.since) {
    where.push("created_at > ?");
    args.push(filter.since);
  }
  const sql = `SELECT id, type, source, payload, created_at AS createdAt FROM events
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY id DESC LIMIT ?`;
  const rows = getDb().prepare(sql).all(...args, limit) as Array<
    Omit<V2Event, "payload"> & { payload: string }
  >;
  return rows.map((r) => ({ ...r, payload: safeParse(r.payload) }));
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
