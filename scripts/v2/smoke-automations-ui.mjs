// SPEC-D G5.3 §6.3 smoke: the /automations UI contract (static file/regex
// checks, house *-ui pattern — the dynamic engine/route legs live in
// smoke-automations.mjs). Covers: files + 'use client' + default exports,
// page + Sidebar Workspace membership (§6.2 Set gotcha), gear rule 16
// (automations.enabled kill switch), sentence rendering, builder sections
// (trigger picker incl. custom, condition rows w/ op whitelist from the API,
// action rows incl. run_tool account/tool pickers + RED confirm checkbox +
// {{payload.*}} hint), test-with-sample panel wired to /test, RunsDrawer
// wired to /runs, and the routes the components call all existing.
// Run: npx tsx scripts/v2/smoke-automations-ui.mjs
import path from "node:path";
import fs from "node:fs";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

// ── files exist + 'use client' + default exports ────────────────────────────
const componentFiles = [
  "src/components/v2/automations/AutomationsView.tsx",
  "src/components/v2/automations/RuleBuilder.tsx",
  "src/components/v2/automations/RunsDrawer.tsx",
];
for (const f of componentFiles) {
  check(`${f} exists`, exists(f));
  if (exists(f)) {
    check(`${f} is 'use client'`, /^"use client";/.test(read(f)));
    check(`${f} has a default export`, /export default function \w+/.test(read(f)));
  }
}

// ── page + sidebar (§6.2) ───────────────────────────────────────────────────
check("src/app/automations/page.tsx exists", exists("src/app/automations/page.tsx"));
const page = read("src/app/automations/page.tsx");
check("page renders AutomationsView", page.includes('from "@/components/v2/automations/AutomationsView"') && page.includes("<AutomationsView />"));
const sidebar = read("src/components/Sidebar.tsx");
check("Sidebar has the /automations NAV entry (Zap, amber accent)", sidebar.includes('href: "/automations"') && sidebar.includes("#fcd34d"));
{
  const workspace = sidebar.match(/WORKSPACE_ROUTES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  const orch = sidebar.match(/ORCHESTRATION_ROUTES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  const agents = sidebar.match(/AGENT_ROUTES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  check("/automations lands in 'Workspace' via the Set (§6.2 gotcha: membership, not NAV order)",
    workspace.includes("/automations") && !orch.includes("/automations") && !agents.includes("/automations"));
}

// ── view: header, kill switch, gear (rule 16), sentence rendering ───────────
const view = read("src/components/v2/automations/AutomationsView.tsx");
check("view polls /api/v2/automations via usePollWhileVisible", view.includes('fetch("/api/v2/automations"') && view.includes("usePollWhileVisible"));
check("view has the engine on/off chip writing settings.automations.enabled", view.includes("enabled: !engineEnabled"));
check("view mounts the gear (ConfigMenu) with the kill-switch panel", view.includes("<ConfigMenu") && view.includes("AutomationsSettingsPanel"));
check("gear kill switch writes settings.automations.enabled (rule 16: in-app, not config-file-only)",
  view.includes("automations: { ...automationsSettings, enabled: e.target.checked }"));
check("rule rows use When/if/then sentence rendering (§6.3)",
  view.includes('label="When"') || (view.includes('"When"') && view.includes('"if"') && view.includes('"then"')));
check("rule list has active toggle + Edit + Runs affordances", view.includes("onToggle") && view.includes("onEdit") && view.includes("onRuns"));
check("active toggle PATCHes isActive", view.includes('method: "PATCH"') && view.includes("isActive: !rule.isActive"));

// ── builder: trigger picker, conditions, actions, confirm checkbox, test ────
const builder = read("src/components/v2/automations/RuleBuilder.tssx".replace(".tssx", ".tsx"));
check("builder trigger picker offers known events + a custom lane", builder.includes("available.triggers.map") && builder.includes("Custom event"));
check("builder condition ops come from the API whitelist (no hardcoded op list)", builder.includes("available.conditionOps.map"));
check("builder run_tool has account + tool pickers from the live routes",
  builder.includes('fetch("/api/v2/integrations"') && builder.includes("/api/v2/integrations/accounts/${accountId}/tools"));
check("builder shows the RED destructive confirm checkbox tied to the tool's annotation",
  builder.includes("destructiveHint === true") && builder.includes("confirmDestructive") && builder.includes("#f87171"));
check("builder surfaces the {{payload.*}} template hint", builder.includes("{{payload.*}}"));
check("builder test panel POSTs /api/v2/automations/test with an inline rule (dry-run)",
  builder.includes('"/api/v2/automations/test"') && builder.includes("samplePayload"));
check("builder save POSTs new rules / PATCHes existing ones + renders the 422 error",
  builder.includes('rule ? "PATCH" : "POST"') && builder.includes("setError(j?.error"));

// ── runs drawer ─────────────────────────────────────────────────────────────
const drawer = read("src/components/v2/automations/RunsDrawer.tsx");
check("RunsDrawer fetches /api/v2/automations/runs?ruleId=", drawer.includes("/api/v2/automations/runs?ruleId="));
check("RunsDrawer shows status chips + error + detail expander",
  drawer.includes("condition_miss") && drawer.includes("action_failed") && drawer.includes("run.error") && drawer.includes("detail"));

// ── components ↔ live routes ────────────────────────────────────────────────
const allCmp = componentFiles.map((f) => read(f)).join("\n");
const routeMap = [
  ["/api/v2/automations", "src/app/api/v2/automations/route.ts"],
  ["/api/v2/automations/runs", "src/app/api/v2/automations/runs/route.ts"],
  ["/api/v2/automations/test", "src/app/api/v2/automations/test/route.ts"],
  ["/api/v2/attention", "src/app/api/v2/attention/route.ts"], // H4.1 §5.8 (hero UI is Phase 6)
];
for (const [frag, routeFile] of routeMap) {
  check(`route file exists for …${frag}`, exists(routeFile), routeFile);
}
for (const frag of ["/api/v2/automations", "/api/v2/automations/runs", "/api/v2/automations/test"]) {
  check(`a component calls …${frag}`, allCmp.includes(frag));
}

// ── §8 risk 11 discipline: no eval anywhere in the automations surface ──────
const engineSrc = read("src/lib/v2/automations/engine.ts") + read("src/lib/v2/automations/types.ts") + allCmp;
check("NO eval / Function constructor anywhere in automations code",
  !/\beval\s*\(/.test(engineSrc) && !/new Function\s*\(/.test(engineSrc) && !/Function\s*\(\s*["'`]/.test(engineSrc));
check("client-safe types module has no node imports", !/from "node:/.test(read("src/lib/v2/automations/types.ts")));

console.log(failures === 0 ? "\nsmoke-automations-ui: ALL PASS" : `\nsmoke-automations-ui: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
