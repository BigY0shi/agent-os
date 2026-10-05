// Idea Engine seat routing (owner, 2026-09-30: "It should default to Claude, fallback to
// codex. Add the setting." and "Every parameter needs to be in the settings").
// Which agent fills the sizing seat, the clustering step and the kill pass, and which agent
// steps in when one fails, all come from settings.ideaEngine. A fallback is the owner's
// choice and is always recorded in what the run reports (rule 20); "none" means the seat
// fails with its reason.
import { cliComplete, LOOP_CLI_AGENTS } from "./loopEngine";
import { seatComplete, resolveKimiModel } from "./brainstorm";

/** CLI agents that answer one-shot (antigravity's `agy -p` prints nothing to a pipe), plus
 *  "kimi" on Ollama Cloud (model from settings.ideaEngine.kimiModel). */
export const IDEA_AGENTS = [...LOOP_CLI_AGENTS.filter((a) => a !== "antigravity"), "kimi"] as const;

export interface IdeaAgents { sizing: string; cluster: string; kill: string; fallback: string }

/** The seat agents from settings, with the owner's stated defaults. */
export function ideaAgents(s: { sizingAgent?: string; clusterAgent?: string; killAgent?: string; fallbackAgent?: string } | undefined): IdeaAgents {
  const pick = (v: string | undefined, d: string) => (v || "").trim().toLowerCase() || d;
  return {
    sizing: pick(s?.sizingAgent, "claude"),
    cluster: pick(s?.clusterAgent, "claude"),
    kill: pick(s?.killAgent, "codex"),
    fallback: pick(s?.fallbackAgent, "codex"),
  };
}

export interface SeatRun {
  text: string;
  /** Who really answered, e.g. "claude", "kimi:kimi-k2.6:cloud", or "codex (fallback: ...)". */
  used: string;
  fellBackFrom?: string;
  reason?: string;
}

type RunOpts = { timeoutMs: number; kimiModel?: string; cli?: typeof cliComplete; kimi?: typeof seatComplete; resolveKimi?: typeof resolveKimiModel };

async function runOne(agent: string, prompt: string, o: RunOpts): Promise<{ text: string; used: string }> {
  if (agent === "kimi") {
    const km = await (o.resolveKimi ?? resolveKimiModel)(o.kimiModel);
    const text = await (o.kimi ?? seatComplete)("kimi", prompt, km);
    return { text, used: `kimi:${km}` };
  }
  if (!(IDEA_AGENTS as readonly string[]).includes(agent)) {
    throw new Error(`"${agent}" is not an Idea Engine agent (use one of: ${IDEA_AGENTS.join(", ")})`);
  }
  // Written out (not `(o.cli ?? cliComplete)(...)`) so the module-skills wiring stays visible:
  // the Idea Engine's skills reach every CLI seat through module: "idea-engine".
  const text = o.cli
    ? await o.cli(agent, prompt, { timeoutMs: o.timeoutMs, module: "idea-engine" })
    : await cliComplete(agent, prompt, { timeoutMs: o.timeoutMs, module: "idea-engine" });
  return { text, used: agent };
}

/**
 * Run one seat on `primary`; if it fails (or answers nothing) and the owner set a
 * different fallback agent, run that and say so in `used`. Throws with every reason when
 * nothing answers, so the caller records the seat as failed (never a faked output).
 * `cli` / `kimi` / `resolveKimi` are test seams so a smoke never launches a real, billed agent.
 */
export async function runSeat(primary: string, fallback: string, prompt: string, o: RunOpts): Promise<SeatRun> {
  let reason: string;
  try {
    const r = await runOne(primary, prompt, o);
    if (r.text.trim()) return r;
    reason = "returned nothing";
  } catch (e) {
    reason = String((e as Error)?.message || e).slice(0, 200);
  }
  if (!fallback || fallback === "none" || fallback === primary) {
    throw new Error(`${primary} failed: ${reason}${fallback === "none" ? " (no fallback set)" : ""}`);
  }
  let r: { text: string; used: string };
  try { r = await runOne(fallback, prompt, o); }
  catch (e) { throw new Error(`${primary} failed: ${reason}; fallback ${fallback} failed too: ${String((e as Error)?.message || e).slice(0, 200)}`); }
  if (!r.text.trim()) throw new Error(`${primary} failed: ${reason}; fallback ${fallback} returned nothing`);
  return { ...r, used: `${r.used} (fallback: ${primary} failed: ${reason.slice(0, 120)})`, fellBackFrom: primary, reason };
}
