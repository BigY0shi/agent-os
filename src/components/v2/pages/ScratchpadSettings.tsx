"use client";

import { useEffect, useState } from "react";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import { SCRATCHPAD_ACCENT } from "./shared";

// ── ScratchpadSettings (rule 16) — settings.scratchpad knobs, in-app ─────────

export default function ScratchpadSettings() {
  const { settings, saving, save } = useSettings();
  const [debounceSec, setDebounceSec] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const scratchpad = (settings?.scratchpad ?? {}) as { mentionDebounceSec?: number };

  useEffect(() => {
    if (!settings || debounceSec !== null) return;
    setDebounceSec(String(scratchpad.mentionDebounceSec ?? 8));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  async function saveAll() {
    if (debounceSec === null) return;
    const n = parseFloat(debounceSec);
    await save({
      scratchpad: {
        ...scratchpad,
        mentionDebounceSec: Number.isFinite(n) && n > 0 ? n : 8,
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div>
      <Field
        label="@jarvis reply debounce (seconds)"
        hint="How long Jarvis waits after you stop typing before answering an @jarvis note (default 8)."
      >
        <TextInput
          value={debounceSec ?? ""}
          onChange={(e) => setDebounceSec(e.target.value)}
          inputMode="decimal"
          placeholder="8"
        />
      </Field>
      <p className="text-[10.5px] leading-relaxed mb-3" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Timezone, empty-task GC and the execution knobs live in the Tasks gear
        (settings.tasks) — the scratchpad shares them.
      </p>
      <SaveBar saving={saving} saved={saved} onSave={() => void saveAll()} accent={SCRATCHPAD_ACCENT} />
    </div>
  );
}
