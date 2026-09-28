# dispatch-hetero.sh wall-clock watchdog — repair pass (r4) — CRITICAL

A real (non-stub) cursor-rail run with `--timeout 20s` and `--ledger`/`--run-id`/`--stage` all
supplied (i.e. every real dispatch, since those three flags are always passed by callers) ran to
natural completion at 322 seconds wall instead of being killed at ~20-30s. The watchdog never fired
at all, even though the result JSON claimed `"timeout_enforced": true`. This is the exact defect
this whole row exists to remove, now confirmed live.

## Root cause

`scripts/dispatch-hetero.sh` has a DETACHED execution path: when `--ledger`/`--run-id`/`--stage` are
all supplied and `DISPATCH_DETACH` is not disabled (the default, and what every real dispatch uses),
the dispatcher forks a detached child session and serializes its own function definitions and
variables into a state file via a `declare -p ...` / `declare -f ...` block inside
`dispatch_detached_run()`, then re-sources that state file inside the detached child before running
`detached_main`. Only the functions and variables named in those `declare -p`/`declare -f` lists
exist inside the detached child's shell — anything not listed is simply absent there.

The `declare -f` list in `dispatch_detached_run()` includes `_wait_worker_with_watchdog`,
`_arm_worker_watchdog`, `_watchdog_signal_worker`, `_setsid_wait_worker_sid`, `_self_pgid`, and
`_cancel_worker_watchdog` — but it does NOT include `normalize_timeout_seconds`, which
`_wait_worker_with_watchdog` calls to compute `secs` before deciding whether to call
`_arm_worker_watchdog`. Inside the detached child, calling the undefined `normalize_timeout_seconds`
fails silently (the call site already wraps it with `2>/dev/null || true`), `secs` comes out empty,
and `_arm_worker_watchdog` is simply never invoked — so no watchdog is ever armed on the path every
real dispatch takes. This is why the stub test suite passed: none of its test cases pass
`--ledger`/`--run-id`/`--stage` together, so none of them ever exercise the detached path — they all
run the (still-correct) inline path instead.

## Fix (do this and ONLY this)

1. Add `normalize_timeout_seconds` to the `declare -f ...` list inside `dispatch_detached_run()` in
   `scripts/dispatch-hetero.sh` (the same list that already has `_wait_worker_with_watchdog` etc.).
2. Before doing that, audit the ENTIRE call graph reachable from `_wait_worker_with_watchdog`,
   `_arm_worker_watchdog`, `_watchdog_signal_worker`, `_cancel_worker_watchdog`, and
   `_setsid_wait_worker_sid` for any OTHER function or variable referenced that is not already
   present in either the `declare -p` or `declare -f` lists in `dispatch_detached_run()`. Add
   whatever else you find missing. (Known-good so far: `_self_pgid`, `_cancel_worker_watchdog`,
   `_setsid_wait_worker_sid`, `_watchdog_signal_worker`, `_arm_worker_watchdog`,
   `_wait_worker_with_watchdog` are already in the `declare -f` list; `TIMEOUT`, `TIMEOUT_SOURCE`,
   `TIMEOUT_SUPPLIED`, `WORKER_TIMED_OUT`, `SCOPE_UNIT`, `WORKER_SID` are already in the `declare -p`
   lists. Confirm this is actually complete — do not assume, check every identifier these six
   functions reference.)
3. Also check `emit()` and `write_manifest()` (already in the `declare -f` list) for the SAME
   `normalize_timeout_seconds` dependency — they call it too, so it must genuinely be available in
   the detached child for BOTH the watchdog arming AND the result/manifest `timeout_seconds` field to
   work correctly there. One fix (step 1) covers all three call sites since it's the same missing
   function.
4. Mirror the same fix in `platforms/codex/plugin/scripts/dispatch-hetero.sh` via
   `bash scripts/sync-codex-plugin-skills.sh`.

Do not touch anything else — no other behavior change, no refactor.

## Tests (RED-first against r3)

Add a new test case to `hooks/tests/dispatch-hetero-wall-timeout.test.sh` that runs the stub through
the DETACHED path specifically, i.e. supplies `--ledger`/`--run-id`/`--stage` together (matching what
every real caller passes) so `DISPATCH_DETACH` engages its default-on behavior, with a 120-second
sleep stub and `--timeout 3s`. Poll for the ledger/result file the detached path writes (look at how
`hooks/tests/dispatch-detach.test.sh` or `hooks/tests/dispatch-hetero.test.sh` waits for a detached
run's result — reuse that polling pattern) rather than assuming the dispatch call itself blocks and
returns synchronously. Assert: the run completes (result available) within a reasonable bound (relate
it to the grace period, e.g. well under 60s), `status` is `failure`, `timed_out` is `true`,
`timeout_enforced` is `true`, error mentions wall timeout, `timeout_seconds` is present and correct in
the result, and the stub's pidfile shows it is no longer alive. This case must fail (RED) against the
r3 head (record `# RED at 88d76b8271872a7125ba6a7ea6d9a12c3cf95a93:` plus the failing output as a
comment) before your fix, and pass (green) after.

Keep the five existing `assert_r1_*` cases and the setsid-forced case from r3 passing unmodified,
unless the detached-path discovery requires a small compatible adjustment (adapt, never delete).

## Verify

Same list as before, run solo/foreground with
`env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID ... < /dev/null`:
`test -x hooks/tests/dispatch-hetero-wall-timeout.test.sh`;
`bash hooks/tests/dispatch-hetero-wall-timeout.test.sh`;
`bash hooks/tests/dispatch-hetero.test.sh`;
`bash hooks/tests/dispatch-hetero-contract.test.sh`;
`bash hooks/tests/dispatch-hetero-cursor-routing.test.sh`;
`bash hooks/tests/dispatch-hetero-gc.test.sh`;
`bash hooks/tests/dispatch-status.test.sh`;
`bash hooks/tests/dispatch-detach.test.sh` (new addition — this row's fix touches the detach state
serialization list this suite also exercises);
`node scripts/check-js-syntax.js`;
`bash scripts/sync-codex-plugin-skills.sh --check`.
List the exact rc of each in your commit message.

## Allowed files

Only `scripts/dispatch-hetero.sh`, `hooks/tests/dispatch-hetero-wall-timeout.test.sh`, and
`platforms/codex/plugin/` mirrors via `bash scripts/sync-codex-plugin-skills.sh`. Touch nothing else.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
