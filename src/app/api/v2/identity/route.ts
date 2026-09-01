import { NextResponse, type NextRequest } from "next/server";
import {
  agentDirectory, ensureUserId, getAgent, listAgents, persistsFor,
  principalHome, PERSIST_CREDENTIALS_WARNING, displayFor,
} from "@/lib/v2/identity/principals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { headers: { "cache-control": "no-store" } };

/**
 * GET  — who exists, what they are called, and whether their logins persist.
 *
 * Returns DISPLAY names alongside ids: the id encodes lineage and is what the
 * enforcement layer compares, but no surface should ever render it.
 */
export async function GET() {
  const userId = ensureUserId();
  return NextResponse.json(
    {
      ok: true,
      user: { id: userId, ref: `user:${userId}`, display: displayFor(`user:${userId}`) },
      agents: agentDirectory().map((a) => ({
        ...a,
        persists: persistsFor(a.ref),
        // The folder is shown so the human can see WHERE a login lives, which
        // is the honest way to present "we are storing your session".
        home: principalHome(a.ref),
        subAgents: listAgents().filter((x) => x.parentId === a.id).length,
      })),
      warning: PERSIST_CREDENTIALS_WARNING,
    },
    noStore,
  );
}

/**
 * PATCH { agentId, persistCredentials } — flip the persist answer after the fact.
 *
 * Only a ROOT agent can be toggled. Sub-agents inherit, so offering the choice
 * on one would be a control that silently does nothing.
 */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { agentId?: unknown; persistCredentials?: unknown }
    | null;
  const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
  if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400, ...noStore });

  const rec = getAgent(agentId);
  if (!rec) return NextResponse.json({ error: `Agent "${agentId}" is not registered` }, { status: 404, ...noStore });
  if (rec.origin === "subagent") {
    return NextResponse.json(
      {
        error:
          `${displayFor(`agent:${agentId}`)} is a sub-agent — it uses its orchestrator's ` +
          `credential folder, so persistence is set on the agent that spawned it.`,
      },
      { status: 400, ...noStore },
    );
  }

  // The registry is the source of truth; settings only carries profile owners.
  const { listAgents: all, principalsPath } = await import("@/lib/v2/identity/principals");
  const fs = await import("node:fs");
  const raw = JSON.parse(fs.readFileSync(principalsPath(), "utf8")) as { agents?: unknown[] };
  const agents = all().map((a) =>
    a.id === agentId ? { ...a, persistCredentials: body?.persistCredentials === true } : a,
  );
  fs.writeFileSync(principalsPath(), JSON.stringify({ ...raw, agents }, null, 2) + "\n");

  return NextResponse.json({ ok: true, agentId, persistCredentials: body?.persistCredentials === true }, noStore);
}

/**
 * POST { action: "repair", agentId } — retry credential provisioning for an
 * agent whose creation left it degraded (see AgentDef.provisioning).
 *
 * Separate from PATCH, which changes what the user WANTS. This changes nothing
 * the user decided; it re-attempts what the system failed to do.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; agentId?: unknown }
    | null;
  if (body?.action !== "repair") {
    return NextResponse.json({ error: 'action must be "repair"' }, { status: 400, ...noStore });
  }
  const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
  if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400, ...noStore });

  const { repairAgentProvisioning } = await import("@/lib/agentsStore");
  const r = await repairAgentProvisioning(agentId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400, ...noStore });
  return NextResponse.json(
    { ok: true, agentId, repaired: r.repaired === true, message: r.repaired ? "Provisioning repaired." : "Nothing to repair." },
    noStore,
  );
}
