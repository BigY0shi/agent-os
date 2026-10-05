"use client";

// S29 Guide (_design/jarvis-v3-plan.md; owner: "every module, every tab, and every action
// inside of each needs to be documented in a wiki"). A hero with a tile per module, a
// sticky contents rail (Start here, Around every page, each module, How it works), search
// across all of it, and each module's doc rendered from docs/modules/<slug>.md with a link
// to open the module. The original build-your-own guide is kept at the end.

import { useMemo, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Search, ArrowUpRight, BookOpen } from "lucide-react";
import MarkdownView from "./MarkdownView";
import type { GuideDoc } from "@/lib/guide";

const md = {
  h2: (p: { children?: React.ReactNode }) => <h3 className="type-display mt-6 text-[17px]">{p.children}</h3>,
  h3: (p: { children?: React.ReactNode }) => <h4 className="mt-4 text-[14px] font-semibold">{p.children}</h4>,
  p: (p: { children?: React.ReactNode }) => <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-dim)]">{p.children}</p>,
  ul: (p: { children?: React.ReactNode }) => <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-[var(--fg-dim)]">{p.children}</ul>,
  ol: (p: { children?: React.ReactNode }) => <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-[var(--fg-dim)]">{p.children}</ol>,
  table: (p: { children?: React.ReactNode }) => <div className="mt-3 overflow-x-auto rounded-xl glass-inset"><table className="w-full border-collapse text-left text-[12.5px]">{p.children}</table></div>,
  th: (p: { children?: React.ReactNode }) => <th className="border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-dimmer)]">{p.children}</th>,
  td: (p: { children?: React.ReactNode }) => <td className="border-b border-white/5 px-3 py-2 align-top text-[var(--fg-dim)]">{p.children}</td>,
  code: (p: { children?: React.ReactNode }) => <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[11.5px] text-[var(--fg)]">{p.children}</code>,
  strong: (p: { children?: React.ReactNode }) => <strong className="font-semibold text-[var(--fg)]">{p.children}</strong>,
  a: (p: { href?: string; children?: React.ReactNode }) => <a href={p.href} className="text-[#3b95ff] hover:underline">{p.children}</a>,
};

export default function GuideView({ general, modules }: { general: GuideDoc[]; modules: GuideDoc[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const hit = (d: GuideDoc) => !needle || d.title.toLowerCase().includes(needle) || d.body.toLowerCase().includes(needle);
  const start = general.filter((d) => d.slug !== "how-it-works");
  const how = general.filter((d) => d.slug === "how-it-works");
  const shown = useMemo(() => ({ start: start.filter(hit), modules: modules.filter(hit), how: how.filter(hit) }), [needle, general, modules]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = shown.start.length + shown.modules.length + shown.how.length;

  const Section = ({ d, isModule }: { d: GuideDoc; isModule: boolean }) => (
    <section id={d.slug} className="glass scroll-mt-6 px-6 py-5" data-guide-section={d.slug}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="type-display text-[22px] leading-tight">{d.title}</h2>
        {isModule && d.route && <Link href={d.route} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] glass">Open {d.title} <ArrowUpRight size={12} /></Link>}
      </div>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{d.body}</ReactMarkdown>
    </section>
  );

  return (
    <div className="mt-4 space-y-5" data-guide>
      <section className="glass-strong px-6 py-6">
        <div className="glass-eyebrow">Guide</div>
        <h1 className="type-display mt-1 text-[30px] leading-tight">Every module, every tab, every control</h1>
        <p className="mt-1 text-[13px] text-[var(--fg-dim)]">Written from the code. The same pages are the project&apos;s docs on GitHub (docs/modules).</p>
        <label className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2 glass-inset">
          <Search size={14} className="text-[var(--fg-dimmer)]" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every module, tab and control" aria-label="Search the guide" className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--fg-dimmer)]" />
          {needle && <span className="shrink-0 text-[11px] text-[var(--fg-dimmer)]">{count} match{count === 1 ? "" : "es"}</span>}
        </label>
        {!needle && (
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
            {modules.map((d) => (
              <a key={d.slug} href={`#${d.slug}`} className="rounded-xl px-3 py-2 glass-inset hover:bg-white/5">
                <div className="truncate text-[12.5px]">{d.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[10.5px] text-[var(--fg-dimmer)]">{d.intro}</div>
              </a>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_1fr]">
        <nav className="glass h-fit max-h-[calc(100vh-40px)] overflow-y-auto px-3 py-3 lg:sticky lg:top-4" aria-label="Contents">
          <div className="glass-eyebrow px-2">Contents</div>
          <ul className="mt-2 space-y-0.5 text-[12.5px]">
            {shown.start.map((d) => <li key={d.slug}><a href={`#${d.slug}`} className="block rounded-lg px-2 py-1 hover:bg-white/5">{d.title}</a></li>)}
            <li className="px-2 pb-0.5 pt-2 text-[10.5px] uppercase tracking-wider text-[var(--fg-dimmer)]">Modules</li>
            {shown.modules.map((d) => <li key={d.slug}><a href={`#${d.slug}`} className="block truncate rounded-lg px-2 py-1 hover:bg-white/5">{d.title}</a></li>)}
            {shown.how.map((d) => <li key={d.slug} className="pt-2"><a href={`#${d.slug}`} className="block rounded-lg px-2 py-1 hover:bg-white/5">{d.title}</a></li>)}
            {!needle && <li><a href="#build-your-own" className="block rounded-lg px-2 py-1 text-[var(--fg-dim)] hover:bg-white/5">Build your own (original guide)</a></li>}
          </ul>
        </nav>
        <div className="min-w-0 space-y-4">
          {count === 0 && <p className="text-[13px] text-[var(--fg-dimmer)]">Nothing in the guide matches &quot;{q}&quot;.</p>}
          {shown.start.map((d) => <Section key={d.slug} d={d} isModule={false} />)}
          {shown.modules.map((d) => <Section key={d.slug} d={d} isModule />)}
          {shown.how.map((d) => <Section key={d.slug} d={d} isModule={false} />)}
          {!needle && (
            <details id="build-your-own" className="glass scroll-mt-6 px-6 py-5">
              <summary className="inline-flex cursor-pointer items-center gap-2 text-[14px]"><BookOpen size={14} /> Build your own (the original guide)</summary>
              <div className="mt-3"><MarkdownView src="/api/guide" /></div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
