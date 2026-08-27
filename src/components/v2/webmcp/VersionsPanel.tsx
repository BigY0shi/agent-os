"use client";

// SPEC-C D3.5 — Versions tab: publish button (integer version bump — the
// chunk-2 decision, rendered "vN") + frozen-version history from package GET.

import { useState } from "react";
import { Rocket, Loader2 } from "lucide-react";
import { WEBMCP_ACCENT, EmptyState, fmtDate, type PkgSummary, type VersionRow } from "./shared";

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
