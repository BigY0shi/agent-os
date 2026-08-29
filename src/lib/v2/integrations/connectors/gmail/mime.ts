import fs from "node:fs";
import path from "node:path";

/**
 * SPEC-D G3.1 — verbatim-adapt of AOC integrations/gmail/src/mcp/util.ts
 * (createEmailMessage, header encoding, validation) plus a hand-rolled
 * multipart/mixed builder replacing upstream's nodemailer dependency for the
 * attachments path (nodemailer is NOT a sanctioned dep this chunk; Gmail's
 * messages.send only needs a raw RFC822 string, which ~60 lines of MIME
 * assembly produce deterministically).
 *
 * Also hosts the message-content extraction + tz-aware date helpers ported
 * from AOC mcp/index.ts so tools.ts stays dispatch-focused.
 */

// ─── Types ports (AOC mcp/index.ts) ─────────────────────────────────────────

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
}

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface EmailContent {
  text: string;
  html: string;
}

export interface EmailArgs {
  to: string[];
  subject: string;
  body: string;
  htmlBody?: string;
  mimeType?: string;
  cc?: string[];
  bcc?: string[];
  threadId?: string;
  inReplyTo?: string;
  attachments?: string[];
}

// ─── Header/address helpers (verbatim AOC util.ts) ───────────────────────────

/** RFC 2047 MIME-word encoding for non-ASCII headers. */
export function encodeEmailHeader(text: string): string {
  if (/[^\x00-\x7F]/.test(text)) {
    return "=?UTF-8?B?" + Buffer.from(text).toString("base64") + "?=";
  }
  return text;
}

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/** Gmail wants base64url without padding for `raw` messages. */
export function encodeRawMessage(message: string): string {
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── Simple (no-attachment) message builder (verbatim AOC util.ts) ──────────

export function createEmailMessage(validatedArgs: EmailArgs): string {
  const encodedSubject = encodeEmailHeader(validatedArgs.subject);
  // Determine content type based on available content and explicit mimeType
  let mimeType = validatedArgs.mimeType || "text/plain";

  // If htmlBody is provided and mimeType isn't explicitly text/plain,
  // use multipart/alternative to include both versions
  if (validatedArgs.htmlBody && mimeType !== "text/plain") {
    mimeType = "multipart/alternative";
  }

  const boundary = `----=_NextPart_${Math.random().toString(36).substring(2)}`;

  validatedArgs.to.forEach((email) => {
    if (!validateEmail(email)) {
      throw new Error(`Recipient email address is invalid: ${email}`);
    }
  });

  const emailParts = [
    "From: me",
    `To: ${validatedArgs.to.join(", ")}`,
    validatedArgs.cc ? `Cc: ${validatedArgs.cc.join(", ")}` : "",
    validatedArgs.bcc ? `Bcc: ${validatedArgs.bcc.join(", ")}` : "",
    `Subject: ${encodedSubject}`,
    validatedArgs.inReplyTo ? `In-Reply-To: ${validatedArgs.inReplyTo}` : "",
    validatedArgs.inReplyTo ? `References: ${validatedArgs.inReplyTo}` : "",
    "MIME-Version: 1.0",
  ].filter(Boolean);

  if (mimeType === "multipart/alternative") {
    emailParts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    emailParts.push("");

    emailParts.push(`--${boundary}`);
    emailParts.push("Content-Type: text/plain; charset=UTF-8");
    emailParts.push("Content-Transfer-Encoding: 7bit");
    emailParts.push("");
    emailParts.push(validatedArgs.body);
    emailParts.push("");

    emailParts.push(`--${boundary}`);
    emailParts.push("Content-Type: text/html; charset=UTF-8");
    emailParts.push("Content-Transfer-Encoding: 7bit");
    emailParts.push("");
    emailParts.push(validatedArgs.htmlBody || validatedArgs.body);
    emailParts.push("");

    emailParts.push(`--${boundary}--`);
  } else if (mimeType === "text/html") {
    emailParts.push("Content-Type: text/html; charset=UTF-8");
    emailParts.push("Content-Transfer-Encoding: 7bit");
    emailParts.push("");
    emailParts.push(validatedArgs.htmlBody || validatedArgs.body);
  } else {
    emailParts.push("Content-Type: text/plain; charset=UTF-8");
    emailParts.push("Content-Transfer-Encoding: 7bit");
    emailParts.push("");
    emailParts.push(validatedArgs.body);
  }

  return emailParts.join("\r\n");
}

// ─── Attachment message builder (nodemailer replacement) ─────────────────────

const EXT_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function guessMime(filename: string): string {
  return EXT_MIME[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

/** Wrap base64 at 76 chars per RFC 2045. */
function wrapBase64(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

/**
 * Build a raw RFC822 message with file attachments (multipart/mixed wrapping
 * the body — multipart/alternative when an htmlBody is present). Replaces
 * upstream's createEmailWithNodemailer with the same input contract: throws
 * when an attachment path does not exist.
 */
export function createEmailWithAttachments(validatedArgs: EmailArgs): string {
  validatedArgs.to.forEach((email) => {
    if (!validateEmail(email)) {
      throw new Error(`Recipient email address is invalid: ${email}`);
    }
  });

  const attachments = (validatedArgs.attachments ?? []).map((filePath) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    const filename = path.basename(filePath);
    return {
      filename,
      mimeType: guessMime(filename),
      data: fs.readFileSync(filePath).toString("base64"),
    };
  });

  const mixedBoundary = `----=_Mixed_${Math.random().toString(36).substring(2)}`;
  const altBoundary = `----=_Alt_${Math.random().toString(36).substring(2)}`;

  const parts: string[] = [
    "From: me",
    `To: ${validatedArgs.to.join(", ")}`,
    validatedArgs.cc?.length ? `Cc: ${validatedArgs.cc.join(", ")}` : "",
    validatedArgs.bcc?.length ? `Bcc: ${validatedArgs.bcc.join(", ")}` : "",
    `Subject: ${encodeEmailHeader(validatedArgs.subject)}`,
    validatedArgs.inReplyTo ? `In-Reply-To: ${validatedArgs.inReplyTo}` : "",
    validatedArgs.inReplyTo ? `References: ${validatedArgs.inReplyTo}` : "",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
  ].filter(Boolean);
  parts.push(""); // blank line separating headers from the first part

  // Body part(s)
  if (validatedArgs.htmlBody) {
    parts.push(`--${mixedBoundary}`);
    parts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    parts.push("");
    parts.push(`--${altBoundary}`);
    parts.push("Content-Type: text/plain; charset=UTF-8");
    parts.push("Content-Transfer-Encoding: 7bit");
    parts.push("");
    parts.push(validatedArgs.body);
    parts.push("");
    parts.push(`--${altBoundary}`);
    parts.push("Content-Type: text/html; charset=UTF-8");
    parts.push("Content-Transfer-Encoding: 7bit");
    parts.push("");
    parts.push(validatedArgs.htmlBody);
    parts.push("");
    parts.push(`--${altBoundary}--`);
  } else {
    parts.push(`--${mixedBoundary}`);
    parts.push(
      validatedArgs.mimeType === "text/html"
        ? "Content-Type: text/html; charset=UTF-8"
        : "Content-Type: text/plain; charset=UTF-8",
    );
    parts.push("Content-Transfer-Encoding: 7bit");
    parts.push("");
    parts.push(validatedArgs.body);
    parts.push("");
  }

  // Attachment parts
  for (const att of attachments) {
    parts.push(`--${mixedBoundary}`);
    parts.push(`Content-Type: ${att.mimeType}; name="${encodeEmailHeader(att.filename)}"`);
    parts.push("Content-Transfer-Encoding: base64");
    parts.push(
      `Content-Disposition: attachment; filename="${encodeEmailHeader(att.filename)}"`,
    );
    parts.push("");
    parts.push(wrapBase64(att.data));
    parts.push("");
  }
  parts.push(`--${mixedBoundary}--`);

  return parts.join("\r\n");
}

// ─── Content extraction (verbatim AOC mcp/index.ts) ─────────────────────────

/** Recursively extract email body content from MIME message parts. */
export function extractEmailContent(messagePart: GmailMessagePart): EmailContent {
  let textContent = "";
  let htmlContent = "";

  if (messagePart.body && messagePart.body.data) {
    const content = Buffer.from(messagePart.body.data, "base64").toString("utf8");
    if (messagePart.mimeType === "text/plain") {
      textContent = content;
    } else if (messagePart.mimeType === "text/html") {
      htmlContent = content;
    }
  }

  if (messagePart.parts && messagePart.parts.length > 0) {
    for (const part of messagePart.parts) {
      const { text, html } = extractEmailContent(part);
      if (text) textContent += text;
      if (html) htmlContent += html;
    }
  }

  return { text: textContent, html: htmlContent };
}

/** Collect attachment metadata from a message payload (verbatim shape). */
export function collectAttachments(payload: GmailMessagePart | undefined): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];
  const walk = (part: GmailMessagePart) => {
    if (part.body && part.body.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        filename: part.filename || `attachment-${part.body.attachmentId}`,
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body.size || 0,
      });
    }
    part.parts?.forEach(walk);
  };
  if (payload) walk(payload);
  return attachments;
}

