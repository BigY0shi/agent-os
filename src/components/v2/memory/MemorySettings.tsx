"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, Plus, X } from "lucide-react";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import EventFeed from "@/components/v2/EventFeed";
import { MEMORY_ACCENT, fmtDate, inputStyle } from "./shared";

// ── MemorySettings (SPEC-A A8.6 + F3.4 + System section) ─────────────────────
// Rendered as ConfigMenu children. Every knob maps to settings.memory /
// settings.capability / settings.mcp via /api/settings deep-merge (rule 16 —
// nothing is config-file-only). The MCP secret is never rendered in full: /api/settings
// returns its mask (first 5 characters + "********") and the copy button fetches the
// whole value on click from the cookie-only /api/v2/memory/mcp-secret/reveal.

interface MemoryDraft {
  provider: string;
  modelLow: string;
  modelMedium: string;
  embedProvider: string;
  embedModel: string;
  tokenBudget: string;
  labelRouterThreshold: string;
  backfillLimit: string;
  backfillModel: string;
  backfillProvider: string;
  openaiCompatUrl: string;
  openaiCompatReasoningEffort: string;
}

interface FolderRow { path: string; scopes: ("files" | "coding" | "exec")[] }

interface CapabilityDraft {
  folders: FolderRow[];
  execAllow: string;
  execDeny: string;
}

interface JobRowClient {
  id: string;
  kind: string;
  name: string;
  rrule: string | null;
  run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  enabled: number;
}

const PROVIDERS = ["ollama-cloud", "ollama-local", "cli", "minimax", "openai-compat"] as const;
// S5 backfill: which LOCAL server derives. 'openai-compat' is LM Studio and
// friends, for models Ollama cannot serve (Bonsai 27B needs a llama.cpp fork).
const BACKFILL_PROVIDERS = ["ollama-local", "openai-compat"] as const;
const DEFAULT_COMPAT_URL = "http://127.0.0.1:1234/v1";
// How hard a thinking model may deliberate. Measured on bonsai-27b 2026-09-03:
// unset it burns ~1900 reasoning tokens (26 s) per call for a 51-token answer;
// "none" returns the same facts in 1.2 s. "" sends nothing at all.
const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", ""] as const;
const EMBED_PROVIDERS = ["ollama-local", "ollama-cloud"] as const;
const SCOPES = ["files", "coding", "exec"] as const;

function backfillLimitOf(d: { backfillLimit: string }): number {
  const n = parseInt(d.backfillLimit, 10);
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(n, 500);
}

// A9.3 — legacy migration sources (POST /api/v2/memory/migrate)
const MIGRATION_SOURCES = [
  { source: "memsearch", label: ".memsearch session logs", hint: "repo .memsearch/memory/*.md" },
  { source: "jarvis", label: "Jarvis voice memory", hint: "~/.agentic-os/jarvis-memory.jsonl (+ pending drains)" },
  { source: "agents", label: "Agents memory", hint: "~/.agentic-os/agents/<id>/memory/*.md" },
  { source: "remember", label: ".remember notes", hint: "repo .remember/*.md" },
] as const;

interface MigrateRowResult {
  found: number;
  queued: number;
  imported: number;
  skipped: number;
  dryRun: boolean;
  full: boolean;
  error?: string;
}

// S5 — legacy backfill (POST /api/v2/memory/backfill). Dry-run answers inline;
// a real run is a module run the tray carries (module "memory").
interface BackfillCandidateClient { uuid: string; source: string; validAt: string; chars: number; preview: string }
interface BackfillDryClient { remaining: number; candidates: BackfillCandidateClient[]; model: string }

function Toggle({
  label, hint, checked, disabled, onChange,
}: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 mb-2 cursor-pointer select-none" title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[2px]" style={{ accentColor: MEMORY_ACCENT }} />
      <span>
        <span className="block text-[12px] font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>{label}</span>
        {hint && <span className="block text-[10.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{hint}</span>}
      </span>
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 mb-2 pt-4 text-[12px] font-semibold"
      style={{ color: "var(--fg, #e8e2f0)", borderTop: "1px solid var(--panel-border, #2a2436)" }}>
      {children}
    </div>
  );
}

