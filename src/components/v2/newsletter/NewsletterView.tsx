"use client";

// ── NewsletterView (SPEC-F K4.2) — the /newsletter page shell ───────────────
// tabs: Today's Edition · Archive · Subscriptions, a status strip and the
// rule-16 gear. Sync status is polled through usePollWhileVisible (§6).
//
// Two URL params, both owned here: ?tab= and ?date= (the archive deep link).
//
// SECRETS: this component never sees key material. The status strip renders the
// booleans `addyConfigured` / `gmailConfigured` that the routes return, plus the
// config PATH as a hint. There is no getter for the addy key anywhere in the
// process, by design (config.ts injects it inside its own fetch).

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Newspaper, RefreshCw, Hammer } from "lucide-react";
import ConfigMenu from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { useJarvisPageContext } from "@/lib/v2/jarvis/pageContext";
import type { EditionDoc, Subscription, SyncStatus } from "@/lib/v2/newsletter/types";
import { EmptyState, StatusChip, fmtAgo, panelStyle } from "../integrations/shared";
import EditionReader from "./EditionReader";
import NewsletterSettings from "./NewsletterSettings";
import SubscriptionManager from "./SubscriptionManager";
import { NEWSLETTER_ACCENT } from "./shared";

const TABS = ["today", "archive", "subscriptions"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  today: "Today's Edition",
  archive: "Archive",
  subscriptions: "Subscriptions",
};

interface EditionResponse {
  edition: EditionDoc | null;
  dates: string[];
}
interface SubscriptionsResponse {
  subscriptions: Subscription[];
  lastEmailAt: Record<string, string | null>;
  addyConfigured: boolean;
  gmailConfigured: boolean;
  addyDomain: string;
  configPath: string;
}
interface BuildResponse {
  edition?: EditionDoc;
  reused?: boolean;
  classification?: "reused" | "model" | "fallback" | "empty";
  classificationError?: string;
  error?: string;
}

