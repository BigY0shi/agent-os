import { z } from "zod";
import type { calendar_v3 } from "googleapis";
import { ConnectorConfigError, type CallCtx, type ConnectorTool, type ToolResult } from "../../types";
import { getCalendar } from "../googleClient";

/**
 * SPEC-D G3.5 — Google Calendar tools, verbatim-adapt of the 8 hand-written
 * tools in AOC integrations/google-calendar/src/mcp/index.ts (generated
 * discovery tools SKIPPED per the gmail precedent). Same mechanical
 * adaptations as gmail/tools.ts: `gcal_*` prefixes, zod4 z.toJSONSchema,
 * googleClient per-call OAuth2Client rebuild, ToolResult {text}, throw = the
 * runtime's soft path, unknown tool = LOUD ConnectorConfigError.
 */

// ─── Schemas (verbatim-adapt) ────────────────────────────────────────────────

const CreateEventSchema = z.object({
  calendarId: z
    .string()
    .optional()
    .default("primary")
    .describe("Calendar ID (default: primary calendar)"),
  summary: z.string().describe("Event title"),
  description: z.string().optional().describe("Event description"),
  location: z.string().optional().describe("Event location"),
  startDateTime: z
    .string()
    .describe("Start date/time in ISO 8601 format (e.g., 2024-01-01T10:00:00)"),
  endDateTime: z.string().describe("End date/time in ISO 8601 format"),
  timeZone: z.string().optional().describe('Time zone (e.g., "America/New_York")'),
  attendees: z
    .array(z.object({ email: z.string() }))
    .optional()
    .describe("List of attendee emails"),
  reminders: z
    .object({
      useDefault: z.boolean().optional(),
      overrides: z
        .array(
          z.object({
            method: z.enum(["email", "popup"]),
            minutes: z.number(),
          }),
        )
        .optional(),
    })
    .optional()
    .describe("Event reminders"),
  addGoogleMeet: z
    .boolean()
    .optional()
    .default(true)
    .describe("Automatically add a Google Meet video conference link to the event"),
  recurrence: z
    .array(z.string())
    .optional()
    .describe(
      'Recurrence rules in RRULE format (RFC 5545). Examples: ["RRULE:FREQ=DAILY;COUNT=10"] for daily 10 times, ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20241231T235959Z"] for weekly on Mon/Wed/Fri until end of year',
    ),
});

const GetEventSchema = z.object({
  calendarId: z.string().optional().default("primary").describe("Calendar ID"),
  eventId: z.string().describe("Event ID"),
});

const ListEventsSchema = z.object({
  calendarId: z.string().optional().default("primary").describe("Calendar ID"),
  timeMin: z.string().optional().describe("Lower bound for event start time (ISO 8601)"),
  timeMax: z.string().optional().describe("Upper bound for event start time (ISO 8601)"),
  maxResults: z.number().optional().default(10).describe("Maximum number of events"),
  q: z.string().optional().describe("Free text search query"),
  orderBy: z.enum(["startTime", "updated"]).optional().describe("Order results by"),
  singleEvents: z
    .boolean()
    .optional()
    .default(true)
    .describe("Expand recurring events into instances"),
});

const UpdateEventSchema = z.object({
  calendarId: z.string().optional().default("primary").describe("Calendar ID"),
  eventId: z.string().describe("Event ID"),
  summary: z.string().optional().describe("New event title"),
  description: z.string().optional().describe("New description"),
  location: z.string().optional().describe("New location"),
  startDateTime: z.string().optional().describe("New start date/time (ISO 8601)"),
  endDateTime: z.string().optional().describe("New end date/time (ISO 8601)"),
  timeZone: z.string().optional().describe("Time zone"),
  attendees: z
    .array(z.object({ email: z.string() }))
    .optional()
    .describe("List of attendee emails to add/update"),
  recurrence: z
    .array(z.string())
    .optional()
    .describe("Recurrence rules in RRULE format (RFC 5545)"),
});

const DeleteEventSchema = z.object({
  calendarId: z.string().optional().default("primary").describe("Calendar ID"),
  eventId: z.string().describe("Event ID"),
  sendUpdates: z
    .enum(["all", "externalOnly", "none"])
    .optional()
    .default("none")
    .describe("Whether to send notifications"),
});

const ListCalendarsSchema = z.object({
  maxResults: z.number().optional().default(100).describe("Maximum number of calendars"),
  showHidden: z.boolean().optional().default(false).describe("Show hidden calendars"),
});

const QuickAddEventSchema = z.object({
  calendarId: z.string().optional().default("primary").describe("Calendar ID"),
  text: z
    .string()
    .describe(
      'Natural language event description (e.g., "Dinner with John tomorrow at 7pm at Olive Garden")',
    ),
});

