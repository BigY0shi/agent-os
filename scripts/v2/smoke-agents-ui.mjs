// SPEC-E chunk 4 — smoke-agents-ui: static contract checks for the Agents
// page UI (house *-ui pattern; the dynamic API legs live in
// smoke-agents-forge.mjs). Covers: files + 'use client' + route wiring; the
// hero's SSE-then-poll contract; StatusBand palette NO-FORK greps; reuse of
// AgentsView pieces (no duplicated approval/transcript markup); wizard steps
// + 409 surfacing + lifecycle "test" create; HarnessLibrary exile semantics;
// detail tabs incl. the browser-sessions sub-list; gear-pattern presence
// (rule 16) incl. the CONVENTIONS §11 requireTestRun stub; route idioms;
// no-secret greps.
// Run: npx tsx scripts/v2/smoke-agents-ui.mjs
import path from "node:path";
import fs from "node:fs";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 200)}` : ""}`);
  if (!cond) failures++;
};

// ── files exist + 'use client' where required ───────────────────────────────
const clientComponents = [
  "src/components/v2/agents/AgentsPageV2.tsx",
  "src/components/v2/agents/AgentsHero.tsx",
  "src/components/v2/agents/AgentCardsGrid.tsx",
  "src/components/v2/agents/ForgeWizard.tsx",
  "src/components/v2/agents/HarnessLibrary.tsx",
  "src/components/v2/agents/AgentsSettings.tsx",
  "src/components/v2/agents/AgentDetail.tsx",
  "src/components/v2/agents/tabs/OverviewTab.tsx",
  "src/components/v2/agents/tabs/RunsTab.tsx",
  "src/components/v2/agents/tabs/ApprovalsTab.tsx",
  "src/components/v2/agents/tabs/SettingsTab.tsx",
];
for (const f of clientComponents) {
  check(`${f} exists`, exists(f));
  if (exists(f)) check(`${f} is 'use client'`, /^"use client";/.test(read(f)));
}
check("shared.ts exists (client-safe, no node imports)",
  exists("src/components/v2/agents/shared.ts") && !/from "node:/.test(read("src/components/v2/agents/shared.ts")));

// ── page wiring ─────────────────────────────────────────────────────────────
const page = read("src/app/agents/page.tsx");
check("/agents renders AgentsPageV2 (recomposition)", page.includes("AgentsPageV2"));
check("/agents/[id] page exists and renders AgentDetail in Suspense",
  exists("src/app/agents/[id]/page.tsx") &&
  read("src/app/agents/[id]/page.tsx").includes("AgentDetail") &&
  read("src/app/agents/[id]/page.tsx").includes("Suspense"));
const sidebar = read("src/components/Sidebar.tsx");
check("Sidebar still routes /agents", sidebar.includes('"/agents"'));

// ── hero: SSE-then-poll contract (F2.3) ─────────────────────────────────────
const hero = read("src/components/v2/agents/AgentsHero.tssx".replace(".tssx", ".tsx"));
check("hero opens EventSource on /api/v2/agents/status", /new EventSource\("\/api\/v2\/agents\/status"\)/.test(hero));
check("hero poll fallback hits ?once=1", hero.includes("/api/v2/agents/status?once=1"));
check("hero honors heroPollMs (settings.agentsPage)", hero.includes("heroPollMs"));
check("hero handles snapshot AND event frames", hero.includes('"snapshot"') && hero.includes('"event"'));
check("hero location chip is honest telemetry (detail ?? em-dash, no fabricated positions)",
  /e\.detail \?\? "—"/.test(hero));
check("hero imports the shared palette (no local hex)", hero.includes("STATUS_BAND_COLORS") &&
  !/#34d399|#60a5fa|#fbbf24|#f87171|#9ca3af/.test(hero));

// ── StatusBand palette NO-FORK greps ────────────────────────────────────────
const bandHexes = /#34d399|#60a5fa|#fbbf24|#f87171|#9ca3af/;
{
  const dir = "src/components/v2/agents";
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}/${e.name}`);
      else files.push(`${d}/${e.name}`);
    }
  };
  walk(dir);
  // #fbbf24 appears in the reused ApprovalsStrip styling inside AgentsView
  // (pre-existing approval-amber, not a band fork) — the v2/agents tree itself
  // must contain NONE of the five band hexes outside imports.
  const offenders = files.filter((f) => bandHexes.test(read(f)));
  check("no band-palette hex forked anywhere under v2/agents (all via StatusBand import)",
    offenders.length === 0, offenders);
  const band = read("src/components/v2/StatusBand.tsx");
  check("StatusBand palette intact (CONVENTIONS §6)",
    band.includes('running: "#34d399"') && band.includes('idle: "#60a5fa"') &&
    band.includes('waiting: "#fbbf24"') && band.includes('error: "#f87171"') && band.includes('offline: "#9ca3af"'));
  const cards = read("src/components/v2/agents/AgentCardsGrid.tsx");
  check("cards grid renders the shared StatusBand (default import)",
    /import StatusBand from "@\/components\/v2\/StatusBand"/.test(cards) && cards.includes("<StatusBand"));
}

// ── reuse, not duplication (F5.1) ───────────────────────────────────────────
{
  const av = read("src/components/AgentsView.tsx");
  check("AgentsView exports the reusable pieces",
    /export function ApprovalsStrip/.test(av) && /export function RunView/.test(av) &&
    /export function TriggersEditor/.test(av) && /export function ModePicker/.test(av) && /export function IntelPicker/.test(av));
  const pageV2 = read("src/components/v2/agents/AgentsPageV2.tsx");
  check("AgentsPageV2 imports ApprovalsStrip (no duplicated approval markup)", pageV2.includes("ApprovalsStrip"));
  const wiz = read("src/components/v2/agents/ForgeWizard.tsx");
  check("wizard reuses ModePicker/IntelPicker/TriggersEditor/RunView from AgentsView",
    /from "@\/components\/AgentsView"/.test(wiz) && wiz.includes("TriggersEditor") && wiz.includes("RunView"));
}

// ── ForgeWizard contract (F4) ───────────────────────────────────────────────
{
  const wiz = read("src/components/v2/agents/ForgeWizard.tsx");
  for (const s of ["Idea", "Persona", "Harness", "Tools", "Connectors", "Permissions", "Triggers", "Review"]) {
    check(`wizard has the "${s}" step`, wiz.includes(`"${s}"`));
  }
  check("wizard creates in lifecycle test", wiz.includes('lifecycle: "test"'));
  check("wizard PATCHes the V2 fields (harnessId/persona/provider/browserSessions)",
    wiz.includes("harnessId") && wiz.includes("persona") && wiz.includes("provider") && wiz.includes("browserSessions"));
  check("wizard surfaces the deploy guard's 409 verbatim", wiz.includes("409") && wiz.includes("setErr(j.error"));
  check("wizard surfaces the warning-mode banner (CONVENTIONS §11)", wiz.includes("j.warning") && wiz.includes("setWarning"));
  check("wizard deploy = PATCH lifecycle deployed", wiz.includes('lifecycle: "deployed"'));
  check("wizard tolerates absent registries (webmcp/connectors/browser empty states)",
    wiz.includes("No WebMCP packages yet") && wiz.includes("No connectors yet") && wiz.includes("No browser sessions configured"));
  check("wizard's Draft-with-AI fails loudly (no silent fallback)", wiz.includes("draft failed") || wiz.includes("setDraftErr(j.error"));
}

// ── HarnessLibrary contract (F4.3) ──────────────────────────────────────────
{
  const lib = read("src/components/v2/agents/HarnessLibrary.tsx");
  check("library lists over /api/v2/harnesses with the includeExiled toggle", lib.includes("includeExiled=1"));
  check("library DELETE = exile (never the word delete in the UX)", lib.includes('method: "DELETE"') && /[Ee]xile/.test(lib));
  check("library surfaces the builtin-409 refusal", lib.includes("j.error"));
  check("library has the raw JSON toggle + structured editor", lib.includes("raw JSON") && lib.includes("systemPreamble"));
  check("library editor covers loop AND phases fields", lib.includes("maxIterations") && lib.includes("phases"));
}

// ── detail tabs (F5.2/F5.3) ─────────────────────────────────────────────────
{
  const detail = read("src/components/v2/agents/AgentDetail.tsx");
  check("detail has the four chunk-4 tabs", detail.includes('"overview"') && detail.includes('"runs"') &&
    detail.includes('"approvals"') && detail.includes('"settings"'));
  check("detail pulls the telemetry route (sessions + status history)", detail.includes("/telemetry"));
  const runs = read("src/components/v2/agents/tabs/RunsTab.tsx");
  check("Runs tab renders the browser-sessions sub-list + /browser link",
    runs.includes("session_name") && runs.includes("/browser"));
  check("Runs tab reuses RunView (seq-cursor transcript)", runs.includes("RunView"));
  const overview = read("src/components/v2/agents/tabs/OverviewTab.tsx");
  check("Overview has the lifecycle stepper with guarded deploy + surfaced 409/warning",
    overview.includes('"deployed"') && overview.includes("res.error") && overview.includes("res.warning"));
  const settings = read("src/components/v2/agents/tabs/SettingsTab.tsx");
  check("Settings tab edits EVERY V2 field (rule 16)",
    settings.includes("harnessId") && settings.includes("persona") && settings.includes("provider") && settings.includes("browserSessions"));
  check("Settings danger zone = exile (recoverable, never destroyed)",
    /Exile agent/.test(settings) && /recoverable, never destroyed/.test(settings));
  check("exile flow uses the existing DELETE route (agent exiled, recoverable)",
    detail.includes('method: "DELETE"') && detail.includes("recoverable"));
}

// ── gear pattern (rule 16) + §11 stub ───────────────────────────────────────
{
  const pageV2 = read("src/components/v2/agents/AgentsPageV2.tsx");
  check("page carries the ConfigMenu gear with AgentsSettings", pageV2.includes("ConfigMenu") && pageV2.includes("AgentsSettings"));
  const gs = read("src/components/v2/agents/AgentsSettings.tsx");
  check("gear covers agentsPage.heroPollMs", gs.includes("heroPollMs"));
  check("gear covers agentsPage.defaultHarness", gs.includes("defaultHarness"));
  check("gear stubs agents.requireTestRun (CONVENTIONS §11 ASK-YOSHI)", gs.includes("requireTestRun"));
  const st = read("src/lib/settings.ts");
  check("settings.ts declares agents.requireTestRun with the hard default",
    st.includes("requireTestRun") && st.includes("agents: { requireTestRun: true }"));
  const lcSrc = read("src/lib/v2/agents/lifecycle.ts");
  check("checkDeployGuard consults settings.agents.requireTestRun", lcSrc.includes("checkDeployGuard") && lcSrc.includes("requireTestRun"));
  const idRoute = read("src/app/api/agents/[id]/route.ts");
  check("PATCH route shares checkDeployGuard + passes the warning through",
    idRoute.includes("checkDeployGuard") && idRoute.includes("deployWarning"));
}

// ── route idioms + no-secret greps ──────────────────────────────────────────
{
  for (const r of ["src/app/api/v2/agents/[id]/telemetry/route.ts", "src/app/api/v2/agents/draft/route.ts"]) {
    const src = read(r);
    check(`${r} uses the route idiom (nodejs + force-dynamic + no-store)`,
      src.includes('runtime = "nodejs"') && src.includes('dynamic = "force-dynamic"') && src.includes("no-store"));
  }
  const draft = read("src/app/api/v2/agents/draft/route.ts");
  check("draft route fails loudly naming the provider (rule 11)", draft.includes("provider cli:${agent}"));
  const offenders = clientComponents.filter((f) => {
    const src = read(f);
    return /OLLAMA_API_KEY|AGENTOS_PASSWORD|secrets\.json|process\.env\.\w*(KEY|TOKEN|SECRET)/.test(src);
  });
  check("no secret/env references in client components", offenders.length === 0, offenders);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
