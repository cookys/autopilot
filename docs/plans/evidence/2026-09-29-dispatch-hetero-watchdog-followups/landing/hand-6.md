# Repair hand — watchdog alive-check must fail toward firing

Base is the accepted head of the R5 row. The combined review of the whole stack found one must-fix, and depth-0 re-derived it from the code.

## Product
In scripts/dispatch-hetero.sh the new pre-fire gate in `_arm_worker_watchdog` ("if ! _watchdog_worker_alive; then exit 0") makes the watchdog exit without firing whenever liveness cannot be PROVEN. Two helpers cause that:
- `_watchdog_pgid_has_live` returns 1 (not alive) when `ps -e -o pgid=,state=` produces no output at all (ps cannot fork under pid or memory exhaustion by the very runaway worker being bounded, or a non-procps ps without the `state` keyword).
- `_watchdog_worker_alive`, in the SCOPE_UNIT branch, treats an empty `ps -o state= -p` result the same as a dead worker.
The result is that the watchdog exits silently, the parent's wait never returns, the run hangs unbounded, and the manifest still says timeout_enforced true.

Required behaviour: distinguish "ps produced no usable output" (unknown) from "the group contains only zombies" (dead). Unknown must count as alive so the watchdog fires; firing at an already-dead group is harmless because the existing signal path already un-stamps `.fired` on ESRCH. Concretely: capture the ps output first; if the ps command fails or its output is empty, return alive. Only when ps produced output and no non-zombie process carries the target pgid is the group dead. In the SCOPE_UNIT branch an empty state for the main worker pid means unknown and falls through to the group check, and if that check also has no ps output the answer is alive.
While you are in `_watchdog_pgid_has_live`, drop the two per-line `tr` subshells: `read -r pgid st` already strips whitespace.
Keep the function names and the declare -f serialization list in the detached path unchanged (a new helper name would have to be added to that list — do not add helpers; edit in place). Mirror the change to platforms/codex/plugin/scripts/dispatch-hetero.sh via `bash scripts/sync-codex-plugin-skills.sh`.

## Tests (RED-first)
Append to hooks/tests/dispatch-hetero-watchdog-followups.test.sh a case `assert_r6_alive_check_fails_open_to_firing`. It must run the REAL helpers (eval them out of scripts/dispatch-hetero.sh the way the existing r3 tests do), with PATH shadowed so that `ps` is a stub that prints nothing and exits 1, and assert `_watchdog_worker_alive` returns 0 for both the plain and the SCOPE_UNIT shapes. Add a second assertion that with a real ps and a target pgid consisting only of a zombie (use the same zombie construction the existing r3 test uses) the helper still returns 1, so the fix does not turn every case into alive. Before fixing, run the new case against the unmodified base and record the red output as a `# RED at <sha>:` comment. Write asserts as (actual, expected) to match the lib.sh order.

## Verify
`test -x` on the suite; run hooks/tests/dispatch-hetero-watchdog-followups.test.sh, hooks/tests/dispatch-hetero-wall-timeout.test.sh, hooks/tests/dispatch-hetero-gc.test.sh, hooks/tests/dispatch-hetero-contract.test.sh and hooks/tests/dispatch-hetero.test.sh one at a time in the foreground; then `node scripts/check-js-syntax.js` and `bash scripts/sync-codex-plugin-skills.sh --check`. Do not use pkill or pgrep with broad patterns in any test.

## Allowed files
scripts/dispatch-hetero.sh, platforms/codex/plugin/scripts/dispatch-hetero.sh, hooks/tests/dispatch-hetero-watchdog-followups.test.sh.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
