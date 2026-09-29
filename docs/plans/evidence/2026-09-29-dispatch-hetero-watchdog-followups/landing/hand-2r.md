Engine: cursor-grok-4.6-low

# Hand 2 repair (R2-r2) — keep the cgroup worker's stdin on /dev/null

You are working in the git clone you were launched in, on top of the previous commit. A review found one real defect in scripts/dispatch-hetero.sh, run_worker, cgroup branch: the previous commit enables job control (set -m) before launching the systemd-run scope worker in the background so it gets its own process group. With job control on, bash no longer redirects a background command's stdin from /dev/null, so the worker now inherits the dispatcher's stdin (a tty or harness pipe): a worker that reads stdin can consume dispatcher input, or take SIGTTIN and stay stopped until the wall timeout. The old behavior was always /dev/null.

## Product
Add an explicit stdin redirect from /dev/null to the systemd-run launch line in the cgroup branch of run_worker, so the pgid isolation is kept without changing stdin semantics. Check the other branches that were given set -m in this or the previous row (the no-setsid fallbacks) and add the same explicit stdin redirect to their background worker launch lines. Change nothing else. Keep set -e and pipefail safety.

## Tests (RED-first)
Append to hooks/tests/dispatch-hetero-watchdog-followups.test.sh a case assert_r2_cgroup_worker_stdin_is_devnull, registered in the main call list: run the REAL scripts/dispatch-hetero.sh inline (cgroup path if the host supports it, else print a skip reason inside the case and still exercise the plain path) with a stub worker that records the target of its file descriptor 0 (readlink of /proc/self/fd/0) into a file and exits immediately; run the dispatch with its own stdin coming from a pipe (for example the output of a sleep-free printf) so it differs from /dev/null; assert the recorded target is /dev/null. Before fixing, run it on the unmodified code and record the red output as a comment: a line reading RED at b9fbc8fc followed by the failing lines.

## Verify
Foreground, one at a time, with the prefix env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID and stdin from /dev/null: the new suite hooks/tests/dispatch-hetero-watchdog-followups.test.sh, hooks/tests/dispatch-hetero-wall-timeout.test.sh, hooks/tests/dispatch-hetero-gc.test.sh, hooks/tests/dispatch-hetero-contract.test.sh; node scripts/check-js-syntax.js; run bash scripts/sync-codex-plugin-skills.sh to sync the codex mirror, then bash scripts/sync-codex-plugin-skills.sh --check. Never use pkill or pgrep -f matching hetero-wall-watchdog.

## Allowed files
scripts/dispatch-hetero.sh, platforms/codex/plugin/scripts/dispatch-hetero.sh (via sync), hooks/tests/dispatch-hetero-watchdog-followups.test.sh.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
