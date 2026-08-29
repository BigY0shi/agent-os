"use client";

// SPEC-C D3 — package detail pane: tabs Tools | Test | Versions | Logs |
// Secrets over GET /api/v2/webmcp/packages/[slug], plus name/description
// edits and the publish / archive / delete-draft (exile) actions.

import { useCallback, useEffect, useState } from "react";
import { Archive, FlaskConical, History, KeyRound, ListOrdered, Loader2, Trash2, Wrench } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import {
  WEBMCP_ACCENT,
  StatusPill,
  EmptyState,
  inputStyle,
  type PkgDetail,
} from "./shared";
import ToolDesigner from "./ToolDesigner";
import TestRunner from "./TestRunner";
import VersionsPanel from "./VersionsPanel";
import LogsPanel from "./LogsPanel";
import SecretsPanel from "./SecretsPanel";

type Tab = "tools" | "test" | "versions" | "logs" | "secrets";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "tools", label: "Tools", icon: <Wrench size={13} /> },
  { key: "test", label: "Test", icon: <FlaskConical size={13} /> },
  { key: "versions", label: "Versions", icon: <History size={13} /> },
  { key: "logs", label: "Logs", icon: <ListOrdered size={13} /> },
  { key: "secrets", label: "Secrets", icon: <KeyRound size={13} /> },
];

export default function PackageEditor({
  slug,
  allowJsHandlers,
  onListChanged,
}: {
  slug: string;
  allowJsHandlers: boolean;
  onListChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("tools");
  const [detail, setDetail] = useState<PkgDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v2/webmcp/packages/${slug}`, { cache: "no-store" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const j = (await res.json()) as PkgDetail;
      setDetail(j);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [slug]);

  // Reset drafts + refetch when the selected package changes.
  useEffect(() => {
    setDetail(null);
    setNameDraft(null);
    setDescDraft(null);
    setActionError(null);
    setTab("tools");
    refresh();
  }, [slug, refresh]);

  usePollWhileVisible(refresh, 8000, [slug]);

  const changed = useCallback(() => {
    refresh();
    onListChanged();
  }, [refresh, onListChanged]);

  const saveMeta = useCallback(async () => {
    if (!detail) return;
    const patch: Record<string, string> = {};
    if (nameDraft !== null && nameDraft.trim() && nameDraft !== detail.package.name) patch.name = nameDraft.trim();
    if (descDraft !== null && descDraft !== detail.package.description) patch.description = descDraft;
    if (Object.keys(patch).length === 0) return;
    try {
      const res = await fetch(`/api/v2/webmcp/packages/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) changed();
    } catch {
      /* offline */
    }
  }, [detail, nameDraft, descDraft, slug, changed]);

  const archiveOrDelete = useCallback(async () => {
    if (!detail) return;
    const isDraft = detail.package.status === "draft";
    const msg = isDraft
      ? `Delete DRAFT '${slug}'? The full bundle is exiled to ~/.agentic-os/.exile/webmcp/ first (recoverable).`
      : `Archive '${slug}'? Its tools unregister from the hub; rows are kept (never deleted). This cannot be re-published.`;
    if (!window.confirm(msg)) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v2/webmcp/packages/${slug}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      changed();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [detail, slug, changed]);

  if (failed && !detail) {
    return <EmptyState title="Package unreachable" hint="The package may have been deleted, or the server is offline." />;
  }
  if (!detail) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={16} className="animate-spin" style={{ color: WEBMCP_ACCENT }} />
      </div>
    );
  }

  const pkg = detail.package;
  const readOnly = pkg.status === "archived";

  return (
    <div className="min-w-0">
      {/* package header */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[17px] leading-none">{pkg.icon || "📦"}</span>
        <input
          value={nameDraft ?? pkg.name}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={saveMeta}
          disabled={readOnly}
          className="rounded-lg px-2 h-8 text-[14px] font-semibold outline-none min-w-[180px]"
          style={inputStyle}
        />
        <StatusPill status={pkg.status} />
        {pkg.status === "published" && (
          <span className="font-mono text-[11px]" style={{ color: WEBMCP_ACCENT }}>v{pkg.currentVersion}</span>
        )}
        <span className="font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{pkg.slug}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={archiveOrDelete}
            disabled={actionBusy || pkg.status === "archived"}
            title={pkg.status === "draft" ? "Delete draft (exile bundle first)" : "Archive (unregister from hub, keep rows)"}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11.5px] font-medium transition disabled:opacity-40"
            style={{ border: "1px solid #f8717155", color: "#f87171" }}
          >
            {pkg.status === "draft" ? <Trash2 size={12} /> : <Archive size={12} />}
            {pkg.status === "draft" ? "Delete draft" : "Archive"}
          </button>
        </div>
      </div>
      <textarea
        value={descDraft ?? pkg.description}
        onChange={(e) => setDescDraft(e.target.value)}
        onBlur={saveMeta}
        disabled={readOnly}
        rows={1}
        placeholder="Package description (agents read this too)"
        className="w-full rounded-lg px-2.5 py-1.5 text-[12px] outline-none resize-y mb-3"
        style={inputStyle}
      />
      {actionError && <div className="mb-2 text-[11.5px]" style={{ color: "#f87171" }}>{actionError}</div>}
      {readOnly && (
        <div className="mb-3 text-[11.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          Archived — read-only. Tools are unregistered from the hub; rows and versions are preserved.
        </div>
      )}

      {/* tabs */}
      <div className="flex items-center gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium transition"
            style={{
              border: `1px solid ${tab === t.key ? WEBMCP_ACCENT : "var(--panel-border, #2a2436)"}`,
              color: tab === t.key ? WEBMCP_ACCENT : "var(--fg-dim, #9aa)",
              background: tab === t.key ? `${WEBMCP_ACCENT}14` : "transparent",
            }}
          >
            {t.icon} {t.label}
            {t.key === "tools" && <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>{detail.tools.length}</span>}
          </button>
        ))}
      </div>

      {tab === "tools" && (
        <ToolDesigner slug={pkg.slug} tools={detail.tools} allowJsHandlers={allowJsHandlers} readOnly={readOnly} onChanged={changed} />
      )}
      {tab === "test" && <TestRunner slug={pkg.slug} tools={detail.tools} />}
      {tab === "versions" && <VersionsPanel pkg={pkg} versions={detail.versions} onChanged={changed} />}
      {tab === "logs" && <LogsPanel slug={pkg.slug} initialLogs={detail.recentLogs} onRefresh={refresh} />}
      {tab === "secrets" && <SecretsPanel slug={pkg.slug} secretNames={detail.secretNames} onChanged={refresh} />}
    </div>
  );
}
