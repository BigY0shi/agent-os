"use client";

// ── SkillsView (SPEC-B B7, CONVENTIONS §11) — the /skills page shell ─────────
// Standing POLICY skills stored in v2_skills and injected into task-execution
// prompts (B2) + the Jarvis context (C4) via skills/store.ts withSkills().
// List (position order, active toggles, up/down reorder) → SkillEditor
// slide-over → rule-16 gear (ConfigMenu). The FILE-based operating skills are managed
// per module (each module's Skills & workflows button) and in Jarvis → Control Room.
// V2 idiom: usePollWhileVisible + muted-neobrutalist atoms shared with
// integrations/automations.

import { useCallback, useState } from "react";
import { ScrollText, Plus, Power, PencilLine, ArrowUp, ArrowDown } from "lucide-react";
import ConfigMenu from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { useJarvisPageContext } from "@/lib/v2/jarvis/pageContext";
import { EmptyState, StatusChip, fmtAgo, panelStyle } from "../integrations/shared";
import SkillEditor from "./SkillEditor";

export const SKILLS_ACCENT = "#c4b5fd";

export interface SkillInfo {
  id: string;
  title: string;
  description: string;
  policyMd: string;
  isActive: boolean;
  position: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function SkillsView() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editor, setEditor] = useState<{ skill: SkillInfo | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v2/skills", { cache: "no-store" });
      const j = await res.json();
      if (Array.isArray(j?.skills)) {
        setSkills(j.skills as SkillInfo[]);
        setFailed(false);
      }
    } catch {
      setFailed(true);
    }
  }, []);

  usePollWhileVisible(refresh, 10000, []);

  useJarvisPageContext({
    route: "/skills",
    title: "Skills",
    summary:
      "Policy skills — standing rules injected into task execution and Jarvis prompts. " +
      (skills ? `${skills.filter((s) => s.isActive).length} of ${skills.length} active.` : ""),
  });

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      await fetch(`/api/v2/skills/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  /** Swap positions with the neighbor (list is already position-ordered). */
  async function move(idx: number, dir: -1 | 1) {
    if (!skills) return;
    const other = idx + dir;
    if (other < 0 || other >= skills.length) return;
    const a = skills[idx];
    const b = skills[other];
    setBusyId(a.id);
    try {
      await fetch(`/api/v2/skills/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: b.position }),
      });
      await fetch(`/api/v2/skills/${b.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: a.position }),
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = skills?.filter((s) => s.isActive).length ?? 0;

  return (
    <div className="px-6 py-5 max-w-[980px]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="inline-flex items-center gap-2 text-[17px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
            <ScrollText size={18} style={{ color: SKILLS_ACCENT }} /> Skills
          </div>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Standing policies injected into task plans, task steps and Jarvis — model-agnostic, applied in order.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip color={activeCount > 0 ? "#34d399" : "#9ca3af"}>
            {activeCount} active
          </StatusChip>
          <button
            onClick={() => setEditor({ skill: null })}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-semibold"
            style={{ background: SKILLS_ACCENT, color: "#221a3a" }}
          >
            <Plus size={14} /> New skill
          </button>
          <ConfigMenu title="Skills settings" accent={SKILLS_ACCENT}>
            <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: "var(--fg-dim, #9aa)" }}>
              Policy skills above are stored in the OS database and injected into V2 task
              execution and Jarvis prompts (active ones only, in list order, capped at ~8k
              characters). The file-based operating skills that front the CLI-agent lanes are
              turned on per module from each module&rsquo;s Skills &amp; workflows button, or all at
              once in Jarvis &rarr; Control Room &rarr; Skills &amp; workflows.
            </p>
          </ConfigMenu>
        </div>
      </div>

      {failed && (
        <div className="text-[12px] mb-3" style={{ color: "#f87171" }}>
          Could not reach /api/v2/skills — is the server running?
        </div>
      )}

      {skills && skills.length === 0 && (
        <EmptyState
          icon={<ScrollText size={20} />}
          title="No policy skills yet"
          hint="Create one — e.g. a voice rule, a consent rule, or a review checklist the agents must follow."
        />
      )}

      <div className="flex flex-col gap-2">
        {(skills ?? []).map((s, idx) => (
          <div key={s.id} className="rounded-xl px-4 py-3" style={panelStyle}>
            <div className="flex items-center gap-3">
              <button
                title={s.isActive ? "Active — click to deactivate" : "Inactive — click to activate"}
                disabled={busyId === s.id}
                onClick={() => patch(s.id, { isActive: !s.isActive })}
                className="shrink-0"
              >
                <Power size={15} style={{ color: s.isActive ? "#34d399" : "#6b6478" }} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold truncate" style={{ color: "var(--fg, #e8e2f0)" }}>
                  {s.title}
                </div>
                {s.description && (
                  <div className="text-[11px] truncate" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    {s.description}
                  </div>
                )}
              </div>
              <span className="text-[10.5px] shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                updated {fmtAgo(s.updatedAt)}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button title="Move up" disabled={busyId !== null || idx === 0} onClick={() => move(idx, -1)}
                  style={{ color: idx === 0 ? "var(--fg-dimmer, #6b6478)" : "var(--fg-dim, #9aa)" }}>
                  <ArrowUp size={14} />
                </button>
                <button title="Move down" disabled={busyId !== null || idx === (skills?.length ?? 1) - 1} onClick={() => move(idx, 1)}
                  style={{ color: idx === (skills?.length ?? 1) - 1 ? "var(--fg-dimmer, #6b6478)" : "var(--fg-dim, #9aa)" }}>
                  <ArrowDown size={14} />
                </button>
                <button
                  title="Edit"
                  onClick={() => setEditor({ skill: s })}
                  className="ml-1"
                  style={{ color: "var(--fg-dim, #9aa)" }}
                >
                  <PencilLine size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editor && (
        <SkillEditor
          skill={editor.skill}
          accent={SKILLS_ACCENT}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
