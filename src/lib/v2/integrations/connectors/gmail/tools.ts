import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { gmail_v1 } from "googleapis";

import { ConnectorConfigError, type CallCtx, type ConnectorTool, type ToolResult } from "../../types";
import { getGmail } from "../googleClient";
import {
  collectAttachments,
  convertQueryDatesToTimezone,
  createEmailMessage,
  createEmailWithAttachments,
  encodeRawMessage,
  extractEmailContent,
  type GmailMessagePart,
  type EmailArgs,
} from "./mime";
import {
  createLabel,
  updateLabel,
  deleteLabel,
  listLabels,
  getOrCreateLabel,
  type GmailLabel,
} from "./labelManager";
import {
  createFilter,
  listFilters,
  getFilter,
  deleteFilter,
  filterTemplates,
  type GmailFilterCriteria,
  type GmailFilterAction,
} from "./filterManager";

/**
 * SPEC-D G3.1 — the hand-written AOC Gmail tools, verbatim-adapt of
 * integrations/gmail/src/mcp/index.ts (generated discovery tools SKIPPED per
 * port map). Adaptations, mechanical only:
 * - tool names slug-prefixed `gmail_*` (decision 2 — advertised name IS the
 *   dispatch name, no strip);
 * - zod-to-json-schema → zod4-native z.toJSONSchema (repo pins zod ^4.4);
 * - OAuth2Client rebuilt per call from the stored tokens via googleClient
 *   (auto-refresh + persisted refresh — chunk-2 contract);
 * - timezone comes from ctx.timezone (runtime decision 10), not credentials;
 * - ToolResult {text} instead of MCP content blocks; upstream's catch-all
 *   error→`Error: ...` text is now the runtime's soft path (throw = soft);
 * - nodemailer attachments path → hand-rolled MIME (mime.ts);
 * - upstream's ReadEmailThread `.refine` became a handler-level check (zod4
 *   toJSONSchema has no representation for refinements);
 * - upstream annotation fix: create_filter_from_template is destructiveHint
 *   TRUE (it creates a filter exactly like create_filter, which upstream
 *   marked destructive).
 */

// ─── Schemas (verbatim-adapt) ────────────────────────────────────────────────

const LabelColorInputSchema = z.union([
  z.string(),
  z.object({
    textColor: z.string(),
    backgroundColor: z.string(),
  }),
]);

const SendEmailSchema = z.object({
  to: z.array(z.string()).describe("List of recipient email addresses"),
  subject: z.string().describe("Email subject"),
  body: z
    .string()
    .describe("Email body content (used for text/plain or when htmlBody not provided)"),
  htmlBody: z.string().optional().describe("HTML version of the email body"),
  mimeType: z
    .enum(["text/plain", "text/html", "multipart/alternative"])
    .optional()
    .default("text/plain")
    .describe("Email content type"),
  cc: z.array(z.string()).optional().describe("List of CC recipients"),
  bcc: z.array(z.string()).optional().describe("List of BCC recipients"),
  threadId: z.string().optional().describe("Thread ID to reply to"),
  inReplyTo: z.string().optional().describe("Message ID being replied to"),
  attachments: z
    .array(z.string())
    .optional()
    .describe("List of file paths to attach to the email"),
});

const ReadEmailSchema = z.object({
  messageId: z.string().describe("ID of the email message to retrieve"),
});

// upstream used .refine(threadId || messageId) — enforced in the handler
// instead (zod4 toJSONSchema cannot represent refinements).
const ReadEmailThreadSchema = z.object({
  threadId: z.string().optional().describe("Thread ID to retrieve all messages from"),
  messageId: z
    .string()
    .optional()
    .describe("Message ID to get its thread. Either threadId or messageId is required."),
});

const SearchEmailsSchema = z.object({
  query: z
    .string()
    .describe(
      "Gmail search query (e.g., 'from:example@gmail.com', 'after:2024/01/15', 'before:2024/12/31'). Use standard date format (YYYY/MM/DD) for date operators. Dates will be automatically converted to your timezone.",
    ),
  maxResults: z
    .number()
    .optional()
    .describe("Maximum number of results to return per page (Gmail caps at 500)."),
  pageToken: z
    .string()
    .optional()
    .describe(
      "Opaque cursor for the next page. Pass the `nextPageToken` returned by a previous search call to continue paging through the same query.",
    ),
});

const ModifyEmailSchema = z.object({
  messageId: z.string().describe("ID of the email message to modify"),
  labelIds: z.array(z.string()).optional().describe("List of label IDs to apply"),
  addLabelIds: z
    .array(z.string())
    .optional()
    .describe("List of label IDs to add to the message"),
  removeLabelIds: z
    .array(z.string())
    .optional()
    .describe("List of label IDs to remove from the message"),
});

