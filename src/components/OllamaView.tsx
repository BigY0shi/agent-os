"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Trash2, Loader2, Cloud, ChevronDown, Check, Sparkles } from "lucide-react";

const ACCENT = "#6CA8FF"; // cloud blue
const HISTORY_KEY = "agentic-os/ollama-cloud/history/v1";
const MODEL_KEY = "agentic-os/ollama-cloud/model/v1";

interface Msg { role: "user" | "assistant"; text: string; }

export default function OllamaView() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>("qwen3-coder:480b");
  const [modelOpen, setModelOpen] = useState(false);
  const [modelErr, setModelErr] = useState<string | null>(null);

  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  // hydrate history + chosen model
  useEffect(() => {
    try { const raw = localStorage.getItem(HISTORY_KEY); if (raw) setMsgs(JSON.parse(raw).slice(-200)); } catch {}
    try { const m = localStorage.getItem(MODEL_KEY); if (m) setModel(m); } catch {}
    hydrated.current = true;
  }, []);
  useEffect(() => { if (hydrated.current) try { localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-200))); } catch {} }, [msgs]);
  useEffect(() => { if (hydrated.current) try { localStorage.setItem(MODEL_KEY, model); } catch {} }, [model]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, partial]);

  // load the account's cloud models for the dropdown
  useEffect(() => {
    fetch("/api/ollama/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && Array.isArray(j.models) && j.models.length) {
          setModels(j.models);
          setModel((cur) => (j.models.includes(cur) ? cur : j.models[0]));
        } else if (j.error) setModelErr(j.error);
      })
      .catch((e) => setModelErr(String(e)));
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setErr(null);
    const next = [...msgs, { role: "user" as const, text }];
    setMsgs(next); setInput(""); setStreaming(true); setPartial("");
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    let acc = "", errMsg: string | null = null;
    try {
      const r = await fetch("/api/ollama/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, model, history: next.slice(0, -1).map((m) => ({ role: m.role, text: m.text })) }),
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
  }, [input, streaming, msgs, model]);

  function stop() { ctrlRef.current?.abort(); setStreaming(false); setPartial(""); }
  function clearChat() { if (confirm("Clear Ollama Cloud chat history?")) { setMsgs([]); try { localStorage.removeItem(HISTORY_KEY); } catch {} } }

  const shortModel = model.length > 26 ? model.slice(0, 24) + "…" : model;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 20 }}
          className="w-8 h-8 rounded-lg grid place-items-center text-white"
          style={{ background: "linear-gradient(135deg,#7AC8FF,#4F8BFF)" }}
        >
          <Cloud size={17} />
        </motion.div>
        <div>
          <div className="text-[15px] font-semibold text-[var(--cream)] leading-none">Ollama Cloud</div>
          <div className="text-[10.5px] text-[var(--cream-mute)] mt-1">Hosted open models · {models.length || "—"} available · streaming</div>
        </div>

        {/* model dropdown */}
        <div className="ml-auto relative">
          <button
            onClick={() => setModelOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition mono"
            style={{ borderColor: modelOpen ? ACCENT : "var(--line-soft)", background: modelOpen ? `${ACCENT}1e` : "transparent", color: modelOpen ? ACCENT : "var(--cream-dim)" }}
          >
            {shortModel}
            <motion.span animate={{ rotate: modelOpen ? 180 : 0 }} transition={{ duration: 0.18 }}><ChevronDown size={13} /></motion.span>
          </button>
          <AnimatePresence>
            {modelOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setModelOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="absolute right-0 mt-1.5 z-40 w-64 max-h-[60vh] overflow-y-auto scroll rounded-xl border p-1 shadow-2xl"
                  style={{ borderColor: "var(--line-soft)", background: "var(--bg-card)", backdropFilter: "blur(12px)" }}
                >
                  {modelErr && <div className="text-[11px] text-[var(--plum)] px-2.5 py-2">{modelErr}</div>}
                  {!models.length && !modelErr && <div className="text-[11px] text-[var(--cream-mute)] px-2.5 py-2 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> loading models…</div>}
                  {models.map((m) => (
                    <button key={m} onClick={() => { setModel(m); setModelOpen(false); }}
                      className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] mono transition hover:bg-[rgba(255,255,255,0.04)]"
                      style={{ color: m === model ? ACCENT : "var(--cream-soft)" }}>
                      <span className="w-3.5 shrink-0">{m === model && <Check size={13} />}</span>
                      <span className="truncate">{m}</span>
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* chat */}
      <div className="panel flex flex-col min-h-0 flex-1 p-0 overflow-hidden">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scroll p-4 space-y-4">
          {msgs.length === 0 && !streaming && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full grid place-items-center text-center">
              <div>
                <Sparkles size={24} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-70" />
                <div className="text-[13.5px] text-[var(--cream)]">Chat with Ollama Cloud.</div>
                <div className="text-[11.5px] text-[var(--cream-mute)] mt-1">Frontier open models, hosted — no local GPU needed. Pick a model top-right.</div>
              </div>
            </motion.div>
          )}
          <AnimatePresence initial={false}>
            {msgs.map((m, i) => (
              <motion.div key={i} layout
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[82%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap"
                  style={m.role === "user"
                    ? { background: `${ACCENT}1a`, border: `1px solid ${ACCENT}40`, color: "var(--cream)" }
                    : { background: "var(--bg-card)", border: "1px solid var(--line-soft)", color: "var(--cream-soft)" }}>
                  {m.text}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {streaming && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
              <div className="max-w-[82%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--bg-card)", border: "1px solid var(--line-soft)", color: "var(--cream-soft)" }}>
                {partial || <span className="inline-flex items-center gap-2 text-[var(--cream-mute)]"><Loader2 size={13} className="animate-spin" style={{ color: ACCENT }} /> {shortModel} is thinking…</span>}
              </div>
            </motion.div>
          )}
          {err && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[12px] text-[var(--plum)] bg-[rgba(196,96,126,0.08)] border border-[rgba(196,96,126,0.3)] rounded-lg px-3 py-2">{err}</motion.div>}
        </div>

        {/* composer */}
        <div className="border-t border-[var(--line-soft)] p-3 flex items-end gap-2 shrink-0">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}
            placeholder={`Ask ${shortModel} to build, fix, or explain…  (⌘/Ctrl+Enter to send)`}
            className="flex-1 resize-none bg-[var(--bg-mid)] border border-[var(--line-soft)] rounded-xl px-3 py-2 text-[13.5px] text-[var(--cream)] placeholder:text-[var(--cream-mute)] focus:outline-none focus:border-[var(--line)] transition" />
          {streaming
            ? <motion.button whileTap={{ scale: 0.94 }} onClick={stop} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold bg-rose-500/20 border border-rose-400/40 text-rose-300"><Square size={14} /> Stop</motion.button>
            : <motion.button whileTap={{ scale: 0.94 }} whileHover={{ scale: 1.03 }} onClick={send} disabled={!input.trim()} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-40 transition" style={{ background: ACCENT, color: "#04122b" }}><Send size={14} /> Send</motion.button>}
          {msgs.length > 0 && <motion.button whileTap={{ scale: 0.9 }} onClick={clearChat} title="Clear history" className="p-2.5 rounded-xl text-[var(--cream-mute)] hover:text-[var(--plum)] border border-[var(--line-soft)] transition"><Trash2 size={14} /></motion.button>}
        </div>
      </div>
    </div>
  );
}
