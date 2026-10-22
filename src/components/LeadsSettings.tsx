"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import { isMaskedSecret } from "@/lib/settingsRedact";
import AgentPicker from "./AgentPicker";

const ACCENT = "#f59e0b";

type DP = "ai" | "agent" | "tavily" | "perplexity" | "firecrawl" | "apify";
const PROVIDERS: { id: DP; label: string }[] = [
  { id: "ai", label: "AI guess" },
  { id: "agent", label: "CLI agent (own tools)" },
  { id: "tavily", label: "Tavily" },
  { id: "perplexity", label: "Perplexity" },
  { id: "firecrawl", label: "Firecrawl" },
  { id: "apify", label: "Apify" },
];

// Leads config — the CLI agent that reasons (ICP/scoring) + the data provider that finds leads.
// A CLI agent runs on your subscription (no key). The web providers each need their own key.
export default function LeadsSettings() {
  const { settings, saving, save } = useSettings();
  const [agent, setAgent] = useState("claude");
  const [dataProvider, setDataProvider] = useState<DP>("ai");
  const [tavilyKey, setTavilyKey] = useState("");
  const [perplexityKey, setPerplexityKey] = useState("");
  const [firecrawlKey, setFirecrawlKey] = useState("");
  const [apifyToken, setApifyToken] = useState("");
  const [apifyActor, setApifyActor] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const l = settings.leads || {};
    setAgent(l.agent || "claude");
    setDataProvider((l.dataProvider as DP) || "ai");
    setTavilyKey(l.tavilyKey || ""); setPerplexityKey(l.perplexityKey || "");
    setFirecrawlKey(l.firecrawlKey || ""); setApifyToken(l.apifyToken || ""); setApifyActor(l.apifyActor || "");
  }, [settings]);

  async function onSave() {
    await save({ leads: {
      agent, dataProvider,
      tavilyKey: tavilyKey.trim(), perplexityKey: perplexityKey.trim(),
      firecrawlKey: firecrawlKey.trim(), apifyToken: apifyToken.trim(), apifyActor: apifyActor.trim(),
    } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="Leads settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Pick the agent that does the thinking (ICP, scoring) and the provider that finds the leads. A CLI agent runs on your subscription — no key. The web providers each need their own key, pasted below.
      </p>

      <Field label="Reasoning agent" hint="ICP + scoring. 'OpenRouter' keeps the legacy gemini-2.5-flash path.">
        <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} extraOptions={[{ id: "openrouter", label: "OpenRouter (gemini-2.5-flash)" }]} accent={ACCENT} />
      </Field>

      <Field label="Data provider" hint="Where leads come from. 'AI guess' = the agent suggests companies + Hunter pulls people. The rest search the web.">
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((p) => (
            <button key={p.id} onClick={() => setDataProvider(p.id)}
              className="px-2.5 h-8 rounded-lg text-[12px] font-medium transition"
              style={dataProvider === p.id
                ? { background: `${ACCENT}22`, border: `1px solid ${ACCENT}`, color: "var(--fg, #e8e2f0)" }
                : { border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}>
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      {dataProvider === "agent" && (
        <p className="text-[11px] mb-3 rounded-lg px-3 py-2" style={{ color: "var(--fg-dim, #9aa)", background: `${ACCENT}10`, border: `1px solid ${ACCENT}33` }}>
          Runs the <b>reasoning agent</b> above autonomously with its own tools — web search, a browser MCP, your custom scraper, whatever it has. No key. Just make sure that agent actually has a search/browse tool wired, or it&apos;ll fall back to guessing from memory.
        </p>
      )}
      {dataProvider === "tavily" && (
        <Field label="Tavily API key" hint="tavily.com → API keys">
          <TextInput type={isMaskedSecret(tavilyKey) ? "text" : "password"} placeholder="tvly-…" value={tavilyKey} onChange={(e) => setTavilyKey(e.target.value)} />
        </Field>
      )}
      {dataProvider === "perplexity" && (
        <Field label="Perplexity API key" hint="perplexity.ai → Settings → API">
          <TextInput type={isMaskedSecret(perplexityKey) ? "text" : "password"} placeholder="pplx-…" value={perplexityKey} onChange={(e) => setPerplexityKey(e.target.value)} />
        </Field>
      )}
      {dataProvider === "firecrawl" && (
        <Field label="Firecrawl API key" hint="firecrawl.dev → API keys">
          <TextInput type={isMaskedSecret(firecrawlKey) ? "text" : "password"} placeholder="fc-…" value={firecrawlKey} onChange={(e) => setFirecrawlKey(e.target.value)} />
        </Field>
      )}
      {dataProvider === "apify" && (
        <>
          <Field label="Apify token" hint="apify.com → Settings → Integrations → API">
            <TextInput type={isMaskedSecret(apifyToken) ? "text" : "password"} placeholder="apify_api_…" value={apifyToken} onChange={(e) => setApifyToken(e.target.value)} />
          </Field>
          <Field label="Apify actor" hint="Which actor to run, e.g. apify/google-search-scraper or a lead-gen actor.">
            <TextInput placeholder="apify/google-search-scraper" value={apifyActor} onChange={(e) => setApifyActor(e.target.value)} />
          </Field>
        </>
      )}

      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
