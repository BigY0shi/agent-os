export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite, roleMeets } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';
import { memoryRowVisibleToReader } from '@/lib/memoryVisibility';

const LAYERS = ['working', 'mid', 'long', 'artifact'];
const SENS = ['public', 'internal', 'confidential'];

function logMemoryAccess(db, { memory_id, actor, action, meta }) {
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO memory_access_log (memory_id, actor, action, created_at, meta) VALUES (?, ?, ?, ?, ?)`
  ).run(memory_id ?? null, actor, action, created_at, JSON.stringify(meta ?? {}));
}

export async function GET(request, { params }) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const id = Number(params.id);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }

    const row = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id);
    const visible = memoryRowVisibleToReader(row, gate.ctx);
    if (!visible) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    logMemoryAccess(db, {
      memory_id: id,
      actor: gate.ctx.actor,
      action: 'read',
      meta: {},
    });
    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'memory.read',
      resource_type: 'memory',
      resource_id: id,
    });

    return NextResponse.json(visible);
  } catch (error) {
    console.error('GET /api/memory/[id] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const gate = authorizeWrite(request, 'agent-runtime');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const id = Number(params.id);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }

    const existing = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id);
    const visible = memoryRowVisibleToReader(existing, gate.ctx);
    if (!visible) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const body = await request.json();
    const now = new Date().toISOString();

    const operator = roleMeets(gate.ctx.role, 'operator');
    const layer = operator && body.layer !== undefined ? body.layer : existing.layer;
    const title = body.title ?? existing.title;
    const content = body.content ?? existing.content;
    const tags = body.tags != null ? (typeof body.tags === 'string' ? body.tags : JSON.stringify(body.tags)) : existing.tags;
    const agent_id = body.agent_id !== undefined ? (body.agent_id == null ? null : Number(body.agent_id)) : existing.agent_id;
    const team_id = body.team_id !== undefined ? body.team_id : existing.team_id;
    const embedding_ref = body.embedding_ref !== undefined ? body.embedding_ref : existing.embedding_ref;
    const sensitivity = operator && body.sensitivity !== undefined ? body.sensitivity : existing.sensitivity;
    const status = operator && body.status !== undefined ? body.status : existing.status;

    if (!LAYERS.includes(layer)) {
      return NextResponse.json({ error: 'invalid layer' }, { status: 400 });
    }
    if (!SENS.includes(sensitivity)) {
      return NextResponse.json({ error: 'invalid sensitivity' }, { status: 400 });
    }

    db.prepare(
      `UPDATE memory_entries SET layer = ?, title = ?, content = ?, tags = ?, agent_id = ?, team_id = ?, sensitivity = ?, embedding_ref = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(layer, title, content, tags, agent_id, team_id, sensitivity, embedding_ref, status, now, id);

    logMemoryAccess(db, { memory_id: id, actor: gate.ctx.actor, action: 'write', meta: { op: 'update' } });
    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'memory.update',
      resource_type: 'memory',
      resource_id: id,
    });

    const row = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id);
    return NextResponse.json(row);
  } catch (error) {
    console.error('PUT /api/memory/[id] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** Promote layer: body { targetLayer: 'mid'|'long' } — requires operator+ */
export async function PATCH(request, { params }) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const id = Number(params.id);
    const body = await request.json();
    const targetLayer = body.targetLayer;
    if (!LAYERS.includes(targetLayer)) {
      return NextResponse.json({ error: 'invalid targetLayer' }, { status: 400 });
    }

    const existing = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE memory_entries SET layer = ?, promoted_at = ?, updated_at = ? WHERE id = ?`
    ).run(targetLayer, now, now, id);

    logMemoryAccess(db, { memory_id: id, actor: gate.ctx.actor, action: 'promote', meta: { targetLayer } });
    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'memory.promote',
      resource_type: 'memory',
      resource_id: id,
      meta: { targetLayer },
    });

    return NextResponse.json(db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id));
  } catch (error) {
    console.error('PATCH /api/memory/[id] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const id = Number(params.id);
    const existing = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE memory_entries SET status = 'forgotten', forgotten_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);

    logMemoryAccess(db, { memory_id: id, actor: gate.ctx.actor, action: 'forget', meta: {} });
    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'memory.forget',
      resource_type: 'memory',
      resource_id: id,
    });

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error('DELETE /api/memory/[id] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
