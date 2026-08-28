import type { NewActivity, SyncCtx, SyncResult } from "../../types";
import { githubRequest } from "./client";

/**
 * SPEC-D G3.4 — GitHub sync: notifications + assigned-issues poll (30 min).
 *
 * Watermarks (state):
 * - `notifLastModified` — the notifications endpoint's Last-Modified header,
 *   replayed as If-Modified-Since; a 304 is a NORMAL empty run (no error, no
 *   state change) — GitHub doesn't even charge rate-limit for it.
 * - `notifCursor` — max notification updated_at seen (belt to Last-Modified:
 *   a 200 can still contain rows we already turned into activities).
 * - `issueCursor` — max assigned-issue updated_at (also passed as ?since=).
 *
 * Watermark discipline: cursors move ONLY on progress (state-on-progress-only,
 * gmail precedent). `notifLastModified` is persisted whenever the header
 * CHANGES even without fresh rows — it is a transport optimization token, not
 * a progress watermark (same carve-out as gmail's `emailAddress` identity key).
 * Top-level API failures THROW to the driver (sync_run error + 'sync.failed').
 */

type AnyRecord = Record<string, unknown>;

interface GithubSyncState {
  notifLastModified?: string;
  notifCursor?: string; // ISO
  issueCursor?: string; // ISO
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function githubSync(ctx: SyncCtx): Promise<SyncResult> {
  const token = ctx.config.token;
  if (!token) return { activities: [] }; // no credential → nothing to do

  const state = ctx.state as GithubSyncState;
  const activities: NewActivity[] = [];
  const newState: Record<string, string> = {};

  // ── 1. Notifications (If-Modified-Since + 304 empty path) ─────────────────
  const notifRes = await githubRequest(token, "GET", "/notifications", {
    params: { all: "false", per_page: "50" },
    headers: state.notifLastModified ? { "if-modified-since": state.notifLastModified } : {},
    allowStatuses: [304],
  });

  if (notifRes.status !== 304) {
    const cursorMs = state.notifCursor ? new Date(state.notifCursor).getTime() : 0;
    let maxUpdated = cursorMs;
    for (const n of (notifRes.data as AnyRecord[]) || []) {
      const updatedAt = String(n.updated_at ?? "");
      const updatedMs = new Date(updatedAt).getTime();
      if (!Number.isFinite(updatedMs) || updatedMs <= cursorMs) continue;
      if (updatedMs > maxUpdated) maxUpdated = updatedMs;
      const repo = String((n.repository as AnyRecord)?.full_name ?? "unknown repo");
      const subject = (n.subject as AnyRecord) || {};
      const title = String(subject.title ?? "(no title)");
      const type = String(subject.type ?? "Notification");
      activities.push({
        text: `GitHub notification (${n.reason}) in ${repo}: ${type} "${title}" — updated ${updatedAt}`,
        sourceURL: String((n.repository as AnyRecord)?.html_url ?? "") || undefined,
        eventType: "GITHUB_NOTIFICATION",
        payload: {
          id: String(n.id ?? ""),
          reason: String(n.reason ?? ""),
          repo,
          title,
          type,
          updatedAt,
        },
      });
    }
    if (maxUpdated > cursorMs) {
      newState.notifCursor = new Date(maxUpdated).toISOString();
    }
    // Transport token — persist on change even without fresh rows (see header).
    const lastModified = notifRes.headers["last-modified"];
    if (lastModified && lastModified !== state.notifLastModified) {
      newState.notifLastModified = lastModified;
    }
  }

  // ── 2. Assigned issues (?since= + updated-cursor watermark) ───────────────
  const issueSince =
    state.issueCursor || new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString();
  const issuesRes = await githubRequest(token, "GET", "/issues", {
    params: { filter: "assigned", state: "open", per_page: "50", since: issueSince },
  });
  {
    const cursorMs = state.issueCursor ? new Date(state.issueCursor).getTime() : 0;
    let maxUpdated = cursorMs;
    for (const issue of (issuesRes.data as AnyRecord[]) || []) {
      if (issue.pull_request) continue; // /issues includes PRs — issues only
      const updatedAt = String(issue.updated_at ?? "");
      const updatedMs = new Date(updatedAt).getTime();
      if (!Number.isFinite(updatedMs) || updatedMs <= cursorMs) continue;
      if (updatedMs > maxUpdated) maxUpdated = updatedMs;
      const repo = String(
        ((issue.repository as AnyRecord)?.full_name as string) ??
          String(issue.repository_url ?? "").replace(/^.*\/repos\//, ""),
      );
      activities.push({
        text: `GitHub issue assigned to you: ${repo}#${issue.number} "${issue.title}" — updated ${updatedAt}`,
        sourceURL: String(issue.html_url ?? "") || undefined,
        eventType: "GITHUB_ISSUE_ASSIGNED",
        payload: {
          number: Number(issue.number ?? 0),
          title: String(issue.title ?? ""),
          repo,
          state: String(issue.state ?? ""),
          updatedAt,
        },
      });
    }
    if (maxUpdated > cursorMs) {
      newState.issueCursor = new Date(maxUpdated).toISOString();
    }
  }

  return {
    activities,
    ...(Object.keys(newState).length > 0 ? { state: newState } : {}),
  };
}
