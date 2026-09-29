"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaceStage } from "@/components/faces/FaceStage";
import type { FaceState } from "@/components/faces/AgentFace";
import { Sparkles, Loader2, Clock, X, Moon, ScrollText, Volume2, Square, Settings2 } from "lucide-react";
import AgentPicker from "@/components/AgentPicker";
import { useSettings, type Settings } from "@/components/ConfigMenu";
import { MOD } from "@/lib/modKey";

// THE ORACLE — ask the wise old sage a question of judgment, direction or foresight
// (advice + predictions, not hard facts). It researches quietly with your CLI agent's
// own tools, then answers in a measured, philosophical voice. Warm candle-glow HUD,
// distinct from the cyan Radar.

interface Consultation { at: string; question: string; answer: string; agent: string; }

// The Oracle's voice lives in settings.oracle.voice (S8), edited in the gear
// below and read at speak time. Defaults come merged from the server, so the
// client never carries a voice id of its own.
interface OracleVoice {
  provider?: "voicebox" | "elevenlabs";
  voiceboxProfile?: string;
  elevenVoiceId?: string;
  fallback?: "elevenlabs" | "none";
}
const voiceOf = (s: unknown): OracleVoice => ((s as { oracle?: { voice?: OracleVoice } } | null)?.oracle?.voice) ?? {};

const CONTEMPLATIONS = [
  "The Oracle draws breath…",
  "Consulting the long memory…",
  "Weighing what is seen and unseen…",
  "Reading the currents beneath your question…",
  "Turning the question in the light…",
  "Letting the dust settle…",
];

