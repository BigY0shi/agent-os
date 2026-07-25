import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readSettings } from "@/lib/settings";
import { augmentPath, POSIX_TOOL_DIRS } from "@/lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Open Design's start/stop commands are configurable (Open Design config menu). This makes
// it cross-platform: on Windows set a launch command in settings; the old macOS host
// scripts (~/open-design/od-host-*.sh) are only used as a fallback when no command is set.
const HOME = os.homedir();
const MAC_START = path.join(HOME, "open-design", "od-host-start.sh");
const MAC_STOP = path.join(HOME, "open-design", "od-host-stop.sh");
// Platform-correct PATH extension (see lib/platform). The old ":"-join corrupted
// Windows' ";"-delimited PATH.
const AUGMENTED_PATH = augmentPath(POSIX_TOOL_DIRS);

// Run a command string through the OS default shell (cmd.exe on Windows, /bin/sh on posix).
function runCmd(cmd: string, cwd: string | undefined, timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, cwd: cwd || undefined, env: { ...process.env, PATH: AUGMENTED_PATH } },
      (err, stdout, stderr) => resolve({ ok: !err, out: (stdout + stderr).trim().slice(-700) }));
  });
}

// POST { action: "start" | "stop" }
export async function POST(req: Request) {
  const { action } = await req.json().catch(() => ({}));
  if (action !== "start" && action !== "stop") return NextResponse.json({ error: "action must be start|stop" }, { status: 400 });
  const od = readSettings().opendesign;
  const cwd = od.installPath || undefined;

  if (action === "start") {
    if (od.launchCmd) {
      const res = await runCmd(od.launchCmd, cwd, 120_000);
      return NextResponse.json({ ok: res.ok, action, log: res.out }, { status: res.ok ? 200 : 500 });
    }
    if (existsSync(MAC_START)) {
      const res = await runCmd(`bash ${JSON.stringify(MAC_START)}`, cwd, 120_000);
      return NextResponse.json({ ok: res.ok, action, log: res.out }, { status: res.ok ? 200 : 500 });
    }
    return NextResponse.json({ ok: false, action, error: "No launch command set. Open the Open Design config menu (gear) and add the command that starts Open Design on your machine (e.g. how you normally run it)." }, { status: 400 });
  }

  // stop
  if (od.stopCmd) {
    const res = await runCmd(od.stopCmd, cwd, 40_000);
    return NextResponse.json({ ok: res.ok, action, log: res.out }, { status: res.ok ? 200 : 500 });
  }
  if (existsSync(MAC_STOP)) {
    const res = await runCmd(`bash ${JSON.stringify(MAC_STOP)}`, cwd, 40_000);
    return NextResponse.json({ ok: res.ok, action, log: res.out }, { status: res.ok ? 200 : 500 });
  }
  // Nothing to run — treat as a no-op success (the user can close OD themselves).
  return NextResponse.json({ ok: true, action, log: "No stop command configured." });
}
