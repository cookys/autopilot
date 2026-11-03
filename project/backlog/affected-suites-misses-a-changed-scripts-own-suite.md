# affected-suites misses a changed script's own suite (false green) (BL-0371)

PM 2026-11-04: the plancwd lane (base 0fd2de921, final head d56d3ec29, merged as ba84c0327) ran `node scripts/affected-suites.js --run --files <its changed files>` and the selection lacked `hooks/tests/dispatch-plan-review.test.sh` (the changed script's own suite), `hooks/tests/plan-review-plan-path.test.sh` (the added test file) and the plan-review-context / roster-admission / transport / panel-status suites. A false green; PM rated it high priority because any lane may get one while the selector can drop a changed script's own suite.

## Order (PM)

First after G40 P1. Second is BL-0372 (bl-ap-streamjson).

## Status

Fixing on branch hands/selgap/1 (base ba84c0327). Rules: (a) a changed or added suite is always selected; (b) a changed X.js/X.sh selects hooks/tests/X.test.sh, scripts/X.test.js, scripts/lib/X.test.js, hooks/X.test.js and the X.test.* beside it, and a platforms/ mirror counts as its source; (c) existing require/source/mention edges untouched; (d) forced suites are added after the graph walk, so no weak-edge bound or narrowing applies. Only additions.

## Root cause (found 2026-11-04 by the PM)

The PM ran, in zsh, `F=$(git diff --name-only ... | tr '\n' ' '); affected-suites.js --run --files $F`. zsh does not split an unquoted `$F` on spaces, so the nine paths arrived as ONE argument naming no file. The selector did not complain: it answered mode selective with 21 suites (reproduced with `--files "$F"`; `--files no/such/file.js` behaves the same). Invalid input was accepted silently, so the selection was a false green. That also explains why the full nine-file set could not reproduce it.

Fix (same branch): `--files` normalizes every path against --root (absolute inside root becomes relative; outside root, whitespace or newline in a path, an empty path, a directory, or a path found neither on disk nor in HEAD all exit 2 with a message that hints at an unsplit shell variable). A file deleted from the tree but present in HEAD stays legitimate. --base/--head mode is unchanged. The same-name-suite rule (a)/(b) above stays as a supporting hardening. No `--files $VAR` caller exists in scripts, skills, references or hooks (scaffold-mission quotes every path as its own token).
