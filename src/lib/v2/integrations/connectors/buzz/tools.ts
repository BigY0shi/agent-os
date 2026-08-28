import { z } from "zod";
import { ConnectorConfigError, type ConnectorTool, type ToolResult } from "../../types";
import { bridge } from "./bridge";

/**
 * SPEC-D G3.7 — Buzz tools: thin wrappers over the existing buzzBridge
 * (post/read/list per §3.3), through the injectable bridge seam. House rules:
 * `buzz_*` names verbatim, zod4 z.toJSONSchema, throw = the runtime's soft
 * `Error: ...` path, unknown tool = LOUD ConnectorConfigError.
 * buzz_post_message is annotated destructive (it messages real workspace
 * members) even though the name heuristic wouldn't force it.
 */

const PostMessageSchema = z.object({
  channel: z
    .string()
    .optional()
    .describe("Channel name or UUID; defaults to the saved marketing channel"),
  content: z.string().describe("Message text to post"),
});

const ReadChannelSchema = z.object({
  channel: z
    .string()
    .optional()
    .describe("Channel name or UUID; defaults to the saved marketing channel"),
  limit: z.number().optional().default(20).describe("Max messages to return"),
});

const ListChannelsSchema = z.object({});

const jsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema) as Record<string, unknown>;

export function getBuzzTools(): ConnectorTool[] {
  return [
    {
      name: "buzz_post_message",
      description: "Posts a message to a Buzz channel as the Agent OS bridge identity",
      inputSchema: jsonSchema(PostMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "buzz_read_channel",
      description: "Reads recent messages from a Buzz channel (names resolved when known)",
      inputSchema: jsonSchema(ReadChannelSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "buzz_list_channels",
      description: "Lists the Buzz channels the bridge can see",
      inputSchema: jsonSchema(ListChannelsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  ];
}

export async function callBuzzTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const b = bridge();

  switch (name) {
    case "buzz_post_message": {
      const a = PostMessageSchema.parse(args);
      const channelId = await b.resolveChannel(a.channel);
      const sent = await b.sendMessage(channelId, a.content);
      return { text: `Posted to channel ${channelId}${sent.eventId ? ` (event ${sent.eventId})` : ""}` };
    }

    case "buzz_read_channel": {
      const a = ReadChannelSchema.parse(args);
      const channelId = await b.resolveChannel(a.channel);
      const [messages, names] = await Promise.all([
        b.getMessages(channelId, { limit: a.limit }),
        b.displayNames().catch(() => new Map<string, string>()),
      ]);
      if (messages.length === 0) return { text: "No messages in this channel." };
      const self = b.bridgePubkey();
      const list = messages
        .map((m) => {
          const who =
            m.pubkey === self
              ? "Agent OS (bridge)"
              : names.get(m.pubkey) || m.pubkey.slice(0, 8);
          return `[${new Date(m.created_at * 1000).toISOString()}] ${who}: ${m.content}`;
        })
        .join("\n");
      return { text: `Last ${messages.length} messages:\n${list}` };
    }

    case "buzz_list_channels": {
      ListChannelsSchema.parse(args);
      const channels = await b.listChannels();
      if (channels.length === 0) return { text: "No channels found." };
      const list = channels.map((c) => `- ${c.name} (${c.channel_id})`).join("\n");
      return { text: `Found ${channels.length} channels:\n${list}` };
    }

    default:
      // Unknown tool = caller contract violation → LOUD (decision 6).
      throw new ConnectorConfigError(`unknown tool '${name}'`);
  }
}
