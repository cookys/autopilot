# affected-suites selects too many suites for a docs-only diff (BL-0357)

Source: acceptance of the BL-0352 archive commit, 2026-10-31.

## Observation
- The commit changed only docs/BACKLOG.md and two docs/backlog/*.md files.
- `node scripts/affected-suites.js --base a327547de --head <that commit> --run` selected 380 suites; a full run takes one to two hours and the hand stopped after 110.

## Fix direction (not implemented)
1. Find which audits or rules link docs/BACKLOG.md and docs/backlog/ to so many suites. Likely candidates: whole-repo audits such as sealed-docs, check-plan-graduation, check-backlog-entries.
2. Make a docs-only change select only the suites that really read those files, plus the whole-repo audits. The whole-repo audits must always stay selected.
3. Negative control: after narrowing, a suite that is truly affected by a docs change must still be selected. Show the control red before green.
