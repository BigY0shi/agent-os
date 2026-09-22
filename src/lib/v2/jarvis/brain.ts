import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import os from "node:os";
import { createHash } from "node:crypto";
import { CLAUDE_MODEL } from "@/lib/config";
import { sanitizeSpawnEnv } from "@/lib/spawnEnv";
import { cliComplete } from "@/lib/loopEngine";
import { readSettings } from "@/lib/settings";
import { searchV2 } from "../memory/search";
import { formatRecallAsMarkdown } from "../memory/search/formatter";
import type { RecallResult } from "../memory/types";
import { ingestFromModule } from "../memory/queue";
import { ensureCoreActions } from "../mcp/actions";
import { ensureTaskActions } from "../mcp/taskActions";
import {
  buildStableSystemPrompt,
  buildSystemPrompt,
  buildTurnContextBlock,
  type PageContextPayload,
} from "./context";
import { CLI_ANSWER_ONLY_NOTE, wrapRecalledMemory, type ReplySurfaceInput } from "./prompts/system";
import {
  buildJarvisSdkServer,
  newTurnState,
  toolsSignature,
  recallIntegrationLabels,
  type JarvisTurnState,
  type JarvisToolEmit,
  type JarvisToolEvent,
} from "./tools";
import {
  ensureConversation,
  appendJarvisMessage,
  listMessages,
  type JarvisConversation,
  type JarvisOrigin,
} from "./conversations";

/**
 * SPEC-C C3 — the Jarvis V2 brain. Two lanes (settings.jarvis.engine):
 *
 *   'sdk' (primary) — ONE warm Claude Agent SDK session per process on
 *   globalThis (jarvisBrain.ts pattern: streaming-input generator, sentence
 *   streaming, interrupt-on-new-ask, sanitizeSpawnEnv), extended with the
 *   in-process SDK MCP server from tools.ts (memory/hub/registry/navigate).
 *   The session is rebuilt whenever the stable system prompt, the published
 *   tool signature, or the conversation changes.
 *
 *   'cli' (fallback) — answer-only: buildSystemPrompt + searchV2 recall +
 *   conversation history through cliComplete. NO tools; the meta event tags
 *   the stream 'answer-only mode'.
 *
 * Every turn persists user + assistant (+ tool summaries) to jarvis_messages
 * and fire-and-forgets an ingestFromModule({source:'jarvis'}) exchange.
 * pageContext is consumed per-request only — it never reaches the DB.
 */

const SENTENCE_END = /(?<=[.!?])\s/;

export type JarvisAskEvent =
  | { type: "meta"; conversationId: string; engine: "sdk" | "cli"; note?: string }
  | { type: "sentence"; text: string }
  | JarvisToolEvent
  | { type: "done"; costUsd?: number | null; turns?: number; durationMs: number }
  | { type: "error"; message: string };

export interface JarvisAskInput {
  uiRequest?: import("./tools").JarvisTurnState["uiRequest"];
  text: string;
  conversationId?: string;
  pageContext?: PageContextPayload | null;
  channel?: "overlay" | "page";
  /** Per-request reply surface (G2 glasses) — shapes the answer, never persisted. */
  surface?: ReplySurfaceInput | null;
  /** Conversation origin stamped on CREATE only (migration 035) — "glasses". */
  origin?: JarvisOrigin;
}

type SessionState = {
  q: Query;
  push: (m: SDKUserMessage) => void;
  startedAt: number;
  turns: number;
  model: string;
  stableHash: string;
  toolsSig: string;
  conversationId: string;
  /** Session-sticky tool state (integration taint survives across turns). */
  toolState: JarvisTurnState;
  /** Per-turn emitter indirection — tools close over this ref, each ask swaps it. */
  emitRef: { current: JarvisToolEmit };
};

const g = globalThis as unknown as {
  __jarvisBrainV2?: SessionState | null;
  __jarvisAskV2?: { busy: boolean; conversationId?: string; abort?: () => void } | null;
};

function askState() {
  if (!g.__jarvisAskV2) g.__jarvisAskV2 = { busy: false };
  return g.__jarvisAskV2;
}

