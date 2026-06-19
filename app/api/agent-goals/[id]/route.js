export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeWrite } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';

export async function PUT(request, { params }) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = await getDb();
  const id = Number(params.id);
  const existing = db.prepare('SELECT * FROM agent_goals WHERE id = ?').get(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await request.json();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agent_goals SET title = ?, body = ?, priority = ?, status = ?, updated_at = ? WHERE id = ?`
  ).run(
    body.title ?? existing.title,
    body.body ?? existing.body,
    body.priority !== undefined ? Number(body.priority) : existing.priority,
    body.status ?? existing.status,
    now,
    id
  );
  appendAuditLog(db, { actor: gate.ctx.actor, action: 'agent_goal.update', resource_type: 'agent_goal', resource_id: id });
  return NextResponse.json(db.prepare('SELECT * FROM agent_goals WHERE id = ?').get(id));
}

export async function DELETE(request, { params }) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = await getDb();
  const id = Number(params.id);
  db.prepare('DELETE FROM agent_goals WHERE id = ?').run(id);
  appendAuditLog(db, { actor: gate.ctx.actor, action: 'agent_goal.delete', resource_type: 'agent_goal', resource_id: id });
  return NextResponse.json({ ok: true, id });
}
