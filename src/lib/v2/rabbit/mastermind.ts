// Rabbit R1 bridge — the AI Agent Mastermind (/room) as a model the R1 can pick.
// model "agentos-mastermind": the room's agents answer the handheld as a panel,
// each in its own voice, sequentially so they build on each other (the room's
// own rule) or in parallel for speed (gear toggle). Every round is also saved
// into the room's durable history (id `r1-<session>`), so it shows on /room.
// The pure helpers (transcript, repliers, formatting, merge) are what the
// smoke exercises; runMastermindTurn is the only part that talks to agents.

import {
  roomAgents, roomReply, roomContext, executeRoomActions, mentionedIds,
  listConversations, saveConversation,
  type RoomAgent, type RoomTurn, type RoomConvo, type RoomMsg,
} from "@/lib/agentRoom";
import { config } from "@/lib/config";
import { claudeModel } from "@/lib/claudeModel";
import { runClaudeTurn } from "./claudeChat";
import type { ChatMessage } from "./openai";

export const MASTERMIND_MODEL_ID = "agentos-mastermind";
/** CLI seats that run on the owner's own subscriptions with no API key (owner's
 *  pick, 2026-09-14: "drop hermes and use cursor"). Measured the same day through
 *  the room's path: claude ~15 s, codex ~9 s, cursor ~30 s warm (93 s cold), so a
 *  sequential round is ~55 s and a parallel one ~30 s. Hermes stays available in
 *  the gear but not default: its CLI refused to run until `hermes gateway restart`,
 *  and a dead seat costs a 90 s timeout per round. */
export const DEFAULT_MASTERMIND_AGENTS = ["claude", "codex", "cursor"];

/** The room's chat rules (agentRoom.ROOM_SYSTEM, kept in step by hand) for the
 *  Claude seat, which runs through the bridge's own spawn: the room's Claude path
 *  timed out at 90 s on every call this session, while the bridge's controlled
 *  spawn (system prompt file, strict MCP, stdin) answers in ~15 s. */
const CLAUDE_SEAT_RULES =
  "You are in a fast, live group chat with the user and a few other AI agents. " +
  "Keep every message SHORT and conversational — 1 to 3 sentences, like a real chat. " +
  "Stay fully in your own character. You can agree, disagree, build on, or tease the other agents by name. " +
  "Don't repeat what someone already said. Be genuinely useful and real. No preamble, no name prefix — just your message. " +
  "Your words are read aloud on a small handheld: plain sentences, no markdown, no lists.\n" +
  "You can take REAL actions in the user's vault, but ONLY when they clearly ask for it:\n" +
  "• To SAVE your point as a note in their vault, add a final line exactly: NOTE:: <a short title>\n" +
  "• To ADD an idea to their project pipeline, add a final line exactly: PIPELINE:: <one-line idea>\n" +
  "Use these sparingly — only when asked to save/note/remember something or add a project/idea. Never mention this directive syntax in your visible message.";
/** Speaker label for the panel's earlier replies when the R1 echoes them back. */
export const PANEL_SPEAKER = "Mastermind";

export function isMastermindModel(id: string): boolean {
  return id === MASTERMIND_MODEL_ID;
}

/** OpenAI messages → room transcript. The R1 packs its context as user turns. */
export function buildTranscript(messages: ChatMessage[], userName: string, max = 14): RoomTurn[] {
  const turns: RoomTurn[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const text = m.content.trim();
    if (!text) continue;
    const speaker = m.role === "user" ? userName : m.role === "tool" ? `Tool (${m.name ?? "result"})` : PANEL_SPEAKER;
    turns.push({ speaker, text: text.slice(0, 2000) });
  }
  return turns.slice(-max);
}

/** Who answers: @mentions narrow within the configured panel, exactly like the room. */
export function pickRepliers(message: string, panelIds: string[], roster: RoomAgent[]): RoomAgent[] {
  const known = new Set(roster.map((a) => a.id));
  const panel = (panelIds.length ? panelIds : DEFAULT_MASTERMIND_AGENTS).filter((id) => known.has(id));
  const mentioned = mentionedIds(message).filter((id) => panel.includes(id));
  const ids = mentioned.length ? mentioned : panel;
  return roster.filter((a) => ids.includes(a.id));
}

export interface PanelReply { id: string; name: string; color: string; text: string; ms: number; error?: string }

