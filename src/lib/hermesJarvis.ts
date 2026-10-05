// Jarvis voice pipeline — Codex Voice edition (2026-07-27).
//
// Three modes:
//   - "fast"  : a DIRECT chat completion (small model / CLI fallback) — no agent
//               overhead, for live voice back-and-forth.
//   - "agent" : the codex CLI (`codex exec --full-auto`) — replaced `hermes -z`
//               per the operator's call; same tool powers (open apps, run
//               commands, touch files) on the ChatGPT subscription.
//   - "auto"  : fast model decides — answer / OPEN directly / escalate to agent.
//
// Keys/model are still read SERVER-SIDE from the active Hermes profile .env when
// present (that's just where the keys live), never returned to the browser.

import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { run } from "@/lib/runner";
import { claudeModel } from "@/lib/claudeModel";
import { searchNotes, searchOmi, notesModifiedOn, recentNotes, recentOmi } from "@/lib/vault";

const HOME = os.homedir();

const STOP = new Set(["what", "when", "where", "which", "your", "yours", "mine", "have", "give", "some", "ideas", "about", "into", "went", "from", "with", "that", "this", "they", "them", "there", "here", "tell", "show", "know", "remember", "recall", "yesterday", "today", "obsidian", "vault", "memory", "memories", "notes", "note"]);

// If the user is asking about their vault/memory/notes/past days, pull real
// content from the vault so the model answers from facts — never "no access".
async function vaultGrounding(prompt: string): Promise<{ relevant: boolean; context: string }> {
  const s = prompt.toLowerCase();
  const relevant = /\b(vault|obsidian|memor(y|ies)|notes?|remember|recall|yesterday|today|last (week|night)|this (week|morning)|what (did|have) i|what went|what happened|my (ideas?|projects?|plans?|goals?|tasks?|notes?)|recap|catch me up)\b/.test(s);
  if (!relevant) return { relevant: false, context: "" };

  const bits: string[] = [];
  const DASH = /^Agentic OS\//; // the whole folder is dashboard-generated ≠ the user's memory

  // Time reference → the user's REAL notes touched that day (skip dashboard stuff).
  let dayLabel = "";
  if (/\byesterday\b/.test(s)) dayLabel = "yesterday";
  else if (/\b(today|this morning|so far)\b/.test(s)) dayLabel = "today";
  if (dayLabel) {
    const d = new Date(); d.setDate(d.getDate() - (dayLabel === "yesterday" ? 1 : 0));
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      const titles = (await notesModifiedOn(ymd, 25))
        .filter((n) => !DASH.test(n.path) && !/_index|_template/i.test(n.title))
        .map((n) => n.title.replace(/-/g, " "));
      if (titles.length) bits.push(`Notes the user personally edited ${dayLabel}: ${titles.slice(0, 10).join("; ")}.`);
    } catch { /* */ }
  }

  // Keyword search across the user's real notes + Omi memory captures.
  const kw = Array.from(new Set(s.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)))).slice(0, 4).join(" ");
  if (kw) {
    try {
      const [notes, omi] = await Promise.all([searchNotes(kw, 4), searchOmi(kw, 6)]);
      if (omi.length) bits.push(`From the user's Omi memory matching "${kw}": ${omi.slice(0, 5).join("; ")}.`);
      const relNotes = notes.filter((n) => !DASH.test(n.path));
      if (relNotes.length) bits.push(`Relevant notes: ${relNotes.slice(0, 3).map((n) => `${n.title} — ${n.preview}`).join(" · ")}.`);
    } catch { /* */ }
  }

  // For memory / "what happened" / recap-style questions, ground in the user's
  // actual Omi captures (their real life & work), not the ideas factory.
  const wantsMemory = dayLabel || /\b(memor|remember|recall|what (happened|did i|went)|recap|catch me up|mind|thinking|up to|been doing|focus)\b/.test(s);
  if (wantsMemory) {
    try {
      const omi = await recentOmi(14); // keep context small — M3 reasons slowly on big inputs
      if (omi.length) bits.push(`Recent captures from the user's Omi memory (most recent first):\n${omi.slice(0, 12).map((m) => `- ${m}`).join("\n")}`);
    } catch { /* */ }
  }

  // Fallback: clearly a vault question but nothing matched — recent real notes.
  if (!bits.length) {
    try {
      const titles = (await recentNotes(14))
        .filter((n) => !DASH.test(n.path) && !/_index|_template/i.test(n.title))
        .map((n) => n.title.replace(/-/g, " "));
      if (titles.length) bits.push(`The user's most recently edited notes: ${titles.slice(0, 8).join("; ")}.`);
    } catch { /* */ }
  }

  return { relevant: true, context: bits.join("\n\n") };
}

