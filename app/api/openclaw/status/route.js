export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { authorizeRead } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { openclawHealth, openclawListAgents } from '@/lib/openclawClient';
import { getRuntimeEndpoints } from '@/lib/runtimeEndpoints';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const ep = getRuntimeEndpoints();
    const [health, agents] = await Promise.all([openclawHealth(), openclawListAgents()]);

    return NextResponse.json({
      configured: !!ep.openclaw,
      gateway: ep.openclaw || null,
      health,
      agents: agents.items || [],
      agents_error: agents.ok ? null : agents.error,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
