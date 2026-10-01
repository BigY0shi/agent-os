import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { readSettings } from "../../settings";
import { cliComplete, MINIMAX_CHAT } from "../../loopEngine";
import { ollamaCloudHost, ollamaCloudKey, ollamaLocalUrl } from "../../ollamaCloud";
import type { ChatMessage } from "./types";

/**
 * A2.1 — the single LLM choke point for Memory V2 (rule 11: provider routing).
 * Every ingestion/search/persona call goes through modelCall(); the provider is
 * `settings.memory.provider` and the model per complexity tier is
 * `settings.memory.modelLow` / `modelMedium`. Empty output THROWS with the
 * provider+model named — no silent fallback, ever.
 *
 * Structured output keeps BOTH fallback parse paths from upstream (SPEC-A risk
 * #8 — local models ignore format instructions sometimes):
 *   (1) direct JSON.parse of the content,
 *   (2) <output>…</output> tag extraction,
 *   (3) first {...} block regex.
 * The parser is exported (parseStructured) so smoke-llm.mjs can exercise all
 * three paths offline.
 */

export type Complexity = "low" | "medium";

export interface ModelCallOpts {
  temperature?: number;
  signal?: AbortSignal;
  /** Max wall time when no signal is supplied (default 240s, matching cliComplete). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 240_000;

interface Resolved {
  provider: "ollama-cloud" | "ollama-local" | "cli" | "minimax" | "openai-compat";
  model: string;
}

/**
 * S5 (legacy backfill): a caller may pin provider + model for the duration of
 * one async call tree — the whole addEpisode() pipeline, Promise.all branches
 * included — without touching settings. The override is async-local, so a
 * concurrent ingest on the queue still resolves from settings. An optional
 * signal rides along so STOP reaches every fetch the tree makes (modelCall
 * opts.signal still wins when a caller passes one explicitly).
 */
export interface MemoryModelOverride {
  provider: Resolved["provider"];
  model: string;
  signal?: AbortSignal;
}

const OVERRIDE = new AsyncLocalStorage<MemoryModelOverride>();

export function withMemoryModel<T>(override: MemoryModelOverride, fn: () => Promise<T>): Promise<T> {
  return OVERRIDE.run(override, fn);
}

function resolve(complexity: Complexity): Resolved {
  const pinned = OVERRIDE.getStore();
  if (pinned) return { provider: pinned.provider, model: pinned.model };
  const mem = readSettings().memory ?? {};
  const provider = mem.provider ?? "ollama-cloud";
  const model =
    complexity === "low"
      ? mem.modelLow || "kimi-k2.6:cloud"
      : mem.modelMedium || "glm-5.2:cloud";
  return { provider, model };
}

// ---------------------------------------------------------------------------
// Structured-output parsing (exported for offline smoke coverage)
// ---------------------------------------------------------------------------

/** Pull the inner text of an <output>…</output> block, if present. */
export function extractOutputTag(raw: string): string | null {
  const m = /<output>([\s\S]*?)<\/output>/i.exec(raw);
  return m ? m[1].trim() : null;
}

/**
 * Parse an LLM response into a schema-validated object. Tries, in order:
 * direct JSON.parse → <output>-tag contents → first {...} block. Throws with
 * the raw content tail when nothing parses or validation fails.
 */
export function parseStructured<T>(raw: string, schema: z.ZodType<T>): T {
  const trimmed = raw.trim();
  const candidates: string[] = [trimmed];
  const tagged = extractOutputTag(trimmed);
  if (tagged) candidates.push(tagged);
  for (const source of [tagged ?? trimmed, trimmed]) {
    const first = source.indexOf("{");
    const last = source.lastIndexOf("}");
    if (first !== -1 && last > first) candidates.push(source.slice(first, last + 1));
  }

  let lastValidationError: string | null = null;
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue; // not JSON — try the next fallback path
    }
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    lastValidationError = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
  }

  const tail = trimmed.slice(-400);
  if (lastValidationError) {
    throw new Error(
      `structured output failed schema validation (${lastValidationError}). Raw tail: …${tail}`,
    );
  }
  throw new Error(`no JSON found in model output (tried direct parse, <output> tag, {...} block). Raw tail: …${tail}`);
}

