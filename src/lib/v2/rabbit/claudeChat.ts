// Rabbit R1 bridge — one stateless `claude -p` turn, streamed. The ONLY place
// the bridge spawns anything; the route composes this with the OpenAI framing.
// Uses the owner's logged-in claude CLI (subscription), never an API key — the
// same spawn shape as /api/claude/chat, with two differences (2026-09-14):
//   * the system prompt goes through --system-prompt-file, and
//   * the conversation goes through stdin (runner's `input`),
// because runner.safeArg DROPS any single argument ≥ 32k chars and the R1's
// real conversation (device instructions + tool list) blew past that: the
// device saw "413 Conversation too long", then would have seen a silently
// mangled arg list. Both mechanisms verified against claude 2.1.263 the same
// day (FILEOK / STDINOK probes in DEV-JOURNAL).

import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { spawnStream } from "@/lib/runner";
import { parseStreamLine } from "./openai";

export interface ClaudeTurnOpts {
  model: string;
  systemPrompt: string;
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onDelta?: (text: string) => void;
}

export interface ClaudeTurnResult {
  text: string;
  isError: boolean;
  exitCode: number | null;
  stderr: string;
  inputTokens?: number;
  outputTokens?: number;
  timedOut: boolean;
  durationMs: number;
}

/**
 * The system prompt as a file, named by its own hash: the same prompt (the
 * R1's instructions barely change) reuses one file, so nothing accumulates
 * and nothing ever needs deleting. Override the folder with
 * AGENTIC_OS_RABBIT_TMP (smokes).
 */
export function systemPromptFile(systemPrompt: string): string {
  const dir = process.env.AGENTIC_OS_RABBIT_TMP?.trim() || path.join(os.tmpdir(), "agentos-rabbit");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `system-${createHash("sha256").update(systemPrompt).digest("hex").slice(0, 16)}.txt`);
  writeFileSync(file, systemPrompt, "utf8");
  return file;
}

export function runClaudeTurn(opts: ClaudeTurnOpts): Promise<ClaudeTurnResult> {
  const args = [
    "-p",
    "--model", opts.model,
    "--system-prompt-file", systemPromptFile(opts.systemPrompt),
    "--strict-mcp-config",
    // Lean turn (2026-10-01): no built-in tools (the R1's functions are prompt-based, the
    // CLI's own Bash/Read/... are never used) and no user/project/local settings, so the
    // owner's plugins, agents, hooks and CLAUDE.md stay out of a voice reply. Measured on
    // this box: init 9.0s -> 0.9s, a one-line turn 14s -> 3.2s, input 75k -> 0.7k tokens.
    // The `=` form on purpose: runner.safeArg drops empty strings, so `--tools ""` would
    // arrive as a bare `--tools` and swallow the next flag.
    "--tools=",
    "--setting-sources=",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--output-format=stream-json",
    "--include-partial-messages",
    "--verbose",
  ];
  const started = Date.now();
  const child = spawnStream("claude", args, { cwd: opts.cwd, input: opts.prompt });

  return new Promise<ClaudeTurnResult>((resolve) => {
    let buf = "";
    let streamed = "";
    let finalText: string | null = null;
    let isError = false;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, opts.timeoutMs ?? 300_000);
    const onAbort = () => { try { child.kill(); } catch {} };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const handleLine = (line: string) => {
      const parsed = parseStreamLine(line);
      if (!parsed) return;
      if (parsed.delta) { streamed += parsed.delta; opts.onDelta?.(parsed.delta); }
      if (parsed.result) {
        finalText = parsed.result.text;
        isError = parsed.result.isError;
        inputTokens = parsed.result.inputTokens;
        outputTokens = parsed.result.outputTokens;
      }
    };

    child.stdout.on("data", (b: Buffer) => {
      buf += b.toString();
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        handleLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    });
    child.stderr.on("data", (b: Buffer) => { stderr += b.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (buf.trim()) handleLine(buf);
      // Prefer the CLI's authoritative final text; fall back to what streamed.
      const text = (finalText && finalText.length > 0 ? finalText : streamed).trim();
      resolve({ text, isError, exitCode, stderr: stderr.trim(), inputTokens, outputTokens, timedOut, durationMs: Date.now() - started });
    };
    child.on("close", (code) => finish(code));
    child.on("error", (e) => { stderr += `\nspawn error: ${e.message}`; finish(null); });
  });
}
