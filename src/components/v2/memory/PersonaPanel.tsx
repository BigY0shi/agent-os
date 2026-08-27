"use client";

import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Sparkles, UserRound } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { useSettings } from "@/components/ConfigMenu";
import { EmptyState, MEMORY_ACCENT, fmtDate } from "./shared";

// ── PersonaPanel (SPEC-A A8.7) ───────────────────────────────────────────────
// GET /api/v2/memory/persona → {document|null}. "Generate" (POST {mode:"full"})
// exists ONLY while no doc exists — full regen over an existing doc is a hard
// 409 invariant (incremental updates + tombstones own it after that). The
// auto-update toggle writes settings.memory.personaAutoUpdate (rule 16).
//
// MarkdownView.tsx was considered and NOT reused: it fetches its own `src` URL
// and renders a full-page article shell; here the markdown arrives as data.

interface PersonaDoc {
  id: string;
  content: string;
  title: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export default function PersonaPanel() {
  const [doc, setDoc] = useState<PersonaDoc | null | undefined>(undefined); // undefined = loading
  const [failed, setFailed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const { settings, saving, save } = useSettings();

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/memory/persona", { cache: "no-store" });
      const j = await r.json();
      setDoc((j?.document ?? null) as PersonaDoc | null);
      setFailed(false);
    } catch { setFailed(true); }
  }, []);

  usePollWhileVisible(refresh, 5000, []);

  const memory = (settings?.memory ?? {}) as { personaAutoUpdate?: boolean };
  const autoUpdate = memory.personaAutoUpdate !== false;

  async function generate() {
    setGenerating(true); setGenErr(null);
    try {
      const r = await fetch("/api/v2/memory/persona", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "full" }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) { setGenErr("A persona document already exists — it only updates incrementally now."); }
      else if (!r.ok) { setGenErr(typeof j?.error === "string" ? j.error : `generation failed (${r.status})`); }
      await refresh();
    } catch { setGenErr("server unreachable"); }
    finally { setGenerating(false); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {doc && (
          <span className="font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            v{doc.version} · updated {fmtDate(doc.updatedAt)}
          </span>
        )}
        <label className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] cursor-pointer select-none"
          style={{ color: "var(--fg-dim, #9aa)" }}
          title="When on, persona-relevant facts (Identity / Preference / Directive) update the document incrementally after each ingest.">
          <input
            type="checkbox"
            checked={autoUpdate}
            disabled={saving || !settings}
            onChange={(e) => { void save({ memory: { ...(settings?.memory as object ?? {}), personaAutoUpdate: e.target.checked } }); }}
            style={{ accentColor: MEMORY_ACCENT }}
          />
          auto-update
        </label>
      </div>

      {doc === undefined ? (
        <EmptyState title={failed ? "Feed unreachable" : "Loading persona…"} />
      ) : doc === null ? (
        <div className="flex flex-col items-center py-10 gap-3 text-center">
          <UserRound size={24} style={{ color: "var(--fg-dimmer, #6b6478)" }} />
          <div className="text-[13px] font-medium" style={{ color: "var(--fg-dim, #9aa)" }}>No persona document yet</div>
          <div className="text-[11px] max-w-[440px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            The persona is a living markdown doc distilled from your Identity facts, preferences and directives.
            Generate it once — after that it only updates incrementally (full regeneration would clobber it, so the
            server refuses with 409).
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="mt-1 inline-flex items-center gap-1.5 px-4 h-8 rounded-md text-[12.5px] font-semibold disabled:opacity-50"
            style={{ background: MEMORY_ACCENT, color: "#04222a" }}
          >
            {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {generating ? "Generating…" : "Generate persona"}
          </button>
          {genErr && <div className="text-[11.5px]" style={{ color: "#f87171" }}>{genErr}</div>}
        </div>
      ) : (
        <div
          className="rounded-xl px-5 py-4 prose-custom max-w-none"
          style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: (p) => <h1 className="text-[22px] font-semibold tracking-tight mt-1 mb-3" style={{ color: MEMORY_ACCENT }} {...p} />,
              h2: (p) => <h2 className="text-[15px] font-semibold mt-6 mb-2 pt-4 first:pt-0 first:mt-2" style={{ color: "var(--fg)", borderTop: "1px solid var(--panel-border, #2a2436)" }} {...p} />,
              h3: (p) => <h3 className="text-[13.5px] font-semibold mt-4 mb-1.5" style={{ color: "var(--fg)" }} {...p} />,
              p: (p) => <p className="text-[12.5px] leading-relaxed my-2" style={{ color: "var(--fg)" }} {...p} />,
              ul: (p) => <ul className="my-2 space-y-1 pl-4 list-disc marker:text-[var(--fg-dimmer)]" {...p} />,
              li: (p) => <li className="text-[12.5px] leading-relaxed" style={{ color: "var(--fg)" }} {...p} />,
              strong: (p) => <strong className="font-semibold" style={{ color: "var(--fg)" }} {...p} />,
              em: (p) => <em className="italic" style={{ color: "var(--fg-dim)" }} {...p} />,
              del: (p) => <del style={{ color: "var(--fg-dimmer)" }} {...p} />,
              code: (p) => <code className="px-1 py-[1px] rounded text-[11.5px] font-mono" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.2)", color: "#a5f3fc" }} {...p} />,
            }}
          >
            {doc.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
