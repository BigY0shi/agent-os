"use client";

import dynamic from "next/dynamic";
import ConfigMenu, { useSettings } from "@/components/ConfigMenu";
import Hermes3DSettings, { readHermes3DOptions } from "./Hermes3DSettings";

// WebGL cannot be server-rendered; Next 16 only honours ssr:false from inside a
// client component, which is why this shell sits between the page and the scene.
const HermesOffice = dynamic(() => import("./HermesOffice"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full" style={{ color: "var(--fg-dim, #9aa)", fontSize: 12 }}>
      Loading the scene module...
    </div>
  ),
});

const ACCENT = "#f472b6";

export default function Hermes3DView() {
  const { settings, loading } = useSettings();
  const options = readHermes3DOptions(settings);

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-140px)] min-h-[520px]">
      <div className="flex items-center justify-between gap-3">
        <div style={{ color: "var(--fg-dim, #9aa)", fontSize: 12 }}>
          The baked Synty office in three.js. Drag to orbit, wheel to zoom.
          {" "}Assets come from <code>public/hermes3d/</code> (gitignored; <code>_design/hermes3d/PIPELINE.md</code> rebuilds it).
        </div>
        <ConfigMenu title="Hermes 3D" accent={ACCENT}>
          <Hermes3DSettings accent={ACCENT} />
        </ConfigMenu>
      </div>
      <div className="flex-1 rounded-xl overflow-hidden" style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
        {/* Wait for settings once so the first scene is built with the saved
            quality instead of being rebuilt a beat later. */}
        {loading
          ? <div className="flex items-center justify-center h-full" style={{ color: "var(--fg-dim, #9aa)", fontSize: 12 }}>Reading settings...</div>
          : <HermesOffice options={options} />}
      </div>
    </div>
  );
}
