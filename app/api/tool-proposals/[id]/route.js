export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';

export async function GET(request, { params }) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const db = await getDb();
  const row = db.prepare('SELECT * FROM tool_proposals WHERE id = ?').get(Number(params.id));
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(request, { params }) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const db = await getDb();
    const id = Number(params.id);
    const existing = db.prepare('SELECT * FROM tool_proposals WHERE id = ?').get(id);
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const body = await request.json();
    const action = body.action;
    const now = new Date().toISOString();
    const resolver = body.resolver || gate.ctx.actor;

    if (action === 'approve') {
      db.prepare(`UPDATE tool_proposals SET status = 'approved', resolved_at = ?, resolver = ? WHERE id = ?`).run(now, resolver, id);
      if (body.version) {
        db.prepare(
          `INSERT INTO tool_releases (proposal_id, version, artifact_ref, notes, created_at) VALUES (?, ?, ?, ?, ?)`
        ).run(id, body.version, body.artifact_ref || null, body.notes || null, now);
      }
      appendAuditLog(db, { actor: gate.ctx.actor, action: 'tool_proposal.approve', resource_type: 'tool_proposal', resource_id: id });
    } else if (action === 'reject') {
      db.prepare(`UPDATE tool_proposals SET status = 'rejected', resolved_at = ?, resolver = ? WHERE id = ?`).run(now, resolver, id);
      appendAuditLog(db, { actor: gate.ctx.actor, action: 'tool_proposal.reject', resource_type: 'tool_proposal', resource_id: id });
    } else if (body.status) {
      db.prepare('UPDATE tool_proposals SET status = ? WHERE id = ?').run(body.status, id);
    }

    return NextResponse.json(db.prepare('SELECT * FROM tool_proposals WHERE id = ?').get(id));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
