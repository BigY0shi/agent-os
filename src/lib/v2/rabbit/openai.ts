// Rabbit R1 bridge — pure helpers for the OpenAI chat-completions dialect,
// INCLUDING function calling: rabbitOS 3 probes a new endpoint with
// `tools: [ping]` + "Call the ping function." and expects a `tool_calls` reply;
// a prose answer makes it declare the model incompatible (seen 2026-09-13).
// `claude -p` has no per-request tool registry, so calls are prompt-based: the
// schemas go into the system prompt, the model answers with ONE JSON object,
// and parseToolCall turns that into the OpenAI shape.
// No I/O here so scripts/v2/smoke-rabbit.mjs can exercise every branch offline.

export type ChatRole = "system" | "user" | "assistant" | "tool";
export interface ToolCall { id: string; name: string; arguments: string /* JSON text */ }
export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** assistant messages the client echoes back that were tool calls */
  toolCalls?: ToolCall[];
  /** tool-result messages */
  toolCallId?: string;
  name?: string;
}
export interface ToolDef { name: string; description: string; parameters: unknown }
export interface ChatRequest { messages: ChatMessage[]; model: string; stream: boolean; tools: ToolDef[] }

export const DEFAULT_MODEL_ID = "agentos-claude";

/** Model ids the bridge advertises. `claude: null` = "whatever CLAUDE_MODEL is". */
export const MODELS: ReadonlyArray<{ id: string; claude: string | null; note: string }> = [
  { id: DEFAULT_MODEL_ID, claude: null, note: "Agent OS default Claude model (AGENTIC_OS_CLAUDE_MODEL)" },
  { id: "claude-fable-5-1", claude: "claude-fable-5-1", note: "Claude Fable 5.1" },
  { id: "claude-opus-5", claude: "claude-opus-5", note: "Claude Opus 5" },
  { id: "claude-sonnet-5", claude: "claude-sonnet-5", note: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5-20251001", claude: "claude-haiku-4-5-20251001", note: "Claude Haiku 4.5" },
  // Served by lib/v2/rabbit/mastermind.ts, not by a claude spawn: the /room
  // agents answer as a panel. `claude: null` keeps resolveModel happy; the
  // completions route checks isMastermindModel() before touching model.claude.
  { id: "agentos-mastermind", claude: null, note: "AI Agent Mastermind — the room's agents answer as a panel" },
];

/** Cap on the packed conversation. It travels over stdin (no arg limit); this is a sanity ceiling. */
export const MAX_PROMPT_CHARS = 200_000;
/** Cap on the assembled system prompt. It travels via --system-prompt-file (no arg limit).
 *  The R1's real instructions exceeded 120k (seen truncated at exactly 120000ch, 2026-09-14). */
export const MAX_SYSTEM_CHARS = 1_000_000;
/** Raw request size guard (413). The R1's real turn is ~180 KB. */
export const MAX_REQUEST_CHARS = 1_500_000;

export type ParseResult =
  | { ok: true; req: ChatRequest }
  | { ok: false; status: number; error: string };

function contentToText(c: unknown): string | null {
  if (typeof c === "string") return c;
  // OpenAI "parts" form: [{type:"text"|"input_text", text:"…"}, {type:"image_url", …}]
  // (input_text is the Responses-API spelling some SDKs emit; non-text parts are skipped.)
  if (Array.isArray(c)) {
    const parts: string[] = [];
    for (const p of c) {
      if (!p || typeof p !== "object") continue;
      const part = p as { type?: unknown; text?: unknown };
      if ((part.type === "text" || part.type === "input_text" || part.type === "output_text") && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
    return parts.join("\n");
  }
  if (c === null || c === undefined) return "";
  return null;
}

const ROLE_MAP: Record<string, ChatRole> = {
  system: "system", developer: "system", user: "user", assistant: "assistant", tool: "tool", function: "tool",
};

function parseTools(b: Record<string, unknown>): ToolDef[] {
  const out: ToolDef[] = [];
  if (Array.isArray(b.tools)) {
    for (const t of b.tools) {
      const fn = (t as { type?: unknown; function?: Record<string, unknown> })?.function;
      if ((t as { type?: unknown })?.type === "function" && fn && typeof fn.name === "string" && fn.name.trim()) {
        out.push({ name: fn.name.trim(), description: typeof fn.description === "string" ? fn.description : "", parameters: fn.parameters ?? { type: "object", properties: {} } });
      }
    }
  }
  // Legacy `functions: [{name, description, parameters}]`.
  if (Array.isArray(b.functions)) {
    for (const f of b.functions) {
      const fn = f as Record<string, unknown>;
      if (fn && typeof fn.name === "string" && fn.name.trim() && !out.some((o) => o.name === fn.name)) {
        out.push({ name: fn.name.trim(), description: typeof fn.description === "string" ? fn.description : "", parameters: fn.parameters ?? { type: "object", properties: {} } });
      }
    }
  }
  if (b.tool_choice === "none" || b.function_call === "none") return [];
  return out.slice(0, 64);
}

export function parseChatRequest(body: unknown): ParseResult {
  if (!body || typeof body !== "object") return { ok: false, status: 400, error: "Body must be a JSON object." };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { ok: false, status: 400, error: "`messages` must be a non-empty array." };
  }
  const messages: ChatMessage[] = [];
  let total = 0;
  for (const raw of b.messages) {
    if (!raw || typeof raw !== "object") return { ok: false, status: 400, error: "Each message must be an object." };
    const m = raw as Record<string, unknown>;
    const role = typeof m.role === "string" ? ROLE_MAP[m.role] : undefined;
    if (!role) return { ok: false, status: 400, error: `Unsupported message role "${String(m.role)}".` };
    const text = contentToText(m.content);
    if (text === null) return { ok: false, status: 400, error: "Message `content` must be a string or an array of text parts." };
    total += text.length;
    const msg: ChatMessage = { role, content: text };
    if (role === "assistant" && Array.isArray(m.tool_calls)) {
      msg.toolCalls = (m.tool_calls as Array<Record<string, unknown>>)
        .map((tc) => {
          const fn = (tc?.function ?? {}) as Record<string, unknown>;
          const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {});
          return { id: typeof tc?.id === "string" ? tc.id : "", name: typeof fn.name === "string" ? fn.name : "", arguments: args };
        })
        .filter((tc) => tc.name);
      total += msg.toolCalls.reduce((n, tc) => n + tc.arguments.length, 0);
    }
    if (role === "tool") {
      if (typeof m.tool_call_id === "string") msg.toolCallId = m.tool_call_id;
      if (typeof m.name === "string") msg.name = m.name;
    }
    messages.push(msg);
  }
  if (!messages.some((m) => (m.role === "user" && m.content.trim()) || m.role === "tool")) {
    return { ok: false, status: 400, error: "At least one non-empty user message (or a tool result) is required." };
  }
  if (total > MAX_REQUEST_CHARS) {
    return { ok: false, status: 413, error: `Conversation too long: ${total} chars of message content, limit ${MAX_REQUEST_CHARS}.` };
  }
  const model = typeof b.model === "string" && b.model.trim() ? b.model.trim() : DEFAULT_MODEL_ID;
  const stream = b.stream === true;
  return { ok: true, req: { messages, model, stream, tools: parseTools(b) } };
}

/**
 * Map a requested model id to the `--model` value for the claude CLI.
 * Unknown ids are an error (AGENTS.md: never silently substitute a model the
 * user did not choose); a MISSING id gets the Agent OS default.
 */
export function resolveModel(requested: string, defaultClaudeModel: string): { ok: true; claude: string } | { ok: false; error: string } {
  const known = MODELS.find((m) => m.id === requested);
  if (known) return { ok: true, claude: known.claude ?? defaultClaudeModel };
  // Pass-through for any other claude-* id or CLI alias the user typed by hand.
  if (/^claude-[a-z0-9.-]+$/i.test(requested) || /^(opus|sonnet|haiku|fable)$/i.test(requested)) {
    return { ok: true, claude: requested };
  }
  return { ok: false, error: `Unknown model "${requested}". Use one of: ${MODELS.map((m) => m.id).join(", ")}.` };
}

export const RABBIT_PERSONA =
  "You are the assistant behind a Rabbit R1 handheld. The reply is read aloud and shown on a small screen: " +
  "answer directly, in plain sentences, no markdown, no headings, no code fences unless code was explicitly requested. " +
  "Keep it short unless the user asks for detail.";

/** The canonical text a tool call is stored/echoed as (session linking hashes it). */
export function toolCallText(name: string, argumentsJson: string): string {
  return `{"tool_call":{"name":${JSON.stringify(name)},"arguments":${argumentsJson}}}`;
}

function toolsSection(tools: ToolDef[]): string {
  const lines = [
    "FUNCTION CALLING — this section overrides every style rule below.",
    "The functions listed here are run by the caller, not by you. You cannot run them yourself and you must never guess, simulate or invent what a function would return.",
    "To call one, your ENTIRE reply must be exactly one JSON object on one line — no words before or after it, no markdown, no code fence:",
    '{"tool_call":{"name":"<function name>","arguments":{<arguments matching that function\'s parameters>}}}',
    "Emit that JSON whenever the user's request needs a function, and ALWAYS when the user asks you to call, run, use or invoke one (e.g. \"call the ping function\" → the JSON call, nothing else). The caller runs it and sends you the result as a tool message; answer in plain text after that.",
    "If no function is needed, reply normally in plain text. Never call a function that is not listed.",
    "Functions:",
  ];
  for (const t of tools) {
    lines.push(`- ${t.name}${t.description ? ` — ${t.description}` : ""}`);
    lines.push(`  parameters: ${JSON.stringify(t.parameters)}`);
  }
  return lines.join("\n");
}

function renderLine(m: ChatMessage): string {
  if (m.role === "user") return `User: ${m.content.trim()}`;
  if (m.role === "tool") return `Tool result (${m.name ?? m.toolCallId ?? "function"}): ${m.content.trim()}`;
  if (m.toolCalls?.length) return `Assistant: ${m.toolCalls.map((tc) => toolCallText(tc.name, tc.arguments)).join("\n")}`;
  return `Assistant: ${m.content.trim()}`;
}

/**
 * Pack the OpenAI message list into (systemPrompt, prompt) for a stateless
 * `claude -p` call — the same "prior turns inside the prompt" approach the
 * Claude chat tab uses, because --resume is not reliable across -p calls.
 * Everything after the last assistant reply is "what to answer now" (a user
 * message, or the tool results for a call the model just made).
 */
export function buildPrompt(
  messages: ChatMessage[],
  opts: { persona?: string; maxTurns?: number; tools?: ToolDef[] } = {},
): { systemPrompt: string; prompt: string } {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content.trim()).filter(Boolean);
  const persona = opts.persona && opts.persona.trim() ? opts.persona.trim() : RABBIT_PERSONA;
  const tools = opts.tools ?? [];
  // Tools first: the "plain sentences, no code" persona must not outrank the JSON-call rule.
  // Capped under the runner's 32k per-argument limit — an over-long --system-prompt
  // value would be DROPPED by safeArg and the next flag would become the prompt.
  const systemPrompt = [...(tools.length ? [toolsSection(tools)] : []), persona, ...systemParts].join("\n\n").slice(0, MAX_SYSTEM_CHARS);

  const turns = messages.filter((m) => m.role !== "system");
  if (turns.length === 1 && turns[0].role === "user") {
    return { systemPrompt, prompt: turns[0].content.trim().slice(0, MAX_PROMPT_CHARS) };
  }

  let lastAsst = -1;
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "assistant") { lastAsst = i; break; }
  const maxTurns = Math.min(Math.max(Math.floor(opts.maxTurns ?? 24), 0), 200);
  const history = turns.slice(0, lastAsst + 1).slice(-(maxTurns * 2));
  const tail = turns.slice(lastAsst + 1);
  const tailText = tail.map(renderLine).join("\n");
  const tailIsToolResult = tail.length > 0 && tail.every((m) => m.role === "tool");

  const lines: string[] = [
    "The following is the prior conversation between you and the user.",
    tailIsToolResult
      ? "Read it, then use the tool result(s) at the bottom to answer the user's earlier request."
      : "Read it, then answer the user's latest message at the bottom.",
    "",
    "--- prior conversation ---",
  ];
  const budget = MAX_PROMPT_CHARS - tailText.length - 400;
  // Walk newest→oldest so the most recent turns survive the trim, then restore order.
  const kept: string[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const line = renderLine(history[i]);
    if (used + line.length > budget) { kept.push("…[earlier turns trimmed]"); break; }
    kept.push(line);
    used += line.length;
  }
  lines.push(...kept.reverse(), "--- end prior conversation ---", "");
  if (tailText) lines.push(tailText);
  lines.push("Assistant:");
  return { systemPrompt, prompt: lines.join("\n").slice(0, MAX_PROMPT_CHARS) };
}

