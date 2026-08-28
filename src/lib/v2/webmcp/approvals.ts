import { getDb } from "../db";
import { uuid, now } from "../ids";
import { emit } from "../events";
import { redactArgs } from "../redact";
import { readPackageSecrets } from "./secrets";
import { WebmcpError } from "./store";
import { appendJarvisMessage, getConversation } from "../jarvis/conversations";

/**
 * SPEC-C Human-Gate (Phase-4 chunk 2) — pending-approval records for
 * requires_approval tools invoked INTERACTIVELY (Jarvis lane / hub interactive).
 *
 * Model:
 *  - webmcp/execute.ts's published-lane gate (and the jarvis execute_action
 *    registry gate in jarvis/tools.ts) create a PENDING row instead of the old
 *    interactive refusal, and return an approval-required result naming the id.
 *  - Non-interactive/strict callers keep the HARD REFUSE (no record).
 *  - §9.4 taint STILL WINS: jarvis gateTaint refuses BEFORE any hub/registry
 *    call, so a tainted session never reaches this module (smoke-asserted).
 *  - approve EXECUTES the tool now (source 'human-gate', published lane with
 *    the `approved` bypass; 'registry' rows run the registry handler), stores
 *    the result on the record, and appends a follow-up system message to the
 *    originating jarvis conversation when one is linked.
 *  - Records expire after ~10 minutes; acting on an expired record → 410.
 *
 * args_json keeps the RAW (already schema-validated) args for execution;
 * redacted_args_json (redactArgs, CONVENTIONS §9.3) is the only variant that
 * routes/UI ever see.
 */

export const APPROVAL_TTL_MS = 10 * 60 * 1000;