export default function MemorySettings() {
  const { settings, saving, save } = useSettings();
  const [draft, setDraft] = useState<MemoryDraft | null>(null);
  const [capDraft, setCapDraft] = useState<CapabilityDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [secretErr, setSecretErr] = useState(false);
  const [jobs, setJobs] = useState<JobRowClient[] | null>(null);
  const [migrating, setMigrating] = useState<string | null>(null); // "<source>:<dry|import>"
  const [migrateResults, setMigrateResults] = useState<Record<string, MigrateRowResult>>({});
  const [backfillBusy, setBackfillBusy] = useState<"dry" | "run" | null>(null);
  const [backfillDry, setBackfillDry] = useState<BackfillDryClient | null>(null);
  const [backfillRun, setBackfillRun] = useState<{ runId: string; limit: number; model: string } | null>(null);
  const [backfillErr, setBackfillErr] = useState<string | null>(null);
  const [backfillRemaining, setBackfillRemaining] = useState<number | null>(null);

  const memory = (settings?.memory ?? {}) as Record<string, unknown>;
  const capability = (settings?.capability ?? {}) as Record<string, unknown>;
  const mcp = (settings?.mcp ?? {}) as { secret?: string };

  // Seed drafts once settings arrive (text fields save on the Save button;
  // toggles persist immediately, SkillsSection-style).
  useEffect(() => {
    if (!settings || draft) return;
    setDraft({
      provider: String(memory.provider ?? "ollama-cloud"),
      modelLow: String(memory.modelLow ?? ""),
      modelMedium: String(memory.modelMedium ?? ""),
      embedProvider: String(memory.embedProvider ?? "ollama-local"),
      embedModel: String(memory.embedModel ?? ""),
      tokenBudget: String(memory.tokenBudget ?? 10000),
      labelRouterThreshold: String(memory.labelRouterThreshold ?? 0.7),
      backfillLimit: String(memory.backfillLimit ?? 20),
      backfillModel: String(memory.backfillModel ?? "bonsai:27b"),
      backfillProvider: String(memory.backfillProvider ?? "ollama-local"),
      openaiCompatUrl: String(memory.openaiCompatUrl ?? DEFAULT_COMPAT_URL),
      openaiCompatReasoningEffort: String(memory.openaiCompatReasoningEffort ?? "none"),
    });
    setCapDraft({
      folders: Array.isArray(capability.folders) ? (capability.folders as FolderRow[]).map((f) => ({ path: f.path, scopes: [...(f.scopes ?? [])] })) : [],
      execAllow: Array.isArray(capability.execAllow) ? (capability.execAllow as string[]).join("\n") : "",
      execDeny: Array.isArray(capability.execDeny) ? (capability.execDeny as string[]).join("\n") : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  async function saveAll() {
    if (!draft || !capDraft) return;
    const tokenBudget = parseInt(draft.tokenBudget, 10);
    const threshold = parseFloat(draft.labelRouterThreshold);
    const res = await save({
      memory: {
        ...memory,
        provider: draft.provider,
        modelLow: draft.modelLow.trim(),
        modelMedium: draft.modelMedium.trim(),
        embedProvider: draft.embedProvider,
        embedModel: draft.embedModel.trim(),
        tokenBudget: Number.isFinite(tokenBudget) ? tokenBudget : 10000,
        labelRouterThreshold: Number.isFinite(threshold) ? threshold : 0.7,
        backfillLimit: backfillLimitOf(draft),
        backfillModel: draft.backfillModel.trim() || "bonsai:27b",
        backfillProvider: draft.backfillProvider,
        openaiCompatUrl: draft.openaiCompatUrl.trim() || DEFAULT_COMPAT_URL,
        openaiCompatReasoningEffort: draft.openaiCompatReasoningEffort as "" | "none" | "minimal" | "low" | "medium" | "high",
      },
      capability: {
        ...capability,
        folders: capDraft.folders.filter((f) => f.path.trim() !== ""),
        execAllow: capDraft.execAllow.split("\n").map((s) => s.trim()).filter(Boolean),
        execDeny: capDraft.execDeny.split("\n").map((s) => s.trim()).filter(Boolean),
      },
    });
    if (res) { setSaved(true); setTimeout(() => setSaved(false), 1800); }
  }

  function saveToggle(key: string, value: boolean) {
    void save({ memory: { ...memory, [key]: value } });
  }

  /** Copy the MCP secret without ever rendering it — fresh fetch on click. */
  async function copySecret() {
    setSecretErr(false);
    try {
      // GET /api/settings masks secrets; this cookie-only route is the one door out.
      const r = await fetch("/api/v2/memory/mcp-secret/reveal", { method: "POST", cache: "no-store" });
      const j = await r.json();
      const secret = r.ok ? j?.secret : null;
      if (typeof secret !== "string" || !secret) { setSecretErr(true); return; }
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 1800);
    } catch { setSecretErr(true); }
  }

  // System section: jobs table (poll while the drawer is open + tab visible).
  const refreshJobs = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/jobs", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.jobs)) setJobs(j.jobs as JobRowClient[]);
    } catch { /* offline */ }
  }, []);
  usePollWhileVisible(refreshJobs, 5000, []);

  async function runMigrate(source: string, dryRun: boolean) {
    setMigrating(`${source}:${dryRun ? "dry" : "import"}`);
    try {
      const r = await fetch("/api/v2/memory/migrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, dryRun }),
      });
      const j = await r.json();
      setMigrateResults((prev) => ({
        ...prev,
        [source]: r.ok
          ? {
              found: j.found ?? 0, queued: j.queued ?? 0, imported: j.imported ?? 0,
              skipped: j.skipped ?? 0, dryRun: j.dryRun === true, full: j.full === true,
            }
          : { found: 0, queued: 0, imported: 0, skipped: 0, dryRun, full: false, error: String(j?.error ?? `HTTP ${r.status}`) },
      }));
    } catch (err) {
      setMigrateResults((prev) => ({
        ...prev,
        [source]: { found: 0, queued: 0, imported: 0, skipped: 0, dryRun, full: false, error: err instanceof Error ? err.message : "request failed" },
      }));
    } finally {
      setMigrating(null);
    }
  }

  // How many undrived legacy episodes exist right now (reads only).
  const refreshBackfill = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/memory/backfill?limit=1", { cache: "no-store" });
      const j = await r.json();
      if (typeof j?.remaining === "number") setBackfillRemaining(j.remaining);
      if (typeof j?.runId === "string") setBackfillRun((prev) => prev ?? { runId: j.runId, limit: 0, model: "" });
    } catch { /* offline */ }
  }, []);
  useEffect(() => { void refreshBackfill(); }, [refreshBackfill]);

  /** Dry-run lists candidates and writes nothing; a real run persists the two
   *  knobs first (rule 16) and then hands the work to a module run. */
  async function runBackfill(dryRun: boolean) {
    if (!draft) return;
    const limit = backfillLimitOf(draft);
    const model = draft.backfillModel.trim() || "bonsai:27b";
    const provider = draft.backfillProvider;
    const compatUrl = draft.openaiCompatUrl.trim() || DEFAULT_COMPAT_URL;
    const effort = draft.openaiCompatReasoningEffort;
    setBackfillErr(null);
    setBackfillBusy(dryRun ? "dry" : "run");
    try {
      if (!dryRun) {
        setBackfillDry(null);
        // The URL is persisted too: the server reads it from settings, so a run
        // started here must not depend on an unsaved field (rule 16).
        await save({
          memory: {
            ...memory,
            backfillLimit: limit,
            backfillModel: model,
            backfillProvider: provider,
            openaiCompatUrl: compatUrl,
            openaiCompatReasoningEffort: effort as "" | "none" | "minimal" | "low" | "medium" | "high",
          },
        });
      }
      const r = await fetch("/api/v2/memory/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit, model, provider, dryRun }),
      });
      const j = await r.json();
      if (!r.ok) {
        setBackfillErr(String(j?.error ?? `HTTP ${r.status}`));
        if (typeof j?.runId === "string") setBackfillRun({ runId: j.runId, limit, model });
        return;
      }
      if (dryRun) {
        setBackfillDry({ remaining: j.remaining ?? 0, candidates: Array.isArray(j.candidates) ? j.candidates : [], model: String(j.model ?? model) });
        setBackfillRemaining(typeof j?.remaining === "number" ? j.remaining : null);
      } else {
        setBackfillRun({ runId: String(j.runId ?? ""), limit, model });
      }
    } catch (err) {
      setBackfillErr(err instanceof Error ? err.message : "request failed");
    } finally {
      setBackfillBusy(null);
    }
  }

  async function toggleJob(job: JobRowClient, enabled: boolean) {
    try {
      await fetch("/api/v2/jobs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: job.id, enabled }),
      });
      await refreshJobs();
    } catch { /* offline */ }
  }

  if (!settings || !draft || !capDraft) {
    return <div className="text-[11.5px] py-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>loading settings…</div>;
  }

  return (
    <div>
      {/* ── Models ── */}
      <Field label="Provider" hint="Who runs the ingestion + search LLM calls. No silent fallback — failures surface in Logs.">
        <select value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
          className="w-full h-8 rounded-md px-2 text-[12.5px] outline-none" style={inputStyle}>
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Model — low tier" hint="Cheap calls: reflection, resolution, placement.">
        <TextInput value={draft.modelLow} onChange={(e) => setDraft({ ...draft, modelLow: e.target.value })} placeholder="kimi-k2.6:cloud" />
      </Field>
      <Field label="Model — medium tier" hint="Normalize, extraction, classification, router.">
        <TextInput value={draft.modelMedium} onChange={(e) => setDraft({ ...draft, modelMedium: e.target.value })} placeholder="glm-5.2:cloud" />
      </Field>

      {/* ── Embeddings ── */}
      <SectionTitle>Embeddings</SectionTitle>
      <Field label="Embed provider">
        <select value={draft.embedProvider} onChange={(e) => setDraft({ ...draft, embedProvider: e.target.value })}
          className="w-full h-8 rounded-md px-2 text-[12.5px] outline-none" style={inputStyle}>
          {EMBED_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Embed model">
        <TextInput value={draft.embedModel} onChange={(e) => setDraft({ ...draft, embedModel: e.target.value })} placeholder="nomic-embed-text" />
        <span className="flex items-start gap-1.5 mt-1.5 text-[10.5px] leading-relaxed" style={{ color: "#fbbf24" }}>
          <AlertTriangle size={12} className="shrink-0 mt-[1px]" />
          Changing the embed model after data exists requires re-embedding every vector
          (<code className="font-mono">scripts/v2/reembed.mjs</code>) — until then, search silently degrades.
        </span>
      </Field>

      {/* ── Behavior ── */}
      <SectionTitle>Behavior</SectionTitle>
      <Toggle label="Ingestion enabled" hint="Master kill-switch: off = new episodes are refused, nothing existing is touched."
        checked={memory.ingestEnabled !== false} disabled={saving} onChange={(v) => saveToggle("ingestEnabled", v)} />
      <Toggle label="Session compaction" hint="Fold each session's episodes into a living summary document."
        checked={memory.compactionEnabled !== false} disabled={saving} onChange={(v) => saveToggle("compactionEnabled", v)} />
      <Toggle label="Persona auto-update" hint="Incrementally update the persona doc when identity-relevant facts land."
        checked={memory.personaAutoUpdate !== false} disabled={saving} onChange={(v) => saveToggle("personaAutoUpdate", v)} />

      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="Token budget" hint="Recall output cap.">
          <TextInput type="number" value={draft.tokenBudget} onChange={(e) => setDraft({ ...draft, tokenBudget: e.target.value })} />
        </Field>
        <Field label="Label router threshold" hint="0–1, default 0.7.">
          <TextInput type="number" step="0.05" min="0" max="1" value={draft.labelRouterThreshold}
            onChange={(e) => setDraft({ ...draft, labelRouterThreshold: e.target.value })} />
        </Field>
      </div>

      {/* ── MCP secret ── */}
      <SectionTitle>MCP endpoint</SectionTitle>
      <div className="flex items-center gap-2 mb-1">
        {mcp.secret ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "#34d399" }}>
              <Check size={13} /> configured ✓
            </span>
            <code className="font-mono text-[11.5px]" style={{ color: "var(--fg-dim, #9aa)" }} title="First characters only; Copy secret copies the whole value">{mcp.secret}</code>
            <button onClick={copySecret}
              className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11.5px] font-medium"
              style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}>
              {secretCopied ? <Check size={12} style={{ color: "#34d399" }} /> : <Copy size={12} />}
              {secretCopied ? "Copied" : "Copy secret"}
            </button>
          </>
        ) : (
          <span className="text-[11.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            not configured — a secret is generated when the MCP endpoint is first set up
          </span>
        )}
      </div>
      <p className="text-[10.5px] leading-relaxed mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Only its first characters are shown; Copy secret copies the whole value. Agents connect with header <code className="font-mono">x-agentos-mcp-secret</code> at{" "}
        <code className="font-mono">/api/mcp?source=&lt;name&gt;</code>.
        {secretErr && <span style={{ color: "#f87171" }}> Couldn&apos;t copy — clipboard unavailable.</span>}
      </p>

      {/* ── Capabilities (F3.4) ── */}
      <SectionTitle>Capabilities</SectionTitle>
      <p className="text-[10.5px] leading-relaxed mb-2" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Folder scopes for the files/coding/exec slots. No folders = permissive first-run. The built-in deny list
        (rm / Remove-Item / force-push / hard-reset / git clean …) always applies; your deny globs are additive.
      </p>
      {capDraft.folders.map((f, i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5">
          <input value={f.path}
            onChange={(e) => setCapDraft({ ...capDraft, folders: capDraft.folders.map((x, j) => j === i ? { ...x, path: e.target.value } : x) })}
            placeholder="C:\path\to\folder"
            className="flex-1 h-7 rounded-md px-2 font-mono text-[10.5px] outline-none" style={inputStyle} />
          {SCOPES.map((s) => (
            <label key={s} className="inline-flex items-center gap-1 text-[10px] cursor-pointer select-none" style={{ color: "var(--fg-dim, #9aa)" }}>
              <input type="checkbox" checked={f.scopes.includes(s)}
                onChange={(e) => setCapDraft({
                  ...capDraft,
                  folders: capDraft.folders.map((x, j) => j === i
                    ? { ...x, scopes: e.target.checked ? [...x.scopes, s] : x.scopes.filter((sc) => sc !== s) }
                    : x),
                })}
                style={{ accentColor: MEMORY_ACCENT }} />
              {s}
            </label>
          ))}
          <button onClick={() => setCapDraft({ ...capDraft, folders: capDraft.folders.filter((_, j) => j !== i) })}
            className="p-1 rounded shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }} aria-label="Remove folder">
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => setCapDraft({ ...capDraft, folders: [...capDraft.folders, { path: "", scopes: ["files"] }] })}
        className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11px] font-medium mb-3"
        style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}>
        <Plus size={11} /> Add folder
      </button>

      <Field label="Exec allow" hint="One Bash(<glob>) per line. Empty = all non-denied commands (in-app).">
        <textarea value={capDraft.execAllow} onChange={(e) => setCapDraft({ ...capDraft, execAllow: e.target.value })}
          rows={3} placeholder={"Bash(node *)\nBash(npm run *)"}
          className="w-full rounded-md p-2 font-mono text-[10.5px] leading-relaxed outline-none resize-y" style={inputStyle} />
      </Field>
      <Field label="Exec deny (additive)" hint="Always added on top of the built-in deny list — you can only tighten, never loosen.">
        <textarea value={capDraft.execDeny} onChange={(e) => setCapDraft({ ...capDraft, execDeny: e.target.value })}
          rows={3} placeholder={"Bash(docker *)"}
          className="w-full rounded-md p-2 font-mono text-[10.5px] leading-relaxed outline-none resize-y" style={inputStyle} />
      </Field>
      <Toggle
        label="Browser slot"
        hint="Workstream E browser tools (isolated Playwright profiles — never Opera). Off = browser_* absent from the manifest and every call refuses with CAPABILITY_DISABLED. Allowlists are a guardrail, not a sandbox."
        checked={Boolean(capability.browserEnabled)}
        onChange={(v) => void save({ capability: { ...capability, browserEnabled: v } })}
      />

      <div className="mt-3">
        <SaveBar saving={saving} saved={saved} onSave={() => void saveAll()} accent={MEMORY_ACCENT} />
      </div>

      {/* ── Legacy migration (A9.3) ── */}
      <SectionTitle>Legacy migration</SectionTitle>
      <p className="text-[10.5px] leading-relaxed mb-2" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        One-shot import of the pre-V2 memory stores as <code className="font-mono">legacy</code>-labeled
        episodes (verbatim + embedding, no LLM calls). Import is <strong>additive and idempotent</strong> —
        re-running skips everything already imported. The legacy stores are never written; they stay
        live and read-only until retirement.
      </p>
      {MIGRATION_SOURCES.map(({ source, label, hint }) => {
        const res = migrateResults[source];
        const busy = migrating?.startsWith(`${source}:`) ?? false;
        return (
          <div key={source} className="flex items-center gap-2 py-1.5" style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-medium truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{label}</div>
              <div className="font-mono text-[9.5px] truncate" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{hint}</div>
              {res && (
                <div className="text-[10px] mt-0.5" style={{ color: res.error ? "#f87171" : "var(--fg-dim, #9aa)" }}>
                  {res.error
                    ? `error: ${res.error}`
                    : res.dryRun
                      ? `dry-run · found ${res.found} · would skip ${res.skipped}`
                      : `found ${res.found} · imported ${res.imported} · skipped ${res.skipped}`}
                </div>
              )}
            </div>
            <button onClick={() => void runMigrate(source, true)} disabled={migrating !== null}
              className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[10.5px] font-medium shrink-0 disabled:opacity-50"
              style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}>
              {migrating === `${source}:dry` && <Loader2 size={10} className="animate-spin" />}
              Dry-run
            </button>
            <button onClick={() => void runMigrate(source, false)} disabled={migrating !== null}
              className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[10.5px] font-medium shrink-0 disabled:opacity-50"
              style={{ border: `1px solid ${MEMORY_ACCENT}44`, color: MEMORY_ACCENT }}>
              {migrating === `${source}:import` && <Loader2 size={10} className="animate-spin" />}
              Import
            </button>
          </div>
        );
      })}
      <div className="mb-3" />

      {/* ── Legacy backfill (S5) ── */}
      <SectionTitle>Legacy backfill</SectionTitle>
      <p className="text-[10.5px] leading-relaxed mb-2" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Imported legacy episodes carry no aspect (Identity / Event / Relationship…) because the import
        wrote them verbatim. This derives them in place through the normal pipeline (6–8 LLM calls each)
        on a <strong>local model</strong>, never a hosted one; the server down or the model absent
        stops the run with the reason. Existing rows are updated, nothing is re-imported, dedup is untouched.
        Embeddings always run on Ollama, so an LM Studio run needs Ollama up as well.
        {backfillRemaining !== null && (
          <span className="block mt-1" style={{ color: "var(--fg-dim, #9aa)" }}>
            {backfillRemaining === 0 ? "No legacy episodes are waiting for derivation." : `${backfillRemaining} legacy episode${backfillRemaining === 1 ? "" : "s"} still lack derivation.`}
          </span>
        )}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Episodes per run" hint="Start with ~20 and look at the rows before the full set.">
          <TextInput type="number" min="1" max="500" value={draft.backfillLimit}
            onChange={(e) => setDraft({ ...draft, backfillLimit: e.target.value })} />
        </Field>
        <Field label="Served by" hint="Ollama, or an OpenAI-compatible server such as LM Studio.">
          <select value={draft.backfillProvider} onChange={(e) => setDraft({ ...draft, backfillProvider: e.target.value })}
            className="w-full h-8 rounded-md px-2 text-[12.5px] outline-none" style={inputStyle}>
            {BACKFILL_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Chat model"
          hint={draft.backfillProvider === "openai-compat"
            ? "The server's API identifier, verbatim (LM Studio shows it in the Developer tab), e.g. bonsai-27b."
            : "Must be pulled on the local Ollama (ollama pull …), e.g. bonsai:27b."}
        >
          <TextInput value={draft.backfillModel} onChange={(e) => setDraft({ ...draft, backfillModel: e.target.value })}
            placeholder={draft.backfillProvider === "openai-compat" ? "bonsai-27b" : "bonsai:27b"} />
        </Field>
        {draft.backfillProvider === "openai-compat" ? (
          <Field label="Server URL" hint="Include the /v1 segment. A key, if needed, comes from OPENAI_COMPAT_API_KEY in the environment.">
            <TextInput value={draft.openaiCompatUrl} onChange={(e) => setDraft({ ...draft, openaiCompatUrl: e.target.value })}
              placeholder={DEFAULT_COMPAT_URL} />
          </Field>
        ) : <div />}
      </div>
      {draft.backfillProvider === "openai-compat" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Thinking budget" hint="A reasoning model can spend 25 s per call deliberating for a one-line answer. 'none' measured 22x faster on bonsai-27b with the same facts.">
            <select value={draft.openaiCompatReasoningEffort} onChange={(e) => setDraft({ ...draft, openaiCompatReasoningEffort: e.target.value })}
              className="w-full h-8 rounded-md px-2 text-[12.5px] outline-none" style={inputStyle}>
              {REASONING_EFFORTS.map((p) => <option key={p || "unset"} value={p}>{p || "(send nothing, server decides)"}</option>)}
            </select>
          </Field>
          <div />
        </div>
      )}
      <div className="flex items-center gap-2 mb-2">
        <button onClick={() => void runBackfill(true)} disabled={backfillBusy !== null || saving}
          className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[10.5px] font-medium shrink-0 disabled:opacity-50"
          style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}>
          {backfillBusy === "dry" && <Loader2 size={10} className="animate-spin" />}
          Dry-run
        </button>
        <button onClick={() => void runBackfill(false)} disabled={backfillBusy !== null || saving}
          className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[10.5px] font-medium shrink-0 disabled:opacity-50"
          style={{ border: `1px solid ${MEMORY_ACCENT}44`, color: MEMORY_ACCENT }}>
          {backfillBusy === "run" && <Loader2 size={10} className="animate-spin" />}
          Run backfill
        </button>
        {backfillRun && (
          <span className="text-[10.5px]" style={{ color: "var(--fg-dim, #9aa)" }}>
            running as a module run — progress is in the runs tray
            <span className="font-mono"> ({backfillRun.runId.slice(0, 8)})</span>
          </span>
        )}
      </div>
      {backfillErr && (
        <div className="text-[10.5px] mb-2" style={{ color: "#f87171" }}>error: {backfillErr}</div>
      )}
      {backfillDry && (
        <div className="mb-2">
          <div className="text-[10.5px] mb-1" style={{ color: "var(--fg-dim, #9aa)" }}>
            dry-run · {backfillDry.candidates.length} of {backfillDry.remaining} would be derived with <span className="font-mono">{backfillDry.model}</span> · nothing written
          </div>
          {backfillDry.candidates.slice(0, 20).map((c) => (
            <div key={c.uuid} className="py-1" style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
              <div className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                {c.uuid.slice(0, 8)} · {c.validAt.slice(0, 10)} · {c.source} · {c.chars} ch
              </div>
              <div className="text-[10.5px] truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{c.preview}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mb-3" />

      {/* ── System ── */}
      <SectionTitle>System</SectionTitle>
      <div className="mb-1 text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>Scheduled jobs</div>
      {jobs === null ? (
        <div className="text-[11px] py-1.5 flex items-center gap-1.5" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          <Loader2 size={11} className="animate-spin" /> loading jobs…
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-[11px] py-1.5" style={{ color: "var(--fg-dimmer, #6b6478)" }}>no jobs scheduled</div>
      ) : (
        <div className="mb-3">
          {jobs.map((job) => (
            <div key={job.id} className="flex items-center gap-2 py-1.5" style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
              <div className="min-w-0 flex-1">
                <div className="text-[11.5px] font-medium truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{job.name}</div>
                <div className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  {job.kind} · {job.run_at ? `next ${fmtDate(job.run_at)}` : "no schedule"}
                  {job.last_status ? ` · last ${job.last_status}` : ""}
                </div>
              </div>
              <label className="inline-flex items-center gap-1 text-[10px] cursor-pointer select-none shrink-0" style={{ color: "var(--fg-dim, #9aa)" }}>
                <input type="checkbox" checked={job.enabled === 1}
                  onChange={(e) => void toggleJob(job, e.target.checked)}
                  style={{ accentColor: MEMORY_ACCENT }} />
                on
              </label>
            </div>
          ))}
        </div>
      )}

      <div className="mb-1 text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>Event feed</div>
      <EventFeed limit={30} maxHeight={220} />
    </div>
  );
}
