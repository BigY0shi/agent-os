import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { GoogleGenAI } from "@google/genai";
import { readHermesEnv } from "@/lib/hermesPhone";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hermes/realtime/gemini-session → { token, model, persona }
// Mints a short-lived Gemini Live EPHEMERAL token (v1alpha auth_tokens) the
// browser uses for a direct WebSocket speech-to-speech session. The real
// GEMINI_API_KEY never reaches the browser — same posture as the OpenAI route.
//
// Why this exists: Gemini Live is the one native voice-mode API with a free
// tier, and the operator's Google AI Pro sub raises those AI Studio limits —
// so the ChatGPT-voice-mode experience without per-minute billing anxiety.

function geminiKey(): string | null {
  if (process.env.GEMINI_API_KEY?.trim()) return process.env.GEMINI_API_KEY.trim();
  if (process.env.GOOGLE_API_KEY?.trim()) return process.env.GOOGLE_API_KEY.trim();
  try { const k = (readHermesEnv() as Record<string, string>).GEMINI_API_KEY; if (k?.trim()) return k.trim(); } catch { /* next */ }
  // .env.local is loaded by Next automatically; this is just the manual fallback
  // for keys the user drops in the outreach config dir.
  try {
    const cfg = JSON.parse(readFileSync(path.join(os.homedir(), ".agentic-os", "outreach", "config.json"), "utf8")) as { geminiKey?: string };
    if (cfg.geminiKey?.trim()) return cfg.geminiKey.trim();
  } catch { /* ignore */ }
  return null;
}

// Same butler, same vault-grounded context as the OpenAI route.
function userContext(): string {
  const root = config.vaultRoot;
  if (root) {
    for (const rel of ["About Me.md", path.join("04 Resources", "About Me.md")]) {
      try {
        let t = readFileSync(path.join(root, rel), "utf8");
        t = t.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1").replace(/[#*`>]/g, "").replace(/\n{3,}/g, "\n\n").trim();
        if (t) return t.slice(0, 2000);
      } catch { /* try next candidate */ }
    }
  }
  return `${config.userName !== "You" ? config.userName : "The user"} — (no profile note found; add an "About Me.md" to your vault so JARVIS knows who you are.)`;
}

const PERSONA =
  "You are JARVIS — a refined English butler AI, in the style of Tony Stark's assistant. " +
  "Crisp Received Pronunciation, calm and unflappable, warm but precise, with a touch of dry wit. " +
  "Address the user politely (\"sir\", or by name if you know it). This is a live SPOKEN conversation, so keep replies short and natural — " +
  "usually one or two sentences; never monologue. You know the user (context below) — use it to be " +
  "specific and personal, but never read the context aloud. When they ask you to open, launch, go to, or pull " +
  "up a website or an app (e.g. \"open Google\", \"pull up YouTube\"), CALL the open_app_or_site " +
  "function to actually do it, then confirm briefly in character (e.g. \"Opening Google now.\"). Don't claim " +
  "you've opened something unless you called the function.";

// Doc-verified default (js-genai SDK examples). Override with GEMINI_LIVE_MODEL —
// e.g. a newer native-audio model for affective dialog once you want it.
const MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-live-2.5-flash-preview";

export async function POST() {
  const key = geminiKey();
  if (!key) {
    return NextResponse.json({ error: "Gemini key not found — set GEMINI_API_KEY in .env.local (free key from aistudio.google.com; your Google AI Pro sub raises its limits)." }, { status: 400 });
  }
  try {
    const ai = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: "v1alpha" } });
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        // The session must START within 2 minutes; once live it can run out the token TTL.
        expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(),
      },
    });
    if (!token?.name) return NextResponse.json({ error: "token mint returned nothing" }, { status: 502 });
    return NextResponse.json({
      token: token.name,
      model: MODEL,
      persona: `${PERSONA}\n\n# Who you're talking to\n${userContext()}`,
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
