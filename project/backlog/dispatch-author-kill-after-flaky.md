# dispatch-author-kill-after.test.sh red once in the 6-job pool, cause unknown (BL-0397)

Source: PM via fleet, 2026-11-05.

## Problem
- Full suite `node tools/migrate/suite-baseline.js run-all --jobs 6` on develop merge 63308bd8f, host load about 39: `hooks/tests/dispatch-author-kill-after.test.sh` exited rc=1 in the pool; run-all reran it alone and it passed (16 assertions). `record` stores `{"status":"fail","flaky_under_parallel":true,"pool_rc":1}`.
- The pool run's output was not kept, so the failing assertion is unknown (see item 2).

## Item 1: does kill-after have the shape that made agy-timeout flaky?
`dispatch-author-agy-timeout.test.sh` was fixed in faf78ec38 (5563a4bf6): sleeper lengths derived from the shell PID, because process names are host-wide. kill-after was not given that fix; read at origin/develop 63308bd8f:
- Fixed sleep lengths, host-wide: `hooks/tests/dispatch-author-kill-after.test.sh:23-26` (`86421`, `86423`, patterns `sleep 8642[1]` / `sleep 8642[3]`). Two concurrent runs of this suite (two worktrees, or a pool plus a hand run) share them.
- Global process matching and kill: `:28-35` (EXIT trap runs `pgrep -f` on the fixed patterns and `kill -9`s every match, including another run's sleeper); the leftover assertions `:72` and `:146` fail if any other run's sleeper is alive.
- Tight timing windows, not scaled by `AUTOPILOT_TEST_TIMING_FACTOR` (which the pool sets to the job count; `hooks/tests/lib.sh:784-793`): `BOUND_SECS=12` for a 2 s timeout plus 2 s grace (`:39`, `:46-47`, asserted `:68`, `:142`); normal-exit stubs must finish within 8 s (`:108`, `:171`); a fixed `sleep 0.5` before the leftover check (`:71`, `:145`).
- Under load 39 the 12 s and 8 s windows are the likelier cause; the sleeper collision needs a second concurrent run. Both are unconfirmed, because the pool output is gone.
- Not in scope here: fixing the test. Candidate fix, once the cause is known: PID-derived lengths as in agy-timeout (`:21-37`) and bounds multiplied by the timing factor.

## Item 2: run-all drops the pool log of a suite it reruns
`tools/migrate/suite-baseline.js` `run-all`: a pool failure is pushed to `held` as `{id, r}` (`:369-372`), then only the rerun's result is printed (`:376-381`, `emit(again, ...)`); `r.out` of the pool run is never written, and `poolWhy` keeps only `rc=N` or `timeout` (`:379`). BL-0392 (serial rerun) does not cover this, it adds a rerun for serial suites and says nothing about keeping logs.
- Fix: write the pool run's output (a `pool-output:` block or a file next to the results, path printed in the `flaky-under-parallel:` line) so a flaky suite's failing assertion survives; keep the line shapes `record` parses (`:150-153`) unchanged or extend them together.

## Notes
- Trigger: PM dispatch. Effort S.
