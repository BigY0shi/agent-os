// Env hygiene for every child process the dashboard spawns.
//
// Next's start-server writes PORT=<dashboard port> (and __NEXT_PRIVATE_ORIGIN) into
// its own process.env "to expose it to render workers". Any child that inherits it —
// and Express-family servers default to app.listen(process.env.PORT) — binds the
// dashboard's port. On Windows that does NOT fail with EADDRINUSE: Next holds only
// IPv4 0.0.0.0:3737 (`next start -H 0.0.0.0`), while the child binds [::]:3737, and
// the browser's localhost lookup prefers ::1 — so the child answers EVERY page with
// Express's "Cannot GET /..." for as long as it lives. Same failure mode as the
// 2026-07-28 Paperclip incident documented in `Start Agent OS.bat`.
export function sanitizeSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  delete env.PORT;
  delete env.__NEXT_PRIVATE_ORIGIN;
  return env;
}
