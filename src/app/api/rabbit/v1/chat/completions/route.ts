import { ensureV2 } from "@/lib/v2/boot";
import { readSettings } from "@/lib/settings";
import { claudeModel } from "@/lib/claudeModel";
import { ensureProject, CLAUDE_SCRATCH_ROOT } from "@/lib/claudeWorkspace";
import { rabbitAuthFailure } from "@/lib/v2/rabbit/secret";
import {
  DEFAULT_MODEL_ID, parseChatRequest, resolveModel, buildPrompt, splitTurns, parseToolCall, toolCallText, newCallId,
  explicitCallRequest, callRequestText, CALL_REMINDER, completionId, completionJson, sseChunk, SSE_DONE, type ToolCall,
} from "@/lib/v2/rabbit/openai";
import { runClaudeTurn, type ClaudeTurnResult } from "@/lib/v2/rabbit/claudeChat";
import { linkSession, recordTurn } from "@/lib/v2/rabbit/store";
import { liveStart, liveEnd } from "@/lib/v2/rabbit/live";
import { rabbitLog } from "@/lib/v2/rabbit/log";
import { isMastermindModel, runMastermindTurn, MASTERMIND_MODEL_ID } from "@/lib/v2/rabbit/mastermind";
import path from "node:path";
import { mkdirSync } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rabbit R1 bridge — POST /api/rabbit/v1/chat/completions
//
// OpenAI-compatible chat (with function calling) so the R1's "local endpoint"
// option talks to the owner's logged-in `claude` CLI through Agent OS.
// Proxy-exempt (src/proxy.ts); THIS route is the gate: 503 when the bridge is
// switched off, and — only if settings.rabbit.requireKey is on — 503 with no
// stored key / 401 on a bad one.
//   body: { model?, messages: [{role, content}], tools?, stream?: boolean }
//   → stream=false: one chat.completion JSON (message.tool_calls when the
//     model chose a function; finish_reason "tool_calls")
//   → stream=true:  text/event-stream of chat.completion.chunk + [DONE]; with
//     tools present the reply is buffered (a call can't be known mid-stream)
// Every exchange is persisted (rabbit_sessions / rabbit_messages) and shown
// live on /rabbit while the claude child runs. One log line per request —
// shape only, never content — so the next device probe is visible in
// ~/.agentic-os/agentos-server.log.

const oaiError = (message: string, status: number, type = "invalid_request_error") =>
  Response.json({ error: { message, type } }, { status });

const log = (line: string) => rabbitLog(`chat ${line}`);

