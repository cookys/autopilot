Engine: cursor-grok-4.6-low

# Hand 3 (R3) — deadline coincidence must not stamp a naturally exited worker as timed out

You are working in the git clone you were launched in. Read scripts/dispatch-hetero.sh functions _arm_worker_watchdog, _watchdog_signal_worker, _wait_worker_with_watchdog and run_worker. Background: docs/backlog/dispatch-hetero-watchdog-followups.md item 3. The suite hooks/tests/dispatch-hetero-watchdog-followups.test.sh exists; append to it. Hygiene: never run pkill or pgrep -f matching hetero-wall-watchdog while a dispatch is under test; clean leftovers by pid only.

## Product
Today the watchdog subshell creates the file named token-plus-dot-fired first and only then calls the signal helper. If the worker exited naturally in that same instant, the fired marker still exists when the dispatcher's wait returns, and the run is stamped timed_out true although nothing was killed. Change the order and the meaning: the fired marker must be created only after the watchdog has confirmed the worker was still alive and has actually delivered the TERM signal to it.

Implement a small helper (for example _watchdog_worker_alive) that reports alive when at least one process in the worker's target is not a zombie. For the process-group targets (WORKER_SID or WORKER_FALLBACK_PGID) list the group members with ps (state column, selected by process group) and treat the worker as alive only if some member's state does not start with Z. For the cgroup target use the scope's process: check the state of the direct background pid of the launch (store it in a global WORKER_RP set by _wait_worker_with_watchdog before arming, so the watchdog subshell inherits it) and treat a zombie or missing pid as not alive. Remember that the dispatcher has not yet reaped a naturally exited child, so a bare existence check (kill -0 or a group kill that succeeds on a zombie) is NOT enough: the zombie state must be examined.

Then in the watchdog subshell: after the sleeper returns and the token check, if the worker is not alive exit quietly without creating the fired marker; otherwise send TERM through _watchdog_signal_worker and create the fired marker only if that signal path reported delivery (make _watchdog_signal_worker return zero only when a signal was actually sent: systemctl success, or a successful group kill, or the guarded fallback kill succeeded; non-zero when it refused or the kill failed). The later KILL escalation keeps its current behavior. If the dispatcher's wait returns for a worker that was signalled, the run is timed out exactly as before. Never add a bare-pid kill. The code must keep working when the caller has set -e and pipefail: guard every command that can fail (the function returning non-zero must not abort the watchdog subshell when called in a guarded way).

## Tests (RED-first)
Append cases, registered in the main call list:
- assert_r3_zombie_worker_not_stamped_timed_out: isolate the watchdog by sourcing/extracting the helper functions the way the existing bare-pid-fallback case in this suite does. Start a background process that exits immediately and is deliberately NOT waited for (leave it a zombie), put it in its own process group (use setsid or job control in the test), set WORKER_SID and WORKER_RP to it, arm the watchdog with a 1 second deadline, wait about 3 seconds, and assert that the fired marker file does not exist. Also the contrast: with a live sleeping worker in its own group the fired marker appears and the worker receives TERM.
- assert_r3_natural_exit_before_deadline_not_timed_out_real_path: the REAL dispatcher, inline and again through the real detached path (ledger, run-id, stage together, poll the durable result file): stub worker exits quickly with success, timeout of 30s; assert timed_out false, and no leftover watchdog sleeper for the run tag (check by pid file / process listing by tag, do not use pkill).
- keep the existing timed-out real-path cases green (they live in the wall-timeout suite).
Before fixing run the zombie case against the unmodified code and record the red output as a comment: a line reading RED at 39264663 followed by the failing lines.

If, after examining the code, you conclude this cannot be made correct without a redesign, do not commit code: write nothing and end with a final message beginning SKIP-R3 and the evidence.

## Verify
Foreground, one at a time, with the prefix env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID and stdin from /dev/null: test -x on the new suite and run it; hooks/tests/dispatch-hetero-wall-timeout.test.sh, hooks/tests/dispatch-hetero-gc.test.sh, hooks/tests/dispatch-hetero-contract.test.sh, hooks/tests/dispatch-hetero.test.sh, hooks/tests/dispatch-hetero-cursor-routing.test.sh, plus any suite grep -l finds for run_worker, hetero-wall-watchdog, timeout_enforced, _watchdog_signal_worker; node scripts/check-js-syntax.js; run bash scripts/sync-codex-plugin-skills.sh, then bash scripts/sync-codex-plugin-skills.sh --check. Add the new helper function name to the declare -f export list in dispatch_detached_run.

## Allowed files
scripts/dispatch-hetero.sh, platforms/codex/plugin/scripts/dispatch-hetero.sh (via sync), hooks/tests/dispatch-hetero-watchdog-followups.test.sh.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
