# dispatch-hetero.sh — wall-clock watchdog for run_worker (row P1)

## Product

Fix `run_worker()` in `scripts/dispatch-hetero.sh` so that a caller-supplied or contract-supplied
wall-clock timeout is actually enforced against the worker, on every containment path, instead of
being a claim recorded in the manifest that nothing acts on. Today `run_worker()` starts the worker
and waits with no deadline at all on the detached-child, cgroup (`systemd-run --user --scope`),
setsid, and plain containment paths. Only the agy rail gets a real bound, via agy's own
`--print-timeout` flag; grok, cursor, codex, cc-shim/claude, kimi, opencode, pi, and qoderclicn all
run unbounded no matter what `--timeout` or a Mission contract's `budget.wall_seconds` says. The
manifest still writes out a `timeout_seconds` field even though it was never applied, which is a
claim rather than a fact. Implement the following five points exactly.

First, the bound must be enforced if and only if it was made explicit: either the caller passed
`--timeout` on the command line, or a Mission contract's `budget.wall_seconds` set the wall through
the existing `TIMEOUT_SOURCE` mechanism (values `contract_wall` or `caller_within_wall`). In either
case `TIMEOUT_SOURCE` is non-empty and the bound is enforced. The bare default of nine minutes, when
nothing was supplied and there is no contract, must NOT be enforced, because existing long runs that
currently rely on the unbounded default need to keep completing exactly as they do today. Do not
change the value of the default `TIMEOUT`; only change whether a deadline actually acts on it.

Second, add exactly one central watchdog mechanism inside `run_worker()` that covers every rail and
every containment path uniformly, rather than adding per-runner CLI flags or special-casing rails.
Leave agy's own `--print-timeout` behavior completely alone, as a second independent belt-and-braces
layer; do not remove it or change how it is passed. When the new watchdog's deadline is reached: for
the cgroup containment path, terminate the whole scope unit via `systemctl --user kill` (or the
equivalent already used elsewhere in this script to stop a scope) rather than trying to signal the
worker's pid directly; for the setsid containment path, signal the worker's own process group or
session, not the dispatcher's; for the plain and detached-child paths, the worker must be run in the
background under its own process group so it is killable, and the watchdog kills that worker's group
— the watchdog must never signal the dispatcher's own process, its own process group, or its own
shell session under any path. First send SIGTERM to the worker's tree, wait a fixed 10 second grace
period, then send SIGKILL if it is still alive. The watchdog timer itself (the backgrounded sleeper
that fires the kill) must be cancelled and reaped on every normal exit path of `run_worker()` — no
stray `sleep` process may be left running after a normal completion, and the watchdog must never end
up killing an unrelated pid that the OS recycled after the worker already exited. `reap_container`
must still run afterwards exactly as it does today, unaffected by whichever path the watchdog took.

Third, the result JSON's main result object gets two new boolean fields: `timed_out` and
`timeout_enforced`. When the watchdog actually terminated the worker, `timed_out` is `true`; when the
run completed on its own (whether under an enforced bound it didn't hit, or the unenforced default,
or no timeout at all), `timed_out` is `false`. `timeout_enforced` reflects point one: `true` when the
bound from `--timeout` or a contract was actually being watched, `false` for the bare unenforced
default. A run that timed out keeps the EXISTING `status` value `failure` — do not invent a new status
value, because consumers switch on the existing set of status strings. Its `error` field must read
`wall timeout (<N>s) exceeded — worker terminated`, with `<N>` the actual timeout value in seconds
that was enforced. The `commit` and diff-related fields in the result must still report whatever the
worker's branch actually holds at the moment it was killed (i.e. do not suppress or fabricate those
fields just because the run timed out). Find and update the OUTPUT contract comment near the top of
the script that documents the result JSON's fields, adding `timed_out` and `timeout_enforced` there.

