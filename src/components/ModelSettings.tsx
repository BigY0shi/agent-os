"use client";

// Shared "model dials" settings menu for the 2026-07 modules (Brainstorm,
// Jarvis, Content Engine, Agents, Hire Engine). Each module drops this into its
// header with its settings section + field list; values live in
// ~/.agentic-os/settings.json via /api/settings and are read at REQUEST time —
// changing a model here applies to the next call, no rebuild, no restart.
//
// S30: a field key may be dotted ("voice.geminiLiveModel") to reach a nested object inside
// the section, and `type: "number"` saves a number (blank = the module default).

import { useEffect, useState } from "react";
import ConfigMenu, { Field, TextInput, SaveBar, useSettings } from "./ConfigMenu";

export interface ModelFieldDef {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  /** "number" saves Number(value) (blank saves nothing, so the default applies); default text. */
  type?: "text" | "number";
}

const getPath = (obj: unknown, p: string[]): unknown =>
  p.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
function setPath(target: Record<string, unknown>, p: string[], v: unknown): void {
  let o = target;
  for (let i = 0; i < p.length - 1; i++) {
    const k = p[i];
    if (!o[k] || typeof o[k] !== "object") o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[p[p.length - 1]] = v;
}

export default function ModelSettings({ section, title, accent, fields, buttonLabel = "Models" }: {
  /** Top-level key in settings.json this menu edits (e.g. "brainstorm"). */
  section: string;
  title: string;
  accent: string;
  fields: ModelFieldDef[];
  buttonLabel?: string;
}) {
  const { settings, saving, save } = useSettings();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const sec = (settings[section] ?? {}) as Record<string, unknown>;
    setVals(Object.fromEntries(fields.map((f) => [f.key, String(getPath(sec, f.key.split(".")) ?? "")])));
    // `fields` is a stable module-level const in every caller.
  }, [settings, section]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSave() {
    const patch: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = (vals[f.key] ?? "").trim();
      const v = f.type === "number" ? (raw === "" ? undefined : Number(raw)) : vals[f.key] ?? "";
      if (f.type === "number" && v !== undefined && !Number.isFinite(v as number)) continue;
      setPath(patch, f.key.split("."), v);
    }
    await save({ [section]: patch });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <ConfigMenu title={title} accent={accent} buttonLabel={buttonLabel}>
      {fields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          <TextInput
            type={f.type === "number" ? "number" : "text"}
            value={vals[f.key] ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        </Field>
      ))}
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={accent} />
      <p className="text-[10.5px] mt-3 leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Takes effect on the next call — no rebuild or restart. Blank fields fall back to the module default.
      </p>
    </ConfigMenu>
  );
}
