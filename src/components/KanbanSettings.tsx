"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import AgentPicker from "./AgentPicker";

const ACCENT = "#14b8a6";

// Kanban config — pick the default Hermes board the viewer opens on, and which CLI agent
// dispatches cards. No API key; the boards live in your local Hermes kanban DB.
export default function KanbanSettings() {
  const { settings, saving, save } = useSettings();
  const [board, setBoard] = useState("");
  const [agent, setAgent] = useState("claude");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const k = settings.kanban || {};
    setBoard(k.board || ""); setAgent(k.agent || "claude");
  }, [settings]);

  async function onSave() {
    await save({ kanban: { board: board.trim(), agent } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="Kanban settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Your local Hermes kanban boards. No API key.
      </p>
      <Field label="Default board" hint="The board slug the viewer opens on (blank = last viewed / default).">
        <TextInput placeholder="e.g. default" value={board} onChange={(e) => setBoard(e.target.value)} />
      </Field>
      <Field label="Dispatch agent" hint="Which CLI agent picks up dispatched cards.">
        <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} accent={ACCENT} />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