Fourth, the manifest gains a `timeout_enforced` boolean field alongside the existing
`timeout_seconds` and `timeout_source` fields. For the unenforced bare-default case, `timeout_source`
in the manifest must be written as the literal string `default` (rather than left blank or as
whatever internal value it currently holds), so nothing reading the manifest can mistake the default
for an applied bound.

Fifth, keep this portable: only bash and the POSIX tools this script already uses; no new external
dependencies. It must keep working correctly on hosts where `systemd-run` is not available, i.e. the
setsid and plain containment paths must each get their own correct enforcement without depending on
systemd being present.

## Tests (RED-first)

Add a new test suite `hooks/tests/dispatch-hetero-wall-timeout.test.sh`. Make it executable with
`chmod +x` AND confirm with `test -x` — a bare `git update-index --chmod` is not enough, because a
later `git add` reverts a mode-only change back to non-executable. Look at how
`hooks/tests/dispatch-hetero.test.sh` and `hooks/tests/dispatch-hetero-cursor-routing.test.sh` stub a
runner binary via its `*_BIN` environment variable and build a throwaway repo for the dispatch to run
against, and reuse that same stubbing pattern. The stub runner writes its own pid to a file the test
can read, then sleeps for 120 seconds (unless a case below says otherwise).

Write these cases:

- `assert_r1_grok_enforced_timeout_kills` — dispatch on the grok rail with `--timeout 3s` against the
  120-second-sleep stub; the dispatch call must return within 30 wall-clock seconds; the result JSON's
  `status` is `failure`, `timed_out` is `true`, `timeout_enforced` is `true`, `error` mentions wall
  timeout; and the pid the stub wrote to its pidfile is confirmed no longer alive.
- `assert_r1_second_rail_enforced` — the same scenario and same assertions, on one more non-agy rail:
  use whichever of cursor or kimi the existing test suites already stub most easily, and say in a
  comment which one you picked and why.
- `assert_r1_default_not_enforced` — dispatch with no `--timeout` flag at all, against a stub that
  sleeps 5 seconds then exits 0; the run completes normally, `timed_out` is `false`,
  `timeout_enforced` is `false`, and the manifest's `timeout_source` is the literal string `default`.
- `assert_r1_no_stray_watchdog` — after a normal fast run with `--timeout 60s` that completes well
  under the timeout, confirm no watchdog sleeper process started by this run is still present
  afterwards.
- `assert_r1_term_ignoring_worker_killed` — the stub traps SIGTERM and keeps sleeping instead of
  exiting; confirm it is still dead after the grace period, i.e. the SIGKILL path actually fires.

Additionally exercise whichever containment path this test host actually takes when the suite runs
(cgroup via systemd-run may or may not be available), and if the script already has an env or test
seam that lets a test force the setsid or the plain containment path specifically, add one more case
that forces that alternate path and say explicitly in a comment which seam you used. If no such seam
exists, say so explicitly in a comment instead of silently skipping it.

Before making any fix, run the new suite against the unmodified base and record its RED output (the
suite must fail against base, since none of this logic exists yet) — put the literal
`# RED at <sha>:` line plus the failing output as a comment block at the top of the new test file, or
in the commit message, so the RED evidence is visible.

## Verify

Run each of the following solo, in the foreground, one at a time, each prefixed with
`env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID ... < /dev/null` so nothing waits on stdin and
nothing carries a live session id into the suite:

- `test -x hooks/tests/dispatch-hetero-wall-timeout.test.sh` (must print nothing and exit 0)
- `bash hooks/tests/dispatch-hetero-wall-timeout.test.sh` (the new suite, now green)
- `bash hooks/tests/dispatch-hetero.test.sh`
- `bash hooks/tests/dispatch-hetero-contract.test.sh`
- `bash hooks/tests/dispatch-hetero-cursor-routing.test.sh`
- `bash hooks/tests/dispatch-hetero-gc.test.sh`
- every other suite found by
  `grep -rl 'timeout_seconds\|timeout_source\|dispatch-hetero' hooks/tests scripts/*.test.js` that
  parses the result JSON or the manifest — list each one you found and ran, by name, in your commit
  message or hand-report, so the foreman can see the exact list you exercised
