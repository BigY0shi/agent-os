"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Lock, Loader2, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [from, setFrom] = useState("/");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const f = sp.get("from");
      if (f && f.startsWith("/")) setFrom(f);
      if (sp.get("err") === "unset") setErr("No password is configured. Set AGENTOS_PASSWORD in .env.local and restart the server.");
    } catch { /* ignore */ }
    inputRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { window.location.href = from; return; }
      setErr(j.error || "Sign-in failed."); setBusy(false);
    } catch (e) { setErr(String(e)); setBusy(false); }
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center px-4"
      style={{
        background:
          "radial-gradient(1000px 600px at 70% -10%, rgba(43,182,255,0.10), transparent 60%)," +
          "radial-gradient(800px 500px at -5% 110%, rgba(111,255,155,0.08), transparent 60%)," +
          "linear-gradient(180deg, #04060a 0%, #060912 55%, #04070d 100%)",
      }}
    >
      {/* faint top hairline */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(111,255,155,0.35), rgba(43,182,255,0.25), transparent)" }} />

      <form
        onSubmit={submit}
        className="relative w-full max-w-[380px] rounded-2xl p-7"
        style={{
          background: "linear-gradient(180deg, rgba(20,27,41,0.82), rgba(11,16,26,0.78))",
          border: "1px solid rgba(140,165,210,0.12)",
          backdropFilter: "blur(18px) saturate(125%)",
          WebkitBackdropFilter: "blur(18px) saturate(125%)",
          boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.05), 0 30px 70px -20px rgba(0,0,0,0.85)",
        }}
      >
        {/* glass top edge */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl"
          style={{ background: "linear-gradient(90deg, transparent, rgba(180,210,255,0.25), transparent)" }} />

        <div className="flex items-center gap-3 mb-5">
          <div className="relative grid h-11 w-11 place-items-center rounded-xl overflow-hidden border"
            style={{ borderColor: "rgba(140,165,210,0.18)", background: "linear-gradient(135deg, rgba(111,255,155,0.18), rgba(43,182,255,0.12) 60%, rgba(108,75,255,0.16))" }}>
            <Sparkles className="h-5 w-5" style={{ color: "#6fff9b", filter: "drop-shadow(0 0 8px rgba(111,255,155,0.6))" }} />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold" style={{ color: "#e6ecf5" }}>Agent OS</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: "#5b6678" }}>Command Center · LAN</div>
          </div>
        </div>

        <label className="block text-[12px] font-semibold mb-1.5 inline-flex items-center gap-1.5" style={{ color: "#9aa6b8" }}>
          <Lock size={13} style={{ color: "#6fff9b" }} /> Access password
        </label>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password…"
          autoComplete="current-password"
          className="w-full rounded-lg px-3.5 py-2.5 text-[14px] outline-none mb-3"
          style={{ background: "rgba(4,7,13,0.6)", border: "1px solid rgba(140,165,210,0.14)", color: "#e6ecf5" }}
        />

        {err && (
          <div className="text-[12px] mb-3 rounded-lg px-3 py-2"
            style={{ color: "#ff8da6", background: "rgba(255,90,107,0.08)", border: "1px solid rgba(255,90,107,0.3)" }}>
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13.5px] font-semibold transition disabled:opacity-50"
          style={{ background: "#6fff9b", color: "#04221c", boxShadow: "0 8px 26px -8px rgba(111,255,155,0.5)" }}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
          {busy ? "Signing in…" : "Unlock dashboard"}
        </button>

        <div className="mt-4 text-center text-[10.5px]" style={{ color: "#475366" }}>
          Local network access · gated for your CLI agents + vault
        </div>
      </form>
    </div>
  );
}