function ago(iso: string): string {
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (isNaN(s)) return "";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Split off the final distilled line as an aphorism pull-quote, when it's short enough.
function splitAphorism(text: string): { body: string; aphorism: string } {
  const paras = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (paras.length < 2) return { body: text.trim(), aphorism: "" };
  const last = paras[paras.length - 1];
  if (last.length > 180) return { body: text.trim(), aphorism: "" };
  return { body: paras.slice(0, -1).join("\n\n"), aphorism: last };
}

export default function OracleView() {
  const [question, setQuestion] = useState("");
  const [agent, setAgent] = useState("claude");
  const [busy, setBusy] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answeredAt, setAnsweredAt] = useState<string | null>(null);
  const [askedShown, setAskedShown] = useState<string>(""); // the question tied to the shown answer
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<Consultation[]>([]);
  const [tts, setTts] = useState<"idle" | "loading" | "playing">("idle");
  // Who actually spoke the last reply, when it was not the provider asked for
  // (rule 20: a chosen backup is fine, a quiet one is not).
  const [spokeVia, setSpokeVia] = useState<string | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Voice settings + the gear (rule 16: every knob in-app).
  const { settings, save, saving } = useSettings();
  const voice = voiceOf(settings);
  const provider = voice.provider ?? "voicebox";
  const [gearOpen, setGearOpen] = useState(false);
  const [vbProfiles, setVbProfiles] = useState<{ id: string; name: string; engine: string | null }[]>([]);
  const [vbError, setVbError] = useState<string | null>(null);
  const [elevenVoices, setElevenVoices] = useState<{ voice_id: string; name: string }[]>([]);
  // The face reflects only what is really happening (AGENTS.md "Never fabricate state").
  const oracleFace: FaceState = err ? "error" : busy ? "thinking" : tts === "playing" ? "speaking" : tts === "loading" ? "working" : "idle";
  const patchVoice = (p: Partial<OracleVoice>) => save({ oracle: { voice: p } } as Partial<Settings>);

  const loadHistory = useCallback(() => {
    fetch("/api/oracle", { cache: "no-store" }).then((r) => r.json())
      .then((j) => setHistory(Array.isArray(j.items) ? j.items : [])).catch(() => {});
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  // The pickers load only when the gear opens: the studio and ElevenLabs are
  // not consulted on every page view.
  useEffect(() => {
    if (!gearOpen) return;
    let alive = true;
    fetch("/api/voicebox/profiles", { cache: "no-store" }).then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.ok) { setVbProfiles(j.profiles ?? []); setVbError(null); }
        else { setVbProfiles([]); setVbError(j?.error || "Voicebox not answering"); }
      })
      .catch((e) => { if (alive) { setVbProfiles([]); setVbError(String(e)); } });
    fetch("/api/video/voices", { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (alive && Array.isArray(j.voices)) setElevenVoices(j.voices.map((v: { voice_id: string; name: string }) => ({ voice_id: v.voice_id, name: v.name }))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [gearOpen]);
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  useEffect(() => {
    if (!busy) return;
    const i = setInterval(() => setStatusIdx((n) => (n + 1) % CONTEMPLATIONS.length), 3400);
    return () => clearInterval(i);
  }, [busy]);

  const stopSpeak = useCallback(() => { audioRef.current?.pause(); audioRef.current = null; setTts("idle"); }, []);
  const speak = useCallback(async (text: string) => {
    stopSpeak();
    if (!text.trim()) return;
    setTts("loading"); setSpokeVia(null);
    try {
      // Settings normally arrived with the page; if not yet, ask once rather
      // than speak with a guessed voice.
      let v = settings ? voiceOf(settings) : null;
      if (!v) {
        const sr = await fetch("/api/settings", { cache: "no-store" });
        v = voiceOf((await sr.json())?.settings);
      }
      const prov = v.provider ?? "voicebox";
      const voiceId = prov === "voicebox" ? (v.voiceboxProfile ?? "") : (v.elevenVoiceId ?? "");
      const r = await fetch("/api/hermes/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, provider: prov, voiceId, module: "oracle" }) });
      const d = await r.json();
      if (!d.audio) { setTts("idle"); setErr(d.error || "The Oracle's voice did not answer."); return; }
      if (d.fellBackFrom) {
        console.warn(`[oracle] ${d.provider} spoke because ${d.fellBackFrom} failed: ${d.fallbackReason}`);
        setSpokeVia(`${d.provider} spoke: ${d.fellBackFrom} failed (${d.fallbackReason})`);
      }
      const a = new Audio(d.audio);
      audioRef.current = a;
      a.onended = () => setTts("idle");
      a.onerror = () => setTts("idle");
      await a.play();
      setTts("playing");
    } catch (e) { setTts("idle"); setErr(String((e as Error)?.message || e)); }
  }, [settings, stopSpeak]);

  const consult = useCallback(async () => {
    const q = question.trim();
    if (!q || busy) return;
    stopSpeak();
    setBusy(true); setErr(null); setAnswer(null); setStatusIdx(0);
    try {
      const r = await fetch("/api/oracle", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, agent }),
      });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "The Oracle was silent. Try again."); setBusy(false); return; }
      setAnswer(d.answer); setAnsweredAt(d.at || new Date().toISOString()); setAskedShown(q);
      setBusy(false); loadHistory();
      setTimeout(() => answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } catch (e) {
      setErr(String((e as Error)?.message || e)); setBusy(false);
    }
  }, [question, agent, busy, loadHistory, stopSpeak]);

  const recall = (c: Consultation) => {
    stopSpeak();
    setAnswer(c.answer); setAnsweredAt(c.at); setAskedShown(c.question); setErr(null);
    setTimeout(() => answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const { body, aphorism } = answer ? splitAphorism(answer) : { body: "", aphorism: "" };

  return (
    <div className="orc">
      <style>{`
        .orc{ --gold:#e6b866; --gold-soft:#f0d9a8; --violet:#a78bfa; --ink:#efe6d6; --dim:#9a8f7d;
          color:var(--ink); font-family:'Manrope',system-ui,sans-serif; }
        .orc-grid{ display:grid; grid-template-columns:1fr 260px; gap:22px; align-items:start; }
        @media(max-width:1040px){ .orc-grid{ grid-template-columns:1fr; } }

        /* ASK PANEL */
        .orc-ask{ position:relative; border:1px solid rgba(230,184,102,.24); border-radius:18px; overflow:hidden;
          background:radial-gradient(circle at 50% 0%, rgba(230,184,102,.10), rgba(20,15,28,0) 60%), linear-gradient(180deg,#160f22,#100a19); padding:22px; }
        .orc-ask::after{ content:""; position:absolute; inset:0; pointer-events:none; border-radius:18px;
          box-shadow:inset 0 0 90px rgba(167,139,250,.06); }
        .orc-eyebrow{ display:flex; align-items:center; gap:9px; font-family:'JetBrains Mono',monospace; font-size:.6rem;
          letter-spacing:.28em; text-transform:uppercase; color:var(--gold); margin-bottom:12px; }
        .orc-eyebrow .moon{ filter:drop-shadow(0 0 6px rgba(230,184,102,.6)); }
        .orc-q{ width:100%; min-height:96px; resize:vertical; background:rgba(8,5,14,.6); color:var(--ink);
          border:1px solid rgba(230,184,102,.2); border-radius:13px; padding:14px 16px; font-size:1rem; line-height:1.5;
          font-family:'Manrope',sans-serif; outline:none; transition:border-color .15s, box-shadow .15s; }
        .orc-q:focus{ border-color:rgba(230,184,102,.55); box-shadow:0 0 0 3px rgba(230,184,102,.1); }
        .orc-q::placeholder{ color:#6f6656; }
        .orc-row{ display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-top:14px; }
        .orc-hint{ font-family:'JetBrains Mono',monospace; font-size:.64rem; color:var(--dim); }
        .orc-ask-btn{ margin-left:auto; display:inline-flex; align-items:center; gap:9px; cursor:pointer; border:0;
          font-family:'Bricolage Grotesque',sans-serif; font-weight:800; font-size:.92rem; color:#1c1206;
          background:linear-gradient(180deg,#f0d9a8,#e6b866); padding:11px 24px; border-radius:999px;
          box-shadow:0 0 26px rgba(230,184,102,.4); transition:transform .15s, box-shadow .2s, opacity .2s; }
        .orc-ask-btn:hover{ transform:translateY(-1px); box-shadow:0 0 38px rgba(230,184,102,.62); }
        .orc-ask-btn:disabled{ opacity:.7; cursor:default; transform:none; }

        .orc-seeds{ display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
        .orc-seed{ font-size:.78rem; color:var(--gold-soft); background:rgba(230,184,102,.06);
          border:1px solid rgba(230,184,102,.22); border-radius:999px; padding:5px 12px; cursor:pointer;
          transition:border-color .15s, background .15s; }
        .orc-seed:hover{ border-color:var(--gold); background:rgba(230,184,102,.12); }

        /* CONTEMPLATION (loading) */
        .orc-think{ margin-top:22px; display:flex; flex-direction:column; align-items:center; gap:16px; padding:26px 0; }
        .orc-orb{ position:relative; width:76px; height:76px; border-radius:50%;
          background:radial-gradient(circle at 40% 34%, #f4e2b6, #b98a3f 55%, #3a2a15 100%);
          box-shadow:0 0 50px rgba(230,184,102,.6), inset 0 0 24px rgba(255,240,200,.4); animation:orc-breathe 3.6s ease-in-out infinite; }
        .orc-orb::before{ content:""; position:absolute; inset:-14px; border-radius:50%;
          border:1px solid rgba(230,184,102,.3); animation:orc-ring 3.6s ease-out infinite; }
        @keyframes orc-breathe{ 0%,100%{ transform:scale(1); } 50%{ transform:scale(1.06); } }
        @keyframes orc-ring{ 0%{ transform:scale(.9); opacity:.7 } 100%{ transform:scale(1.5); opacity:0 } }
        .orc-think .line{ font-family:'JetBrains Mono',monospace; font-size:.82rem; color:var(--gold); letter-spacing:.02em; }

        /* THE ANSWER */
        .orc-answer{ margin-top:22px; position:relative; border:1px solid rgba(230,184,102,.26); border-radius:18px;
          padding:26px 30px; background:linear-gradient(180deg, rgba(230,184,102,.05), rgba(16,10,25,.4));
          box-shadow:0 20px 60px -30px rgba(230,184,102,.4); animation:orc-rise .5s cubic-bezier(.16,1,.3,1); }
        @keyframes orc-rise{ from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:none; } }
        .orc-answer .cap{ display:flex; align-items:center; gap:9px; font-family:'JetBrains Mono',monospace; font-size:.6rem;
          letter-spacing:.24em; text-transform:uppercase; color:var(--gold); margin-bottom:4px; }
        .orc-asked{ font-size:.9rem; color:var(--dim); font-style:italic; margin:0 0 16px; padding-bottom:14px;
          border-bottom:1px solid rgba(230,184,102,.14); }
        .orc-prose p{ font-family:'Manrope',sans-serif; font-size:1.06rem; line-height:1.72; color:#efe6d6; margin:0 0 14px; }
        .orc-prose p:last-child{ margin-bottom:0; }
        .orc-aphorism{ margin-top:20px; padding:16px 20px; border-left:3px solid var(--gold);
          background:rgba(230,184,102,.06); border-radius:0 12px 12px 0;
          font-family:'Bricolage Grotesque',serif; font-size:1.16rem; font-style:italic; color:var(--gold-soft); line-height:1.4; }
        .orc-foot{ margin-top:18px; display:flex; align-items:center; gap:12px; font-family:'JetBrains Mono',monospace;
          font-size:.66rem; color:var(--dim); }
        .orc-foot .again{ margin-left:auto; background:none; border:1px solid rgba(230,184,102,.3); color:var(--gold);
          border-radius:999px; padding:5px 13px; font-size:.68rem; cursor:pointer; font-family:'JetBrains Mono',monospace; }
        .orc-foot .again:hover{ border-color:var(--gold); }
        .orc-foot .when{ display:inline-flex; align-items:center; gap:5px; }
        .orc-foot .speak{ display:inline-flex; align-items:center; gap:6px; background:rgba(230,184,102,.1); border:1px solid rgba(230,184,102,.35); color:var(--gold); border-radius:999px; padding:5px 13px; font-size:.68rem; cursor:pointer; font-family:'JetBrains Mono',monospace; transition:border-color .15s, background .15s; }
        .orc-foot .speak:hover{ border-color:var(--gold); background:rgba(230,184,102,.16); }
        .orc-foot .speak:disabled{ opacity:.7; cursor:default; }
        .orc-foot .via{ font-size:.62rem; color:#fbbf24; }

        /* GEAR (voice settings) */
        .orc-gear-btn{ margin-left:auto; background:none; border:1px solid rgba(230,184,102,.24); color:var(--gold); border-radius:8px;
          padding:4px 6px; cursor:pointer; display:inline-flex; align-items:center; transition:border-color .15s, background .15s; }
        .orc-gear-btn:hover, .orc-gear-btn.on{ border-color:var(--gold); background:rgba(230,184,102,.1); }
        .orc-gear{ margin:0 0 14px; padding:12px 14px; border:1px solid rgba(230,184,102,.2); border-radius:12px; background:rgba(8,5,14,.5);
          display:grid; gap:9px; font-family:'JetBrains Mono',monospace; font-size:.66rem; color:var(--dim); }
        .orc-gear label{ display:grid; gap:4px; }
        .orc-gear .lab{ letter-spacing:.18em; text-transform:uppercase; font-size:.58rem; color:var(--gold); }
        .orc-gear select{ background:rgba(8,5,14,.7); color:var(--ink); border:1px solid rgba(230,184,102,.28); border-radius:8px; padding:6px 8px;
          font-family:'JetBrains Mono',monospace; font-size:.66rem; cursor:pointer; }
        .orc-gear select:disabled{ opacity:.6; cursor:default; }
        .orc-gear .warn{ color:#fbbf24; }

        .orc-err{ margin-top:18px; border:1px solid rgba(251,113,133,.4); background:rgba(251,113,133,.08); color:#fecdd3;
          border-radius:12px; padding:12px 16px; font-size:.9rem; display:flex; gap:10px; align-items:flex-start; }

        /* HISTORY RAIL */
        .orc-hist{ border:1px solid rgba(167,139,250,.2); border-radius:16px; padding:16px; background:rgba(16,10,25,.5); }
        .orc-hist h4{ display:flex; align-items:center; gap:8px; font-family:'JetBrains Mono',monospace; font-size:.6rem;
          letter-spacing:.22em; text-transform:uppercase; color:var(--violet); margin:0 0 12px; }
        .orc-hist-empty{ font-size:.82rem; color:var(--dim); line-height:1.5; }
        .orc-hist-item{ display:block; width:100%; text-align:left; background:rgba(167,139,250,.05);
          border:1px solid rgba(167,139,250,.16); border-radius:11px; padding:10px 12px; margin-bottom:9px; cursor:pointer;
          transition:border-color .15s, background .15s; }
        .orc-hist-item:hover{ border-color:var(--violet); background:rgba(167,139,250,.1); }
        .orc-hist-item .q{ font-size:.84rem; color:var(--ink); line-height:1.4; display:-webkit-box; -webkit-line-clamp:2;
          -webkit-box-orient:vertical; overflow:hidden; }
        .orc-hist-item .m{ margin-top:6px; font-family:'JetBrains Mono',monospace; font-size:.6rem; color:var(--dim); }
      `}</style>

      <FaceStage
        variant="galaxy"
        name="Oracle"
        subtitle="Counsel and foresight"
        state={oracleFace}
        detail={busy ? CONTEMPLATIONS[statusIdx] : tts === "loading" ? "Finding the voice" : err ? err : undefined}
      />
      <div className="orc-grid">
        <div>
          {/* ASK */}
          <div className="orc-ask">
            <div className="orc-eyebrow">
              <Moon size={13} className="moon" /> The Oracle · counsel &amp; foresight
              <button className={`orc-gear-btn${gearOpen ? " on" : ""}`} onClick={() => setGearOpen((v) => !v)} title="The Oracle's voice">
                <Settings2 size={12} />
              </button>
            </div>
            {gearOpen && (
              <div className="orc-gear">
                <label>
                  <span className="lab">Voice engine</span>
                  <select value={provider} disabled={saving} onChange={(e) => patchVoice({ provider: e.target.value as OracleVoice["provider"] })}>
                    <option value="voicebox">Voicebox (local studio, cloned voices)</option>
                    <option value="elevenlabs">ElevenLabs</option>
                  </select>
                </label>
                {provider === "voicebox" ? (
                  <>
                    <label>
                      <span className="lab">Voicebox profile</span>
                      <select value={voice.voiceboxProfile ?? ""} disabled={saving || !vbProfiles.length} onChange={(e) => patchVoice({ voiceboxProfile: e.target.value })}>
                        {/* The saved value stays selectable even when the studio does not list it, so a typo is visible instead of silently re-pointed. */}
                        {voice.voiceboxProfile && !vbProfiles.some((p) => p.id === voice.voiceboxProfile || p.name.trim().toLowerCase() === (voice.voiceboxProfile ?? "").trim().toLowerCase()) && (
                          <option value={voice.voiceboxProfile}>{voice.voiceboxProfile} (not in the studio)</option>
                        )}
                        {vbProfiles.map((p) => (
                          <option key={p.id} value={p.name.trim()}>{p.name.trim()}{p.engine ? ` · ${p.engine}` : ""}</option>
                        ))}
                      </select>
                    </label>
                    {vbError && <div className="warn">{vbError}</div>}
                    {!vbError && voice.voiceboxProfile && vbProfiles.length > 0 && !vbProfiles.some((p) => p.id === voice.voiceboxProfile || p.name.trim().toLowerCase() === (voice.voiceboxProfile ?? "").trim().toLowerCase()) && (
                      <div className="warn">Profile &quot;{voice.voiceboxProfile}&quot; is not in the studio. Available: {vbProfiles.map((p) => p.name.trim()).join(", ")}</div>
                    )}
                    <label>
                      <span className="lab">If Voicebox fails</span>
                      <select value={voice.fallback ?? "elevenlabs"} disabled={saving} onChange={(e) => patchVoice({ fallback: e.target.value as OracleVoice["fallback"] })}>
                        <option value="elevenlabs">Use the ElevenLabs voice below (labelled)</option>
                        <option value="none">Report the error, stay silent</option>
                      </select>
                    </label>
                  </>
                ) : null}
                {(provider === "elevenlabs" || (voice.fallback ?? "elevenlabs") === "elevenlabs") && (
                  <label>
                    <span className="lab">ElevenLabs voice{provider === "voicebox" ? " (backup)" : ""}</span>
                    <select value={voice.elevenVoiceId ?? ""} disabled={saving || !elevenVoices.length} onChange={(e) => patchVoice({ elevenVoiceId: e.target.value })}>
                      {voice.elevenVoiceId && !elevenVoices.some((v) => v.voice_id === voice.elevenVoiceId) && (
                        <option value={voice.elevenVoiceId}>{elevenVoices.length ? `${voice.elevenVoiceId} (not in your ElevenLabs list)` : voice.elevenVoiceId}</option>
                      )}
                      {elevenVoices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}
            <textarea
              className="orc-q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") consult(); }}
              placeholder="Ask for counsel — a decision to weigh, a direction to choose, what the year ahead may hold. Not lookups; wisdom."
              disabled={busy}
            />
            <div className="orc-row">
              <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} label="Voice" accent="#e6b866" />
              <span className="orc-hint">{MOD} + Enter</span>
              <button className="orc-ask-btn" onClick={consult} disabled={busy || !question.trim()}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {busy ? "Consulting…" : "Consult the Oracle"}
              </button>
            </div>
            {!answer && !busy && (
              <div className="orc-seeds">
                {["Should I go deep on one bet or keep several alive?",
                  "Where is agentic AI heading in the next two years?",
                  "I'm burning out on the grind — what am I missing?"].map((s) => (
                  <button key={s} className="orc-seed" onClick={() => setQuestion(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>

          {/* CONTEMPLATION */}
          {busy && (
            <div className="orc-think">
              <div className="line">{CONTEMPLATIONS[statusIdx]}</div>
            </div>
          )}

          {err && <div className="orc-err"><X size={16} style={{ marginTop: 2 }} /><div>{err}</div></div>}

          {/* ANSWER */}
          {answer && !busy && (
            <div className="orc-answer" ref={answerRef}>
              <div className="cap"><ScrollText size={12} /> The Oracle speaks</div>
              {askedShown && <p className="orc-asked">“{askedShown}”</p>}
              <div className="orc-prose">
                {body.split(/\n+/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
              </div>
              {aphorism && <div className="orc-aphorism">{aphorism}</div>}
              <div className="orc-foot">
                {answeredAt && <span className="when"><Clock size={11} /> {ago(answeredAt)}</span>}
                <button className="speak" onClick={() => (tts === "playing" ? stopSpeak() : speak(answer || ""))} disabled={tts === "loading"}>
                  {tts === "loading" ? <Loader2 size={12} className="animate-spin" /> : tts === "playing" ? <Square size={12} /> : <Volume2 size={12} />}
                  {tts === "loading" ? "Summoning voice…" : tts === "playing" ? "Stop" : "Read aloud"}
                </button>
                {spokeVia && <span className="via" title="The voice you chose failed; the backup you allowed spoke instead.">{spokeVia}</span>}
                <button className="again" onClick={() => { stopSpeak(); setAnswer(null); setErr(null); setQuestion(""); }}>Ask again</button>
              </div>
            </div>
          )}
        </div>

        {/* HISTORY */}
        <div className="orc-hist">
          <h4><ScrollText size={12} /> Past counsel</h4>
          {history.length === 0 ? (
            <div className="orc-hist-empty">Your consultations are kept here — ask the Oracle and its counsel is remembered.</div>
          ) : history.map((c, i) => (
            <button key={`${c.at}-${i}`} className="orc-hist-item" onClick={() => recall(c)}>
              <div className="q">{c.question}</div>
              <div className="m">{ago(c.at)} · {c.agent}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
