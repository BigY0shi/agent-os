"use client";

// SPEC-E F5.1 — the /agents page recomposition: AgentsHero (live status viz +
// wizard entry points) → approvals strip (reused from AgentsView — no
// duplicated markup) → AgentCardsGrid → Registry & Runs footer. The old
// AgentsView drawer's functions moved to /agents/[id] (AgentDetail tabs);
// its pickers/transcript components are imported, never duplicated.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Plus } from "lucide-react";
import type { ApprovalReq } from "@/lib/agentsTypes";
import type { BandStatus } from "@/lib/agentsTypes";
import { ApprovalsStrip, ago } from "@/components/AgentsView";
import ModelSettings from "@/components/ModelSettings";
import ConfigMenu from "@/components/ConfigMenu";
import { STATUS_COLORS } from "@/lib/agentsTypes";
import AgentsHero from "./AgentsHero";
import AgentCardsGrid from "./AgentCardsGrid";
import ForgeWizard from "./ForgeWizard";
import HarnessLibrary from "./HarnessLibrary";
import AgentsSettings from "./AgentsSettings";
import { AGENTS_ACCENT, type AgentCardData, type StatusEntry } from "./shared";

export default function AgentsPageV2() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentCardData[]>([]);
  const [approvals, setApprovals] = useState<ApprovalReq[]>([]);
  const [statuses, setStatuses] = useState<Record<string, { status: BandStatus; detail?: string }>>({});
  const [harnessNames, setHarnessNames] = useState<Record<string, string>>({});
  const [heroPollMs, setHeroPollMs] = useState(4000);
  const [wizard, setWizard] = useState<"forge" | "deploy" | null>(null);
  const [library, setLibrary] = useState(false);
  const [defaultHarness, setDefaultHarness] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch("/api/agents", { cache: "no-store" }).then((r) => r.json());
      if (Array.isArray(j.agents)) setAgents(j.agents);
      setLoaded(true);
    } catch { /* server asleep */ }
  }, []);

  const refreshApprovals = useCallback(async () => {
    try {
      const j = await fetch("/api/agents/approvals", { cache: "no-store" }).then((r) => r.json());
      if (Array.isArray(j.approvals)) setApprovals(j.approvals);
    } catch { /* fine */ }
  }, []);

  const refreshHarnessNames = useCallback(async () => {
    try {
      const j = await fetch("/api/v2/harnesses", { cache: "no-store" }).then((r) => r.json());
      if (Array.isArray(j.harnesses)) {
        setHarnessNames(Object.fromEntries(j.harnesses.map((h: { id: string; name: string }) => [h.id, h.name])));
      }
    } catch { /* fine */ }
  }, []);

  useEffect(() => {
    void refresh(); void refreshApprovals(); void refreshHarnessNames();
    fetch("/api/settings", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const ap = j?.settings?.agentsPage as { heroPollMs?: number; defaultHarness?: string } | undefined;
      if (typeof ap?.heroPollMs === "number") setHeroPollMs(ap.heroPollMs);
      if (typeof ap?.defaultHarness === "string") setDefaultHarness(ap.defaultHarness);
    }).catch(() => {});
    const a = setInterval(refresh, 5000);
    const b = setInterval(refreshApprovals, 3000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [refresh, refreshApprovals, refreshHarnessNames]);

  const onEntries = useCallback((entries: StatusEntry[]) => {
    setStatuses(Object.fromEntries(entries.map((e) => [e.agentId, { status: e.status, detail: e.detail }])));
  }, []);

  async function decide(id: string, decision: "allow" | "deny") {
    setApprovals((l) => l.filter((x) => x.id !== id));
    await fetch("/api/agents/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, decision }) }).catch(() => {});
  }

  // A parked question — the reply resumes the run inside its existing session.
  async function answer(id: string, text: string) {
    setApprovals((l) => l.filter((x) => x.id !== id));
    await fetch("/api/agents/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, answer: text }) }).catch(() => {});
    void refreshApprovals();
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold flex items-center gap-2.5" style={{ color: "var(--fg)" }}>
          <Bot size={20} style={{ color: AGENTS_ACCENT }} /> Agents
        </h1>
        <div className="flex items-center gap-2">
          <ModelSettings section="agentsModels" title="Agents intelligence dial" accent={AGENTS_ACCENT}
            fields={[
              { key: "fast", label: "Fast tier", placeholder: "claude-haiku-4-5", hint: "Cheap triage/routing runs." },
              { key: "standard", label: "Standard tier", placeholder: "claude-sonnet-5", hint: "The default for most agents; also the curator." },
              { key: "deep", label: "Deep tier", placeholder: "blank = pinned CLAUDE_MODEL", hint: "Research and judgment-heavy agents." },
            ]} />
          <ConfigMenu title="Agents page" accent={AGENTS_ACCENT}>
            <AgentsSettings />
          </ConfigMenu>
          <button onClick={() => setWizard("forge")}
            className="px-3.5 h-9 rounded-lg border text-[13px] flex items-center gap-1.5 transition hover:brightness-125"
            style={{ borderColor: `${AGENTS_ACCENT}66`, color: AGENTS_ACCENT, background: "rgba(167,139,250,0.10)" }}>
            <Plus size={14} /> New agent
          </button>
        </div>
      </div>
      <p className="text-[12.5px] mb-5" style={{ color: "var(--fg-dimmer)" }}>
        Reusable background agents — your tools, your subscriptions, your machine. Runs pause for approval before anything leaves the box.
      </p>

      <AgentsHero
        heroPollMs={heroPollMs}
        onEntries={onEntries}
        onDeploy={() => setWizard("deploy")}
        onForgeAgent={() => setWizard("forge")}
        onForgeHarness={() => setLibrary(true)}
      />

      <ApprovalsStrip approvals={approvals} onDecide={decide} onAnswer={(id, text) => void answer(id, text)} />

      {loaded && agents.length === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: "var(--panel-border)" }}>
          <Bot size={28} className="mx-auto mb-3" style={{ color: AGENTS_ACCENT }} />
          <div className="text-[14px] mb-1" style={{ color: "var(--fg)" }}>No agents yet</div>
          <div className="text-[12.5px] mb-4" style={{ color: "var(--fg-dimmer)" }}>
            Describe a standing job in plain English — triage my inbox, watch this feed, keep this report fresh.
          </div>
          <button onClick={() => setWizard("forge")} className="px-4 h-9 rounded-lg border text-[13px]" style={{ borderColor: `${AGENTS_ACCENT}66`, color: AGENTS_ACCENT }}>Forge the first one</button>
        </div>
      )}

      <AgentCardsGrid agents={agents} statuses={statuses} harnessNames={harnessNames} />

      {/* Registry & Runs footer — compact per-agent last-run registry. */}
      {agents.length > 0 && (
        <div id="agents-registry" className="mt-8">
          <div className="text-[11px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--fg-dimmer)" }}>Registry &amp; Runs</div>
          <div className="rounded-2xl border divide-y" style={{ borderColor: "var(--panel-border)" }}>
            {agents.map((a) => (
              <button key={a.id} onClick={() => router.push(`/agents/${a.id}?tab=runs`)}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3 text-[12.5px] transition hover:bg-white/[0.03]"
                style={{ borderColor: "var(--panel-border)" }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: a.lastRun ? STATUS_COLORS[a.lastRun.status] : "var(--panel-border)" }} />
                <span className="truncate" style={{ color: "var(--fg)" }}>{a.name}</span>
                <span className="font-mono text-[10.5px] ml-auto shrink-0" style={{ color: "var(--fg-dimmer)" }}>
                  {a.lastRun ? `${a.lastRun.trigger} · ${a.lastRun.status} · ${ago(a.lastRun.startedAt)}` : "never run"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {wizard && (
        <ForgeWizard
          mode={wizard}
          defaultHarness={defaultHarness}
          onClose={() => { setWizard(null); void refresh(); }}
          onForgeHarness={() => setLibrary(true)}
          onDone={(id) => { setWizard(null); router.push(`/agents/${id}`); }}
        />
      )}
      {library && <HarnessLibrary onClose={() => setLibrary(false)} onChanged={() => void refreshHarnessNames()} />}
    </div>
  );
}