const DeleteEmailSchema = z.object({
  messageId: z.string().describe("ID of the email message to delete"),
});

const ListEmailLabelsSchema = z.object({}).describe("Retrieves all available Gmail labels");

const CreateLabelSchema = z
  .object({
    name: z.string().describe("Name for the new label"),
    messageListVisibility: z
      .enum(["show", "hide"])
      .optional()
      .describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z
      .enum(["labelShow", "labelShowIfUnread", "labelHide"])
      .optional()
      .describe("Visibility of the label in the label list"),
    color: LabelColorInputSchema.optional().describe(
      'Label color. Either a preset key (e.g. "blue", "green", "red") or an ' +
        "explicit {textColor, backgroundColor} pair using hex values from Gmail's " +
        "allowed palette. Gmail renders one pair in both light and dark themes " +
        "automatically — no per-theme input is supported.",
    ),
  })
  .describe("Creates a new Gmail label");

const UpdateLabelSchema = z
  .object({
    id: z.string().describe("ID of the label to update"),
    name: z.string().optional().describe("New name for the label"),
    messageListVisibility: z
      .enum(["show", "hide"])
      .optional()
      .describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z
      .enum(["labelShow", "labelShowIfUnread", "labelHide"])
      .optional()
      .describe("Visibility of the label in the label list"),
    color: LabelColorInputSchema.optional().describe(
      'Label color. Either a preset key (e.g. "blue") or an explicit ' +
        "{textColor, backgroundColor} pair from Gmail's allowed palette. " +
        "Omit to leave the existing color unchanged.",
    ),
  })
  .describe("Updates an existing Gmail label");

const DeleteLabelSchema = z
  .object({
    id: z.string().describe("ID of the label to delete"),
  })
  .describe("Deletes a Gmail label");

const GetOrCreateLabelSchema = z
  .object({
    name: z.string().describe("Name of the label to get or create"),
    messageListVisibility: z
      .enum(["show", "hide"])
      .optional()
      .describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z
      .enum(["labelShow", "labelShowIfUnread", "labelHide"])
      .optional()
      .describe("Visibility of the label in the label list"),
    color: LabelColorInputSchema.optional().describe(
      "Label color (applied only when a new label is created). Either a preset " +
        "key or an explicit {textColor, backgroundColor} pair from Gmail's " +
        "allowed palette.",
    ),
  })
  .describe("Gets an existing label by name or creates it if it doesn't exist");

const BatchModifyEmailsSchema = z.object({
  messageIds: z.array(z.string()).describe("List of message IDs to modify"),
  addLabelIds: z
    .array(z.string())
    .optional()
    .describe("List of label IDs to add to all messages"),
  removeLabelIds: z
    .array(z.string())
    .optional()
    .describe("List of label IDs to remove from all messages"),
  batchSize: z
    .number()
    .optional()
    .default(50)
    .describe("Number of messages to process in each batch (default: 50)"),
});

const BatchDeleteEmailsSchema = z.object({
  messageIds: z.array(z.string()).describe("List of message IDs to delete"),
  batchSize: z
    .number()
    .optional()
    .default(50)
    .describe("Number of messages to process in each batch (default: 50)"),
});

const CreateFilterSchema = z
  .object({
    criteria: z
      .object({
        from: z.string().optional().describe("Sender email address to match"),
        to: z.string().optional().describe("Recipient email address to match"),
        subject: z.string().optional().describe("Subject text to match"),
        query: z.string().optional().describe("Gmail search query (e.g., 'has:attachment')"),
        negatedQuery: z.string().optional().describe("Text that must NOT be present"),
        hasAttachment: z
          .boolean()
          .optional()
          .describe("Whether to match emails with attachments"),
        excludeChats: z.boolean().optional().describe("Whether to exclude chat messages"),
        size: z.number().optional().describe("Email size in bytes"),
        sizeComparison: z
          .enum(["unspecified", "smaller", "larger"])
          .optional()
          .describe("Size comparison operator"),
      })
      .describe("Criteria for matching emails"),
    action: z
      .object({
        addLabelIds: z
          .array(z.string())
          .optional()
          .describe("Label IDs to add to matching emails"),
        removeLabelIds: z
          .array(z.string())
          .optional()
          .describe("Label IDs to remove from matching emails"),
        forward: z.string().optional().describe("Email address to forward matching emails to"),
      })
      .describe("Actions to perform on matching emails"),
  })
  .describe("Creates a new Gmail filter");

