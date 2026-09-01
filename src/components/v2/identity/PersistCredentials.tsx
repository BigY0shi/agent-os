"use client";

// The persist-credentials choice, shared by every surface that creates an agent
// — the Forge wizard, model import, harness install.
//
// One component rather than three copies, because the warning is the load-
// bearing part: a checkbox that reads "stay signed in" looks like a decision
// about ONE agent, and it is not. Sub-agents inherit the folder, so the warning
// has to travel with the control. Copy lives in lib/v2/identity/copy.ts so it
// cannot drift between surfaces.

import { AlertTriangle } from "lucide-react";
import {
  PERSIST_CREDENTIALS_LABEL,
  PERSIST_CREDENTIALS_OFF_HINT,
  PERSIST_CREDENTIALS_WARNING,
} from "@/lib/v2/identity/copy";

export default function PersistCredentials({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label
        className={`flex items-center gap-2 text-[12.5px] ${disabled ? "opacity-50" : "cursor-pointer"}`}
        style={{ color: "var(--fg-dim)" }}
      >
        <input
          type="checkbox"
          checked={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {PERSIST_CREDENTIALS_LABEL}
      </label>

      {/* The consequence is shown when the box is TICKED — that is the state
          that grants something, so that is the state that needs explaining. */}
      {value ? (
        <div
          className="flex gap-2 rounded-lg border px-2.5 py-2 text-[11.5px] leading-relaxed"
          style={{
            borderColor: "rgba(234,179,8,0.35)",
            background: "rgba(234,179,8,0.07)",
            color: "var(--fg-dim)",
          }}
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: "rgb(234,179,8)" }} />
          <span>{PERSIST_CREDENTIALS_WARNING}</span>
        </div>
      ) : (
        <p className="text-[11.5px] leading-relaxed pl-5" style={{ color: "var(--fg-dim)", opacity: 0.75 }}>
          {PERSIST_CREDENTIALS_OFF_HINT}
        </p>
      )}
    </div>
  );
}
