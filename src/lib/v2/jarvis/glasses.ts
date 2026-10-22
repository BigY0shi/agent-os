// Even Realities G2 custom-agent lane. The Even app's "Add Agent" takes a Name,
// URL and Token and POSTs an OpenAI chat-completions body to the URL:
//
//   Authorization: Bearer <token>
//   { "model": "openclaw", "messages": [{ "role": "user", "content": "<speech>" }] }
//
// Verified 2026-09-22 against live captures (webhook.site): the app POSTs to the
// URL exactly as entered (no path appended), sends `Authorization: Bearer`,
// `User-Agent: EvenCore/1.0` and `x-openclaw-agent-id: main`, and the request
// comes from the phone's own network, not an Even server. No `stream` field;
// the model is always "openclaw"; every request carries ONLY the latest
// utterance, even after a successful reply — so the thread is kept here, as a
// Jarvis conversation with origin 'glasses', continued until idleMinutes of silence.
//
// Credentials: the token is stored as a sha256 hash only. The plaintext exists
// once, in the rotate response the owner pastes into the Even app; nothing
// reads it back (CLAUDE.md "one door").

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { readSettings } from "../../settings";
import { askJarvisV2 } from "./brain";
import { latestConversationByOrigin } from "./conversations";

export const GLASSES_SURFACE_NAME = "Even Realities G2 glasses";
export const GLASSES_MODEL_ID = "agentos-jarvis";

// ── token ───────────────────────────────────────────────────────────────────

export function glassesTokenPath(): string {
  // Test override — smokes must never touch the live token file.
  const override = process.env.AGENTIC_OS_GLASSES_TOKEN;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "jarvis-glasses.token");
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();

function readTokenHash(): Buffer | null {
  try {
    const p = glassesTokenPath();
    if (!existsSync(p)) return null;
    const hex = readFileSync(p, "utf8").trim();
    return /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, "hex") : null;
  } catch {
    return null;
  }
}

export function glassesTokenConfigured(): boolean {
  return readTokenHash() !== null;
}

/** Mint a new token (invalidating the old one). The ONLY place the plaintext exists. */
export function rotateGlassesToken(): string {
  const token = `aog_${randomBytes(24).toString("base64url")}`;
  const p = glassesTokenPath();
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, sha256(token).toString("hex") + "\n", { encoding: "utf8", mode: 0o600 });
  return token;
}

export function revokeGlassesToken(): void {
  rmSync(glassesTokenPath(), { force: true });
}

/** Accepts `Bearer <token>` (what the Even app sends) or the bare token. */
export function verifyGlassesAuth(header: string | null | undefined): boolean {
  const stored = readTokenHash();
  if (!stored || !header) return false;
  const presented = header.trim().replace(/^bearer\s+/i, "").trim();
  if (!presented) return false;
  return timingSafeEqual(stored, sha256(presented));
}

// ── settings ────────────────────────────────────────────────────────────────

export interface GlassesSettings {
  enabled: boolean;
  maxWords: number;
  idleMinutes: number;
  timeoutSeconds: number;
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt;

export function glassesSettings(): GlassesSettings {
  const g = readSettings().jarvis?.glasses ?? {};
  return {
    enabled: g.enabled === true,
    maxWords: clampInt(g.maxWords, 10, 300, 60),
    idleMinutes: clampInt(g.idleMinutes, 1, 24 * 60, 10),
    timeoutSeconds: clampInt(g.timeoutSeconds, 5, 300, 40),
  };
}

// ── request parsing ─────────────────────────────────────────────────────────

export class GlassesError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type = "invalid_request_error",
  ) {
    super(message);
  }
}