// ---------------------------------------------------------------------------
// Provider transports
// ---------------------------------------------------------------------------

function signalFor(opts?: ModelCallOpts): AbortSignal {
  if (opts?.signal) return opts.signal;
  const pinned = OVERRIDE.getStore()?.signal;
  const timeout = AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return pinned ? AbortSignal.any([pinned, timeout]) : timeout;
}

async function ollamaChat(
  provider: "ollama-cloud" | "ollama-local",
  model: string,
  messages: ChatMessage[],
  format: Record<string, unknown> | undefined,
  opts?: ModelCallOpts,
): Promise<string> {
  // Host, local URL and key: settings.ollama (the Ollama page's gear), then the environment
  // (lib/ollamaCloud.ts), read per call.
  const cloud = provider === "ollama-cloud";
  const base = cloud ? ollamaCloudHost() : ollamaLocalUrl();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cloud) {
    const key = ollamaCloudKey();
    if (key) headers.authorization = `Bearer ${key}`;
  }
  const body: Record<string, unknown> = { model, messages, stream: false };
  if (format) body.format = format; // Ollama accepts a JSON schema in `format`
  if (opts?.temperature !== undefined) body.options = { temperature: opts.temperature };

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: signalFor(opts),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${provider} chat failed (${res.status}) model=${model} at ${base}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return String(data.message?.content ?? "").trim();
}

// MiniMax: loopEngine's minimaxComplete is module-private (and keyed off the
// Hermes OAuth token), so this is the sanctioned minimal OpenAI-compatible
// call using settings.pipeline.minimaxKey — same endpoint, same <think> strip.
async function minimaxChat(model: string, messages: ChatMessage[], opts?: ModelCallOpts): Promise<string> {
  const key = readSettings().pipeline?.minimaxKey || "";
  if (!key) {
    throw new Error(
      "memory provider is 'minimax' but settings.pipeline.minimaxKey is empty — set it in the Pipeline gear or pick another provider.",
    );
  }
  const res = await fetch(MINIMAX_CHAT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 12000,
      temperature: opts?.temperature ?? 0.6,
    }),
    signal: signalFor(opts),
  });
  const j = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    base_resp?: { status_msg?: string };
    error?: { message?: string };
  } | null;
  if (!res.ok || !j?.choices?.[0]) {
    throw new Error(j?.base_resp?.status_msg || j?.error?.message || `MiniMax ${res.status}`);
  }
  let c = String(j.choices[0].message?.content ?? "").trim();
  c = c.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
  return c;
}

/**
 * OpenAI-compatible chat (LM Studio, llama.cpp server, vLLM, any /v1 shim).
 *
 * The reason this provider exists: models that need a llama.cpp fork - Bonsai
 * 27B is the case in hand - cannot be served by Ollama at all, and LM Studio
 * fronts them on the OpenAI wire format instead. This is a plain completion
 * transport: messages in, text out, NO tool calls. Base URL comes from
 * settings.memory.openaiCompatUrl (or OPENAI_COMPAT_URL), and must include the
 * /v1 path segment; LM Studio's default is http://127.0.0.1:1234/v1.
 *
 * A key is read from the environment only (OPENAI_COMPAT_API_KEY) and never
 * from settings, so no getter in this codebase can return key material. Local
 * servers normally need none.
 *
 * `reasoning_effort` rides along when settings.memory.openaiCompatReasoningEffort
 * is set (default "none"), because a thinking model otherwise spends ~25 s per
 * call on a monologue this pipeline discards.
 *
 * Structured output is belt AND suspenders, same as the Ollama path: the JSON
 * schema goes in `response_format` for servers that honour it, and the schema
 * is ALSO spelled out in the prompt by the caller (withJsonInstruction). A
 * reasoning model's <think> block is stripped, as on the MiniMax path.
 */
