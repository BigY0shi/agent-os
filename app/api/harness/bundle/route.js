export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { buildHarnessBundle } from '@/lib/harnessBundle';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');
    const agentIds = agentId ? [Number(agentId)] : undefined;
    const format = searchParams.get('format') || 'json';

    const db = await getDb();
    const bundle = buildHarnessBundle(db, {
      agentIds,
      includePipelines: searchParams.get('pipelines') !== '0',
    });

    if (format === 'manifest') {
      return NextResponse.json(bundle.manifest);
    }

    return NextResponse.json({
      manifest: bundle.manifest,
      files: bundle.files,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
