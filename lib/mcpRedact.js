/**
 * Redact MCP server fields that may contain secrets (env, args).
 * @see docs/CODE_REVIEW_REMEDIATION_PLAN.md
 */

const REDACTED = '[REDACTED]';

export function sanitizeMcpServer(row, includeSecrets) {
  if (!row || includeSecrets) return row;
  return {
    ...row,
    env: REDACTED,
    args: REDACTED,
  };
}

export function sanitizeMcpServerList(rows, includeSecrets) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => sanitizeMcpServer(r, includeSecrets));
}
