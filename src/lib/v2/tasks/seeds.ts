import { getDb } from "../db";
import { readSettings } from "../../settings";
import { createTask, getTask } from "./store";
import { applySchedule } from "./recurrence";
import type { Task } from "./types";

/**
 * SPEC-B B3.5 — recurring seed tasks, adapted from upstream tasks.json /
 * morning-brief.ts patterns (DOCS-CHEATSHEET §10).
 *
 * Contract:
 *  - keyed by metadata.seedKey — ensureTaskSeeds() is IDEMPOTENT (re-running
 *    never duplicates; an existing seed task is left alone because the user
 *    owns it from the moment it exists: title edits, schedule tweaks and
 *    enable/disable all happen through the normal task surface);
 *  - created DISABLED by default (settings.tasks.seeds.<key>.enabled, default
 *    false) — nothing fires until Yoshi flips the toggle in the Tasks gear;
 *  - spec_md carries the full recurring-task discipline (idempotency heading
 *    guard, append-only, cap 5/section, skip-if-heading-exists) so the
 *    engine's drafted plan follows the rules;
 *  - each seed sets metadata.category so settings.tasks.autoApprove.categories
 *    can run them unattended (defaults: 'brief' + 'planning' are opted in);
 *  - the scratchpad (/today, B5) does not exist yet — every spec degrades
 *    gracefully: "if the scratchpad API is unavailable, deliver the content
 *    into this task's conversation instead".
 */

export interface SeedDef {
  seedKey: string;
  /** settings.tasks.seeds key. */
  settingsKey: "morningBrief" | "eodWrapup" | "sundayPlanning" | "weeklyRetro";
  title: string;
  category: string;
  /** RRULE in the user-local timezone (settings.tasks.timezone). */
  schedule: string;
  specMd: string;
}

const SCRATCHPAD_FALLBACK =
  "Delivery: append to today's scratchpad page. If the scratchpad API is " +
  "unavailable or returns an error, do NOT fail the run — deliver the same " +
  "content as a message in this task's conversation instead.";

const COMMON_RULES = [
  "Rules (recurring-task discipline — follow these exactly):",
  "- IDEMPOTENCY: before writing, check whether today's heading already exists in the scratchpad. If it does, skip the write entirely and finish quietly — never produce a duplicate section.",
  "- APPEND-ONLY: never replace, rewrite or delete existing scratchpad content. New content is appended after the existing content.",
  "- CAP 5: at most 5 bullets per section; drop the least important beyond that.",
  "- Plain bullets only — never create task items or checkboxes from a seed run.",
  `- ${SCRATCHPAD_FALLBACK}`,
].join("\n");

