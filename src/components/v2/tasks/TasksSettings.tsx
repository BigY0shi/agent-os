"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { TASKS_ACCENT, type TaskRowClient } from "./shared";

// ── TasksSettings (SPEC-B §6 settings table + chunk-3 brief; rule 16) ────────
// Every settings.tasks knob lives here: timezone (recalc on change),
// planApproval, autoApprove categories + maxSteps, maxStepsPerRun,
// runTimeoutMin, editingBufferSec, emptyTaskGc, and the per-seed toggles
// (PATCH the seed task's isActive + mirror settings.tasks.seeds).

interface TasksDraft {
  timezone: string;
  editingBufferSec: string;
  maxStepsPerRun: string;
  runTimeoutMin: string;
  autoApproveCategories: string;
  autoApproveMaxSteps: string;
}

const SEED_LABELS: Record<string, { key: string; label: string; hint: string }> = {
  "seed:morning-brief": { key: "morningBrief", label: "Morning Brief", hint: "daily 7:00" },
  "seed:eod-wrapup": { key: "eodWrapup", label: "End-of-Day Wrap-up", hint: "daily 18:00" },
  "seed:sunday-planning": { key: "sundayPlanning", label: "Sunday Planning", hint: "Sun 19:00" },
  "seed:weekly-retro": { key: "weeklyRetro", label: "Weekly Retro scaffold", hint: "Fri 16:00" },
};