export async function POST(req: Request) {
  ensureV2();
  const cfg = readSettings().rabbit ?? {};
  if (cfg.enabled === false) {
    log("503 bridge disabled");
    return oaiError("Rabbit bridge is switched off in Agent OS → Rabbit R1 → settings.", 503, "server_error");
  }
  const denied = rabbitAuthFailure(req, cfg.requireKey === true);
  if (denied) { log(`${denied.status} auth (requireKey on)`); return denied; }

  let body: unknown;
  try { body = await req.json(); } catch { log("400 body not JSON"); return oaiError("Body must be JSON.", 400); }
  const parsed = parseChatRequest(body);
  if (!parsed.ok) { log(`${parsed.status} ${parsed.error}`); return oaiError(parsed.error, parsed.status); }
  const { messages, tools, stream } = parsed.req;
  const shape = `model=${parsed.req.model} stream=${stream} tools=[${tools.map((t) => t.name).join(",")}] roles=${messages.map((m) => m.role + (m.toolCalls?.length ? "+call" : "")).join(",")}`;

  // The owner's chosen default (gear) is what "agentos-claude" / no-model resolves to.
  let defaultClaude = claudeModel();
  if (cfg.defaultModel && cfg.defaultModel !== DEFAULT_MODEL_ID) {
    const d = resolveModel(cfg.defaultModel, claudeModel());
    if (!d.ok) { log(`500 bad settings.defaultModel ${shape}`); return oaiError(`settings.rabbit.defaultModel is invalid — ${d.error}`, 500, "server_error"); }
    defaultClaude = d.claude;
  }
  const model = resolveModel(parsed.req.model, defaultClaude);
  if (!model.ok) { log(`400 ${model.error} ${shape}`); return oaiError(model.error, 400); }

  const { systemPrompt, prompt } = buildPrompt(messages, { persona: cfg.persona, maxTurns: cfg.historyTurns, tools });
  const shapeSized = `${shape} sys=${systemPrompt.length}ch prompt=${prompt.length}ch`;
  const { current, priorAssistant, firstUser } = splitTurns(messages);
  const client = (req.headers.get("user-agent") ?? "").slice(0, 200);
  const { session } = linkSession({
    priorAssistant, firstUser, model: parsed.req.model, client,
    gapMinutes: cfg.sessionGapMinutes ?? 120,
  });

  // A missing cwd makes spawn fail with a misleading "claude.exe ENOENT", so the
  // directory is guaranteed here rather than trusted from the helper.
  const cwd = (await ensureProject("rabbit")) ?? path.join(CLAUDE_SCRATCH_ROOT, "rabbit");
  mkdirSync(cwd, { recursive: true });
  const id = completionId();
  const modelId = parsed.req.model;
  liveStart({ id, sessionId: session.id, model: modelId, preview: current.slice(0, 140), client });

  // ── AI Agent Mastermind: the /room panel answers instead of one claude spawn.
  // Device-function requests ("call …", "use web_search …") still go to Claude
  // below, since the panel has no tools; everything else is a round.
  // What the user asked for in their own words; null while a tool result is being answered
  // (that goes back to Claude, which issued the call; the panel has no tools).
  const ask = callRequestText(messages);
  const callTurn = tools.length > 0 && (ask === null ? messages.some((m) => m.role === "tool") : explicitCallRequest(ask, tools));
  if (isMastermindModel(parsed.req.model) && !callTurn) {
    const panelIds = Array.isArray(cfg.mastermindAgents) ? cfg.mastermindAgents.filter((x): x is string => typeof x === "string") : [];
    const sequential = cfg.mastermindSequential !== false;
    const finishRound = (text: string, durationMs: number, error: string | null) => {
      liveEnd(id);
      try {
        recordTurn({ sessionId: session.id, user: current, assistant: text || (error ? `[error] ${error}` : ""), model: MASTERMIND_MODEL_ID, durationMs, error });
      } catch (e) { console.error("[rabbit] recordTurn failed:", e instanceof Error ? e.message : e); }
      log(`${error ? "502" : "200"} mastermind panel=[${panelIds.join(",")}] ${sequential ? "sequential" : "parallel"} stream=${stream} roles=${messages.map((m) => m.role).join(",")} ${durationMs}ms${error ? ` error=${error.slice(0, 120)}` : ""}`);
    };
    const round = (onReply?: Parameters<typeof runMastermindTurn>[0]["onReply"]) =>
      runMastermindTurn({ messages, current, panelIds, sequential, sessionId: session.id, signal: req.signal, onReply });

    if (!stream) {
      const t0 = Date.now();
      try {
        const r = await round();
        finishRound(r.text, r.durationMs, null);
        return Response.json(completionJson({ id, model: modelId, text: r.text }), { headers: { "cache-control": "no-store" } });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        finishRound("", Date.now() - t0, msg);
        return oaiError(`Mastermind round failed: ${msg}`, 502, "server_error");
      }
    }
    const enc = new TextEncoder();
    const body_ = new ReadableStream({
      start(controller) {
        let closed = false;
        const send = (s: string) => { if (closed) return; try { controller.enqueue(enc.encode(s)); } catch { closed = true; } };
        const close = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };
        send(sseChunk({ id, model: modelId, role: "assistant", delta: "" }));
        const t0 = Date.now();
        let n = 0;
        void round((r) => { send(sseChunk({ id, model: modelId, delta: `${n++ ? "\n\n" : ""}${r.name}: ${r.text}` })); })
          .then((r) => { finishRound(r.text, r.durationMs, null); })
          .catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            finishRound("", Date.now() - t0, msg);
            send(sseChunk({ id, model: modelId, delta: `[Mastermind round failed: ${msg}]` }));
          })
          .finally(() => { send(sseChunk({ id, model: modelId, finish: "stop" })); send(SSE_DONE); close(); });
      },
    });
    return new Response(body_, {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" },
    });
  }

  // Prompt-based calling is sampled. When the user explicitly asked for a call
  // and the model answered in prose anyway, ask once more with a reminder —
  // the rabbitOS 3 probe gives up after a single miss.
  // Never on a turn that answers a tool result: prose is the right reply there (2026-10-01).
  const wantsCall = tools.length > 0 && ask !== null && explicitCallRequest(ask, tools);
  const runTurn = async (onDelta?: (t: string) => void): Promise<ClaudeTurnResult> => {
    const first = await runClaudeTurn({ model: model.claude, systemPrompt, prompt, cwd, signal: req.signal, onDelta });
    if (!wantsCall || first.isError || first.timedOut || parseToolCall(first.text, tools)) return first;
    log(`retry: explicit call request answered in prose ${shape}`);
    const second = await runClaudeTurn({ model: model.claude, systemPrompt, prompt: prompt + CALL_REMINDER, cwd, signal: req.signal });
    const sum = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
    return { ...second, durationMs: first.durationMs + second.durationMs, inputTokens: sum(first.inputTokens, second.inputTokens), outputTokens: sum(first.outputTokens, second.outputTokens) };
  };

  // Classify the finished turn once; both response paths use it.
  const settle = (r: ClaudeTurnResult) => {
    liveEnd(id);
    const failed = r.isError || r.timedOut || (!r.text && r.exitCode !== 0);
    const error = failed ? (r.timedOut ? "timeout" : (r.stderr || r.text || `exit ${r.exitCode ?? "?"}`)).slice(0, 2000) : null;
    const call = !failed && tools.length ? parseToolCall(r.text, tools) : null;
    const toolCalls: ToolCall[] | undefined = call ? [{ id: newCallId(), name: call.name, arguments: call.arguments }] : undefined;
    const assistantText = toolCalls ? toolCallText(call!.name, call!.arguments) : (r.text || (error ? `[error] ${error}` : ""));
    try {
      recordTurn({
        sessionId: session.id, user: current, assistant: assistantText,
        model: modelId, inputTokens: r.inputTokens, outputTokens: r.outputTokens, durationMs: r.durationMs, error,
      });
    } catch (e) {
      // The reply already exists; losing the transcript row must not lose the answer.
      console.error("[rabbit] recordTurn failed:", e instanceof Error ? e.message : e);
    }
    // A reply that LOOKS like a call but didn't parse is the one thing worth flagging loudly here.
    const looksLikeCall = !toolCalls && tools.length > 0 && /^\s*(```(?:json)?\s*)?\{\s*"tool_call"/.test(r.text);
    log(`${failed ? "502" : "200"} ${shapeSized}${toolCalls ? ` tool_call=${call!.name}` : ""}${looksLikeCall ? " TOOL_CALL_PARSE_FAILED" : ""} ${r.durationMs}ms${error ? ` error=${error.slice(0, 120)}` : ""}`);
    return { failed, error, toolCalls };
  };

  if (!stream) {
    const r = await runTurn();
    const { failed, error, toolCalls } = settle(r);
    if (r.timedOut) return oaiError("Claude CLI timed out.", 504, "server_error");
    if (failed) return oaiError(`Claude CLI failed: ${error}`, 502, "server_error");
    return Response.json(
      completionJson({ id, model: modelId, text: r.text, toolCalls, inputTokens: r.inputTokens, outputTokens: r.outputTokens }),
      { headers: { "cache-control": "no-store" } },
    );
  }

  const encoder = new TextEncoder();
  const bufferReply = tools.length > 0; // a tool call can only be recognised once the reply is complete
  const body_ = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (s: string) => { if (closed) return; try { controller.enqueue(encoder.encode(s)); } catch { closed = true; } };
      const close = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };

      send(sseChunk({ id, model: modelId, role: "assistant", delta: "" }));
      let streamedAny = false;
      void runTurn(
        bufferReply ? undefined : (t) => { streamedAny = true; send(sseChunk({ id, model: modelId, delta: t })); },
      ).then((r) => {
        const { failed, error, toolCalls } = settle(r);
        if (toolCalls) {
          send(sseChunk({ id, model: modelId, toolCalls }));
          send(sseChunk({ id, model: modelId, finish: "tool_calls" }));
        } else {
          // Buffered (tools present) or nothing streamed → ship the final text in one chunk.
          if (!streamedAny && r.text) send(sseChunk({ id, model: modelId, delta: r.text }));
          if (failed && !r.text) send(sseChunk({ id, model: modelId, delta: `[Claude CLI error: ${error}]` }));
          send(sseChunk({ id, model: modelId, finish: "stop" }));
        }
        send(SSE_DONE);
        close();
      });
    },
  });
  return new Response(body_, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
