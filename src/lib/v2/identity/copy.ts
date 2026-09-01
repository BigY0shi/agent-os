// Client-safe identity copy.
//
// Imports NOTHING — principals.ts pulls in node:fs, so a client component that
// wanted this string would drag the filesystem into the browser bundle. Same
// reason integrations/constants.ts exists, and the same failure it prevents:
// the OAuth callback origin got duplicated into a component and drifted to the
// wrong port. One definition, imported by both sides.

/**
 * The warning the persist-credentials checkbox must carry, everywhere it is
 * offered — Forge, model import, harness install.
 *
 * It names the inheritance because that is the part a user cannot infer: a
 * checkbox that says "stay signed in" reads as a decision about ONE agent, and
 * it is not. Every sub-agent that agent ever spawns inherits the folder.
 */
export const PERSIST_CREDENTIALS_WARNING =
  "Keep this agent signed in between runs. Its logins are stored in a folder only " +
  "this agent can reach. Note that any sub-agent it spawns (Agent 43 spawns 43A, " +
  "43B, 43C) inherits that folder and those logins — so anything you sign this " +
  "agent into, every sub-agent it ever creates can use.";

export const PERSIST_CREDENTIALS_LABEL = "Keep this agent signed in between runs";

/** Shown when the box is left unticked, so the trade-off is visible both ways. */
export const PERSIST_CREDENTIALS_OFF_HINT =
  "Off: the agent gets a scratch folder and signs in again each time. Safer, and " +
  "the right default for anything that does not need a durable login.";