export function jarvisAskStatus(): { busy: boolean; engine: "sdk" | "cli"; conversationId?: string } {
  const engine = (readSettings().jarvis?.engine as "sdk" | "cli" | undefined) ?? "sdk";
  const s = askState();
  return { busy: s.busy, engine, conversationId: s.conversationId };
}

export async function resetJarvisBrain(): Promise<void> {
  const b = g.__jarvisBrainV2;
  g.__jarvisBrainV2 = null;
  if (b) {
    try {
      await b.q.interrupt();
    } catch {
      /* already down */
    }
  }
}

// ---------------------------------------------------------------------------
// CLI-lane seam (injectable for tests; AGENTOS_MOCK_LLM=1 picks the built-in
// deterministic mock — echoes any <recalled_memory> block so recall paths are
// assertable offline).
// ---------------------------------------------------------------------------

export type JarvisCliFn = (prompt: string, opts: { signal?: AbortSignal }) => Promise<string>;

let cliOverride: JarvisCliFn | null = null;

export function setJarvisCliForTests(fn: JarvisCliFn | null): void {
  cliOverride = fn;
}

function mockCli(prompt: string): Promise<string> {
  // LAST opening tag: the §9.4 rule text itself contains the literal opening
  // tag (no closer), so a plain regex swallows the whole prompt — anchor on
  // the final occurrence instead (the real recall block).
  const open = prompt.lastIndexOf("<recalled_memory");
  const close = open >= 0 ? prompt.indexOf("</recalled_memory>", open) : -1;
  if (open >= 0 && close > open) {
    const inner = prompt.slice(prompt.indexOf(">", open) + 1, close).trim();
    return Promise.resolve(`MOCK-ANSWER with recall. ${inner.slice(0, 600)}`);
  }
  return Promise.resolve("MOCK-ANSWER without recall.");
}

function cliFn(): JarvisCliFn {
  if (cliOverride) return cliOverride;
  if (process.env.AGENTOS_MOCK_LLM === "1") return mockCli;
  const agent = readSettings().jarvis?.cliAgent || readSettings().defaultAgent || "claude";
  return (prompt, opts) => cliComplete(String(agent), prompt, { signal: opts.signal, timeoutMs: 180_000 });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function userMsg(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
  } as SDKUserMessage;
}

function historyBlock(
  conversationId: string,
  excludeLatestUserText?: string,
  cap = 20,
): { block: string; tainted: boolean } {
  let msgs = listMessages(conversationId);
  // The current turn's user row is persisted BEFORE the lanes run — drop it so
  // history never duplicates the live message.
  const last = msgs[msgs.length - 1];
  if (excludeLatestUserText !== undefined && last?.role === "user" && last.content === excludeLatestUserText) {
    msgs = msgs.slice(0, -1);
  }
  msgs = msgs.slice(-cap);
  // §9.4: replaying a tainted turn puts integration-derived content back into
  // the model's context — the fresh session must inherit the taint, or a
  // restart/rebuild silently resets the write-gate (review finding 2026-08-27).
  const tainted = msgs.some((m) => m.tainted === true);
  if (msgs.length === 0) return { block: "", tainted };
  const lines = msgs.map((m) => `${m.role === "user" ? "User" : "Jarvis"}: ${m.content.slice(0, 800)}`);
  return {
    block: `<conversation_history>\nEarlier turns of this conversation (resumed):\n${lines.join("\n")}\n</conversation_history>`,
    tainted,
  };
}

function* splitSentences(buf: { text: string }): Generator<string> {
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END.exec(buf.text))) {
    const s = buf.text.slice(0, m.index + 1).trim();
    buf.text = buf.text.slice(m.index + 1);
    if (s) yield s;
  }
}

