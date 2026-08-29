"use client";

// SPEC-C D3.5 — Versions tab: publish button (integer version bump — the
// chunk-2 decision, rendered "vN") + frozen-version history from package GET.
// D5.1: the Export section lives here too (mode picker + confirm → POST
// /export → shows the generated path) since exports come from published
// versions — the natural home.

import { useState } from "react";
import { Rocket, Loader2, PackageOpen } from "lucide-react";
import { WEBMCP_ACCENT, EmptyState, fmtDate, monoStyle, type PkgSummary, type VersionRow } from "./shared";

export default function VersionsPanel({
  pkg,
  versions,
  onChanged,
}: {
  pkg: PkgSummary;
  versions: VersionRow[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState<"internal" | "client">("client");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<{ path: string; stubbedTools: string[]; configNames: string[] } | null>(null);

  const runExport = async () => {
    if (
      !window.confirm(
        `Export '${pkg.slug}' v${pkg.currentVersion} in '${exportMode}' mode? Generates index.mjs + package.json + README.md under ~/.agentic-os/webmcp/exports/${pkg.slug}/ (a previous export is exiled, never deleted). Secret values are never embedded.`,
      )
    )
      return;
    setExportBusy(true);
    setExportError(null);
    setExportResult(null);
    try {
      const res = await fetch(`/api/v2/webmcp/packages/${pkg.slug}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: exportMode }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setExportResult({ path: j.path, stubbedTools: j.stubbedTools ?? [], configNames: j.configNames ?? [] });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  };

  const publish = async () => {
    const next = pkg.currentVersion + 1;
    if (
      !window.confirm(
        `Publish '${pkg.slug}' v${next}? The current draft tool set is frozen into a snapshot and goes live on the hub (Jarvis + MCP clients pick it up).`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/webmcp/packages/${pkg.slug}/publish`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={publish}
          disabled={busy || pkg.status === "archived"}
          className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
          style={{ border: `1px solid ${WEBMCP_ACCENT}66`, background: `${WEBMCP_ACCENT}18`, color: WEBMCP_ACCENT }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
          Publish v{pkg.currentVersion + 1}
        </button>
        <span className="text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          Publishing is the promotion gate — drafts run only in the Test tab.
        </span>
        {error && <span className="text-[11.5px]" style={{ color: "#f87171" }}>{error}</span>}
      </div>

      {/* D5.1 export (client-onboarding mode) */}
      <div
        className="mb-4 rounded-xl p-3 flex flex-col gap-2"
        style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <PackageOpen size={13} style={{ color: WEBMCP_ACCENT }} />
          <span className="text-[12px] font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>
            Export standalone package
          </span>
          <div className="flex items-center gap-1 ml-1">
            {(["client", "internal"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setExportMode(m)}
                className="px-2 h-6 rounded-md text-[10.5px] font-medium transition"
                style={{
                  border: `1px solid ${exportMode === m ? WEBMCP_ACCENT : "var(--panel-border, #2a2436)"}`,
                  color: exportMode === m ? WEBMCP_ACCENT : "var(--fg-dim, #9aa)",
                  background: exportMode === m ? `${WEBMCP_ACCENT}14` : "transparent",
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            onClick={runExport}
            disabled={exportBusy || pkg.status !== "published"}
            title={pkg.status !== "published" ? "Publish first — exports come from the published snapshot" : undefined}
            className="ml-auto inline-flex items-center gap-1.5 px-3 h-7 rounded-lg text-[11.5px] font-medium transition disabled:opacity-40"
            style={{ border: `1px solid ${WEBMCP_ACCENT}66`, background: `${WEBMCP_ACCENT}18`, color: WEBMCP_ACCENT }}
          >
            {exportBusy ? <Loader2 size={12} className="animate-spin" /> : <PackageOpen size={12} />}
            Export v{pkg.currentVersion}
          </button>
        </div>
        <div className="text-[10.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          {exportMode === "client"
            ? "Client mode: {{secret:*}} refs become ${config:*} placeholders + a config manifest for onboarding a client box. Values are never embedded."
            : "Internal mode: handler templates keep their {{secret:*}} refs, resolved from the export's --config at runtime. Values are never embedded."}
        </div>
        {exportError && <div className="text-[11.5px]" style={{ color: "#f87171" }}>{exportError}</div>}
        {exportResult && (
          <div className="text-[11px] leading-relaxed" style={{ color: "var(--fg-dim, #9aa)" }}>
            Exported to <span style={{ ...monoStyle, color: "#34d399" }}>{exportResult.path}</span>
            {exportResult.configNames.length > 0 && (
              <> · config: <span style={monoStyle}>{exportResult.configNames.join(", ")}</span></>
            )}
            {exportResult.stubbedTools.length > 0 && (
              <> · stubbed (internal): <span style={monoStyle}>{exportResult.stubbedTools.join(", ")}</span></>
            )}
          </div>
        )}
      </div>

      {versions.length === 0 ? (
        <EmptyState title="Never published" hint="The package has no frozen versions yet — publish to register its tools on the hub." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {versions.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2"
              style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}
            >
              <span className="font-mono text-[12px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
                v{v.version}
              </span>
              {v.version === pkg.currentVersion && pkg.status === "published" && (
                <span
                  className="px-1.5 py-[1px] rounded text-[9.5px] font-semibold uppercase tracking-[0.08em]"
                  style={{ color: "#34d399", background: "#34d39914", border: "1px solid #34d39944" }}
                >
                  live on hub
                </span>
              )}
              <span className="ml-auto font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                {fmtDate(v.publishedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