/** The latest user utterance from an OpenAI chat-completions body. */
export function parseCompletionRequest(body: unknown): { text: string; model: string } {
  if (!body || typeof body !== "object") throw new GlassesError(400, "Body must be a JSON object.");
  const b = body as { messages?: unknown; stream?: unknown; model?: unknown };
  if (b.stream === true) {
    throw new GlassesError(400, "Streaming is not supported by the Agent OS glasses lane; send stream:false.");
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    throw new GlassesError(400, "messages must be a non-empty array.");
  }
  let text = "";
  for (let i = b.messages.length - 1; i >= 0; i--) {
    const m = b.messages[i] as { role?: unknown; content?: unknown } | null;
    if (!m || m.role !== "user") continue;
    if (typeof m.content === "string") text = m.content;
    else if (Array.isArray(m.content)) {
      text = m.content
        .map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
        .filter(Boolean)
        .join(" ");
    }
    break;
  }
  text = text.trim().slice(0, 8000);
  if (!text) throw new GlassesError(400, "No user text found in messages.");
  return { text, model: typeof b.model === "string" ? b.model.slice(0, 64) : GLASSES_MODEL_ID };
}

// ── reply shaping ───────────────────────────────────────────────────────────

/** Markdown the lens would render literally. */
export function toLensText(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cap at maxWords, preferring the last sentence end inside the cap. Marks a cut with "…". */
export function capWords(s: string, maxWords: number): string {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  const head = words.slice(0, maxWords).join(" ");
  const lastEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  const cut = lastEnd > head.length / 2 ? head.slice(0, lastEnd + 1) : head.replace(/[,;:.!?]+$/, "");
  return `${cut} …`;
}

export function completionResponse(text: string, model: string) {
  return {
    id: `chatcmpl-${randomBytes(12).toString("hex")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    // Token counts are not measured on this lane; zeros are the OpenAI shape's
    // required fields, not a claim about cost.
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function errorResponse(err: GlassesError) {
  return { error: { message: err.message, type: err.type, code: err.status } };
}

// ── status (for the settings panel; never any content) ──────────────────────

interface GlassesStatus {
  lastRequestAt: string | null;
  lastError: string | null;
}
const g = globalThis as unknown as { __jarvisGlassesStatus?: GlassesStatus };
function status(): GlassesStatus {
  if (!g.__jarvisGlassesStatus) g.__jarvisGlassesStatus = { lastRequestAt: null, lastError: null };
  return g.__jarvisGlassesStatus;
}
export function glassesStatus(): GlassesStatus {
  return { ...status() };
}
export function noteGlassesRequest(error: string | null): void {
  const s = status();
  s.lastRequestAt = new Date().toISOString();
  s.lastError = error;
}

// ── the turn ────────────────────────────────────────────────────────────────

/** The glasses conversation to continue, or undefined to start fresh. */
export function glassesConversationId(idleMinutes: number, nowMs = Date.now()): string | undefined {
  const latest = latestConversationByOrigin("glasses");
  if (!latest) return undefined;
  const idleMs = nowMs - Date.parse(latest.updatedAt);
  return idleMs <= idleMinutes * 60_000 ? latest.id : undefined;
}

/**
 * One Jarvis turn for the lens. Throws GlassesError on every failure path —
 * a brain error is 502, running past timeoutSeconds is 504. Never substitutes
 * a canned answer.
 */
export async function askFromGlasses(
  text: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ answer: string; conversationId: string }> {
  const cfg = glassesSettings();
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, cfg.timeoutSeconds * 1000);
  const onUpstreamAbort = () => ctl.abort();
  opts.signal?.addEventListener("abort", onUpstreamAbort, { once: true });

  const sentences: string[] = [];
  const brain = { error: null as string | null };
  try {
    const { conversationId } = await askJarvisV2(
      {
        text,
        conversationId: glassesConversationId(cfg.idleMinutes),
        channel: "overlay",
        origin: "glasses",
        surface: { name: GLASSES_SURFACE_NAME, maxWords: cfg.maxWords },
      },
      (ev) => {
        if (ev.type === "sentence") sentences.push(ev.text);
        else if (ev.type === "error") brain.error = ev.message;
      },
      { signal: ctl.signal },
    );
    if (timedOut) {
      throw new GlassesError(504, `Jarvis did not answer within ${cfg.timeoutSeconds}s.`, "timeout");
    }
    if (brain.error) throw new GlassesError(502, `Jarvis failed: ${brain.error}`, "upstream_error");
    const answer = capWords(toLensText(sentences.join(" ")), cfg.maxWords);
    if (!answer) throw new GlassesError(502, "Jarvis returned an empty answer.", "upstream_error");
    return { answer, conversationId };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onUpstreamAbort);
  }
}