const GetFreeBusySchema = z.object({
  timeMin: z.string().describe("Start of the interval (ISO 8601)"),
  timeMax: z.string().describe("End of the interval (ISO 8601)"),
  calendarIds: z
    .array(z.string())
    .optional()
    .default(["primary"])
    .describe("Calendar IDs to check"),
  timeZone: z.string().optional().describe("Time zone for the response"),
});

// ─── Tool list (annotations verbatim from upstream) ──────────────────────────

const jsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema) as Record<string, unknown>;

export function getGcalTools(): ConnectorTool[] {
  return [
    {
      name: "gcal_create_event",
      description: "Creates a new calendar event",
      inputSchema: jsonSchema(CreateEventSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gcal_get_event",
      description: "Gets details of a specific calendar event",
      inputSchema: jsonSchema(GetEventSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "gcal_list_events",
      description: "Lists calendar events within a time range",
      inputSchema: jsonSchema(ListEventsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "gcal_update_event",
      description: "Updates an existing calendar event",
      inputSchema: jsonSchema(UpdateEventSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gcal_delete_event",
      description: "Deletes a calendar event",
      inputSchema: jsonSchema(DeleteEventSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gcal_list_calendars",
      description: "Lists all calendars accessible to the user",
      inputSchema: jsonSchema(ListCalendarsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "gcal_quick_add_event",
      description: "Creates an event using natural language",
      inputSchema: jsonSchema(QuickAddEventSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gcal_get_freebusy",
      description: "Gets free/busy information for calendars",
      inputSchema: jsonSchema(GetFreeBusySchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  ];
}

// ─── Dispatch (verbatim-adapt of AOC callTool) ───────────────────────────────

export async function callGcalTool(
  name: string,
  args: Record<string, unknown>,
  ctx: CallCtx,
): Promise<ToolResult> {
  const calendar = getCalendar(ctx);

  switch (name) {
    case "gcal_create_event": {
      const validatedArgs = CreateEventSchema.parse(args);
      const event: calendar_v3.Schema$Event = {
        summary: validatedArgs.summary,
        description: validatedArgs.description,
        location: validatedArgs.location,
        start: {
          dateTime: validatedArgs.startDateTime,
          timeZone: validatedArgs.timeZone,
        },
        end: {
          dateTime: validatedArgs.endDateTime,
          timeZone: validatedArgs.timeZone,
        },
        attendees: validatedArgs.attendees,
        reminders: validatedArgs.reminders,
        recurrence: validatedArgs.recurrence,
      };

      if (validatedArgs.addGoogleMeet) {
        event.conferenceData = {
          createRequest: {
            requestId: `meet-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        };
      }

      const response = await calendar.events.insert({
        calendarId: validatedArgs.calendarId,
        requestBody: event,
        conferenceDataVersion: validatedArgs.addGoogleMeet ? 1 : 0,
      });

      let resultText = `Event created successfully!\nEvent ID: ${response.data.id}\nTitle: ${response.data.summary}\nStart: ${response.data.start?.dateTime}\nEnd: ${response.data.end?.dateTime}\nLink: ${response.data.htmlLink}`;

      if (validatedArgs.addGoogleMeet && response.data.conferenceData?.entryPoints) {
        const meetLink = response.data.conferenceData.entryPoints.find(
          (ep) => ep.entryPointType === "video",
        )?.uri;
        if (meetLink) resultText += `\nGoogle Meet: ${meetLink}`;
      }

      return { text: resultText };
    }

    case "gcal_get_event": {
      const validatedArgs = GetEventSchema.parse(args);
      const response = await calendar.events.get({
        calendarId: validatedArgs.calendarId,
        eventId: validatedArgs.eventId,
      });
      return {
        text: `Event: ${response.data.summary}\nID: ${response.data.id}\nDescription: ${response.data.description || "N/A"}\nLocation: ${response.data.location || "N/A"}\nStart: ${response.data.start?.dateTime || response.data.start?.date}\nEnd: ${response.data.end?.dateTime || response.data.end?.date}\nStatus: ${response.data.status}\nLink: ${response.data.htmlLink}`,
      };
    }

    case "gcal_list_events": {
      const validatedArgs = ListEventsSchema.parse(args);
      const response = await calendar.events.list({
        calendarId: validatedArgs.calendarId,
        timeMin: validatedArgs.timeMin,
        timeMax: validatedArgs.timeMax,
        maxResults: validatedArgs.maxResults,
        singleEvents: validatedArgs.singleEvents,
        orderBy: validatedArgs.orderBy,
        q: validatedArgs.q,
      });

      const events = response.data.items || [];
      if (events.length === 0) {
        return { text: "No events found in the specified time range." };
      }

      const eventList = events
        .map(
          (event) =>
            `- ${event.summary} (${event.start?.dateTime || event.start?.date})\n  ID: ${event.id}\n  Location: ${event.location || "N/A"}`,
        )
        .join("\n\n");

      return { text: `Found ${events.length} events:\n\n${eventList}` };
    }

    case "gcal_update_event": {
      const validatedArgs = UpdateEventSchema.parse(args);

      // First get the existing event
      const existingEvent = await calendar.events.get({
        calendarId: validatedArgs.calendarId,
        eventId: validatedArgs.eventId,
      });

      // Merge updates with existing event
      const updatedEvent: calendar_v3.Schema$Event = {
        ...existingEvent.data,
        summary: validatedArgs.summary || existingEvent.data.summary,
        description: validatedArgs.description || existingEvent.data.description,
        location: validatedArgs.location || existingEvent.data.location,
      };

      if (validatedArgs.startDateTime) {
        updatedEvent.start = {
          dateTime: validatedArgs.startDateTime,
          timeZone: validatedArgs.timeZone || existingEvent.data.start?.timeZone,
        };
      }
      if (validatedArgs.endDateTime) {
        updatedEvent.end = {
          dateTime: validatedArgs.endDateTime,
          timeZone: validatedArgs.timeZone || existingEvent.data.end?.timeZone,
        };
      }
      if (validatedArgs.attendees) updatedEvent.attendees = validatedArgs.attendees;
      if (validatedArgs.recurrence) updatedEvent.recurrence = validatedArgs.recurrence;

      const response = await calendar.events.update({
        calendarId: validatedArgs.calendarId,
        eventId: validatedArgs.eventId,
        requestBody: updatedEvent,
      });

      return {
        text: `Event updated successfully!\nTitle: ${response.data.summary}\nStart: ${response.data.start?.dateTime}\nEnd: ${response.data.end?.dateTime}${validatedArgs.attendees ? `\nAttendees: ${validatedArgs.attendees.map((a) => a.email).join(", ")}` : ""}`,
      };
    }

    case "gcal_delete_event": {
      const validatedArgs = DeleteEventSchema.parse(args);
      await calendar.events.delete({
        calendarId: validatedArgs.calendarId,
        eventId: validatedArgs.eventId,
        sendUpdates: validatedArgs.sendUpdates,
      });
      return { text: `Event ${validatedArgs.eventId} deleted successfully` };
    }

    case "gcal_list_calendars": {
      const validatedArgs = ListCalendarsSchema.parse(args);
      const response = await calendar.calendarList.list({
        maxResults: validatedArgs.maxResults,
        showHidden: validatedArgs.showHidden,
      });

      const calendars = response.data.items || [];
      if (calendars.length === 0) return { text: "No calendars found." };

      const calendarList = calendars
        .map(
          (cal) =>
            `- ${cal.summary}\n  ID: ${cal.id}\n  Primary: ${cal.primary || false}\n  Access Role: ${cal.accessRole}`,
        )
        .join("\n\n");

      return { text: `Found ${calendars.length} calendars:\n\n${calendarList}` };
    }

    case "gcal_quick_add_event": {
      const validatedArgs = QuickAddEventSchema.parse(args);
      const response = await calendar.events.quickAdd({
        calendarId: validatedArgs.calendarId,
        text: validatedArgs.text,
      });
      return {
        text: `Event created from quick add!\nEvent ID: ${response.data.id}\nTitle: ${response.data.summary}\nStart: ${response.data.start?.dateTime || response.data.start?.date}\nEnd: ${response.data.end?.dateTime || response.data.end?.date}\nLink: ${response.data.htmlLink}`,
      };
    }

    case "gcal_get_freebusy": {
      const validatedArgs = GetFreeBusySchema.parse(args);
      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin: validatedArgs.timeMin,
          timeMax: validatedArgs.timeMax,
          timeZone: validatedArgs.timeZone,
          items: validatedArgs.calendarIds.map((id) => ({ id })),
        },
      });

      let result = `Free/Busy information:\n\n`;
      for (const [calendarId, cal] of Object.entries(response.data.calendars || {})) {
        const c = cal as calendar_v3.Schema$FreeBusyCalendar;
        result += `Calendar: ${calendarId}\n`;
        if (c.busy && c.busy.length > 0) {
          result += `Busy times:\n`;
          c.busy.forEach((period) => {
            result += `  - ${period.start} to ${period.end}\n`;
          });
        } else {
          result += `  No busy times in this period\n`;
        }
        result += "\n";
      }

      return { text: result };
    }

    default:
      // Unknown tool = caller contract violation → LOUD (decision 6).
      throw new ConnectorConfigError(`unknown tool '${name}'`);
  }
}