/**
 * `reasoning_effort` for the openai-compat call, or "" to send nothing.
 * Exported so a caller can say in its own log which value actually went out.
 */
export function openaiCompatReasoningEffort(): string {
  const env = process.env.OPENAI_COMPAT_REASONING_EFFORT;
  if (env !== undefined) return env.trim(); // set by the CLI --reasoning-effort flag
  return (readSettings().memory?.openaiCompatReasoningEffort ?? "none").trim();
}

export function openaiCompatBase(): string {
  const configured = readSettings().memory?.openaiCompatUrl || process.env.OPENAI_COMPAT_URL || "";
  const base = (configured || "http://127.0.0.1:1234/v1").trim().replace(/\/+$/, "");
  return base;
}

async function openaiCompatChat(
  model: string,
  messages: ChatMessage[],
  schema: z.ZodType<unknown> | undefined,
  opts?: ModelCallOpts,
): Promise<string> {
  const base = openaiCompatBase();
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = process.env.OPENAI_COMPAT_API_KEY || "";
  if (key) headers.authorization = `Bearer ${key}`;

  const body: Record<string, unknown> = { model, messages, stream: false };
  if (opts?.temperature !== undefined) body.temperature = opts.temperature;
  // A reasoning model left to itself burns most of its budget on a monologue
  // the caller throws away (bonsai-27b: 1905 reasoning tokens for a 51-token
  // answer, 26 s vs 1.2 s with "none", same facts). Sent only when chosen;
  // servers that do not know the field ignore it.
  const effort = openaiCompatReasoningEffort();
  if (effort) body.reasoning_effort = effort;
  if (schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "memory_output", strict: false, schema: z.toJSONSchema(schema as z.ZodType) },
    };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signalFor(opts),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `openai-compat chat could not reach ${base} (${msg}) model=${model}. ` +
        `Start the server (LM Studio: Developer tab > Start Server) or set settings.memory.openaiCompatUrl. No fallback.`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`openai-compat chat failed (${res.status}) model=${model} at ${base}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  } | null;
  if (!data?.choices?.[0]) {
    throw new Error(`openai-compat chat returned no choices (model=${model} at ${base}): ${data?.error?.message ?? "unknown"}`);
  }
  let c = String(data.choices[0].message?.content ?? "").trim();
  c = c.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
  return c;
}

function flattenForCli(messages: ChatMessage[]): string {
  return messages
    .map((m) => (m.role === "system" ? m.content : `${m.role === "user" ? "USER" : "ASSISTANT"}:\n${m.content}`))
    .join("\n\n");
}

/** Append the JSON-only instruction to the trailing user message. */
function withJsonInstruction(
  messages: ChatMessage[],
  schema: z.ZodType<unknown>,
): ChatMessage[] {
  const msgs = [...messages];
  const last = msgs[msgs.length - 1];
  if (last?.role === "user") {
    msgs[msgs.length - 1] = { ...last, content: last.content + jsonOnlyInstruction(schema) };
  } else {
    msgs.push({ role: "user", content: jsonOnlyInstruction(schema).trim() });
  }
  return msgs;
}

function jsonOnlyInstruction(schema: z.ZodType<unknown>): string {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema as z.ZodType));
  return (
    `\n\nCRITICAL OUTPUT FORMAT: Respond with ONLY a single JSON object that validates against this JSON Schema ` +
    `(no prose, no markdown fences):\n${jsonSchema}\n` +
    `Wrap the JSON object in <output></output> tags.`
  );
}

// ---------------------------------------------------------------------------
// modelCall / modelCallText
// ---------------------------------------------------------------------------

async function rawCall(
  messages: ChatMessage[],
  complexity: Complexity,
  schema: z.ZodType<unknown> | undefined,
  opts?: ModelCallOpts,
): Promise<{ out: string; provider: string; model: string }> {
  const { provider, model } = resolve(complexity);
  let out: string;

  switch (provider) {
    case "ollama-cloud":
    case "ollama-local": {
      const format = schema ? (z.toJSONSchema(schema as z.ZodType) as Record<string, unknown>) : undefined;
      // Belt AND suspenders: several Ollama(-cloud) models silently ignore the
      // `format` JSON-schema param (observed live: glm-5.2:cloud returning
      // subject/object keys + markdown) — so the schema is ALSO spelled out as
      // a textual instruction (SPEC-A risk #8: keep both paths alive).
      const msgs = schema ? withJsonInstruction(messages, schema) : messages;
      out = await ollamaChat(provider, model, msgs, format, opts);
      break;
    }
    case "cli": {
      const agent = readSettings().defaultAgent || "claude";
      let prompt = flattenForCli(messages);
      if (schema) prompt += jsonOnlyInstruction(schema);
      out = (
        await cliComplete(agent, prompt, {
          signal: opts?.signal,
          timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        })
      ).trim();
      break;
    }
    case "minimax": {
      const msgs = schema ? withJsonInstruction(messages, schema) : messages;
      out = await minimaxChat(model, msgs, opts);
      break;
    }
    case "openai-compat": {
      const msgs = schema ? withJsonInstruction(messages, schema) : messages;
      out = await openaiCompatChat(model, msgs, schema, opts);
      break;
    }
    default:
      throw new Error(`unknown memory provider '${provider}' — check settings.memory.provider`);
  }

  if (!out) {
    throw new Error(
      `memory LLM returned empty output (provider=${provider} model=${model} tier=${complexity}) — failing loudly, no fallback (rule 11).`,
    );
  }
  return { out, provider, model };
}

/**
 * Structured call: the model output is parsed + zod-validated to T.
 * One corrective retry on parse/validation failure: the model is shown its
 * failed output plus the exact validation errors and asked to re-emit —
 * observed necessary live (glm-5.2:cloud drifting to subject/object keys and
 * dropping nullable fields even with the schema in `format`).
 */
export async function modelCall<T>(
  messages: ChatMessage[],
  complexity: Complexity,
  opts: ModelCallOpts & { schema: z.ZodType<T> },
): Promise<T> {
  const { out, provider, model } = await rawCall(messages, complexity, opts.schema, opts);
  let firstError: string;
  try {
    return parseStructured(out, opts.schema);
  } catch (e) {
    firstError = e instanceof Error ? e.message : String(e);
  }

  const retryMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: out.slice(0, 6000) },
    {
      role: "user",
      content:
        `Your previous response was rejected: ${firstError.slice(0, 600)}\n\n` +
        `Respond again with ONLY a single JSON object that validates against the required schema — ` +
        `use EXACTLY the property names the schema defines, include every required property ` +
        `(use null where a nullable value is unknown), no prose, no markdown fences. ` +
        `Wrap the JSON object in <output></output> tags.` +
        jsonOnlyInstruction(opts.schema),
    },
  ];
  try {
    const second = await rawCall(retryMessages, complexity, opts.schema, opts);
    return parseStructured(second.out, opts.schema);
  } catch (retryErr) {
    throw new Error(
      `${provider}/${model} (${complexity}): ${firstError} — corrective retry also failed: ${
        retryErr instanceof Error ? retryErr.message : String(retryErr)
      }`,
    );
  }
}

/** Unstructured convenience: returns the raw (trimmed, non-empty) text. */
export async function modelCallText(
  messages: ChatMessage[],
  complexity: Complexity,
  opts?: ModelCallOpts,
): Promise<string> {
  const { out } = await rawCall(messages, complexity, undefined, opts);
  return out;
}
