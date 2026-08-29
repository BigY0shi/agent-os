"use client";

// ── AnyNotesSettings (SPEC-F I3.4, rule 16) ─────────────────────────────────
// EVERY AnyNotes knob lives here — exactly the four keys chunk 1 declared in
// Settings + DEFAULT_SETTINGS: settings.anynotes.{autoIngest, jarvisAgent,
// defaultStatus, maxSnapshotChars}. All four are read at request time server
// side, so a change applies to the next capture/reply with no restart.

import { useEffect, useState } from "react";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import AgentPicker from "@/components/AgentPicker";
import { NOTE_STATUSES } from "@/lib/v2/anynotes/types";
import { ANYNOTES_ACCENT } from "./shared";

interface AnynotesSettings {
  autoIngest?: boolean;
  jarvisAgent?: string;
  defaultStatus?: "inbox" | "kept" | "archived";
  maxSnapshotChars?: number;
}

export default function AnyNotesSettings() {
  const { settings, saving, save } = useSettings();
  const anynotes = (settings?.anynotes ?? {}) as AnynotesSettings;

  const [charsDraft, setCharsDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings && charsDraft === null) setCharsDraft(String(anynotes.maxSnapshotChars ?? 24000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const autoIngest = anynotes.autoIngest !== false;

  async function saveAll() {
    const maxSnapshotChars = Math.min(
      Math.max(parseInt(charsDraft ?? "24000", 10) || 24000, 500),
      200_000,
    );
    await save({ anynotes: { ...anynotes, maxSnapshotChars } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-1">
      <Field
        label="Ingest captures into Memory"
        hint="ON: every capture (and every finished @jarvis exchange) is queued into Memory V2 with the 'anynotes' + type labels, so Jarvis can recall 'that tweet about X'. OFF: nothing is queued — notes stay local to this page."
      >
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim, #9aa)" }}>
          <input
            type="checkbox"
            checked={autoIngest}
            disabled={!settings}
            onChange={(e) => void save({ anynotes: { ...anynotes, autoIngest: e.target.checked } })}
            style={{ accentColor: ANYNOTES_ACCENT }}
          />
          Queue captures + exchanges into Memory V2
        </label>
      </Field>

      <Field
        label="Jarvis agent"
        hint="Which CLI agent answers @jarvis replies, routed through cliComplete. There is no fallback: if this agent fails, the thread shows its error in red (rule 11)."
      >
        <AgentPicker
          value={anynotes.jarvisAgent ?? "claude"}
          onChange={(id) => void save({ anynotes: { ...anynotes, jarvisAgent: id } })}
          accent={ANYNOTES_ACCENT}
        />
      </Field>

      <Field label="Default status for new captures" hint="Where a fresh capture lands. Inbox is the triage queue.">
        <select
          value={anynotes.defaultStatus ?? "inbox"}
          onChange={(e) =>
            void save({
              anynotes: { ...anynotes, defaultStatus: e.target.value as AnynotesSettings["defaultStatus"] },
            })
          }
          className="w-full bg-black/30 border rounded-lg px-2.5 h-9 text-[12.5px] outline-none"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}
        >
          {NOTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Max snapshot characters"
        hint="Cap on the stored article/tweet snapshot. Longer captures are truncated with a visible marker rather than silently cut. Default 24000."
      >
        <TextInput
          value={charsDraft ?? ""}
          onChange={(e) => setCharsDraft(e.target.value)}
          placeholder="24000"
          inputMode="numeric"
        />
      </Field>

      <SaveBar saving={saving} saved={saved} onSave={() => void saveAll()} accent={ANYNOTES_ACCENT} />
    </div>
  );
}
