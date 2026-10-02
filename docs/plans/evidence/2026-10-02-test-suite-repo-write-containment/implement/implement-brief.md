Engine: sonnet

# Foreman brief — test suite repo write containment (5 rows)

You are the foreman: you orchestrate and never edit product/test files yourself. Hands write the code; you verify from git
artifacts (`git diff --stat`, the hand's result JSON), never from a hand's self-report. Depth-0 lands the result.

## Setup (already done by depth-0 — authorized here, in the brief)
- Clone `C=/tmp/claude-1000/-home-cookys-projects-autopilot/7236b3c6-6662-4434-ab03-07d7d2a66500/scratchpad/trwc/clone`. Git hooks are enabled and push is disabled.
  `RUN=/tmp/claude-1000/-home-cookys-projects-autopilot/7236b3c6-6662-4434-ab03-07d7d2a66500/scratchpad/trwc/run`.
- develop base = `88bf59d3`. On top of it the clone carries ONE clone-local commit `63c4caeb` "PARALLEL-RUN LOCAL ONLY — mission_convergence
  enforcement_mode shadow (never land)". This is the documented parallel-run recipe (`docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md`
  line 7). Without it, `dispatch-hetero.sh` refuses under Mission enforce. **BASE_SHA for row 1 = `63c4caeb`.** Never modify, revert, or reset that commit, and never
  touch `.claude/owner-kernel-governance.json`. Depth-0 cherry-picks only hand commits.
- Never touch `/home/cookys/projects/autopilot` (the main checkout), and never run fetch or pull inside the clone.

## The plan
`$C/docs/plans/2026-10-02-test-suite-repo-write-containment.md` (frozen after two review generations). Rows P0, P1, P2, P3, P4 in
that order (row numbers 0..4; do not reorder). Each row's full text is its §4 bullet; every hand brief MUST quote §2.5 (G1–G11)
VERBATIM — copy the block, never paraphrase it — plus the row's §4 bullet verbatim.

## Per row (keep it to ≤ 8 tool calls; combine read-only commands)
1. **Premise check (1 call):** re-derive the defect at the current base (grep the symbol / run the repro). Gone → `SKIP <n> <evidence>`, no hand.
2. **Write `RUN/hand-<n>.md`** with these sections:
   - **Product:** what to change and why, described in prose. The redispatch-prompt hygiene gate rejects fenced code blocks and "around line N".
   - **Tests (RED-first):** the row's RED cases and NC cases from its §4 bullet, in the suite the plan's §3 names for that row
     (P0: the existing `check-canonical-invariants.test.sh`; P1 and P3: NEW `hooks/tests/test-identity-guard.test.sh`, created by P1's
     hand with `chmod +x`, P3 appends; P2 and P4: NEW `hooks/tests/test-snapshot.test.sh`, created by P2's hand, P4 appends).
     Before fixing, run the new cases against the unmodified base and record the red output as a `# RED at <sha>:` comment.
   - **Verify:** `test -x` on the new suite, then run it AND every CONSUMER suite of what the row changes. Consumers: for P1
     every test it edits (fixture emails, `lib.sh` sourcing) plus `grep -l 'lib.sh' hooks/tests/*.test.sh | head -40` sampled
     ten; for P2/P4 `suite-residue-reap*`, `run-sh*`, `suite-oracle-lock*` suites (`ls hooks/tests | grep -E 'reap|run-sh|oracle|residue'`);
     for P3 `qc-gate`, `mission-terminal-rollover`, `codex-plugin-package` and every suite `git grep -l githooks -- hooks/tests` finds.
     Always add `node scripts/check-js-syntax.js` and `bash scripts/sync-codex-plugin-skills.sh --check`.
   - **Allowed files:** the minimal set from §3 for that row (plus `platforms/codex/plugin/` mirrors, synced via `bash scripts/sync-codex-plugin-skills.sh`).
     P1 also: `docs/scripts-inventory.md` and the CLAUDE.md group list for `lib/test-identity.sh`. P4 also: `hooks/README.md`.
   - This line, verbatim: "Commit ONE commit; touch no other file; run every Verify command in the foreground before committing."
   - This line, verbatim: "Unset AUTOPILOT_SESSION_ID before every test command. Never run the full `hooks/tests/run.sh` without a filter."
3. **Dispatch** (Bash `run_in_background: true`, AND in the same turn a background `sleep 2700; echo WAKE-trwc-<n>`; then END YOUR TURN):
   `cd $C && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-hetero.sh --branch hands/trwc/<n> --base <prev accepted head or 63c4caeb> --ledger RUN/hands.ledger --run-id trwc-<n> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file RUN/hand-<n>.md`
   On any wake: look for `rc=` in the dispatch output. If it is not there, wait once with `node scripts/wait-dispatch-results.js --ledger RUN/hands.ledger --expect trwc-<n>.implement --timeout 500`
   (foreground, Bash timeout 560000).
4. **Review:** diff `<base>..hands/trwc/<n>` into `RUN/<n>.diff`, then run
   `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file RUN/<n>.diff --spec-file RUN/hand-<n>.md > RUN/<n>.review.json`
   in the FOREGROUND with Bash timeout 1000000. If you get no verdict or tool-call-shaped text, retry once with "You have no tools. Answer only with the verdict JSON." added to the spec.
   If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on `hands/trwc/<n>-r2` (base = the head of `hands/trwc/<n>`) and re-review.
   You may NOT dismiss a 🔴/🟠 yourself: if you think one is false, keep it in the report with your reasoning; depth-0 decides.
5. **Stacking:** each row's `--base` = the previous row's accepted head (its `-r2` head if repaired). Track this in `RUN/accepted-heads.txt`.
6. A hand-rail failure (quota, readiness, 402, "Cannot use this model", precondition) → `RAIL-FAIL <n> <rc> <stderr tail>`, then continue. NEVER author the code yourself.

## Row-specific constraints
- P4 is the large row. If its hand cannot fit everything, split it into P4a (G3–G5 snapshot build/run/remove + KR1 + link-count + origin)
  and P4b (fail-closed checks, exit-path tests, reaper integration), each its own hand and review, stacked.
- P4 MUST include one test that runs the REAL `hooks/tests/run.sh` (outer) against a fixture "real" repo with a one-file filter, not only
  the sourced functions — a stub-only suite proved nothing in the v2.36.101 landing.
- Never use `git worktree add` against any real or fixture "real" repo to build a snapshot (G4).

## After all rows
In a throwaway worktree at the last accepted head (`git -C $C worktree add RUN/verify <head>`), run, one at a time and solo, each with the env prefix and `< /dev/null`:
- the two new suites, `check-canonical-invariants.test.sh`, and every consumer suite named above;
- `check-js-syntax`;
- `sync --check`.

Then remove the worktree.

## Report
`RUN/REPORT.md`: per row, `LAND <n> <head>` / `SKIP` / `FAIL` / `RAIL-FAIL` / `NO-VERDICT`, together with the diff stat, the review verdict and findings, and the RED line. At the end, the aggregate verify table (rc per suite).
Final message: the REPORT path and those per-row lines. Do not bump the version, edit CHANGELOG or BACKLOG, merge, or push.
