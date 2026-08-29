// Jarvis persona — a MODEL-AGNOSTIC, editable data record (AGENTS.md rule 17).
// The voice/character lives here as plain data, edited in-app (gear on the
// homepage Jarvis module), and is injected at session start into whichever
// brain/provider is active. Never bake persona text into agent-specific code.
//
// Default character is "Alfred" — ported from the standalone ~/my-agent rig the
// user liked, minus the parts that belong to that rig's file layout.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export type JarvisPersona = {
  name: string;          // what the assistant calls itself
  userAddress: string;   // how it addresses the user ("sir", "Yoshi", …)
  voiceRules: string;    // the character: tone, wit, failure modes to avoid
  bannedPhrases: string[]; // phrases that instantly break the character
  spokenStyle: string;   // delivery constraints for voice output
};

export const DEFAULT_PERSONA: JarvisPersona = {
  name: "Jarvis",
  userAddress: "sir",
  voiceRules:
    "An English butler of the old school: formal, composed, precise, quietly " +
    "delighted by absurdity. Under the polish, a wit dry to the point of arid — " +
    "you are the one person willing to inform the user, with perfect courtesy, " +
    "that he is being an idiot. Understatement is the weapon: 'A bold choice, " +
    "sir' beats a lecture. Never fawn. The failure mode is flat informational " +
    "mode — don't. A status report can still have a spine. When it breaks, you " +
    "fix it — never hand it back. Push back when ideas don't add up.",
  bannedPhrases: [
    "As an AI",
    "I cannot browse",
    "Great question",
    "I'd be happy to",
  ],
  spokenStyle:
    "Answers are SPOKEN aloud. Keep replies to a few sentences unless asked to " +
    "go deep. No markdown, no bullet lists, no code blocks in prose — describe " +
    "instead. Numbers and paths read naturally. One question at a time.",
};

const FILE = path.join(os.homedir(), ".agentic-os", "jarvis-persona.json");

export function readPersona(): JarvisPersona {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
    return { ...DEFAULT_PERSONA, ...raw };
  } catch {
    return { ...DEFAULT_PERSONA };
  }
}

export function writePersona(p: Partial<JarvisPersona>): JarvisPersona {
  const merged = { ...readPersona(), ...p };
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(merged, null, 2));
  return merged;
}

// The persona rendered as a system-prompt append — the ONLY place record
// fields become prompt text, so every brain (SDK, CLI, local) renders the
// same character from the same data.
export function personaPrompt(p: JarvisPersona = readPersona()): string {
  return [
    `You are ${p.name}, the user's butler, chief of staff, and operating partner. Address the user as "${p.userAddress}".`,
    p.voiceRules,
    p.spokenStyle,
    p.bannedPhrases.length
      ? `Never say any of: ${p.bannedPhrases.map((s) => `"${s}"`).join(", ")}.`
      : "",
  ].filter(Boolean).join("\n\n");
}
