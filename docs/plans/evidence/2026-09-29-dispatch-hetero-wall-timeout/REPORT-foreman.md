# REPORT — dispatch-hetero wall-timeout watchdog (row P1)

## Result

`LAND 1 e71a5e9442c184714337f763da2800e08fe8262f`

Branch: `hands/wdog/1-r6` (base `1f81de14f02b5958237cf2f581934c2cad65c1ed`)

## Sequence and review verdicts

- **Hand 1** (`9b6e7e08`): initial central watchdog, enforced-iff-explicit predicate, result/manifest
  fields. Review #1: **FIX-THEN-SHIP** — 🟠 `[timeout-source-overload]`, 🟠
  `[fired-path-holds-token-kills-dead-pgid]`, 🟡 `[early-cancel-sleeper-leak]`, 🔵
  `[setsid-wait-ppid-race]`.
- **r2** (`4821e68b`): fixed the two 🟠 + 🟡. Depth-0 upgraded 🔵 `[setsid-wait-ppid-race]` to 🟠.
- **r3** (`88d76b82`): added `_setsid_wait_worker_sid` (bounded poll) + forced-setsid-path test.
  Review #2 (full range): **SHIP-AS-IS** (only 🟡/🔵 left).
- **CRITICAL, found live between r3 and landing**: a real cursor dispatch with `--timeout 20s` plus
  `--ledger/--run-id/--stage` ran to natural completion at 322s wall (`timed_out:false`,
  `timeout_enforced:true` — a false claim). Root cause (depth-0 diagnosis): the detached-execution
  path's `declare -f` function-serialization list omitted `normalize_timeout_seconds`, so the
  watchdog was silently never armed inside the detached child — the path every real dispatch takes.
  No stub test had ever exercised it (none passed `--ledger/--run-id/--stage` together). The hung
  process exited on its own before a manual kill was needed; `hands/wdog/proof` cleaned up.
- **r4** (`75e9cf5c`): added `normalize_timeout_seconds` to the `declare -f` list; audited the full
  watchdog call graph (no other gap found); added a detached-path test (RED against r3, green after).
- **Review #3** (full range through r4): **FIX-THEN-SHIP** — 🟠
  `[setsid-wait-sid-picks-grandchild]`: on a no-fork host, `_setsid_wait_worker_sid` could return a
  grandchild pid instead of the worker's own session/group; plus 3 🔵 follow-ups.
- **r5** (`9d50f318`): fixed `_setsid_wait_worker_sid` to check whether the polled pid is itself a
  session leader first (no-fork case), else accept only a child that is itself a session leader
  (never an arbitrary grandchild). Added a TERM-ignoring busy-loop test with no natural short-lived
  children.
- **Review #4** (full range through r5): **SHIP-AS-IS**. Only 🔵 follow-ups (no-setsid degrade,
  cgroup-kill-failure no fallback, sub-millisecond deadline-coincidence mislabel, unconfirmed
  manifest duplicate-key nit).
- **r6** (`e71a5e94`): combined-review 🟠 `[wdog-stale-pid-fallback]`, adjudicated real by depth-0 —
  in `_watchdog_signal_worker`, the chain `kill -SIG -$target || kill -SIG $target` fell back to a
  bare-pid kill only when the group-kill failed, i.e. only when the group no longer existed, so the
  bare-pid fallback could only ever hit a dead/recycled pid (e.g. an orphaned watchdog firing after
  the dispatcher itself was SIGKILLed). Since r5 guarantees `WORKER_SID` is always a genuine
  session/group leader, the fallback had no legitimate use. Fix: removed the bare-pid fallback
  entirely (group-kill only, fail silently), updated the adjacent comment to say why. Added a
  unit-style isolation test (`assert_r6_no_bare_pid_fallback`) that sources `_self_pgid` and
  `_watchdog_signal_worker` directly, sets `WORKER_SID` to a live helper pid that shares the test's
  own process group (not a leader), calls `_watchdog_signal_worker TERM`, and asserts the helper is
  STILL ALIVE afterward — proving no bare-pid fallback fired. RED at `9d50f3186f798b318d804e5ce837ba6820f7444d`
  recorded (helper died under the old code), green after the fix.