const ListFiltersSchema = z.object({}).describe("Retrieves all Gmail filters");

const GetFilterSchema = z
  .object({
    filterId: z.string().describe("ID of the filter to retrieve"),
  })
  .describe("Gets details of a specific Gmail filter");

const DeleteFilterSchema = z
  .object({
    filterId: z.string().describe("ID of the filter to delete"),
  })
  .describe("Deletes a Gmail filter");

const CreateFilterFromTemplateSchema = z
  .object({
    template: z
      .enum([
        "fromSender",
        "withSubject",
        "withAttachments",
        "largeEmails",
        "containingText",
        "mailingList",
      ])
      .describe("Pre-defined filter template to use"),
    parameters: z
      .object({
        senderEmail: z.string().optional().describe("Sender email (for fromSender template)"),
        subjectText: z.string().optional().describe("Subject text (for withSubject template)"),
        searchText: z
          .string()
          .optional()
          .describe("Text to search for (for containingText template)"),
        listIdentifier: z
          .string()
          .optional()
          .describe("Mailing list identifier (for mailingList template)"),
        sizeInBytes: z
          .number()
          .optional()
          .describe("Size threshold in bytes (for largeEmails template)"),
        labelIds: z.array(z.string()).optional().describe("Label IDs to apply"),
        archive: z.boolean().optional().describe("Whether to archive (skip inbox)"),
        markAsRead: z.boolean().optional().describe("Whether to mark as read"),
        markImportant: z.boolean().optional().describe("Whether to mark as important"),
      })
      .describe("Template-specific parameters"),
  })
  .describe("Creates a filter using a pre-defined template");

const DownloadAttachmentSchema = z.object({
  messageId: z.string().describe("ID of the email message containing the attachment"),
  attachmentId: z.string().describe("ID of the attachment to download"),
  filename: z
    .string()
    .optional()
    .describe("Filename to save the attachment as (if not provided, uses original filename)"),
  savePath: z
    .string()
    .optional()
    .describe("Directory path to save the attachment (defaults to current directory)"),
});

// ─── Tool list (names slug-prefixed; annotations verbatim + noted fix) ───────

const jsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema) as Record<string, unknown>;

