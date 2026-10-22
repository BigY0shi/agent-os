import { NextResponse } from "next/server";
import { resolveModel, localChat, extractHtml, hasExternalScripts } from "@/lib/localOllama";
import { recordBuild } from "@/lib/kanbanStore";
import { cliComplete } from "@/lib/loopEngine";
import { startModuleRun } from "@/lib/moduleRuns";
import { readSettings } from "@/lib/settings";
import { withSkills, skillBlock } from "@/lib/platformSkills";
import { resolveLaunchOptions, parseLaunchOptions, launchTimeoutMs, withInstructions, describeLaunch } from "@/lib/launchOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MODULE = "agent-kanban" as const;

// The Builder agent — turns one card into a complete single-file HTML.
//
// POST { id, title, brief, goal, launch? }  (legacy: { ..., agent }). `launch`
// (roadmap S3) picks the seat, the skills for this run, the guardrails and the
// instructions; it is validated strictly. Guardrail "noExternalScripts" changes
// the brief AND the Reviewer: a build that still pulls a script or stylesheet
// off the page is rejected, not approved. One run per card in the tray; STOP
// kills the CLI child / aborts the Ollama fetch and the client loop halts.
function builderSys(noExternal: boolean): string {
  return (
    "You are the Builder on a small team. Build EXACTLY what the card asks as ONE complete, self-contained HTML document. " +
    "Inline all CSS in <style> and all JS in <script>. It must run on its own with no build step and no external local files " +
    (noExternal
      ? "and NO external resources at all: no CDN <script src>, no external stylesheet, no @import, no remote fonts. Everything inline. "
      : "(CDN <script src> is fine). ") +
    "Make it look good — dark background, a bold accent colour, clean layout. " +
    "Output ONLY the HTML in a single ```html code block. No explanation."
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { id?: unknown; title?: unknown; brief?: unknown; goal?: unknown; agent?: unknown; launch?: unknown };
  const { id, title, brief, goal } = body;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (typeof title !== "string" || !title.trim()) return NextResponse.json({ error: "missing title" }, { status: 400 });

  let rawLaunch = body.launch;
  if (rawLaunch === undefined && typeof body.agent === "string") {
    const legacy = parseLaunchOptions(MODULE, { agent: body.agent.replace(/^cli:/, "") || "local" });
    if (!legacy.ok) return NextResponse.json({ ok: false, model: body.agent, bytes: 0, verdict: "error", note: `${body.agent} is not wired for Agent Kanban. Use Claude, Codex, Cursor, Pi, Hermes, or Local team.` }, { status: 400 });
    rawLaunch = legacy.value;
  }
  const launch = resolveLaunchOptions(MODULE, rawLaunch, readSettings().launch?.[MODULE]);
  if (!launch.ok) return NextResponse.json({ ok: false, error: `launch: ${launch.error}`, verdict: "error", note: `launch: ${launch.error}` }, { status: 400 });
  const L = launch.value;
  const useCli = L.agent !== "local";
  const noExternal = L.guardrails.noExternalScripts === true;
  const prompt = `Card: ${title}\nBuild: ${typeof brief === "string" && brief ? brief : title}`;

  const run = startModuleRun(
    { module: MODULE, label: `Build card: ${String(title).slice(0, 80)} (${describeLaunch(MODULE, L)})`, href: "/agent-kanban" },
    async (ctx) => {
      const model = useCli ? `cli:${L.agent}` : await resolveModel();
      ctx.log(`builder ${model}${noExternal ? " · no external scripts" : ""}${L.skills.length ? ` · skills ${L.skills.join(", ")}` : ""}`);
      const sys = withInstructions(builderSys(noExternal), L);
      const raw = useCli
        ? await cliComplete(L.agent, withSkills(`${sys}\n\n${prompt}`, MODULE, undefined, L.skills), { timeoutMs: launchTimeoutMs(L, 240_000), signal: ctx.signal })
        : await localChat(model, `${skillBlock(MODULE, undefined, L.skills)}${sys}`, prompt, { temperature: 0.5, signal: ctx.signal });
      const html = extractHtml(raw);
      // The Reviewer: verify a real, renderable HTML artifact actually came out.
      const ok = !!html && /<(html|body|canvas|svg|div|style)/i.test(html) && html.length > 120;
      if (!ok) {
        ctx.log("reviewer: no usable HTML");
        return { ok: false as const, model, bytes: 0, verdict: "rejected", note: "no usable HTML came back — the model may have rambled instead of building" };
      }
      if (noExternal && hasExternalScripts(html!)) {
        ctx.log("reviewer: external resource found; guardrail says no");
        return { ok: false as const, model, bytes: 0, verdict: "rejected", note: "the build pulls a script or stylesheet off the page, and the launch said no external scripts" };
      }
      if (ctx.signal.aborted) throw new Error("stopped before the build was saved");
      const bytes = Buffer.byteLength(html!);
      // Save into the durable workspace (survives reload + reboot, unlike /tmp).
      await recordBuild({ id, title: String(title).slice(0, 80), brief: String(brief ?? "").slice(0, 240), goal: String(goal ?? "").slice(0, 160), model, bytes, createdAt: Date.now() }, html!);
      ctx.log(`saved ${bytes} bytes`);
      return { ok: true as const, model, bytes, verdict: "approved", note: "real HTML in your workspace — verified" };
    },
    { summarize: (r) => ({ verdict: r.verdict, bytes: r.bytes, model: r.model }) },
  );
  try {
    const r = await run.promise;
    return NextResponse.json({ ...r, runId: run.id });
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") return NextResponse.json({ ok: false, stopped: true, bytes: 0, verdict: "stopped", note: err.message, runId: run.id }, { status: 409 });
    return NextResponse.json({ ok: false, bytes: 0, verdict: "error", note: String(err.message).slice(0, 160), runId: run.id }, { status: 502 });
  }
}
