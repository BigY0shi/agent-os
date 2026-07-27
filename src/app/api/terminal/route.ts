import { createSession, killSession, listSessions, resize, writeTo, defaultShell } from "@/lib/ptySessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Control plane for the terminal. Keystrokes and lifecycle come in here; OUTPUT
// goes out over SSE (see ./stream). Split that way because Next's `next start`
// has no WebSocket upgrade path — SSE down + POST up is the duplex we can
// actually build without running a custom server.

// GET /api/terminal → what's currently open
export async function GET() {
  return Response.json({ ok: true, shell: defaultShell(), sessions: listSessions() });
}

// POST /api/terminal  { action, id?, data?, cols?, rows?, shell?, cwd? }
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "Body must be JSON." }, { status: 400 }); }

  const action = String(body.action || "");
  const id = typeof body.id === "string" ? body.id : "";

  try {
    switch (action) {
      case "create": {
        const s = createSession({
          shell: typeof body.shell === "string" && body.shell ? body.shell : undefined,
          cwd: typeof body.cwd === "string" && body.cwd ? body.cwd : undefined,
          cols: typeof body.cols === "number" ? body.cols : undefined,
          rows: typeof body.rows === "number" ? body.rows : undefined,
        });
        return Response.json({ ok: true, session: s });
      }
      case "input": {
        // Not `|| ""` — that would swallow a lone "0" keystroke.
        const data = typeof body.data === "string" ? body.data : "";
        writeTo(id, data);
        return Response.json({ ok: true });
      }
      case "resize": {
        resize(id, Number(body.cols), Number(body.rows));
        return Response.json({ ok: true });
      }
      case "kill": {
        killSession(id);
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ ok: false, error: `Unknown action "${action}".` }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
