# dispatch-hetero.sh wall-clock watchdog — repair pass (r5)

Review of the full range through r4 raised one remaining 🟠 MUST-FIX. Fix ONLY this in
`scripts/dispatch-hetero.sh` (`_setsid_wait_worker_sid`); do not touch anything already fixed in
r2/r3/r4.

## Finding — `_setsid_wait_worker_sid` can return the wrong pid on a no-fork host

On the `setsid --wait` (HAVE_SETSID=1, non-detached) containment path:

```
setsid --wait env "${HANDS_GIT_ENV[@]+"${HANDS_GIT_ENV[@]}"}" "$@" >"$LOG" 2>&1 &
rp=$!
WORKER_SID="$(_setsid_wait_worker_sid "$rp")"
```

util-linux `setsid` only actually forks when the calling process is already a process-group leader;
a `cmd &` background job of a non-job-control bash is NOT a leader, so on that (common) host
`setsid --wait env ...` execs in place and `$rp` itself IS the worker (its session id and process
group id both equal `$rp`). `_setsid_wait_worker_sid` currently always polls for "a child of `$rp`"
and returns the first one it finds — on a no-fork host, that "child" is actually a GRANDCHILD of the
real worker (something the worker itself spawned, e.g. a helper process, a `git` call, its own
`sleep`), not the worker's own session/group. Signaling that grandchild's (nonexistent) process
group fails, and the fallback signals only that one grandchild pid — never the worker's actual
process tree. Net effect: on a no-fork host, the watchdog can kill the wrong thing (or nothing),
`wait "$rp"` blocks unbounded, and the run still reports `timeout_enforced: true` while nothing was
actually bounded.

Fix `_setsid_wait_worker_sid` to discriminate the two cases instead of assuming a fork always
happened:
- Poll (same bounded ~20×50ms budget) for `ps -o sid= -p "$rp"` (trimmed) equal to `"$rp"` itself —
  if so, `setsid` did NOT fork, `$rp` is already the correct session/group leader, return `$rp`
  immediately (no need to keep hunting for a "child").
- Otherwise, look for a child `c` of `$rp` (as it does today, ps --ppid or /proc children) where
  `ps -o sid= -p "$c"` (trimmed) equals `"$c"` itself — i.e. that child is ITSELF a session leader
  (the fork case) — and return `c` only when this holds.
- Never return a pid whose own sid is not itself (i.e. never return a bare grandchild that isn't a
  session leader).
- If nothing matching is found within the poll budget (or `$rp` has already exited), fall back to
  `$rp` exactly as today.

Keep the same bounded-poll structure and the `kill -0 "$rp"` early-exit-if-dead check already in the
function; only change what counts as a valid answer.

## Tests

Add a test case on the forced-`setsid`-path seam (the same PATH-shadowed-`systemd-run` trick r3
used to force `HAVE_CGROUP=0`) using a stub that traps TERM and ignores it (`trap '' TERM; while :;
do sleep 1; done` style, no natural short-lived children — i.e. a worker whose own process group must
actually be killed, not a lucky grandchild match) with `--timeout 3s`. Assert the run still completes
within a bound consistent with the 10s grace + SIGKILL path, and the stub's pid is confirmed dead —
this discriminates a correct group-kill from one that missed the target. Keep the existing
`assert_setsid_wait_path_enforced_timeout_kills` case passing (it may now pass for the right reason
instead of by luck — that's fine, don't weaken it).

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
`bash hooks/tests/dispatch-detach.test.sh`;
`node scripts/check-js-syntax.js`;
`bash scripts/sync-codex-plugin-skills.sh --check`.
List the exact rc of each in your commit message.

## Allowed files

Only `scripts/dispatch-hetero.sh`, `hooks/tests/dispatch-hetero-wall-timeout.test.sh`, and
`platforms/codex/plugin/` mirrors via `bash scripts/sync-codex-plugin-skills.sh`. Touch nothing else.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
