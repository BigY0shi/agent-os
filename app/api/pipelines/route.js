export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';
import { validatePipelineDefinition } from '@/lib/pipelineValidate';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    let sql = 'SELECT * FROM pipelines WHERE 1=1';
    const params = [];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY updated_at DESC, id DESC';
    const rows = db.prepare(sql).all(...params);
    return NextResponse.json(rows || []);
  } catch (error) {
    console.error('GET /api/pipelines error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const body = await request.json();
    const name = (body.name || '').trim();
    let def = body.definition;
    if (typeof body.definition_json === 'string') {
      try {
        def = JSON.parse(body.definition_json);
      } catch {
        return NextResponse.json({ error: 'definition_json must be valid JSON' }, { status: 400 });
      }
    }

    const validated = validatePipelineDefinition(def);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const definition_json = JSON.stringify(validated.def);
    const description = body.description || '';
    const status = body.status && ['draft', 'active', 'archived'].includes(body.status) ? body.status : 'draft';

    const result = db
      .prepare(
        `INSERT INTO pipelines (name, description, definition_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(name, description, definition_json, status, now, now);

    const id = result.lastInsertRowid;
    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'pipeline.create',
      resource_type: 'pipeline',
      resource_id: id,
      meta: { name },
    });

    const row = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error('POST /api/pipelines error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
