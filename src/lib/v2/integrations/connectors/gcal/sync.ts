import type { calendar_v3 } from "googleapis";
import type { NewActivity, SyncCtx, SyncResult } from "../../types";
import { getCalendar } from "../googleClient";

/**
 * SPEC-D G3.5 — Google Calendar sync (pattern-only per the port map; upstream
 * has no calendar SYNC). Contract from §3.3:
 * - today+7d events poll (30-min schedule), watermark = `updated` cursor;
 * - new/changed events → activities with eventType 'GCAL_EVENT_CREATED';
 * - 'GCAL_EVENT_SOON' emitted by the sync pass for events starting within the
 *   next 15 minutes (once per event — notified ids tracked in state).
 *
 * Follows the gmail sync conventions: 50-event cap (§8.5), state returned ONLY
 * on progress, per-event code-level `updated <= cursor` skip (the API's
 * updatedMin bound is not precise enough to trust alone — same shape as
 * gmail's internalDate check), top-level API errors THROW so the driver
 * records a sync_run error + emits 'sync.failed'.
 */

interface GcalSyncState {
  updatedCursor?: string; // ISO — newest event.updated processed so far
  soonNotified?: string; // comma-joined event ids already announced as SOON
}

const SOON_WINDOW_MS = 15 * 60 * 1000;
const SOON_NOTIFIED_CAP = 100; // ids kept in state (newest last)

function describeWhen(event: calendar_v3.Schema$Event): { start: string; end: string } {
  return {
    start: event.start?.dateTime || event.start?.date || "?",
    end: event.end?.dateTime || event.end?.date || "?",
  };
}

export async function gcalSync(ctx: SyncCtx): Promise<SyncResult> {
  if (!ctx.config.access_token) {
    return { activities: [] };
  }

  const state = ctx.state as GcalSyncState;
  const calendar = getCalendar(ctx);
  const now = Date.now();
  const activities: NewActivity[] = [];

  // ── New/changed events in the today+7d window ─────────────────────────────
  const listParams: calendar_v3.Params$Resource$Events$List = {
    calendarId: "primary",
    timeMin: new Date(now).toISOString(),
    timeMax: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: true,
    maxResults: 50,
    ...(state.updatedCursor ? { updatedMin: state.updatedCursor } : {}),
  };
  const response = await calendar.events.list(listParams);
  const events = response.data.items || [];

  const cursor = state.updatedCursor || "";
  let newestUpdated = "";
  for (const event of events) {
    if (event.status === "cancelled") continue;
    const updated = event.updated || "";
    // Code-level watermark: skip anything at/before the cursor.
    if (!updated || (cursor && updated <= cursor)) continue;
    if (updated > newestUpdated) newestUpdated = updated;

    const { start, end } = describeWhen(event);
    const isNew = event.created && event.updated && event.created === event.updated;
    const summary = event.summary || "(untitled)";
    const location = event.location ? ` at ${event.location}` : "";
    activities.push({
      text: `Calendar event ${isNew ? "created" : "updated"}: "${summary}" from ${start} to ${end}${location} (event_id: ${event.id})`,
      sourceURL: event.htmlLink || undefined,
      eventType: "GCAL_EVENT_CREATED",
      payload: {
        eventId: event.id ?? null,
        summary,
        start,
        end,
        ...(event.location ? { location: event.location } : {}),
        changeKind: isNew ? "created" : "updated",
      },
      // Item 7: id@updated + kind — a NEW update to the same event is a new
      // activity; a crash-replay of the same update state is not.
      dedupeKey: `gcal-changed:${event.id ?? "unknown"}@${updated}`,
    });
  }

  // ── Events starting soon (≤15 min), announced once per event ──────────────
  const soonResponse = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date(now).toISOString(),
    timeMax: new Date(now + SOON_WINDOW_MS).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });
  const alreadyNotified = new Set(
    (state.soonNotified || "").split(",").filter(Boolean),
  );
  const notified = [...alreadyNotified];
  let soonProgress = false;
  for (const event of soonResponse.data.items || []) {
    if (event.status === "cancelled" || !event.id) continue;
    if (alreadyNotified.has(event.id)) continue;
    // All-day events (date, no dateTime) don't "start in 15 minutes".
    if (!event.start?.dateTime) continue;

    const { start, end } = describeWhen(event);
    const summary = event.summary || "(untitled)";
    activities.push({
      text: `Calendar event starting soon: "${summary}" at ${start}${event.location ? ` (${event.location})` : ""} (event_id: ${event.id})`,
      sourceURL: event.htmlLink || undefined,
      eventType: "GCAL_EVENT_SOON",
      payload: {
        eventId: event.id,
        summary,
        start,
        end,
        ...(event.location ? { location: event.location } : {}),
      },
      // Item 7: SOON fires once per event ever — kind-scoped key.
      dedupeKey: `gcal-soon:${event.id}`,
    });
    notified.push(event.id);
    soonProgress = true;
  }

  // State ONLY on progress (watermark rule — merge is key-wise upstream).
  const statePatch: Record<string, string> = {};
  if (newestUpdated) statePatch.updatedCursor = newestUpdated;
  if (soonProgress) statePatch.soonNotified = notified.slice(-SOON_NOTIFIED_CAP).join(",");

  return {
    activities,
    ...(Object.keys(statePatch).length > 0 ? { state: statePatch } : {}),
  };
}