/**
 * What the store needs to link a stateless request to a session: the current
 * question, the LAST assistant reply the client echoed back (null on a first
 * turn) and the first user message (the session title).
 */
export function splitTurns(messages: ChatMessage[]): { current: string; priorAssistant: string | null; firstUser: string } {
  const turns = messages.filter((m) => m.role !== "system");
  let lastAsst = -1;
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "assistant") { lastAsst = i; break; }
  const tail = turns.slice(lastAsst + 1);
  const current = (tail.length ? tail.map((m) => (m.role === "tool" ? `[${m.name ?? "tool"}] ${m.content}` : m.content)).join("\n") : turns[turns.length - 1]?.content ?? "").trim();
  let priorAssistant: string | null = null;
  if (lastAsst >= 0) {
    const a = turns[lastAsst];
    priorAssistant = a.toolCalls?.length ? a.toolCalls.map((tc) => toolCallText(tc.name, tc.arguments)).join("\n") : (a.content.trim() ? a.content : null);
  }
  const firstUser = (turns.find((m) => m.role === "user" && m.content.trim())?.content ?? current).trim();
  return { current, priorAssistant, firstUser };
}

// ── tool-call extraction from the model's reply ──────────────────────────────
function firstJsonObject(t: string): string | null {
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return t.slice(start, i + 1); }
  }
  return null;
}