function activeProfile(): string {
  try {
    const p = readFileSync(path.join(HOME, ".hermes", "active_profile"), "utf8").trim();
    if (p) return p;
  } catch { /* fall through */ }
  return process.env.HERMES_PROFILE || "main";
}

function profileDir(): string {
  return path.join(HOME, ".hermes", "profiles", activeProfile());
}

function readEnv(name: string): string | null {
  const f = path.join(profileDir(), ".env");
  if (!existsSync(f)) return process.env[name]?.trim() || null;
  try {
    const line = readFileSync(f, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).replace(/^["']|["']$/g, "").trim() || null;
  } catch { /* ignore */ }
  return process.env[name]?.trim() || null;
}

// The model Hermes is configured to use (so Jarvis tracks the same one).
export function hermesModel(): string {
  try {
    const cfg = readFileSync(path.join(profileDir(), "config.yaml"), "utf8");
    const m = cfg.match(/^\s*default:\s*([^\s#]+)/m);
    // Only honour the profile default if it's an OpenRouter-style id
    // ("vendor/model") — this feeds OpenRouter calls, and a bare id like
    // "MiniMax-M3" (the direct-API default) would 404 there.
    if (m && m[1].includes("/")) return m[1].trim();
  } catch { /* ignore */ }
  return "anthropic/claude-opus-4.8"; // Claude Opus 4.8
}

const FAST_PERSONA =
  "You are JARVIS — Tony Stark's AI from Iron Man — speaking live to me through my Mac. " +
  "Persona: a refined, composed British AI butler. Address me as \"sir\". Be unflappable, precise, " +
  "and lightly dry-witted; never break character. Answer in ONE short, in-character sentence. " +
  "You are in fast conversational mode — you advise and answer, you do not run commands.";

// AUTO: the fast model can OPEN apps/sites itself (executed directly by the
// server — fast + safe), and escalate genuinely complex tasks to the full agent.
// The machine JARVIS is actually running on — the persona used to hardcode "my Mac"
// and macOS app names (its own example was the macOS Notes app), which steered the
// model into OPEN directives that could never succeed on Windows.
const HOST_OS = process.platform === "win32" ? "Windows PC" : process.platform === "darwin" ? "Mac" : "Linux machine";
const APP_EXAMPLE = process.platform === "win32" ? "OPEN: Notepad" : "OPEN: Notes";

const AUTO_PERSONA =
  `You are JARVIS — Tony Stark's refined British AI butler — live on my ${HOST_OS}. Address me as "sir"; ` +
  "never break character.\n" +
  "Decide what I want and respond in ONE of these exact forms:\n" +
  "1. To OPEN an app or website: first line `OPEN: <target>` where <target> is a full https:// URL " +
  `for a website (e.g. OPEN: https://google.com) or an installed app name (e.g. ${APP_EXAMPLE}); second line: ` +
  "one short in-character confirmation (e.g. \"Opening Google now, sir.\").\n" +
  "2. For a genuinely multi-step task or real file/shell/computer work beyond just opening something: " +
  "respond with EXACTLY `AGENT: <the task restated in one line>` and nothing else.\n" +
  "3. Otherwise (questions, chat): just answer in ONE short, in-character sentence — no prefix.\n" +
  "CRITICAL: Output ONLY the chosen form. NEVER show your reasoning, planning, analysis, or deliberation. " +
  "No \"the user is asking\", no \"let me think/reconsider\", no \"Actually,\", no listing options. Just the final reply.";

const OPEN_HINT = process.platform === "win32"
  ? "run `start \"\" \"https://google.com\"` (or `start \"\" \"Notepad\"` for an app)"
  : process.platform === "darwin"
    ? "run the shell `open` command (e.g. `open -a \"Google Chrome\" https://google.com`)"
    : "run `xdg-open https://google.com`";

const AGENT_PERSONA =
  `[You are JARVIS — Tony Stark's AI from Iron Man — running live on my ${HOST_OS}. Persona: a refined, ` +
  "composed British AI butler. Address me as \"sir\". Be unflappable, precise, lightly dry-witted; " +
  `never break character. BE FAST. To OPEN a website or app, ${OPEN_HINT}. Only use computer-use when you must click/` +
  "type/read something already on screen. Keep your final spoken reply to ONE short, in-character " +
  "sentence (e.g. \"Right away, sir.\").]";

export interface JarvisMsg { role: "user" | "assistant"; content: string; }

export interface JarvisResult { ok: boolean; text: string; ms: number; mode: "auto" | "fast" | "agent"; error?: string; }

// Reasoning models (M3) occasionally dump their chain-of-thought into `content`
// (esp. with conversation history). Strip <think> blocks + obvious deliberation
// so the user only ever sees the final reply.
function stripReasoning(text: string): string {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "").trim();
  const looksLikeCoT = t.length > 240 && /\b(the user (is|wants|asked|is asking)|let me (reconsider|think)|wait,?\s+(let me|i)\b|i'?ll go with|actually,? the (cleanest|most|best|simplest)|i don'?t actually (have|know)|in this (simulated|environment)|but i don'?t actually|the most appropriate (response|move)|let me (pick|go with))\b/i.test(t);
  if (looksLikeCoT) {
    // Salvage a buried directive; otherwise blank it so the OpenRouter fallback answers cleanly.
    const op = t.match(/\bOPEN:\s*([^\n.]+)/i);
    if (op) return `OPEN: ${op[1].trim()}`;
    const ag = t.match(/\bAGENT:\s*([^\n]+)/i);
    if (ag) return `AGENT: ${ag[1].trim()}`;
    return "";
  }
  return t;
}


/**
 * Last-resort completion over a local CLI the user actually has authed.
 * Both hosted paths below (MiniMax OAuth, OpenRouter) are frequently unavailable
 * on this machine, which used to make Jarvis's default "auto" mode fail outright.
 * `claude -p` is a one-shot print completion (no agent cold-boot) on the user's
 * own subscription — slower than a raw API call, but it works.
 */
async function cliFallbackComplete(persona: string, prompt: string, history: JarvisMsg[]): Promise<{ text: string; error?: string }> {
  const convo = history.slice(-6).map((m) => `${m.role === "user" ? "Me" : "You"}: ${m.content}`).join("\n");
  const full = `${persona}\n\n${convo ? `Recent conversation:\n${convo}\n\n` : ""}Me: ${prompt}\n\nReply in character, briefly.`;
  try {
    // `--model` is REQUIRED: without it the CLI resolves a "default" alias that
    // errors with "There's an issue with the selected model (default)".
    const out = await run("claude", ["-p", "--model", claudeModel(), "--output-format", "text"], { timeoutMs: 120_000, input: full });
    const text = (out.stdout || "").trim();
    return text ? { text } : { text: "", error: (out.stderr || "claude CLI returned no output").slice(-200) };
  } catch (e) {
    return { text: "", error: String(e) };
  }
}

// One direct completion (no Hermes agent). Prefers MiniMax (uses your connected
// plan); falls back to OpenRouter, then to the local Claude CLI so Jarvis still
// answers when neither hosted provider is connected.
export async function complete(persona: string, prompt: string, history: JarvisMsg[]): Promise<{ text: string; error?: string }> {
  // MiniMax removed — it isn't provisioned on this machine and shouldn't be in the
  // path. The local Claude CLI is the primary backend; OpenRouter is used only if a
  // key happens to be configured.
  const key = readEnv("OPENROUTER_API_KEY");
  if (!key) {
    const cli = await cliFallbackComplete(persona, prompt, history);
    if (cli.text) return cli;
    return { text: "", error: cli.error || "No completion backend available (the Claude CLI failed and no OPENROUTER_API_KEY is configured)." };
  }
  const messages = [{ role: "system", content: persona }, ...history.slice(-6), { role: "user", content: prompt }];
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // Claude 5 (Fable) is a reasoning model — needs token headroom or the
      // visible reply comes back empty (finish=length).
      body: JSON.stringify({ model: hermesModel(), messages, max_tokens: 1200, temperature: 0.45 }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    const text = String(j?.choices?.[0]?.message?.content ?? "").trim();
    if (text) return { text };
    // OpenRouter reachable but unusable (bad key / empty reply) → local CLI.
    const cli = await cliFallbackComplete(persona, prompt, history);
    return cli.text ? cli : { text: "", error: j?.error?.message || cli.error || "empty reply" };
  } catch (e) {
    const cli = await cliFallbackComplete(persona, prompt, history);
    return cli.text ? cli : { text: "", error: String(e) };
  } finally { clearTimeout(to); }
}

// Execute `open` directly (NO shell → no injection). Only the macOS `open`
// command, with a validated URL or app name. Fast (~0.3s).
function runOpen(target: string): Promise<boolean> {
  return new Promise((resolve) => {
    const t = target.trim();
    let args: string[];
    const looksUrl = /^https?:\/\//i.test(t) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t);
    if (looksUrl) {
      const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
      if (!/^https?:\/\/[\w.\-/?=&%#~+:@]+$/i.test(url)) return resolve(false);
      args = [url];
    } else {
      if (!/^[\w .'&\-]{1,40}$/.test(t)) return resolve(false); // app name only
      args = ["-a", t];
    }
    try {
      // Cross-platform launch. This used to spawn the macOS-only `open`, so on
      // Windows EVERY open request failed with "I couldn't open X, sir".
      // Inputs are already regex-validated above (URL or short app name).
      let cmd: string;
      let finalArgs: string[];
      if (process.platform === "win32") {
        // `cmd /c start "" <target>` handles both URLs and registered app names.
        // The empty "" is the window title, required when the target is quoted.
        cmd = "cmd";
        finalArgs = ["/c", "start", "", looksUrl ? args[0] : t];
      } else if (process.platform === "darwin") {
        cmd = "open";
        finalArgs = args;
      } else {
        cmd = "xdg-open";
        finalArgs = [looksUrl ? args[0] : t];
      }
      const c = spawn(cmd, finalArgs, { stdio: "ignore" });
      c.on("close", (code) => resolve(code === 0));
      c.on("error", () => resolve(false));
    } catch { resolve(false); }
  });
}

// VOICE-FAST completion: a small NON-reasoning model + tiny token cap → sub-second
// replies (the reasoning models in complete() spend seconds "thinking" before a
// one-line answer, which is wrong for a live voice assistant). Falls back to
// complete() if the fast model errors. Override the model with AGENTIC_OS_JARVIS_FAST_MODEL.
async function completeFast(persona: string, prompt: string, history: JarvisMsg[]): Promise<{ text: string; error?: string }> {
  const key = readEnv("OPENROUTER_API_KEY");
  if (!key) return complete(persona, prompt, history); // no key → existing path
  const model = readEnv("AGENTIC_OS_JARVIS_FAST_MODEL") || "openai/gpt-4o-mini";
  const messages = [{ role: "system", content: persona }, ...history.slice(-6), { role: "user", content: prompt }];
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // small cap — voice replies are 1-2 sentences; keeps it snappy.
      body: JSON.stringify({ model, messages, max_tokens: 160, temperature: 0.5 }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    const text = String(j?.choices?.[0]?.message?.content ?? "").trim();
    if (text) return { text };
    return complete(persona, prompt, history); // empty → fall back to the reliable path
  } catch {
    return complete(persona, prompt, history);
  } finally { clearTimeout(to); }
}

// FAST: pure conversational, no actions. Sub-second with the fast model.
async function fast(prompt: string, history: JarvisMsg[]): Promise<JarvisResult> {
  const started = Date.now();
  const { text, error } = await completeFast(FAST_PERSONA, prompt, history);
  return { ok: !!text, text, ms: Date.now() - started, mode: "fast", error };
}

// AGENT: the codex CLI with tools unlocked (`--full-auto`) — Codex Voice.
// Replaced `hermes -z` 2026-07-27: same tool powers (open apps, run commands,
// touch files), runs on the ChatGPT subscription. Prompt goes over stdin ("-")
// so a long persona + history can never blow the arg-length limit.
async function agent(prompt: string, history: JarvisMsg[]): Promise<JarvisResult> {
  const started = Date.now();
  const ctx = history.slice(-4).map((m) => `${m.role === "user" ? "Me" : "You"}: ${m.content}`).join("\n");
  const full = `${AGENT_PERSONA}\n\n${ctx ? ctx + "\n\n" : ""}Command: ${prompt}`;
  const out = await run("codex", ["exec", "--full-auto", "--skip-git-repo-check", "--ignore-user-config", "-"], { timeoutMs: 6 * 60 * 1000, input: full });
  const text = out.stdout.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\]\d+;[^\x07\x1b]*(\x07|\x1b\\)/g, "").trim();
  return { ok: out.ok && !!text, text: text || "(no reply — check `codex login status`)", ms: Date.now() - started, mode: "agent", error: text ? undefined : out.stderr.slice(-300) };
}

// AUTO: fast model decides — answer (fast), OPEN an app/site (fast direct exec),
// or escalate a complex task to the full agent. Best default for a voice butler.
async function auto(prompt: string, history: JarvisMsg[]): Promise<JarvisResult> {
  const started = Date.now();
  let persona = AUTO_PERSONA;
  const { relevant, context } = await vaultGrounding(prompt);
  if (relevant && context) {
    persona += "\n\nYou have full live access to my Obsidian vault and memory. Here is what I retrieved for this question:\n"
      + context + "\n\nAnswer using this real content in one to three short in-character sentences. Summarise my recent activity and focus CONFIDENTLY — if exact timing is unclear, just describe what I've recently been working on without dwelling on date precision or caveats. NEVER say you lack access to my vault, notes, or memory.";
  } else if (relevant) {
    persona += "\n\nYou have live access to my Obsidian vault, but I searched and found nothing specific for this. Say you checked and found nothing on that — do NOT claim you lack access.";
  }
  const { text, error } = await complete(persona, prompt, history);
  if (!text) return { ok: false, text: "", ms: Date.now() - started, mode: "auto", error };

  const openM = text.match(/^OPEN:\s*(.+?)\s*$/im);
  if (openM) {
    const target = openM[1];
    const ok = await runOpen(target);
    const confirm = text.split("\n").map((l) => l.trim()).find((l) => l && !/^OPEN:/i.test(l));
    return {
      ok: true, mode: "auto", ms: Date.now() - started,
      text: ok ? (confirm || `Opening ${target} now, sir.`) : `I couldn't open ${target}, sir — try Agent mode.`,
    };
  }

  const agentM = text.match(/^AGENT:\s*(.+)$/im);
  if (agentM) {
    const r = await agent(agentM[1], history); // escalate to the real agent
    return { ...r, mode: "auto" };
  }

  return { ok: true, text, ms: Date.now() - started, mode: "auto" };
}

export async function jarvisReply(prompt: string, mode: "auto" | "fast" | "agent", history: JarvisMsg[] = []): Promise<JarvisResult> {
  if (mode === "agent") return agent(prompt, history);
  if (mode === "fast") return fast(prompt, history);
  return auto(prompt, history);
}
