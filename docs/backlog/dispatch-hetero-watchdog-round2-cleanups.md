# dispatch-hetero watchdog round-2 cleanups

Source: v2.36.104 landing review rounds 1-4 (`docs/plans/evidence/2026-09-29-dispatch-hetero-watchdog-followups/landing/REPORT-land.md`, CHANGELOG v2.36.104 "known follow-ups"). All non-blocking (review 🔵/🟡); verified non-defects (old sidecar items 4 and 7) are not listed.

1. `_watchdog_pgid_has_live` in `scripts/dispatch-hetero.sh` has no caller left: delete it, or make the alive-check delegate to it; its `printf|tr` subshell/fork-heavy loop can be dropped.
2. No-setsid path: the watchdog sleeper has no `hetero-wall-watchdog-<tag>` argv0, so cancel relies on the TERM trap alone; `exec -a` would tag it.
3. Existing `kill "${sp:-}"` trap can hit an already-reaped pid after `wait "$sp"`; set `sp=""` afterwards.
4. cgroup path: if `set -m` did not isolate and `systemctl --user kill` transiently fails, the run is still not wall-bounded; retry the kill once.
5. Test helpers in `hooks/tests/dispatch-hetero-watchdog-followups.test.sh`: `reap_pid` still bare `kill -KILL` after `wait_pid_dead`; `assert_eq` argument order is reversed (failure messages only); r6 tests leak `set -e -o pipefail`.
6. `HETERO_TEST_*` env knobs are honoured unconditionally in the production script (test-only carve-out, evidence-discipline §23).
7. With a tty, `set -m` makes a worker that reads `/dev/tty` take SIGTTIN.
