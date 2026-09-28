# dispatch-hetero wall-timeout watchdog — review 🔵 follow-ups

v2.36.101 landed a central `run_worker` watchdog on `dispatch-hetero.sh` (agy/grok/cursor/all
rails), closing the gap tracked by the now-superseded
`dispatch-hetero-grok-timeout-not-applied.md` row: `--timeout` was accepted and recorded on
every rail but only actually enforced on the agy rail.

Across the two review rounds that reached SHIP-AS-IS (round 5 on hand-1-r5, and the r6 combined
review after a 🟠 MUST-FIX — `wdog-stale-pid-fallback`, a bare-pid kill fallback that could only
ever hit a stale/recycled pid — was fixed in r6), the reviewer (`claude-fable-5-1`, effort high)
left the following non-blocking findings. None gates the release; each is a real, narrow edge
case with no concrete in-scope failure today.

## From round 5 (hand-1-r5, pre-r6)

1. **no-setsid / no-job-control degrade** (`wdog-set-m-silent-unenforced`): on the no-setsid
   fallback (plain and detached-child), if `set -m` fails the worker lands in the dispatcher's
   pgid; `_watchdog_signal_worker`'s selfpg guard correctly refuses to signal it, but the run
   still reports `timeout_enforced: true` while nothing is actually bounded. Consider a
   `WATCHDOG_DISARMED` flag on that branch and emitting `timeout_enforced: false` instead.
   Excluded: requires a host with neither setsid nor working job control.
2. **cgroup-kill has no fallback** (`wdog-cgroup-no-fallback`): the cgroup containment path
   relies solely on `systemctl --user kill "$SCOPE_UNIT" || true`; a transient systemctl failure
   leaves the worker unbounded with no pgid fallback. Excluded: the spec mandates the systemctl
   scope kill for this path and the unit exists synchronously before the earliest deadline.
3. **deadline-coincidence mislabel** (`wdog-deadline-coincident-mislabel`): if the worker exits
   naturally in the same instant the sleeper fires, `.fired` is created before `wait "$rp"`
   returns and the run is stamped `timed_out: true` despite a natural exit. Excluded:
   sub-millisecond coincidence, no process is harmed.
4. **manifest duplicate keys** (`manifest-timeout-dup-keys`): the base printf now always emits
   `timeout_seconds`/`timeout_source`; if `strict_manifest_fields` still separately carries the
   pre-existing keys for contract runs, strict-contract manifests would contain duplicate keys
   (last-wins, identical values). Excluded: not confirmable from the diff alone; drop the
   strict-side duplicates in a follow-up if actually present.
5. **contract-comment default value** (`output-comment-default-in-result`): the OUTPUT contract
   comment lists `"default"` as a possible result-JSON `timeout_source` value, but `emit()` only
   writes `timeout_source` when `TIMEOUT_SOURCE` is non-empty, so `default` only ever appears in
   the manifest, never the result. Documentation nit.

## From the r6 combined review

6. **sleeper-pid recycling** (`wdog-sleeppid-recycle`, 🟡): in `_cancel_worker_watchdog` the bare
   `kill "$sp"` on the sleeppid can run after the watchdog subshell has already reaped that sleep
   (timer expired inside the 10s grace window while the worker exited normally); under pid
   wraparound it could in principle signal an unrelated pid. The tag-scoped
   `pkill -f hetero-wall-watchdog-<tag>` already covers the sleeper regardless, so drop the bare
   kill or check `/proc/$sp/cmdline` for the tag first. Excluded now: needs a full pid wrap
   inside a sub-second window.
7. **TIMEOUT_SOURCE ordering vs campaign preflight** (`caller-source-ordering`): `TIMEOUT_SOURCE=
   "caller"` is assigned between `run_strict_contract_preflight` and
   `run_campaign_projection_preflight`; if the campaign preflight only fills `TIMEOUT_SOURCE`
   when empty, a campaign wall plus `--timeout` would be recorded as `caller` instead of
   `caller_within_wall` (enforcement itself is unaffected — label only).
8. **detached path skips reap_container on its own session** (`detached-new-session-reap`): the
   detached-child path now places the worker in its own session (`setsid env … &`) and still
   returns before `reap_container`; sid/pgid-keyed GC or cancel logic aimed at that session no
   longer reaches escaped worker descendants on that path. Excluded: not required by the current
   spec and `dispatch-hetero-gc.test.sh` is on the Verify list.
9. **`set -m` job-control notices** (`set-m-job-notices`): the no-setsid fallback enables
   `set -m` globally in a non-interactive shell, which prints job-status notices to stderr for
   the rest of the run. Excluded: only reachable on hosts without setsid.
10. **contract-comment default value (result vs manifest), r6 restatement**
    (`contract-comment-default`): same doc mismatch as item 5, re-surfaced independently by the
    r6 review pass.

## Fix

Address opportunistically alongside the next dispatch-hetero containment change; none is worth a
standalone dispatch on its own. Items 5 and 10 are the same one-line doc fix and can be done
together.
