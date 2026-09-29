Engine: cursor-grok-4.6-low

# Hand 2 (R2) — watchdog kill paths in scripts/dispatch-hetero.sh

You are working in the git clone you were launched in. Read scripts/dispatch-hetero.sh functions _watchdog_signal_worker, _cancel_worker_watchdog, _arm_worker_watchdog, run_worker (cgroup branch). Background: docs/backlog/dispatch-hetero-watchdog-followups.md items 2 and 6. The suite hooks/tests/dispatch-hetero-watchdog-followups.test.sh already exists from the previous row; append to it. IMPORTANT hygiene: never run pkill or pgrep -f with a pattern that can match the watchdog sleeper (the string hetero-wall-watchdog) while a dispatch is running under test; a previous hand killed its own watchdog that way. Clean up test leftovers by pid only.

## Product
Item 2 (cgroup path). In _watchdog_signal_worker the cgroup branch runs systemctl --user kill for the scope unit and ignores failure, returning immediately, so a transient systemctl failure leaves the worker unbounded. Fix: capture the systemctl exit status; when it fails, fall back to a process-group scoped kill of the worker: the cgroup branch currently has no WORKER_SID, so in run_worker's cgroup branch (systemd-run --scope launches the worker as a child of systemd-run) determine the worker's process group after launch in a guarded way (the pgid of the background pid, only if it differs from the dispatcher's own pgid and from the dispatcher pid) and store it in a variable such as WORKER_FALLBACK_PGID. On systemctl failure, signal with a negative-pgid kill of that group only if the guards hold. Never signal a bare pid, never signal the dispatcher's own group. If no safe pgid is known the failure is simply left as it is (return 0).

Item 6 (sleeper pid recycling). In _cancel_worker_watchdog there are two places doing a bare kill of the sleeper pid read from the sleeppid file. Make each of them verify first that the process command line (read from the proc filesystem cmdline file for that pid, NUL bytes translated to spaces) contains the watchdog tag hetero-wall-watchdog-plus-tag, and skip the kill (and the wait) when it does not or when the file is unreadable. Keep the tag-scoped pkill at the end as it is. Also keep working under set -e and pipefail in the caller: guard every command that can return non-zero.

To make the cgroup path testable add one test-only seam: environment variable HETERO_TEST_SYSTEMCTL_KILL_FAIL=1 that makes the systemctl kill call in _watchdog_signal_worker behave as if it failed (skip invoking it and take the failure branch). Comment it as test-only.

## Tests (RED-first)
Append to hooks/tests/dispatch-hetero-watchdog-followups.test.sh case functions and register them in its main call list:
- assert_r2_cgroup_kill_failure_falls_back_to_pgid: only when this host has a working systemd-run --user --scope (the wall-timeout suite shows how it detects/forces the cgroup path; skip inside the case with a printed reason if the host has none). Run the REAL scripts/dispatch-hetero.sh inline with a stub worker that sleeps 120, --timeout 3s, HETERO_TEST_SYSTEMCTL_KILL_FAIL=1; assert timed_out true and the stub pid is dead within 30s.
- assert_r2_cgroup_kill_failure_detached_real_path: the same through the real detached path (ledger, run-id and stage together, poll the durable result file like the existing detached case).
- assert_r6_cancel_skips_kill_when_cmdline_lacks_tag: isolate _cancel_worker_watchdog like the existing bare-pid-fallback case does (extract the function with declare -f or source approach used there), write a sleeppid file pointing at an unrelated live helper process (a plain sleep started by the test), set a token file, call the function, and assert the unrelated helper is still alive. Also a positive case: a process whose cmdline carries the tag is killed.
Before fixing run the new cases against the unmodified base and record the red output as a comment: a line reading RED at 51def4fb followed by the failing lines.

## Verify
Foreground, one at a time, each with the prefix env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID and stdin from /dev/null:
- test -x on the new suite, then the new suite;
- hooks/tests/dispatch-hetero-wall-timeout.test.sh, hooks/tests/dispatch-hetero.test.sh, hooks/tests/dispatch-hetero-contract.test.sh, hooks/tests/dispatch-hetero-cursor-routing.test.sh, hooks/tests/dispatch-hetero-gc.test.sh, plus any suite grep -l finds for run_worker, hetero-wall-watchdog, timeout_enforced, _cancel_worker_watchdog, _watchdog_signal_worker;
- node scripts/check-js-syntax.js;
- bash scripts/sync-codex-plugin-skills.sh --check (run the sync script without --check first if a codex mirror of dispatch-hetero.sh exists, then re-check).

## Allowed files
scripts/dispatch-hetero.sh, hooks/tests/dispatch-hetero-watchdog-followups.test.sh, and platforms/codex/plugin/ mirrors of dispatch-hetero.sh produced by the sync script.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
