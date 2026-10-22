"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import type { RoomAgentOverride } from "@/lib/settings";

const ACCENT = "#f2b441";
const selectStyle = { background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)" };
const clamp = (n: number, lo: number, hi: number, d: number) => (Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, Math.round(n))) : d);

interface Roster { id: string; name: string; color: string; provider: string; model: string }
type Draft = { provider: string; model: string; baseUrl: string; apiKeyEnv: string; noReasoning: boolean };
const empty = (): Draft => ({ provider: "", model: "", baseUrl: "", apiKeyEnv: "", noReasoning: false });

// Room settings (S30; owner 2026-09-30: "every parameter needs to be in the settings").
// Per agent: provider (its own default, a CLI, Ollama Cloud, or an OpenAI-compatible endpoint
// with its base URL and the NAME of the env var holding the key; the key itself never lives in
// settings), the model (blank = the agent's own; "auto" on Ollama picks by task), and
// noReasoning for snappy chat models. Plus the CLI reply time limit. Saved to settings.room
// and read per turn by lib/agentRoom.ts. ~/.agentic-os/config.json "roomAgents" is only used
// while nothing is saved here; the note says which source is in force.
export default function RoomSettings({ overrideSource }: { overrideSource?: string }) {
  const { settings, saving, save } = useSettings();
  const [roster, setRoster] = useState<Roster[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [cliSec, setCliSec] = useState("90");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/room", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (Array.isArray(j?.agents)) setRoster(j.agents); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!settings) return;
    const room = (settings.room || {}) as { agents?: Record<string, RoomAgentOverride>; cliTimeoutSec?: number };
    const next: Record<string, Draft> = {};
    for (const [id, o] of Object.entries(room.agents || {})) {
      if (!o || typeof o !== "object") continue;
      next[id] = { provider: o.provider || "", model: o.model || "", baseUrl: o.baseUrl || "", apiKeyEnv: o.apiKeyEnv || "", noReasoning: !!o.noReasoning };
    }
    setDrafts(next);
    setCliSec(String(room.cliTimeoutSec ?? 90));
  }, [settings]);

  const draftOf = (id: string): Draft => drafts[id] ?? empty();
  const set = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...draftOf(id), ...patch } }));

  async function onSave() {
    // Every roster agent is sent (an untouched one as {}) so a cleared field really clears:
    // the server deep-merges objects, so omitting a key would keep its old value.
    const agents: Record<string, RoomAgentOverride> = {};
    for (const a of roster) {
      const d = draftOf(a.id);
      const o: RoomAgentOverride = {};
      if (d.provider === "cli" || d.provider === "ollama" || d.provider === "openai") o.provider = d.provider;
      if (d.model.trim()) o.model = d.model.trim();
      if (d.baseUrl.trim()) o.baseUrl = d.baseUrl.trim();
      if (d.apiKeyEnv.trim()) o.apiKeyEnv = d.apiKeyEnv.trim();
      if (d.noReasoning) o.noReasoning = true;
      agents[a.id] = o;
    }
    // A key that was saved before but is not on the roster any more is cleared too.
    for (const id of Object.keys(drafts)) if (!(id in agents)) agents[id] = {};
    await save({ room: { agents, cliTimeoutSec: clamp(Number(cliSec), 15, 900, 90) } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="Room settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-3" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Repoint any agent: keep its own provider, or run it on a CLI, on Ollama Cloud, or on an OpenAI-compatible endpoint. Blank = the agent&apos;s own default. Applies to the next turn.
      </p>
      {overrideSource === "config.json" && (
        <p role="status" className="text-[11px] mb-3 rounded-md px-2.5 py-2" style={{ border: `1px solid ${ACCENT}66`, color: "var(--fg, #e8e2f0)" }}>
          In force now: <span className="mono">roomAgents</span> from <span className="mono">~/.agentic-os/config.json</span> (the older home of these overrides). Saving anything here replaces it entirely.
        </p>
      )}
      <Field label="CLI reply time limit (seconds)" hint="How long a CLI agent (Claude, Codex, Cursor, Pi, Hermes, Antigravity) may take per room turn. 15 to 900; default 90.">
        <TextInput type="number" min={15} max={900} value={cliSec} onChange={(e) => setCliSec(e.target.value)} />
      </Field>
      {roster.length === 0 && <p className="text-[11px] mb-3" style={{ color: "var(--fg-dimmer, #6b6478)" }}>Loading the roster…</p>}
      {roster.map((a) => {
        const d = draftOf(a.id);
        const prov = d.provider || a.provider;
        return (
          <fieldset key={a.id} className="mb-4 rounded-lg px-3 py-2.5" style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
            <legend className="px-1 text-[12px] font-semibold" style={{ color: a.color }}>{a.name} <span className="font-normal" style={{ color: "var(--fg-dimmer, #6b6478)" }}>(own default: {a.provider}{a.model ? `, ${a.model}` : ""})</span></legend>
            <Field label="Provider">
              <select value={d.provider} onChange={(e) => set(a.id, { provider: e.target.value })} aria-label={`${a.name} provider`} className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none" style={selectStyle}>
                <option value="">Own default ({a.provider})</option>
                <option value="cli">CLI (its own CLI, your subscription)</option>
                <option value="ollama">Ollama Cloud</option>
                <option value="openai">OpenAI-compatible endpoint</option>
              </select>
            </Field>
            <Field label="Model" hint={prov === "ollama" ? "An Ollama Cloud model tag, or auto (picked by the task from your account's models)." : prov === "openai" ? "The model id the endpoint expects." : "Blank: the CLI picks its own model."}>
              <TextInput value={d.model} placeholder={a.model || "blank = own default"} onChange={(e) => set(a.id, { model: e.target.value })} aria-label={`${a.name} model`} />
            </Field>
            {prov === "openai" && (
              <>
                <Field label="Base URL" hint="Any /chat/completions server: z.ai, Sakana, LM Studio, vLLM. Blank = https://api.openai.com/v1.">
                  <TextInput value={d.baseUrl} placeholder="https://api.openai.com/v1" onChange={(e) => set(a.id, { baseUrl: e.target.value })} aria-label={`${a.name} base URL`} />
                </Field>
                <Field label="API key env var" hint="The NAME of the environment variable (or Hermes profile .env entry) holding the key. The key itself is never stored here. Blank = OPENAI_API_KEY.">
                  <TextInput value={d.apiKeyEnv} placeholder="OPENAI_API_KEY" onChange={(e) => set(a.id, { apiKeyEnv: e.target.value })} aria-label={`${a.name} API key env var`} />
                </Field>
                <label className="flex items-center gap-2 mb-3 text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }}>
                  <input type="checkbox" checked={d.noReasoning} onChange={(e) => set(a.id, { noReasoning: e.target.checked })} aria-label={`${a.name} no reasoning`} />
                  Skip hidden reasoning (short chat replies from a reasoning model)
                </label>
              </>
            )}
          </fieldset>
        );
      })}
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
