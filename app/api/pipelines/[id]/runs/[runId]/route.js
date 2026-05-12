export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeWrite } from '@/lib/authz';
import { appendAuditLog } from '@/lib/audit';

const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];

export async function PATCH(request, { params }) {
  const gate = authorizeWrite(request, 'agent-runtime');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const pipelineId = Number(params.id);
    const runId = Number(params.runId);
    if (Number.isNaN(pipelineId) || Number.isNaN(runId)) {
      return NextResponse.json({ error: 'invalid ids' }, { status: 400 });
    }

    const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ? AND pipeline_id = ?').get(runId, pipelineId);
    if (!run) {
      return NextResponse.json({ error: 'run not found' }, { status: 404 });
    }

    const body = await request.json();
    const status = body.status;
    if (!status || !STATUSES.includes(status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const output_json = body.output != null ? JSON.stringify(body.output) : run.output_json;
    const err = body.error != null ? String(body.error) : run.error;

    let started_at = run.started_at;
    if (status === 'running' && !started_at) {
      started_at = now;
    }

    let finished_at = run.finished_at;
    if (['succeeded', 'failed', 'cancelled'].includes(status)) {
      finished_at = now;
    }

    db.prepare(
      `UPDATE pipeline_runs SET status = ?, output_json = ?, error = ?, started_at = ?, finished_at = ? WHERE id = ?`
    ).run(status, output_json, err, started_at, finished_at, runId);

    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: 'pipeline.run.update',
      resource_type: 'pipeline_run',
      resource_id: runId,
      meta: { status, pipeline_id: pipelineId },
    });

    return NextResponse.json(db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId));
  } catch (e) {
    console.error('PATCH pipeline run error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