/**
 * Did the user explicitly ask for a function to be called ("call the ping
 * function", "run ping", "use the timer tool")? Prompt-based calling is
 * sampled; on such a request the route re-asks once if the model answered in
 * prose — the rabbitOS 3 probe is exactly this shape and gives up after one miss.
 */
export function explicitCallRequest(text: string, tools: ToolDef[]): boolean {
  const t = text.toLowerCase();
  if (!/\b(call|run|use|invoke|execute|trigger|fire)\b/.test(t)) return false;
  if (/\b(function|tool)s?\b/.test(t)) return true;
  // A tool NAME counts only when it looks like one (snake_case or ≥ 6 chars)
  // and appears as a whole word. The R1 ships a tool literally named `wait`,
  // which turned every "wait, run that again" into a costly re-ask (2026-09-14).
  return tools.some((d) => {
    const name = d.name.toLowerCase();
    if (!(name.includes("_") || name.includes("-") || name.length >= 6)) return false;
    return new RegExp(`(^|[^a-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`).test(t);
  });
}

export const CALL_REMINDER =
  "\n\n(Reminder: the user asked you to call a function. Your entire reply must be the JSON tool_call object and nothing else — no words, no explanation.)";

/**
 * Close what the model left open. Sonnet 5 shipped a 594-char render_ui call
 * missing its final `}` (2026-09-14); one unbalanced bracket must not turn a
 * call into prose the handheld reads aloud. Scans with string awareness, then
 * appends the missing closers (and a closing quote if it stopped mid-string).
 */
