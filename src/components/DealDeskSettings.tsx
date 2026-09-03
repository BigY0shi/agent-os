"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import { clampMaxAgeDays, DEFAULT_MAX_AGE_DAYS } from "@/lib/dealDeskControl";

const ACCENT = "#f59e0b";

// Deal Desk gear (S4, rule 16): every deals.* knob is edited here, never in a
// config file. The Upwork cookie has its own modal because it is a secret and
// lives in the Hermes profile .env, not in settings.json.
export default function DealDeskSettings({ onSaved }: { onSaved?: () => void } = {}) {
  const { settings, saving, save } = useSettings();
  const [maxAge, setMaxAge] = useState(String(DEFAULT_MAX_AGE_DAYS));
  const [screenModel, setScreenModel] = useState("");
  const [screenOnPull, setScreenOnPull] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const d = (settings as { deals?: { maxAgeDays?: number; screenModel?: string; screenOnPull?: boolean } }).deals || {};
    setMaxAge(String(clampMaxAgeDays(d.maxAgeDays)));
    setScreenModel(d.screenModel ?? "");
    setScreenOnPull(d.screenOnPull !== false);
  }, [settings]);

  async function onSave() {
    const maxAgeDays = clampMaxAgeDays(maxAge);
    setMaxAge(String(maxAgeDays));
    // An empty model box means "use the configured Claude model", so it is stored as
    // undefined rather than an empty string a caller would have to re-check.
    await save({ deals: { maxAgeDays, screenModel: screenModel.trim() || undefined, screenOnPull } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
    onSaved?.();
  }

  return (
    <ConfigMenu title="Deal Desk settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Gates on what reaches the board. The Upwork cookie is set from the cookie button next to this gear.
      </p>
      <Field label="Max listing age (days)"
        hint={`Listings posted longer ago than this are dropped when a scrape or a feed pull lands, and kept beside the file as <name>.dropped-<date>.json. Undated listings are kept. Default ${DEFAULT_MAX_AGE_DAYS}; 1 to 365.`}>
        <TextInput type="number" min={1} max={365} value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
      </Field>
      <Field label="Screen model"
        hint="Model for the quick pass/pursue check that runs over every unjudged lead. It is one short call per lead, so a cheap fast model is the point. Blank uses the configured Claude model.">
        <TextInput value={screenModel} onChange={(e) => setScreenModel(e.target.value)} placeholder="claude-haiku-4-5-20251001" />
      </Field>
      <Field label="Screen after a feed pull"
        hint="The brief pass only covers the top 20 by composite. With this on, everything it did not reach gets the quick check instead of sitting unjudged. Leads the check cannot judge stay NA.">
        <label className="flex items-center gap-2 text-[12px]" style={{ color: "var(--fg-dim, #9990a8)" }}>
          <input type="checkbox" checked={screenOnPull} onChange={(e) => setScreenOnPull(e.target.checked)} />
          Screen automatically
        </label>
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