export default function NewsletterView() {
  const router = useRouter();
  const params = useSearchParams();
  const rawTab = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "today";
  const dateParam = params.get("date");

  const [edition, setEdition] = useState<EditionDoc | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [classification, setClassification] = useState<BuildResponse["classification"] | null>(null);
  const [classificationError, setClassificationError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [lastEmailAt, setLastEmailAt] = useState<Record<string, string | null>>({});
  const [addyConfigured, setAddyConfigured] = useState(false);
  const [gmailConfigured, setGmailConfigured] = useState(false);
  const [configPath, setConfigPath] = useState("~/.agentic-os/newsletter/config.json");

  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState<"" | "sync" | "build">("");
  const [notice, setNotice] = useState<string | null>(null);

  const loadEdition = useCallback(async () => {
    const qs = dateParam ? `?date=${encodeURIComponent(dateParam)}` : "";
    try {
      const res = await fetch(`/api/newsletter/edition${qs}`, { cache: "no-store" });
      const j = (await res.json()) as Partial<EditionResponse>;
      setEdition(j.edition ?? null);
      setDates(Array.isArray(j.dates) ? j.dates : []);
    } catch {
      /* the reader shows its own empty state */
    } finally {
      setLoadedOnce(true);
    }
  }, [dateParam]);

  const loadSubs = useCallback(async () => {
    try {
      const res = await fetch("/api/newsletter/subscriptions", { cache: "no-store" });
      const j = (await res.json()) as Partial<SubscriptionsResponse>;
      if (Array.isArray(j.subscriptions)) setSubs(j.subscriptions);
      setLastEmailAt(j.lastEmailAt ?? {});
      setAddyConfigured(j.addyConfigured === true);
      setGmailConfigured(j.gmailConfigured === true);
      if (typeof j.configPath === "string") setConfigPath(j.configPath);
    } catch {
      /* status strip stays on its last known booleans */
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([
      loadEdition(),
      loadSubs(),
      fetch("/api/newsletter/sync", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: SyncStatus) => setSync(j))
        .catch(() => {}),
    ]);
  }, [loadEdition, loadSubs]);

  usePollWhileVisible(refresh, 8000, [dateParam]);

  useJarvisPageContext({
    route: "/newsletter",
    title: "Newsletter",
    summary:
      "The daily paper built from newsletters delivered to per-source addy.io aliases. " +
      (edition
        ? `Latest edition ${edition.date}: ${edition.stats.stories} stories from ${edition.stats.emails} emails, ${edition.stats.duplicatesMerged} duplicates merged.`
        : "No edition built yet.") +
      ` ${subs?.length ?? 0} subscriptions.`,
  });

  function go(next: { tab?: Tab; date?: string | null }) {
    const sp = new URLSearchParams(params.toString());
    if (next.tab) sp.set("tab", next.tab);
    if (next.date === null) sp.delete("date");
    else if (next.date) sp.set("date", next.date);
    router.replace(sp.toString() ? `/newsletter?${sp.toString()}` : "/newsletter", { scroll: false });
  }

  async function syncNow() {
    if (busy) return;
    setBusy("sync");
    setNotice(null);
    try {
      const res = await fetch("/api/newsletter/sync", { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        // 412 = not connected. The message names exactly what to do — never a
        // quiet zero-fetch (rule 11).
        setNotice(j.error ?? `sync failed (${res.status})`);
      } else {
        setNotice(
          `Synced: ${j.fetched} new email${j.fetched === 1 ? "" : "s"}, ${j.newStories} new stor${j.newStories === 1 ? "y" : "ies"}, ${j.merged} merged` +
            (j.embedDegraded ? " — embedder unreachable, dedupe ran on URLs only" : "") +
            (j.reason ? ` — ${j.reason}` : ""),
        );
      }
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function rebuild(force: boolean) {
    if (busy) return;
    setBusy("build");
    setNotice(null);
    try {
      const res = await fetch("/api/newsletter/edition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(dateParam ? { date: dateParam } : {}), force }),
      });
      const j = (await res.json()) as BuildResponse;
      if (!res.ok || !j.edition) {
        setNotice(j.error ?? `build failed (${res.status})`);
      } else {
        setEdition(j.edition);
        setClassification(j.classification ?? null);
        setClassificationError(j.classificationError ?? null);
        setNotice(
          j.reused
            ? `Edition ${j.edition.date} already existed — served as built ${fmtAgo(j.edition.builtAt)}. Use Force rebuild to recompile it.`
            : `Built edition ${j.edition.date}: ${j.edition.stats.stories} stories, ${j.edition.stats.duplicatesMerged} duplicates merged.`,
        );
      }
      await loadEdition();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="px-6 py-5 max-w-[1400px]">
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[17px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
            <Newspaper size={18} style={{ color: NEWSLETTER_ACCENT }} /> Newsletter
          </div>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Every newsletter gets its own alias. Stories that several of them ran show up once, with
            a chip per source.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip color={gmailConfigured ? NEWSLETTER_ACCENT : "#8c8698"}>
            {gmailConfigured ? "Gmail ✓" : "Gmail not connected"}
          </StatusChip>
          <StatusChip color={addyConfigured ? NEWSLETTER_ACCENT : "#8c8698"}>
            {addyConfigured ? "addy.io ✓" : "addy.io not configured"}
          </StatusChip>
          <ConfigMenu title="Newsletter settings" accent={NEWSLETTER_ACCENT}>
            <NewsletterSettings
              addyConfigured={addyConfigured}
              gmailConfigured={gmailConfigured}
              configPath={configPath}
            />
          </ConfigMenu>
        </div>
      </div>

      {/* status strip */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={panelStyle}>
        {!gmailConfigured && (
          <a
            href="/integrations"
            className="rounded-md px-2 h-7 inline-flex items-center text-[11.5px]"
            style={{ border: `1px solid ${NEWSLETTER_ACCENT}55`, color: NEWSLETTER_ACCENT }}
          >
            Connect Gmail →
          </a>
        )}
        {!addyConfigured && (
          <span className="font-mono text-[11px]" style={{ color: "#c0a36e" }}>
            addy.io key missing at {configPath}
          </span>
        )}
        <span className="font-mono text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          {sync?.running
            ? "sync running…"
            : sync?.lastSyncTime
              ? `last sync watermark ${fmtAgo(sync.lastSyncTime)}`
              : "never synced"}
          {sync?.lastRun
            ? ` · last run: ${sync.lastRun.fetched} fetched, ${sync.lastRun.parsed} parsed, ${sync.lastRun.failed} failed`
            : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void syncNow()}
            disabled={busy !== ""}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 h-7 text-[11.5px] transition disabled:opacity-40"
            style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
          >
            <RefreshCw size={12} className={busy === "sync" ? "animate-spin" : ""} /> Sync now
          </button>
          <button
            onClick={() => void rebuild(false)}
            disabled={busy !== ""}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 h-7 text-[11.5px] transition disabled:opacity-40"
            style={{ border: `1px solid ${NEWSLETTER_ACCENT}55`, color: NEWSLETTER_ACCENT }}
            title="Builds the edition if this date has none. An existing edition is served untouched."
          >
            <Hammer size={12} /> Build
          </button>
          <button
            onClick={() => void rebuild(true)}
            disabled={busy !== ""}
            className="rounded-lg px-2.5 h-7 text-[11.5px] transition disabled:opacity-40"
            style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dimmer, #6b6478)" }}
            title="Recompiles this date's edition from scratch, replacing the stored one."
          >
            Force rebuild
          </button>
        </div>
      </div>

      {notice && (
        <div
          className="mb-4 rounded-lg px-3 py-2 text-[11.5px]"
          style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
        >
          {notice}
        </div>
      )}

      {/* tabs */}
      <div className="mb-4 inline-flex overflow-hidden rounded-lg" style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => go({ tab: t })}
            className="px-3 h-8 text-[12px] transition"
            style={{
              background: tab === t ? `${NEWSLETTER_ACCENT}1a` : "transparent",
              color: tab === t ? NEWSLETTER_ACCENT : "var(--fg-dim, #9aa)",
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "today" && (
        <EditionReader
          edition={edition}
          classification={classification}
          classificationError={classificationError}
          loading={!loadedOnce}
        />
      )}

      {tab === "archive" && (
        <div>
          {dates.length === 0 ? (
            <EmptyState
              icon={<Newspaper size={20} />}
              title="No editions yet"
              hint="Editions appear here once the daily job (or the Build button) has compiled one."
            />
          ) : (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {dates.map((d) => (
                <button
                  key={d}
                  onClick={() => go({ tab: "archive", date: d })}
                  className="rounded-md px-2 h-7 font-mono text-[11.5px] transition"
                  style={{
                    border: `1px solid ${d === edition?.date ? NEWSLETTER_ACCENT : "var(--panel-border, #2a2436)"}`,
                    color: d === edition?.date ? NEWSLETTER_ACCENT : "var(--fg-dim, #9aa)",
                    background: d === edition?.date ? `${NEWSLETTER_ACCENT}14` : "transparent",
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          <EditionReader
            edition={edition}
            classification={classification}
            classificationError={classificationError}
            loading={!loadedOnce}
          />
        </div>
      )}

      {tab === "subscriptions" && (
        <SubscriptionManager
          subscriptions={subs}
          lastEmailAt={lastEmailAt}
          addyConfigured={addyConfigured}
          configPath={configPath}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}
