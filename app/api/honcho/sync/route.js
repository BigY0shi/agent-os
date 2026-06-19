export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeWrite } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { syncHonchoConclusionsToMemory } from '@/lib/honchoBridge';

export async function POST(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const body = await request.json().catch(() => ({}));
    const db = await getDb();
    const result = await syncHonchoConclusionsToMemory(db, gate.ctx.actor, {
      agentId: body.agent_id ?? null,
      observerId: body.observer_id,
      observedId: body.observed_id,
      limit: body.limit,
      workspaceId: body.workspace_id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
