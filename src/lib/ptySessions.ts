// Terminal sessions — real PTYs that outlive a single HTTP request.
//
// Why a module-level registry: Next.js route handlers are stateless, but a shell
// is the opposite of stateless. The pty is created by one request, written to by
// later ones, and read by a long-lived SSE stream. So the process (not the request)
// owns it, keyed by id.
//
// Why a PTY and not spawn(): the whole point is running interactive CLIs — the
// `claude` login flow, `codex`, anything with a prompt or a TUI. Those detect a
// real terminal and refuse to render into a plain pipe ("raw mode is not
// supported"). node-pty gives ConPTY on Windows, so they behave exactly as they
// would in Windows Terminal.
//
// This runs commands as the user account hosting the dashboard. That is the point
// of the feature, and it is not a new capability — the agent routes already spawn
// arbitrary CLIs. The password gate in proxy.ts is what stands in front of it.
import { createRequire } from "node:module";
import { IS_WIN, whichBin } from "./platform";

// The node-pty typings, without importing the native module at module scope.
interface IPty {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
}

export interface SessionInfo {
  id: string;
  shell: string;
  cwd: string;
  pid: number;
  createdAt: number;
  exitCode: number | null;
}

interface Session {
  id: string;
  pty: IPty;
  shell: string;
  cwd: string;
  createdAt: number;
  /** Scrollback, so a reconnecting browser sees what it missed instead of a blank screen. */
  buffer: string;
  listeners: Set<(chunk: string) => void>;
  exitCode: number | null;
}

// Cap the replay buffer. Terminals emit a LOT (progress spinners especially), and
// an unbounded string here is a slow memory leak that only shows up after hours.
const MAX_BUFFER = 256_000;
const MAX_SESSIONS = 8;

// Survive dev hot-reload: module state resets on HMR, which would orphan live PTYs
// (invisible processes still holding the shell open). Park the registry on globalThis.
const g = globalThis as unknown as { __agentosPtys?: Map<string, Session> };
const SESSIONS: Map<string, Session> = (g.__agentosPtys ??= new Map());

// createRequire, not a bare `require`: this file may be emitted as ESM, where
// `require` is undefined. This resolves node-pty at runtime either way, and keeps
// the bundler from trying to trace a .node binary.
const nodeRequire = createRequire(import.meta.url);

/** Load node-pty lazily so a missing/ABI-mismatched native build reports cleanly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ptyModule(): any {
  try {
    return nodeRequire("node-pty");
  } catch (e) {
    throw new Error(
      `node-pty failed to load — the terminal needs its native binary. Try "npm rebuild node-pty". (${String(e)})`,
    );
  }
}

/** Prefer PowerShell 7 (pwsh) over Windows PowerShell 5, then fall back to cmd. */
export function defaultShell(): string {
  if (IS_WIN) {
    return whichBin("pwsh") || whichBin("powershell") || process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || whichBin("zsh") || whichBin("bash") || "/bin/sh";
}

export function listSessions(): SessionInfo[] {
  return [...SESSIONS.values()].map((s) => ({
    id: s.id, shell: s.shell, cwd: s.cwd, pid: s.pty.pid,
    createdAt: s.createdAt, exitCode: s.exitCode,
  }));
}

export function getSession(id: string): Session | undefined {
  return SESSIONS.get(id);
}

export function createSession(opts?: { shell?: string; cwd?: string; cols?: number; rows?: number }): SessionInfo {
  // Reap anything already dead before enforcing the cap, so exited tabs don't
  // permanently consume a slot.
  for (const [id, s] of SESSIONS) if (s.exitCode !== null && s.listeners.size === 0) SESSIONS.delete(id);
  if (SESSIONS.size >= MAX_SESSIONS) throw new Error(`Too many terminals open (max ${MAX_SESSIONS}). Close one first.`);

  const shell = opts?.shell || defaultShell();
  const cwd = opts?.cwd || process.env.USERPROFILE || process.env.HOME || process.cwd();
  const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  // -NoLogo/-NoProfile keep the banner and profile noise out; an interactive shell
  // is still what the user gets.
  const args = IS_WIN && /pwsh|powershell/i.test(shell) ? ["-NoLogo"] : [];

  const pty: IPty = ptyModule().spawn(shell, args, {
    name: "xterm-256color",
    cols: opts?.cols ?? 120,
    rows: opts?.rows ?? 30,
    cwd,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  const session: Session = {
    id, pty, shell, cwd, createdAt: Date.now(),
    buffer: "", listeners: new Set(), exitCode: null,
  };

  pty.onData((chunk) => {
    session.buffer += chunk;
    if (session.buffer.length > MAX_BUFFER) session.buffer = session.buffer.slice(-MAX_BUFFER);
    for (const fn of session.listeners) { try { fn(chunk); } catch { /* dead stream */ } }
  });

  pty.onExit(({ exitCode }) => {
    session.exitCode = exitCode;
    const note = `\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`;
    session.buffer += note;
    for (const fn of session.listeners) { try { fn(note); } catch { /* dead stream */ } }
  });

  SESSIONS.set(id, session);
  return { id, shell, cwd, pid: pty.pid, createdAt: session.createdAt, exitCode: null };
}

export function writeTo(id: string, data: string): void {
  const s = SESSIONS.get(id);
  if (!s) throw new Error("No such terminal session (it may have been closed).");
  if (s.exitCode !== null) throw new Error("That shell has exited — open a new terminal.");
  s.pty.write(data);
}

export function resize(id: string, cols: number, rows: number): void {
  const s = SESSIONS.get(id);
  if (!s || s.exitCode !== null) return;
  // Guard the native call: a 0/NaN dimension from a hidden or unmounted xterm
  // throws inside ConPTY and takes the request down with it.
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) return;
  try { s.pty.resize(Math.floor(cols), Math.floor(rows)); } catch { /* race with exit */ }
}

export function killSession(id: string): void {
  const s = SESSIONS.get(id);
  if (!s) return;
  try { s.pty.kill(); } catch { /* already gone */ }
  SESSIONS.delete(id);
}

/**
 * Attach a live listener. Returns the scrollback to paint first plus an unsubscribe.
 * Backlog-then-live is deliberate: subscribing before reading the buffer would
 * duplicate whatever arrives in between.
 */
export function subscribe(id: string, fn: (chunk: string) => void): { backlog: string; off: () => void } {
  const s = SESSIONS.get(id);
  if (!s) throw new Error("No such terminal session.");
  const backlog = s.buffer;
  s.listeners.add(fn);
  return { backlog, off: () => { s.listeners.delete(fn); } };
}
