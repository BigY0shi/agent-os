thread_id: 019efd0a-01ea-7353-baeb-07e85afd89c6
updated_at: 2026-06-25T04:29:12+00:00
rollout_path: C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-12-019efd0a-01ea-7353-baeb-07e85afd89c6.jsonl
cwd: \\?\C:\Users\Yoshi\AppData\Local\Temp

# Maximum non-destructive compression of IRIS/G2 notes

Rollout context: notes about IRIS template/autonomy architecture and cc-g2-win build; key facts include multi-CLI desktop agent for Even G2 glasses, external STT/TTS, Windows backend + Android EvenHub app, and a running FastAPI/Whisper/Claude/gesture-HUD prototype with missing QR code.

## Task 1: Compress IRIS/G2 rollout notes

Outcome: success

Preference signals:
- The user explicitly required "maximum non-destructive compression" with "ZERO information loss" and "No prose. Raw signal." -> future similar cleanup should preserve all facts/relationships while stripping only function words/filler.
- The user asked to "Group entries by subject" and merge same-work entries into one time-blocked entry -> future compression should prioritize subject-based consolidation over line-by-line preservation.
- The user required "Maintain chronological order — entries must appear oldest to newest" and "Preserve ## timestamp | branch format" -> future output should keep that exact structural ordering/format when compressing notes.

Key steps:
- Preserved the chronological sequence 00:42, 00:53, 00:56, 01:27, 03:52.
- Collapsed related IRIS architecture notes into one subject block: template + autonomy loop + ref-repo research + claude-code-g2 analysis + cc-g2-win build.
- Kept the causal/functional relationships: external STT/TTS, screenshot→provider-call→act loop, Windows backend + Android EvenHub app, dev launcher, QR code missing, pause pending Hollow-agentOS review.

Failures and how to do differently:
- No failure in the compression task itself; the only risk was dropping relationship detail, so future compression should keep causality explicit even when shortening aggressively.
- If multiple entries share the same project/issue, merge them into one time-blocked entry instead of leaving them separate, per user instruction.

Reusable knowledge:
- This kind of request is a strict lossless-style note compression task: keep all entities, verbs, and causal links; remove only articles, filler, and obvious connective tissue.
- The desired output shape is a raw shorthand note stream, not a prose summary.

References:
- User instruction snippets worth preserving verbatim: "Apply maximum non-destructive compression", "Keep ALL facts, ALL refs, ALL verbs, ALL relationships", "No prose. Raw signal.", "Group entries by subject", "Maintain chronological order", "Preserve ## timestamp | branch format".
- Content preserved in compressed output: IRIS, Even G2 glasses, Claude/Gemini/Copilot CLI, OpenAI/Llama APIs, external STT/TTS, autonomy loop screenshot→provider-call→act, six ref repos (agentOS/everOS/memoryOS/agent-skillOS/Phi-AgentOS), claude-code-g2, Windows backend, Android EvenHub app, even-terminal fails, cc-g2-win, FastAPI, faster-whisper, Claude stream-json, EvenHub TS gesture HUD, dev launcher, QR code missing, Hollow-agentOS review paused.
