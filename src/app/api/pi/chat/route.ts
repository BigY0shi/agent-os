import { spawnStream } from "@/lib/runner";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pi chat — drives the REAL Pi coding CLI (@mariozechner/pi-coding-agent). One turn:
//   pi -p "<prompt>" --mode text --no-session --no-context-files
// Pi is configured to the user's Ollama glm-5.2:cloud (see `pi --list-models`) — no API key.
// `--mode text` prints the assistant's plain-text answer to stdout, so we forward stdout
// chunks straight through in the dashboard's NDJSON envelope:
//   {"t":"d","c":"chunk"}  · {"t":"done"}  · {"t":"error","m":"…"}
// `--no-session` keeps each turn ephemeral; we carry context ourselves via the prompt.
// `--no-context-files` stops Pi from wandering into AGENTS.md/CLAUDE.md in the workspace.

const PI_WORKSPACE = path.join(os.homedir(), ".agentic-os", "workspaces", "pi");

interface ChatMsg { role: "user" | "assistant" | "system"; text: string; }

function buildPromptWithHistory(history: ChatMsg[], current: string): string {
  if (!history.length) return current;
  const recent = history.slice(-24);
  const lines: string[] = [
    "The following is the prior conversation between you and the user.",
    "Read it, then answer the user's latest message at the bottom.",
    "",
    "--- prior conversation ---",
  ];
  let bytes = 0;
  const MAX_BYTES = 8000;
  for (const m of recent) {
    const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
    const line = `${role}: ${m.text}`;
    if (bytes + line.length > MAX_BYTES) { lines.push("…[earlier turns trimmed]"); break; }
    lines.push(line);
    bytes += line.length;
  }
  lines.push("--- end prior conversation ---", "", `User: ${current}`, "Assistant:");
  return lines.join("\n");
}

export async function POST(req: Request) {
  const body = await req.json();
  const prompt = body.prompt;
  const history: ChatMsg[] = Array.isArray(body.history) ? body.history : [];
  const model: string | undefined = typeof body.model === "string" && body.model ? body.model : undefined;
  if (typeof prompt !== "string" || prompt.length === 0) {
    return new Response("missing prompt", { status: 400 });
  }
  if (prompt.length > 16_000) {
    return new Response("prompt too long", { status: 413 });
  }
  const fullPrompt = buildPromptWithHistory(history, prompt);

  if (!existsSync(PI_WORKSPACE)) { try { await mkdir(PI_WORKSPACE, { recursive: true }); } catch {} }
  const cwd = PI_WORKSPACE;

  const args = ["-p", fullPrompt, "--mode", "text", "--no-session", "--no-context-files"];
  if (model) args.push("--model", model);

  let child;
  try {
    child = spawnStream("pi", args, { cwd });
  } catch (e) {
    return new Response(JSON.stringify({ t: "error", m: String(e) }) + "\n",
      { status: 503, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let emitted = false;
      let stderrBuf = "";
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); }
        catch { closed = true; }
      };
      const safeClose = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };

      child.stdout.on("data", (b: Buffer) => {
        const s = b.toString();
        if (s) { emitted = true; send({ t: "d", c: s }); }
      });
      child.stderr.on("data", (b: Buffer) => { stderrBuf += b.toString(); });
      child.on("close", (code) => {
        if (!emitted) {
          const se = stderrBuf.trim();
          const msg = /api[_ ]?key|unauthor|provider|sign|login|ollama/i.test(se)
            ? `Pi couldn't reach its model. Check \`pi --list-models\` / your Ollama sign-in.\n${se.slice(-300)}`
            : (se.slice(-400) || `Pi exited with code ${code} and no output.`);
          send({ t: "error", m: msg });
        }
        send({ t: "done", code });
        safeClose();
      });
      child.on("error", (e) => { send({ t: "error", m: String(e) }); safeClose(); });
    },
    cancel() { try { child.kill("SIGTERM"); } catch {} },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
