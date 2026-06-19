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
  const existing = db.prepare('SELECT * FROM agent_opinions WHERE id = ?').get(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await request.json();
  db.prepare(
    `UPDATE agent_opinions SET claim = ?, confidence = ?, evidence_memory_id = ?, status = ? WHERE id = ?`
  ).run(
    body.claim ?? existing.claim,
    body.confidence !== undefined ? body.confidence : existing.confidence,
    body.evidence_memory_id !== undefined ? body.evidence_memory_id : existing.evidence_memory_id,
    body.status ?? existing.status,
    id
  );
  appendAuditLog(db, { actor: gate.ctx.actor, action: 'agent_opinion.update', resource_type: 'agent_opinion', resource_id: id });
  return NextResponse.json(db.prepare('SELECT * FROM agent_opinions WHERE id = ?').get(id));
}

export async function DELETE(request, { params }) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = await getDb();
  const id = Number(params.id);
  db.prepare('DELETE FROM agent_opinions WHERE id = ?').run(id);
  return NextResponse.json({ ok: true, id });
}
