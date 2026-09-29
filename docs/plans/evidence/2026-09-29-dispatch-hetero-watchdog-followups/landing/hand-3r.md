Engine: cursor-grok-4.6-low

# Hand 3 repair (R3-r2) — the liveness check broke real timeouts; sync the mirror

You are working in the git clone you were launched in, on top of the previous commit (an unfinished attempt at R3, see docs/backlog/dispatch-hetero-watchdog-followups.md item 3 and the previous commit's diff of scripts/dispatch-hetero.sh: helper _watchdog_worker_alive, and the watchdog subshell in _arm_worker_watchdog now creates the fired marker only when the worker is alive and the TERM was delivered). The attempt is incomplete and currently broken. Hygiene: never run pkill or pgrep -f matching hetero-wall-watchdog while a dispatch is under test; clean up by pid only.

## Facts observed on the unfinished commit (re-derive them yourself first)
- hooks/tests/dispatch-hetero-wall-timeout.test.sh fails 6 assertions: in assert_r1_grok_enforced_timeout_kills and assert_r1_second_rail_enforced the run reports a non-timeout result (the worker is killed but timed_out is not true and the error does not mention the wall timeout). So the fired marker is no longer created on real runs.
- Likely cause: _watchdog_worker_alive selects group members with ps using the dash-g selector. That selector in procps matches session leaders or group NAMES, not process group ids, so it finds nothing (or the wrong set) and the worker is judged not alive. Replace it with a listing of all processes with their pgid and state columns (ps -e -o pgid=,state=) filtered in shell or awk by an exact pgid match, and treat the worker as alive iff at least one matching process has a state not starting with Z. Verify the selection against a real setsid --wait worker and a job-control worker, not only against the isolated test.
- The new zombie case and the natural-exit real-path cases were written; keep them if sound.
- The codex mirror is out of sync: run bash scripts/sync-codex-plugin-skills.sh.
- Also in the new suite, assert_r1_nosetsid_with_jobcontrol_still_enforces now prints SKIP because timeout_enforced came back empty; find out whether this is caused by the broken liveness check (likely) and make sure it runs and passes for real on this host once fixed, or explain in a comment exactly why it cannot.

## Product
Fix the helper as described so a live worker (setsid --wait path, direct setsid path, cgroup path via the direct background pid, job-control path) is judged alive, and a zombie-only group or a missing pid is judged not alive. Keep everything else from the previous commit. Guard every command for set -e and pipefail. No bare-pid kill.

## Tests
Make sure the isolated zombie case is discriminating: it must fail if the helper always says alive. Add one more isolated case assert_r3_alive_helper_matches_exact_pgid: start a live worker in its own group, and a second unrelated process in another group; assert that the helper reports alive for the first group id and not alive for a group id that has only a zombie or nothing.

## Verify
Foreground, one at a time, with the prefix env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID and stdin from /dev/null: the new suite hooks/tests/dispatch-hetero-watchdog-followups.test.sh (no SKIP lines allowed except the documented cgroup host-support skips), hooks/tests/dispatch-hetero-wall-timeout.test.sh (must be fully green), hooks/tests/dispatch-hetero-gc.test.sh, hooks/tests/dispatch-hetero-contract.test.sh, hooks/tests/dispatch-hetero.test.sh, hooks/tests/dispatch-hetero-cursor-routing.test.sh; node scripts/check-js-syntax.js; bash scripts/sync-codex-plugin-skills.sh then bash scripts/sync-codex-plugin-skills.sh --check.

## Allowed files
scripts/dispatch-hetero.sh, platforms/codex/plugin/scripts/dispatch-hetero.sh (via sync), hooks/tests/dispatch-hetero-watchdog-followups.test.sh.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
