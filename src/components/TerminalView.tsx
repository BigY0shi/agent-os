"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TerminalSquare, Plus, Trash2, RotateCw } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

// A real terminal in the dashboard. xterm.js on the client, a ConPTY on the server.
//
// Transport is asymmetric on purpose: output streams down over SSE (one long-lived
// connection), input goes up as small POSTs. `next start` gives us no WebSocket
// upgrade, and this pair behaves identically for everything short of a firehose.

const LS_SESSION = "agentos.terminal.session";

interface SessionInfo { id: string; shell: string; cwd: string; pid: number }

export default function TerminalView() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitRef = useRef<any>(null);
  const esRef = useRef<EventSource | null>(null);
  const idRef = useRef<string>("");

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string>("");
  const [booting, setBooting] = useState(true);

  // ── input: coalesce keystrokes ──────────────────────────────────────────────
  // One POST per keypress is wasteful and can arrive out of order. Buffer, then
  // flush on a microtask-ish timer, awaiting each send so ordering is guaranteed.
  const outbox = useRef<string>("");
  const sending = useRef(false);
  const flush = useCallback(async () => {
    if (sending.current || !outbox.current || !idRef.current) return;
    sending.current = true;
    while (outbox.current) {
      const data = outbox.current;
      outbox.current = "";
      try {
        await fetch("/api/terminal", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "input", id: idRef.current, data }),
        });
      } catch { /* the SSE stream surfaces a dead shell */ }
    }
    sending.current = false;
  }, []);

  const send = useCallback((data: string) => {
    outbox.current += data;
    setTimeout(flush, 8);
  }, [flush]);

  // ── attach the output stream ────────────────────────────────────────────────
  const attach = useCallback((id: string) => {
    esRef.current?.close();
    const es = new EventSource(`/api/terminal/stream?id=${encodeURIComponent(id)}`);
    es.addEventListener("out", (ev) => {
      try { termRef.current?.write(JSON.parse((ev as MessageEvent).data)); } catch { /* bad frame */ }
    });
    es.onerror = () => {
      // EventSource auto-reconnects; only surface it if the session is truly gone.
      if (es.readyState === EventSource.CLOSED) setError("Output stream closed. Try Reconnect.");
    };
    esRef.current = es;
  }, []);

  const openSession = useCallback(async (opts?: { reuse?: string }) => {
    setError("");
    const term = termRef.current;
    try {
      if (opts?.reuse) {
        // Does the server still have it? A restart wipes every PTY.
        const r = await fetch("/api/terminal", { cache: "no-store" });
        const j = await r.json();
        const found = (j?.sessions as SessionInfo[] | undefined)?.find((s) => s.id === opts.reuse);
        if (found) {
          idRef.current = found.id;
          setSession(found);
          attach(found.id);
          return;
        }
      }
      const r = await fetch("/api/terminal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          cols: term?.cols ?? 120,
          rows: term?.rows ?? 30,
        }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Could not start a shell.");
      idRef.current = j.session.id;
      localStorage.setItem(LS_SESSION, j.session.id);
      setSession(j.session);
      attach(j.session.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [attach]);

  // ── boot xterm once ─────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    (async () => {
      // Dynamic import: xterm touches `document` at module scope, so it cannot be
      // part of the server render.
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        cursorBlink: true,
        allowProposedApi: true,
        scrollback: 5000,
        theme: {
          background: "#09090b", foreground: "#e4e4e7", cursor: "#a855f7",
          selectionBackground: "rgba(168,85,247,0.30)",
          black: "#18181b", red: "#f87171", green: "#4ade80", yellow: "#fbbf24",
          blue: "#60a5fa", magenta: "#c084fc", cyan: "#22d3ee", white: "#e4e4e7",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      try { fit.fit(); } catch { /* not laid out yet */ }
      term.onData(send);
      termRef.current = term;
      fitRef.current = fit;
      setBooting(false);

      await openSession({ reuse: localStorage.getItem(LS_SESSION) || undefined });
      term.focus();
    })();

    return () => {
      disposed = true;
      esRef.current?.close();
      try { termRef.current?.dispose(); } catch { /* already gone */ }
    };
    // Mount-only: openSession/send are stable callbacks and re-running would
    // rebuild the terminal and orphan the PTY.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── keep the PTY's idea of the window in sync with the DOM ──────────────────
  useEffect(() => {
    if (!hostRef.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      // Debounced: a drag emits dozens of events and each one is a syscall.
      timer = setTimeout(() => {
        try { fitRef.current?.fit(); } catch { return; }
        const t = termRef.current;
        if (!t || !idRef.current) return;
        fetch("/api/terminal", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resize", id: idRef.current, cols: t.cols, rows: t.rows }),
        }).catch(() => { /* resize is best-effort */ });
      }, 120);
    });
    ro.observe(hostRef.current);
    return () => { clearTimeout(timer); ro.disconnect(); };
  }, []);

  async function newSession() {
    if (idRef.current) {
      await fetch("/api/terminal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill", id: idRef.current }),
      }).catch(() => {});
    }
    localStorage.removeItem(LS_SESSION);
    termRef.current?.reset();
    idRef.current = "";
    setSession(null);
    await openSession();
    termRef.current?.focus();
  }

  async function killSession() {
    if (!idRef.current) return;
    await fetch("/api/terminal", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "kill", id: idRef.current }),
    }).catch(() => {});
    esRef.current?.close();
    localStorage.removeItem(LS_SESSION);
    idRef.current = "";
    setSession(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-zinc-200">
          <TerminalSquare size={18} style={{ color: "#5eead4" }} />
          <span className="font-semibold">Terminal</span>
        </div>
        {session && (
          <span className="text-xs text-zinc-500 font-mono truncate">
            {session.shell.split(/[\\/]/).pop()} · pid {session.pid} · {session.cwd}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={newSession}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-white transition-colors">
            <Plus size={13} /> New
          </button>
          <button onClick={() => idRef.current && attach(idRef.current)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-white transition-colors">
            <RotateCw size={13} /> Reconnect
          </button>
          <button onClick={killSession}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-zinc-800 text-zinc-400 hover:border-red-800 hover:text-red-300 transition-colors">
            <Trash2 size={13} /> Kill
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-300 bg-red-950/40 border border-red-900/60 rounded-md px-3 py-2">{error}</div>
      )}

      <div
        onClick={() => termRef.current?.focus()}
        className="rounded-lg border border-zinc-800 overflow-hidden"
        style={{ background: "#09090b" }}
      >
        <div ref={hostRef} style={{ height: "calc(100vh - 230px)", minHeight: 320, padding: 8 }} />
      </div>

      {booting && <div className="text-xs text-zinc-500">Starting terminal…</div>}

      <p className="text-xs text-zinc-600">
        A real shell on the machine hosting Agent OS, running as that user — use it to re-auth a CLI
        (<span className="font-mono text-zinc-500">claude</span> then <span className="font-mono text-zinc-500">/login</span>),
        check a log, or restart a service. The session survives navigating away.
      </p>
    </div>
  );
}
