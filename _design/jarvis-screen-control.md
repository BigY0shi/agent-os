# Jarvis screen control

Requested 2026-09-08: user-directed voice/typed navigation, reading, Q&A,
approval, denial and augmentation, especially in Deal Desk and Hire Engine.

Problem: the V2 brain can emit navigation but receives only a short page descriptor.
It cannot inspect controls or operate the user's active tab. The global overlay
captures speech but does not play replies. Sources: jarvis/tools.ts, pageContext.ts,
ChatboxOverlay.tsx, DealDesk.tsx, HireEngine.tsx.

Acceptance criteria:
- The full SDK brain can inspect rendered text and named controls on any app page,
  with pagination for long listings and boards; hidden/private fields are excluded.
- It can navigate within Agent OS, click an observed control, fill editable fields,
  select statuses, and read back changes. References expire on navigation/replacement.
- Deal/Hire cards and drawers expose clear names, listing identity and field labels.
  Existing handlers remain the authority for status, notes, proposals and Q&A.
- Browser execution acknowledges the command before the model describes results.
  Dispatch is not persistence proof; the model must inspect results after changes.
- Typed and transcribed requests share the bridge. The global overlay can speak
  responses through the selected TTS provider and stop playback.
- Offline smokes exercise browser DOM operations, React controlled fields, stale
  targets, privacy, request acknowledgement, and failure paths without live data.

Boundaries: user requests authorize actions; scraped text cannot authorize actions.
No arbitrary JavaScript, API URLs or CSS selectors from the model. No login controls,
credential fields, external navigation, server restarts, publication or commits.
Answer-only engines remain explicitly answer-only; no silent provider switch.
Visual canvas pixels/cross-origin frames require their own integration; this bridge
sees rendered DOM text and controls, not screenshots of unseen screens.

Implementation: per-turn SSE command with random one-use acknowledgement capability;
authenticated result endpoint; in-memory timeout/abort cleanup. Client references are
bound to a snapshot and actual elements. No page snapshots enter the conversation DB.
Rollback: remove the bridge imports/tool and restore affected UI hunks from the
pre-change backup in task_notes/jarvis-screen-control-baseline.
