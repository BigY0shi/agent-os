"use client";

// SPEC-C D3 — WebMCP settings gear (rule 16: every knob has an in-app gear).
// Rendered as ConfigMenu children. Maps to settings.webmcp via the standard
// PATCH /api/settings deep-merge. Toggles persist immediately; the number
// field saves via the SaveBar (MemorySettings idiom).

import { useEffect, useState } from "react";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import { WEBMCP_ACCENT } from "./shared";

export default function WebmcpSettings() {
  const { settings, saving, save } = useSettings();
  const [timeoutDraft, setTimeoutDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const webmcp = (settings?.webmcp ?? {}) as { sandboxTimeoutMs?: number; allowJsHandlers?: boolean };
  const allowJs = webmcp.allowJsHandlers !== false;

  useEffect(() => {
    if (settings && timeoutDraft === null) {
      setTimeoutDraft(String(webmcp.sandboxTimeoutMs ?? 5000));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const saveTimeout = async () => {
    const n = Number(timeoutDraft);
    const sandboxTimeoutMs = Number.isFinite(n) && n >= 250 ? Math.round(n) : 5000;
    setTimeoutDraft(String(sandboxTimeoutMs));
    await save({ webmcp: { ...webmcp, sandboxTimeoutMs } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <div>
      <Field
        label="JS sandbox timeout (ms)"
        hint="Wall-clock cap for 'js' handler runs (node:vm). Default 5000."
      >
        <TextInput
          value={timeoutDraft ?? ""}
          onChange={(e) => setTimeoutDraft(e.target.value)}
          inputMode="numeric"
          placeholder="5000"
        />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={saveTimeout} accent={WEBMCP_ACCENT} />

      <label className="mt-4 flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allowJs}
          onChange={(e) => save({ webmcp: { ...webmcp, allowJsHandlers: e.target.checked } })}
          className="mt-[2px]"
          style={{ accentColor: WEBMCP_ACCENT }}
        />
        <span>
          <span className="block text-[12px] font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>
            Allow JS handlers
          </span>
          <span className="block text-[10.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Gates creation of &apos;js&apos;-kind tools. The sandbox is crash/timeout isolation only — NOT a
            security boundary; code runs with server privileges on this single-user box.
          </span>
        </span>
      </label>
    </div>
  );
}
