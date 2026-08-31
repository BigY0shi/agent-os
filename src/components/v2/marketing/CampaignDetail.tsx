"use client";

// SPEC-F J1.1 — the campaign detail shell: header, tab bar, Overview.
//
// The tab bar is here in full because the tabs that follow (Calendar J1.2,
// Kanban J2.1, Assets J2.2, Metrics J2.3) each drop into a slot rather than
// re-cutting the chrome. Unbuilt tabs say so plainly instead of rendering an
// empty panel that reads as broken.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Megaphone } from "lucide-react";

type Business = "payloadsco" | "launchworks" | "cobalt";
type Channel = "youtube" | "short-video" | "text-post" | "blog";
type ItemStatus = "idea" | "drafted" | "approved" | "scheduled" | "published";

interface ContentItem {
  id: string;
  channel: Channel;
  title: string;
  status: ItemStatus;
  date?: string;
}
interface Campaign {
  slug: string;
  title: string;
  business: Business;
  goal: string;
  angle?: string;
  channels: Channel[];
  status: string;
  plan?: string;
  items: ContentItem[];
  created: string;
  color?: string;
}

const BUSINESS_LABEL: Record<Business, string> = {
  payloadsco: "PayloadsCO",
  launchworks: "Launchworks / Deal Desk",
  cobalt: "Cobalt Research Supply",
};

const TABS = ["Overview", "Calendar", "Board", "Assets", "Metrics"] as const;
type Tab = (typeof TABS)[number];
/** Tabs whose task has not landed yet — J1.2, J2.1, J2.2, J2.3. */
const PENDING: Partial<Record<Tab, string>> = {
  Calendar: "The shared month grid arrives with J1.2.",
  Board: "The drag-to-status board arrives with J2.1.",
  Assets: "File uploads arrive with J2.2.",
  Metrics: "Computed and manual metrics arrive with J2.3.",
};

const panel = {
  background: "var(--panel, rgba(255,255,255,0.03))",
  borderColor: "var(--panel-border, rgba(255,255,255,0.08))",
};

export default function CampaignDetail({ slug }: { slug: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/marketing/campaigns/${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (res.status === 404) { setNotFound(true); setCampaign(null); return; }
      const j = (await res.json()) as { campaign?: Campaign };
      if (j.campaign) { setCampaign(j.campaign); setNotFound(false); }
    } catch {
      // A fetch that never landed is not a missing campaign — leave the 404
      // panel alone and let the empty state below say the load failed.
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const accent = campaign?.color ?? "#ec4899";

  if (loading) {
    return (
      <div className="px-6 py-10 flex items-center gap-2 text-[13px]" style={{ color: "var(--fg-dimmer)" }}>
        <Loader2 size={14} className="animate-spin" /> Loading campaign…
      </div>
    );
  }

  if (notFound || !campaign) {
    return (
      <div className="px-6 py-8 max-w-[900px]">
        <BackLink />
        <div className="mt-4 rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: "var(--panel-border)" }}>
          <Megaphone size={26} className="mx-auto mb-3" style={{ color: "var(--fg-dimmer)" }} />
          <div className="text-[14px] mb-1" style={{ color: "var(--fg)" }}>
            {notFound ? "No campaign with that name" : "Could not load this campaign"}
          </div>
          <div className="text-[12.5px]" style={{ color: "var(--fg-dimmer)" }}>
            {notFound
              ? <>Nothing is stored under <code>{slug}</code>. It may have been exiled.</>
              : "The request did not reach the server. Try again."}
          </div>
        </div>
      </div>
    );
  }

  const counts = campaign.items.reduce<Record<string, number>>((a, i) => ((a[i.status] = (a[i.status] ?? 0) + 1), a), {});

  return (
    <div className="px-6 py-5 max-w-[1200px]">
      <BackLink />

      <div className="mt-3 mb-4 flex items-start gap-3">
        <span className="mt-1.5 h-3 w-3 rounded-full flex-none" style={{ background: accent }} aria-hidden />
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold leading-tight" style={{ color: "var(--fg)" }}>{campaign.title}</h1>
          <div className="text-[12px] mt-1" style={{ color: "var(--fg-dimmer)" }}>
            {BUSINESS_LABEL[campaign.business] ?? campaign.business} · {campaign.status} · {campaign.items.length} item
            {campaign.items.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b mb-5" style={{ borderColor: "var(--panel-border)" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-3 h-9 text-[12.5px] rounded-t-md transition"
            style={{
              color: tab === t ? "var(--fg)" : "var(--fg-dimmer)",
              borderBottom: tab === t ? `2px solid ${accent}` : "2px solid transparent",
            }}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" ? (
        <div className="space-y-4">
          <div className="rounded-xl border p-4" style={panel}>
            <div className="text-[11px] font-mono uppercase tracking-widest mb-2" style={{ color: accent }}>Goal</div>
            <p className="text-[13.5px] m-0" style={{ color: "var(--fg)" }}>{campaign.goal}</p>
            {campaign.angle && (
              <>
                <div className="text-[11px] font-mono uppercase tracking-widest mt-4 mb-2" style={{ color: accent }}>Angle</div>
                <p className="text-[13.5px] m-0" style={{ color: "var(--fg-dim)" }}>{campaign.angle}</p>
              </>
            )}
          </div>

          <div className="rounded-xl border p-4" style={panel}>
            <div className="text-[11px] font-mono uppercase tracking-widest mb-2" style={{ color: accent }}>Plan</div>
            {campaign.plan ? (
              // Rendered as preformatted text, not parsed markdown: the plan is
              // model output, and this shell is not the place to introduce an
              // HTML renderer for it.
              <pre className="text-[12.5px] whitespace-pre-wrap font-sans m-0" style={{ color: "var(--fg-dim)" }}>
                {campaign.plan}
              </pre>
            ) : (
              <p className="text-[12.5px] m-0" style={{ color: "var(--fg-dimmer)" }}>
                No plan yet — run the planning council from the hub.
              </p>
            )}
          </div>

          {campaign.items.length > 0 && (
            <div className="rounded-xl border p-4" style={panel}>
              <div className="text-[11px] font-mono uppercase tracking-widest mb-3" style={{ color: accent }}>Items by status</div>
              <div className="flex flex-wrap gap-2">
                {(["idea", "drafted", "approved", "scheduled", "published"] as ItemStatus[]).map((st) => (
                  <span key={st} className="text-[12px] px-2.5 py-1 rounded-md border"
                    style={{ ...panel, color: counts[st] ? "var(--fg)" : "var(--fg-dimmer)" }}>
                    {st} <b style={{ fontVariantNumeric: "tabular-nums" }}>{counts[st] ?? 0}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-8 text-center text-[12.5px]"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg-dimmer)" }}>
          {PENDING[tab]}
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/marketing" className="inline-flex items-center gap-1.5 text-[12.5px] hover:underline"
      style={{ color: "var(--fg-dimmer)" }}>
      <ArrowLeft size={13} /> Marketing Hub
    </Link>
  );
}
