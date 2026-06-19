export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { authorizeRead } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { honchoListConclusions } from '@/lib/honchoClient';
import { getRuntimeEndpoints } from '@/lib/runtimeEndpoints';

export async function GET(request) {
  const gate = authorizeRead(request, 'operator', { allowAnonymousViewer: false });
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const { searchParams } = new URL(request.url);
    const ep = getRuntimeEndpoints();
    const observerId = searchParams.get('observer_id') || ep.honchoUserPeer;
    const observedId = searchParams.get('observed_id') || ep.honchoUserPeer;
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

    const res = await honchoListConclusions({ observerId, observedId, limit });
    if (!res.ok) {
      return NextResponse.json(
        { error: res.error || `Honcho unreachable (${res.status})`, status: res.status },
        { status: 502 }
      );
    }

    return NextResponse.json({
      items: res.items || [],
      observer_id: observerId,
      observed_id: observedId,
      workspace: ep.honchoWorkspace,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
