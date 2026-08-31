import { NextResponse } from "next/server";
import { cliComplete } from "@/lib/loopEngine";
import { withSkills } from "@/lib/platformSkills";
import { readSettings } from "@/lib/settings";
import { personaFor, personaBlock, BUSINESSES, CHANNELS, type Business, type Channel } from "@/lib/marketing";
import { buzzAvailable, resolveChannel, chatRoundTrip, channelTranscript } from "@/lib/buzzBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// IDEATE — the spitfire chat BEFORE the formal campaign council: surface, riff on and
// sharpen campaign ideas with zero ceremony. Same skills + persona as the hub, but a
// fast, informal register. "promote" distills the whole riff into a ready-to-create
// campaign ({title, goal, angle, channels}) that pre-fills the create form.

interface Msg { role: "user" | "assistant"; text: string; }

function packHistory(messages: Msg[], keep = 30, maxBytes = 10_000): string {
  const recent = (Array.isArray(messages) ? messages : []).slice(-keep);
  const lines: string[] = [];
  let bytes = 0;
  for (const m of recent) {
    if (!m || typeof m.text !== "string") continue;
    const line = `${m.role === "user" ? "Owner" : "You"}: ${m.text}`;
    if (bytes + line.length > maxBytes) { lines.unshift("…[earlier riff trimmed]"); break; }
    lines.push(line);
    bytes += line.length;
  }
  return lines.join("\n");
}

