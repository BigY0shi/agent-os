"use client";

// ── NewsletterSettings (SPEC-F K4.3, rule 16) ───────────────────────────────
// EVERY newsletter knob lives here — the thirteen settings.newsletter.* keys
// declared in Settings + DEFAULT_SETTINGS: syncEnabled, syncRrule,
// editionEnabled, editionTime, sections, dedupeThreshold, dedupeWindowDays,
// trackerHosts, parseAgent, lookbackDays, addyDomain, gmailAccountId,
// gmailLabel. All are read at request time server side — no restart.
//
// CREDENTIALS ARE NOT SETTINGS. addy.io and Gmail render as "configured ✓" or
// "not configured" with a PATH hint. There is no input for the addy key and no
// getter for it anywhere in the process (config.ts injects it inside its own
// fetch), so this gear could not render its value even if it tried.

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import AgentPicker from "@/components/AgentPicker";
import { NEWSLETTER_ACCENT } from "./shared";

interface NewsletterSettingsShape {
  syncEnabled?: boolean;
  syncRrule?: string;
  editionEnabled?: boolean;
  editionTime?: string;
  sections?: string[];
  dedupeThreshold?: number;
  dedupeWindowDays?: number;
  trackerHosts?: string[];
  parseAgent?: string;
  lookbackDays?: number;
  addyDomain?: string;
  gmailAccountId?: string;
  gmailLabel?: string;
}

export interface NewsletterSettingsProps {
  /** From GET /api/newsletter/subscriptions — booleans, never values. */
  addyConfigured?: boolean;
  gmailConfigured?: boolean;
  /** The config FILE path (safe to display; the key inside it is not). */
  configPath?: string;
}

function ConfiguredRow({
  label,
  ok,
  hint,
}: {
  label: string;
  ok: boolean;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2 text-[12px] py-1">
      <span
        className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full"
        style={{
          background: ok ? "rgba(77,157,224,0.16)" : "rgba(140,134,152,0.16)",
          color: ok ? NEWSLETTER_ACCENT : "#8c8698",
        }}
      >
        {ok ? <Check size={11} /> : <X size={11} />}
      </span>
      <span>
        <span style={{ color: "var(--fg, #e8e2f0)" }}>
          {label} {ok ? "configured ✓" : "not configured"}
        </span>
        <span className="block text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          {hint}
        </span>
      </span>
    </div>
  );
}