- **Review #5** (full range through r6): **SHIP-AS-IS**. Only 🔵 follow-ups remain (setsid-wait
  lazy-resolve fallback, arm/cancel micro-race orphan on the no-setsid branch only, sub-millisecond
  deadline-coincidence litter, `set -m` fallback side-effects, a preflight-ordering nit not
  verifiable from the diff). No 🔴/🟠 remains.

## Diff stat (full range 1f81de14..hands/wdog/1-r6)

```
 hooks/tests/dispatch-hetero-wall-timeout.test.sh  | 381 +++++++++++++++++++++
 platforms/codex/plugin/scripts/dispatch-hetero.sh | 274 ++++++++++++--
 scripts/dispatch-hetero.sh                        | 274 ++++++++++++--
 3 files changed, 845 insertions(+), 84 deletions(-)
```
6 commits: hand-1 → r2 → r3 → r4 → r5 → r6, each on top of the last.

## RED evidence
- `# RED at 1f81de14...` (original 5 cases).
- `# RED at 88d76b82...` (detached-path case, r4).
- `# RED at 9d50f318...` (bare-pid-fallback isolation case, r6).

## Verify table (rerun solo, foreground, throwaway worktree at accepted head `e71a5e94`)

| Command | rc |
|---|---|
| `test -x hooks/tests/dispatch-hetero-wall-timeout.test.sh` | 0 |
| `bash hooks/tests/dispatch-hetero-wall-timeout.test.sh` (26 assertions) | 0 |
| `bash hooks/tests/dispatch-hetero.test.sh` (353 assertions) | 0 |
| `bash hooks/tests/dispatch-hetero-contract.test.sh` (87 assertions) | 0 |
| `bash hooks/tests/dispatch-hetero-cursor-routing.test.sh` (91 assertions) | 0 |
| `bash hooks/tests/dispatch-hetero-gc.test.sh` (43 assertions) | 0 |
| `bash hooks/tests/dispatch-status.test.sh` (109 assertions) | 0 |
| `bash hooks/tests/dispatch-detach.test.sh` (74 assertions) | 0 |
| `node scripts/check-js-syntax.js` (693 files) | 0 |
| `bash scripts/sync-codex-plugin-skills.sh --check` | 0 |

## Real-rail proof (does not depend on the stub)

Run 1 (against r3, before the detached-path bug was found): **failed** — ran to natural completion
at 322s wall despite `--timeout 20s`. Surfaced the r4 defect.

Run 2 (accepted head `9d50f318`, r5): passed — `timed_out:true`, `timeout_enforced:true`,
`wall_secs:22`. Confirmed the bare-pid-fallback finding was still latent (not exercised by this
particular proof, found instead by combined review).

Run 3 (accepted head `e71a5e94`, r6), branch `hands/wdog/proof3`, base `1f81de14`, own ledger:
```
{ "status": "failure", "timed_out": true, "timeout_enforced": true,
  "timeout_seconds": 20, "timeout_source": "caller",
  "error": "wall timeout (20s) exceeded — worker terminated", "wall_secs": 23 }
```
Manifest-recorded pid confirmed dead (`kill -0` → no such process); no leftover
`cursor-agent`/`hetero-hands-wdog-proof3` processes. Proof branch and worktree deleted afterward.

## Outstanding items for depth-0

None 🔴/🟠 — final review verdict (review #5, full range through r6) is SHIP-AS-IS. The 🔵
follow-ups listed above are non-blocking per the brief's FIX-THEN-SHIP threshold.

## Not done (per brief)

No version bump, no CHANGELOG/BACKLOG edit, no merge, no push. `docs/scripts-inventory.md`
untouched (no timeout semantics stated in that row per hand-1's note).
