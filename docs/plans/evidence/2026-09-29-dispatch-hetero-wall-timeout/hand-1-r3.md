# dispatch-hetero.sh wall-clock watchdog — repair pass (r3)

Review of `hands/wdog/1` (now merged through `hands/wdog/1-r2`) raised one remaining finding that
was upgraded to 🟠 MUST-FIX and must be fixed before this row can ship. Fix ONLY this one defect in
`scripts/dispatch-hetero.sh`; do not touch anything else already fixed in r2.

## Finding — setsid `--wait` ppid capture race can leave the worker unkillable

In `run_worker()`, the `HAVE_SETSID` (non-detached) containment path is:

```
setsid --wait env "${HANDS_GIT_ENV[@]+"${HANDS_GIT_ENV[@]}"}" "$@" >"$LOG" 2>&1 &
rp=$!
WORKER_SID="$(ps -o pid= --ppid "$rp" 2>/dev/null | tr -d ' ' | head -1)"
[ -z "$WORKER_SID" ] && WORKER_SID="$rp"
_wait_worker_with_watchdog "$rp"
```

`WORKER_SID` is captured with a single, immediate `ps --ppid "$rp"` call right after backgrounding
`setsid --wait`. If that `ps` runs before `setsid` has actually forked its child (a real race on a
loaded host), the lookup returns nothing and `WORKER_SID` falls back to `$rp` — the `setsid --wait`
supervisor's own pid, NOT the worker's session/process-group. When the watchdog later fires, it does
`kill -TERM -$WORKER_SID` (via `_watchdog_signal_worker`), which — with `WORKER_SID=$rp` — sends the
signal into `$rp`'s own process group. Since `$rp` (the `setsid --wait` process) is not the worker's
session leader in that fallback case, the actual worker process is never signaled at all: the
watchdog "fires" (result JSON says `timed_out: true`), but the worker keeps running unbounded. This
is precisely the defect this whole row exists to remove — a bound that silently fails to apply.

Fix this race. Do not just widen the race window; make the capture actually reliable. Acceptable
approaches (pick the simplest that fits the existing style):

- Poll for the child a bounded number of times with a short sleep between attempts (e.g. up to ~20
  attempts at 0.05–0.1s each, well under a second total) instead of a single `ps` call, so it
  reliably observes the real child once `setsid` has forked; keep the existing `$rp` fallback only if
  every attempt truly finds nothing (e.g. the process already exited before it could be observed).
- OR discover the worker's actual session id directly (e.g. via `ps -o sid= -p "$rp"` after the
  child appears, or by reading `/proc/$rp/task/*/children` if that pattern already exists elsewhere
  in this script) rather than assuming pgid via `--ppid`.
- OR use a `pkill -s <sid>`-style tree kill keyed off the session id once reliably known, instead of
  a raw `kill -TERM -$target` pgid signal — but only if this does not change behavior for the
  already-passing cases.

Whichever approach you pick, the guarantee must hold: when the watchdog's deadline fires on this
containment path, the SIGTERM (and later SIGKILL) actually reaches the worker's process tree, not
just the `setsid --wait` supervisor, even under adverse scheduling. Keep the existing self-pid/self-pgid
guard in `_watchdog_signal_worker` (never signal the dispatcher's own pid/pgid) exactly as-is.

## Tests

Strengthen or add a case in `hooks/tests/dispatch-hetero-wall-timeout.test.sh` that exercises this
specific containment path (the plain `HAVE_SETSID` non-detached path, i.e. whatever this test host
actually takes when `setsid --help` supports `--wait` and no cgroup is available) and asserts the
worker's stub pid is confirmed dead after an enforced timeout on THIS path specifically — not only
relying on whichever path the existing `assert_r1_*` cases happen to hit. If the existing cases
already exercise this exact path on this host (say so explicitly with evidence — e.g. print
`$HAVE_CGROUP`/`$HAVE_SETSID` during a manual check — in your commit message), a new case is not
required; otherwise add one.

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
`node scripts/check-js-syntax.js`;
`bash scripts/sync-codex-plugin-skills.sh --check`.
List the exact rc of each in your commit message.

## Allowed files

Only `scripts/dispatch-hetero.sh`, `hooks/tests/dispatch-hetero-wall-timeout.test.sh`, and
`platforms/codex/plugin/` mirrors via `bash scripts/sync-codex-plugin-skills.sh`. Touch nothing else.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
