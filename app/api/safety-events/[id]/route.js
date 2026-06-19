export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';

export async function PATCH(request, { params }) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = await getDb();
  const id = Number(params.id);
  const existing = db.prepare('SELECT * FROM safety_events WHERE id = ?').get(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await request.json();
  const now = new Date().toISOString();
  const status = body.status;
  if (!['open', 'mitigated', 'overridden'].includes(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  db.prepare(
    `UPDATE safety_events SET status = ?, mitigation = ?, resolved_at = ? WHERE id = ?`
  ).run(status, body.mitigation ?? existing.mitigation, now, id);

  appendAuditLog(db, {
    actor: gate.ctx.actor,
    action: `safety_event.${status}`,
    resource_type: 'safety_event',
    resource_id: id,
  });

  return NextResponse.json(db.prepare('SELECT * FROM safety_events WHERE id = ?').get(id));
}
