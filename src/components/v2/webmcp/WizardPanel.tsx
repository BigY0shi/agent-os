"use client";

// S7 — the WebMCP wizard (owner spec: "a wizard, not an input page").
// Left rail: drafts (+ New wizard / Write my own). Right: the stepper
//   Describe -> Clarify & propose -> Approve -> Emit (-> Create package)
// Nothing is emitted before the list is approved; the server enforces it (409).
// "Write my own" is the escape hatch: paste JSON, the agent only proofreads.
// Every model reply shows who answered (provider / fellBackFrom) — rule 20.
// V2 idiom: fetch-on-mount, dark palette, WebMCP accent, no new deps.

import { useCallback, useEffect, useState } from "react";
import { Check, FileJson, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useSettings } from "@/components/ConfigMenu";
import { WEBMCP_ACCENT, EmptyState, Eyebrow, fmtAgo, inputStyle, monoStyle, panelStyle } from "./shared";

type Step = "describe" | "clarify" | "approved" | "emitted";
interface ProposedInput { name: string; type: string; description: string; required: boolean }
interface ProposedTool { name: string; purpose: string; inputs: ProposedInput[]; persona: string; requiresApproval: boolean }
interface Proposal { serverName: string; slug: string; summary: string; scratchpad: string; tools: ProposedTool[] }
interface Question { id: string; question: string; answer: string }
interface ModelRun { provider: string; fellBackFrom?: string; fallbackReason?: string; at: string }
interface Proofread { verdict: "looks good" | "problems"; problems: string[]; notes: string[]; model: ModelRun | null }
interface Draft {
  id: string;
  mode: "wizard" | "own";
  step: Step;
  title: string;
  description: string;
  questions: Question[];
  proposal: Proposal | null;
  spec: unknown | null;
  emitProblems: string[];
  ownSpecText: string;
  proofread: Proofread | null;
  lastModel: ModelRun | null;
  appliedSlug: string | null;
  updatedAt: string;
}

const STEPS: { key: Step; label: string }[] = [
  { key: "describe", label: "1 Describe" },
  { key: "clarify", label: "2 Clarify & propose" },
  { key: "approved", label: "3 Approve" },
  { key: "emitted", label: "4 Emit JSON" },
];

const btn = (active = false): React.CSSProperties => ({
  border: `1px solid ${active ? WEBMCP_ACCENT : `${WEBMCP_ACCENT}55`}`,
  color: WEBMCP_ACCENT,
  background: active ? `${WEBMCP_ACCENT}18` : "var(--panel, rgba(255,255,255,0.02))",
});
const dim = { color: "var(--fg-dimmer, #6b6478)" };
const fg = { color: "var(--fg, #e8e2f0)" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json" }, ...init });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
  return j;
}

function ModelLine({ run }: { run: ModelRun | null }) {
  if (!run) return null;
  return (
    <div className="font-mono text-[10.5px] mt-1" style={dim}>
      answered by <span style={{ color: WEBMCP_ACCENT }}>{run.provider}</span>
      {run.fellBackFrom ? ` (fell back from ${run.fellBackFrom}: ${run.fallbackReason ?? "failed"})` : ""}
    </div>
  );
}

function Problems({ items, title }: { items: string[]; title: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 rounded-lg p-2.5" style={{ border: "1px solid #f8717155", background: "#f8717110" }}>
      <div className="text-[11px] font-medium mb-1" style={{ color: "#f87171" }}>{title}</div>
      <ul className="space-y-0.5">
        {items.map((p, i) => (
          <li key={i} className="text-[11.5px]" style={{ color: "#fca5a5" }}>- {p}</li>
        ))}
      </ul>
    </div>
  );
}

