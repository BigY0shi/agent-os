# Dev Journal — 2026-07-31

## Agents cron fix — natural-language schedules + loud failures

Operator report: "my Agents cron jobs aren't running." Evidence chain: the scheduled
agent's trigger on disk was `cron: "8am Daily"` with a forever-empty cursor; croner
throws on that phrase and agentsTriggers.ts's catch swallowed it silently EVERY MINUTE
("ignore rather than crash the loop"). The UI placeholder — "0 8 * * * (8am daily)" —
invited exactly that phrasing. Fix: `normalizeSchedule()` accepts real cron unchanged
(croner is the authority) and translates common phrases ("8am daily", "every 15
minutes", "weekdays 9am", "every tuesday at 17:30", noon/midnight, bare weekday →
9am default); anything unrecognizable now `warnOnce`s to the server log instead of
silent-skipping. Placeholder rewritten to teach both forms. No data migration needed —
"8am Daily" is now valid as stored. Verified via esbuild bundle: 17/17 cases incl. the
operator's exact value → `0 8 * * *`; garbage → null+warn. tsc clean. Lands with the
next rebuild. **Rollback:** revert commit; behavior returns to strict-cron-or-silence.
