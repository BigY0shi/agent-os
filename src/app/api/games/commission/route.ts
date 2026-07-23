import { NextResponse } from "next/server";
import { run } from "@/lib/runner";
import { cliComplete, LOOP_CLI_AGENTS } from "@/lib/loopEngine";
import { writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BOARD = "game-studio";
const GAMES_DIR = path.join(os.homedir(), "freeclaude-scratch", "games");

// Pull a complete HTML doc out of an agent's reply (strip ```html fences if present).
function extractGameHtml(text: string): string {
  const fence = /```(?:html)?\s*\n?([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1] : text;
  const m = /(<!doctype html[\s\S]*<\/html>|<html[\s\S]*<\/html>)/i.exec(body);
  return (m ? m[1] : body).trim();
}

// POST { prompt } → commission the game-dev agent: create a kanban card on the
// game-studio board (workspace = the games gallery dir) and dispatch it now.
export async function POST(req: Request) {
  let body: { prompt?: string; agent?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const prompt = (body.prompt ?? "").toString().trim();
  if (!prompt) return NextResponse.json({ ok: false, error: "describe the game first" }, { status: 400 });
  if (prompt.length > 1200) return NextResponse.json({ ok: false, error: "keep it under 1200 chars" }, { status: 413 });

  // Stable, readable output filename derived from the prompt
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "game";
  const file = `${slug}.html`;

  const buildSpec =
    `Build this as a COMPLETE, genuinely playable browser game: single self-contained HTML file, ` +
    `no external libraries or assets, canvas/CSS only, responsive controls (keys + touch), score, difficulty ramp, ` +
    `start overlay with one-line instructions, game-over with replay, dark neon aesthetic, 60fps, zero console errors.`;

  // CLI-agent path: build the game directly with the user's chosen agent (no API key) and
  // save it straight into the games gallery dir. "game-dev"/empty → the Hermes team path below.
  const cliId = typeof body.agent === "string" ? body.agent.replace(/^cli:/, "") : "";
  if (cliId && cliId !== "game-dev" && (LOOP_CLI_AGENTS as readonly string[]).includes(cliId)) {
    try {
      const out = await cliComplete(cliId, `${prompt}\n\n${buildSpec}\n\nOutput ONLY the complete HTML file — no preamble, no markdown fences.`, { timeoutMs: 280_000 });
      const html = extractGameHtml(out);
      if (!/<(html|canvas|body|svg|script)/i.test(html) || html.length < 120) {
        return NextResponse.json({ ok: false, error: `${cliId} didn't return a playable HTML game.` }, { status: 502 });
      }
      await mkdir(GAMES_DIR, { recursive: true });
      await writeFile(path.join(GAMES_DIR, file), html, "utf8");
      return NextResponse.json({ ok: true, file, agent: cliId });
    } catch (e) {
      return NextResponse.json({ ok: false, error: `${cliId}: ${String(e).slice(0, 200)}` }, { status: 502 });
    }
  }

  const title = `Game commission: ${prompt.slice(0, 70)}`;
  const taskBody =
    `${prompt}\n\n${buildSpec} Per your SOUL role: ` +
    `Write the finished game to ${file} in this workspace, then mark this task complete.`;

  const created = await run("hermes", ["kanban", "--board", BOARD, "create", title,
    "--assignee", "game-dev", "--workspace", `dir:${GAMES_DIR}`, "--body", taskBody],
    { timeoutMs: 30_000 });
  const taskId = created.stdout.match(/t_[a-f0-9]+/)?.[0] ?? null;
  if (!created.ok || !taskId) {
    return NextResponse.json({ ok: false, error: created.stderr.slice(0, 300) || "could not create the task" }, { status: 500 });
  }

  // Fire the dispatcher so the agent starts immediately (gateway also ticks every 60s).
  run("hermes", ["kanban", "--board", BOARD, "dispatch", "--max", "3", "--json"], { timeoutMs: 30_000 }).catch(() => {});

  return NextResponse.json({ ok: true, taskId, file });
}
