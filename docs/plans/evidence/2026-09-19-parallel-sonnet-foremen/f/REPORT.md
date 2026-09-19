# REPORT — Unit F (suites-f)

## Branches
- `hands/par3-f/f` — commit `bac46f5b40b6c93297d68765fad14d6ce6ac0e6d` (base `4360c58b`) — hetero cursor/cursor-grok-4.6-low, status `committed`.
- `hands/par3-f/f-r2` — commit `d36f5f94c55124c2e59f0a6a180ed3422e682ea1` (base = f's head) — repair round, status `committed`.

## diff --stat vs base (4360c58b), through r2 (final)
```
 hooks/tests/autopilot-cli.test.sh               | 80 +++++++++++++++++++++++--
 hooks/tests/lib.sh                              | 47 +++++++++++++++
 hooks/tests/provider-readiness-consumer.test.sh | 46 +++++++++++++-
 3 files changed, 165 insertions(+), 8 deletions(-)
```
Only the three allowed files (`hooks/tests/provider-readiness-consumer.test.sh`, `hooks/tests/autopilot-cli.test.sh`,
`hooks/tests/lib.sh`) remain in the final delta — no `src/`, `scripts/`, `bin/`, `schemas/`, or config touched.

## Review (round 1, on `f` before repair)
Runner: claude-native / claude-fable-5-1, effort high. **Verdict: FIX-THEN-SHIP**, 3 findings:
- 🟠 `stray-receipt-artifact` (MUST-FIX) — commit `bac46f5b` added a 198-line `provider-readiness-receipt.json` at
  repo root, outside the allowed-files list; leaked test-run artifact, not referenced by any source (the suite
  writes its own copy under `$TEST_TMP`). **Accepted** — independently confirmed via `git ls-tree` and `git grep`
  before dispatching the repair; not a false positive.
- 🔵 `lib-comment-mojibake` (CUT/FOLLOW-UP) — a replacement-character glyph in a `hooks/tests/lib.sh` comment
  (cosmetic, non-blocking). **Refuted as blocking** — comment-only, does not affect execution; left as-is per
  spec's "one repair round for real 🔴/🟠 findings" scope.
- 🔵 `negative-control-scope` (CUT/FOLLOW-UP) — negative controls exercise the resolver/bootstrap path but not a
  full strict-L5/L6 CLI invocation under the empty scorecard dir. **Refuted as blocking** — reviewer itself notes
  this satisfies the spec's literal requirement; flagged only as an optional future extension.

Repair hand (`f-r2`) removed `provider-readiness-receipt.json` only (1 file, 0 insertions, 198 deletions, exactly
one commit). Not re-reviewed by a second round per the "at most one repair round" budget — the fix is a pure
deletion of the single flagged out-of-scope file with no other change, verified directly via `git diff --stat` and
`git ls-tree` (file absent from `f-r2`'s tree).

## Verify command tail lines
Not captured from the dispatch JSON (`dispatch-hetero.sh`'s `f.dispatch.json`/`f-r2.dispatch.json` report only
status/commit/diffstat, not per-command stdout). Foreman did not re-run the Verify block directly (out of Bash
budget for full suite re-execution); the hand's prompt required running every Verify command in the foreground
before committing, and `status: committed` with `error: null` on both rounds is the dispatcher's pass signal. This
is a gap: **not independently confirmed green** by the foreman beyond git-artifact/diff evidence and the reviewer's
pass on round 1 (which did not flag any suite as still failing).

## Not done
- No independent foreground re-run of the 8 Verify commands by the foreman (see above).
- No second review round after the repair (spec allows skipping when repair is a pure, obviously-correct
  deletion of exactly the flagged file; judged safe here).

## BACKLOG-row text found wrong
None — the BACKLOG row's description of the RED (`resolveReviewLoopJson(['--check-scorecard'])` reading live env,
line refs at `provider-readiness-consumer.test.sh:648-655` and `autopilot-cli.test.sh:497,502`) matched what the
hand's diff addresses; no correction needed.
