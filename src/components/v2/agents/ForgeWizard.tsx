"use client";

// SPEC-E F4 — ForgeWizard. Multi-step agent creation: Idea → Persona →
// Harness → Tools → Connectors → Permissions & model → Triggers → Review &
// Test. State is held client-side; [Create in Test] does the existing
// POST /api/agents + one PATCH with the V2 fields and lifecycle:"test"
// (trigger tick skips test agents — F1.2); [Deploy] PATCHes
// lifecycle:"deployed" through the chunk-3 deploy guard and SURFACES the 409
// ("run the agent in Test first") or the warning (agents.requireTestRun off —
// CONVENTIONS §11 warning mode) as an amber banner.
//
// The test-run step also renders THIS run's approvals inline (the shared
// ApprovalsStrip from AgentsView) and disables backdrop click-to-close while the
// run is live — the page's own strip sits under the overlay, so releasing a
// `waiting` run used to cost you the transcript (2026-08-28 UX defect).
//
// "Deploy Agent" mode opens straight at the review step listing existing
// lifecycle:"test" agents to promote.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hammer, X, Loader2, ChevronLeft, ChevronRight, Play, Rocket, Sparkles, AlertTriangle } from "lucide-react";
import type { AgentDef, AgentPersona, AgentProvider, AgentTrigger, ApprovalReq } from "@/lib/agentsTypes";
import { ModePicker, IntelPicker, TriggersEditor, RunView, ApprovalsStrip } from "@/components/AgentsView";
import { STATUS_BAND_COLORS } from "@/components/v2/StatusBand";
import { AGENTS_ACCENT, type AgentCardData } from "./shared";
import { postDecision, decisionNotice } from "@/lib/agentsApprovalsClient";

interface HarnessCard { id: string; name: string; description: string; kind: string }

const STEPS = ["Idea", "Persona", "Harness", "Tools", "Connectors", "Permissions", "Triggers", "Review"] as const;

