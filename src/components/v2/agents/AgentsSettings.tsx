"use client";

// F workstream gear (rule 16): EVERY configurable of the Agents page lives
// here — settings.agentsPage.{heroPollMs, defaultHarness} and the CONVENTIONS
// §11 deploy gate settings.agents.requireTestRun (ASK-YOSHI: hard-vs-warning
// default; shipped default is HARD = true, flip off for warning-only mode).

import { useEffect, useState } from "react";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import { AGENTS_ACCENT } from "./shared";
import { FACE_DETAILS, FACE_DETAIL_LABEL, normalizeFaceDetail } from "@/lib/agentFaces";
import { refreshAgentFaces } from "@/lib/agentFacesClient";

export default function AgentsSettings() {
  const { settings, saving, save } = useSettings();
  const agentsPage = (settings?.agentsPage ?? {}) as { heroPollMs?: number; defaultHarness?: string };
  const agents = (settings?.agents ?? {}) as {
    requireTestRun?: boolean;
    askUser?: { enabled?: boolean; heuristic?: boolean; timeoutMin?: number };
    spendCap?: { enabled?: boolean; maxUsd?: number; maxTokens?: number };
    faces?: { detail?: string; seeds?: Record<string, number | null> };
  };
  const askUser = agents.askUser ?? {};
  const faceDetail = normalizeFaceDetail(agents.faces?.detail);
  const spendCap = agents.spendCap ?? {};
  const capOn = spendCap.enabled !== false;

  const [pollDraft, setPollDraft] = useState<string | null>(null);
  const [askDraft, setAskDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [harnesses, setHarnesses] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (settings && pollDraft === null) setPollDraft(String(agentsPage.heroPollMs ?? 4000));
    if (settings && askDraft === null) setAskDraft(String(askUser.timeoutMin ?? 240));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  useEffect(() => {
    fetch("/api/v2/harnesses", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (Array.isArray(j.harnesses)) setHarnesses(j.harnesses); })
      .catch(() => { /* offline */ });
  }, []);

  const requireTestRun = agents.requireTestRun !== false;

  async function saveAll() {
    const heroPollMs = Math.max(parseInt(pollDraft ?? "4000", 10) || 4000, 1000);
    const timeoutMin = Math.max(parseInt(askDraft ?? "240", 10) || 240, 1);
    await save({
      agentsPage: { ...agentsPage, heroPollMs },
      agents: { ...agents, askUser: { ...askUser, timeoutMin } },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-4">
      <Field label="Hero poll interval (ms)" hint="Fallback polling cadence when the live SSE status feed drops. Default 4000.">
        <TextInput value={pollDraft ?? ""} onChange={(e) => setPollDraft(e.target.value)} placeholder="4000" inputMode="numeric" />
      </Field>

      <Field label="Default harness" hint="Preselected in the Forge wizard's Harness step.">
        <select
          value={agentsPage.defaultHarness ?? "oneshot-plain"}
          onChange={(e) => void save({ agentsPage: { ...agentsPage, defaultHarness: e.target.value } })}
          className="w-full bg-black/30 border rounded-lg px-2.5 h-9 text-[12.5px] outline-none"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}>
          {harnesses.length === 0 && <option value="oneshot-plain">oneshot-plain</option>}
          {harnesses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </Field>

      <Field label="Mark detail" hint="How busy every generated agent mark is (the Rorschach shapes on agents without a hand-drawn mark). Default medium. Each agent's New shape / Reset shape live on its own page.">
        <select
          value={faceDetail}
          onChange={(e) => { void save({ agents: { ...agents, faces: { ...(agents.faces ?? {}), detail: normalizeFaceDetail(e.target.value) } } }).then(() => refreshAgentFaces()); }}
          className="w-full bg-black/30 border rounded-lg px-2.5 h-9 text-[12.5px] outline-none"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}>
          {FACE_DETAILS.map((d) => <option key={d} value={d}>{FACE_DETAIL_LABEL[d]}</option>)}
        </select>
      </Field>

      <Field label="Deploy gate — require a test run"
        hint="ON: promoting to Deployed without a successful (done) run is blocked with a 409. OFF: the deploy succeeds but shows a warning banner. (CONVENTIONS §11 — flag for Yoshi: spec default is warning; current default is the hard gate.)">
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim)" }}>
          <input
            type="checkbox"
            checked={requireTestRun}
            onChange={(e) => void save({ agents: { ...agents, requireTestRun: e.target.checked } })}
          />
          Hard-block deploys until a test run finishes done
        </label>
      </Field>

      <Field label="Per-run spend ceiling"
        hint="Checked at every harness loop boundary, so a run that hits it STOPS holding the work it already produced instead of starting an iteration it cannot pay for. Iteration count was already capped at 50; this caps what those iterations are allowed to cost. Switch it off for a deliberately long-horizon run."
      >
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim)" }}>
          <input
            type="checkbox"
            checked={capOn}
            onChange={(e) => void save({ agents: { ...agents, spendCap: { ...spendCap, enabled: e.target.checked } } })}
          />
          Stop a run once it reaches the ceiling
        </label>
        <div className="mt-2 flex gap-2 items-center pl-5">
          <span className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>Dollars</span>
          <TextInput
            value={String(spendCap.maxUsd ?? 5)}
            disabled={!capOn}
            onChange={(v) => {
              const n = Number(v);
              if (Number.isFinite(n)) void save({ agents: { ...agents, spendCap: { ...spendCap, maxUsd: n } } });
            }}
          />
          <span className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>Tokens</span>
          <TextInput
            value={String(spendCap.maxTokens ?? 2000000)}
            disabled={!capOn}
            onChange={(v) => {
              const n = Number(v);
              if (Number.isFinite(n)) void save({ agents: { ...agents, spendCap: { ...spendCap, maxTokens: n } } });
            }}
          />
        </div>
        <p className="mt-1.5 pl-5 text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>
          Either at 0 leaves that one unbounded. Tokens count input, output and both cache buckets, because cache reads are billed too.
        </p>
      </Field>

      <Field label="Let a run ask you a question"
        hint="A background run has no chat window. With this on, every agent is told to emit [[ASK-USER]] when it needs a decision only you can make — the run parks amber, the question lands in the approvals strip, and your reply resumes the same session.">
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim)" }}>
          <input
            type="checkbox"
            checked={askUser.enabled !== false}
            onChange={(e) => void save({ agents: { ...agents, askUser: { ...askUser, enabled: e.target.checked } } })}
          />
          Park the run on the ASK-USER marker and wait for a reply
        </label>
      </Field>

      <Field label="Also park when a turn merely ends in a question mark"
        hint="OFF by default, and deliberately: agent reports often close on a rhetorical question, and a false positive parks a FINISHED run for hours instead of completing it. Turn on only for models that ignore the marker instruction."
      >
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim)" }}>
          <input
            type="checkbox"
            checked={askUser.heuristic === true}
            disabled={askUser.enabled === false}
            onChange={(e) => void save({ agents: { ...agents, askUser: { ...askUser, heuristic: e.target.checked } } })}
          />
          Punctuation fallback (last line ends in a question mark)
        </label>
      </Field>

      <Field label="Question timeout (minutes)"
        hint="How long a parked question waits for you before the run ends UNANSWERED (status error — never a silent 'done'). Default 240.">
        <TextInput
          value={askDraft ?? ""}
          onChange={(e) => setAskDraft(e.target.value)}
          placeholder="240"
          inputMode="numeric"
        />
      </Field>

      <SaveBar saving={saving} saved={saved} onSave={() => void saveAll()} accent={AGENTS_ACCENT} />
    </div>
  );
}