- `node scripts/check-js-syntax.js`
- `bash scripts/sync-codex-plugin-skills.sh --check`

## Allowed files

Only: `scripts/dispatch-hetero.sh`, `hooks/tests/dispatch-hetero-wall-timeout.test.sh`, and existing
dispatch-hetero test suites — but ONLY where a pinned manifest/result shape they assert on must be
adapted for the two new fields (adapt them, never delete assertions), `docs/scripts-inventory.md`'s
row for dispatch-hetero — only if that row currently states timeout semantics that this change makes
stale, and whatever `platforms/codex/plugin/` mirror files `bash scripts/sync-codex-plugin-skills.sh`
produces/updates. Touch nothing else.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.

## Reviewer scrutiny (added by foreman for review pass)

Please scrutinize the diff specifically for:

1. Can the watchdog ever signal the dispatcher's own process/process-group/session, or an
   unrelated pid that the OS recycled after the worker already exited, under ANY of the four
   containment paths (cgroup, setsid non-detached, setsid-in-detached-child, plain/detached
   fallback without setsid)?
2. Is the watchdog timer (the backgrounded sleeper) reliably cancelled and reaped on every
   normal exit path of run_worker, leaving no stray sleeper process behind, including when the
   worker finishes right as the deadline fires (race)?
3. Is the "enforced iff explicit" rule actually correct? Note: the diff adds
   `if [ "$TIMEOUT_SUPPLIED" -eq 1 ] && [ -z "${TIMEOUT_SOURCE:-}" ]; then TIMEOUT_SOURCE="caller_within_wall"; fi`
   before the enforcement predicate, which means a plain caller-supplied `--timeout` with NO
   Mission contract at all now also produces `TIMEOUT_SOURCE=caller_within_wall`, and the
   manifest's `timeout_source` field for that case is now `caller_within_wall` rather than some
   caller-only value. Is this a semantic overload of `caller_within_wall` (previously meaning
   "caller's value accepted within a contract's wall budget") that could mislead a manifest
   consumer into believing a contract was in play when there was none? Flag as 🟠 if so, and say
   what the fix should look like (e.g. a distinct source value for plain caller-supplied, or an
   explicit boolean instead of overloading the enum).
4. Does every containment path (cgroup / setsid / setsid-in-detached-child / plain fallback)
   actually get bounded by the watchdog, with correct process-group isolation established BEFORE
   the wait, not after?
5. Is the bare default (`TIMEOUT=9m`, nothing supplied, no contract) truly left unenforced,
   confirmed by code and not just by comment?

## Re-review after r2 + r3 repair passes (full range 1f81de14..hands/wdog/1-r3)

Two repair passes landed on top of the original hand. Please confirm ALL of the following are
now actually fixed in the full diff, not just claimed:

1. `timeout_source` for a plain no-contract `--timeout` is now the distinct value `caller` (not
   `caller_within_wall`), so a manifest/result consumer can no longer mistake it for a
   contract-in-play case.
2. The timed-out path in `_wait_worker_with_watchdog` removes the watchdog token immediately after
   `wait "$rp"` returns, before waiting on `WATCHDOG_PID`, so the grace loop short-circuits instead
   of always sleeping the full 10s and then signaling a pgid whose members already exited.
3. A fast-completing worker (no timeout hit) never leaves a stray `hetero-wall-watchdog-*` sleeper
   behind, including via the TERM trap inside the watchdog subshell and the `pkill -f` sweep in
   `_cancel_worker_watchdog`.
