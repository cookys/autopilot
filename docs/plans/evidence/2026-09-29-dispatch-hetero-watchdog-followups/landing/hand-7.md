# Repair hand 2 — SCOPE_UNIT alive-check still fails closed when the fallback pgid is empty

Base is the previous repair head. The second combined review found that the previous repair is incomplete, and depth-0 re-derived it from the code.

## Product
In scripts/dispatch-hetero.sh, `_watchdog_worker_alive` in the SCOPE_UNIT branch probes the main worker pid state with ps. When that state is empty (ps unusable, so the state is UNKNOWN) it falls through to `_watchdog_pgid_has_live` with `WORKER_FALLBACK_PGID`. If `WORKER_FALLBACK_PGID` is also empty, `_watchdog_pgid_has_live` returns 1 at its empty-target guard, so the worker is declared dead, the watchdog exits without calling the systemctl scope kill, the run has no wall bound and still reports timeout_enforced true.

Required behaviour: in the SCOPE_UNIT branch, when the worker state is empty AND there is no fallback pgid to check, return alive (0) — unknown counts as alive so the watchdog fires the scope kill. When a fallback pgid IS set, keep the existing fall-through to the group check. Do not change the empty-target guard inside `_watchdog_pgid_has_live` itself (other callers rely on it). Edit in place; do not add helper functions (the detached path serializes a fixed list of helper names). Mirror to platforms/codex/plugin/scripts/dispatch-hetero.sh via `bash scripts/sync-codex-plugin-skills.sh`.

## Tests (RED-first)
Append to hooks/tests/dispatch-hetero-watchdog-followups.test.sh a case `assert_r7_scope_unknown_state_no_fallback_fires`: eval the real helpers out of scripts/dispatch-hetero.sh the way the existing r6 case does, set SCOPE_UNIT non-empty, WORKER_RP to some pid, leave WORKER_FALLBACK_PGID unset, shadow ps with a stub that prints nothing and exits 1, and assert `_watchdog_worker_alive` returns 0. Also assert the counter-case still holds: SCOPE_UNIT set, WORKER_FALLBACK_PGID set to a pgid whose only members are zombies, real ps, expected return 1. Before fixing, run the new case against the unmodified base and record the red output as a `# RED at <sha>:` comment. Write asserts as (actual, expected) to match lib.sh. Do not use pkill or pgrep with broad patterns.

## Verify
`test -x` on the suite; run hooks/tests/dispatch-hetero-watchdog-followups.test.sh, dispatch-hetero-wall-timeout.test.sh, dispatch-hetero-gc.test.sh, dispatch-hetero-contract.test.sh and dispatch-hetero.test.sh one at a time in the foreground; then `node scripts/check-js-syntax.js` and `bash scripts/sync-codex-plugin-skills.sh --check`. Keep the whole run well under 30 minutes.

## Allowed files
scripts/dispatch-hetero.sh, platforms/codex/plugin/scripts/dispatch-hetero.sh, hooks/tests/dispatch-hetero-watchdog-followups.test.sh.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