function Toggle({
  label, hint, checked, disabled, onChange,
}: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 mb-2 cursor-pointer select-none" title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[2px]" style={{ accentColor: TASKS_ACCENT }} />
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

export default function TasksSettings() {
  const { settings, saving, save } = useSettings();
  const [draft, setDraft] = useState<TasksDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [seedTasks, setSeedTasks] = useState<TaskRowClient[]>([]);
  const [seedBusy, setSeedBusy] = useState<string | null>(null);

  const tasks = (settings?.tasks ?? {}) as Record<string, unknown>;
  const autoApprove = (tasks.autoApprove ?? {}) as { categories?: string[]; maxSteps?: number };
  const seeds = (tasks.seeds ?? {}) as Record<string, { enabled?: boolean }>;

  useEffect(() => {
    if (!settings || draft) return;
    setDraft({
      timezone: String(tasks.timezone ?? "America/Chicago"),
      editingBufferSec: String(tasks.editingBufferSec ?? 120),
      maxStepsPerRun: String(tasks.maxStepsPerRun ?? 12),
      runTimeoutMin: String(tasks.runTimeoutMin ?? 30),
      autoApproveCategories: Array.isArray(autoApprove.categories) ? autoApprove.categories.join(", ") : "",
      autoApproveMaxSteps: String(autoApprove.maxSteps ?? ""),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const refreshSeeds = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/tasks?source=seed", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.tasks)) setSeedTasks(j.tasks as TaskRowClient[]);
    } catch { /* offline */ }
  }, []);
  usePollWhileVisible(refreshSeeds, 10000, []);

  async function saveAll() {
    if (!draft) return;
    const bufferSec = parseInt(draft.editingBufferSec, 10);
    const maxSteps = parseInt(draft.maxStepsPerRun, 10);
    const timeout = parseInt(draft.runTimeoutMin, 10);
    const aaMax = parseInt(draft.autoApproveMaxSteps, 10);
    const tzChanged = draft.timezone.trim() !== String(tasks.timezone ?? "America/Chicago");

    const res = await save({
      tasks: {
        ...tasks,
        timezone: draft.timezone.trim() || "America/Chicago",
        editingBufferSec: Number.isFinite(bufferSec) && bufferSec > 0 ? bufferSec : 120,
        maxStepsPerRun: Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : 12,
        runTimeoutMin: Number.isFinite(timeout) && timeout > 0 ? timeout : 30,
        autoApprove: {
          ...autoApprove,
          categories: draft.autoApproveCategories.split(",").map((s) => s.trim()).filter(Boolean),
          ...(Number.isFinite(aaMax) && aaMax > 0 ? { maxSteps: aaMax } : {}),
        },
      },
    });
    if (res) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      if (tzChanged) {
        // Timezone moved — every active schedule re-resolves in the new zone.
        try { await fetch("/api/v2/tasks/recalc", { method: "POST" }); } catch { /* offline */ }
      }
    }
  }

  async function toggleSeed(task: TaskRowClient, enabled: boolean) {
    const seedKey = String(task.metadata?.seedKey ?? "");
    const meta = SEED_LABELS[seedKey];
    setSeedBusy(task.id);
    try {
      await fetch(`/api/v2/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: enabled }),
      });
      if (meta) {
        await save({
          tasks: { ...tasks, seeds: { ...seeds, [meta.key]: { enabled } } },
        });
      }
      await refreshSeeds();
    } finally {
      setSeedBusy(null);
    }
  }

  if (!draft) {
    return <div className="text-[12px]" style={{ color: "var(--fg-dim, #9aa)" }}>Loading settings…</div>;
  }

  return (
    <div>
      <Field label="Timezone" hint="IANA zone for schedule interpretation — saving a change recalculates every active schedule.">
        <TextInput value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} placeholder="America/Chicago" />
      </Field>

      <Field label="Plan approval" hint="'always' parks every drafted plan for your approval; 'auto' skips the gate globally.">
        <select
          value={tasks.planApproval === "auto" ? "auto" : "always"}
          onChange={(e) => void save({ tasks: { ...tasks, planApproval: e.target.value } })}
          disabled={saving}
          className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none"
          style={{ background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)" }}
        >
          <option value="always">always (approve each plan)</option>
          <option value="auto">auto (skip approval)</option>
        </select>
      </Field>

      <Field label="Run mode" hint="How an approved plan is carried out. 'steps' walks the drafted steps one by one. 'sdk' hands the whole plan to one Claude Agent SDK session with the same guardrails: plan approval first, max steps as the turn cap, the run timeout, STOP in the runs tray, and only the gated exec / files / coding tools.">
        <select
          value={tasks.runMode === "sdk" ? "sdk" : "steps"}
          onChange={(e) => void save({ tasks: { ...tasks, runMode: e.target.value } })}
          disabled={saving}
          className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none"
          style={{ background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)" }}
        >
          <option value="steps">steps (bounded step walker)</option>
          <option value="sdk">sdk (one Agent SDK session, same guardrails)</option>
        </select>
      </Field>

      <Field label="Auto-approve categories" hint="Comma-separated task categories (metadata.category) that skip plan approval — seeds use 'brief' and 'planning'.">
        <TextInput value={draft.autoApproveCategories} onChange={(e) => setDraft({ ...draft, autoApproveCategories: e.target.value })} placeholder="brief, planning" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Auto-approve max steps" hint="Plans larger than this still ask, even in an auto-approved category.">
          <TextInput value={draft.autoApproveMaxSteps} onChange={(e) => setDraft({ ...draft, autoApproveMaxSteps: e.target.value })} placeholder="(= max steps)" />
        </Field>
        <Field label="Max steps per run" hint="Hard cap on executed plan steps.">
          <TextInput value={draft.maxStepsPerRun} onChange={(e) => setDraft({ ...draft, maxStepsPerRun: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Run timeout (min)" hint="Wall-clock budget per run; also the boot stuck-recovery threshold.">
          <TextInput value={draft.runTimeoutMin} onChange={(e) => setDraft({ ...draft, runTimeoutMin: e.target.value })} />
        </Field>
        <Field label="Editing buffer (sec)" hint="Grace period after a task turns Ready before the run starts.">
          <TextInput value={draft.editingBufferSec} onChange={(e) => setDraft({ ...draft, editingBufferSec: e.target.value })} />
        </Field>
      </div>

      <Toggle
        label="GC empty scratchpad tasks"
        hint="Exile abandoned Untitled daily tasks when their editing buffer expires."
        checked={tasks.emptyTaskGc !== false}
        disabled={saving}
        onChange={(v) => void save({ tasks: { ...tasks, emptyTaskGc: v } })}
      />

      <SectionTitle>Seed tasks</SectionTitle>
      <p className="text-[10.5px] mb-2.5 leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Recurring starters (disabled until you flip them). Toggling arms/disarms the task&apos;s schedule directly.
      </p>
      {seedTasks.length === 0 ? (
        <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          No seed tasks found — they are created at boot.
        </div>
      ) : (
        seedTasks.map((t) => {
          const meta = SEED_LABELS[String(t.metadata?.seedKey ?? "")];
          return (
            <div key={t.id} className="flex items-center gap-2 mb-2">
              {seedBusy === t.id ? (
                <Loader2 size={13} className="animate-spin shrink-0" style={{ color: TASKS_ACCENT }} />
              ) : (
                <input
                  type="checkbox"
                  checked={t.isActive}
                  disabled={seedBusy !== null}
                  onChange={(e) => void toggleSeed(t, e.target.checked)}
                  style={{ accentColor: TASKS_ACCENT }}
                  className="shrink-0"
                />
              )}
              <span className="min-w-0">
                <span className="block text-[12px] font-medium truncate" style={{ color: "var(--fg, #e8e2f0)" }}>
                  {meta?.label ?? t.title} <span className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{t.displayId}</span>
                </span>
                <span className="block font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  {String(t.metadata?.scheduleText ?? meta?.hint ?? "")}{t.isActive ? "" : " · disabled"}
                </span>
              </span>
            </div>
          );
        })
      )}

      <div className="mt-4">
        <SaveBar saving={saving} saved={saved} onSave={() => void saveAll()} accent={TASKS_ACCENT} />
      </div>
    </div>
  );
}
