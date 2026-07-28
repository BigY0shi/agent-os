// Kanban columns for the Hire Engine, left → right — same shape as the Deal
// Desk's DESK_COLUMNS. Lives in its own file (not hireDesk.ts) because the
// client component needs the VALUE, and hireDesk.ts imports node:fs — pulling
// that into a "use client" bundle breaks the build.
import type { HireStatus } from "./hireDesk";

export const HIRE_COLUMNS: { key: HireStatus; label: string; accent: string }[] = [
  { key: "new", label: "New", accent: "#a855f7" },
  { key: "researching", label: "Researching", accent: "#22d3ee" },
  { key: "approved", label: "Approved", accent: "#fbbf24" },
  { key: "sent", label: "Sent", accent: "#34d399" },
];
