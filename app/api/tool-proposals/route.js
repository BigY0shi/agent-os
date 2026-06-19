export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const agent_id = searchParams.get('agent_id');
    let sql = 'SELECT * FROM tool_proposals WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (agent_id) { sql += ' AND agent_id = ?'; params.push(Number(agent_id)); }
    sql += ' ORDER BY id DESC LIMIT 200';
    return NextResponse.json(db.prepare(sql).all(...params) || []);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const db = await getDb();
    const body = await request.json();
    const name = (body.name || '').trim();
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const now = new Date().toISOString();
    const status = body.status === 'submitted' ? 'submitted' : 'draft';
    const result = db.prepare(
      `INSERT INTO tool_proposals (agent_id, name, spec_json, risk_class, tests_checklist, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      body.agent_id ?? null,
      name,
      body.spec_json ? JSON.stringify(body.spec_json) : body.spec ?? null,
      body.risk_class || 'low',
      body.tests_checklist ? JSON.stringify(body.tests_checklist) : null,
      status,
      now
    );
    const id = result.lastInsertRowid;
    appendAuditLog(db, { actor: gate.ctx.actor, action: 'tool_proposal.create', resource_type: 'tool_proposal', resource_id: id });
    return NextResponse.json(db.prepare('SELECT * FROM tool_proposals WHERE id = ?').get(id), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
