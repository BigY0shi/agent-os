"use client";

// F workstream gear (rule 16): EVERY configurable of the Agents page lives
// here — settings.agentsPage.{heroPollMs, defaultHarness} and the CONVENTIONS
// §11 deploy gate settings.agents.requireTestRun (ASK-YOSHI: hard-vs-warning
// default; shipped default is HARD = true, flip off for warning-only mode).

import { useEffect, useState } from "react";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import { AGENTS_ACCENT } from "./shared";

export default function AgentsSettings() {
  const { settings, saving, save } = useSettings();
  const agentsPage = (settings?.agentsPage ?? {}) as { heroPollMs?: number; defaultHarness?: string };
  const agents = (settings?.agents ?? {}) as {
    requireTestRun?: boolean;
    askUser?: { enabled?: boolean; heuristic?: boolean; timeoutMin?: number };
  };
  const askUser = agents.askUser ?? {};

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
