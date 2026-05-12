/**
 * Append a row to audit_log using the DbWrapper from lib/db.js
 */
export function appendAuditLog(db, { actor, action, resource_type = null, resource_id = null, meta = null }) {
  const created_at = new Date().toISOString();
  const metaStr = typeof meta === 'string' ? meta : JSON.stringify(meta ?? {});
  db.prepare(
    `INSERT INTO audit_log (actor, action, resource_type, resource_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(actor, action, resource_type, resource_id == null ? null : String(resource_id), metaStr, created_at);
}
