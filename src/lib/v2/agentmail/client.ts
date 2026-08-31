// AgentMail REST client. Every call rides config.agentmailFetch(), which is the
// only holder of the API key — this module never sees it.
//
// Non-2xx is LOUD (AgentMailError with the status + a body snippet): a send
// that silently failed would mean an agent believing it had reached a human.

import { agentmailFetch, agentmailInbox, AgentMailError } from "./config";

export { AgentMailError };

export interface AgentMailMessage {
  messageId: string;
  threadId: string | null;
  from: string;
  to: string;
  subject: string;
  preview: string;
  /** ISO UTC. */
  timestamp: string;
  labels: string[];
}

interface MessageWire {
  message_id?: unknown;
  thread_id?: unknown;
  from?: unknown;
  to?: unknown;
  subject?: unknown;
  preview?: unknown;
  text?: unknown;
  timestamp?: unknown;
  created_at?: unknown;
  labels?: unknown;
}

/** A `to` may arrive as a string or an array; normalise to one display string. */
function addr(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(", ");
  return "";
}

function toMessage(raw: unknown): AgentMailMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as MessageWire;
  if (typeof w.message_id !== "string") return null;
  return {
    messageId: w.message_id,
    threadId: typeof w.thread_id === "string" ? w.thread_id : null,
    from: addr(w.from),
    to: addr(w.to),
    subject: typeof w.subject === "string" ? w.subject : "(no subject)",
    // `preview` is what list returns; `text` appears on a fetched message.
    preview: typeof w.text === "string" ? w.text : typeof w.preview === "string" ? w.preview : "",
    timestamp:
      typeof w.timestamp === "string"
        ? w.timestamp
        : typeof w.created_at === "string"
          ? w.created_at
          : new Date(0).toISOString(),
    labels: Array.isArray(w.labels) ? w.labels.filter((x): x is string => typeof x === "string") : [],
  };
}

/** Responses come back either bare or wrapped in {data|messages|items}. */
function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const k of ["messages", "data", "items"]) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}

/** Send from the configured inbox. `to` may be one address or several. */
export async function sendMessage(input: {
  to: string | string[];
  subject: string;
  text: string;
}): Promise<{ messageId: string | null }> {
  const inbox = agentmailInbox();
  const res = (await agentmailFetch(`/inboxes/${encodeURIComponent(inbox)}/messages/send`, {
    method: "POST",
    body: { to: input.to, subject: input.subject, text: input.text },
  })) as Record<string, unknown>;
  const id = res?.message_id ?? res?.id;
  return { messageId: typeof id === "string" ? id : null };
}

/** Every message in the inbox, newest first as the API returns them. */
export async function listMessages(): Promise<AgentMailMessage[]> {
  const payload = await agentmailFetch(`/inboxes/${encodeURIComponent(agentmailInbox())}/messages`);
  return unwrapList(payload)
    .map(toMessage)
    .filter((m): m is AgentMailMessage => m !== null);
}

/** One message with its full body — list only carries a preview. */
export async function getMessage(messageId: string): Promise<AgentMailMessage | null> {
  const payload = await agentmailFetch(
    `/inboxes/${encodeURIComponent(agentmailInbox())}/messages/${encodeURIComponent(messageId)}`,
  );
  return toMessage(payload && typeof payload === "object" && "message" in payload
    ? (payload as Record<string, unknown>).message
    : payload);
}

/**
 * Claim the agent with the 6-digit code emailed to the human at sign-up.
 *
 * The field is `otp_code`, not `otp`, and the API regex-checks it as ^\d{6}$ —
 * so a wrong FIELD NAME fails as "invalid_format on otp_code", which reads like
 * a bad code rather than a bad request. Recorded because it cost real time.
 */
export async function verifyAgent(otpCode: string): Promise<{ verified: boolean }> {
  const res = (await agentmailFetch(`/agent/verify`, {
    method: "POST",
    body: { otp_code: String(otpCode).trim() },
  })) as Record<string, unknown>;
  return { verified: res?.verified === true };
}

export interface AgentMailOrg {
  organizationId: string;
  verified: boolean;
  dailySendLimit: number;
  inboxLimit: number;
  plan: string;
}

/** Claim status + the limits it unlocks. Used by the UI status strip. */
export async function getOrganization(): Promise<AgentMailOrg | null> {
  const o = (await agentmailFetch(`/organizations`)) as Record<string, unknown>;
  if (!o || typeof o.organization_id !== "string") return null;
  return {
    organizationId: o.organization_id,
    verified: o.agent_verified === true,
    dailySendLimit: typeof o.daily_send_limit === "number" ? o.daily_send_limit : 0,
    inboxLimit: typeof o.inbox_limit === "number" ? o.inbox_limit : 0,
    plan: typeof o.billing_plan_id === "string" ? o.billing_plan_id : "unknown",
  };
}
