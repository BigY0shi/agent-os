"use client";

import { useEffect, useState } from "react";
import { Building2, ExternalLink, ShieldCheck, ArrowUpRight } from "lucide-react";
import { useSettings } from "@/components/ConfigMenu";
import PaperclipSettings from "@/components/PaperclipSettings";

// Paperclip runs as its OWN app (its own auth in LAN mode), so the dashboard links out to it
// rather than embedding it. The URL auto-detects from whatever host you opened the dashboard on
// (localhost on this PC, the LAN IP from a phone) and is overridable in the gear.
export default function PaperclipRoute() {
  const { settings } = useSettings();
  const [autoUrl, setAutoUrl] = useState("http://localhost:3100");
  useEffect(() => {
    if (typeof window !== "undefined") setAutoUrl(`http://${window.location.hostname}:3100`);
  }, []);
  const base = (settings?.paperclip?.url?.trim() || autoUrl).replace(/\/+$/, "");
  const open = (path = "") => window.open(base + path, "_blank", "noopener");

  return (
    <div className="max-w-[760px] mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: "rgba(212,165,116,0.14)", border: "1px solid rgba(212,165,116,0.4)", color: "#d4a574" }}>
          <Building2 size={18} />
        </div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--cream,#f3ead9)" }}>Paperclip</h1>
        <span className="ml-auto"><PaperclipSettings autoUrl={autoUrl} /></span>
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--fg-dim)" }}>
        Your AI-company workspace — runs as its own app and opens in a new tab.
      </p>

      <div className="panel p-6">
        <div className="flex items-center gap-2 text-[12px] mb-4" style={{ color: "var(--fg-dim)" }}>
          <ShieldCheck size={14} style={{ color: "#34d399" }} /> LAN mode &mdash; Paperclip asks you to sign in once per device.
        </div>

        <button onClick={() => open()}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[14px] font-semibold transition hover:brightness-110"
          style={{ background: "#d4a574", color: "#1a1206", boxShadow: "0 8px 26px -8px rgba(212,165,116,0.5)" }}>
          <ExternalLink size={16} /> Open Paperclip
        </button>

        <div className="mt-3 text-[12px]" style={{ color: "var(--fg-dimmer)" }}>
          Opens <span className="mono" style={{ color: "var(--fg-dim)" }}>{base}</span> · wrong host? Change it with the gear ↑
        </div>

        <div className="mt-5 pt-4 border-t border-[var(--panel-border)] flex flex-wrap gap-2">
          {[
            { label: "Issues", path: "/issues" },
            { label: "Dashboard", path: "/dashboard" },
            { label: "Org", path: "/org" },
            { label: "Costs", path: "/costs" },
          ].map((q) => (
            <button key={q.path} onClick={() => open(q.path)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] transition"
              style={{ color: "var(--fg-dim)" }}>
              {q.label} <ArrowUpRight size={12} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
