# dispatch-hetero.sh wall-clock watchdog — repair pass (r2)

Review of `hands/wdog/1` returned FIX-THEN-SHIP. Fix exactly these three findings in the existing
watchdog code (`scripts/dispatch-hetero.sh`, functions `_cancel_worker_watchdog`,
`_watchdog_signal_worker`, `_arm_worker_watchdog`, `_wait_worker_with_watchdog`, plus the
pre-enforcement-predicate block and `write_manifest`). Do not touch anything else; do not revert or
redesign the mechanism, only repair these three defects.

## Finding 1 (🟠 MUST-FIX) — timeout_source overload

The preflight block
`if [ "$TIMEOUT_SUPPLIED" -eq 1 ] && [ -z "${TIMEOUT_SOURCE:-}" ]; then TIMEOUT_SOURCE="caller_within_wall"; fi`
sets `TIMEOUT_SOURCE` to `caller_within_wall` even when there is no Mission contract at all, but that
value previously meant "the caller's value was accepted within a contract's wall budget" — so a
manifest/result consumer now sees `caller_within_wall` and wrongly infers a contract was in play.
Fix: use a distinct value for the plain no-contract caller-supplied case, e.g. `TIMEOUT_SOURCE="caller"`,
in that fallback block. Every enforcement predicate in the diff already keys only on
`TIMEOUT_SOURCE` being non-empty, so `caller` / `contract_wall` / `caller_within_wall` all still
enforce correctly, and `default` (bare unenforced default) is unaffected. Update any place that
special-cases the literal string `caller_within_wall` if one exists, and update the OUTPUT/manifest
contract comment if it lists specific `timeout_source` enum values.

## Finding 2 (🟠 MUST-FIX) — kills a dead process group after grace, always

In `_wait_worker_with_watchdog`, on the timed-out path (worker died from the watchdog's SIGTERM),
the code does NOT remove `WATCHDOG_TOKEN_FILE` before waiting on `WATCHDOG_PID`. That means the
watchdog subshell's grace loop (`while [ "$i" -lt 10 ]; do [ -f "$tok" ] || exit 0; sleep 1; ...`)
always runs the full 10-second grace and then unconditionally sends `SIGKILL -$WORKER_SID` to a
process group whose members have already exited — every enforced timeout now takes an unnecessary
extra ~10 seconds, and it signals a pgid that may since have been recycled by the OS for an
unrelated process, which is exactly the hazard the spec forbids.

Fix: in `_wait_worker_with_watchdog`, on the branch where `${WATCHDOG_TOKEN_FILE}.fired` exists
(worker already died from the watchdog's TERM), remove `$WATCHDOG_TOKEN_FILE` (the plain token, not
the `.fired` marker) immediately, before waiting on `$WATCHDOG_PID`, so the grace loop's
`[ -f "$tok" ] || exit 0` check short-circuits on its next 1-second tick and the SIGKILL is only sent
while there is any chance the worker is still alive. Keep `reap_container` as the belt-and-braces
survivor sweep exactly as it already runs today.

## Finding 3 (🟡 MUST-FIX) — stray sleeper when the worker finishes before the sleeper pid is recorded

In `_cancel_worker_watchdog`, if the worker completes (fast run) before the watchdog subshell has
written `${WATCHDOG_TOKEN_FILE}.sleeppid`, the sleeper process is never killed by the read-the-pidfile
path, and the watchdog subshell itself then gets SIGTERMed while blocked in its `wait $!` on the
sleeper — orphaning the `sleep N` (or `setsid ... sleep N` under the `hetero-wall-watchdog-<tag>`
argv0 tag) process for the remainder of its full duration. This is exactly the stray-watchdog-sleeper
case `assert_r1_no_stray_watchdog` exists to catch, and it will flake under a fast worker.

Fix (pick whichever is simplest given the existing structure, but implement a real fix, not just a
longer race window):
- Inside the watchdog subshell, set `sp=""`, install `trap 'kill "${sp:-}" 2>/dev/null; exit 0' TERM`
  before forking the sleeper, and assign `sp=$!` immediately after forking it — so a TERM delivered to
  the subshell (from `_cancel_worker_watchdog`'s `kill "$WATCHDOG_PID"`) reliably kills the sleeper even
  if `.sleeppid` was never written or read.
- AND, in `_cancel_worker_watchdog`, after killing/waiting `$WATCHDOG_PID`, add a belt-and-braces
  sweep that also kills any leftover sleeper carrying this run's unique token tag (e.g.
  `pkill -f "hetero-wall-watchdog-${tag}"` where `tag` is the same token-file basename used when
  arming, or by re-reading `.sleeppid` one more time after the wait) so no `sleep` process from this
  watchdog can outlive normal completion under any interleaving.

Do not touch the 🔵 CUT/FOLLOW-UP items from the review (the `setsid --wait`/`ps --ppid` race, `set -m`
job-control stderr notices, RED-comment wording, and the host-wide `pgrep -f` scope in the test) —
those are explicitly excluded from this repair.

## Tests

Update `hooks/tests/dispatch-hetero-wall-timeout.test.sh` only as needed so the existing five cases
still pass under the fixed code, AND strengthen `assert_r1_no_stray_watchdog` (or add a new
assertion) so it would have caught finding 2 (extra ~10s delay on an enforced-timeout run past what
the grace period requires) and finding 3 (a fast worker with no timeout involved, i.e. keep the
existing case but make sure it exercises the actual race — e.g. by not pre-creating `.sleeppid` timing
assumptions). Keep changes minimal and targeted at proving these three fixes, not a rewrite.

## Verify

Same list as the first pass, run solo/foreground with
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
