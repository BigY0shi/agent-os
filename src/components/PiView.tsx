"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Square, Trash2, Loader2, Sparkles } from "lucide-react";
import { MOD } from "@/lib/modKey";

const ACCENT = "#fbbf24"; // Pi amber
const HISTORY_KEY = "agentic-os/pi/history/v1";

interface Msg { role: "user" | "assistant"; text: string; }

export default function PiView() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    try { const raw = localStorage.getItem(HISTORY_KEY); if (raw) setMsgs(JSON.parse(raw).slice(-200)); } catch {}
    hydrated.current = true;
  }, []);
  useEffect(() => { if (hydrated.current) try { localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-200))); } catch {} }, [msgs]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, partial]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setErr(null);
    const next = [...msgs, { role: "user" as const, text }];
    setMsgs(next); setInput(""); setStreaming(true); setPartial("");
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    let acc = "", errMsg: string | null = null;
    try {
      const r = await fetch("/api/pi/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, history: next.slice(0, -1).map(m => ({ role: m.role, text: m.text })) }),
        signal: ctrl.signal,
      });
      if (r.body) {
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try { const j = JSON.parse(line); if (j.t === "d") { acc += j.c; setPartial(acc); } else if (j.t === "error") { errMsg = j.m; } } catch {}
          }
        }
      }
    } catch (e) { if ((e as Error).name !== "AbortError") errMsg = String(e); }
    if (acc.trim()) setMsgs((m) => [...m, { role: "assistant", text: acc.trim() }]);
    if (errMsg && !acc.trim()) setErr(errMsg);
    setPartial(""); setStreaming(false);
  }, [input, streaming, msgs]);

  function stop() { ctrlRef.current?.abort(); setStreaming(false); setPartial(""); }
  function clearChat() { if (confirm("Clear Pi chat history?")) { setMsgs([]); try { localStorage.removeItem(HISTORY_KEY); } catch {} } }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <div className="w-8 h-8 rounded-lg grid place-items-center text-[#3a2606] font-bold text-[14px]" style={{ background: "linear-gradient(135deg,#fcd34d,#f59e0b)" }}>π</div>
        <div>
          <div className="text-[15px] font-semibold text-[var(--cream)] leading-none">Pi</div>
          <div className="text-[10.5px] text-[var(--cream-mute)] mt-1">pi CLI · the model set in Pi&apos;s own config (<code>pi --list-models</code>) · no API key</div>
        </div>
      </div>

      <div className="panel flex flex-col min-h-0 flex-1 p-0 overflow-hidden">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scroll p-4 space-y-4">
          {msgs.length === 0 && !streaming && (
            <div className="h-full grid place-items-center text-center">
              <div>
                <Sparkles size={24} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-70" />
                <div className="text-[13.5px] text-[var(--cream)]">Chat with Pi.</div>
                <div className="text-[11.5px] text-[var(--cream-mute)] mt-1">A local coding-assistant CLI wired to your Ollama Cloud model. Ask it anything.</div>
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[82%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap"
                style={m.role === "user"
                  ? { background: `${ACCENT}1a`, border: `1px solid ${ACCENT}40`, color: "var(--cream)" }
                  : { background: "var(--bg-card)", border: "1px solid var(--line-soft)", color: "var(--cream-soft)" }}>
                {m.text}
              </div>
            </div>
          ))}
          {streaming && (
            <div className="flex justify-start">
              <div className="max-w-[82%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--bg-card)", border: "1px solid var(--line-soft)", color: "var(--cream-soft)" }}>
                {partial || <span className="inline-flex items-center gap-2 text-[var(--cream-mute)]"><Loader2 size={13} className="animate-spin" style={{ color: ACCENT }} /> Pi is working…</span>}
              </div>
            </div>
          )}
          {err && <div className="text-[12px] text-[var(--plum)] bg-[rgba(196,96,126,0.08)] border border-[rgba(196,96,126,0.3)] rounded-lg px-3 py-2">{err}</div>}
        </div>
        <div className="border-t border-[var(--line-soft)] p-3 flex items-end gap-2 shrink-0">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}
            placeholder={`Ask Pi anything…  (${MOD}+Enter to send)`}
            className="flex-1 resize-none bg-[var(--bg-mid)] border border-[var(--line-soft)] rounded-xl px-3 py-2 text-[13.5px] text-[var(--cream)] placeholder:text-[var(--cream-mute)] focus:outline-none" />
          {streaming
            ? <button onClick={stop} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold bg-rose-500/20 border border-rose-400/40 text-rose-300"><Square size={14} /> Stop</button>
            : <button onClick={send} disabled={!input.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-40" style={{ background: ACCENT, color: "#3a2606" }}><Send size={14} /> Send</button>}
          {msgs.length > 0 && <button onClick={clearChat} title="Clear history" className="p-2.5 rounded-xl text-[var(--cream-mute)] hover:text-[var(--plum)] border border-[var(--line-soft)]"><Trash2 size={14} /></button>}
        </div>
      </div>
    </div>
  );
}