export default function NewsletterSettings({
  addyConfigured = false,
  gmailConfigured = false,
  configPath = "~/.agentic-os/newsletter/config.json",
}: NewsletterSettingsProps) {
  const { settings, saving, save } = useSettings();
  const nl = (settings?.newsletter ?? {}) as NewsletterSettingsShape;

  const [draft, setDraft] = useState<{
    syncRrule: string;
    editionTime: string;
    sections: string;
    dedupeThreshold: string;
    dedupeWindowDays: string;
    trackerHosts: string;
    lookbackDays: string;
    addyDomain: string;
    gmailAccountId: string;
    gmailLabel: string;
  } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings && draft === null) {
      setDraft({
        syncRrule: nl.syncRrule ?? "FREQ=MINUTELY;INTERVAL=30",
        editionTime: nl.editionTime ?? "06:30",
        sections: (nl.sections ?? []).join("\n"),
        dedupeThreshold: String(nl.dedupeThreshold ?? 0.86),
        dedupeWindowDays: String(nl.dedupeWindowDays ?? 3),
        trackerHosts: (nl.trackerHosts ?? []).join("\n"),
        lookbackDays: String(nl.lookbackDays ?? 1),
        addyDomain: nl.addyDomain ?? "",
        gmailAccountId: nl.gmailAccountId ?? "",
        gmailLabel: nl.gmailLabel ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const syncEnabled = nl.syncEnabled !== false;
  const editionEnabled = nl.editionEnabled !== false;

  function lines(raw: string): string[] {
    return raw
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function saveAll() {
    if (!draft) return;
    const threshold = Number(draft.dedupeThreshold);
    const windowDays = parseInt(draft.dedupeWindowDays, 10);
    const lookback = parseInt(draft.lookbackDays, 10);
    await save({
      newsletter: {
        ...nl,
        syncRrule: draft.syncRrule.trim() || "FREQ=MINUTELY;INTERVAL=30",
        editionTime: draft.editionTime.trim() || "06:30",
        sections: lines(draft.sections),
        dedupeThreshold:
          Number.isFinite(threshold) && threshold > 0 && threshold <= 1 ? threshold : 0.86,
        dedupeWindowDays: Number.isFinite(windowDays) ? Math.min(Math.max(windowDays, 0), 90) : 3,
        trackerHosts: lines(draft.trackerHosts),
        lookbackDays: Number.isFinite(lookback) ? Math.min(Math.max(lookback, 1), 90) : 1,
        addyDomain: draft.addyDomain.trim(),
        gmailAccountId: draft.gmailAccountId.trim(),
        gmailLabel: draft.gmailLabel.trim(),
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-1">
      <Field
        label="Credentials"
        hint="Read-only status. The addy.io key lives in the config file below and is never rendered, logged or returned by any route — there is no getter for it in the process. Gmail rides the shared connector (CONVENTIONS §7), so you connect it on /integrations, not here."
      >
        <div>
          <ConfiguredRow
            label="addy.io"
            ok={addyConfigured}
            hint={addyConfigured ? configPath : `add your addy.io key under "addyio" in ${configPath}`}
          />
          <ConfiguredRow
            label="Gmail"
            ok={gmailConfigured}
            hint={
              gmailConfigured
                ? "an active Gmail account is connected on /integrations"
                : "connect the agent Gmail account on /integrations"
            }
          />
        </div>
      </Field>

      <Field
        label="Scheduled Gmail sync"
        hint="OFF pauses the SCHEDULED sync only — the Sync now button always runs."
      >
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim, #9aa)" }}>
          <input
            type="checkbox"
            checked={syncEnabled}
            disabled={!settings}
            onChange={(e) => void save({ newsletter: { ...nl, syncEnabled: e.target.checked } })}
            style={{ accentColor: NEWSLETTER_ACCENT }}
          />
          Poll Gmail on the schedule below
        </label>
      </Field>

      <Field
        label="Sync schedule (RRULE)"
        hint="Default FREQ=MINUTELY;INTERVAL=30. An unparseable rule is logged loudly and falls back to the default — it never silently stops syncing."
      >
        <TextInput
          value={draft?.syncRrule ?? ""}
          onChange={(e) => setDraft((d) => (d ? { ...d, syncRrule: e.target.value } : d))}
          placeholder="FREQ=MINUTELY;INTERVAL=30"
        />
      </Field>

      <Field label="Scheduled daily edition" hint="OFF pauses the daily build only — Rebuild on the Today tab always runs.">
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim, #9aa)" }}>
          <input
            type="checkbox"
            checked={editionEnabled}
            disabled={!settings}
            onChange={(e) => void save({ newsletter: { ...nl, editionEnabled: e.target.checked } })}
            style={{ accentColor: NEWSLETTER_ACCENT }}
          />
          Build the edition every day
        </label>
      </Field>

      <Field label="Edition time (HH:MM local)" hint="When the daily edition is compiled. Default 06:30. A malformed value is logged loudly and falls back to the default.">
        <TextInput
          value={draft?.editionTime ?? ""}
          onChange={(e) => setDraft((d) => (d ? { ...d, editionTime: e.target.value } : d))}
          placeholder="06:30"
        />
      </Field>

      <Field
        label="Sections (one per line)"
        hint="The newspaper's sections, in order. Stories are classified into these names; anything unclassifiable lands in 'Everything Else', which is always appended."
      >
        <textarea
          value={draft?.sections ?? ""}
          onChange={(e) => setDraft((d) => (d ? { ...d, sections: e.target.value } : d))}
          rows={5}
          className="w-full bg-black/30 border rounded-lg px-2.5 py-2 text-[12.5px] outline-none font-mono"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}
          placeholder={"AI & Agents\nDev & Tools\nBusiness\nSecurity\nEverything Else"}
        />
      </Field>

      <Field
        label="Story extraction / sectioning agent"
        hint="Routed through cliComplete (rule 11). There is no fallback: if this agent fails, the email is marked failed with its error, and the edition says it was sectioned by fallback."
      >
        <AgentPicker
          value={nl.parseAgent ?? "claude"}
          onChange={(id) => void save({ newsletter: { ...nl, parseAgent: id } })}
          accent={NEWSLETTER_ACCENT}
        />
      </Field>

      <Field
        label="Dedupe threshold (0-1)"
        hint="Embedding cosine floor above which two stories are the same story. Default 0.86. With the embedder down, dedupe degrades to canonical-URL only and the sync result says so."
      >
        <TextInput
          value={draft?.dedupeThreshold ?? ""}
          onChange={(e) => setDraft((d) => (d ? { ...d, dedupeThreshold: e.target.value } : d))}
          placeholder="0.86"
          inputMode="decimal"
        />
      </Field>

      <Field label="Dedupe window (days)" hint="How far back the candidate scan looks. Default 3 — bounded on purpose, so the brute-force cosine stays cheap.">
        <TextInput
          value={draft?.dedupeWindowDays ?? ""}
          onChange={(e) => setDraft((d) => (d ? { ...d, dedupeWindowDays: e.target.value } : d))}
          placeholder="3"
          inputMode="numeric"
        />
      </Field>

      <Field
        label="Tracker hosts (one per line)"
        hint="Redirect wrappers whose real destination sits in a url/u/href param. Leave empty to use the built-in list (beehiiv, TLDR, ConvertKit, Substack, AWeber, Klaviyo)."
      >
        <textarea
          value={draft?.trackerHosts ?? ""}
          onChange={(e) => setDraft((d) => (d ? { ...d, trackerHosts: e.target.value } : d))}
          rows={3}
          className="w-full bg-black/30 border rounded-lg px-2.5 py-2 text-[12.5px] outline-none font-mono"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}
          placeholder="link.mail.beehiiv.com"
        />
      </Field>

      <Field label="First-sync lookback (days)" hint="How far back the very first sync reaches when there is no watermark yet. Default 1.">
        <TextInput
          value={draft?.lookbackDays ?? ""}
          onChange={(e) => setDraft((d) => (d ? { ...d, lookbackDays: e.target.value } : d))}
          placeholder="1"
          inputMode="numeric"
        />
      </Field>

      <Field label="addy.io alias domain" hint="e.g. yoshi.addy.io — used as the new-alias domain and as the display hint. Not a secret.">
        <TextInput
          value={draft?.addyDomain ?? ""}
          onChange={(e) => setDraft((d) => (d ? { ...d, addyDomain: e.target.value } : d))}
          placeholder="yoshi.addy.io"
        />
      </Field>

      <Field
        label="Gmail account id (optional)"
        hint="Pin which connected Gmail account the newsletter syncs from. Leave empty to use the single active one — with several connected and none pinned, sync refuses rather than guessing."
      >
        <TextInput
          value={draft?.gmailAccountId ?? ""}
          onChange={(e) => setDraft((d) => (d ? { ...d, gmailAccountId: e.target.value } : d))}
          placeholder="(the only active gmail account)"
        />
      </Field>

      <Field
        label="Gmail label (optional)"
        hint="Catches mail arriving at an alias this app does not know about: make a Gmail filter that labels everything sent to your addy domain, then name that label here. Gmail has no wildcard address search, so this is the only way."
      >
        <TextInput
          value={draft?.gmailLabel ?? ""}
          onChange={(e) => setDraft((d) => (d ? { ...d, gmailLabel: e.target.value } : d))}
          placeholder="newsletters"
        />
      </Field>

      <SaveBar saving={saving} saved={saved} onSave={() => void saveAll()} accent={NEWSLETTER_ACCENT} />
    </div>
  );
}
