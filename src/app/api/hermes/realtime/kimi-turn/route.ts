import { seatComplete, resolveKimiModel } from "@/lib/brainstorm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST { prompt, history? } → one butler turn on Kimi-K3 (Ollama Cloud).
//
// The third voice provider: browser STT captures the words, this route thinks
// on kimi-k3, and the client speaks the reply through /api/hermes/tts (the
// "ash" butler voice). Turn-based rather than native speech-to-speech — no
// barge-in — but it costs nothing beyond the Ollama Cloud plan and keeps the
// OpenAI-voiced butler character.

const PERSONA =
  "You are JARVIS — Tony Stark's AI from Iron Man — speaking live through a voice assistant. " +
  "Persona: a refined, composed British AI butler. Address me as \"sir\". Be unflappable, precise, " +
  "and lightly dry-witted; never break character. This is SPOKEN conversation: reply in one or two short, " +
  "natural sentences — never monologue, no markdown, no lists. You cannot open apps or run commands in " +
  "this mode; if asked, say the Agent mode handles that.";

interface Msg { role: "user" | "assistant"; content: string }

export async function POST(req: Request) {
  const { prompt, history } = await req.json().catch(() => ({})) as { prompt?: string; history?: Msg[] };
  if (!prompt?.trim()) return Response.json({ ok: false, error: "prompt required" }, { status: 400 });

  try {
    const model = await resolveKimiModel();
    const convo = (history || []).slice(-8).map((m) => `${m.role === "user" ? "Me" : "You"}: ${m.content}`).join("\n");
    const full = `${PERSONA}\n\n${convo ? `Recent conversation:\n${convo}\n\n` : ""}Me: ${prompt.trim()}\n\nReply in character, briefly.`;
    const started = Date.now();
    const text = await seatComplete("kimi", full, model);
    return Response.json({ ok: true, text, model, ms: Date.now() - started });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