function ingestExchange(
  conversationId: string,
  userText: string,
  agentText: string,
  tainted: boolean,
): void {
  const body = `<user>\n${userText}\n</user>\n<agent>\n${agentText}\n</agent>`;
  // §9.4 laundering fix (HARDENING-2026-08-27 item 2): a tainted turn contains
  // integration-derived third-party content — re-ingesting it under only the
  // 'jarvis' label would launder that content into trusted memory (future
  // recall of the exchange would NOT re-taint). The memory of the conversation
  // is still wanted, so ingest proceeds — labeled honestly with an
  // integration:* label so recall of it re-arms the write-gate.
  ingestFromModule({
    episodeBody: body,
    source: "jarvis",
    sessionId: `jarvis-${conversationId}`,
    labelNames: tainted ? ["jarvis", "integration:jarvis-relay"] : ["jarvis"],
  }).catch((err) =>
    console.warn(
      "[v2/jarvis] exchange ingest failed (non-blocking):",
      err instanceof Error ? err.message : err,
    ),
  );
}

// ---------------------------------------------------------------------------
// SDK warm session
// ---------------------------------------------------------------------------

function bootSession(conversationId: string, stable: string, sig: string): SessionState {
  ensureCoreActions();
  ensureTaskActions();

  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  const input = (async function* () {
    while (true) {
      while (queue.length) yield queue.shift()!;
      await new Promise<void>((r) => {
        wake = r;
      });
    }
  })();

  const emitRef: SessionState["emitRef"] = { current: () => {} };
  const toolState = newTurnState();
  const server = buildJarvisSdkServer({ emit: (ev) => emitRef.current(ev), state: toolState });

  const model = CLAUDE_MODEL || "claude-sonnet-5";
  const q = query({
    prompt: input,
    options: {
      cwd: os.homedir(),
      model,
      systemPrompt: { type: "preset", preset: "claude_code", append: stable },
      includePartialMessages: true,
      permissionMode: "bypassPermissions",
      // Jarvis mutates the OS ONLY through the gated MCP tools below — the
      // preset's native Bash/Write/Edit would bypass every capability gate,
      // the Human-Gate, and the §9.4 taint rule (review finding 2026-08-27).
      // Belt and braces: allowlist the MCP server AND deny the native suite.
      allowedTools: ["mcp__agentos"],
      disallowedTools: [
        "Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Task",
        "WebFetch", "WebSearch", "Read", "Glob", "Grep", "TodoWrite",
        "KillShell", "BashOutput",
      ],
      mcpServers: { agentos: server },
      env: Object.fromEntries(
        Object.entries(sanitizeSpawnEnv({ ...process.env, NO_COLOR: "1" })).filter(
          ([k, v]) =>
            typeof v === "string" && !k.startsWith("CLAUDE_CODE_") && !k.startsWith("CLAUDE_AGENT_SDK"),
        ),
      ) as Record<string, string>,
    },
  });

  const state: SessionState = {
    q,
    push: (m) => {
      queue.push(m);
      wake?.();
      wake = null;
    },
    startedAt: Date.now(),
    turns: 0,
    model,
    stableHash: stable,
    toolsSig: sig,
    conversationId,
    toolState,
    emitRef,
  };
  g.__jarvisBrainV2 = state;
  return state;
}

