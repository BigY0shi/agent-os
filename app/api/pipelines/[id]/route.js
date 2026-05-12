export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';
import { validatePipelineDefinition } from '@/lib/pipelineValidate';

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
    const row = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
    if (!row) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (error) {
    console.error('GET /api/pipelines/[id] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const id = Number(params.id);
    const existing = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const body = await request.json();
    const name = body.name != null ? String(body.name).trim() : existing.name;
    const description = body.description != null ? body.description : existing.description;
    const status =
      body.status && ['draft', 'active', 'archived'].includes(body.status) ? body.status : existing.status;

    let definition_json = existing.definition_json;
    if (body.definition != null || body.definition_json != null) {
      let def = body.definition;
      if (typeof body.definition_json === 'string') {
        def = JSON.parse(body.definition_json);
      }
      const validated = validatePipelineDefinition(def);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      definition_json = JSON.stringify(validated.def);
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE pipelines SET name = ?, description = ?, definition_json = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(name, description, definition_json, status, now, id);

    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'pipeline.update',
      resource_type: 'pipeline',
      resource_id: id,
    });

    return NextResponse.json(db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id));
  } catch (error) {
    console.error('PUT /api/pipelines/[id] error:', error);
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
    const existing = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM pipeline_runs WHERE pipeline_id = ?').run(id);
    db.prepare('DELETE FROM pipelines WHERE id = ?').run(id);

    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'pipeline.delete',
      resource_type: 'pipeline',
      resource_id: id,
    });

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error('DELETE /api/pipelines/[id] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