export function getGmailTools(): ConnectorTool[] {
  return [
    {
      name: "gmail_send_email",
      description: "Sends a new email",
      inputSchema: jsonSchema(SendEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_draft_email",
      description: "Draft a new email",
      inputSchema: jsonSchema(SendEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "gmail_read_email",
      description: "Retrieves the content of a specific email",
      inputSchema: jsonSchema(ReadEmailSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "gmail_read_email_thread",
      description:
        "Retrieves all messages in an email thread/conversation in readable format",
      inputSchema: jsonSchema(ReadEmailThreadSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "gmail_search_emails",
      description: "Searches for emails using Gmail search syntax",
      inputSchema: jsonSchema(SearchEmailsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "gmail_modify_email",
      description: "Modifies email labels (move to different folders)",
      inputSchema: jsonSchema(ModifyEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_delete_email",
      description: "Permanently deletes an email",
      inputSchema: jsonSchema(DeleteEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_list_email_labels",
      description: "Retrieves all available Gmail labels",
      inputSchema: jsonSchema(ListEmailLabelsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "gmail_batch_modify_emails",
      description: "Modifies labels for multiple emails in batches",
      inputSchema: jsonSchema(BatchModifyEmailsSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_batch_delete_emails",
      description: "Permanently deletes multiple emails in batches",
      inputSchema: jsonSchema(BatchDeleteEmailsSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_create_label",
      description:
        "Creates a new Gmail label. Optionally sets a color from Gmail's fixed palette " +
        "(preset key or explicit hex pair). Gmail renders one color pair in both light " +
        "and dark themes automatically.",
      inputSchema: jsonSchema(CreateLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_update_label",
      description:
        "Updates an existing Gmail label. Can set or change the color (from Gmail's " +
        "fixed palette). Omitted fields are preserved.",
      inputSchema: jsonSchema(UpdateLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_delete_label",
      description: "Deletes a Gmail label",
      inputSchema: jsonSchema(DeleteLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_get_or_create_label",
      description:
        "Gets an existing label by name or creates it if it doesn't exist. When creating, " +
        "can set a color from Gmail's fixed palette.",
      inputSchema: jsonSchema(GetOrCreateLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_create_filter",
      description: "Creates a new Gmail filter with custom criteria and actions",
      inputSchema: jsonSchema(CreateFilterSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_list_filters",
      description: "Retrieves all Gmail filters",
      inputSchema: jsonSchema(ListFiltersSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "gmail_get_filter",
      description: "Gets details of a specific Gmail filter",
      inputSchema: jsonSchema(GetFilterSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "gmail_delete_filter",
      description: "Deletes a Gmail filter",
      inputSchema: jsonSchema(DeleteFilterSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_create_filter_from_template",
      description: "Creates a filter using a pre-defined template for common scenarios",
      inputSchema: jsonSchema(CreateFilterFromTemplateSchema),
      // upstream said destructiveHint:false here while create_filter is true —
      // it creates the same resource; fixed to true (see file header).
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "gmail_download_attachment",
      description:
        "Downloads an email attachment into the Agent OS downloads folder (~/.agentic-os/downloads/gmail)",
      inputSchema: jsonSchema(DownloadAttachmentSchema),
      // Writes attacker-controllable bytes to disk — upstream shipped this as
      // readOnly with a free-form savePath (arbitrary file write, incl.
      // Startup folders). Destructive + path-confined here (review 2026-08-27).
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
  ];
}

// ─── Dispatch (verbatim-adapt of AOC callTool) ───────────────────────────────

export async function callGmailTool(
  name: string,
  args: Record<string, unknown>,
  ctx: CallCtx,
): Promise<ToolResult> {
  const gmail = getGmail(ctx);
  const timezone = ctx.timezone;

  // Helper function to handle email actions (send/draft)
  async function handleEmailAction(
    action: "send" | "draft",
    validatedArgs: EmailArgs,
  ): Promise<ToolResult> {
    const hasAttachments = !!(validatedArgs.attachments && validatedArgs.attachments.length > 0);
    const message = hasAttachments
      ? createEmailWithAttachments(validatedArgs)
      : createEmailMessage(validatedArgs);
    const encodedMessage = encodeRawMessage(message);
    const messageRequest = {
      raw: encodedMessage,
      ...(validatedArgs.threadId ? { threadId: validatedArgs.threadId } : {}),
    };

    if (action === "send") {
      const result = await gmail.users.messages.send({
        userId: "me",
        requestBody: messageRequest,
      });
      return { text: `Email sent successfully with ID: ${result.data.id}` };
    }
    const response = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: messageRequest },
    });
    return { text: `Email draft created successfully with ID: ${response.data.id}` };
  }

  // Helper function to process operations in batches (verbatim)
  async function processBatches<T, U>(
    items: T[],
    batchSize: number,
    processFn: (batch: T[]) => Promise<U[]>,
  ): Promise<{ successes: U[]; failures: { item: T; error: Error }[] }> {
    const successes: U[] = [];
    const failures: { item: T; error: Error }[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      try {
        const results = await processFn(batch);
        successes.push(...results);
      } catch {
        // If batch fails, try individual items
        for (const item of batch) {
          try {
            const result = await processFn([item]);
            successes.push(...result);
          } catch (itemError) {
            failures.push({ item, error: itemError as Error });
          }
        }
      }
    }

    return { successes, failures };
  }

  switch (name) {
    case "gmail_send_email":
    case "gmail_draft_email": {
      const validatedArgs = SendEmailSchema.parse(args);
      const action = name === "gmail_send_email" ? "send" : "draft";
      return handleEmailAction(action, validatedArgs);
    }

    case "gmail_read_email": {
      const validatedArgs = ReadEmailSchema.parse(args);
      const response = await gmail.users.messages.get({
        userId: "me",
        id: validatedArgs.messageId,
        format: "full",
      });

      const headers = response.data.payload?.headers || [];
      const h = (n: string) =>
        headers.find((x) => x.name?.toLowerCase() === n)?.value || "";
      const subject = h("subject");
      const from = h("from");
      const to = h("to");
      const cc = h("cc");
      const bcc = h("bcc");
      const replyTo = h("reply-to");
      const messageId = h("message-id");
      const date = h("date");
      const threadId = response.data.threadId || "";
      const labelIds = response.data.labelIds || [];

      const { text, html } = extractEmailContent(
        (response.data.payload as GmailMessagePart) || {},
      );
      const body = text || html || "";
      const contentTypeNote =
        !text && html
          ? "[Note: This email is HTML-formatted. Plain text version not available.]\n\n"
          : "";

      const attachments = collectAttachments(response.data.payload as GmailMessagePart);
      const attachmentInfo =
        attachments.length > 0
          ? `\n\nAttachments (${attachments.length}):\n` +
            attachments
              .map(
                (a) =>
                  `- ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)} KB, ID: ${a.id})`,
              )
              .join("\n")
          : "";

      const headerInfo = [
        `Thread ID: ${threadId}`,
        `Message ID: ${messageId}`,
        `Subject: ${subject}`,
        `From: ${from}`,
        `To: ${to}`,
        cc ? `Cc: ${cc}` : null,
        bcc ? `Bcc: ${bcc}` : null,
        replyTo && replyTo !== from ? `Reply-To: ${replyTo}` : null,
        `Date: ${date}`,
        labelIds.length > 0 ? `Labels: ${labelIds.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      return { text: `${headerInfo}\n\n${contentTypeNote}${body}${attachmentInfo}` };
    }

    case "gmail_read_email_thread": {
      const validatedArgs = ReadEmailThreadSchema.parse(args);
      if (!validatedArgs.threadId && !validatedArgs.messageId) {
        // upstream's .refine, enforced here (see file header)
        throw new Error("Either threadId or messageId must be provided");
      }

      let threadId = validatedArgs.threadId;
      if (!threadId && validatedArgs.messageId) {
        const messageResponse = await gmail.users.messages.get({
          userId: "me",
          id: validatedArgs.messageId,
          format: "minimal",
        });
        threadId = messageResponse.data.threadId || "";
      }
      if (!threadId) throw new Error("Could not determine thread ID");

      const threadResponse = await gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "full",
      });
      const messages = threadResponse.data.messages || [];

      const formattedMessages = messages.map((msg, index) => {
        const headers = msg.payload?.headers || [];
        const h = (n: string) =>
          headers.find((x) => x.name?.toLowerCase() === n)?.value || "";
        const subject = h("subject");
        const from = h("from");
        const to = h("to");
        const cc = h("cc");
        const bcc = h("bcc");
        const replyTo = h("reply-to");
        const messageId = h("message-id");
        const date = h("date");
        const labelIds = msg.labelIds || [];

        const { text, html } = extractEmailContent((msg.payload as GmailMessagePart) || {});
        const body = text || html || "";
        const contentTypeNote =
          !text && html
            ? "[Note: This email is HTML-formatted. Plain text version not available.]\n\n"
            : "";

        const attachments = collectAttachments(msg.payload as GmailMessagePart);
        const attachmentInfo =
          attachments.length > 0
            ? `\n\nAttachments (${attachments.length}):\n` +
              attachments
                .map(
                  (a) =>
                    `- ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)} KB, ID: ${a.id})`,
                )
                .join("\n")
            : "";

        const headerLines = [
          `Message ID: ${msg.id}`,
          messageId ? `Email Message-ID: ${messageId}` : null,
          `Subject: ${subject}`,
          `From: ${from}`,
          `To: ${to}`,
          cc ? `Cc: ${cc}` : null,
          bcc ? `Bcc: ${bcc}` : null,
          replyTo && replyTo !== from ? `Reply-To: ${replyTo}` : null,
          `Date: ${date}`,
          labelIds.length > 0 ? `Labels: ${labelIds.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        return `${"=".repeat(80)}\nMessage ${index + 1} of ${messages.length}\n${headerLines}\n${"=".repeat(80)}\n\n${contentTypeNote}${body}${attachmentInfo}`;
      });

      const threadSummary = `Thread ID: ${threadId}\nTotal Messages: ${messages.length}\n\n`;
      return { text: threadSummary + formattedMessages.join("\n\n") };
    }

    case "gmail_search_emails": {
      const validatedArgs = SearchEmailsSchema.parse(args);

      // Convert dates in query to user's timezone (recon gotcha — kept)
      const convertedQuery = convertQueryDatesToTimezone(validatedArgs.query, timezone);

      const response = await gmail.users.messages.list({
        userId: "me",
        q: convertedQuery,
        maxResults: validatedArgs.maxResults || 10,
        pageToken: validatedArgs.pageToken,
      });

      const messages = response.data.messages || [];
      const nextPageToken = response.data.nextPageToken || "";
      const resultSizeEstimate = response.data.resultSizeEstimate ?? null;

      const results = await Promise.all(
        messages.map(async (msg) => {
          const detail = await gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "To", "Cc", "Date", "Reply-To"],
          });
          const headers = detail.data.payload?.headers || [];
          const h = (n: string) => headers.find((x) => x.name === n)?.value || "";
          return {
            id: msg.id,
            threadId: detail.data.threadId || "",
            subject: h("Subject"),
            from: h("From"),
            to: h("To"),
            cc: h("Cc"),
            replyTo: h("Reply-To"),
            date: h("Date"),
            snippet: detail.data.snippet || "",
            labels: (detail.data.labelIds || []).join(", "),
          };
        }),
      );

      const estimateLine =
        resultSizeEstimate !== null
          ? `\nGmail result size estimate: ~${resultSizeEstimate} (rough total for this query, server-side estimate)`
          : "";
      const pageFooter = nextPageToken
        ? `${estimateLine}\nNext Page Token: ${nextPageToken}\n(Pass this as \`pageToken\` to gmail_search_emails to fetch the next page.)`
        : `${estimateLine}\nNext Page Token: (none — end of results)`;

      return {
        text:
          results
            .map(
              (r) =>
                `ID: ${r.id}\nThread ID: ${r.threadId}\nSubject: ${r.subject}\nFrom: ${r.from}\nTo: ${r.to}${r.cc ? `\nCc: ${r.cc}` : ""}${r.replyTo ? `\nReply-To: ${r.replyTo}` : ""}\nDate: ${r.date}\nLabels: ${r.labels}\nSnippet: ${r.snippet}\n`,
            )
            .join("\n") + pageFooter,
      };
    }

    case "gmail_modify_email": {
      const validatedArgs = ModifyEmailSchema.parse(args);
      const requestBody: gmail_v1.Schema$ModifyMessageRequest = {};
      if (validatedArgs.labelIds) requestBody.addLabelIds = validatedArgs.labelIds;
      if (validatedArgs.addLabelIds) requestBody.addLabelIds = validatedArgs.addLabelIds;
      if (validatedArgs.removeLabelIds) requestBody.removeLabelIds = validatedArgs.removeLabelIds;

      await gmail.users.messages.modify({
        userId: "me",
        id: validatedArgs.messageId,
        requestBody,
      });
      return { text: `Email ${validatedArgs.messageId} labels updated successfully` };
    }

    case "gmail_delete_email": {
      const validatedArgs = DeleteEmailSchema.parse(args);
      await gmail.users.messages.delete({ userId: "me", id: validatedArgs.messageId });
      return { text: `Email ${validatedArgs.messageId} deleted successfully` };
    }

    case "gmail_list_email_labels": {
      const labelResults = await listLabels(gmail);
      const systemLabels = labelResults.system;
      const userLabels = labelResults.user;
      return {
        text:
          `Found ${labelResults.count.total} labels (${labelResults.count.system} system, ${labelResults.count.user} user):\n\n` +
          "System Labels:\n" +
          systemLabels.map((l: GmailLabel) => `ID: ${l.id}\nName: ${l.name}\n`).join("\n") +
          "\nUser Labels:\n" +
          userLabels.map((l: GmailLabel) => `ID: ${l.id}\nName: ${l.name}\n`).join("\n"),
      };
    }

    case "gmail_batch_modify_emails": {
      const validatedArgs = BatchModifyEmailsSchema.parse(args);
      const messageIds = validatedArgs.messageIds;
      const batchSize = validatedArgs.batchSize || 50;

      const requestBody: gmail_v1.Schema$ModifyMessageRequest = {};
      if (validatedArgs.addLabelIds) requestBody.addLabelIds = validatedArgs.addLabelIds;
      if (validatedArgs.removeLabelIds) requestBody.removeLabelIds = validatedArgs.removeLabelIds;

      const { successes, failures } = await processBatches(messageIds, batchSize, async (batch) =>
        Promise.all(
          batch.map(async (messageId) => {
            await gmail.users.messages.modify({ userId: "me", id: messageId, requestBody });
            return { messageId, success: true };
          }),
        ),
      );

      let resultText = `Batch label modification complete.\n`;
      resultText += `Successfully processed: ${successes.length} messages\n`;
      if (failures.length > 0) {
        resultText += `Failed to process: ${failures.length} messages\n\n`;
        resultText += `Failed message IDs:\n`;
        resultText += failures
          .map((f) => `- ${(f.item as string).substring(0, 16)}... (${f.error.message})`)
          .join("\n");
      }
      return { text: resultText };
    }

    case "gmail_batch_delete_emails": {
      const validatedArgs = BatchDeleteEmailsSchema.parse(args);
      const messageIds = validatedArgs.messageIds;
      const batchSize = validatedArgs.batchSize || 50;

      const { successes, failures } = await processBatches(messageIds, batchSize, async (batch) =>
        Promise.all(
          batch.map(async (messageId) => {
            await gmail.users.messages.delete({ userId: "me", id: messageId });
            return { messageId, success: true };
          }),
        ),
      );

      let resultText = `Batch delete operation complete.\n`;
      resultText += `Successfully deleted: ${successes.length} messages\n`;
      if (failures.length > 0) {
        resultText += `Failed to delete: ${failures.length} messages\n\n`;
        resultText += `Failed message IDs:\n`;
        resultText += failures
          .map((f) => `- ${(f.item as string).substring(0, 16)}... (${f.error.message})`)
          .join("\n");
      }
      return { text: resultText };
    }

    case "gmail_create_label": {
      const validatedArgs = CreateLabelSchema.parse(args);
      const result = await createLabel(gmail, validatedArgs.name, {
        messageListVisibility: validatedArgs.messageListVisibility,
        labelListVisibility: validatedArgs.labelListVisibility,
        color: validatedArgs.color,
      });
      return {
        text: `Label created successfully:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
      };
    }

    case "gmail_update_label": {
      const validatedArgs = UpdateLabelSchema.parse(args);
      const updates: {
        name?: string;
        messageListVisibility?: string;
        labelListVisibility?: string;
        color?: string | { textColor: string; backgroundColor: string };
      } = {};
      if (validatedArgs.name) updates.name = validatedArgs.name;
      if (validatedArgs.messageListVisibility)
        updates.messageListVisibility = validatedArgs.messageListVisibility;
      if (validatedArgs.labelListVisibility)
        updates.labelListVisibility = validatedArgs.labelListVisibility;
      if (validatedArgs.color !== undefined) updates.color = validatedArgs.color;

      const result = await updateLabel(gmail, validatedArgs.id, updates);
      return {
        text: `Label updated successfully:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
      };
    }

    case "gmail_delete_label": {
      const validatedArgs = DeleteLabelSchema.parse(args);
      const result = await deleteLabel(gmail, validatedArgs.id);
      return { text: result.message };
    }

    case "gmail_get_or_create_label": {
      const validatedArgs = GetOrCreateLabelSchema.parse(args);
      const result = await getOrCreateLabel(gmail, validatedArgs.name, {
        messageListVisibility: validatedArgs.messageListVisibility,
        labelListVisibility: validatedArgs.labelListVisibility,
        color: validatedArgs.color,
      });
      const action =
        result.type === "user" && result.name === validatedArgs.name
          ? "found existing"
          : "created new";
      return {
        text: `Successfully ${action} label:\nID: ${result.id}\nName: ${result.name}\nType: ${result.type}`,
      };
    }

    case "gmail_create_filter": {
      const validatedArgs = CreateFilterSchema.parse(args);
      const result = await createFilter(
        gmail,
        validatedArgs.criteria as GmailFilterCriteria,
        validatedArgs.action as GmailFilterAction,
      );

      const criteriaText = Object.entries(validatedArgs.criteria)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      const actionText = Object.entries(validatedArgs.action)
        .filter(
          ([, value]) => value !== undefined && (Array.isArray(value) ? value.length > 0 : true),
        )
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
        .join(", ");

      return {
        text: `Filter created successfully:\nID: ${result.id}\nCriteria: ${criteriaText}\nActions: ${actionText}`,
      };
    }

    case "gmail_list_filters": {
      const result = await listFilters(gmail);
      const filters = result.filters;
      if (filters.length === 0) return { text: "No filters found." };

      const filtersText = filters
        .map((filter) => {
          const criteriaEntries = Object.entries(filter.criteria || {})
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ");
          const actionEntries = Object.entries(filter.action || {})
            .filter(
              ([, value]) =>
                value !== undefined && (Array.isArray(value) ? value.length > 0 : true),
            )
            .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
            .join(", ");
          return `ID: ${filter.id}\nCriteria: ${criteriaEntries}\nActions: ${actionEntries}\n`;
        })
        .join("\n");

      return { text: `Found ${result.count} filters:\n\n${filtersText}` };
    }

    case "gmail_get_filter": {
      const validatedArgs = GetFilterSchema.parse(args);
      const result = await getFilter(gmail, validatedArgs.filterId);

      const criteriaText = Object.entries(result.criteria || {})
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      const actionText = Object.entries(result.action || {})
        .filter(
          ([, value]) => value !== undefined && (Array.isArray(value) ? value.length > 0 : true),
        )
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
        .join(", ");

      return {
        text: `Filter details:\nID: ${result.id}\nCriteria: ${criteriaText}\nActions: ${actionText}`,
      };
    }

    case "gmail_delete_filter": {
      const validatedArgs = DeleteFilterSchema.parse(args);
      const result = await deleteFilter(gmail, validatedArgs.filterId);
      return { text: result.message };
    }

    case "gmail_create_filter_from_template": {
      const validatedArgs = CreateFilterFromTemplateSchema.parse(args);
      const template = validatedArgs.template;
      const params = validatedArgs.parameters;

      let filterConfig: { criteria: GmailFilterCriteria; action: GmailFilterAction };
      switch (template) {
        case "fromSender":
          if (!params.senderEmail)
            throw new Error("senderEmail is required for fromSender template");
          filterConfig = filterTemplates.fromSender(
            params.senderEmail,
            params.labelIds,
            params.archive,
          );
          break;
        case "withSubject":
          if (!params.subjectText)
            throw new Error("subjectText is required for withSubject template");
          filterConfig = filterTemplates.withSubject(
            params.subjectText,
            params.labelIds,
            params.markAsRead,
          );
          break;
        case "withAttachments":
          filterConfig = filterTemplates.withAttachments(params.labelIds);
          break;
        case "largeEmails":
          if (!params.sizeInBytes)
            throw new Error("sizeInBytes is required for largeEmails template");
          filterConfig = filterTemplates.largeEmails(params.sizeInBytes, params.labelIds);
          break;
        case "containingText":
          if (!params.searchText)
            throw new Error("searchText is required for containingText template");
          filterConfig = filterTemplates.containingText(
            params.searchText,
            params.labelIds,
            params.markImportant,
          );
          break;
        case "mailingList":
          if (!params.listIdentifier)
            throw new Error("listIdentifier is required for mailingList template");
          filterConfig = filterTemplates.mailingList(
            params.listIdentifier,
            params.labelIds,
            params.archive,
          );
          break;
        default:
          throw new Error(`Unknown template: ${template}`);
      }

      const result = await createFilter(gmail, filterConfig.criteria, filterConfig.action);
      return {
        text: `Filter created from template '${template}':\nID: ${result.id}\nTemplate used: ${template}`,
      };
    }

    case "gmail_download_attachment": {
      const validatedArgs = DownloadAttachmentSchema.parse(args);
      try {
        const attachmentResponse = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: validatedArgs.messageId,
          id: validatedArgs.attachmentId,
        });
        if (!attachmentResponse.data.data) {
          throw new Error("No attachment data received");
        }

        const buffer = Buffer.from(attachmentResponse.data.data, "base64url");
        // Confinement (review 2026-08-27): email bytes never choose their own
        // destination. Everything lands under the fixed downloads root; the
        // model-supplied savePath survives only as a sanitized subfolder name.
        const downloadRoot = path.join(os.homedir(), ".agentic-os", "downloads", "gmail");
        const subdir = validatedArgs.savePath
          ? path.basename(validatedArgs.savePath).replace(/[^a-zA-Z0-9._ -]/g, "_")
          : "";
        const savePath = subdir ? path.join(downloadRoot, subdir) : downloadRoot;
        let filename = validatedArgs.filename;

        if (!filename) {
          const messageResponse = await gmail.users.messages.get({
            userId: "me",
            id: validatedArgs.messageId,
            format: "full",
          });
          const findAttachment = (part: GmailMessagePart): string | null => {
            if (part.body && part.body.attachmentId === validatedArgs.attachmentId) {
              return part.filename || `attachment-${validatedArgs.attachmentId}`;
            }
            if (part.parts) {
              for (const subpart of part.parts) {
                const found = findAttachment(subpart);
                if (found) return found;
              }
            }
            return null;
          };
          filename =
            findAttachment((messageResponse.data.payload as GmailMessagePart) || {}) ||
            `attachment-${validatedArgs.attachmentId}`;
        }

        // basename + charset scrub: no traversal, no absolute paths, no
        // reserved characters — an email-supplied name is untrusted input.
        filename = path.basename(filename).replace(/[^a-zA-Z0-9._ -]/g, "_") || "attachment";
        if (!fs.existsSync(savePath)) {
          fs.mkdirSync(savePath, { recursive: true });
        }
        let fullPath = path.join(savePath, filename);
        // Never overwrite (house rule: nothing is destroyed) — suffix instead.
        if (fs.existsSync(fullPath)) {
          const ext = path.extname(filename);
          const stem = filename.slice(0, filename.length - ext.length);
          let n = 1;
          do {
            fullPath = path.join(savePath, `${stem} (${n})${ext}`);
            n++;
          } while (fs.existsSync(fullPath));
        }
        fs.writeFileSync(fullPath, buffer);

        return {
          text: `Attachment downloaded successfully:\nFile: ${filename}\nSize: ${buffer.length} bytes\nSaved to: ${fullPath}`,
        };
      } catch (error) {
        // upstream soft-returns this one explicitly (kept for parity)
        return {
          text: `Failed to download attachment: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    }

    default:
      // Unknown tool = caller contract violation → LOUD (decision 6).
      throw new ConnectorConfigError(`unknown tool '${name}'`);
  }
}
