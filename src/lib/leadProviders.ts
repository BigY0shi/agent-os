// Lead data providers — alternatives to Hunter/Apollo. Either run YOUR CLI agent with its own
// tools (web search / browser MCP / your custom scraper — no API key), or one of the paid web
// services (Tavily/Perplexity/Firecrawl/Apify). In every case the reasoning agent extracts
// structured leads from the raw results. Keys (only for the paid services) live in settings.leads.

import { readSettings } from "@/lib/settings";
import { modelChat, extractJson, type ICP, type Lead } from "@/lib/leads";
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";

export type DataProvider = "ai" | "agent" | "tavily" | "perplexity" | "firecrawl" | "apify";

function icpQuery(icp: ICP): string {
  return [
    icp.brief,
    icp.titles?.length ? `titles: ${icp.titles.join(", ")}` : "",
    icp.industries?.length ? `industries: ${icp.industries.join(", ")}` : "",
    icp.geos?.length ? `in ${icp.geos.join(", ")}` : "",
    icp.keywords?.length ? `signals: ${icp.keywords.join(", ")}` : "",
  ].filter(Boolean).join(" · ").slice(0, 500);
}

function domainFrom(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
}

// ── "CLI agent (own tools)" — run the chosen agent AUTONOMOUSLY so it can use its real tools
// (web search, browser/scraper MCPs, your custom tool) to research live leads. No API key. ──
function autoArgs(agent: string, prompt: string): { args: string[]; input?: string } {
  switch (agent) {
    case "claude":  return { args: ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", "--dangerously-skip-permissions"], input: prompt };
    case "codex":   return { args: ["exec", "--full-auto", "--skip-git-repo-check", "--ignore-user-config", prompt] };
    case "cursor":  return { args: ["-p", prompt, "--output-format", "text", "--force", "--trust"] };
    case "pi":      return { args: ["-p", prompt, "--mode", "text", "--no-session"] };
    case "hermes":  return { args: ["-z", prompt, "--yolo", "--accept-hooks"] };
    default:        return { args: ["-p", prompt] };
  }
}

async function agentWithTools(icp: ICP, agent: string): Promise<string> {
  const KNOWN = ["claude", "codex", "cursor", "pi", "hermes"];
  const a = KNOWN.includes(agent) ? agent : "claude";
  const prompt =
    "You are a B2B lead-research agent. Use your available tools (web search, browser, scrapers, MCP servers — whatever you have) to find REAL, currently-operating companies and decision-makers that match this ideal customer profile. " +
    "Never invent companies, domains, or emails — only include what you actually find and can stand behind.\n\n" +
    `IDEAL CUSTOMER: ${icpQuery(icp)}\n\n` +
    "When finished, output ONLY a JSON array (no prose, no code fences): " +
    "[{name, title, company, domain, email, linkedin, location}] — roughly 10-20 entries, use \"\" for any field you couldn't find.";
  const { args, input } = autoArgs(a, prompt);
  const res = await run(a as Parameters<typeof run>[0], args, { timeoutMs: 240_000, input });
  const out = (res.stdout || "").trim();
  if (!out) throw new Error(`${a} returned nothing — make sure it has web/search tools available. ${(res.stderr || "").slice(-160)}`);
  return out;
}

// ── paid web services — raw results the reasoning agent then mines ──
async function tavily(icp: ICP, key: string): Promise<string> {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: key, query: `companies and decision-makers matching: ${icpQuery(icp)}`, max_results: 15, search_depth: "advanced" }),
  });
  if (!r.ok) throw new Error(`Tavily HTTP ${r.status}`);
  const j = await r.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (j.results || []).map((x) => `${x.title || ""} — ${x.url || ""}\n${x.content || ""}`).join("\n\n").slice(0, 12000);
}

async function perplexity(icp: ICP, key: string): Promise<string> {
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: `List ~15 real companies (with website domains) and, where findable, a relevant decision-maker (name + title) matching: ${icpQuery(icp)}` }] }),
  });
  if (!r.ok) throw new Error(`Perplexity HTTP ${r.status}`);
  const j = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  return String(j?.choices?.[0]?.message?.content || "").slice(0, 12000);
}

