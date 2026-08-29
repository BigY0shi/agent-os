"use client";

// ── SkillEditor (SPEC-B B7) — create/edit one policy skill ───────────────────
// Right slide-over (ConfigMenu shell idiom): title, description, policy_md
// markdown textarea, active checkbox. Archive = the DELETE route's soft-archive
// (confirm-gated; row retained, drops out of lists + injection).

import { useState } from "react";
import { X, Archive, Loader2 } from "lucide-react";
import type { SkillInfo } from "./SkillsView";

const inputStyle: React.CSSProperties = {
  background: "var(--panel, rgba(255,255,255,0.02))",
  border: "1px solid var(--panel-border, #2a2436)",
  color: "var(--fg, #e8e2f0)",
};

export default function SkillEditor({
  skill,
  accent,
  onClose,
  onSaved,
}: {
  skill: SkillInfo | null; // null = create
  accent: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(skill?.title ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [policyMd, setPolicyMd] = useState(skill?.policyMd ?? "");
  const [isActive, setIsActive] = useState(skill ? skill.isActive : true);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = skill
        ? await fetch(`/api/v2/skills/${skill.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title, description, policyMd, isActive }),
          })
        : await fetch("/api/v2/skills", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title, description, policyMd, isActive }),
          });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(typeof j?.error === "string" ? j.error : `save failed (${res.status})`);
        return;
      }
      await onSaved();
    } catch {
      setError("save failed — is the server running?");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!skill) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/skills/${skill.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(typeof j?.error === "string" ? j.error : `archive failed (${res.status})`);
        return;
      }
      await onSaved();
    } catch {
      setError("archive failed — is the server running?");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative h-full w-full max-w-[520px] overflow-y-auto p-5 shadow-2xl"
        style={{ background: "var(--bg, #0b0713)", borderLeft: `1px solid ${accent}55` }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-[14px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
            {skill ? "Edit skill" : "New skill"}
          </div>
          <button onClick={onClose} style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            <X size={16} />
          </button>
        </div>

        <label className="block mb-3">
          <span className="block text-[12px] font-semibold mb-1" style={{ color: "var(--fg, #e8e2f0)" }}>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Outreach voice rules"
            className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none"
            style={inputStyle}
          />
        </label>

        <label className="block mb-3">
          <span className="block text-[12px] font-semibold mb-1" style={{ color: "var(--fg, #e8e2f0)" }}>Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One line: what this policy governs"
            className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none"
            style={inputStyle}
          />
        </label>

        <label className="block mb-3">
          <span className="block text-[12px] font-semibold mb-1" style={{ color: "var(--fg, #e8e2f0)" }}>Policy (markdown)</span>
          <span className="block text-[10.5px] mb-1.5" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Injected verbatim into task-execution and Jarvis prompts while active. Keep it short and imperative.
          </span>
          <textarea
            value={policyMd}
            onChange={(e) => setPolicyMd(e.target.value)}
            rows={14}
            spellCheck={false}
            placeholder={"- Never send outreach without approval.\n- Use plain language; no em dashes in public copy."}
            className="w-full text-[12px] rounded-md px-2.5 py-2 outline-none font-mono leading-relaxed"
            style={inputStyle}
          />
        </label>

        <label className="inline-flex items-center gap-2 text-[12px] mb-4 cursor-pointer select-none" style={{ color: "var(--fg-dim, #9aa)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ accentColor: accent }} />
          Active (injected into prompts)
        </label>

        {error && <div className="text-[12px] mb-3" style={{ color: "#f87171" }}>{error}</div>}

        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving || !title.trim()}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-[13px] font-semibold disabled:opacity-50"
            style={{ background: accent, color: "#221a3a" }}
          >
            {saving && <Loader2 size={14} className="animate-spin" />} {skill ? "Save" : "Create"}
          </button>
          <button onClick={onClose} className="px-3 h-9 rounded-lg text-[12.5px]" style={{ color: "var(--fg-dim, #9aa)" }}>
            Cancel
          </button>
          {skill && (
            <div className="ml-auto">
              {confirmArchive ? (
                <span className="inline-flex items-center gap-2 text-[12px]" style={{ color: "#fbbf24" }}>
                  Archive this skill?
                  <button onClick={archive} disabled={saving} className="font-semibold underline">Yes, archive</button>
                  <button onClick={() => setConfirmArchive(false)} style={{ color: "var(--fg-dim, #9aa)" }}>No</button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmArchive(true)}
                  className="inline-flex items-center gap-1.5 text-[12px]"
                  title="Soft-archive — the row is kept, it just leaves the list and prompts"
                  style={{ color: "var(--fg-dimmer, #6b6478)" }}
                >
                  <Archive size={13} /> Archive
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
