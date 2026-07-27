// Capability profile for the BUILDING modules — the ones that produce a real
// deliverable (Pipeline's artifact build, Deal Desk proposals), as opposed to the
// chat surfaces where a plain answer is the whole job.
//
// Two things separate a builder from a chatter:
//
// 1. PERMISSIONS. `claude -p` is non-interactive, so any tool that would raise an
//    approval prompt is DENIED — there is nobody to ask. The practical effect is
//    subtle and worth stating: personal skills still load and still shape the
//    answer, but the moment one reaches for Bash or Write it stalls. So a module
//    can look like it "has skills" while being unable to act on any of them.
//    --dangerously-skip-permissions is the same posture the other generative
//    routes (SEO, Thumbnails, Oracle, News Radar) already run with.
//
// 2. DELEGATION. Left alone, one model attempts the entire job itself. The
//    directive below points it at the user's multi-agent-mcp-orchestration skill
//    so separable parts go to other CLI agents (different model lineages) and this
//    model's job becomes planning and integration.
//
// Deliberately NOT applied to short structured calls — Pipeline's classifier emits
// ~200 tokens of JSON, and convening a council to produce {"route":"idea"} would
// cost minutes and buy nothing.

/**
 * Appended to the system prompt (claude) or prepended to the prompt (other CLIs).
 * Phrased to respect the skill's own guard — it says it is "not for small
 * single-agent fixes", so this must not turn every one-liner into a fan-out.
 */
export const ORCHESTRATION_DIRECTIVE = [
  'You have a personal skill named "multi-agent-mcp-orchestration". Load it and follow it.',
  "It runs other models on this machine as bounded worker agents by shelling out to their",
  "headless CLIs (codex exec, hermes -z, agy -p, openclaw agent, claude -p).",
  "",
  "Operating rule for this task: you are the MANAGER, not the sole author. When the work has",
  "three or more separable parts — research, drafting, code, copy, review — delegate those",
  "parts to different CLI agents, run them in parallel where they do not depend on each other,",
  "and own the integration yourself. Prefer a different model lineage for review than the one",
  "that produced the work, so the critique is genuinely independent.",
  "",
  "Do it single-handedly only when the task is genuinely small. The skill itself says it is",
  "not for small single-agent fixes — honour that rather than fanning out on reflex.",
].join("\n");

/**
 * Flags that turn a `claude -p` call into a builder.
 * Claude-only: --append-system-prompt has no verified equivalent on the other CLIs,
 * so callers hand those the directive through the prompt instead.
 */
export function claudeBuilderArgs(opts?: { orchestrate?: boolean }): string[] {
  const args = ["--dangerously-skip-permissions"];
  if (opts?.orchestrate) args.push("--append-system-prompt", ORCHESTRATION_DIRECTIVE);
  return args;
}
