import { spawnStream } from "@/lib/runner";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cursor chat — drives the REAL Cursor CLI (cursor-agent), signed in via
// `cursor-agent login` on the user's Cursor subscription (no API key). One turn:
//   cursor-agent -p "<prompt>" --output-format stream-json --stream-partial-output --force --trust
// cursor-agent's stream-json emits one JSON object per line. Verified schema:
//   {"type":"system","subtype":"init",...}                                   — startup
//   {"type":"user",...}                                                       — echo of our prompt
//   {"type":"assistant","message":{content:[{type:"text",text:"…"}]},"timestamp_ms":N}  — STREAMED delta
//   {"type":"assistant","message":{content:[{type:"text",text:"…full…"}]}}    — final CONSOLIDATED (no timestamp_ms)
//   {"type":"result","subtype":"success","result":"…full…",...}              — end of turn
// The consolidated message repeats the whole answer, so we emit ONLY deltas (which carry
// timestamp_ms) to avoid doubling, and fall back to `result` if nothing streamed.
// We re-emit to the client in the dashboard's NDJSON envelope:
//   {"t":"d","c":"chunk"}  · {"t":"done"}  · {"t":"error","m":"…"}

const CURSOR_WORKSPACE = path.join(os.homedir(), ".agentic-os", "workspaces", "cursor");

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

  if (!existsSync(CURSOR_WORKSPACE)) { try { await mkdir(CURSOR_WORKSPACE, { recursive: true }); } catch {} }
  const cwd = CURSOR_WORKSPACE;

  const args = ["-p", fullPrompt, "--output-format", "stream-json", "--stream-partial-output", "--force", "--trust"];
  if (model) args.push("--model", model);

  let child;
  try {
    child = spawnStream("cursor", args, { cwd });
  } catch (e) {
    return new Response(JSON.stringify({ t: "error", m: String(e) }) + "\n",
      { status: 503, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let emitted = false;
      let resultText = "";
      let stderrBuf = "";
      let stdoutBuf = "";
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); }
        catch { closed = true; }
      };
      const safeClose = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };

      const handleLine = (line: string) => {
        const t = line.trim();
        if (!t) return;
        let evt: { type?: string; message?: { content?: Array<{ type?: string; text?: string }> }; timestamp_ms?: number; result?: unknown };
        try { evt = JSON.parse(t); } catch { return; } // ignore non-JSON noise (e.g. "Shell cwd was reset…")
        if (evt.type === "assistant" && evt.timestamp_ms && Array.isArray(evt.message?.content)) {
          for (const block of evt.message!.content!) {
            if (block?.type === "text" && typeof block.text === "string" && block.text) {
              emitted = true; send({ t: "d", c: block.text });
            }
          }
        } else if (evt.type === "result" && typeof evt.result === "string") {
          resultText = evt.result;
        }
      };

      child.stdout.on("data", (b: Buffer) => {
        stdoutBuf += b.toString();
        const lines = stdoutBuf.split("\n");
        stdoutBuf = lines.pop() ?? "";
        for (const l of lines) handleLine(l);
      });
      child.stderr.on("data", (b: Buffer) => { stderrBuf += b.toString(); });
      child.on("close", (code) => {
        if (stdoutBuf) handleLine(stdoutBuf);
        if (!emitted && resultText.trim()) { emitted = true; send({ t: "d", c: resultText.trim() }); }
        if (!emitted) {
          const se = stderrBuf.trim();
          const msg = /not (logged|signed) in|unauthor|auth|login/i.test(se)
            ? "Cursor isn't signed in. Run `cursor-agent login` in a terminal (uses your Cursor subscription — no API key)."
            : (se.slice(-400) || `Cursor exited with code ${code} and no output.`);
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