async function askSdk(
  conv: JarvisConversation,
  input: JarvisAskInput,
  onEvent: (ev: JarvisAskEvent) => void,
  signal?: AbortSignal,
): Promise<{ answer: string; toolCalls: JarvisTurnState["toolCalls"]; tainted: boolean; costUsd: number | null; turns: number }> {
  const stable = buildStableSystemPrompt();
  const sig = toolsSignature();

  let session = g.__jarvisBrainV2 ?? null;
  const stale =
    !session ||
    session.stableHash !== stable ||
    session.toolsSig !== sig ||
    session.conversationId !== conv.id;
  let resumed = false;
  if (stale) {
    if (session) {
      resumed = session.conversationId !== conv.id; // conversation switch/resume
      await resetJarvisBrain();
    }
    session = bootSession(conv.id, stable, sig);
    resumed = true; // fresh session — replay any prior history for this conversation
  }
  const b = session!;

  // Per-turn wiring: tool events flow straight into this turn's stream.
  b.toolState.toolCalls = [];
  b.toolState.uiRequest = input.uiRequest;
  b.toolState.conversationId = conv.id; // Human-Gate approvals thread back to this conversation
  b.emitRef.current = (ev) => onEvent(ev);

  const abort = () => {
    b.q.interrupt().catch(() => {});
  };
  askState().abort = abort;
  signal?.addEventListener("abort", abort, { once: true });

  // Compose the turn message: per-turn context + (on resume) history + raw text.
  // The DB row for this turn is the RAW text only — pageContext never persists.
  const parts: string[] = [];
  const turnCtx = buildTurnContextBlock({ pageContext: input.pageContext, surface: input.surface });
  if (turnCtx) parts.push(turnCtx);
  if (resumed) {
    // History EXCLUDES the just-persisted user turn (it rides as the live text).
    const history = historyBlock(conv.id, input.text);
    if (history.block) parts.push(history.block);
    if (history.tainted) b.toolState.integrationTainted = true;
  }
  parts.push(input.text);
  b.push(userMsg(parts.join("\n\n")));

  const buf = { text: "" };
  let cost: number | null = null;
  const sentences: string[] = [];
  const emitSentence = (s: string) => {
    sentences.push(s);
    onEvent({ type: "sentence", text: s });
  };

  try {
    // Explicit next(): a `break` out of `for await` calls the query's return(),
    // which the SDK implements as cleanup() — it killed the warm session at the
    // end of EVERY first turn, so turn two iterated a closed stream and came back
    // "(no reply)" in 1 ms (11 such rows in jarvis_messages, 2026-09-08).
    let sawMessage = false;
    while (true) {
      const step = await b.q.next();
      if (step.done) {
        g.__jarvisBrainV2 = null;
        throw new Error(sawMessage
          ? "Jarvis session ended before a result; ask again (session rebuilt)"
          : "Jarvis session was already closed; ask again (session rebuilt)");
      }
      const msg = step.value;
      sawMessage = true;
      if (msg.type === "stream_event") {
        const ev = msg.event as { type?: string; delta?: { type?: string; text?: string } };
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          buf.text += ev.delta.text ?? "";
          for (const s of splitSentences(buf)) emitSentence(s);
        } else if (ev?.type === "content_block_stop") {
          // Flush before tool runs — pre-tool filler must not sit silent.
          const tail = buf.text.trim();
          buf.text = "";
          if (tail) emitSentence(tail);
        }
      } else if (msg.type === "result") {
        cost = "total_cost_usd" in msg ? ((msg as { total_cost_usd?: number }).total_cost_usd ?? null) : null;
        const r = msg as { is_error?: boolean; subtype?: string; errors?: string[] };
        if (r.is_error && sentences.length === 0 && !buf.text.trim()) {
          // An error result with no text is a failure, not an empty answer.
          throw new Error(`SDK ${r.subtype ?? "error"}${r.errors?.length ? `: ${r.errors.join("; ").slice(0, 200)}` : ""}`);
        }
        break; // out of the while — does NOT call q.return()
      }
    }
  } catch (err) {
    // Dead transport must never brick the module — rebuild cold next ask.
    g.__jarvisBrainV2 = null;
    throw err;
  } finally {
    signal?.removeEventListener("abort", abort);
    b.emitRef.current = () => {};
  }
  const tail = buf.text.trim();
  if (tail) emitSentence(tail);
  b.turns += 1;

  return {
    answer: sentences.join(" "),
    toolCalls: [...b.toolState.toolCalls],
    tainted: b.toolState.integrationTainted,
    costUsd: cost,
    turns: b.turns,
  };
}

// ---------------------------------------------------------------------------
// CLI answer-only lane
// ---------------------------------------------------------------------------

