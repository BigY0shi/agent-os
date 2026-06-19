export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead } from '@/lib/authz';

/** Recent runs across all pipelines (Phase B2). */
export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

    const rows = db
      .prepare(
        `SELECT r.*, p.name AS pipeline_name
         FROM pipeline_runs r
         INNER JOIN pipelines p ON p.id = r.pipeline_id
         ORDER BY r.id DESC
         LIMIT ?`
      )
      .all(limit);

    return NextResponse.json(rows || []);
  } catch (error) {
    console.error('GET /api/pipeline-runs error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
