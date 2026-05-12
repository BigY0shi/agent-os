export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireRole } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';

const LAYERS = ['working', 'mid', 'long', 'artifact'];
const SENS = ['public', 'internal', 'confidential'];

function logMemoryAccess(db, { memory_id, actor, action, meta }) {
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO memory_access_log (memory_id, actor, action, created_at, meta) VALUES (?, ?, ?, ?, ?)`
  ).run(memory_id ?? null, actor, action, created_at, JSON.stringify(meta ?? {}));
}

export async function GET(request) {
  const gate = requireRole(request, 'viewer');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const layer = searchParams.get('layer');
    const agent_id = searchParams.get('agent_id');
    const team_id = searchParams.get('team_id');
    const q = searchParams.get('q');

    let sql = 'SELECT * FROM memory_entries WHERE status = \'active\'';
    const params = [];

    if (layer) {
      sql += ' AND layer = ?';
      params.push(layer);
    }
    if (agent_id) {
      sql += ' AND (agent_id = ? OR agent_id IS NULL)';
      params.push(Number(agent_id));
    }
    if (team_id) {
      sql += ' AND (team_id = ? OR team_id IS NULL)';
      params.push(team_id);
    }
    if (q) {
      sql += ' AND (title LIKE ? OR content LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like);
    }

    sql += ' ORDER BY updated_at DESC, id DESC LIMIT 500';

    const rows = db.prepare(sql).all(...params);
    return NextResponse.json(rows || []);
  } catch (error) {
    console.error('GET /api/memory error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = requireRole(request, 'agent-runtime');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const body = await request.json();
    const {
      layer = 'working',
      title = '',
      content = '',
      tags = [],
      agent_id = null,
      team_id = null,
      sensitivity = 'internal',
      embedding_ref = null,
    } = body;

    if (!LAYERS.includes(layer)) {
      return NextResponse.json({ error: 'invalid layer' }, { status: 400 });
    }
    if (!SENS.includes(sensitivity)) {
      return NextResponse.json({ error: 'invalid sensitivity' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const tagsStr = typeof tags === 'string' ? tags : JSON.stringify(tags ?? []);

    const result = db
      .prepare(
        `INSERT INTO memory_entries (layer, title, content, tags, agent_id, team_id, sensitivity, status, embedding_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
      )
      .run(
        layer,
        title,
        content,
        tagsStr,
        agent_id == null ? null : Number(agent_id),
        team_id,
        sensitivity,
        embedding_ref,
        now,
        now
      );

    const id = result.lastInsertRowid;
    logMemoryAccess(db, {
      memory_id: id,
      actor: gate.ctx.actor,
      action: 'write',
      meta: { layer },
    });
    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'memory.create',
      resource_type: 'memory',
      resource_id: id,
      meta: { layer },
    });

    const row = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id);
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error('POST /api/memory error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