export const TASK_SEEDS: SeedDef[] = [
  {
    seedKey: "seed:morning-brief",
    settingsKey: "morningBrief",
    title: "Morning Brief",
    category: "brief",
    schedule: "FREQ=DAILY;BYHOUR=7;BYMINUTE=0",
    specMd: [
      "Compose the daily morning brief.",
      "",
      "Order of operations — memory first, then live sources:",
      "1. Search memory for open threads, yesterday's loose ends, and any standing preferences about what belongs in the brief. If setup questions have never been asked (preferred sections, what counts as urgent), ask ONCE in this task's conversation and store the answers in memory — do not re-ask on later runs.",
      "2. Review open tasks: anything Waiting or Review that needs the user, anything scheduled for today.",
      "3. Gmail / Calendar steps: skip silently if the Gmail or Calendar connector is absent — never error on a missing integration.",
      "",
      "Output — append to today's scratchpad with EXACTLY this structure:",
      "<h3>Brief — {date}</h3>",
      "then three sections: 'Carried over' (unfinished from before), 'Suggested today' (what to pick up), 'Heads up' (deadlines, waiting-on-you items). Dedupe across sections.",
      "",
      COMMON_RULES,
    ].join("\n"),
  },
  {
    seedKey: "seed:eod-wrapup",
    settingsKey: "eodWrapup",
    title: "End-of-Day Wrap-up",
    category: "brief",
    schedule: "FREQ=DAILY;BYHOUR=18;BYMINUTE=0",
    specMd: [
      "Summarize the day.",
      "",
      "Gather from task activity, today's completed/moved tasks and memory:",
      "- 'Shipped' — what got finished today,",
      "- 'Still open' — started but unfinished,",
      "- 'Blocking' — items waiting on someone or something.",
      "If ALL three sections would be empty, write the single line 'Quiet day.' instead of empty headings.",
      "",
      "Output — append to today's scratchpad:",
      "<h3>Wrap-up — {date}</h3> followed by the non-empty sections (skip empty sections entirely).",
      "",
      COMMON_RULES,
    ].join("\n"),
  },
  {
    seedKey: "seed:sunday-planning",
    settingsKey: "sundayPlanning",
    title: "Sunday Planning",
    category: "planning",
    schedule: "FREQ=WEEKLY;BYDAY=SU;BYHOUR=19;BYMINUTE=0",
    specMd: [
      "Plan the coming week.",
      "",
      "Order of operations:",
      "1. Read the most recent Weekly Retro (scratchpad heading 'Retro — …' or memory) and honor its 'What to change' items when proposing the plan. If no retro exists yet, proceed without it.",
      "2. List the top open work: active tasks, anything Waiting/Review, upcoming scheduled items.",
      "3. Propose the week's focus: at most 3 priorities, plus suggested deep-work blocks.",
      "",
      "Output — append to today's scratchpad:",
      "<h3>Week plan — {date}</h3> with sections 'Carrying in', 'This week's focus', 'Watch out for'.",
      "",
      COMMON_RULES,
    ].join("\n"),
  },
  {
    seedKey: "seed:weekly-retro",
    settingsKey: "weeklyRetro",
    title: "Weekly Retro scaffold",
    category: "planning",
    schedule: "FREQ=WEEKLY;BYDAY=FR;BYHOUR=16;BYMINUTE=0",
    specMd: [
      "Lay down the weekly retrospective SCAFFOLD — empty headings the user fills in themself.",
      "",
      "Output — append to today's scratchpad:",
      "<h3>Retro — {date}</h3>",
      "then the three empty section headings 'Went well', 'Didn't go well', 'What to change' with no content under them.",
      "",
      "Do NOT fill the sections in — this is deliberately a scaffold; the user writes the retro. The only generated text is the headings themselves.",
      "",
      COMMON_RULES,
    ].join("\n"),
  },
];

function seedEnabled(settingsKey: SeedDef["settingsKey"]): boolean {
  const seeds = readSettings().tasks?.seeds;
  return seeds?.[settingsKey]?.enabled === true; // default: disabled
}

/** Find an existing seed task by metadata.seedKey (upsert identity). */
export function findSeedTask(seedKey: string): Task | null {
  const row = getDb()
    .prepare("SELECT id FROM v2_tasks WHERE json_extract(metadata, '$.seedKey') = ?")
    .get(seedKey) as { id: string } | undefined;
  return row ? getTask(row.id) : null;
}

/**
 * Idempotent boot seeding: create each missing seed task (source 'seed',
 * schedule applied, isActive per settings.tasks.seeds.<key>.enabled — default
 * DISABLED so nothing fires until enabled in the Tasks gear). Existing seed
 * tasks are NOT touched: once created they belong to the user (UI toggles /
 * PATCH own their state). Returns the number of seed tasks now present.
 */
export function ensureTaskSeeds(): number {
  let present = 0;
  for (const def of TASK_SEEDS) {
    try {
      const existing = findSeedTask(def.seedKey);
      if (existing) {
        present++;
        continue;
      }
      const task = createTask({
        title: def.title,
        specMd: def.specMd,
        source: "seed",
        status: "Todo",
        metadata: { seedKey: def.seedKey, category: def.category },
        actor: "system",
      });
      applySchedule(task.id, {
        schedule: def.schedule,
        isActive: seedEnabled(def.settingsKey),
      });
      present++;
      console.log(
        `[v2/tasks] seeded ${def.title} (${task.displayId}) — ${seedEnabled(def.settingsKey) ? "ENABLED" : "disabled until toggled in the Tasks gear"}`,
      );
    } catch (err) {
      console.warn(`[v2/tasks] seeding '${def.seedKey}' failed:`, err);
    }
  }
  return present;
}
