"use client";

// ── WebmcpView (SPEC-C D3) — the /webmcp builder page shell ──────────────────
// Left rail: package list + create form. Right: PackageEditor (tabs Tools |
// Test | Versions | Logs | Secrets). Gear → WebmcpSettings (rule 16). V2 idiom:
// fetch-on-mount + usePollWhileVisible, dark palette, no new deps.

import { useCallback, useState } from "react";
import { Hammer, Plus, X } from "lucide-react";
import ConfigMenu, { useSettings } from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { useJarvisPageContext } from "@/lib/v2/jarvis/pageContext";
import { WEBMCP_ACCENT, EmptyState, inputStyle, monoStyle, type PkgSummary } from "./shared";
import PackageList from "./PackageList";
import PackageEditor from "./PackageEditor";
import WebmcpSettings from "./WebmcpSettings";

export default function WebmcpView() {
  const [packages, setPackages] = useState<PkgSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const { settings } = useSettings();
  const allowJsHandlers = (settings?.webmcp as { allowJsHandlers?: boolean } | undefined)?.allowJsHandlers !== false;

  const published = packages?.filter((p) => p.status === "published").length ?? 0;

  // SPEC-C C5: page descriptor for the Jarvis overlay.
  useJarvisPageContext({
    route: "/webmcp",
    title: "WebMCP",
    summary: `WebMCP builder — ${packages?.length ?? 0} package(s), ${published} published${selected ? `, editing '${selected}'` : ""}.`,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v2/webmcp/packages", { cache: "no-store" });
      const j = await res.json();
      if (Array.isArray(j?.packages)) {
        setPackages(j.packages as PkgSummary[]);
        setFailed(false);
      }
    } catch {
      setFailed(true);
    }
  }, []);

  usePollWhileVisible(refresh, 10000, []);

  const create = useCallback(async () => {
    const slug = newSlug.trim().toLowerCase();
    const name = newName.trim() || slug;
    if (!slug) {
      setCreateError("slug is required (kebab-case)");
      return;
    }
    setCreateError(null);
    try {
      const res = await fetch("/api/v2/webmcp/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setNewSlug("");
      setNewName("");
      setCreateOpen(false);
      setSelected(slug);
      refresh();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    }
  }, [newSlug, newName, refresh]);

  return (
    <div className="mt-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: `${WEBMCP_ACCENT}14`, border: `1px solid ${WEBMCP_ACCENT}44` }}
          >
            <Hammer size={17} style={{ color: WEBMCP_ACCENT }} />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight leading-tight" style={{ color: "var(--fg, #e8e2f0)" }}>
              WebMCP
            </h1>
            <div className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {failed && !packages
                ? "feed unreachable"
                : packages
                  ? `${packages.length} package${packages.length === 1 ? "" : "s"} · ${published} on the hub`
                  : "loading…"}
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setCreateOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium transition"
            style={{
              border: `1px solid ${createOpen ? WEBMCP_ACCENT : `${WEBMCP_ACCENT}55`}`,
              color: WEBMCP_ACCENT,
              background: createOpen ? `${WEBMCP_ACCENT}14` : "var(--panel, rgba(255,255,255,0.02))",
            }}
          >
            {createOpen ? <X size={13} /> : <Plus size={13} />} New package
          </button>
          <ConfigMenu title="WebMCP Settings" accent={WEBMCP_ACCENT}>
            <WebmcpSettings />
          </ConfigMenu>
        </div>
      </div>

      {/* create form */}
      {createOpen && (
        <div
          className="mb-4 rounded-xl p-3 flex flex-wrap items-center gap-2"
          style={{ border: `1px solid ${WEBMCP_ACCENT}44`, background: "var(--panel, rgba(255,255,255,0.02))" }}
        >
          <input
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            placeholder="slug (kebab-case)"
            spellCheck={false}
            className="rounded-lg px-2.5 h-8 text-[12px] outline-none w-[190px]"
            style={{ ...inputStyle, ...monoStyle }}
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Display name"
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            className="rounded-lg px-2.5 h-8 text-[12px] outline-none w-[230px]"
            style={inputStyle}
          />
          <button
            onClick={create}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium transition"
            style={{ border: `1px solid ${WEBMCP_ACCENT}66`, background: `${WEBMCP_ACCENT}18`, color: WEBMCP_ACCENT }}
          >
            Create draft
          </button>
          {createError && <span className="text-[11.5px]" style={{ color: "#f87171" }}>{createError}</span>}
        </div>
      )}

      {/* body */}
      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: "280px 1fr" }}>
        <div className="min-w-0">
          <PackageList packages={packages ?? []} selected={selected} onSelect={setSelected} />
        </div>
        <div
          className="min-w-0 rounded-xl p-4"
          style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}
        >
          {selected ? (
            <PackageEditor slug={selected} allowJsHandlers={allowJsHandlers} onListChanged={refresh} />
          ) : (
            <EmptyState
              icon={<Hammer size={22} />}
              title="Build / test / version / deploy MCP tool packages"
              hint="Pick a package on the left (the seeded 'agentos' self-tools live here) or create a new one. Publish puts tools on the internal hub where Jarvis and MCP clients discover them as <slug>/<tool>."
            />
          )}
        </div>
      </div>
    </div>
  );
}
