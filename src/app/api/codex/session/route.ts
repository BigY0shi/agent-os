import os from "node:os";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/codexWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/codex/session?id=<session-uuid>
//   Returns the parsed session: cwd, turns, tool calls, referenced files,
//   and the files currently present in the session's cwd.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const session = await readSession(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  // `home` lets the page turn absolute paths into /api/codex/session-file URLs on any OS
  // (it used to guess it from /Users/<name>, which never matches a Windows path).
  return NextResponse.json({ session, home: os.homedir() });
}
