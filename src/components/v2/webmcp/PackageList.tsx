"use client";

// SPEC-C D3 — left-rail package list: name, slug, status pill, "vN"
// (current_version is an INTEGER per the chunk-2 decision), tool count.

import { Package } from "lucide-react";
import { WEBMCP_ACCENT, StatusPill, EmptyState, fmtAgo, type PkgSummary } from "./shared";

export default function PackageList({
  packages,
  selected,
  onSelect,
}: {
  packages: PkgSummary[];
  selected: string | null;
  onSelect: (slug: string) => void;
}) {
  if (packages.length === 0) {
    return (
      <EmptyState
        icon={<Package size={22} />}
        title="No packages yet"
        hint="Create a package, add tools, test them, then publish to put them on the hub for Jarvis and MCP clients."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {packages.map((p) => {
        const active = p.slug === selected;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.slug)}
            className="text-left rounded-xl px-3 py-2.5 transition"
            style={{
              border: `1px solid ${active ? WEBMCP_ACCENT : "var(--panel-border, #2a2436)"}`,
              background: active ? `${WEBMCP_ACCENT}0f` : "var(--panel, rgba(255,255,255,0.02))",
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[15px] leading-none shrink-0">{p.icon || "📦"}</span>
              <span className="text-[13px] font-semibold truncate" style={{ color: "var(--fg, #e8e2f0)" }}>
                {p.name}
              </span>
              {p.status === "published" && (
                <span className="ml-auto font-mono text-[10.5px] shrink-0" style={{ color: WEBMCP_ACCENT }}>
                  v{p.currentVersion}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2 min-w-0">
              <StatusPill status={p.status} />
              <span className="font-mono text-[10px] truncate" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                {p.slug} · {p.toolCount ?? 0} tool{(p.toolCount ?? 0) === 1 ? "" : "s"} · {fmtAgo(p.updatedAt)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
