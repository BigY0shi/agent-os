export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireRole } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';

export async function GET(request, { params }) {
  const gate = requireRole(request, 'viewer');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const pipelineId = Number(params.id);
    if (Number.isNaN(pipelineId)) {
      return NextResponse.json({ error: 'invalid pipeline id' }, { status: 400 });
    }

    const rows = db
      .prepare('SELECT * FROM pipeline_runs WHERE pipeline_id = ? ORDER BY id DESC LIMIT 200')
      .all(pipelineId);
    return NextResponse.json(rows || []);
  } catch (error) {
    console.error('GET /api/pipelines/[id]/runs error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const gate = requireRole(request, 'agent-runtime');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const pipelineId = Number(params.id);
    if (Number.isNaN(pipelineId)) {
      return NextResponse.json({ error: 'invalid pipeline id' }, { status: 400 });
    }

    const p = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(pipelineId);
    if (!p) {
      return NextResponse.json({ error: 'pipeline not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const input_json = JSON.stringify(body.input ?? body ?? {});
    const now = new Date().toISOString();
    const triggered_by = body.triggered_by || gate.ctx.actor;

    const result = db
      .prepare(
        `INSERT INTO pipeline_runs (pipeline_id, status, input_json, started_at, triggered_by) VALUES (?, 'queued', ?, ?, ?)`
      )
      .run(pipelineId, input_json, now, triggered_by);

    const runId = result.lastInsertRowid;
    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'pipeline.run.create',
      resource_type: 'pipeline_run',
      resource_id: runId,
      meta: { pipeline_id: pipelineId },
    });

    const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId);
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error('POST /api/pipelines/[id]/runs error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
