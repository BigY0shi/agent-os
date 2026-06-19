export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { authorizeRead } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { getRuntimeEndpoints } from '@/lib/runtimeEndpoints';
import { honchoHealth, honchoListPeers, honchoListWorkspaces } from '@/lib/honchoClient';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const ep = getRuntimeEndpoints();
    const health = await honchoHealth();
    const [workspaces, peers] = await Promise.all([
      honchoListWorkspaces(),
      honchoListPeers(ep.honchoWorkspace),
    ]);

    return NextResponse.json({
      health,
      config: {
        baseUrl: ep.honcho,
        workspace: ep.honchoWorkspace,
        userPeer: ep.honchoUserPeer,
        aiPeer: ep.honchoAiPeer,
        apiKeyConfigured: !!ep.honchoApiKey,
      },
      workspaces: workspaces.ok ? workspaces.data : null,
      peers: peers.ok ? (peers.data?.items || peers.data) : null,
      workspacesError: workspaces.ok ? null : workspaces.error || workspaces.status,
      peersError: peers.ok ? null : peers.error || peers.status,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
