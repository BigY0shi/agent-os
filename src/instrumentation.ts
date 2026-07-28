// Next.js instrumentation — runs once per server start (nodejs runtime).
// Boots the Agents trigger scheduler so pollers/schedules run without anyone
// having opened the dashboard. Guarded dynamic import keeps node-only code out
// of the edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureScheduler } = await import("./lib/agentsTriggers");
    ensureScheduler();
  }
}
