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
  let sql = 'SELECT * FROM agent_opinions WHERE 1=1';
  const params = [];
  if (agent_id) { sql += ' AND agent_id = ?'; params.push(Number(agent_id)); }
  sql += ' ORDER BY id DESC';
  return NextResponse.json(db.prepare(sql).all(...params) || []);
}

export async function POST(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = await getDb();
  const body = await request.json();
  if (!body.agent_id || !body.claim?.trim()) {
    return NextResponse.json({ error: 'agent_id and claim required' }, { status: 400 });
  }
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO agent_opinions (agent_id, claim, confidence, evidence_memory_id, status, created_at) VALUES (?, ?, ?, ?, 'held', ?)`
  ).run(
    Number(body.agent_id),
    body.claim.trim(),
    body.confidence ?? null,
    body.evidence_memory_id ?? null,
    now
  );
  const id = result.lastInsertRowid;
  appendAuditLog(db, { actor: gate.ctx.actor, action: 'agent_opinion.create', resource_type: 'agent_opinion', resource_id: id });
  return NextResponse.json(db.prepare('SELECT * FROM agent_opinions WHERE id = ?').get(id), { status: 201 });
}
