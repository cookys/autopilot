# Repair hand 3 — rewrite the watchdog alive-check as one fail-open rule

Base is the previous repair head. Three combined-review rounds each found one more shape of the same defect: the pre-fire alive-check in the watchdog declares the worker dead whenever it cannot PROVE liveness, so the watchdog exits without firing and the run has no wall bound while still reporting timeout_enforced true. Patching one shape per round has not converged. The operator decided to replace the branching with one rule.

## Product
In scripts/dispatch-hetero.sh rewrite `_watchdog_worker_alive` (and, only if needed, `_watchdog_pgid_has_live`) around ONE rule: the worker is reported dead ONLY when it is positively proven dead; every other situation — ps missing, ps failing, ps printing nothing, empty WORKER_RP, empty WORKER_FALLBACK_PGID, empty WORKER_SID — reports alive so the watchdog goes on to fire. A false fire is harmless: the signal path already un-stamps the fired marker and exits when nothing could be signalled.

Positive proof of death means all of the following hold at once: the process table read (`ps -e` with pid, pgid and state columns, read once into a variable) succeeded and is non-empty; the worker's identifying pid, when one is known (WORKER_RP), is either absent from the table or a zombie; and no non-zombie process carries the kill-target group id (the session id on the setsid path, the fallback pgid otherwise; when no target group id is known, that condition is simply not evaluated, it does not by itself prove death). For the SCOPE_UNIT path, additionally nothing else is needed: the systemctl scope kill does not depend on a pgid. If neither a worker pid nor any group id is known, that is unknown, hence alive.
Keep the function names. Do not add new helper functions: the detached path serializes a fixed list of helper names with declare -f, and a new name would be silently missing there. Local variables inside the existing functions are fine. Keep the previous repair's tr-free parsing. Mirror to platforms/codex/plugin/scripts/dispatch-hetero.sh via `bash scripts/sync-codex-plugin-skills.sh`.

## Tests (RED-first)
In hooks/tests/dispatch-hetero-watchdog-followups.test.sh add ONE table-driven case `assert_r8_alive_check_matrix` that evals the real helpers out of scripts/dispatch-hetero.sh, and covers this matrix with real or stubbed ps as noted:
- ps unusable (stub prints nothing and exits 1): plain path with sid set, plain path with only fallback pgid, plain path with neither, SCOPE_UNIT with rp only, SCOPE_UNIT with fallback only, SCOPE_UNIT with both, SCOPE_UNIT with neither — every one expects alive (0).
- ps usable (real ps): a live process in the target group expects 0; a group whose only members are zombies expects 1 (use the zombie construction the existing r3/r6 cases use); a worker pid that no longer exists together with an empty group expects 1.
Before fixing, run the new case against the unmodified base and record the red output as a `# RED at <sha>:` comment. Keep the older r3/r6/r7 cases as they are (they must still pass). Write asserts as (actual, expected) to match lib.sh. No pkill or pgrep with broad patterns.

## Verify
`test -x` on the suite; run hooks/tests/dispatch-hetero-watchdog-followups.test.sh, dispatch-hetero-wall-timeout.test.sh, dispatch-hetero-gc.test.sh, dispatch-hetero-contract.test.sh and dispatch-hetero.test.sh one at a time in the foreground; then `node scripts/check-js-syntax.js` and `bash scripts/sync-codex-plugin-skills.sh --check`. Keep the whole run under 30 minutes.

## Allowed files
scripts/dispatch-hetero.sh, platforms/codex/plugin/scripts/dispatch-hetero.sh, hooks/tests/dispatch-hetero-watchdog-followups.test.sh.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
