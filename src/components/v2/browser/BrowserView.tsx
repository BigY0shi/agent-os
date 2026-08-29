"use client";

// E2.5 — /browser page shell (SPEC-E §6): header (title · live count · gear),
// left rail <SessionList>, main <CdpViewer> with the honest empty states, and
// the E4.1(c) bottom Audit drawer (last 50 tool calls, 5s poll while open).

import { useCallback, useMemo, useState } from "react";
import { Globe, ChevronDown, ChevronUp } from "lucide-react";
import ConfigMenu, { useSettings } from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { useJarvisPageContext } from "@/lib/v2/jarvis/pageContext";
import { BROWSER_ACCENT, panelStyle, relativeTime, type AuditRowWire, type SessionWire } from "./shared";
import SessionList from "./SessionList";
import CdpViewer from "./CdpViewer";
import BrowserSettings from "./BrowserSettings";

export default function BrowserView() {
  const [sessions, setSessions] = useState<SessionWire[] | null>(null);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [maxSessions, setMaxSessions] = useState(10);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditRows, setAuditRows] = useState<AuditRowWire[] | null>(null);
  const { settings, reload: reloadSettings } = useSettings();

  const capabilityEnabled = Boolean(
    (settings?.capability as { browserEnabled?: boolean } | undefined)?.browserEnabled,
  );

  const refresh = useCallback(async () => {
    try {
      const [sRes, pRes] = await Promise.all([
        fetch("/api/v2/browser/sessions", { cache: "no-store" }),
        fetch("/api/v2/browser/profiles", { cache: "no-store" }),
      ]);
      const sJson = await sRes.json();
      const pJson = await pRes.json();
      if (Array.isArray(sJson?.sessions)) {
        setSessions(sJson.sessions as SessionWire[]);
        if (typeof sJson?.max === "number") setMaxSessions(sJson.max);
      }
      if (Array.isArray(pJson?.profiles)) setProfiles(pJson.profiles as string[]);
    } catch {
      /* offline — keep last state */
    }
  }, []);

  usePollWhileVisible(refresh, 4000, []);

  // E4.1(c) audit drawer — polls only while open.
  const refreshAudit = useCallback(async () => {
    if (!auditOpen) return;
    try {
      const res = await fetch("/api/v2/browser/audit?limit=50", { cache: "no-store" });
      const j = await res.json();
      if (Array.isArray(j?.rows)) setAuditRows(j.rows as AuditRowWire[]);
    } catch {
      /* offline */
    }
  }, [auditOpen]);
  usePollWhileVisible(refreshAudit, 5000, [auditOpen]);

  const liveCount = sessions?.filter((s) => s.live).length ?? 0;
  const current = useMemo(
    () => sessions?.find((s) => s.name === selected) ?? null,
    [sessions, selected],
  );

  useJarvisPageContext({
    route: "/browser",
    title: "Browser",
    summary: `Agent browser — ${sessions?.length ?? 0} session(s), ${liveCount} live${selected ? `, viewing '${selected}'` : ""}.`,
  });

  const act = useCallback(
    async (name: string, fn: () => Promise<Response>) => {
      setBusy(name);
      setActionError(null);
      try {
        const res = await fn();
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
        refresh();
      }
    },
    [refresh],
  );

  const launch = (name: string) =>
    act(name, () =>
      fetch("/api/v2/browser/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: name }),
      }),
    );

  const handoff = (name: string, headed: boolean) =>
    act(name, () =>
      fetch("/api/v2/browser/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: name, headed }),
      }),
    );

  const closeSession = (name: string) =>
    act(name, () =>
      fetch("/api/v2/browser/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "browser_close_session", args: { session: name }, caller: "user" }),
      }),
    );

  const createSession = async (
    name: string,
    profile: string,
    allowedDomains: string[],
  ): Promise<string | null> => {
    try {
      const res = await fetch("/api/v2/browser/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, profile, allowedDomains }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) return j?.error ?? `HTTP ${res.status}`;
      refresh();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  const deleteSession = (name: string) =>
    act(name, () =>
      fetch("/api/v2/browser/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    );

  return (
    <div className="mt-4">
      {/* header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Globe size={18} style={{ color: BROWSER_ACCENT }} />
          <h1 className="text-[17px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
            Browser
          </h1>
          <span className="text-[11.5px] px-2 py-[2px] rounded-full" style={{ background: `${BROWSER_ACCENT}18`, color: BROWSER_ACCENT }}>
            {liveCount} live
          </span>
        </div>
        <ConfigMenu title="Browser" accent={BROWSER_ACCENT}>
          <BrowserSettings onChanged={() => { refresh(); reloadSettings(); }} />
        </ConfigMenu>
      </div>

      {!capabilityEnabled && (
        <div className="mb-3 rounded-lg px-3 py-2 text-[12px]" style={{ border: "1px solid #fbbf2455", background: "#fbbf240f", color: "#fbbf24" }}>
          The browser capability is disabled — Launch, handoff and tools are gated off. Enable it in
          the gear (Browser capability enabled).
        </div>
      )}
      {actionError && (
        <div className="mb-3 rounded-lg px-3 py-2 text-[12px]" style={{ border: "1px solid #f8717155", background: "#f871710f", color: "#f87171" }}>
          {actionError}
        </div>
      )}

      <div className="flex gap-4 items-stretch" style={{ minHeight: "60vh" }}>
        <SessionList
          sessions={sessions}
          profiles={profiles}
          selected={selected}
          maxSessions={maxSessions}
          busy={busy}
          capabilityEnabled={capabilityEnabled}
          onSelect={setSelected}
          onLaunch={launch}
          onHanded={handoff}
          onClose={closeSession}
          onCreate={createSession}
          onDelete={deleteSession}
        />

        {/* main viewer / honest empty states (§6) */}
        <div className="flex-1 min-w-0 flex flex-col">
          {!current && (
            <EmptyPanel>
              Select a session on the left — or create one — to see its live view.
            </EmptyPanel>
          )}
          {current && !current.live && (
            <EmptyPanel>
              Session &quot;{current.name}&quot; is not running.{" "}
              {capabilityEnabled ? "Launch it from the rail to start streaming." : "Enable the browser capability in the gear, then Launch."}
            </EmptyPanel>
          )}
          {current && current.live && current.headed && (
            <EmptyPanel>
              <span className="block mb-2" style={{ color: "#fbbf24" }}>
                Headed on the desktop — this window is a REAL browser window on the machine, not
                embedded here. Interact with it directly (log in, solve the wall), then return.
              </span>
              <button
                className="px-3 h-8 rounded-md text-[12px] font-semibold"
                style={{ background: BROWSER_ACCENT, color: "#03212f" }}
                onClick={() => handoff(current.name, false)}
              >
                Return to headless
              </button>
            </EmptyPanel>
          )}
          {current && current.live && !current.headed && !current.cdpReady && (
            <EmptyPanel>
              No CDP endpoint for &quot;{current.name}&quot; — relaunch the session (Close, then
              Launch) to re-capture it.
            </EmptyPanel>
          )}
          {current && current.live && !current.headed && current.cdpReady && (
            <div className="flex-1 min-h-[480px]">
              <CdpViewer session={current.name} />
            </div>
          )}
        </div>
      </div>

      {/* E4.1(c) audit drawer */}
      <div className="mt-4 rounded-xl overflow-hidden" style={panelStyle}>
        <button
          className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-semibold"
          style={{ color: "var(--fg, #e8e2f0)" }}
          onClick={() => setAuditOpen((v) => !v)}
        >
          <span>
            Audit — recent browser tool calls
            <span className="ml-2 font-normal text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              every call is recorded; typed values withheld (field names only)
            </span>
          </span>
          {auditOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {auditOpen && (
          <div className="max-h-64 overflow-y-auto px-3 pb-2">
            {auditRows === null && (
              <div className="py-2 text-[11.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                Loading…
              </div>
            )}
            {auditRows?.length === 0 && (
              <div className="py-2 text-[11.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                No tool calls recorded yet.
              </div>
            )}
            {auditRows?.map((r) => (
              <div key={r.id} className="py-1.5 text-[11px] flex items-start gap-2 flex-wrap" style={{ borderTop: "1px solid var(--panel-border, #2a2436)" }}>
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                  style={{ background: r.ok ? "#34d399" : "#f87171" }}
                  title={r.ok ? "ok" : r.error ?? "failed"}
                />
                <span className="font-mono" style={{ color: "var(--fg, #e8e2f0)" }}>{r.tool}</span>
                <span style={{ color: BROWSER_ACCENT }}>{r.session_name}</span>
                <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>{r.caller}</span>
                <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>{relativeTime(r.ts)}</span>
                {r.error && <span style={{ color: "#f87171" }}>{r.error}</span>}
                {r.args_preview && r.args_preview !== "{}" && (
                  <span className="basis-full font-mono text-[10px] truncate" title={r.args_preview} style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    {r.args_preview}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex-1 min-h-[480px] rounded-xl flex items-center justify-center px-8 text-center text-[12.5px] leading-relaxed"
      style={{ ...panelStyle, color: "var(--fg-dim, #9aa)" }}
    >
      <div>{children}</div>
    </div>
  );
}
