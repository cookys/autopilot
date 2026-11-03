# affected-suites misses a changed script's own suite (false green) (BL-0371)

PM 2026-11-04: the plancwd lane (base 0fd2de921, final head d56d3ec29, merged as ba84c0327) ran `node scripts/affected-suites.js --run --files <its changed files>` and the selection lacked `hooks/tests/dispatch-plan-review.test.sh` (the changed script's own suite), `hooks/tests/plan-review-plan-path.test.sh` (the added test file) and the plan-review-context / roster-admission / transport / panel-status suites. A false green; PM rated it high priority because any lane may get one while the selector can drop a changed script's own suite.

## Order (PM)

First after G40 P1. Second is BL-0372 (bl-ap-streamjson).

## Status

Fixing on branch hands/selgap/1 (base ba84c0327). Rules: (a) a changed or added suite is always selected; (b) a changed X.js/X.sh selects hooks/tests/X.test.sh, scripts/X.test.js, scripts/lib/X.test.js, hooks/X.test.js and the X.test.* beside it, and a platforms/ mirror counts as its source; (c) existing require/source/mention edges untouched; (d) forced suites are added after the graph walk, so no weak-edge bound or narrowing applies. Only additions.

## Reproduction note

At ba84c0327 the full 9-file plancwd set already selects 439 suites, including both missing suites, so the original 21-suite result did not reproduce from that input. What does reproduce: a codex mirror of a script alone, or the mirrored files without the source script, drop the script's own suite (31 selected, `dispatch-plan-review.test.sh` absent). Absolute paths in --files make the result `full` with no suites (not fixed here).
