export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = await getDb();
  const { searchParams } = new URL(request.url);
  const agent_id = searchParams.get('agent_id');
  const status = searchParams.get('status');
  let sql = 'SELECT * FROM agent_goals WHERE 1=1';
  const params = [];
  if (agent_id) { sql += ' AND agent_id = ?'; params.push(Number(agent_id)); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY priority DESC, id DESC';
  return NextResponse.json(db.prepare(sql).all(...params) || []);
}

export async function POST(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = await getDb();
  const body = await request.json();
  if (!body.agent_id || !body.title?.trim()) {
    return NextResponse.json({ error: 'agent_id and title required' }, { status: 400 });
  }
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO agent_goals (agent_id, title, body, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    Number(body.agent_id),
    body.title.trim(),
    body.body || '',
    Number(body.priority) || 0,
    body.status || 'active',
    now,
    now
  );
  const id = result.lastInsertRowid;
  appendAuditLog(db, { actor: gate.ctx.actor, action: 'agent_goal.create', resource_type: 'agent_goal', resource_id: id });
  return NextResponse.json(db.prepare('SELECT * FROM agent_goals WHERE id = ?').get(id), { status: 201 });
}
