export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeRead, authorizeWrite } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { honchoListPeers, honchoGetOrCreatePeer } from '@/lib/honchoClient';
import { getRuntimeEndpoints } from '@/lib/runtimeEndpoints';
import { appendAuditLog } from '@/lib/audit';

export async function GET(request) {
  const gate = authorizeRead(request, 'viewer');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const db = await getDb();
    const ep = getRuntimeEndpoints();
    const hosts = db.prepare('SELECT * FROM honcho_hosts ORDER BY id').all() || [];
    const live = await honchoListPeers(ep.honchoWorkspace);
    const livePeers = live.ok
      ? (Array.isArray(live.data) ? live.data : live.data?.items || [])
      : [];

    return NextResponse.json({
      workspace: ep.honchoWorkspace,
      user_peer: ep.honchoUserPeer,
      ai_peer_hermes: ep.honchoAiPeer,
      hosts,
      live_peers: livePeers,
      live_error: live.ok ? null : live.error || live.status,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const body = await request.json();
    const slug = body.slug;
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

    const db = await getDb();
    const host = db.prepare('SELECT * FROM honcho_hosts WHERE slug = ?').get(slug);
    if (!host) return NextResponse.json({ error: 'unknown host slug' }, { status: 404 });

    const ep = getRuntimeEndpoints();
    const peerId = body.ai_peer || host.ai_peer;
    const res = await honchoGetOrCreatePeer(peerId, {
      label: host.label,
      harness: host.harness,
      metadata: { label: host.label, harness: host.harness, agent_os_slug: slug },
    });

    const now = new Date().toISOString();
    if (res.ok) {
      db.prepare(
        `UPDATE honcho_hosts SET enabled = 1, honcho_peer_id = ?, registered_at = ?, updated_at = ? WHERE slug = ?`
      ).run(peerId, now, now, slug);
      appendAuditLog(db, {
        actor: gate.ctx.actor,
        action: 'honcho.peer.register',
        resource_type: 'honcho_host',
        resource_id: host.id,
        meta: { peer_id: peerId, workspace: ep.honchoWorkspace },
      });
    }

    return NextResponse.json({
      ok: res.ok,
      slug,
      peer_id: peerId,
      honcho: res.data,
      status: res.status,
      error: res.ok ? null : res.error || `HTTP ${res.status}`,
    }, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
