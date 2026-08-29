// BUZZ BRIDGE — the Agent OS side of the user's Buzz workspace (Nostr-based
// human↔agent chat by Block; relay wss://launchworks.communities.buzz.xyz).
//
// Identity: a dedicated "Agent OS" member key minted 2026-08-18 — NOT the user's
// own key — stored in ~/.agentic-os/buzz.env (BUZZ_PRIVATE_KEY / BUZZ_RELAY_URL /
// BUZZ_PUBLIC_KEY). Read server-side only; the private key is never returned to
// the client or logged. Kicking the bridge from the workspace revokes everything.
//
// Transport: the bundled buzz.exe CLI (%LOCALAPPDATA%\Buzz), spawned directly with
// the env injected. The relay has NO push — reads poll with a --since cursor
// (relay minimum interval 5s; see ~/.buzz/.agents/skills/buzz-cli/SKILL.md).

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { sanitizeSpawnEnv } from "./spawnEnv";

const BUZZ_BIN = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Buzz", "buzz.exe");
const ENV_FILE = path.join(os.homedir(), ".agentic-os", "buzz.env");
const CHANNEL_FILE = path.join(os.homedir(), ".agentic-os", "buzz-marketing-channel.txt");

export interface BuzzMessage { id: string; pubkey: string; content: string; created_at: number; }
export interface BuzzChannel { channel_id: string; name: string; }

function buzzEnv(): Record<string, string> | null {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq > 0) out[t.slice(0, eq)] = t.slice(eq + 1);
    }
    return out.BUZZ_PRIVATE_KEY ? out : null;
  } catch { return null; }
}

export function buzzAvailable(): boolean {
  return existsSync(BUZZ_BIN) && !!buzzEnv();
}

export function bridgePubkey(): string {
  return buzzEnv()?.BUZZ_PUBLIC_KEY || "";
}

// Run one buzz.exe command with the bridge env. Errors come back as JSON on stderr
// ({error, message}) with exit codes 0..5 — surface the message, never the key.
function buzzCli(args: string[], timeoutMs = 30_000): Promise<{ ok: boolean; stdout: string; error?: string }> {
  return new Promise((resolve) => {
    const env = buzzEnv();
    if (!env) return resolve({ ok: false, stdout: "", error: "Buzz bridge isn't configured (~/.agentic-os/buzz.env missing)." });
    if (!existsSync(BUZZ_BIN)) return resolve({ ok: false, stdout: "", error: "buzz.exe not found — is Buzz installed?" });
    const child = spawn(BUZZ_BIN, args, { env: sanitizeSpawnEnv({ ...process.env, ...env }) });
    let stdout = "", stderr = "";
    const t = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) return resolve({ ok: true, stdout });
      let msg = stderr.trim();
      try { msg = JSON.parse(stderr).message || msg; } catch { /* raw stderr */ }
      resolve({ ok: false, stdout, error: (msg || `buzz exited ${code}`).slice(0, 200) });
    });
    child.on("error", (e) => { clearTimeout(t); resolve({ ok: false, stdout: "", error: String(e.message).slice(0, 200) }); });
  });
}

export async function listChannels(): Promise<BuzzChannel[]> {
  const r = await buzzCli(["--format", "compact", "channels", "list"]);
  if (!r.ok) throw new Error(r.error);
  try { return JSON.parse(r.stdout) as BuzzChannel[]; } catch { return []; }
}

// Accept a channel UUID or a name; fall back to the saved marketing channel.
export async function resolveChannel(nameOrId?: string): Promise<string> {
  const want = (nameOrId || "").trim();
  if (/^[0-9a-f-]{36}$/i.test(want)) return want;
  if (!want) {
    try { const saved = readFileSync(CHANNEL_FILE, "utf8").trim(); if (saved) return saved; } catch { /* resolve by name below */ }
  }
  const channels = await listChannels();
  const name = (want || "marketing-ideas").toLowerCase();
  const hit = channels.find((c) => c.name.toLowerCase() === name);
  if (!hit) throw new Error(`Buzz channel "${want || "marketing-ideas"}" not found — create it in Buzz or pick one in the gear.`);
  return hit.channel_id;
}

