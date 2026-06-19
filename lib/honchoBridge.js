import { appendAuditLog } from '@/lib/audit';
import { honchoListConclusions } from '@/lib/honchoClient';
import { getRuntimeEndpoints } from '@/lib/runtimeEndpoints';

/**
 * Pull Honcho conclusions into memory_entries (idempotent by external_id).
 * @param {import('sql.js').Database} db
 */
export async function syncHonchoConclusionsToMemory(db, actor, options = {}) {
  const ep = getRuntimeEndpoints();
  const observerId = options.observerId || ep.honchoUserPeer;
  const observedId = options.observedId || ep.honchoUserPeer;
  const agentId = options.agentId ?? null;
  const limit = options.limit ?? 100;

  const res = await honchoListConclusions({
    observerId,
    observedId,
    limit,
    workspaceId: options.workspaceId,
  });

  if (!res.ok) {
    return { ok: false, error: res.error || `Honcho HTTP ${res.status}`, status: res.status };
  }

  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const c of res.items || []) {
    const externalId = c.id;
    const content = (c.content || '').trim();
    if (!externalId || !content) {
      skipped += 1;
      continue;
    }

    const title = `Honcho: ${content.slice(0, 80)}${content.length > 80 ? '…' : ''}`;
    const existing = db
      .prepare('SELECT id FROM memory_entries WHERE source = ? AND external_id = ?')
      .get('honcho', String(externalId));

    if (existing) {
      db.prepare(
        `UPDATE memory_entries SET title = ?, content = ?, updated_at = ? WHERE id = ?`
      ).run(title, content, now, existing.id);
      updated += 1;
    } else {
      db.prepare(
        `INSERT INTO memory_entries (layer, title, content, tags, agent_id, team_id, sensitivity, status, source, external_id, created_at, updated_at)
         VALUES ('long', ?, ?, ?, ?, NULL, 'internal', 'active', 'honcho', ?, ?, ?)`
      ).run(
        title,
        content,
        JSON.stringify(['honcho', 'synced']),
        agentId,
        String(externalId),
        now,
        now
      );
      created += 1;
    }
  }

  appendAuditLog(db, {
    actor,
    action: 'honcho.sync',
    resource_type: 'honcho',
    meta: { created, updated, skipped, observerId, observedId },
  });

  return { ok: true, created, updated, skipped, total: (res.items || []).length };
}
