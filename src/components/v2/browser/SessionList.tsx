"use client";

// E2.5 — /browser left rail (SPEC-E §6): per session — name, profile chip,
// live dot, allowlist badge, Open / Launch / Headed ("Let me log in") / Close
// buttons; footer = new-session form (name + profile picker + optional
// domain list).

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { BROWSER_ACCENT, inputStyle, panelStyle, type SessionWire } from "./shared";

interface Props {
  sessions: SessionWire[] | null;
  profiles: string[];
  selected: string | null;
  maxSessions: number;
  busy: string | null; // session name mid-action
  capabilityEnabled: boolean;
  onSelect: (name: string) => void;
  onLaunch: (name: string) => void;
  onHanded: (name: string, headed: boolean) => void;
  onClose: (name: string) => void;
  onCreate: (name: string, profile: string, allowedDomains: string[]) => Promise<string | null>;
  onDelete: (name: string) => void;
}

export default function SessionList({
  sessions,
  profiles,
  selected,
  maxSessions,
  busy,
  capabilityEnabled,
  onSelect,
  onLaunch,
  onHanded,
  onClose,
  onCreate,
  onDelete,
}: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [domains, setDomains] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const create = async () => {
    const list = domains
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const err = await onCreate(name.trim(), profile || profiles[0] || "", list);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setName("");
    setDomains("");
    setFormOpen(false);
  };

  const smallBtn =
    "inline-flex items-center px-1.5 h-6 rounded text-[10.5px] font-medium transition disabled:opacity-40";

  return (
    <div className="w-64 shrink-0 flex flex-col rounded-xl overflow-hidden" style={panelStyle}>
      <div
        className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--fg-dimmer, #6b6478)", borderBottom: "1px solid var(--panel-border, #2a2436)" }}
      >
        Sessions
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions === null && (
          <div className="px-3 py-4 text-[11.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Loading…
          </div>
        )}
        {sessions?.length === 0 && (
          <div className="px-3 py-4 text-[11.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            No sessions yet — create one below (a session is a named task→profile binding).
          </div>
        )}
        {sessions?.map((s) => (
          <div
            key={s.name}
            className="px-3 py-2 cursor-pointer transition"
            style={{
              borderBottom: "1px solid var(--panel-border, #2a2436)",
              background: selected === s.name ? `${BROWSER_ACCENT}14` : "transparent",
              borderLeft: selected === s.name ? `2px solid ${BROWSER_ACCENT}` : "2px solid transparent",
            }}
            onClick={() => onSelect(s.name)}
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                title={s.live ? (s.cdpReady ? "live (CDP ready)" : "live, no CDP endpoint") : "not running"}
                style={{ background: s.live ? "#34d399" : "var(--fg-dimmer, #6b6478)" }}
              />
              <span className="text-[12.5px] font-medium truncate" style={{ color: "var(--fg, #e8e2f0)" }}>
                {s.name}
              </span>
              {s.headed && (
                <span className="text-[9.5px] px-1 rounded" style={{ background: "#fbbf2422", color: "#fbbf24" }}>
                  headed
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] px-1.5 py-[1px] rounded-full" style={{ background: `${BROWSER_ACCENT}18`, color: BROWSER_ACCENT }}>
                {s.profile}
              </span>
              <span className="text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                {s.allowedDomains?.length ? `${s.allowedDomains.length} domain${s.allowedDomains.length > 1 ? "s" : ""}` : "open"}
              </span>
            </div>
            {s.currentUrl && (
              <div className="mt-1 text-[10px] font-mono truncate" title={s.currentUrl} style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                {s.currentUrl}
              </div>
            )}
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
              {!s.live && (
                <button
                  className={smallBtn}
                  style={{ border: `1px solid ${BROWSER_ACCENT}55`, color: BROWSER_ACCENT }}
                  disabled={busy === s.name || !capabilityEnabled}
                  title={capabilityEnabled ? "Launch headless" : "Browser capability is disabled — enable it in the gear"}
                  onClick={() => onLaunch(s.name)}
                >
                  Launch
                </button>
              )}
              <button
                className={smallBtn}
                style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
                disabled={busy === s.name || !capabilityEnabled}
                title={
                  capabilityEnabled
                    ? s.headed
                      ? "Relaunch headless (auth state persists in the profile)"
                      : "Relaunch VISIBLE on the desktop so you can log in"
                    : "Browser capability is disabled — enable it in the gear"
                }
                onClick={() => onHanded(s.name, !s.headed)}
              >
                {s.headed ? "Return to headless" : "Let me log in"}
              </button>
              {s.live && (
                <button
                  className={smallBtn}
                  style={{ border: "1px solid #f8717155", color: "#f87171" }}
                  disabled={busy === s.name}
                  onClick={() => onClose(s.name)}
                >
                  Close
                </button>
              )}
              {!s.live && (
                <button
                  className={smallBtn}
                  title="Remove this session config (profile data / auth state preserved)"
                  style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dimmer, #6b6478)" }}
                  onClick={() => onDelete(s.name)}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* footer: + New session */}
      <div className="px-3 py-2" style={{ borderTop: "1px solid var(--panel-border, #2a2436)" }}>
        {!formOpen ? (
          <button
            className="inline-flex items-center gap-1.5 text-[11.5px] font-medium disabled:opacity-40"
            style={{ color: BROWSER_ACCENT }}
            disabled={(sessions?.length ?? 0) >= maxSessions}
            title={(sessions?.length ?? 0) >= maxSessions ? `Maximum ${maxSessions} sessions` : undefined}
            onClick={() => setFormOpen(true)}
          >
            <Plus size={12} /> New session
          </button>
        ) : (
          <div className="space-y-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="session name (a-z 0-9 _ -)"
              className="w-full h-7 rounded-md px-2 text-[11.5px] outline-none"
              style={inputStyle}
            />
            <select
              value={profile || profiles[0] || ""}
              onChange={(e) => setProfile(e.target.value)}
              className="w-full h-7 rounded-md px-1.5 text-[11.5px] outline-none"
              style={inputStyle}
            >
              {profiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="allowed domains, comma-sep (optional)"
              className="w-full h-7 rounded-md px-2 text-[11.5px] outline-none"
              style={inputStyle}
            />
            {formError && (
              <div className="text-[10.5px]" style={{ color: "#f87171" }}>
                {formError}
              </div>
            )}
            <div className="flex gap-1.5">
              <button
                className="px-2.5 h-7 rounded-md text-[11.5px] font-semibold"
                style={{ background: BROWSER_ACCENT, color: "#03212f" }}
                onClick={create}
              >
                Create
              </button>
              <button
                className="px-2 h-7 rounded-md text-[11.5px]"
                style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
                onClick={() => {
                  setFormOpen(false);
                  setFormError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