export async function sendMessage(channel: string, content: string): Promise<{ eventId: string }> {
  const r = await buzzCli(["messages", "send", "--channel", channel, "--content", content.slice(0, 60_000)]);
  if (!r.ok) throw new Error(r.error);
  try { const j = JSON.parse(r.stdout); return { eventId: String(j.event_id || "") }; } catch { return { eventId: "" }; }
}

// Full-format read (compact drops pubkey, which we need to tell agents from the bridge).
export async function getMessages(channel: string, opts?: { since?: number; limit?: number }): Promise<BuzzMessage[]> {
  const args = ["messages", "get", "--channel", channel, "--limit", String(opts?.limit ?? 50)];
  if (opts?.since) args.push("--since", String(opts.since));
  const r = await buzzCli(args);
  if (!r.ok) throw new Error(r.error);
  try {
    const arr = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    return arr.map((m) => ({
      id: String(m.id || ""), pubkey: String(m.pubkey || ""),
      content: String(m.content || ""), created_at: Number(m.created_at) || 0,
    })).filter((m) => m.id);
  } catch { return []; }
}

// pubkey → display name, cached for the process lifetime (profiles rarely change).
let nameCache: Map<string, string> | null = null;
let nameCacheAt = 0;
export async function displayNames(): Promise<Map<string, string>> {
  if (nameCache && Date.now() - nameCacheAt < 5 * 60_000) return nameCache;
  const map = new Map<string, string>();
  const r = await buzzCli(["--format", "compact", "users", "get"]);
  if (r.ok) {
    try {
      for (const u of JSON.parse(r.stdout) as Array<{ pubkey?: string; display_name?: string }>) {
        if (u.pubkey) map.set(u.pubkey, u.display_name || u.pubkey.slice(0, 8));
      }
    } catch { /* names stay pubkey-prefixed */ }
  }
  nameCache = map; nameCacheAt = Date.now();
  return map;
}

// Post the prompt, then poll for replies from OTHER members (the user's Buzz agents,
// or the user themselves) until the window closes. Relay min poll interval is 5s.
export async function chatRoundTrip(channel: string, prompt: string, windowMs = 75_000): Promise<{ replies: Array<{ name: string; content: string }>; posted: boolean }> {
  const sent = await sendMessage(channel, prompt);
  const self = bridgePubkey();
  const startedAt = Math.floor(Date.now() / 1000);
  let since = startedAt;
  const replies: Array<{ name: string; content: string }> = [];
  const seen = new Set<string>();
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 6_000));
    const msgs = await getMessages(channel, { since, limit: 50 }).catch(() => [] as BuzzMessage[]);
    for (const m of msgs) {
      if (m.id === sent.eventId || (self && m.pubkey === self) || seen.has(m.id)) continue;
      if (m.created_at < startedAt) continue;
      seen.add(m.id);
      replies.push({ name: "", content: m.content });
      (replies[replies.length - 1] as { name: string; content: string; pubkey?: string }).pubkey = m.pubkey;
      since = Math.max(since, m.created_at);
    }
    // One reply is enough to hand back promptly; keep a short grace poll for pile-ons.
    if (replies.length) { await new Promise((r) => setTimeout(r, 6_000)); break; }
  }
  if (replies.length) {
    const names = await displayNames();
    for (const r of replies as Array<{ name: string; content: string; pubkey?: string }>) {
      r.name = (r.pubkey && names.get(r.pubkey)) || (r.pubkey ? r.pubkey.slice(0, 8) : "member");
      delete r.pubkey;
    }
  }
  return { replies, posted: true };
}

// The recent channel conversation as a labeled transcript (for Promote-to-campaign).
export async function channelTranscript(channel: string, limit = 40): Promise<string> {
  const [msgs, names] = await Promise.all([getMessages(channel, { limit }), displayNames()]);
  const self = bridgePubkey();
  return msgs
    .map((m) => {
      const who = m.pubkey === self ? "Agent OS (bridge)" : names.get(m.pubkey) || m.pubkey.slice(0, 8);
      return `${who}: ${m.content}`;
    })
    .join("\n")
    .slice(-14_000);
}
