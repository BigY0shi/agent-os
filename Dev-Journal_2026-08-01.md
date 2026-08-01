# Dev Journal — 2026-08-01

## Idea Engine — live feedback survives reloads; scan shows per-source progress

Operator report: "needs a spinner so I know it's working" + "the scan has no visual
feedback either." Root cause for both: progress state lived only in the page session
that started the work. `/api/idea-engine/list` returned a bare `running` boolean, so a
reload mid-council (operator rebuilds/reloads constantly) — or a daily-loop run the
page never started — showed nothing but a disabled button. The radar scan likewise
never resumed its poll on mount, and its `sources` map only filled as adapters
*finished*, so the first minutes looked dead.

Fixes:
- `ideaValidation.activeRun()` + `list` route now returns the full in-flight run;
  the view adopts it on load and resumes polling (loadRef breaks the load↔watchRun
  useCallback cycle). Council panel gains an elapsed counter + "~8–12 min typical".
- `ideaRadar.startScan()` pre-seeds every adapter as `running…` (sync before the
  first await, so it's visible in the POST response already) and marks the cluster
  stage running/ok; RadarBoard resumes polling on mount and renders a visible
  Scanning strip with per-source chips (running… → ✓/✗).
- Poll intervals now null their refs consistently so the resume guard can't wedge.

tsc clean. Lands with the next rebuild. **Rollback:** revert commit — behavior
returns to session-local spinners only.
