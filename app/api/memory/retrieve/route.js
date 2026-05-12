export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireRole } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';

export async function POST(request) {
  const gate = requireRole(request, 'viewer');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const body = await request.json();
    const query = (body.query || body.q || '').trim();
    const layers = Array.isArray(body.layers) ? body.layers : null;
    const limit = Math.min(Number(body.limit) || 20, 100);
    const agent_id = body.agent_id != null ? Number(body.agent_id) : null;

    if (!query) {
      return NextResponse.json({ error: 'query required' }, { status: 400 });
    }

    let sql = `SELECT * FROM memory_entries WHERE status = 'active' AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)`;
    const like = `%${query}%`;
    const params = [like, like, like];

    if (layers && layers.length > 0) {
      sql += ` AND layer IN (${layers.map(() => '?').join(',')})`;
      params.push(...layers);
    }
    if (agent_id && !Number.isNaN(agent_id)) {
      sql += ' AND (agent_id IS NULL OR agent_id = ?)';
      params.push(agent_id);
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);

    const created_at = new Date().toISOString();
    db.prepare(
      `INSERT INTO memory_access_log (memory_id, actor, action, created_at, meta) VALUES (NULL, ?, 'retrieve', ?, ?)`
    ).run(gate.ctx.actor, created_at, JSON.stringify({ query, layers, limit }));

    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'memory.retrieve',
      resource_type: 'memory',
      meta: { query, hits: rows.length },
    });

    return NextResponse.json({ query, hits: rows });
  } catch (error) {
    console.error('POST /api/memory/retrieve error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