/** One spoken block per agent — what the R1 shows and reads aloud. */
export function formatPanel(replies: PanelReply[]): string {
  return replies.map((r) => `${r.name}: ${r.text}`).join("\n\n");
}

/** Append a round to the room's durable history (msg conventions from GroupChatView). */
export function mergeConvo(existing: RoomConvo | null, id: string, title: string, userText: string, replies: PanelReply[]): RoomConvo {
  const msgs: RoomMsg[] = existing?.msgs ? [...existing.msgs] : [];
  let key = msgs.reduce((m, x) => Math.max(m, x.key), 0) + 1;
  msgs.push({ key: key++, who: "you", text: userText });
  for (const r of replies) msgs.push({ key: key++, who: r.id, name: r.name, color: r.color, text: r.text });
  return { id, title: existing?.title ?? title, ts: Date.now(), msgs: msgs.slice(-400) };
}

export function convoIdFor(sessionId: string): string {
  return `r1-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}`;
}

export interface MastermindOpts {
  messages: ChatMessage[];
  current: string;
  panelIds: string[];
  sequential: boolean;
  sessionId: string;
  signal?: AbortSignal;
  /** Called as each agent finishes (in order when sequential). */
  onReply?: (r: PanelReply) => void;
}

export async function runMastermindTurn(opts: MastermindOpts): Promise<{ text: string; replies: PanelReply[]; durationMs: number }> {
  const started = Date.now();
  const roster = roomAgents();
  const repliers = pickRepliers(opts.current, opts.panelIds, roster);
  if (!repliers.length) throw new Error("No Mastermind agents selected — Rabbit R1 → Configure → Mastermind panel.");
  const transcript = buildTranscript(opts.messages, config.userName);
  // The same vault grounding the room gives its agents (best effort).
  let ctxText = "";
  try { ctxText = (await roomContext(opts.current)).text; } catch { /* no vault */ }

  const claudeSeat = async (agent: RoomAgent, tr: RoomTurn[]): Promise<string> => {
    const ctx = ctxText
      ? `\n\n--- THE USER'S REAL CONTEXT (from their Obsidian vault) ---\n${ctxText}\n--- end context ---\nGround your reply in THIS. Reference their actual business, projects, and notes.`
      : "";
    const systemPrompt = `${CLAUDE_SEAT_RULES}\n\nYou are ${agent.name}. ${agent.persona}${ctx}`;
    const prompt = `${tr.map((t) => `${t.speaker}: ${t.text}`).join("\n")}\n\n${agent.name}:`;
    const r = await runClaudeTurn({ model: claudeModel(), systemPrompt, prompt, signal: opts.signal, timeoutMs: 90_000 });
    if (r.timedOut) throw new Error("timed out after 90000ms");
    if (r.isError || (!r.text && r.exitCode !== 0)) throw new Error(r.stderr || r.text || `exit ${r.exitCode ?? "?"}`);
    return r.text;
  };

  const ask = async (agent: RoomAgent, tr: RoomTurn[]): Promise<PanelReply> => {
    const t0 = Date.now();
    try {
      const raw = (agent.id === "claude" && agent.provider === "cli"
        ? await claudeSeat(agent, tr)
        : await roomReply(agent, tr, ctxText, opts.signal)) || "…";
      const { clean } = await executeRoomActions(raw);
      return { id: agent.id, name: agent.name, color: agent.color, text: clean || raw, ms: Date.now() - t0 };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 120);
      return { id: agent.id, name: agent.name, color: agent.color, text: `(couldn't reply — ${msg})`, ms: Date.now() - t0, error: msg };
    }
  };

  const replies: PanelReply[] = [];
  if (opts.sequential) {
    for (const agent of repliers) {
      if (opts.signal?.aborted) break;
      const r = await ask(agent, transcript);
      transcript.push({ speaker: r.name, text: r.text }); // the next agent sees this one
      replies.push(r);
      opts.onReply?.(r);
    }
  } else {
    const all = await Promise.all(repliers.map((a) => ask(a, transcript)));
    for (const r of all) { replies.push(r); opts.onReply?.(r); }
  }

  // Durable history for /room — best effort, never blocks the reply.
  try {
    const id = convoIdFor(opts.sessionId);
    const existing = (await listConversations()).find((c) => c.id === id) ?? null;
    await saveConversation(mergeConvo(existing, id, `R1 · ${opts.current.slice(0, 60)}`, opts.current, replies));
  } catch { /* vault unavailable */ }

  return { text: formatPanel(replies), replies, durationMs: Date.now() - started };
}