export function repairJson(t: string): string {
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") { if (stack[stack.length - 1] === ch) stack.pop(); }
  }
  let out = t.replace(/,\s*$/, "");
  if (inStr) out += '"';
  while (stack.length) out += stack.pop();
  return out;
}

export function newCallId(): string {
  return "call_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

/** The model's reply → a tool call, or null when it answered in prose. */
export function parseToolCall(text: string, tools: ToolDef[]): { name: string; arguments: string } | null {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) return null;
  let obj: Record<string, unknown> | null = null;
  try { obj = JSON.parse(t); } catch {
    // Trailing prose after a complete object → take the balanced prefix.
    const inner = firstJsonObject(t);
    if (inner) { try { obj = JSON.parse(inner); } catch { obj = null; } }
    // Still nothing → the object itself is unbalanced; close what's open and retry.
    if (!obj) { try { obj = JSON.parse(repairJson(t)); } catch { obj = null; } }
  }
  if (!obj || typeof obj !== "object") return null;
  let name: unknown;
  let args: unknown;
  const tc = obj.tool_call as Record<string, unknown> | undefined;
  if (tc && typeof tc === "object") { name = tc.name; args = tc.arguments; }
  else if (typeof obj.name === "string" && ("arguments" in obj || "parameters" in obj)) { name = obj.name; args = obj.arguments ?? obj.parameters; }
  else return null;
  if (typeof name !== "string" || !name.trim()) return null;
  if (tools.length && !tools.some((d) => d.name === name)) return null; // never invent
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
  if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
  return { name, arguments: JSON.stringify(args) };
}

