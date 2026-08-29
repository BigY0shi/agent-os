"use client";

// ── EditionReader (SPEC-F K4.2) — the newspaper ─────────────────────────────
// Masthead, then sections as newspaper columns (2-col ≥ lg). Each story is a
// headline (linked when the item HAS a link — a newsletter item genuinely can
// have none), its summary, and one chip per source that carried it. The chip is
// the dedupe payoff made visible, and it links to that source's OWN url.
//
// Every number in the stats line comes off the stored EditionDoc, which counts
// real source rows. Nothing here is estimated.

import { Newspaper } from "lucide-react";
import type { EditionDoc } from "@/lib/v2/newsletter/types";
import { EmptyState, fmtAgo } from "../integrations/shared";
import { NEWSLETTER_ACCENT } from "./shared";

export interface EditionReaderProps {
  edition: EditionDoc | null;
  /** Honest telemetry from the last build: 'fallback' = the model call failed. */
  classification?: "reused" | "model" | "fallback" | "empty" | null;
  classificationError?: string | null;
  loading?: boolean;
}

export default function EditionReader({
  edition,
  classification,
  classificationError,
  loading,
}: EditionReaderProps) {
  if (!edition) {
    return (
      <EmptyState
        icon={<Newspaper size={20} />}
        title={loading ? "Loading the edition…" : "No edition built yet"}
        hint="Editions are compiled daily at the time set in the gear. Use Rebuild to compile one from the stories synced so far."
      />
    );
  }

  const { stats } = edition;

  return (
    <div>
      {/* masthead */}
      <div
        className="mb-4 pb-3"
        style={{ borderBottom: "2px solid var(--panel-border, #2a2436)" }}
      >
        <div
          className="text-[22px] font-semibold tracking-tight"
          style={{ color: "var(--fg, #e8e2f0)" }}
        >
          The Agent OS Daily
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          <span style={{ color: NEWSLETTER_ACCENT }}>{edition.date}</span>
          <span>built {fmtAgo(edition.builtAt)}</span>
          <span>
            {stats.stories} {stats.stories === 1 ? "story" : "stories"} · {stats.emails}{" "}
            {stats.emails === 1 ? "email" : "emails"} · {stats.duplicatesMerged} duplicate
            {stats.duplicatesMerged === 1 ? "" : "s"} merged
          </span>
        </div>
      </div>

      {classification === "fallback" && (
        <div
          className="mb-4 rounded-lg px-3 py-2 text-[11.5px]"
          style={{ border: "1px solid #f8717155", background: "rgba(248,113,113,0.08)", color: "#f87171" }}
        >
          Sectioned by FALLBACK — the classification agent failed, so stories were placed by
          subscription topic and then &ldquo;Everything Else&rdquo;.
          {classificationError ? ` ${classificationError}` : ""}
        </div>
      )}

      {edition.sections.length === 0 ? (
        <EmptyState
          icon={<Newspaper size={20} />}
          title="No stories in this edition"
          hint="Nothing was extracted for this date. Sync Gmail, then rebuild."
        />
      ) : (
        <div className="lg:columns-2 lg:gap-8">
          {edition.sections.map((section) => (
            <section key={section.topic} className="mb-6 break-inside-avoid">
              <h2
                className="mb-2 pb-1 text-[13px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: NEWSLETTER_ACCENT, borderBottom: "1px solid var(--panel-border, #2a2436)" }}
              >
                {section.topic}
              </h2>
              <div className="flex flex-col gap-3.5">
                {section.stories.map((story) => (
                  <article key={story.id} className="break-inside-avoid">
                    {story.url ? (
                      <a
                        href={story.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[14px] font-medium leading-snug hover:underline"
                        style={{ color: "var(--fg, #e8e2f0)" }}
                      >
                        {story.title}
                      </a>
                    ) : (
                      <span className="text-[14px] font-medium leading-snug" style={{ color: "var(--fg, #e8e2f0)" }}>
                        {story.title}
                      </span>
                    )}
                    {story.summary && (
                      <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--fg-dim, #9aa)" }}>
                        {story.summary}
                      </p>
                    )}
                    {story.sources.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {story.sources.map((source, i) =>
                          source.url ? (
                            <a
                              key={`${source.name}-${i}`}
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full px-2 py-0.5 font-mono text-[10px] transition hover:opacity-100 opacity-80"
                              style={{
                                border: `1px solid ${NEWSLETTER_ACCENT}55`,
                                color: NEWSLETTER_ACCENT,
                              }}
                              title={`${source.name} — open its own link`}
                            >
                              {source.name}
                            </a>
                          ) : (
                            <span
                              key={`${source.name}-${i}`}
                              className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                              style={{
                                border: "1px solid var(--panel-border, #2a2436)",
                                color: "var(--fg-dimmer, #6b6478)",
                              }}
                              title={source.name}
                            >
                              {source.name}
                            </span>
                          ),
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
