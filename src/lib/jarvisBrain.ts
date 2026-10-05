// The warm Jarvis brain — a PERSISTENT Claude Agent SDK session, streaming.
//
// Ported from the standalone rig's backtalk/brain.py (WarmBrain): one session
// lives across turns — no per-turn process spawn, no per-turn context reload —
// and partial-message streaming yields complete sentences the moment they
// finish, so the UI can speak while the rest of the thought is still forming.
//
// Why a module-level singleton: Next.js route handlers are stateless, but a
// warm session is the opposite (same reasoning as ptySessions.ts) — the
// PROCESS owns the session, requests borrow it.
//
// Differences from the Python original, on purpose:
//  - No 1MB transport line cap here (that bug was the Python SDK's default
//    max_buffer_size; it killed the standalone rig on image-heavy tool turns).
//  - Persona comes from lib/jarvisPersona.ts (editable data, rule 17), not a
//    CLAUDE.md tied to a folder.
//  - Turn serialization: one turn at a time; a new ask while one is in flight
//    interrupts the old turn first (the Python original's "off-by-one" drain
//    problem is handled by never letting two consumers share the stream).

import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import os from "node:os";
import { claudeModel } from "@/lib/claudeModel";
import { personaPrompt } from "@/lib/jarvisPersona";
import { sanitizeSpawnEnv } from "@/lib/spawnEnv";

const SENTENCE_END = /(?<=[.!?])\s/;

type BrainState = {
  q: Query;
  push: (m: SDKUserMessage) => void;
  busy: boolean;
  startedAt: number;
  turns: number;
  model: string;
};

// Survives route-module reloads in dev (same trick as ptySessions).
const g = globalThis as unknown as { __jarvisBrain?: BrainState | null };

function userMsg(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
  } as SDKUserMessage;
}

function boot(): BrainState {
  // Streaming-input mode: the prompt is an async iterable we push into for
  // the life of the session. That is what keeps the process warm.
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  const input = (async function* () {
    while (true) {
      while (queue.length) yield queue.shift()!;
      await new Promise<void>((r) => { wake = r; });
    }
  })();

  const model = claudeModel();
  const q = query({
    prompt: input,
    options: {
      cwd: os.homedir(),
      model,
      systemPrompt: { type: "preset", preset: "claude_code", append: personaPrompt() },
      includePartialMessages: true,
      permissionMode: "bypassPermissions",
      // The dashboard's own env leaks PORT (and CLAUDE_CODE_* when launched
      // from inside Claude Code) — same hygiene as every other spawn path.
      env: Object.fromEntries(
        Object.entries(sanitizeSpawnEnv({ ...process.env, NO_COLOR: "1" }))
          .filter(([k, v]) => typeof v === "string" && !k.startsWith("CLAUDE_CODE_") && !k.startsWith("CLAUDE_AGENT_SDK"))
      ) as Record<string, string>,
    },
  });

  const state: BrainState = {
    q,
    push: (m) => { queue.push(m); wake?.(); wake = null; },
    busy: false,
    startedAt: Date.now(),
    turns: 0,
    model,
  };
  g.__jarvisBrain = state;
  return state;
}

export function brainStatus() {
  const b = g.__jarvisBrain;
  return b
    ? { warm: true, busy: b.busy, turns: b.turns, model: b.model, uptimeMs: Date.now() - b.startedAt }
    : { warm: false, busy: false, turns: 0, model: null, uptimeMs: 0 };
}

export async function resetBrain() {
  const b = g.__jarvisBrain;
  g.__jarvisBrain = null;
  if (b) { try { await b.q.interrupt(); } catch { /* already down */ } }
}

/**
 * Ask Jarvis one utterance; yields complete sentences as they stream, then a
 * final usage record. Serialized: a call while a turn is in flight interrupts
 * the running turn (voice conversations want the NEW question, not a queue).
 */
export async function* askJarvis(utterance: string): AsyncGenerator<
  { type: "sentence"; text: string } | { type: "done"; costUsd: number | null; turns: number }
> {
  let b = g.__jarvisBrain ?? boot();
  if (b.busy) {
    try { await b.q.interrupt(); } catch { /* stream may rebuild below */ }
  }
  b.busy = true;
  try {
    b.push(userMsg(utterance));
    let buf = "";
    let cost: number | null = null;
    for await (const msg of b.q) {
      if (msg.type === "stream_event") {
        const ev = msg.event as { type?: string; delta?: { type?: string; text?: string } };
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          buf += ev.delta.text ?? "";
          let m: RegExpExecArray | null;
          while ((m = SENTENCE_END.exec(buf))) {
            const s = buf.slice(0, m.index + 1).trim();
            buf = buf.slice(m.index + 1);
            if (s) yield { type: "sentence", text: s };
          }
        } else if (ev?.type === "content_block_stop") {
          // Flush before tool runs — otherwise pre-tool filler sits silent
          // through the whole tool call, then plays glued to the answer.
          const tail = buf.trim(); buf = "";
          if (tail) yield { type: "sentence", text: tail };
        }
      } else if (msg.type === "result") {
        cost = "total_cost_usd" in msg ? (msg.total_cost_usd ?? null) : null;
        break;
      }
    }
    const tail = buf.trim();
    if (tail) yield { type: "sentence", text: tail };
    b.turns += 1;
    yield { type: "done", costUsd: cost, turns: b.turns };
  } catch (e) {
    // A dead transport must never brick the module — rebuild cold next ask.
    g.__jarvisBrain = null;
    throw e;
  } finally {
    b = g.__jarvisBrain ?? b;
    b.busy = false;
  }
}
