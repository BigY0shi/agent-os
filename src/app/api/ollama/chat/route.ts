export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ollama Cloud chat — streams from https://ollama.com/api/chat (hosted models, no
// local daemon needed). Ollama has no per-model CLI here, so like the GLM/Fusion
// routes we talk to the HTTP API directly and relay deltas in the envelope the
// agent views expect:  {"t":"d","c":"chunk"} · {"t":"done"} · {"t":"error","m":"…"}
//
// Key, host and the no-model-sent default come from settings.ollama (the page's gear), with
// OLLAMA_API_KEY / OLLAMA_CLOUD_HOST / OLLAMA_CLOUD_MODEL as the environment fallback
// (lib/ollamaCloud.ts, read per request). The last-resort model stays qwen3-coder:480b.
import { ollamaCloudDefaultModel, ollamaCloudHost, ollamaCloudKey } from "@/lib/ollamaCloud";
const LAST_RESORT_MODEL = "qwen3-coder:480b";

interface ChatMsg { role: "user" | "assistant"; text: string; }

export async function POST(req: Request) {
  const { prompt, history = [], model } = (await req.json()) as {
    prompt: string; history?: ChatMsg[]; model?: string;
  };
  const useModel = (typeof model === "string" && model.trim()) ? model.trim() : ollamaCloudDefaultModel(LAST_RESORT_MODEL);
  const key = ollamaCloudKey();
  const host = ollamaCloudHost();
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const finish = () => { send({ t: "done" }); controller.close(); };
      if (!key) {
        send({ t: "error", m: "No Ollama Cloud key. Add it in this page's gear (Ollama settings), or set OLLAMA_API_KEY in .env.local and restart." });
        return finish();
      }
      if (typeof prompt !== "string" || !prompt.trim()) {
        send({ t: "error", m: "missing prompt" });
        return finish();
      }
      const messages = [
        { role: "system", content: "You are running inside the Agent OS via Ollama Cloud. Be concise and direct. When asked to build something, return complete, self-contained code." },
        ...history.slice(-24).map((h) => ({ role: h.role, content: h.text })),
        { role: "user", content: prompt },
      ];
      try {
        const r = await fetch(`${host}/api/chat`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: useModel, messages, stream: true }),
        });
        if (!r.ok || !r.body) {
          const t = await r.text().catch(() => "");
          const hint = r.status === 401 ? " (key rejected — check OLLAMA_API_KEY)" :
                       r.status === 404 ? ` (model "${useModel}" not found on your account)` : "";
          send({ t: "error", m: `Ollama Cloud HTTP ${r.status}${hint}: ${t.slice(0, 240)}` });
          return finish();
        }
        // Ollama streams NDJSON: {"message":{"content":"…"},"done":false} … {"done":true}
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const s = line.trim();
            if (!s) continue;
            try {
              const j = JSON.parse(s);
              const c = j?.message?.content;
              if (c) send({ t: "d", c });
              if (j?.error) send({ t: "error", m: String(j.error) });
            } catch { /* skip partial/keep-alive */ }
          }
        }
        finish();
      } catch (e) {
        send({ t: "error", m: String(e) });
        finish();
      }
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