async function firecrawl(icp: ICP, key: string): Promise<string> {
  const r = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ query: `companies matching: ${icpQuery(icp)}`, limit: 15 }),
  });
  if (!r.ok) throw new Error(`Firecrawl HTTP ${r.status}`);
  const j = await r.json() as { data?: Array<{ title?: string; url?: string; markdown?: string; description?: string }> };
  return (j.data || []).map((x) => `${x.title || ""} — ${x.url || ""}\n${(x.markdown || x.description || "").slice(0, 500)}`).join("\n\n").slice(0, 12000);
}

async function apify(icp: ICP, token: string, actor: string): Promise<string> {
  if (!actor) throw new Error("Set an Apify actor id in Leads settings (e.g. apify/google-search-scraper or a lead-gen actor).");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actor.replace("/", "~"))}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const r = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: icpQuery(icp), queries: icpQuery(icp), search: icpQuery(icp), maxItems: 25, maxResults: 25 }),
  });
  if (!r.ok) throw new Error(`Apify HTTP ${r.status} (check the actor id + token)`);
  const items = await r.json() as unknown[];
  return JSON.stringify(Array.isArray(items) ? items.slice(0, 40) : items).slice(0, 14000);
}

// ── extraction → structured Lead[] ──
function mapToLeads(arr: Array<Record<string, string>>, label: string): Lead[] {
  const seen = new Set<string>();
  const leads: Lead[] = [];
  for (const x of arr) {
    const name = String(x?.name || "").trim();
    const company = String(x?.company || "").trim();
    const domain = domainFrom(x?.domain || "");
    const email = String(x?.email || "").trim().toLowerCase();
    if (!name && !company && !domain) continue;
    const id = (email || `${name}|${company || domain}`).toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    leads.push({
      id, name, firstName: name.split(/\s+/)[0] || "", title: String(x?.title || "").trim(),
      company: company || domain, domain, email, emailStatus: email ? "guessed" : "unknown",
      linkedin: String(x?.linkedin || "").trim(), location: String(x?.location || "").trim(),
      source: label,
    });
    if (leads.length >= 40) break;
  }
  return leads;
}

const EXTRACT_SYS =
  "You extract B2B sales leads from raw web-search/scrape results. Return ONLY a JSON array (no prose, no fences): " +
  "[{name, title, company, domain, email, linkedin, location}]. Use \"\" for any field you can't find. " +
  "Include a row for a company even if you only have the company + domain. Only real, on-topic entries — never invent emails or domains.";

async function extractLeads(raw: string, icp: ICP, label: string): Promise<Lead[]> {
  if (!raw.trim()) return [];
  // The raw output may ALREADY be (or contain) a JSON array of leads (the "agent" path asks for
  // exactly that) — try parsing it directly first, for free. Otherwise have the reasoning agent mine it.
  const direct = extractJson<Array<Record<string, string>>>(raw);
  if (Array.isArray(direct) && direct.length && direct.some((x) => x?.name || x?.company || x?.domain)) {
    return mapToLeads(direct, label);
  }
  const out = await modelChat(EXTRACT_SYS, `ICP: ${icpQuery(icp)}\n\n--- RAW RESULTS ---\n${raw}`, 4000);
  return mapToLeads(extractJson<Array<Record<string, string>>>(out) || [], label);
}

// Find leads via the configured data provider. Returns [] for "ai" (caller uses the legacy path).
export async function findLeadsViaProvider(icp: ICP): Promise<{ provider: DataProvider; leads: Lead[] }> {
  const L = readSettings().leads;
  const provider = (L.dataProvider || "ai") as DataProvider;
  if (provider === "ai") return { provider, leads: [] };

  let raw: string;
  switch (provider) {
    case "agent":
      raw = await agentWithTools(icp, L.agent || "claude"); break;
    case "tavily":
      if (!L.tavilyKey) throw new Error("No Tavily key — add it in Leads settings (gear).");
      raw = await tavily(icp, L.tavilyKey); break;
    case "perplexity":
      if (!L.perplexityKey) throw new Error("No Perplexity key — add it in Leads settings (gear).");
      raw = await perplexity(icp, L.perplexityKey); break;
    case "firecrawl":
      if (!L.firecrawlKey) throw new Error("No Firecrawl key — add it in Leads settings (gear).");
      raw = await firecrawl(icp, L.firecrawlKey); break;
    case "apify":
      if (!L.apifyToken) throw new Error("No Apify token — add it in Leads settings (gear).");
      raw = await apify(icp, L.apifyToken, L.apifyActor || ""); break;
    default:
      return { provider, leads: [] };
  }
  const leads = await extractLeads(raw, icp, provider);
  return { provider, leads };
}
