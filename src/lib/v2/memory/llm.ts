import { z } from "zod";
import { readSettings } from "../../settings";
import { cliComplete, MINIMAX_CHAT } from "../../loopEngine";
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
  provider: "ollama-cloud" | "ollama-local" | "cli" | "minimax";
  model: string;
}

function resolve(complexity: Complexity): Resolved {
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
  return opts?.signal ?? AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

async function ollamaChat(
  provider: "ollama-cloud" | "ollama-local",
  model: string,
  messages: ChatMessage[],
  format: Record<string, unknown> | undefined,
  opts?: ModelCallOpts,
): Promise<string> {
  const cloud = provider === "ollama-cloud";
  const base = cloud ? "https://ollama.com" : process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cloud) {
    const key = process.env.OLLAMA_API_KEY || "";
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

function flattenForCli(messages: ChatMessage[]): string {
  return messages
    .map((m) => (m.role === "system" ? m.content : `${m.role === "user" ? "USER" : "ASSISTANT"}:\n${m.content}`))
    .join("\n\n");
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
      out = await ollamaChat(provider, model, messages, format, opts);
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
      let msgs = messages;
      if (schema) {
        msgs = [...messages];
        const last = msgs[msgs.length - 1];
        if (last?.role === "user") {
          msgs[msgs.length - 1] = { ...last, content: last.content + jsonOnlyInstruction(schema) };
        } else {
          msgs.push({ role: "user", content: jsonOnlyInstruction(schema).trim() });
        }
      }
      out = await minimaxChat(model, msgs, opts);
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

/** Structured call: the model output is parsed + zod-validated to T. */
export async function modelCall<T>(
  messages: ChatMessage[],
  complexity: Complexity,
  opts: ModelCallOpts & { schema: z.ZodType<T> },
): Promise<T> {
  const { out, provider, model } = await rawCall(messages, complexity, opts.schema, opts);
  try {
    return parseStructured(out, opts.schema);
  } catch (e) {
    throw new Error(`${provider}/${model} (${complexity}): ${e instanceof Error ? e.message : String(e)}`);
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
