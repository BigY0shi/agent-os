# Start here

Agent OS is a self-hosted operations dashboard. It runs on your own machine, on port 3737, and its agents run on your own CLI subscriptions (Claude, Codex, Hermes, Antigravity and others). There is no vendor backend.

## Where to begin

- **Mission Control** (`/`) is the home page. The Cockpit view shows the machine, the runs, the missions and the crew at a glance; Health shows the machine in detail; Scratchpad is your notes pad.
- **Jarvis** (`/jarvis`) is the orchestrator. Talk to him in the Console or in Voice, give a crew a goal in Missions, see every agent in Crew, edit the files that shape them in Files, and see every recurring job in Standing orders.
- **Every other sidebar entry is one job**: find work (Deal Desk, Hire Engine, Leads), make things (Content Engine, Marketing Hub, Newsletter, Video, Music), think (Brainstorm, Idea Engine, AI Agent Mastermind), or drive one agent directly (Claude, Codex, Hermes and the rest).

## Three things that hold everywhere

1. **Nothing is invented.** A number with no source is shown as unknown, never estimated. An empty panel is honest; a busy animation with nothing behind it is not.
2. **Nothing is deleted.** Removing something moves it aside (retired, exiled or kept as a version) so it can come back.
3. **Keys stay put.** Saved keys are shown as their first five characters and a mask; they never travel to the browser in full.

## Where your data lives

Almost everything is under `~/.agentic-os/` on this machine: settings, the V2 database, missions, crew chats, file versions. The Guide pages for each module name the exact files.