async function askCli(
  conv: JarvisConversation,
  input: JarvisAskInput,
  onEvent: (ev: JarvisAskEvent) => void,
  signal?: AbortSignal,
): Promise<{ answer: string; toolCalls: JarvisTurnState["toolCalls"]; tainted: boolean }> {
  // Recall — same searchV2 store as the sdk lane's memory_search tool.
  let recallBlock: string | null = null;
  let recallTainted = false;
  try {
    const result = (await searchV2(input.text, { structured: true, source: "jarvis" })) as RecallResult;
    const nonEmpty =
      result.episodes.length > 0 || result.statements?.length || result.voiceAspects?.length || result.entity;
    if (nonEmpty) {
      const md = formatRecallAsMarkdown(result);
      if (md?.trim()) recallBlock = wrapRecalledMemory(md);
      const tainted = recallIntegrationLabels(result);
      if (tainted.length) {
        recallTainted = true; // the turn row gets marked so replay re-taints an sdk session
        console.warn(
          `[v2/jarvis] cli-lane recall included integration-labeled episodes (${tainted.join(", ")}) — answer-only lane has no tools, nothing to gate`,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[v2/jarvis] cli-lane recall failed (continuing without memory):",
      err instanceof Error ? err.message : err,
    );
  }

  const history = historyBlock(conv.id, input.text);
  const prompt = [
    buildSystemPrompt({ pageContext: input.pageContext, surface: input.surface }),
    CLI_ANSWER_ONLY_NOTE,
    history.block || null,
    recallBlock,
    `The user says:\n${input.text}`,
    "Respond as Jarvis, in character, plain prose.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const answer = (await cliFn()(prompt, { signal })).trim();
  const buf = { text: answer + " " };
  const sentences: string[] = [];
  for (const s of splitSentences(buf)) {
    sentences.push(s);
    onEvent({ type: "sentence", text: s });
  }
  const tail = buf.text.trim();
  if (tail) {
    sentences.push(tail);
    onEvent({ type: "sentence", text: tail });
  }
  return { answer: sentences.join(" "), toolCalls: [], tainted: recallTainted || history.tainted };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run one Jarvis turn, streaming events through onEvent. Serialized: a new ask
 * while one is in flight interrupts the running turn first (voice wants the
 * NEW question, not a queue).
 */
export async function askJarvisV2(
  input: JarvisAskInput,
  onEvent: (ev: JarvisAskEvent) => void,
  opts: { signal?: AbortSignal } = {},
): Promise<{ conversationId: string }> {
  const text = input.text.trim().slice(0, 8000);
  if (!text) throw new Error("empty ask");

  const engine = (readSettings().jarvis?.engine as "sdk" | "cli" | undefined) ?? "sdk";
  const s = askState();
  if (s.busy && s.abort) {
    try {
      s.abort();
    } catch {
      /* prior turn may already be down */
    }
  }

  const conv = ensureConversation(input.conversationId, {
    titleSeed: text,
    channel: input.channel ?? "overlay",
    origin: input.origin,
  });
  s.busy = true;
  s.conversationId = conv.id;

  const started = Date.now();
  onEvent({
    type: "meta",
    conversationId: conv.id,
    engine,
    ...(engine === "cli" ? { note: "answer-only mode — tools disabled on the cli engine" } : {}),
  });

  // Persist the user turn FIRST (raw text only — never pageContext).
  appendJarvisMessage({ conversationId: conv.id, role: "user", content: text });

  try {
    const run =
      engine === "cli"
        ? await askCli(conv, { ...input, text }, onEvent, opts.signal)
        : await askSdk(conv, { ...input, text }, onEvent, opts.signal);

    const answer = run.answer || "(no reply)";
    appendJarvisMessage({
      conversationId: conv.id,
      role: "assistant",
      content: answer,
      toolCalls: run.toolCalls,
      tainted: run.tainted, // §9.4 — replay of this row re-taints a fresh session
    });
    ingestExchange(conv.id, text, answer, run.tainted);

    const done: { type: "done"; costUsd?: number | null; turns?: number; durationMs: number } = {
      type: "done",
      durationMs: Date.now() - started,
    };
    if (engine === "sdk") {
      const sdkRun = run as { costUsd?: number | null; turns?: number };
      if (typeof sdkRun.costUsd === "number") done.costUsd = sdkRun.costUsd;
      if (typeof sdkRun.turns === "number") done.turns = sdkRun.turns;
    }
    onEvent(done);
    return { conversationId: conv.id };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "brain failure";
    appendJarvisMessage({
      conversationId: conv.id,
      role: "system",
      content: `[error] ${message}`,
    });
    onEvent({ type: "error", message });
    return { conversationId: conv.id };
  } finally {
    const st = askState();
    st.busy = false;
    st.abort = undefined;
  }
}

/** Stable-prompt hash — exported for the smoke's session-invalidation check. */
export function stablePromptHash(): string {
  return createHash("sha256").update(buildStableSystemPrompt()).digest("hex").slice(0, 16);
}
