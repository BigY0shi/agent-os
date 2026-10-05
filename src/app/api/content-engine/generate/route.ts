import { readEngine, patchItem, materialsPrompt, seatForItem, multiModelComplete } from "@/lib/contentEngine";
import type { CouncilSeat } from "@/lib/brainstorm";
import { startModuleRun } from "@/lib/moduleRuns";
import { readSettings } from "@/lib/settings";
import { withSkills } from "@/lib/platformSkills";
import { resolveLaunchOptions, launchTimeoutMs, withInstructions, describeLaunch } from "@/lib/launchOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MODULE = "content-engine" as const;

// POST { id, launch? } → generate the materials (copy / hashtags / image prompt /
// video script) for one calendar slot and mark it drafted.
//
// `launch` is the pre-launch drawer's choice (roadmap S3): seat, skills for
// this run, guardrails, instructions. It is validated STRICTLY (an unknown
// field is a 400, never ignored); when absent the last-used values in
// settings.launch["content-engine"] apply. STOP is the only mid-run control:
// ctx.signal reaches the seat and kills the child CLI.
//
// Multi-model mandate: seat "rotation" picks per item across lineages (codex /
// kimi / claude) so Claude is never the only model producing content; the
// artifact records which model actually wrote it.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { id?: string; launch?: unknown };
  const { id } = body;
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const launch = resolveLaunchOptions(MODULE, body.launch, readSettings().launch?.[MODULE]);
  if (!launch.ok) return Response.json({ ok: false, error: `launch: ${launch.error}` }, { status: 400 });
  const L = launch.value;

  const state = await readEngine();
  const item = state.items.find((i) => i.id === id);
  if (!item) return Response.json({ ok: false, error: "item not found" }, { status: 404 });

  const seat: CouncilSeat = L.agent === "rotation" ? seatForItem(id) : (L.agent as CouncilSeat);

  // The generation is registered as a module run (roadmap S2): if the owner
  // leaves this page, the work continues, the tray shows it, and the drafted
  // materials are there when they come back. This handler still awaits the
  // same promise so the drawer gets its answer as before.
  const run = startModuleRun(
    { module: MODULE, label: `Generate materials: ${item.topic} (${describeLaunch(MODULE, L)})`, href: "/content-engine" },
    async (ctx) => {
      ctx.log(`seat ${seat}${L.skills.length ? ` · skills ${L.skills.join(", ")}` : ""}`);
      const prompt = withSkills(withInstructions(materialsPrompt(item, state.plan?.goals ?? ""), L), MODULE, undefined, L.skills);
      const { text: out, by } = await multiModelComplete(seat, prompt, {
        signal: ctx.signal, timeoutMs: launchTimeoutMs(L), noFallback: L.guardrails.noFallback === true,
      });
      ctx.log(`written by ${by}`);
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("generator did not return JSON");
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(m[0]); } catch { throw new Error("malformed JSON from generator"); }
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
      const materials = {
        copy: str(parsed.copy), hashtags: str(parsed.hashtags),
        imagePrompt: str(parsed.imagePrompt), videoScript: str(parsed.videoScript),
        by, at: Date.now(),
      };
      if (!materials.copy) throw new Error("generator returned no copy");
      if (ctx.signal.aborted) throw new Error("stopped before the materials were saved");
      const updated = await patchItem(id, (it) => ({
        ...it, materials, status: it.status === "planned" ? "drafted" : it.status,
      }));
      if (!updated) throw new Error("item vanished while its materials were being written");
      ctx.log("materials saved; item drafted");
      return updated;
    },
    { summarize: (it) => ({ id: it.id, status: it.status, by: it.materials?.by ?? null }) },
  );
  try {
    const updated = await run.promise;
    return Response.json({ ok: true, item: updated, runId: run.id, launch: L });
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") return Response.json({ ok: false, stopped: true, error: err.message, runId: run.id }, { status: 409 });
    const msg = err.message;
    const status = /did not return JSON|malformed JSON|returned no copy/.test(msg) ? 502 : 500;
    return Response.json({ ok: false, error: msg, runId: run.id }, { status });
  }
}
