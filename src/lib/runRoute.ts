// The two things every route that wraps its work in startModuleRun() needs and
// content-engine/generate had to hand-roll with a regex over the message:
//
//   HttpError        throw this INSIDE the run when the route always answered
//                    with a specific status (502 "agent returned nothing", ...).
//                    The run record still carries the reason; the caller still
//                    gets the status it always got.
//   runErrorResponse the one catch block: a STOP is 409 { stopped: true }, an
//                    HttpError is its own status, anything else is 500. Every
//                    body carries runId so the tray row can be found.
//
// Deliberately tiny and dependency-free so a smoke can import it without
// touching a config directory (AGENTS.md rule 19).

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function runErrorResponse(e: unknown, runId: string): Response {
  const err = e instanceof Error ? e : new Error(String(e));
  if (err.name === "AbortError") {
    return Response.json({ ok: false, stopped: true, error: err.message, runId }, { status: 409 });
  }
  const status = err instanceof HttpError ? err.status : 500;
  return Response.json({ ok: false, error: err.message, runId }, { status });
}
