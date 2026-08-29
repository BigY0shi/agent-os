// Next.js instrumentation — runs once per server start (nodejs runtime).
// Boots the Agents trigger scheduler so pollers/schedules run without anyone
// having opened the dashboard. Guarded dynamic import keeps node-only code out
// of the edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // FIRST — before anything opens the db, the agents dir, or approvals.json.
    // register() is documented to run once per server instance and to complete
    // before the server accepts requests, so a duplicate dies here without ever
    // having touched shared state.
    const { checkSingleInstance } = await import("./lib/v2/singleInstance");
    const holder = checkSingleInstance();
    if (holder) {
      console.error(
        `[agentos] REFUSING TO START — Agent OS is already running as PID ${holder.pid}, ` +
          `up since ${new Date(holder.startedAt).toLocaleString()}.\n` +
          `          Two servers share one database and one approvals file with no locking, ` +
          `which silently corrupts run state.\n` +
          `          Stop the old one first:  Stop-Process -Id ${holder.pid} -Force`,
      );
      process.exit(1);
    }

    // Runs orphaned by the previous shutdown, BEFORE any trigger can fire — a
    // scheduler-started run would otherwise be swept as stranded the moment it
    // set status:"running".
    const { recoverStrandedRuns } = await import("./lib/agentsRecovery");
    await recoverStrandedRuns();

    const { ensureScheduler } = await import("./lib/agentsTriggers");
    ensureScheduler();
    // Idea Engine's daily scan/validate loop (hard-capped at one run per day).
    const { ensureIdeaDaily } = await import("./lib/ideaDaily");
    ensureIdeaDaily();
    // V2 foundations: agentos.db + event bus + RRULE scheduler (SPEC-A F1/F2).
    const { ensureV2 } = await import("./lib/v2/boot");
    ensureV2();
  }
}
