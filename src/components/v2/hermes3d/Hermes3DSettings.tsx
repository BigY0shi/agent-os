"use client";

import type { CSSProperties } from "react";
import { useSettings } from "@/components/ConfigMenu";
import { DEFAULT_HERMES3D } from "@/lib/v2/hermes3d/sceneDefaults";

// The gear body for /hermes3d (rule 16). Only knobs the scene actually reads
// are shown; `talkingHoldMs` exists in settings.hermes3d but nothing consumes
// it until run state is wired, so it stays out of the panel rather than being
// a switch attached to nothing.
export interface Hermes3DOptions {
  quality: "full" | "lite";
  shadows: boolean;
  showFps: boolean;
  seatedCount: number;
}

export function readHermes3DOptions(settings: Record<string, unknown> | null): Hermes3DOptions {
  const raw = (settings?.hermes3d ?? {}) as Partial<Hermes3DOptions>;
  const seated = Number(raw.seatedCount);
  return {
    quality: raw.quality === "lite" ? "lite" : "full",
    shadows: typeof raw.shadows === "boolean" ? raw.shadows : DEFAULT_HERMES3D.shadows,
    showFps: typeof raw.showFps === "boolean" ? raw.showFps : DEFAULT_HERMES3D.showFps,
    seatedCount: Math.max(0, Math.min(18, Number.isFinite(seated) ? Math.round(seated) : DEFAULT_HERMES3D.seatedCount)),
  };
}

export default function Hermes3DSettings({ accent = "#f472b6" }: { accent?: string }) {
  const { settings, saving, save } = useSettings();
  const cur = readHermes3DOptions(settings);
  const patch = (p: Partial<Hermes3DOptions>) => save({ hermes3d: { ...cur, ...p } });

  const label: CSSProperties = { color: "var(--fg, #e8e2f0)", fontSize: 12, fontWeight: 500 };
  const hint: CSSProperties = { color: "var(--fg-dimmer, #6b6478)", fontSize: 10.5 };
  const field: CSSProperties = {
    background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)",
    color: "var(--fg, #e8e2f0)", borderRadius: 8, padding: "4px 8px", fontSize: 12,
  };

  return (
    <div className="space-y-4">
      <div>
        <div style={label}>Quality</div>
        <div style={hint}>lite: no fill lighting, no antialias, pixel ratio 1. For the tailnet laptops.</div>
        <select value={cur.quality} onChange={(e) => patch({ quality: e.target.value === "lite" ? "lite" : "full" })} style={{ ...field, marginTop: 4 }} disabled={saving}>
          <option value="full">full</option>
          <option value="lite">lite</option>
        </select>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={cur.shadows} onChange={(e) => patch({ shadows: e.target.checked })} disabled={saving} style={{ accentColor: accent }} />
        <span style={label}>Shadows</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={cur.showFps} onChange={(e) => patch({ showFps: e.target.checked })} disabled={saving} style={{ accentColor: accent }} />
        <span style={label}>Show fps in the HUD</span>
      </label>
      <div>
        <div style={label}>Seated bodies</div>
        <div style={hint}>Idle characters on the chairs nearest the floor centre. 0 shows the office alone. They are not agents until run state is wired.</div>
        <input type="number" min={0} max={18} value={cur.seatedCount} onChange={(e) => patch({ seatedCount: Number(e.target.value) })} disabled={saving} style={{ ...field, marginTop: 4, width: 80 }} />
      </div>
      <div style={hint}>Changes re-create the scene. Saved through PATCH /api/settings like every other gear.</div>
    </div>
  );
}
