export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authorizeWrite } from '@/lib/authz';
import { jsonAuthError } from '@/lib/httpAuth';
import { appendAuditLog } from '@/lib/audit';
import { buildHarnessBundle } from '@/lib/harnessBundle';
import { pushBundleToGateway, buildDeployHints } from '@/lib/harnessPush';

export async function POST(request) {
  const gate = authorizeWrite(request, 'operator');
  if (!gate.ok) return jsonAuthError(gate);

  try {
    const body = await request.json().catch(() => ({}));
    const target = body.target === 'openclaw' ? 'openclaw' : 'hermes';
    const agentId = body.agent_id != null ? Number(body.agent_id) : null;

    const db = await getDb();
    const bundle = buildHarnessBundle(db, {
      agentIds: agentId ? [agentId] : undefined,
      includePipelines: body.pipelines !== false,
    });

    const push = await pushBundleToGateway(bundle, target);
    const hints = buildDeployHints(target);

    appendAuditLog(db, {
      actor: gate.ctx.actor,
      action: push.ok ? 'harness.push.ok' : 'harness.push.attempt',
      resource_type: 'harness_bundle',
      meta: {
        target,
        agent_id: agentId,
        ok: push.ok,
        url: push.url,
        attempts: push.attempts?.length,
      },
    });

    return NextResponse.json({
      ok: push.ok,
      target,
      pushed: push.ok,
      gateway: push.url || null,
      status: push.status,
      attempts: push.attempts,
      error: push.error,
      manifest: bundle.manifest,
      deploy: hints,
      fallback: push.ok
        ? null
        : 'HTTP push failed — use deploy.pullOnRuntime on the runtime LXC or deploy.rsyncHint',
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
