# Module docs

One file per module. `cli-agents.md` covers all the CLI agent tabs together, because they differ only in which binary they shell out to.

## How to write one (read before adding a file)

You are an agent. The rule that matters more than the format:

**Read the module before you write about it.** Its routes under `src/app/api/<slug>/`, its lib under `src/lib/` or `src/lib/v2/<slug>/`, and its component. A doc that describes plausible behaviour rather than actual behaviour is worse than no doc, because someone will act on it. If you cannot verify a claim, leave it out or mark it unknown.

Each file covers:

1. **Route, backend, UI** on one line, so a reader can jump straight to the code.
2. **What it actually does** — the mechanism, not the pitch. Where does data come from, where does state live, what survives a restart.
3. **Setup** — what it needs before it works, and what "empty" looks like versus "broken". Most of these modules render an empty shell when a file or key is missing, and that distinction is the single most useful thing you can write down.
4. **Routes** — a table. Mark the one people actually use.
5. **Prompts that work** — real examples, not `<your prompt here>`. For modules with a fixed internal prompt, document what the user CAN steer instead.
6. **Gotchas** — the things that cost someone an hour. Cost, silent failure modes, anything counterintuitive that is deliberate.

Keep it in the project voice: plain, specific, no hype. State costs and limits rather than hiding them.

## Status

Written and verified against the code:

- [x] `deal-desk.md`

Not yet written. Listed so the gap is visible rather than implied:

- [ ] cli-agents (claude, codex, cursor, openclaw, antigravity, hermes, pi, ollama, freeclaude, local, engine, fusion, sakana)
- [ ] agents · jarvis · browser · memory · tasks · webmcp · skills
- [ ] room (AI Agent Mastermind) · pipeline · agent-kanban · kanban
- [ ] marketing · hire · leads · audit
- [ ] automations · integrations · newsletter · anynotes
- [ ] idea-engine · brainstorm · content-engine · seo
- [ ] paperclip · opendesign · thumbnails · notebook · terminal · today
- [ ] video · music · games · loop
