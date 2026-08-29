"use client";

// E2.6 — BrowserSettings gear (rule 16: EVERY settings.browser field surfaced
// here — wsPort, wsBind, browserType, browserExecutable, profiles, per-session
// allowedDomains). Rendered as ConfigMenu children. Also carries the browser
// CAPABILITY toggle (settings.capability.browserEnabled) because the whole
// page — launch/handoff/tools — is gated on it (chunk-2 launch-gating
// decision); it mirrors the same toggle in Memory → Capabilities.

import { useCallback, useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import { BROWSER_ACCENT } from "./shared";

const FIREWALL_CMD =
  'New-NetFirewallRule -DisplayName "AgentOS Browser WS" -Direction Inbound -LocalPort 3738 -Protocol TCP -Action Allow';

interface SessionCfg {
  name: string;
  profile: string;
  allowedDomains?: string[];
}

interface BrowserSubtree {
  wsPort?: number;
  wsBind?: "local" | "lan";
  browserType?: "default" | "chrome" | "brave" | "custom";
  browserExecutable?: string;
  profiles?: string[];
  sessions?: SessionCfg[];
}

export default function BrowserSettings({ onChanged }: { onChanged?: () => void }) {
  const { settings, saving, save } = useSettings();
  const browser = (settings?.browser ?? {}) as BrowserSubtree;

  const [portDraft, setPortDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [newProfile, setNewProfile] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [detected, setDetected] = useState<{ type: string; path: string }[]>([]);
  const [maxProfiles, setMaxProfiles] = useState(5);
  const [customPath, setCustomPath] = useState<string | null>(null);
  const [domainDrafts, setDomainDrafts] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const capabilityEnabled = Boolean(
    (settings?.capability as { browserEnabled?: boolean } | undefined)?.browserEnabled,
  );

  useEffect(() => {
    if (settings && portDraft === null) setPortDraft(String(browser.wsPort ?? 3738));
    if (settings && customPath === null) setCustomPath(browser.browserExecutable ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // Detected browser executables (never includes Opera — E4.1 invariant).
  useEffect(() => {
    let alive = true;
    fetch("/api/v2/browser/profiles", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (Array.isArray(j?.detected)) setDetected(j.detected);
        if (typeof j?.max === "number") setMaxProfiles(j.max);
      })
      .catch(() => {
        /* offline */
      });
    return () => {
      alive = false;
    };
  }, []);

  const saveBrowser = useCallback(
    async (patch: Partial<BrowserSubtree>) => {
      await save({ browser: { ...browser, ...patch } });
      onChanged?.();
    },
    [browser, save, onChanged],
  );

  const savePort = async () => {
    const n = Number(portDraft);
    const wsPort = Number.isFinite(n) && n >= 0 && n <= 65535 ? Math.round(n) : 3738;
    setPortDraft(String(wsPort));
    await saveBrowser({ wsPort });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const setBrowserType = async (type: "default" | "chrome" | "brave" | "custom") => {
    if (type === "default") {
      await saveBrowser({ browserType: "default", browserExecutable: undefined });
      return;
    }
    if (type === "custom") {
      await saveBrowser({ browserType: "custom", browserExecutable: customPath || undefined });
      return;
    }
    const found = detected.find((d) => d.type === type);
    if (!found) return; // button is disabled in that case anyway
    await saveBrowser({ browserType: type, browserExecutable: found.path });
  };

  const addProfile = async () => {
    const name = newProfile.trim();
    if (!name) return;
    setProfileError(null);
    try {
      const res = await fetch("/api/v2/browser/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setNewProfile("");
      onChanged?.();
      // profiles live in settings — refetch via the settings hook's next poll;
      // cheap immediate reflection:
      await save({});
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : String(e));
    }
  };

  const exileProfile = async (name: string) => {
    if (!confirm(`Exile profile "${name}"? Its directory moves to browser-profiles/.exile/ (never deleted); bound sessions are removed.`)) return;
    setProfileError(null);
    try {
      const res = await fetch("/api/v2/browser/profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      onChanged?.();
      await save({});
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveDomains = async (sessionName: string) => {
    const raw = domainDrafts[sessionName] ?? "";
    const list = raw
      .split(",")
      .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
      .filter(Boolean);
    const sessions = (browser.sessions ?? []).map((s) =>
      s.name === sessionName
        ? { name: s.name, profile: s.profile, ...(list.length ? { allowedDomains: list } : {}) }
        : s,
    );
    await saveBrowser({ sessions });
    setDomainDrafts((d) => {
      const next = { ...d };
      delete next[sessionName];
      return next;
    });
  };

  const copyFirewall = async () => {
    try {
      await navigator.clipboard.writeText(FIREWALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const profiles = browser.profiles ?? ["personal", "work", "misc"];
  const sessions = browser.sessions ?? [];
  const browserType = browser.browserType ?? "default";
  const wsBind = browser.wsBind ?? "local";

  const sectionTitle = (t: string) => (
    <div className="text-[12px] font-semibold mt-5 mb-2" style={{ color: "var(--fg, #e8e2f0)" }}>
      {t}
    </div>
  );

  return (
    <div>
      {/* ── Capability gate ── */}
      <label className="flex items-start gap-2 cursor-pointer select-none mb-4">
        <input
          type="checkbox"
          checked={capabilityEnabled}
          onChange={(e) =>
            save({
              capability: {
                ...((settings?.capability as Record<string, unknown>) ?? {}),
                browserEnabled: e.target.checked,
              },
            }).then(() => onChanged?.())
          }
          className="mt-[2px]"
          style={{ accentColor: BROWSER_ACCENT }}
        />
        <span>
          <span className="block text-[12px] font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>
            Browser capability enabled
          </span>
          <span className="block text-[10.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            One toggle gates everything that starts or drives Chromium — tool dispatch, Launch, and
            headed handoff. Domain allowlists are a guardrail, not a security boundary.
          </span>
        </span>
      </label>

      {/* ── WS bridge ── */}
      {sectionTitle("Live view (CDP WS bridge)")}
      <Field label="WS port" hint="The screencast bridge listens here (default 3738). 0 = ephemeral.">
        <TextInput value={portDraft ?? ""} onChange={(e) => setPortDraft(e.target.value)} inputMode="numeric" placeholder="3738" />
      </Field>
      <Field label="Bind" hint="local = 127.0.0.1 only. lan = reachable from other machines (every connection still requires a ticket minted by the password-gated app).">
        <select
          value={wsBind}
          onChange={(e) => saveBrowser({ wsBind: e.target.value === "lan" ? "lan" : "local" })}
          className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none"
          style={{ background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)" }}
        >
          <option value="local">local (127.0.0.1)</option>
          <option value="lan">lan (0.0.0.0)</option>
        </select>
      </Field>
      {wsBind === "lan" && (
        <div className="mb-3 rounded-md p-2" style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
          <div className="text-[10.5px] mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Windows needs an inbound firewall rule for LAN viewers (run once, elevated):
          </div>
          <div className="flex items-start gap-1.5">
            <code className="flex-1 text-[10px] break-all font-mono" style={{ color: "var(--fg-dim, #9aa)" }}>
              {FIREWALL_CMD}
            </code>
            <button onClick={copyFirewall} title="Copy" className="shrink-0" style={{ color: copied ? "#34d399" : BROWSER_ACCENT }}>
              <Copy size={13} />
            </button>
          </div>
        </div>
      )}
      <SaveBar saving={saving} saved={saved} onSave={savePort} accent={BROWSER_ACCENT} />

      {/* ── Browser executable ── */}
      {sectionTitle("Browser executable")}
      <div className="text-[10.5px] mb-2 leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Default = Playwright Chromium. Opera is deliberately never offered — it is your daily
        browser and the agent browser stays isolated from it.
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {(["default", "chrome", "brave", "custom"] as const).map((t) => {
          const detectable = t === "default" || t === "custom" || detected.some((d) => d.type === t);
          return (
            <button
              key={t}
              disabled={!detectable}
              title={detectable ? undefined : `${t} not detected on this machine`}
              onClick={() => setBrowserType(t)}
              className="px-2.5 h-7 rounded-md text-[11.5px] font-medium transition disabled:opacity-40"
              style={
                browserType === t
                  ? { background: `${BROWSER_ACCENT}22`, border: `1px solid ${BROWSER_ACCENT}66`, color: BROWSER_ACCENT }
                  : { border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }
              }
            >
              {t}
            </button>
          );
        })}
      </div>
      {detected.length > 0 && (
        <div className="text-[10px] mb-2 font-mono" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          {detected.map((d) => (
            <div key={d.type} className="truncate" title={d.path}>
              {d.type}: {d.path}
            </div>
          ))}
        </div>
      )}
      {browserType === "custom" && (
        <Field label="Custom executable path" hint="Full path to a Chromium-based browser exe.">
          <TextInput
            value={customPath ?? ""}
            onChange={(e) => setCustomPath(e.target.value)}
            onBlur={() => saveBrowser({ browserType: "custom", browserExecutable: customPath || undefined })}
            placeholder="C:\\path\\to\\chrome.exe"
          />
        </Field>
      )}

      {/* ── Profiles ── */}
      {sectionTitle(`Profiles (${profiles.length}/${maxProfiles})`)}
      <div className="text-[10.5px] mb-2 leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Persistent Chromium identities at ~/.agentic-os/browser-profiles/&lt;name&gt;. Removing one
        EXILES its directory (moved, never deleted).
      </div>
      {profiles.map((p) => (
        <div key={p} className="flex items-center justify-between py-1" style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
          <span className="text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }}>
            {p}
          </span>
          <button onClick={() => exileProfile(p)} className="text-[10.5px]" style={{ color: "#f87171" }}>
            Exile
          </button>
        </div>
      ))}
      <div className="flex gap-1.5 mt-2">
        <TextInput
          value={newProfile}
          onChange={(e) => setNewProfile(e.target.value)}
          placeholder="new profile name"
          className="flex-1"
        />
        <button
          onClick={addProfile}
          disabled={profiles.length >= maxProfiles}
          className="px-2.5 h-8 rounded-md text-[11.5px] font-semibold shrink-0 disabled:opacity-40"
          style={{ background: BROWSER_ACCENT, color: "#03212f" }}
        >
          Add
        </button>
      </div>
      {profileError && (
        <div className="text-[10.5px] mt-1" style={{ color: "#f87171" }}>
          {profileError}
        </div>
      )}

      {/* ── Per-session allowlists ── */}
      {sectionTitle("Session domain allowlists")}
      <div className="text-[10.5px] mb-2 leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Empty = unrestricted. Otherwise top-level navigations are limited to the listed domains
        (subdomains included). A guardrail, not a sandbox — in-page scripts can still fetch
        cross-origin.
      </div>
      {sessions.length === 0 && (
        <div className="text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          No sessions configured yet — create one on the /browser page rail.
        </div>
      )}
      {sessions.map((s) => (
        <div key={s.name} className="mb-2.5">
          <div className="text-[11.5px] font-medium mb-1" style={{ color: "var(--fg, #e8e2f0)" }}>
            {s.name} <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>({s.profile})</span>
          </div>
          <div className="flex gap-1.5">
            <TextInput
              value={domainDrafts[s.name] ?? (s.allowedDomains ?? []).join(", ")}
              onChange={(e) => setDomainDrafts((d) => ({ ...d, [s.name]: e.target.value }))}
              placeholder="example.com, github.com (empty = open)"
              className="flex-1"
            />
            <button
              onClick={() => saveDomains(s.name)}
              disabled={saving || domainDrafts[s.name] === undefined}
              className="px-2.5 h-8 rounded-md text-[11.5px] font-semibold shrink-0 disabled:opacity-40"
              style={{ background: BROWSER_ACCENT, color: "#03212f" }}
            >
              Save
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
