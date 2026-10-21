# Review deferrals from 2026-10-21

BL-0276. Recorded at closeout. Trigger-Type ready. Effort S.

## Decision-card follow-ups (dmech, merge 6e428fd6c)

- The absolute path in the guard and SessionStart text is not quoted. A path that contains a space breaks the copy-ready command.
- The hook walks scopes by rewriting that walk, instead of sharing open-decision's projectScopes.
- There is no isolation test for a second scope.
- The injection text says "starting with", but the check requires the first line to be exactly [待決回覆].

## autocompact buffer

compaction-handoff.js still has its own copy of 33000. bl250 (merge e993e0fc0) defined AUTOCOMPACT_BUFFER once in scripts/lib/autocompact-window.js and config-audit.js reuses it. The handoff copy was left.

## dwire finalize (merge 215d9084c)

- When the finalize check cannot find the script, the ERROR line has no reason.
- The finding id and the seat are also sent into the check.

## patch-id integration (bl215, merge 3955ea75b)

Known boundaries, not fixed:

- A stable patch-id does not distinguish whitespace. A branch adopted after an indentation-only change still counts as integrated.
- A cherry-pick that is later deleted on develop still counts as integrated.
- Performance: each branch commit runs git several times.
