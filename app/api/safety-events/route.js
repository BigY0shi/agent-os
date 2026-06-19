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
  const status = searchParams.get('status');
  const agent_id = searchParams.get('agent_id');
  let sql = 'SELECT * FROM safety_events WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (agent_id) { sql += ' AND agent_id = ?'; params.push(Number(agent_id)); }
  sql += ' ORDER BY id DESC LIMIT 200';
  return NextResponse.json(db.prepare(sql).all(...params) || []);
}

export async function POST(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = await getDb();
  const body = await request.json();
  const message = (body.message || '').trim();
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO safety_events (agent_id, severity, kind, message, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)`
  ).run(body.agent_id ?? null, body.severity || 'med', body.kind || 'policy', message, now);
  const id = result.lastInsertRowid;
  appendAuditLog(db, { actor: gate.ctx.actor, action: 'safety_event.create', resource_type: 'safety_event', resource_id: id });
  return NextResponse.json(db.prepare('SELECT * FROM safety_events WHERE id = ?').get(id), { status: 201 });
}