// ── claude --output-format=stream-json line parsing ──────────────────────────
export interface StreamLine {
  /** Incremental assistant text (from stream_event content_block_delta text_delta). */
  delta?: string;
  /** Final result event: full text + usage. */
  result?: { text: string; isError: boolean; inputTokens?: number; outputTokens?: number };
}

export function parseStreamLine(line: string): StreamLine | null {
  const t = line.trim();
  if (!t) return null;
  let ev: Record<string, unknown>;
  try { ev = JSON.parse(t); } catch { return null; }
  if (ev.type === "stream_event") {
    const inner = ev.event as Record<string, unknown> | undefined;
    if (inner?.type === "content_block_delta") {
      const d = inner.delta as Record<string, unknown> | undefined;
      if (d?.type === "text_delta" && typeof d.text === "string") return { delta: d.text };
    }
    return null;
  }
  if (ev.type === "result") {
    const usage = ev.usage as Record<string, unknown> | undefined;
    return {
      result: {
        text: typeof ev.result === "string" ? ev.result : "",
        isError: ev.is_error === true || (typeof ev.subtype === "string" && ev.subtype.startsWith("error")),
        inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
        outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
      },
    };
  }
  return null;
}

// ── OpenAI response shapes ──────────────────────────────────────────────────
export function completionId(): string {
  return "chatcmpl-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function oaiToolCalls(calls: ToolCall[], withIndex: boolean) {
  return calls.map((tc, i) => ({
    ...(withIndex ? { index: i } : {}),
    id: tc.id,
    type: "function" as const,
    function: { name: tc.name, arguments: tc.arguments },
  }));
}

export function completionJson(opts: {
  id: string; model: string; text: string; toolCalls?: ToolCall[]; inputTokens?: number; outputTokens?: number;
}): Record<string, unknown> {
  const isCall = !!opts.toolCalls?.length;
  const message = isCall
    ? { role: "assistant", content: null, tool_calls: oaiToolCalls(opts.toolCalls!, false) }
    : { role: "assistant", content: opts.text };
  const out: Record<string, unknown> = {
    id: opts.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: opts.model,
    choices: [{ index: 0, message, finish_reason: isCall ? "tool_calls" : "stop" }],
  };
  // Usage only when the CLI reported it — never invented (AGENTS.md: never fabricate state).
  if (typeof opts.inputTokens === "number" && typeof opts.outputTokens === "number") {
    out.usage = { prompt_tokens: opts.inputTokens, completion_tokens: opts.outputTokens, total_tokens: opts.inputTokens + opts.outputTokens };
  }
  return out;
}

export function sseChunk(opts: {
  id: string; model: string; delta?: string; role?: "assistant"; toolCalls?: ToolCall[]; finish?: "stop" | "tool_calls" | "error";
}): string {
  const delta: Record<string, unknown> = {};
  if (opts.role) delta.role = opts.role;
  if (typeof opts.delta === "string") delta.content = opts.delta;
  if (opts.toolCalls?.length) delta.tool_calls = oaiToolCalls(opts.toolCalls, true);
  const payload = {
    id: opts.id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: opts.model,
    choices: [{ index: 0, delta, finish_reason: opts.finish ?? null }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export const SSE_DONE = "data: [DONE]\n\n";

export function modelsJson(): Record<string, unknown> {
  return {
    object: "list",
    data: MODELS.map((m) => ({ id: m.id, object: "model", created: 0, owned_by: "agent-os", description: m.note })),
  };
}