4. The `setsid --wait` non-detached containment path's `WORKER_SID` capture (now
   `_setsid_wait_worker_sid`) reliably finds the real worker child even under a scheduling race,
   with a bounded poll (not an unbounded hang) and a sane fallback, so the watchdog's kill actually
   reaches the worker tree on this path and not just the `setsid --wait` supervisor.

Also re-confirm the base findings from the first review pass still hold (no dispatcher/self kill on
any path; no new stray processes; default truly unenforced; every containment path bounded).

## Re-review after r4 (CRITICAL fix) — full range 1f81de14..hands/wdog/1-r4

r4 fixes a 🔴 found in production: a real (non-stub) dispatch with `--ledger`/`--run-id`/`--stage`
(what every real caller passes) takes the DETACHED execution path, which serializes function
definitions into a state file via `declare -f ...` inside `dispatch_detached_run()`. That list was
missing `normalize_timeout_seconds`, so inside the detached child `_wait_worker_with_watchdog` could
never compute `secs` and `_arm_worker_watchdog` was never called — the watchdog silently never armed
on the path every real run takes, while the result JSON still claimed `timeout_enforced: true`. r4
adds `normalize_timeout_seconds` to that `declare -f` list (one line) and adds a new test case that
exercises the detached path specifically (passing `--ledger`/`--run-id`/`--stage` together, polling
the durable result file rather than assuming a synchronous return).

Please confirm:
1. `normalize_timeout_seconds` is now in the `declare -f` list inside `dispatch_detached_run()`.
2. Audit whether ANY OTHER function or variable referenced by `_wait_worker_with_watchdog`,
   `_arm_worker_watchdog`, `_watchdog_signal_worker`, `_cancel_worker_watchdog`,
   `_setsid_wait_worker_sid`, `emit()`, or `write_manifest()` is still missing from the `declare -p`/
   `declare -f` lists in `dispatch_detached_run()` — i.e. is this really the ONLY gap, or are there
   more like it that just haven't been triggered yet?
3. The new `assert_detached_path_enforced_timeout_kills` test case genuinely forces the detached
   path (by supplying `--ledger`/`--run-id`/`--stage` together) and polls the durable result file
   rather than assuming the wrapper call blocks synchronously — confirm this is a faithful
   reproduction of how a real caller invokes this script, not a shortcut that could still miss the
   defect class.
4. All prior re-review items (timeout_source distinct value, token-removed-before-grace-wait,
   no-stray-sleeper, setsid-wait-ppid-race fix) still hold in the full diff.

## Re-review — full range 1f81de14..hands/wdog/1-r5

Please do a final full-range pass on `_setsid_wait_worker_sid` and answer from the diff itself:
1. Does the no-fork case (the polled pid's own sid equals its own pid) get returned directly, without
   searching further for a child?
2. In the fork case, is a candidate child accepted ONLY when that child is itself a session leader
   (its own sid equals its own pid), never an arbitrary child/grandchild that is not a session leader?
3. Does the new busy-loop / TERM-ignoring test case actually exercise a worker with no natural
   short-lived children, such that a grandchild-only kill could not accidentally pass?
4. Do all prior re-review items (timeout_source distinct value, token-removed-before-grace-wait,
   no-stray-sleeper, detached-path `normalize_timeout_seconds` export) still hold across the complete
   diff?
5. Is there any remaining containment path or scenario where the watchdog could still fail to bind to
   the real worker's process group/session?

## Re-review — full range 1f81de14..hands/wdog/1-r6

Please review `_watchdog_signal_worker` for the bare-pid fallback removal:
1. Is the group-kill-only version still consistent with the self-kill guards ($$ and self-pgid
   checks) immediately above it?
2. Does the new isolation test genuinely demonstrate the hazard class (a live, non-leader pid that
   shares the caller's process group) without relying on any dispatch-hetero main-path execution?
3. Any remaining path where a dead/recycled pid could still be signaled?
4. Do all prior re-review items across r2 through r5 still hold in the complete diff?