function ideateAgent(pref?: string): string {
  const s = readSettings().marketing || {};
  return pref || s.agent || "claude";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const messages = (Array.isArray(body.messages) ? body.messages : []) as Msg[];
  const business = BUSINESSES.some((b) => b.id === body.business) ? (body.business as Business) : undefined;
  const agent = ideateAgent(body.agent ? String(body.agent) : undefined);
  const persona = business ? await personaFor(business) : null;

  // "buzz" mode: the riff lives in a Buzz workspace channel — the hub posts as the
  // Agent OS bridge, the user's Buzz agents (and the user, from any device) reply,
  // and Promote distills the CHANNEL conversation instead of local chat state.
  const s = readSettings().marketing || {};
  const backend = (body.backend === "buzz" || body.backend === "local")
    ? body.backend
    : (s.ideateBackend === "buzz" ? "buzz" : "local");

  try {
    if (backend === "buzz") {
      if (!buzzAvailable()) return NextResponse.json({ ok: false, error: "Buzz bridge isn't configured — buzz.env missing or Buzz not installed." }, { status: 400 });
      const channel = await resolveChannel(body.channel ? String(body.channel) : s.buzzChannel);
      if (body.action === "promote") {
        const transcript = await channelTranscript(channel);
        if (!transcript.trim()) return NextResponse.json({ ok: false, error: "The Buzz channel is empty — riff there first." }, { status: 400 });
        const prompt = [
          "You are distilling a freewheeling multi-person marketing brainstorm (a chat-channel transcript) into ONE concrete campaign brief.",
          persona ? personaBlock(persona) : "",
          "",
          "THE CHANNEL CONVERSATION:",
          transcript,
          "",
          "Pick the strongest campaign idea the conversation converged on (or the best one raised).",
          "Return ONLY a JSON object (no prose, no fences):",
          "{",
          '  "title": "campaign name, <= 10 words",',
          '  "goal": "2-3 sentences: what success concretely looks like",',
          '  "angle": "1-2 sentences: the positioning angle / constraints that emerged",',
          `  "channels": array from ${JSON.stringify(CHANNELS.map((c) => c.id))} — only channels that genuinely fit`,
          "}",
        ].filter(Boolean).join("\n");
        const raw = await cliComplete(ideateAgent(body.agent ? String(body.agent) : undefined), withSkills(prompt, "marketing"), { timeoutMs: 240_000, signal: req.signal });
        const a = raw.indexOf("{"); const b = raw.lastIndexOf("}");
        if (a === -1 || b === -1) throw new Error("Couldn't distill the channel riff — try again.");
        const parsed = JSON.parse(raw.slice(a, b + 1)) as { title?: string; goal?: string; angle?: string; channels?: string[] };
        const chans = (Array.isArray(parsed.channels) ? parsed.channels : []).filter((ch): ch is Channel => CHANNELS.some((c) => c.id === ch));
        return NextResponse.json({ ok: true, draft: {
          title: String(parsed.title || "").slice(0, 120),
          goal: String(parsed.goal || "").slice(0, 800),
          angle: String(parsed.angle || "").slice(0, 800),
          channels: chans.length ? chans : ["text-post"],
          business: business || "launchworks",
        }});
      }
      // chat: post to the channel, wait briefly for replies from agents/members.
      const current = String(body.prompt || "").trim().slice(0, 4000);
      if (!current) return NextResponse.json({ ok: false, error: "Say something first." }, { status: 400 });
      const { replies } = await chatRoundTrip(channel, current);
      const reply = replies.length
        ? replies.map((r) => `**${r.name}:** ${r.content}`).join("\n\n")
        : "_(posted to Buzz — no replies in the window yet; they'll be in the channel and count toward Promote)_";
      return NextResponse.json({ ok: true, reply: reply.slice(0, 8000), viaBuzz: true });
    }

    // ── PROMOTE: distill the riff into a ready-to-create campaign ──
    if (body.action === "promote") {
      if (!messages.length) return NextResponse.json({ ok: false, error: "Nothing to promote yet — riff first." }, { status: 400 });
      const prompt = [
        "You are distilling a freewheeling marketing brainstorm into ONE concrete campaign brief.",
        persona ? personaBlock(persona) : "",
        "",
        "THE BRAINSTORM SO FAR:",
        packHistory(messages, 40, 14_000),
        "",
        "Pick the strongest campaign idea the conversation converged on (or the best one raised).",
        "Return ONLY a JSON object (no prose, no fences):",
        "{",
        '  "title": "campaign name, <= 10 words",',
        '  "goal": "2-3 sentences: what success concretely looks like",',
        '  "angle": "1-2 sentences: the positioning angle / constraints that emerged in the riff",',
        `  "channels": array from ${JSON.stringify(CHANNELS.map((c) => c.id))} — only channels that genuinely fit`,
        "}",
      ].filter(Boolean).join("\n");
      const raw = await cliComplete(agent, withSkills(prompt, "marketing"), { timeoutMs: 240_000, signal: req.signal });
      const a = raw.indexOf("{"); const b = raw.lastIndexOf("}");
      if (a === -1 || b === -1) throw new Error("Couldn't distill the riff — try again.");
      const parsed = JSON.parse(raw.slice(a, b + 1)) as { title?: string; goal?: string; angle?: string; channels?: string[] };
      const channels = (Array.isArray(parsed.channels) ? parsed.channels : []).filter((ch): ch is Channel => CHANNELS.some((c) => c.id === ch));
      return NextResponse.json({
        ok: true,
        draft: {
          title: String(parsed.title || "").slice(0, 120),
          goal: String(parsed.goal || "").slice(0, 800),
          angle: String(parsed.angle || "").slice(0, 800),
          channels: channels.length ? channels : ["text-post"],
          business: business || "launchworks",
        },
      });
    }

    // ── CHAT: the spitfire riff itself ──
    const current = String(body.prompt || "").trim().slice(0, 4000);
    if (!current) return NextResponse.json({ ok: false, error: "Say something first." }, { status: 400 });
    const prompt = [
      "You are the owner's SPITFIRE marketing ideation partner — the loose bar-napkin session before any formal planning.",
      persona ? personaBlock(persona) : "",
      "",
      "HOW TO BEHAVE:",
      "- Rapid-fire and punchy. 2-6 short lines per reply, never an essay, no headers, no bullet-list dumps unless asked.",
      "- Riff: throw angles, hooks, weird takes; build on the owner's energy ('yes and'), then sharpen.",
      "- Push back fast when an idea is weak — one blunt line and offer the stronger cut.",
      "- When something clicks, say so and name it in one line, so it can be promoted to a campaign later.",
      "",
      messages.length ? `THE RIFF SO FAR:\n${packHistory(messages)}` : "",
      "",
      `Owner: ${current}`,
      "You:",
    ].filter(Boolean).join("\n");
    const reply = (await cliComplete(agent, withSkills(prompt, "marketing"), { timeoutMs: 240_000, signal: req.signal })).trim();
    if (!reply) throw new Error(`${agent} returned nothing.`);
    return NextResponse.json({ ok: true, reply: reply.slice(0, 8000) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 240) }, { status: 502 });
  }
}
