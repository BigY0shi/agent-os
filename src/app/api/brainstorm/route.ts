import {
  COUNCIL_SEATS, type CouncilSeat, type BrainstormSession,
  loadSession, saveSession, listSessions,
  resolveKimiModel, seatComplete,
  divergePrompt, critiquePrompt, synthesisPrompt, steerPrompt, resynthesisPrompt,
} from "@/lib/brainstorm";
import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// GET             → session list (for the sidebar)
// GET ?id=<id>    → one full session
// POST { message, id? } → run a council round, streamed as NDJSON:
//   {t:"phase",name}  {t:"msg",agent,phase,text}  {t:"err",agent,message}
//   {t:"brief",text}  {t:"done",id}
// New session (no id): diverge → critique → synthesis.
// Existing session:    steer (all seats respond to the message) → re-synthesis.

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const s = await loadSession(id);
    return s ? Response.json({ ok: true, session: s }) : Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return Response.json({ ok: true, sessions: await listSessions() });
}

export async function POST(req: Request) {
  const { message, id } = await req.json().catch(() => ({})) as { message?: string; id?: string };
  if (!message?.trim()) return Response.json({ ok: false, error: "message required" }, { status: 400 });
  const text = message.trim();

  const existing = id ? await loadSession(id) : null;
  const session: BrainstormSession = existing ?? {
    id: `bs-${Date.now().toString(36)}`,
    topic: text, createdAt: Date.now(), updatedAt: Date.now(), msgs: [], brief: null,
  };

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (o: Record<string, unknown>) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const record = (agent: CouncilSeat | "user" | "chair", phase: string, t: string) =>
        session.msgs.push({ agent, phase, text: t, ts: Date.now() });

      try {
        record("user", "user", text);

        // The Kimi seat needs a resolved model before any round runs. If Ollama
        // Cloud is unreachable the council still convenes as a two-seat panel —
        // a degraded round beats a dead button.
        let kimiModel = session.kimiModel || "";
        let seats: CouncilSeat[] = [...COUNCIL_SEATS];
        try {
          kimiModel = await resolveKimiModel(readSettings().brainstorm.kimiModel);
          session.kimiModel = kimiModel;
          emit({ t: "seat", agent: "kimi", model: kimiModel });
        } catch (e) {
          seats = seats.filter((s) => s !== "kimi");
          emit({ t: "err", agent: "kimi", message: `Kimi seat empty: ${(e as Error).message}` });
        }

        // One round = fan the prompt to every seat in parallel, stream each reply
        // as it lands, collect what succeeded.
        const round = async (phase: string, promptFor: (s: CouncilSeat) => string) => {
          emit({ t: "phase", name: phase });
          const results: { seat: CouncilSeat; text: string }[] = [];
          await Promise.all(seats.map(async (seat) => {
            try {
              const out = await seatComplete(seat, promptFor(seat), kimiModel);
              results.push({ seat, text: out });
              record(seat, phase, out);
              emit({ t: "msg", agent: seat, phase, text: out });
            } catch (e) {
              emit({ t: "err", agent: seat, message: (e as Error).message });
            }
          }));
          return results;
        };

        let briefPrompt: string;
        if (!existing) {
          const proposals = await round("diverge", (s) => divergePrompt(s, text));
          if (!proposals.length) throw new Error("Every council seat failed — check the CLIs and the Ollama key.");
          const critiques = await round("critique", (s) => critiquePrompt(s, text, proposals));
          briefPrompt = synthesisPrompt(text, critiques.length ? critiques : proposals);
        } else {
          const replies = await round("steer", (s) => steerPrompt(s, session, text));
          if (!replies.length) throw new Error("Every council seat failed — check the CLIs and the Ollama key.");
          briefPrompt = resynthesisPrompt(session, text, replies);
        }

        // Chair synthesis is always Claude — one voice writes the brief.
        emit({ t: "phase", name: "synthesis" });
        const brief = await seatComplete("claude", briefPrompt, kimiModel);
        session.brief = brief;
        record("chair", "brief", brief);
        emit({ t: "brief", text: brief });

        await saveSession(session);
        emit({ t: "done", id: session.id });
      } catch (e) {
        emit({ t: "fatal", message: (e as Error).message });
        await saveSession(session).catch(() => {});
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
