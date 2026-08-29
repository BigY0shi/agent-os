import { z } from "zod";
import { ConnectorConfigError, type CallCtx, type ConnectorTool, type ToolResult } from "../../types";
import { slackApi } from "./client";

/**
 * SPEC-D G3.6 — Slack tools per §3.3: post message, list channels, read
 * channel history, add reaction, search. Web API via client.ts (pattern-only).
 * House rules: `slack_*` names verbatim, zod4 z.toJSONSchema, throw = the
 * runtime's soft `Error: ...` path, unknown tool = LOUD ConnectorConfigError.
 *
 * Note: slack_search_messages needs a USER token scope (search:read) — with a
 * plain bot token Slack answers `not_allowed_token_type`, which surfaces
 * verbatim through the soft path (honest error, not a silent []).
 */

type AnyRecord = Record<string, unknown>;

const PostMessageSchema = z.object({
  channel: z
    .string()
    .optional()
    .describe("Channel ID (C…/D…) or #name; defaults to the account's defaultChannel"),
  text: z.string().describe("Message text (Slack mrkdwn)"),
  thread_ts: z.string().optional().describe("Thread timestamp to reply into"),
});

const ListChannelsSchema = z.object({
  types: z
    .string()
    .optional()
    .default("public_channel")
    .describe('Comma list of conversation types (e.g. "public_channel,private_channel,im")'),
  limit: z.number().optional().default(100).describe("Max conversations to return"),
});

const ChannelHistorySchema = z.object({
  channel: z.string().describe("Channel ID (C…/D…)"),
  limit: z.number().optional().default(20).describe("Max messages to return"),
  oldest: z.string().optional().describe("Only messages after this ts"),
});

const AddReactionSchema = z.object({
  channel: z.string().describe("Channel ID containing the message"),
  timestamp: z.string().describe("Message ts to react to"),
  name: z.string().describe('Emoji name without colons (e.g. "thumbsup")'),
});

const SearchMessagesSchema = z.object({
  query: z.string().describe("Search query (Slack search syntax)"),
  count: z.number().optional().default(10).describe("Max results"),
});

const jsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema) as Record<string, unknown>;

export function getSlackTools(): ConnectorTool[] {
  return [
    {
      name: "slack_post_message",
      description: "Posts a message to a Slack channel (or thread)",
      inputSchema: jsonSchema(PostMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "slack_list_channels",
      description: "Lists conversations the bot can see",
      inputSchema: jsonSchema(ListChannelsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "slack_get_channel_history",
      description: "Reads recent messages from a channel or DM",
      inputSchema: jsonSchema(ChannelHistorySchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "slack_add_reaction",
      description: "Adds an emoji reaction to a message",
      inputSchema: jsonSchema(AddReactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "slack_search_messages",
      description: "Searches messages across the workspace (needs a user-token search:read scope)",
      inputSchema: jsonSchema(SearchMessagesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  ];
}

export async function callSlackTool(
  name: string,
  args: Record<string, unknown>,
  ctx: CallCtx,
): Promise<ToolResult> {
  const token = ctx.config.token;

  switch (name) {
    case "slack_post_message": {
      const a = PostMessageSchema.parse(args);
      const channel = a.channel || ctx.config.defaultChannel;
      if (!channel) {
        throw new Error("no channel given and no defaultChannel configured on this account");
      }
      const res = await slackApi(token, "chat.postMessage", {
        channel,
        text: a.text,
        ...(a.thread_ts ? { thread_ts: a.thread_ts } : {}),
      });
      return { text: `Message posted to ${res.channel} (ts ${res.ts})` };
    }

    case "slack_list_channels": {
      const a = ListChannelsSchema.parse(args);
      const res = await slackApi(token, "conversations.list", {
        types: a.types,
        limit: a.limit,
        exclude_archived: true,
      });
      const channels = (res.channels as AnyRecord[]) || [];
      if (channels.length === 0) return { text: "No conversations found." };
      const list = channels
        .map((c) => {
          const kind = c.is_im ? "DM" : c.is_private ? "private" : "public";
          const label = c.name ? `#${c.name}` : String(c.user ?? c.id);
          return `- ${label} (${c.id}, ${kind})`;
        })
        .join("\n");
      return { text: `Found ${channels.length} conversations:\n${list}` };
    }

    case "slack_get_channel_history": {
      const a = ChannelHistorySchema.parse(args);
      const res = await slackApi(token, "conversations.history", {
        channel: a.channel,
        limit: a.limit,
        ...(a.oldest ? { oldest: a.oldest } : {}),
      });
      const messages = (res.messages as AnyRecord[]) || [];
      if (messages.length === 0) return { text: "No messages in this range." };
      const list = messages
        .map((m) => `[${m.ts}] ${m.user ?? m.bot_id ?? "unknown"}: ${m.text ?? "(no text)"}`)
        .join("\n");
      return { text: `Last ${messages.length} messages in ${a.channel}:\n${list}` };
    }

    case "slack_add_reaction": {
      const a = AddReactionSchema.parse(args);
      await slackApi(token, "reactions.add", {
        channel: a.channel,
        timestamp: a.timestamp,
        name: a.name,
      });
      return { text: `Reacted :${a.name}: to ${a.channel}@${a.timestamp}` };
    }

    case "slack_search_messages": {
      const a = SearchMessagesSchema.parse(args);
      const res = await slackApi(token, "search.messages", { query: a.query, count: a.count });
      const matches = ((res.messages as AnyRecord)?.matches as AnyRecord[]) || [];
      if (matches.length === 0) return { text: "No matches found." };
      const list = matches
        .map(
          (m) =>
            `- [${(m.channel as AnyRecord)?.name ?? m.channel}] ${m.username ?? m.user}: ${m.text}\n  ${m.permalink ?? ""}`,
        )
        .join("\n");
      return { text: `Found ${matches.length} matches:\n${list}` };
    }

    default:
      // Unknown tool = caller contract violation → LOUD (decision 6).
      throw new ConnectorConfigError(`unknown tool '${name}'`);
  }
}
