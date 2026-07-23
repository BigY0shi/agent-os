"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import AgentPicker from "./AgentPicker";

const ACCENT = "#a3e635";

interface SiteRow { label: string; url: string; dir?: string; postsDir?: string; deployCmd?: string }

// SEO config menu — manage YOUR target sites + brand. Replaces the old hardcoded
// Julian Goldie site list; everything here writes to ~/.agentic-os/settings.json (seo.*).
export default function SeoSettings() {
  const { settings, saving, save } = useSettings();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [brand, setBrand] = useState("");
  const [author, setAuthor] = useState("");
  const [audience, setAudience] = useState("");
  const [agent, setAgent] = useState("claude");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const seo = settings.seo || {};
    setSites(Array.isArray(seo.sites) && seo.sites.length ? seo.sites as SiteRow[] : [{ label: "", url: "", dir: "" }]);
    setBrand(seo.brand || ""); setAuthor(seo.author || ""); setAudience(seo.audience || "");
    setAgent(seo.agent || "claude");
  }, [settings]);

  function update(i: number, patch: Partial<SiteRow>) {
    setSites((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }
  function addSite() { setSites((r) => [...r, { label: "", url: "", dir: "" }]); }
  function removeSite(i: number) { setSites((r) => r.filter((_, k) => k !== i)); }

  async function onSave() {
    const clean = sites.filter((s) => (s.url || "").trim() || (s.dir || "").trim());
    await save({ seo: { sites: clean, brand: brand.trim(), author: author.trim(), audience: audience.trim(), agent } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="SEO settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Your own SEO target sites. Generate + Deploy write to these — no API keys, just your repos. Leave empty to use none.
      </p>

      <Field label="Generation agent" hint="Which CLI agent writes the articles (no API key). Claude is the proven default.">
        <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} accent={ACCENT} />
      </Field>

      <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--fg, #e8e2f0)" }}>Sites</div>
      <div className="space-y-3 mb-4">
        {sites.map((s, i) => (
          <div key={i} className="rounded-lg border p-2.5" style={{ borderColor: "var(--panel-border, #2a2436)" }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>Site {i + 1}</span>
              <button onClick={() => removeSite(i)} className="text-[var(--fg-dimmer,#6b6478)] hover:text-rose-400"><Trash2 size={13} /></button>
            </div>
            <TextInput placeholder="Label (e.g. My Blog)" value={s.label} onChange={(e) => update(i, { label: e.target.value })} className="mb-1.5" />
            <TextInput placeholder="https://yoursite.com" value={s.url} onChange={(e) => update(i, { url: e.target.value })} className="mb-1.5" />
            <TextInput placeholder="Local repo dir (optional, e.g. C:\\Users\\you\\mysite)" value={s.dir || ""} onChange={(e) => update(i, { dir: e.target.value })} className="mb-1.5" />
            <TextInput placeholder="Deploy command (optional, run from the repo dir)" value={s.deployCmd || ""} onChange={(e) => update(i, { deployCmd: e.target.value })} />
          </div>
        ))}
      </div>
      <button onClick={addSite} className="inline-flex items-center gap-1.5 text-[12px] mb-5 px-2.5 h-8 rounded-lg" style={{ border: "1px solid var(--panel-border,#2a2436)", color: ACCENT }}>
        <Plus size={13} /> Add site
      </button>

      <Field label="Brand / name" hint="Replaces the old hardcoded byline in generated content.">
        <TextInput placeholder="Your brand or name" value={brand} onChange={(e) => setBrand(e.target.value)} />
      </Field>
      <Field label="Author byline">
        <TextInput placeholder="Author name" value={author} onChange={(e) => setAuthor(e.target.value)} />
      </Field>
      <Field label="Audience" hint="Who the content targets.">
        <TextInput placeholder="e.g. AI automation founders" value={audience} onChange={(e) => setAudience(e.target.value)} />
      </Field>

      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