export default function ForgeWizard({
  mode,
  defaultHarness,
  onClose,
  onForgeHarness,
  onDone,
}: {
  /** "forge" = full wizard; "deploy" = review step for an existing test agent. */
  mode: "forge" | "deploy";
  defaultHarness?: string;
  onClose: () => void;
  onForgeHarness: () => void;
  onDone: (agentId: string) => void;
}) {
  const [step, setStep] = useState(0);

  // Step 1 — Idea.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);

  // Step 2 — Persona (rule 17: a plain data record, provider-agnostic).
  const [usePersona, setUsePersona] = useState(false);
  const [pName, setPName] = useState("");
  const [pVoice, setPVoice] = useState("");
  const [pAudience, setPAudience] = useState("");
  const [pBanned, setPBanned] = useState("");
  const [pCta, setPCta] = useState("");

  // Step 3 — Harness (required; default oneshot-plain).
  const [harnesses, setHarnesses] = useState<HarnessCard[]>([]);
  const [harnessId, setHarnessId] = useState(defaultHarness || "oneshot-plain");

  // Step 4 — Tools.
  const [mcp, setMcp] = useState<"inherit" | "none">("inherit");
  const [browser, setBrowser] = useState(false);
  const [browserSessions, setBrowserSessions] = useState<string[]>([]);
  const [availableSessions, setAvailableSessions] = useState<string[]>([]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [webmcpPackages, setWebmcpPackages] = useState<{ slug: string; name: string }[]>([]);

  // Step 5 — Connectors.
  const [connectorIds, setConnectorIds] = useState<string[]>([]);
  const [connectors, setConnectors] = useState<{ id: string; name: string }[]>([]);

  // Step 6 — Permissions & model.
  const [permissionMode, setPermissionMode] = useState<AgentDef["permissionMode"]>("gated");
  const [intelligence, setIntelligence] = useState<AgentDef["intelligence"]>("standard");
  const [providerKind, setProviderKind] = useState<"sdk" | "cli" | "ollama">("sdk");
  const [providerArg, setProviderArg] = useState("");

  // Step 7 — Triggers.
  const [triggers, setTriggers] = useState<AgentTrigger[]>([{ type: "manual" }]);

  // Step 8 — Review & Test.
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [testRunStatus, setTestRunStatus] = useState<string | null>(null);
  const [deployed, setDeployed] = useState(false);
  // Approvals for THIS run only — see the pollRun comment for why they live here.
  const [approvals, setApprovals] = useState<ApprovalReq[]>([]);
  /** Ids already decided here; keeps an in-flight poll from re-adding a resolved row. */
  const resolvedRef = useRef<Set<string>>(new Set());
  /** Why a decision did nothing, when it did nothing. Cleared on the next one. */
  const [notice, setNotice] = useState<string | null>(null);
  /** The last deploy 409 was the overridable one (missing test run). */
  const [canForce, setCanForce] = useState(false);

  // Deploy mode — existing test agents to promote.
  const [testAgents, setTestAgents] = useState<AgentCardData[]>([]);

  useEffect(() => {
    fetch("/api/v2/harnesses", { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (Array.isArray(j.harnesses)) setHarnesses(j.harnesses); })
      .catch(() => {});
    fetch("/api/v2/browser/sessions", { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (Array.isArray(j.sessions)) setAvailableSessions(j.sessions.map((s: { name: string }) => s.name)); })
      .catch(() => {}); // E absent → empty state
    fetch("/api/v2/webmcp/packages", { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (Array.isArray(j.packages)) setWebmcpPackages(j.packages); })
      .catch(() => {}); // Fd4 absent → empty state
    fetch("/api/v2/integrations", { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (Array.isArray(j.connectors)) setConnectors(j.connectors.map((c: { id?: string; slug?: string; name: string }) => ({ id: c.id ?? c.slug ?? c.name, name: c.name }))); })
      .catch(() => {}); // G absent → empty state
    if (mode === "deploy") {
      fetch("/api/agents", { cache: "no-store" }).then((r) => r.json())
        .then((j) => { if (Array.isArray(j.agents)) setTestAgents((j.agents as AgentCardData[]).filter((a) => a.lifecycle === "test")); })
        .catch(() => {});
    }
  }, [mode]);

  // Poll the created agent's latest run while the test run is live — and, on
  // the same tick, the approvals belonging to THAT run.
  //
  // 2026-08-28 UX defect: the wizard is a full-screen overlay and the only
  // approvals surface lived on the page underneath it, so a test run parked at
  // `waiting` could only be released by dismissing the wizard — which unmounted
  // the live transcript. Same shared ApprovalsStrip, scoped here to this run.
  // Filtering client-side off the global queue is the house pattern (AgentDetail).
  const pollRun = useCallback(async () => {
    if (!createdId) return;
    try {
      const j = await fetch(`/api/agents/${createdId}`, { cache: "no-store" }).then((r) => r.json());
      const latest = j.runs?.[0];
      if (latest) {
        setTestRunStatus(latest.status);
        if (!testRunId) setTestRunId(latest.id);
      }
    } catch { /* fine */ }
    try {
      const a = await fetch("/api/agents/approvals", { cache: "no-store" }).then((r) => r.json());
      if (Array.isArray(a.approvals)) {
        setApprovals((a.approvals as ApprovalReq[]).filter((x) =>
          x.agentId === createdId && (!testRunId || x.runId === testRunId) && !resolvedRef.current.has(x.id)));
      }
    } catch { /* fine */ }
  }, [createdId, testRunId]);

  useEffect(() => {
    if (!createdId || testRunStatus === "done" || testRunStatus === "error") return;
    void pollRun(); // don't make a waiting run sit an extra tick before its approval shows
    const t = setInterval(() => void pollRun(), 2500);
    return () => clearInterval(t);
  }, [createdId, testRunStatus, pollRun]);

  /** Resolve an approval from inside the wizard. ONE decision POST — the page's
   *  own strip re-polls the same global queue and drops the row on its own, so
   *  nothing is posted twice. */
  async function decideApproval(id: string, decision: "allow" | "deny") {
    resolvedRef.current.add(id);
    setApprovals((l) => l.filter((x) => x.id !== id));
    setNotice(decisionNotice(await postDecision(id, decision)));
    void pollRun();
  }

  const persona: AgentPersona | null = useMemo(() => {
    if (!usePersona || !pName.trim() || !pVoice.trim()) return null;
    return {
      name: pName.trim(),
      voiceRules: pVoice,
      audience: pAudience.trim() || undefined,
      bannedPhrases: pBanned.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      ctaStyle: pCta.trim() || undefined,
    };
  }, [usePersona, pName, pVoice, pAudience, pBanned, pCta]);

  const provider: AgentProvider | null = useMemo(() => {
    if (providerKind === "cli" && providerArg.trim()) return { kind: "cli", agent: providerArg.trim() };
    if (providerKind === "ollama" && providerArg.trim()) return { kind: "ollama", model: providerArg.trim() };
    return null; // sdk = absent (today's default path)
  }, [providerKind, providerArg]);

  async function draftWithAI() {
    if (!instructions.trim() && !description.trim() && !name.trim()) { setDraftErr("Give it at least a name or a one-liner first."); return; }
    setDrafting(true); setDraftErr(null);
    try {
      const r = await fetch("/api/v2/agents/draft", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ idea: `${name}\n${description}\n${instructions}`.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.draft) setDraftErr(j.error ?? `draft failed (${r.status})`); // rule 11: fail loudly, never silent
      else setInstructions(j.draft);
    } catch (e) { setDraftErr(String((e as Error)?.message ?? e)); }
    setDrafting(false);
  }

  /** [Create in Test] — POST create + PATCH the V2 fields, lifecycle "test". */
  async function createInTest() {
    if (!name.trim() || !instructions.trim()) { setErr("Name (step 1) and instructions are required."); return; }
    setBusy(true); setErr(null);
    try {
      const created = await fetch("/api/agents", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, instructions, permissionMode, intelligence }),
      }).then((r) => r.json());
      if (!created.agent?.id) { setErr(created.error ?? "create failed"); setBusy(false); return; }
      const id = created.agent.id as string;
      const patchRes = await fetch(`/api/agents/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lifecycle: "test",
          harnessId,
          persona,
          provider,
          triggers,
          toolIds,
          connectorIds,
          browserSessions: browser ? browserSessions : [],
        }),
      });
      const patched = await patchRes.json().catch(() => ({}));
      if (!patchRes.ok) { setErr(patched.error ?? `V2 field save failed (${patchRes.status})`); setBusy(false); return; }
      setCreatedId(id);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    setBusy(false);
  }

  async function fireTestRun() {
    if (!createdId) return;
    setErr(null);
    const r = await fetch(`/api/agents/${createdId}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error ?? `run failed (${r.status})`); return; }
    if (j.runId) setTestRunId(j.runId);
    setTestRunStatus("running");
  }

  /** [Deploy] — the guard's 409 is surfaced verbatim; warning mode banners. */
  /** `force` sends the per-deploy override for the test-run gate. The setting is
   *  untouched — the next deploy is gated again. Only offered when the 409 said
   *  `overridable`, so the un-overridable block (no trigger) shows no way out. */
  async function deploy(agentId: string, force = false) {
    setBusy(true); setErr(null); setWarning(null); setCanForce(false);
    try {
      const r = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify(force ? { lifecycle: "deployed", forceDeploy: true } : { lifecycle: "deployed" }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) {
        setErr(j.error ?? "deploy blocked (409)");
        setCanForce(j.overridable === true);
        setBusy(false); return;
      }
      if (!r.ok) { setErr(j.error ?? `deploy failed (${r.status})`); setBusy(false); return; }
      if (j.warning) setWarning(j.warning);
      setDeployed(true);
      setCreatedId(agentId);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    setBusy(false);
  }

  const isReview = mode === "deploy" || step === STEPS.length - 1;

  /** An agent exists and isn't deployed yet — the test-run step is on screen,
   *  holding a live transcript and this run's approvals. Backdrop click-to-close
   *  is DISABLED for that window (2026-08-28: a stray click threw away a running
   *  transcript). The X button is always the explicit way out. */
  const runLive = !!createdId && !deployed;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={runLive ? undefined : onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border p-5 space-y-4"
        style={{ borderColor: `${AGENTS_ACCENT}44`, background: "rgba(14,16,26,0.98)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-medium flex items-center gap-2" style={{ color: "var(--fg)" }}>
            {mode === "deploy" ? <><Rocket size={15} className="text-emerald-300" /> Deploy Agent</> : <><Hammer size={15} style={{ color: AGENTS_ACCENT }} /> Forge Agent</>}
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--fg-dim)" }}><X size={15} /></button>
        </div>

        {mode === "forge" && (
          <div className="flex items-center gap-1 flex-wrap">
            {STEPS.map((s, i) => (
              <button key={s} onClick={() => !createdId && setStep(i)} disabled={!!createdId}
                className="px-2 h-6 rounded-md text-[10px] font-mono uppercase tracking-wider border transition disabled:opacity-50"
                style={{
                  borderColor: i === step ? AGENTS_ACCENT : "var(--panel-border)",
                  color: i === step ? AGENTS_ACCENT : i < step ? "var(--fg-dim)" : "var(--fg-dimmer)",
                  background: i === step ? "rgba(167,139,250,0.12)" : "transparent",
                }}>
                {s}
              </button>
            ))}
          </div>
        )}

        {/* ── deploy mode: pick a test agent ── */}
        {mode === "deploy" && !createdId && !deployed && (
          <div className="space-y-2">
            <p className="text-[12.5px]" style={{ color: "var(--fg-dim)" }}>
              Promote an agent from Test to Deployed — its triggers start firing on the next tick.
            </p>
            {testAgents.length === 0 && (
              <div className="text-[12px] rounded-lg border border-dashed p-4 text-center" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dimmer)" }}>
                No agents in Test. Forge one first — the wizard creates agents in Test lifecycle.
              </div>
            )}
            {testAgents.map((a) => (
              <div key={a.id} className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: "var(--panel-border)" }}>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate" style={{ color: "var(--fg)" }}>{a.name}</div>
                  <div className="text-[11px] font-mono" style={{ color: "var(--fg-dimmer)" }}>
                    {a.lastRun ? `last run ${a.lastRun.status}` : "never run"}
                  </div>
                </div>
                <button onClick={() => void deploy(a.id)} disabled={busy}
                  className="px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5 disabled:opacity-40 text-emerald-300"
                  style={{ borderColor: "rgba(52,211,153,0.5)", background: "rgba(52,211,153,0.08)" }}>
                  <Rocket size={12} /> Deploy
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── forge steps ── */}
        {mode === "forge" && !createdId && (
          <>
            {step === 0 && (
              <div className="space-y-3">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — e.g. Inbox Triage" autoFocus
                  className="w-full bg-black/30 border rounded-lg px-3.5 h-10 text-sm outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One-liner for the card (optional)"
                  className="w-full bg-black/30 border rounded-lg px-3.5 h-10 text-sm outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={8}
                  placeholder={"Standing instructions — what this agent does every time it runs (becomes system.md).\nFreeform ideation is fine; Draft with AI can tighten it."}
                  className="w-full bg-black/30 border rounded-lg px-3.5 py-2.5 text-sm outline-none resize-y" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                <div className="flex items-center gap-2">
                  <button onClick={() => void draftWithAI()} disabled={drafting}
                    className="px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5 disabled:opacity-40"
                    style={{ borderColor: `${AGENTS_ACCENT}55`, color: AGENTS_ACCENT }}>
                    {drafting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Draft with AI
                  </button>
                  {draftErr && <span className="text-[11.5px] text-rose-300">{draftErr}</span>}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--fg-dim)" }}>
                  <input type="checkbox" checked={usePersona} onChange={(e) => setUsePersona(e.target.checked)} />
                  Give this agent a writing persona (model-agnostic data record — injected at draft time whatever the provider)
                </label>
                {usePersona && (
                  <div className="space-y-2.5">
                    <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Persona name — e.g. Launchworks house voice"
                      className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                    <textarea value={pVoice} onChange={(e) => setPVoice(e.target.value)} rows={4} placeholder="Voice rules — tone, sentence length, stance…"
                      className="w-full bg-black/30 border rounded-lg px-3 py-2 text-[12.5px] outline-none resize-y" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                    <input value={pAudience} onChange={(e) => setPAudience(e.target.value)} placeholder="Audience (optional)"
                      className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                    <textarea value={pBanned} onChange={(e) => setPBanned(e.target.value)} rows={2} placeholder="Banned phrases — one per line or comma-separated"
                      className="w-full bg-black/30 border rounded-lg px-3 py-2 text-[12.5px] outline-none resize-y" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                    <input value={pCta} onChange={(e) => setPCta(e.target.value)} placeholder="CTA style (optional)"
                      className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12.5px] outline-none" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                  </div>
                )}
                {!usePersona && <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>No persona — the agent writes in its default voice.</div>}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px]" style={{ color: "var(--fg-dim)" }}>Pick the operating harness (required — default is a plain single run).</span>
                  <button onClick={onForgeHarness} className="text-[11.5px]" style={{ color: AGENTS_ACCENT }}>Forge Harness →</button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {harnesses.map((h) => (
                    <button key={h.id} onClick={() => setHarnessId(h.id)}
                      className="text-left rounded-xl border p-3 transition"
                      style={{ borderColor: harnessId === h.id ? AGENTS_ACCENT : "var(--panel-border)", background: harnessId === h.id ? "rgba(167,139,250,0.08)" : "rgba(255,255,255,0.02)" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px] font-medium" style={{ color: "var(--fg)" }}>{h.name}</span>
                        <span className="text-[9.5px] font-mono uppercase px-1.5 py-0.5 rounded border" style={{ borderColor: `${AGENTS_ACCENT}44`, color: AGENTS_ACCENT }}>{h.kind}</span>
                      </div>
                      <div className="text-[11.5px] line-clamp-2" style={{ color: "var(--fg-dim)" }}>{h.description}</div>
                    </button>
                  ))}
                  {harnesses.length === 0 && <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>Harness library unreachable — the default oneshot-plain will be used.</div>}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "var(--fg-dimmer)" }}>MCP fleet</div>
                  <div className="flex gap-1.5">
                    {(["inherit", "none"] as const).map((m) => (
                      <button key={m} onClick={() => setMcp(m)} className="flex-1 h-8 rounded-lg border text-[11.5px]"
                        style={{ borderColor: mcp === m ? AGENTS_ACCENT : "var(--panel-border)", color: mcp === m ? AGENTS_ACCENT : "var(--fg-dim)" }}>
                        {m === "inherit" ? "Inherit MCP servers" : "No MCP"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-[12.5px] cursor-pointer mb-1.5" style={{ color: "var(--fg-dim)" }}>
                    <input type="checkbox" checked={browser} onChange={(e) => setBrowser(e.target.checked)} /> Browser tools
                  </label>
                  {browser && (
                    availableSessions.length > 0 ? (
                      <div className="flex gap-1.5 flex-wrap">
                        {availableSessions.map((s) => (
                          <button key={s} onClick={() => setBrowserSessions((l) => l.includes(s) ? l.filter((x) => x !== s) : [...l, s])}
                            className="px-2.5 h-7 rounded-md border text-[11px] font-mono"
                            style={{ borderColor: browserSessions.includes(s) ? "#38bdf8" : "var(--panel-border)", color: browserSessions.includes(s) ? "#38bdf8" : "var(--fg-dim)" }}>
                            {s}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>No browser sessions configured — add them on /browser first.</div>
                    )
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "var(--fg-dimmer)" }}>WebMCP tool packages</div>
                  {webmcpPackages.length > 0 ? (
                    <div className="flex gap-1.5 flex-wrap">
                      {webmcpPackages.map((p) => (
                        <button key={p.slug} onClick={() => setToolIds((l) => l.includes(p.slug) ? l.filter((x) => x !== p.slug) : [...l, p.slug])}
                          className="px-2.5 h-7 rounded-md border text-[11px]"
                          style={{ borderColor: toolIds.includes(p.slug) ? AGENTS_ACCENT : "var(--panel-border)", color: toolIds.includes(p.slug) ? AGENTS_ACCENT : "var(--fg-dim)" }}>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>No WebMCP packages yet — build them on /webmcp.</div>
                  )}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--fg-dimmer)" }}>Connectors</div>
                {connectors.length > 0 ? (
                  <div className="flex gap-1.5 flex-wrap">
                    {connectors.map((c) => (
                      <button key={c.id} onClick={() => setConnectorIds((l) => l.includes(c.id) ? l.filter((x) => x !== c.id) : [...l, c.id])}
                        className="px-2.5 h-7 rounded-md border text-[11px]"
                        style={{ borderColor: connectorIds.includes(c.id) ? AGENTS_ACCENT : "var(--panel-border)", color: connectorIds.includes(c.id) ? AGENTS_ACCENT : "var(--fg-dim)" }}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>No connectors yet — connect accounts on /integrations first.</div>
                )}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <ModePicker value={permissionMode} onChange={setPermissionMode} />
                  <IntelPicker value={intelligence} onChange={setIntelligence} />
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "var(--fg-dimmer)" }}>Provider</div>
                  <div className="flex gap-1.5 mb-2">
                    {(["sdk", "cli", "ollama"] as const).map((k) => (
                      <button key={k} onClick={() => { setProviderKind(k); setProviderArg(""); }}
                        className="flex-1 h-8 rounded-lg border text-[11.5px] font-mono"
                        style={{ borderColor: providerKind === k ? AGENTS_ACCENT : "var(--panel-border)", color: providerKind === k ? AGENTS_ACCENT : "var(--fg-dim)" }}>
                        {k}
                      </button>
                    ))}
                  </div>
                  {providerKind !== "sdk" && (
                    <input value={providerArg} onChange={(e) => setProviderArg(e.target.value)}
                      placeholder={providerKind === "cli" ? "CLI agent — e.g. claude, codex, agy, hermes" : "Ollama model — e.g. glm-5.2:cloud"}
                      className="w-full bg-black/30 border rounded-lg px-3 h-9 text-[12px] outline-none font-mono" style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }} />
                  )}
                  <div className="text-[11px] mt-1.5" style={{ color: "var(--fg-dimmer)" }}>
                    cli/ollama runs are text-only completion lanes and FAIL LOUDLY if the provider is unreachable — never a silent SDK fallback.
                  </div>
                </div>
              </div>
            )}

            {step === 6 && (
              <TriggersEditor
                agent={{
                  id: "wizard-preview", name, description, permissionMode, intelligence,
                  triggers, tools: { mcp, browser }, enabled: true, createdAt: 0, updatedAt: 0,
                } as AgentDef}
                onSave={setTriggers}
              />
            )}

            {step === 7 && (
              <div className="space-y-2 text-[12.5px]" style={{ color: "var(--fg-dim)" }}>
                <div className="rounded-xl border p-3.5 space-y-1.5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
                  <ReviewLine k="Name" v={name || "(missing)"} />
                  <ReviewLine k="Harness" v={harnesses.find((h) => h.id === harnessId)?.name ?? harnessId} />
                  <ReviewLine k="Persona" v={persona ? persona.name : "none"} />
                  <ReviewLine k="Provider" v={provider ? (provider.kind === "cli" ? `cli:${provider.agent}` : `ollama:${provider.model}`) : "sdk"} />
                  <ReviewLine k="Permissions" v={`${permissionMode} · ${intelligence}`} />
                  <ReviewLine k="Tools" v={`mcp:${mcp}${browser ? ` · browser(${browserSessions.length ? browserSessions.join(",") : "no sessions"})` : ""}${toolIds.length ? ` · webmcp:${toolIds.length}` : ""}`} />
                  <ReviewLine k="Connectors" v={connectorIds.length ? connectorIds.join(", ") : "none"} />
                  <ReviewLine k="Triggers" v={triggers.map((t) => t.type).join(", ") || "none"} />
                </div>
                <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>
                  Creates in <b>Test</b> lifecycle: triggers stay parked until Deploy; manual test runs work.
                </div>
              </div>
            )}
          </>
        )}

        {/* ── created: test run + deploy ── */}
        {createdId && !deployed && (
          <div className="space-y-3">
            <div className="text-[12.5px]" style={{ color: "var(--fg-dim)" }}>
              Agent created in <b>Test</b>. Fire a test run — Deploy unlocks after it finishes <span className="text-emerald-300">done</span>.
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => void fireTestRun()} disabled={testRunStatus === "running" || testRunStatus === "waiting"}
                className="px-3 h-9 rounded-lg border text-[12.5px] flex items-center gap-1.5 disabled:opacity-40 text-emerald-300"
                style={{ borderColor: "rgba(52,211,153,0.5)", background: "rgba(52,211,153,0.08)" }}>
                <Play size={13} /> Run test
              </button>
              <button onClick={() => void deploy(createdId)} disabled={busy}
                className="px-3 h-9 rounded-lg border text-[12.5px] flex items-center gap-1.5 disabled:opacity-40"
                style={{ borderColor: testRunStatus === "done" ? "rgba(52,211,153,0.5)" : "var(--panel-border)", color: testRunStatus === "done" ? STATUS_BAND_COLORS.running : "var(--fg-dim)" }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />} Deploy
              </button>
              {testRunStatus && <span className="text-[11px] font-mono" style={{ color: "var(--fg-dimmer)" }}>test run: {testRunStatus}</span>}
            </div>
            {/* This run's approvals, inline — the same shared strip the page uses. */}
            {notice && (
              <div className="rounded-xl border px-3.5 py-2.5 text-[12.5px]"
                style={{ borderColor: "rgba(251,191,36,0.45)", background: "rgba(251,191,36,0.07)", color: "var(--fg-dim)" }}>
                {notice}
              </div>
            )}
            <ApprovalsStrip approvals={approvals} onDecide={(id, d) => void decideApproval(id, d)} />
            {testRunId && <RunView agentId={createdId} runId={testRunId} />}
          </div>
        )}

        {deployed && createdId && (
          <div className="rounded-xl border p-4 text-[13px]" style={{ borderColor: "rgba(52,211,153,0.4)", background: "rgba(52,211,153,0.06)", color: "var(--fg)" }}>
            Deployed — triggers are live on the next tick.
            <button onClick={() => onDone(createdId)} className="ml-3 text-[12px] underline" style={{ color: STATUS_BAND_COLORS.running }}>Open agent →</button>
          </div>
        )}

        {warning && (
          <div className="rounded-lg border px-3 py-2 text-[12px] text-amber-300 flex items-center gap-2" style={{ borderColor: "rgba(251,191,36,0.5)", background: "rgba(251,191,36,0.06)" }}>
            <AlertTriangle size={13} /> {warning}
          </div>
        )}
        {err && (
          <div className="rounded-lg border px-3 py-2 text-[12px] text-rose-300" style={{ borderColor: "rgba(248,113,113,0.5)", background: "rgba(248,113,113,0.06)" }}>
            <div className="flex items-center gap-2"><AlertTriangle size={13} /> {err}</div>
            {/* Only for the overridable block. The trigger block offers nothing,
                because forcing it would deploy an agent that cannot ever fire. */}
            {canForce && createdId && (
              <div className="mt-2 flex items-center gap-2.5">
                <button onClick={() => void deploy(createdId, true)} disabled={busy}
                  className="px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5 disabled:opacity-40 transition hover:brightness-125"
                  style={{ borderColor: "rgba(251,191,36,0.55)", color: STATUS_BAND_COLORS.waiting, background: "rgba(251,191,36,0.08)" }}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />} Deploy anyway
                </button>
                <span className="text-[11px]" style={{ color: "var(--fg-dimmer)" }}>
                  Overrides this deploy only — the gate stays on for the next one.
                </span>
              </div>
            )}
          </div>
        )}

        {mode === "forge" && !createdId && (
          <div className="flex items-center justify-between pt-1">
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}
              className="px-3 h-9 rounded-lg border text-[12.5px] flex items-center gap-1 disabled:opacity-30"
              style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
              <ChevronLeft size={13} /> Back
            </button>
            {isReview ? (
              <button onClick={() => void createInTest()} disabled={busy}
                className="px-4 h-9 rounded-lg border text-[12.5px] flex items-center gap-1.5 disabled:opacity-40"
                style={{ borderColor: `${AGENTS_ACCENT}66`, color: AGENTS_ACCENT, background: "rgba(167,139,250,0.10)" }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Hammer size={13} />} Create in Test
              </button>
            ) : (
              <button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                className="px-4 h-9 rounded-lg border text-[12.5px] flex items-center gap-1"
                style={{ borderColor: `${AGENTS_ACCENT}66`, color: AGENTS_ACCENT }}>
                Next <ChevronRight size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 text-[12px]">
      <span className="w-24 shrink-0 font-mono uppercase text-[10px] tracking-wider pt-0.5" style={{ color: "var(--fg-dimmer)" }}>{k}</span>
      <span style={{ color: "var(--fg)" }}>{v}</span>
    </div>
  );
}
