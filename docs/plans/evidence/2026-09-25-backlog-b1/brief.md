Engine: sonnet

# Foreman brief — backlog bundle B1 `review-loop-resolver-a` (7 S rows)

You are the foreman: you orchestrate and never edit product/test files yourself. Hands write the code; you verify from git
artifacts (`git diff --stat`, the hand's result JSON), never from a hand's self-report. Depth-0 lands the result.

## Setup (already done by depth-0 — authorized here, in the brief)
- Clone `C=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/b1/clone`. Git hooks are enabled and push is disabled.
  `RUN=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/b1/run`.
- develop base = `296e9dcd`. On top of it the clone carries ONE clone-local commit `56189ee6` "PARALLEL-RUN LOCAL ONLY — mission_convergence
  enforcement_mode shadow (never land)". This is the documented parallel-run recipe (`docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md`
  line 7). Without it, `dispatch-hetero.sh` refuses under Mission enforce. **BASE_SHA for row 1 = `56189ee6`.** Never modify, revert, or reset that commit, and never
  touch `.claude/owner-kernel-governance.json`. Depth-0 cherry-picks only hand commits.
- Never touch `/home/cookys/projects/autopilot` (the main checkout), and never run fetch or pull inside the clone.

## The plan
`$C/docs/plans/2026-09-21-backlog-review-loop-resolver-a.md`: rows 23, 36, 41, 42, 43, 44, 54, in that order (P1..P7; do not reorder).
Full row text: `$C/docs/BACKLOG.md` (grep the title) and each row's `Pointer` sidecar under `$C/docs/backlog/`.

## Per row (keep it to ≤ 8 tool calls; combine read-only commands)
1. **Premise check (1 call):** re-derive the defect at the current base (grep the symbol / run the repro). Gone → `SKIP <n> <evidence>`, no hand.
2. **Write `RUN/hand-<n>.md`** with these sections:
   - **Product:** what to change and why, described in prose. The redispatch-prompt hygiene gate rejects fenced code blocks and "around line N".
   - **Tests (RED-first):** a new case function `assert_r<n>_…` in the NEW suite `hooks/tests/review-loop-resolver-a.test.sh`. Row 1's hand creates that file (`chmod +x`); later rows append.
     Before fixing, run it against the unmodified base and record the red output as a `# RED at <sha>:` comment.
   - **Verify:** `test -x` on the new suite, then run the new suite AND every CONSUMER suite of the contract the row changes, not only the bundle suite.
     Always include `hooks/tests/{resolve-review-loop,resolve-review-loop-consult-discuss-switch,contract-parity,resolve-review-loop-consult-discuss-gate,probe-unknown}.test.sh`,
     plus any suite `grep -l` finds for the symbol you changed. Add `node scripts/check-js-syntax.js` and `bash scripts/sync-codex-plugin-skills.sh --check`.
   - **Allowed files:** the minimal set, from plan §3 (plus `platforms/codex/plugin/` mirrors, synced via `bash scripts/sync-codex-plugin-skills.sh`).
   - This line, verbatim: "Commit ONE commit; touch no other file; run every Verify command in the foreground before committing."
3. **Dispatch** (Bash `run_in_background: true`, AND in the same turn a background `sleep 2700; echo WAKE-b1-<n>`; then END YOUR TURN):
   `cd $C && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-hetero.sh --branch hands/b1/<n> --base <prev accepted head or 56189ee6> --ledger RUN/hands.ledger --run-id b1-<n> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file RUN/hand-<n>.md`
   On any wake: look for `rc=` in the dispatch output. If it is not there, wait once with `node scripts/wait-dispatch-results.js --ledger RUN/hands.ledger --expect b1-<n>.implement --timeout 500`
   (foreground, Bash timeout 560000).
4. **Review:** diff `<base>..hands/b1/<n>` into `RUN/<n>.diff`, then run
   `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file RUN/<n>.diff --spec-file RUN/hand-<n>.md > RUN/<n>.review.json`
   in the FOREGROUND with Bash timeout 1000000. If you get no verdict or tool-call-shaped text, retry once with "You have no tools. Answer only with the verdict JSON." added to the spec.
   If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on `hands/b1/<n>-r2` (base = the head of `hands/b1/<n>`) and re-review.
5. **Stacking:** each row's `--base` = the previous row's accepted head (its `-r2` head if repaired). Track this in `RUN/accepted-heads.txt`.
6. A hand-rail failure (quota, readiness, 402, "Cannot use this model", precondition) → `RAIL-FAIL <n> <rc> <stderr tail>`, then continue. NEVER author the code yourself.

## After all rows
In a throwaway worktree at the last accepted head (`git -C $C worktree add RUN/verify <head>`), run, one at a time and solo, each with the env prefix and `< /dev/null`:
- the new suite and the 5 plan §5 suites;
- `check-js-syntax`;
- `sync --check`.

Then remove the worktree.

## Report
`RUN/REPORT.md`: per row, `LAND <n> <head>` / `SKIP` / `FAIL` / `RAIL-FAIL` / `NO-VERDICT`, together with the diff stat, the review verdict and findings, and the RED line. At the end, the aggregate verify table (rc per suite).
Final message: the REPORT path and those per-row lines. Do not bump the version, edit CHANGELOG or BACKLOG, merge, or push.