/** Reserved slug marker for plain F4-registry action keys (no webmcp package). */
export const REGISTRY_SLUG = "registry";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalResultInfo {
  ok: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export interface WebmcpApproval {
  id: string;
  slug: string;
  tool: string;
  /** RAW args — execution-side only. NEVER include in route responses. */
  args: Record<string, unknown>;
  redactedArgs: Record<string, unknown>;
  requestedBy: string;
  conversationId: string | null;
  status: ApprovalStatus;
  result: ApprovalResultInfo | null;
  createdAt: string;
  resolvedAt: string | null;
  expiresAt: string;
}

/** The route/UI-safe projection (raw args stripped). */
export interface PublicApproval {
  id: string;
  slug: string;
  tool: string;
  redactedArgs: Record<string, unknown>;
  requestedBy: string;
  conversationId: string | null;
  status: ApprovalStatus;
  result: ApprovalResultInfo | null;
  createdAt: string;
  resolvedAt: string | null;
  expiresAt: string;
}

interface Row {
  id: string;
  slug: string;
  tool: string;
  args_json: string;
  redacted_args_json: string;
  requested_by: string;
  conversation_id: string | null;
  status: ApprovalStatus;
  result_json: string | null;
  created_at: string;
  resolved_at: string | null;
  expires_at: string;
}

function parse(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function map(r: Row): WebmcpApproval {
  let result: ApprovalResultInfo | null = null;
  if (r.result_json) {
    try {
      result = JSON.parse(r.result_json) as ApprovalResultInfo;
    } catch {
      /* malformed tolerated → null */
    }
  }
  return {
    id: r.id,
    slug: r.slug,
    tool: r.tool,
    args: parse(r.args_json),
    redactedArgs: parse(r.redacted_args_json),
    requestedBy: r.requested_by,
    conversationId: r.conversation_id,
    status: r.status,
    result,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    expiresAt: r.expires_at,
  };
}

export function toPublicApproval(a: WebmcpApproval): PublicApproval {
  // Deliberate omission of `args` — raw values never leave the server.
  return {
    id: a.id,
    slug: a.slug,
    tool: a.tool,
    redactedArgs: a.redactedArgs,
    requestedBy: a.requestedBy,
    conversationId: a.conversationId,
    status: a.status,
    result: a.result,
    createdAt: a.createdAt,
    resolvedAt: a.resolvedAt,
    expiresAt: a.expiresAt,
  };
}

/** Lazy expiry sweep: pending rows past expires_at flip to 'expired'. */
export function expireStaleApprovals(): number {
  const ts = now();
  const info = getDb()
    .prepare(
      "UPDATE webmcp_approvals SET status = 'expired', resolved_at = ? WHERE status = 'pending' AND expires_at < ?",
    )
    .run(ts, ts);
  return info.changes;
}

export function createApproval(input: {
  slug: string;
  tool: string;
  args: Record<string, unknown>;
  requestedBy: string;
  conversationId?: string | null;
}): WebmcpApproval {
  const ts = now();
  const secretValues =
    input.slug === REGISTRY_SLUG ? [] : Object.values(readPackageSecrets(input.slug));
  const row: Row = {
    id: uuid(),
    slug: input.slug,
    tool: input.tool,
    args_json: JSON.stringify(input.args ?? {}),
    redacted_args_json: JSON.stringify(redactArgs(input.args ?? {}, secretValues)),
    requested_by: input.requestedBy,
    conversation_id: input.conversationId ?? null,
    status: "pending",
    result_json: null,
    created_at: ts,
    resolved_at: null,
    expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO webmcp_approvals
         (id, slug, tool, args_json, redacted_args_json, requested_by, conversation_id, status, result_json, created_at, resolved_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id, row.slug, row.tool, row.args_json, row.redacted_args_json,
      row.requested_by, row.conversation_id, row.status, row.result_json,
      row.created_at, row.resolved_at, row.expires_at,
    );

  const approval = map(row);
  emit(
    "webmcp.approval",
    { id: approval.id, slug: approval.slug, tool: approval.tool, status: "pending", requestedBy: approval.requestedBy },
    "webmcp",
  );
  emit(
    "attention.flag",
    {
      kind: "webmcp.approval",
      severity: "warn",
      title: `Approval needed: ${approval.slug === REGISTRY_SLUG ? approval.tool : `${approval.slug}/${approval.tool}`}`,
      route: "/webmcp",
      dedupeKey: approval.id,
    },
    "webmcp",
  );
  return approval;
}

export function getApproval(id: string): WebmcpApproval | null {
  expireStaleApprovals();
  const r = getDb().prepare("SELECT * FROM webmcp_approvals WHERE id = ?").get(id) as Row | undefined;
  return r ? map(r) : null;
}

export function listApprovals(filter: { status?: ApprovalStatus; limit?: number } = {}): WebmcpApproval[] {
  expireStaleApprovals();
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const rows = filter.status
    ? (getDb()
        .prepare("SELECT * FROM webmcp_approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?")
        .all(filter.status, limit) as Row[])
    : (getDb()
        .prepare("SELECT * FROM webmcp_approvals ORDER BY created_at DESC LIMIT ?")
        .all(limit) as Row[]);
  return rows.map(map);
}

function persistResolution(id: string, status: ApprovalStatus, result: ApprovalResultInfo | null): void {
  getDb()
    .prepare("UPDATE webmcp_approvals SET status = ?, result_json = ?, resolved_at = ? WHERE id = ?")
    .run(status, result ? JSON.stringify(result) : null, now(), id);
}

async function executeApproved(a: WebmcpApproval): Promise<ApprovalResultInfo> {
  if (a.slug === REGISTRY_SLUG) {
    // Plain F4-registry action key (e.g. 'tasks_update_status').
    const started = Date.now();
    const [
      { ensureCoreActions },
      { ensureMemoryActions },
      { ensureTaskActions },
      { ensureIntegrationMetaActions },
      { getAction },
    ] = await Promise.all([
      import("../mcp/actions"),
      import("../memory/mcpTools"),
      import("../mcp/taskActions"),
      import("../integrations/metaTools"),
      import("../mcp/registry"),
    ]);
    ensureCoreActions();
    ensureMemoryActions();
    ensureTaskActions();
    ensureIntegrationMetaActions(); // G4: approve on 'execute_integration_action' must resolve its handler
    const action = getAction(a.tool);
    if (!action) {
      return { ok: false, output: "", error: `action '${a.tool}' is no longer registered`, durationMs: Date.now() - started };
    }
    try {
      const r = await action.handler(a.args, { source: "human-gate", strict: false });
      return { ok: r.ok, output: r.output ?? "", error: r.error, durationMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }
  // Published-lane execution with the human-gate bypass (lazy import breaks the
  // approvals↔execute module cycle).
  const { executeTool } = await import("./execute");
  const r = await executeTool(a.slug, a.tool, a.args, {
    source: "human-gate",
    interactive: true,
    approved: true,
  });
  return { ok: r.ok, output: r.output, error: r.error, durationMs: r.durationMs };
}

function followUpMessage(a: WebmcpApproval, action: "approve" | "deny", result: ApprovalResultInfo | null): void {
  if (!a.conversationId) return;
  try {
    if (!getConversation(a.conversationId)) return;
    const label = a.slug === REGISTRY_SLUG ? a.tool : `${a.slug}/${a.tool}`;
    const content =
      action === "deny"
        ? `[human-gate] '${label}' was DENIED by the user — not executed.`
        : result?.ok
          ? `[human-gate] '${label}' approved and executed.\nResult: ${(result.output || "(empty output)").slice(0, 1500)}`
          : `[human-gate] '${label}' approved but execution FAILED: ${(result?.error ?? "unknown error").slice(0, 600)}`;
    appendJarvisMessage({
      conversationId: a.conversationId,
      role: "system",
      content,
      toolCalls: [
        {
          name: label,
          summary:
            action === "deny"
              ? "denied by user"
              : result?.ok
                ? (result.output || "ok").slice(0, 300)
                : `failed: ${(result?.error ?? "error").slice(0, 280)}`,
          ok: action === "approve" && result?.ok === true,
        },
      ],
    });
  } catch (err) {
    console.warn(
      "[v2/webmcp] approval follow-up message failed (non-blocking):",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Resolve one pending approval. 'approve' executes the tool NOW and stores the
 * result on the record; 'deny' resolves without execution. Errors:
 *   404 unknown id · 410 expired · 409 already resolved.
 */
export async function resolveApproval(
  id: string,
  action: "approve" | "deny",
): Promise<{ approval: WebmcpApproval; result: ApprovalResultInfo | null }> {
  const a = getApproval(id);
  if (!a) throw new WebmcpError("approval not found", 404);
  if (a.status === "expired") throw new WebmcpError("approval expired — ask again", 410);
  if (a.status !== "pending") throw new WebmcpError(`approval already ${a.status}`, 409);

  if (action === "deny") {
    persistResolution(a.id, "denied", null);
    emit("webmcp.approval", { id: a.id, slug: a.slug, tool: a.tool, status: "denied" }, "webmcp");
    followUpMessage(a, "deny", null);
    const denied = getApproval(a.id)!;
    return { approval: denied, result: null };
  }

  const result = await executeApproved(a);
  persistResolution(a.id, "approved", result);
  emit(
    "webmcp.approval",
    { id: a.id, slug: a.slug, tool: a.tool, status: "approved", ok: result.ok },
    "webmcp",
  );
  followUpMessage(a, "approve", result);
  const approved = getApproval(a.id)!;
  return { approval: approved, result };
}
