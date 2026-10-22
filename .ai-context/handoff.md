## REA persona for Personas-mod — session handoff

**Goal:** Author an "REA (Reverse Engineer Anything)" persona for the user's own
Claude Code plugin "Personas-mod", located on the DESKTOP machine at
`Documents/AgenticOS/Personas-mod`. The new persona must match that plugin's
existing persona file format (plugin.json + per-persona files) — not be invented.

**Decisions:**
- REA must be authored in Personas-mod's native format — copy an existing persona
  file's structure exactly rather than guessing a schema.
- This is a Claude Code plugin persona, NOT an Agent OS in-repo artifact. The
  agent-os repo (crew roles, AgentPersona type, jarvisPersona) is the wrong home;
  do not add REA there.

**Rejected alternatives:**
- Adding REA as an agent-os crew "prepared role" (src/lib/v2/crew/roles.ts) — user
  clarified it's a CC plugin, not a repo feature.
- A format-neutral draft written blind — started, then abandoned; the plugin's real
  format is required.

**Open / blocked:**
- Cannot read Personas-mod from this cloud container. DESKTOP is OFFLINE in remote
  Desktop Commander (last seen ~19h). Plugin is not synced here and not on GitHub.
- Need one of: (a) run this task from a LOCAL CC session on DESKTOP, (b) push
  Personas-mod to GitHub so it can be attached, or (c) paste plugin.json + one
  persona file. Route (a) is the reason for this handoff.

**Conventions noted:**
- Agent OS repo gate is `./test.sh`, NOT `npm test` (no "test" script exists); a
  stop hook that ran `npm test` failed spuriously — unrelated to any task change.
- Repo is untouched this session (git clean); nothing committed or pushed.
