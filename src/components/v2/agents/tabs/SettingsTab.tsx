"use client";

// F5.3 Settings tab — the full AgentDef editor (existing fields + EVERY V2
// field, rule 16) posting to the existing PATCH route; danger zone = the
// existing exile path (house rule: never hard-delete). Persona is edited as a
// plain data record (rule 17 — model-agnostic, injected at draft time by
// renderPersonaBlock whatever the provider).

import { useEffect, useState } from "react";
import type { AgentDef, AgentPersona } from "@/lib/agentsTypes";
import { ModePicker, IntelPicker, TriggersEditor } from "@/components/AgentsView";
import { AGENTS_ACCENT } from "../shared";

export default function SettingsTab({
  agent,
  system,
  patch,
  onExile,
}: {
  agent: AgentDef;
  system: string;
  patch: (p: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; warning?: string }>;
  onExile: () => Promise<void> | void;
}) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [draft, setDraft] = useState(system);
  const [err, setErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const [harnesses, setHarnesses] = useState<{ id: string; name: string }[]>([]);
  const [availableSessions, setAvailableSessions] = useState<string[]>([]);

  // Persona draft state.
  const [usePersona, setUsePersona] = useState(!!agent.persona);
  const [persona, setPersona] = useState<AgentPersona>(
    agent.persona ?? { name: "", voiceRules: "", bannedPhrases: [] },
  );
  const [bannedDraft, setBannedDraft] = useState((agent.persona?.bannedPhrases ?? []).join("\n"));

  // Provider draft state.
  const [providerKind, setProviderKind] = useState<"sdk" | "cli" | "ollama">(agent.provider?.kind ?? "sdk");
  const [providerArg, setProviderArg] = useState(
    agent.provider?.kind === "cli" ? agent.provider.agent : agent.provider?.kind === "ollama" ? agent.provider.model : "",
  );

  useEffect(() => { setDraft(system); }, [system]);

  useEffect(() => {
    fetch("/api/v2/harnesses", { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (Array.isArray(j.harnesses)) setHarnesses(j.harnesses); }).catch(() => {});
    fetch("/api/v2/browser/sessions", { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (Array.isArray(j.sessions)) setAvailableSessions(j.sessions.map((s: { name: string }) => s.name)); }).catch(() => {});
  }, []);

  async function apply(p: Record<string, unknown>) {
    setErr(null);
    const res = await patch(p);
    if (!res.ok) setErr(res.error ?? "save failed");
    else { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1200); }
  }

  async function savePersona() {
    if (!usePersona) { await apply({ persona: null }); return; }
    if (!persona.name.trim() || !persona.voiceRules.trim()) { setErr("persona needs a name and voice rules"); return; }
    await apply({
      persona: {
        ...persona,
        bannedPhrases: bannedDraft.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      },
    });
  }

  async function saveProvider() {
    if (providerKind === "sdk") { await apply({ provider: null }); return; }
    if (!providerArg.trim()) { setErr(providerKind === "cli" ? "cli provider needs an agent name" : "ollama provider needs a model"); return; }
    await apply({ provider: providerKind === "cli" ? { kind: "cli", agent: providerArg.trim() } : { kind: "ollama", model: providerArg.trim() } });
  }

  const sessions = agent.browserSessions ?? [];

  return (
    <div className="space-y-4">
      {err && <div className="text-[12px] text-rose-300">{err}</div>}
      {savedFlash && <div className="text-[12px] text-emerald-300">saved</div>}

      {/* Identity */}
      <div className="rounded-xl border p-3.5 space-y-2.5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--fg-dimmer)" }}>Identity</div>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== agent.name && void apply({ name })}
          className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[13px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== agent.description && void apply({ description })}
          placeholder="One-liner for the card"
          className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
        <div className="grid grid-cols-2 gap-3">
          <ModePicker value={agent.permissionMode} onChange={(m) => void apply({ permissionMode: m })} />
          <IntelPicker value={agent.intelligence} onChange={(m) => void apply({ intelligence: m })} />
        </div>
        <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: "var(--fg-dim)" }}>
          <input type="checkbox" checked={agent.enabled} onChange={(e) => void apply({ enabled: e.target.checked })} /> Enabled
        </label>
      </div>

      {/* Instructions */}
      <div className="rounded-xl border p-3.5 space-y-2" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--fg-dimmer)" }}>Instructions (system.md)</span>
          {draft !== system && (
            <button onClick={() => void apply({ instructions: draft })} className="text-[11px] text-emerald-300">Save</button>
          )}
        </div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8}
          className="w-full bg-black/30 border rounded-lg px-3 py-2 text-[12.5px] outline-none resize-y font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
      </div>

      {/* Harness */}
      <div className="rounded-xl border p-3.5 space-y-2" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--fg-dimmer)" }}>Harness</div>
        <select value={agent.harnessId ?? ""} onChange={(e) => void apply({ harnessId: e.target.value || null })}
          className="w-full bg-black/30 border rounded-lg px-2.5 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}>
          <option value="">none — plain single run</option>
          {harnesses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </div>

      {/* Persona (rule 17) */}
      <div className="rounded-xl border p-3.5 space-y-2" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--fg-dimmer)" }}>Writing persona</span>
          <button onClick={() => void savePersona()} className="text-[11px] text-emerald-300">Save persona</button>
        </div>
        <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: "var(--fg-dim)" }}>
          <input type="checkbox" checked={usePersona} onChange={(e) => setUsePersona(e.target.checked)} /> Use a persona
        </label>
        {usePersona && (
          <div className="space-y-2">
            <input value={persona.name} onChange={(e) => setPersona((p) => ({ ...p, name: e.target.value }))} placeholder="Persona name"
              className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
            <textarea value={persona.voiceRules} onChange={(e) => setPersona((p) => ({ ...p, voiceRules: e.target.value }))} rows={3} placeholder="Voice rules"
              className="w-full bg-black/30 border rounded-lg px-3 py-2 text-[12.5px] outline-none resize-y" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
            <input value={persona.audience ?? ""} onChange={(e) => setPersona((p) => ({ ...p, audience: e.target.value || undefined }))} placeholder="Audience (optional)"
              className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
            <textarea value={bannedDraft} onChange={(e) => setBannedDraft(e.target.value)} rows={2} placeholder="Banned phrases — one per line"
              className="w-full bg-black/30 border rounded-lg px-3 py-2 text-[12.5px] outline-none resize-y" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
            <input value={persona.ctaStyle ?? ""} onChange={(e) => setPersona((p) => ({ ...p, ctaStyle: e.target.value || undefined }))} placeholder="CTA style (optional)"
              className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
          </div>
        )}
      </div>

      {/* Provider (rule 11 — fail loudly, never silent fallback) */}
      <div className="rounded-xl border p-3.5 space-y-2" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--fg-dimmer)" }}>Provider</span>
          <button onClick={() => void saveProvider()} className="text-[11px] text-emerald-300">Save provider</button>
        </div>
        <div className="flex gap-1.5">
          {(["sdk", "cli", "ollama"] as const).map((k) => (
            <button key={k} onClick={() => setProviderKind(k)}
              className="flex-1 h-8 rounded-lg border text-[11.5px] font-mono"
              style={{ borderColor: providerKind === k ? AGENTS_ACCENT : "var(--panel-border)", color: providerKind === k ? AGENTS_ACCENT : "var(--fg-dim)" }}>
              {k}
            </button>
          ))}
        </div>
        {providerKind !== "sdk" && (
          <input value={providerArg} onChange={(e) => setProviderArg(e.target.value)}
            placeholder={providerKind === "cli" ? "CLI agent — e.g. claude, codex, agy" : "Ollama model — e.g. glm-5.2:cloud"}
            className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12px] outline-none font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
        )}
      </div>

      {/* Browser sessions (E3∩F3) */}
      <div className="rounded-xl border p-3.5 space-y-2" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--fg-dimmer)" }}>Browser sessions this agent may drive</div>
        {availableSessions.length === 0 ? (
          <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>No sessions configured — add them on /browser.</div>
        ) : (
          <div className="flex gap-1.5 flex-wrap">
            {availableSessions.map((s) => (
              <button key={s}
                onClick={() => void apply({ browserSessions: sessions.includes(s) ? sessions.filter((x) => x !== s) : [...sessions, s] })}
                className="px-2.5 h-7 rounded-md border text-[11px] font-mono"
                style={{ borderColor: sessions.includes(s) ? "#38bdf8" : "var(--panel-border)", color: sessions.includes(s) ? "#38bdf8" : "var(--fg-dim)" }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <TriggersEditor agent={agent} onSave={(triggers) => void apply({ triggers })} />

      {/* Danger zone — exile, never delete. */}
      <div className="rounded-xl border p-3.5" style={{ borderColor: "rgba(248,113,113,0.35)", background: "rgba(248,113,113,0.04)" }}>
        <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5 text-rose-300">Danger zone</div>
        <div className="text-[12px] mb-2" style={{ color: "var(--fg-dim)" }}>
          Exile moves the agent and its history to the exile folder — recoverable, never destroyed.
        </div>
        <button onClick={() => void onExile()} className="px-3 h-8 rounded-lg border text-[12px] text-rose-300"
          style={{ borderColor: "rgba(248,113,113,0.5)", background: "rgba(248,113,113,0.08)" }}>
          Exile agent
        </button>
      </div>
    </div>
  );
}