// ─── Tz-aware date rewriting (verbatim AOC mcp/index.ts — recon gotcha kept) ─

/**
 * Convert a YYYY/MM/DD (or parseable) date string to seconds since epoch at
 * midnight in the given IANA timezone.
 */
export function dateToSecondsInTimezone(dateStr: string, timezone?: string): number {
  const dateMatch = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  let year: string, month: string, day: string;

  if (dateMatch) {
    [, year, month, day] = dateMatch;
  } else {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      // Invalid date, return current time
      return Math.floor(Date.now() / 1000);
    }
    year = date.getFullYear().toString();
    month = (date.getMonth() + 1).toString().padStart(2, "0");
    day = date.getDate().toString().padStart(2, "0");
  }

  if (timezone) {
    const isoDateStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`;
    const date = new Date(isoDateStr);
    const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate = new Date(date.toLocaleString("en-US", { timeZone: timezone }));
    const offset = utcDate.getTime() - tzDate.getTime();
    const adjustedDate = new Date(date.getTime() + offset);
    return Math.floor(adjustedDate.getTime() / 1000);
  }

  const date = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`);
  return Math.floor(date.getTime() / 1000);
}

/**
 * Rewrite Gmail query date operators (after:, before:, newer:, older:,
 * newer_than:, older_than:) to Unix timestamps in the user's timezone.
 */
export function convertQueryDatesToTimezone(query: string, timezone?: string): string {
  if (!timezone) return query;
  const dateOperatorRegex =
    /(after|before|newer|older|newer_than|older_than):(\d{4}\/\d{1,2}\/\d{1,2})/gi;
  return query.replace(dateOperatorRegex, (match, operator: string, dateStr: string) => {
    const timestamp = dateToSecondsInTimezone(dateStr, timezone);
    return `${operator}:${timestamp}`;
  });
}
