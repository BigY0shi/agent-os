"use client";

// ── SubscriptionManager (SPEC-F K2.1) ───────────────────────────────────────
// The directory table + the "subscribe with alias" flow: create the addy alias,
// show it, copy it, then open the newsletter's signup page in a new tab.
//
// Honesty rules held here: "last seen" comes from newsletter_emails and shows
// "—" when no mail has arrived (never a fabricated date), and an addy failure
// is rendered VERBATIM — a 502 from addy means the alias does not exist, which
// is the difference between a working subscription and a black hole.

import { useState } from "react";
import { Check, Copy, ExternalLink, Mail, Plus } from "lucide-react";
import type { Cadence, Subscription } from "@/lib/v2/newsletter/types";
import { CADENCES } from "@/lib/v2/newsletter/types";
import { EmptyState, StatusChip, fmtDate, inputStyle, panelStyle } from "../integrations/shared";
import { NEWSLETTER_ACCENT, SUBSCRIPTION_STATUS_COLORS } from "./shared";

export interface SubscriptionManagerProps {
  subscriptions: Subscription[] | null;
  lastEmailAt: Record<string, string | null>;
  addyConfigured: boolean;
  configPath: string;
  onChanged: () => void;
}

export default function SubscriptionManager({
  subscriptions,
  lastEmailAt,
  addyConfigured,
  configPath,
  onChanged,
}: SubscriptionManagerProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [signupUrl, setSignupUrl] = useState("");
  const [cadence, setCadence] = useState<Cadence>("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Subscription | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
    } catch {
      /* clipboard denied — the address is on screen either way */
    }
  }

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/newsletter/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          topic: topic.trim() || undefined,
          signupUrl: signupUrl.trim() || undefined,
          cadence,
        }),
      });
      const j = (await res.json()) as { subscription?: Subscription; error?: string };
      if (!res.ok || !j.subscription) {
        // Verbatim: "addy.io: 401 …" tells you exactly what to fix.
        setError(j.error ?? `subscribe failed (${res.status})`);
        return;
      }
      setCreated(j.subscription);
      if (j.subscription.aliasEmail) void copy(j.subscription.aliasEmail);
      setName("");
      setTopic("");
      setSignupUrl("");
      setCadence("unknown");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/newsletter/subscriptions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? `update failed (${res.status})`);
    }
    onChanged();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12px]" style={{ color: "var(--fg-dim, #9aa)" }}>
          Each newsletter gets its own addy.io alias, so you can pause one without touching the rest.
        </div>
        <button
          onClick={() => {
            setOpen((o) => !o);
            setCreated(null);
            setError(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[12px] transition"
          style={{
            border: `1px solid ${NEWSLETTER_ACCENT}55`,
            color: NEWSLETTER_ACCENT,
            background: open ? `${NEWSLETTER_ACCENT}14` : "transparent",
          }}
        >
          <Plus size={13} /> Subscribe
        </button>
      </div>

      {open && (
        <div className="mb-4 rounded-xl p-3" style={panelStyle}>
          {!addyConfigured && (
            <div className="mb-2 text-[11.5px]" style={{ color: "#f87171" }}>
              addy.io is not configured — add your addy.io key under{" "}
              <span className="font-mono">addyio</span> in{" "}
              <span className="font-mono">{configPath}</span>. Creating an alias will fail until you do.
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Newsletter name (e.g. TLDR)"
              className="rounded-md px-2 h-8 text-[12px] outline-none"
              style={inputStyle}
            />
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic (drives the section fallback)"
              className="rounded-md px-2 h-8 text-[12px] outline-none"
              style={inputStyle}
            />
            <input
              value={signupUrl}
              onChange={(e) => setSignupUrl(e.target.value)}
              placeholder="Signup URL (https://…)"
              className="rounded-md px-2 h-8 text-[12px] outline-none"
              style={inputStyle}
            />
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as Cadence)}
              className="rounded-md px-2 h-8 text-[12px] outline-none"
              style={inputStyle}
              aria-label="Cadence"
            >
              {CADENCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => void submit()}
              disabled={busy || !name.trim()}
              className="rounded-lg px-3 h-8 text-[12px] transition disabled:opacity-40"
              style={{ border: `1px solid ${NEWSLETTER_ACCENT}55`, color: NEWSLETTER_ACCENT }}
            >
              {busy ? "Creating alias…" : "Create alias"}
            </button>
            {error && (
              <span className="text-[11.5px]" style={{ color: "#f87171" }}>
                {error}
              </span>
            )}
          </div>

          {created && (
            <div
              className="mt-3 rounded-lg px-3 py-2"
              style={{ border: `1px solid ${NEWSLETTER_ACCENT}44`, background: `${NEWSLETTER_ACCENT}0f` }}
            >
              <div className="text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }}>
                Alias created for <strong>{created.name}</strong> — sign up with this address:
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12.5px]" style={{ color: NEWSLETTER_ACCENT }}>
                  {created.aliasEmail}
                </span>
                <button
                  onClick={() => created.aliasEmail && void copy(created.aliasEmail)}
                  className="inline-flex items-center gap-1 rounded-md px-2 h-7 text-[11px]"
                  style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
                >
                  {copied === created.aliasEmail ? <Check size={11} /> : <Copy size={11} />}
                  {copied === created.aliasEmail ? "copied" : "copy"}
                </button>
                {created.signupUrl && (
                  <a
                    href={created.signupUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md px-2 h-7 text-[11px]"
                    style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
                  >
                    <ExternalLink size={11} /> Open signup
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {subscriptions === null ? (
        <div className="font-mono text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          loading…
        </div>
      ) : subscriptions.length === 0 ? (
        <EmptyState
          icon={<Mail size={20} />}
          title="No subscriptions yet"
          hint="Subscribe above: the alias is created on addy.io, copied to your clipboard, and used to sign up. Mail sent to it lands in the daily edition."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl" style={panelStyle}>
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                <th className="px-3 py-2 text-left font-normal">Newsletter</th>
                <th className="px-3 py-2 text-left font-normal">Alias</th>
                <th className="px-3 py-2 text-left font-normal">Topic</th>
                <th className="px-3 py-2 text-left font-normal">Cadence</th>
                <th className="px-3 py-2 text-left font-normal">Last seen</th>
                <th className="px-3 py-2 text-left font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid var(--panel-border, #2a2436)" }}>
                  <td className="px-3 py-2" style={{ color: "var(--fg, #e8e2f0)" }}>
                    {s.signupUrl ? (
                      <a href={s.signupUrl} target="_blank" rel="noreferrer" className="hover:underline">
                        {s.name}
                      </a>
                    ) : (
                      s.name
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {s.aliasEmail ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-mono text-[11.5px]" style={{ color: NEWSLETTER_ACCENT }}>
                          {s.aliasEmail}
                        </span>
                        <button
                          onClick={() => void copy(s.aliasEmail!)}
                          title="Copy alias"
                          className="grid h-5 w-5 place-items-center rounded"
                          style={{ color: "var(--fg-dimmer, #6b6478)" }}
                        >
                          {copied === s.aliasEmail ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                      </span>
                    ) : (
                      <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2" style={{ color: "var(--fg-dim, #9aa)" }}>
                    {s.topic || "—"}
                  </td>
                  <td className="px-3 py-2" style={{ color: "var(--fg-dim, #9aa)" }}>
                    {s.cadence}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--fg-dim, #9aa)" }}>
                    {/* Never fabricated: no mail yet is an em dash. */}
                    {lastEmailAt[s.id] ? fmtDate(lastEmailAt[s.id]) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() =>
                        void patch(s.id, { status: s.status === "active" ? "paused" : "active" })
                      }
                      title={
                        s.status === "active"
                          ? "Pause — also deactivates the addy alias"
                          : "Resume — also reactivates the addy alias"
                      }
                    >
                      <StatusChip color={SUBSCRIPTION_STATUS_COLORS[s.status]}>{s.status}</StatusChip>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
