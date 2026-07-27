// The four productized machines, straight out of Upwork-Leads/machines.md.
//
// The premise of the Hire Engine: a company posting a $50-70k/yr salaried role for
// repetitive work is the buyer for a $1,500-2,500 machine that does 40-80% of that
// role. The pitch is AUGMENT, never replace — "draft-not-send, your hire approves in
// 15 minutes" — which is what removes the "AI will email my customers garbage"
// objection before it forms.
//
// Keep this in step with machines.md; that document is the source of truth for the
// economics and the outreach framing.

export type MachineKey = "support" | "sdr" | "ops" | "admin";

export interface Machine {
  key: MachineKey;
  name: string;
  /** The role title this shows up as on a job board. */
  hiringFor: string;
  /** The repetitive loop the machine takes over. */
  loop: string;
  /** Share of the role the machine covers, per machines.md. */
  coverage: string;
  price: string;
  retainer: string;
  /** Whether the machine actually exists yet — do not pitch vapour. */
  built: boolean;
  buildNote: string;
  accent: string;
}

export const MACHINES: Record<MachineKey, Machine> = {
  support: {
    key: "support",
    name: "CS Triage & Draft Engine",
    hiringFor: "Customer Support / Success / Help Desk",
    loop: "Ticket arrives → classify (bug / how-to / billing / feature) → retrieve the answer from their own docs → draft a reply that cites the source. The human edits and sends.",
    coverage: "70–80% of ticket volume is repeat questions already answered somewhere in the docs",
    price: "$1,500–2,500 one-time",
    retainer: "$300–500/mo hosting & doc-refresh",
    built: true,
    buildNote: "Built — cs-engine (Upwork-Leads/cs-engine). Runs offline on the Claude CLI with bundled embeddings.",
    accent: "#34d399",
  },
  sdr: {
    key: "sdr",
    name: "Speed-to-Lead Setter Engine",
    hiringFor: "SDR / BDR / Inside Sales / Appointment Setter",
    loop: "Lead lands → hit it fast → multi-day, multi-channel cadence (call + SMS + email) → ask 3–6 qualifying questions → book the meeting → log it all in the CRM.",
    coverage: "The chasing and logging automate; the live closing conversation stays human",
    price: "$1,500–2,500 one-time",
    retainer: "$300–500/mo usage & tuning",
    built: false,
    buildNote: "Not built. Shares the spine with support, but carries TCPA / A2P 10DLC compliance friction — machines.md ranks it second for that reason.",
    accent: "#60a5fa",
  },
  ops: {
    key: "ops",
    name: "Ops Coordinator Copilot",
    hiringFor: "Operations / Project / Intake Coordinator",
    loop: "Request lands → capture into a structured record → route to the right person or vendor → chase open items until they close → keep status clean.",
    coverage: "~70–80% of an ops coordinator's day is coordination glue, not judgment",
    price: "$1,500–2,500 one-time",
    retainer: "$150–300/mo",
    built: false,
    buildNote: "Not built. Top of the price band justified by fresh verticals.",
    accent: "#fbbf24",
  },
  admin: {
    key: "admin",
    name: "Chief of Staff Co-Pilot",
    hiringFor: "Executive / Administrative Assistant",
    loop: "Inbound lands → triage and prioritise → find and hold calendar slots across time zones → book travel and logistics → keep the system-of-record current → draft the follow-ups.",
    coverage: "The same four sub-tasks recur in ~90% of these job descriptions",
    price: "$1,500–2,500 one-time",
    retainer: "$200–400/mo",
    built: false,
    buildNote: "Not built. Highest core build cost (~50–70 hrs) of the four.",
    accent: "#c084fc",
  },
};

export const MACHINE_ORDER: MachineKey[] = ["support", "sdr", "ops", "admin"];

export function machineFor(key: string | undefined): Machine {
  return MACHINES[(key as MachineKey) ?? "support"] ?? MACHINES.support;
}