export default function WizardPanel({ onOpenPackage }: { onOpenPackage: (slug: string) => void }) {
  const { settings } = useSettings();
  const gear = (settings?.webmcp ?? {}) as { wizardAgent?: string; wizardFallback?: string };
  const agent = (gear.wizardAgent || "claude").trim().toLowerCase();

  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // local edits
  const [description, setDescription] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [tools, setTools] = useState<ProposedTool[]>([]);
  const [ownText, setOwnText] = useState("");
  const [applySlug, setApplySlug] = useState("");

  const loadList = useCallback(async () => {
    try {
      const j = await api<{ drafts: Draft[] }>("/api/v2/webmcp/wizard");
      setDrafts(j.drafts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const adopt = useCallback((d: Draft) => {
    setDraft(d);
    setDescription(d.description);
    setAnswers(Object.fromEntries(d.questions.map((q) => [q.id, q.answer])));
    setTools(d.proposal?.tools ?? []);
    setOwnText(d.ownSpecText);
    setApplySlug(d.proposal?.slug ?? "");
  }, []);

  const load = useCallback(async (id: string) => {
    try {
      const j = await api<{ draft: Draft }>(`/api/v2/webmcp/wizard/${id}`);
      adopt(j.draft);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [adopt]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (selected) load(selected); else setDraft(null); }, [selected, load]);

  const run = useCallback(async (label: string, fn: () => Promise<Draft | void>) => {
    setBusy(label);
    setError(null);
    try {
      const d = await fn();
      if (d) adopt(d);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (selected) load(selected); // the server keeps the truth (emit problems land on the draft)
    } finally {
      setBusy(null);
    }
  }, [adopt, loadList, load, selected]);

  const create = (mode: "wizard" | "own") =>
    run("create", async () => {
      const j = await api<{ draft: Draft }>("/api/v2/webmcp/wizard", { method: "POST", body: JSON.stringify({ mode, description: "" }) });
      setSelected(j.draft.id);
      return j.draft;
    });

  const patch = (body: Record<string, unknown>) =>
    api<{ draft: Draft }>(`/api/v2/webmcp/wizard/${draft!.id}`, { method: "PATCH", body: JSON.stringify(body) }).then((j) => j.draft);
  const post = (leaf: string, body?: Record<string, unknown>) =>
    api<{ draft: Draft }>(`/api/v2/webmcp/wizard/${draft!.id}/${leaf}`, { method: "POST", body: body ? JSON.stringify(body) : undefined }).then((j) => j.draft);

  const digest = () =>
    run("digest", async () => {
      await patch({ description, answers });
      return post("digest");
    });
  const approve = () => run("approve", () => patch({ action: "approve", proposal: { ...draft!.proposal, tools } }));
  const reopen = () => run("reopen", () => patch({ action: "reopen" }));
  const emit = () => run("emit", () => post("emit"));
  const proofread = () => run("proofread", () => post("proofread", { text: ownText }));
  const discard = () => {
    if (!draft || !confirm("Discard this draft? It is archived, not deleted.")) return;
    run("discard", async () => {
      await patch({ action: "discard" });
      setSelected(null);
    });
  };
  const apply = () =>
    run("apply", async () => {
      const j = await api<{ draft: Draft; slug: string }>(`/api/v2/webmcp/wizard/${draft!.id}/apply`, {
        method: "POST",
        body: JSON.stringify({ slug: applySlug.trim() || undefined }),
      });
      return j.draft;
    });

  const stepIndex = draft ? STEPS.findIndex((s) => s.key === draft.step) : -1;
  const editable = draft?.mode === "wizard" && (draft.step === "describe" || draft.step === "clarify");

  const setTool = (i: number, p: Partial<ProposedTool>) => setTools((t) => t.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <div className="grid gap-4 items-start" style={{ gridTemplateColumns: "280px 1fr" }}>
      {/* rail */}
      <div className="min-w-0">
        <div className="flex gap-2 mb-3">
          <button onClick={() => create("wizard")} disabled={!!busy} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium transition" style={btn(true)}>
            <Wand2 size={13} /> New wizard
          </button>
          <button onClick={() => create("own")} disabled={!!busy} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium transition" style={btn()}>
            <FileJson size={13} /> Write my own
          </button>
        </div>
        {!drafts?.length ? (
          <div className="text-[11.5px]" style={dim}>No wizard drafts yet.</div>
        ) : (
          <div className="space-y-1.5">
            {drafts.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelected(d.id)}
                className="w-full text-left rounded-lg px-2.5 py-2 transition"
                style={{ ...panelStyle, border: `1px solid ${selected === d.id ? WEBMCP_ACCENT : "var(--panel-border, #2a2436)"}` }}
              >
                <div className="text-[12px] font-medium truncate" style={fg}>{d.title}</div>
                <div className="font-mono text-[10px] mt-0.5" style={dim}>
                  {d.mode === "own" ? "write my own" : d.step} · {fmtAgo(d.updatedAt)}{d.appliedSlug ? ` · ${d.appliedSlug}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* body */}
      <div className="min-w-0 rounded-xl p-4" style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}>
        {!draft ? (
          <EmptyState
            icon={<Wand2 size={22} />}
            title="Describe the server; the agent proposes the tools; you approve; then it emits the JSON"
            hint={`Start a wizard or paste your own JSON for a proofread. The model is the WebMCP gear's wizard agent (${agent}).`}
          />
        ) : (
          <div>
            {/* header */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {draft.mode === "wizard" ? (
                STEPS.map((s, i) => (
                  <span
                    key={s.key}
                    className="px-2 h-6 inline-flex items-center rounded-md text-[11px] font-medium"
                    style={{
                      border: `1px solid ${i === stepIndex ? WEBMCP_ACCENT : "var(--panel-border, #2a2436)"}`,
                      color: i <= stepIndex ? WEBMCP_ACCENT : "var(--fg-dimmer, #6b6478)",
                      background: i === stepIndex ? `${WEBMCP_ACCENT}14` : "transparent",
                    }}
                  >
                    {i < stepIndex ? <Check size={11} className="mr-1" /> : null}{s.label}
                  </span>
                ))
              ) : (
                <Eyebrow>Write my own JSON · the agent only proofreads</Eyebrow>
              )}
              <button onClick={discard} disabled={!!busy} className="ml-auto inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px]" style={{ border: "1px solid #f8717155", color: "#f87171" }}>
                <Trash2 size={12} /> Discard
              </button>
            </div>
            {error && <div className="text-[11.5px] mb-2" style={{ color: "#f87171" }}>{error}</div>}

            {draft.mode === "own" ? (
              <div>
                <Eyebrow>Your spec JSON ({"{ package, spec, tools }"})</Eyebrow>
                <textarea
                  value={ownText}
                  onChange={(e) => setOwnText(e.target.value)}
                  spellCheck={false}
                  rows={16}
                  className="w-full rounded-lg px-2.5 py-2 text-[12px] outline-none"
                  style={{ ...inputStyle, ...monoStyle }}
                />
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <button onClick={proofread} disabled={!!busy || !ownText.trim()} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium" style={btn(true)}>
                    <Sparkles size={13} /> {busy === "proofread" ? `Proofreading with ${agent}…` : `Proofread with ${agent}`}
                  </button>
                  {draft.proofread && (
                    <span
                      className="px-2 h-6 inline-flex items-center rounded-md text-[11px] font-medium"
                      style={draft.proofread.verdict === "looks good" ? { border: "1px solid #4ade8066", color: "#4ade80" } : { border: "1px solid #f8717166", color: "#f87171" }}
                    >
                      {draft.proofread.verdict === "looks good" ? "looks good" : `${draft.proofread.problems.length} problem(s)`}
                    </span>
                  )}
                </div>
                <ModelLine run={draft.proofread?.model ?? null} />
                {draft.proofread && <Problems items={draft.proofread.problems} title="Problems" />}
                {draft.proofread?.notes.length ? (
                  <div className="mt-2 text-[11.5px]" style={dim}>
                    {draft.proofread.notes.map((n, i) => <div key={i}>note: {n}</div>)}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <input value={applySlug} onChange={(e) => setApplySlug(e.target.value)} placeholder="slug override (optional)" spellCheck={false} className="rounded-lg px-2.5 h-8 text-[12px] outline-none w-[200px]" style={{ ...inputStyle, ...monoStyle }} />
                  <button onClick={apply} disabled={!!busy || !ownText.trim()} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium" style={btn()}>
                    <Plus size={13} /> Import into builder
                  </button>
                  {draft.appliedSlug && (
                    <button onClick={() => onOpenPackage(draft.appliedSlug!)} className="text-[12px] underline" style={{ color: WEBMCP_ACCENT }}>
                      open {draft.appliedSlug}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 1 describe */}
                <section>
                  <Eyebrow>What should the server do? (vague or granular)</Eyebrow>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={!editable}
                    rows={editable ? 6 : 3}
                    placeholder="e.g. A server for my shop's invoices, quotes and cash position. The bookkeeper and the sales person both use it."
                    className="w-full rounded-lg px-2.5 py-2 text-[12.5px] outline-none"
                    style={inputStyle}
                  />
                  {editable && (
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={digest} disabled={!!busy || !description.trim()} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium" style={btn(true)}>
                        {draft.proposal ? <RefreshCw size={13} /> : <Sparkles size={13} />}
                        {busy === "digest" ? `Thinking with ${agent}…` : draft.proposal ? `Re-digest with answers (${agent})` : `Digest with ${agent}`}
                      </button>
                      <span className="text-[11px]" style={dim}>No code is written; the agent reasons and proposes a list.</span>
                    </div>
                  )}
                  <ModelLine run={draft.lastModel} />
                </section>

                {/* 2 clarify + propose */}
                {draft.proposal && (
                  <section>
                    {draft.questions.length > 0 && (
                      <div className="mb-3">
                        <Eyebrow>Clarifying questions</Eyebrow>
                        <div className="space-y-1.5">
                          {draft.questions.map((q) => (
                            <div key={q.id}>
                              <div className="text-[12px]" style={fg}>{q.question}</div>
                              <input
                                value={answers[q.id] ?? ""}
                                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                                disabled={!editable}
                                placeholder="your answer"
                                className="w-full rounded-lg px-2.5 h-8 text-[12px] outline-none mt-1"
                                style={inputStyle}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {draft.proposal.scratchpad && (
                      <details className="mb-3">
                        <summary className="text-[11px] cursor-pointer" style={dim}>Scratchpad (the agent&apos;s reasoning)</summary>
                        <pre className="whitespace-pre-wrap text-[11.5px] mt-1" style={{ ...dim, ...monoStyle }}>{draft.proposal.scratchpad}</pre>
                      </details>
                    )}
                    <Eyebrow>Proposed tools · {draft.proposal.serverName} ({draft.proposal.slug}) · {tools.length} tool{tools.length === 1 ? "" : "s"} (5-10)</Eyebrow>
                    {draft.proposal.summary && <div className="text-[12px] mb-2" style={dim}>{draft.proposal.summary}</div>}
                    <div className="space-y-1.5">
                      {tools.map((t, i) => (
                        <div key={i} className="rounded-lg p-2" style={panelStyle}>
                          <div className="flex flex-wrap items-center gap-2">
                            <input value={t.name} onChange={(e) => setTool(i, { name: e.target.value })} disabled={!editable} spellCheck={false} className="rounded-md px-2 h-7 text-[12px] outline-none w-[180px]" style={{ ...inputStyle, ...monoStyle }} />
                            <input value={t.persona} onChange={(e) => setTool(i, { persona: e.target.value })} disabled={!editable} placeholder="persona" className="rounded-md px-2 h-7 text-[11.5px] outline-none w-[130px]" style={inputStyle} />
                            <label className="inline-flex items-center gap-1 text-[11px]" style={dim}>
                              <input type="checkbox" checked={t.requiresApproval} disabled={!editable} onChange={(e) => setTool(i, { requiresApproval: e.target.checked })} style={{ accentColor: WEBMCP_ACCENT }} /> approval
                            </label>
                            {editable && (
                              <button onClick={() => setTools((x) => x.filter((_, j) => j !== i))} className="ml-auto text-[11px]" style={{ color: "#f87171" }}>cut</button>
                            )}
                          </div>
                          <input value={t.purpose} onChange={(e) => setTool(i, { purpose: e.target.value })} disabled={!editable} placeholder="one job, one sentence" className="w-full rounded-md px-2 h-7 text-[12px] outline-none mt-1.5" style={inputStyle} />
                          {t.inputs.length > 0 && (
                            <div className="font-mono text-[10.5px] mt-1" style={dim}>
                              inputs: {t.inputs.map((x) => `${x.name}:${x.type}${x.required ? "*" : ""}`).join(", ")}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {editable && (
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <button onClick={() => setTools((x) => [...x, { name: "", purpose: "", persona: "", inputs: [], requiresApproval: false }])} className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-[12px]" style={btn()}>
                          <Plus size={13} /> Add tool
                        </button>
                        <button onClick={approve} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium" style={btn(true)}>
                          <Check size={13} /> Approve this list
                        </button>
                        <span className="text-[11px]" style={dim}>Nothing is emitted until you approve.</span>
                      </div>
                    )}
                  </section>
                )}

                {/* 3 approved -> emit */}
                {(draft.step === "approved" || draft.step === "emitted") && (
                  <section>
                    <Eyebrow>{draft.step === "emitted" ? "Emitted spec" : "Approved · ready to emit"}</Eyebrow>
                    <div className="flex flex-wrap items-center gap-2">
                      {draft.step === "approved" && (
                        <button onClick={emit} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium" style={btn(true)}>
                          <FileJson size={13} /> {busy === "emit" ? `Emitting with ${agent}…` : `Emit JSON with ${agent}`}
                        </button>
                      )}
                      <button onClick={reopen} disabled={!!busy} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px]" style={btn()}>
                        Edit the list
                      </button>
                    </div>
                    <Problems items={draft.emitProblems} title="The emitted spec failed validation (the draft stays approved; retry or edit the list)" />
                    {draft.spec ? (
                      <div className="mt-2">
                        <textarea readOnly value={JSON.stringify(draft.spec, null, 2)} rows={14} spellCheck={false} className="w-full rounded-lg px-2.5 py-2 text-[11.5px] outline-none" style={{ ...inputStyle, ...monoStyle }} />
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <input value={applySlug} onChange={(e) => setApplySlug(e.target.value)} placeholder="slug" spellCheck={false} className="rounded-lg px-2.5 h-8 text-[12px] outline-none w-[200px]" style={{ ...inputStyle, ...monoStyle }} />
                          <button onClick={apply} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium" style={btn(true)}>
                            <Plus size={13} /> Create package in the builder
                          </button>
                          {draft.appliedSlug && (
                            <button onClick={() => onOpenPackage(draft.appliedSlug!)} className="text-[12px] underline" style={{ color: WEBMCP_ACCENT }}>
                              open {draft.appliedSlug}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </section>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
