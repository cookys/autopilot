# B1 review-loop-resolver-a — evidence bundle

Shape: one sonnet foreman ran the 7 stacked backlog rows (23, 36, 41, 42, 43, 44, 54) in plan order
(`brief.md`), producing per-row hand commits and reviews (`REPORT-foreman.md`). A second sonnet
foreman landed them onto `release/b1` from `origin/develop@4c8c953a` (`brief-land.md`,
`REPORT-land.md`), and this closeout foreman did the docs/evidence/HANDOFF pass (`brief-close.md`).
The shadow commit that became `9fc56347` was named in the brief from the start, not decided
post hoc.

Row 54's repair: the aggregate `sync-codex-plugin-skills.sh --check` caught that row 54's hand had
not regenerated the codex mirror for `scripts/lib/qualification-applicability-scope.js`. A repair
hand on `hands/b1/54-r2` (base `hands/b1/54`) regenerated only that mirror file; the repair was
reviewed SHIP-AS-IS and squashed into the row-54 commit that landed as `2404db23`.

Landing gate: `hooks/tests/run.sh --parallel 8` was 375 files / 1 FAILED
(`engine-qualify-verdict-stability`, D6 honest-solver + other-role parity); rechecked solo and at
base `origin/develop@4c8c953a` in a throwaway worktree — same failure both places, so pre-existing
and not introduced by B1. `check-js-syntax.js`, `sync-codex-plugin-skills.sh --check`, and
`validate.sh` (30/30 skills) all passed clean.

Review: `claude-fable-5-1` via `dispatch-review.sh --runner claude-native --effort high`,
run id `review-1790283760-3046047-113f`, verdict SHIP-AS-IS (3 CUT/FOLLOW-UP, no MUST-FIX) —
see `final-review.json`.

Plan-graduation gotcha: `check-plan-graduation.js --fix` did nothing on the first pass because the
released CHANGELOG section didn't yet contain the plan's full slug
(`backlog-review-loop-resolver-a`) — the detector needs a boundary-matched slug/stem substring in
the CHANGELOG text itself, not just the archived plan file. Adding a one-line plan pointer with the
slug to the CHANGELOG entry made `--fix` archive the plan and rewrite `INDEX.md`/`HANDOFF.md`
references.
