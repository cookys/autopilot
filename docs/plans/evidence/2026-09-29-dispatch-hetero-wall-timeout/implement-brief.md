Engine: sonnet

# Foreman brief — dispatch-hetero wall-timeout watchdog (1 row)

You are the foreman: you orchestrate and never edit product/test files yourself. Hands write the code; you verify from git
artifacts (`git diff --stat`, the hand's result JSON), never from a hand's self-report. Depth-0 lands the result.

## Setup (already done by depth-0 — authorized here, in the brief)
- Clone `C=/tmp/claude-1000/-home-cookys-projects-autopilot/d9a21e11-1567-4886-9a15-da347b58e585/scratchpad/wdog/clone`.
  Git hooks are enabled and push is disabled. `RUN=/tmp/claude-1000/-home-cookys-projects-autopilot/d9a21e11-1567-4886-9a15-da347b58e585/scratchpad/wdog/run`.
- develop base = `9dbe88a7`. On top of it the clone carries ONE clone-local commit `1f81de14` "PARALLEL-RUN LOCAL ONLY — mission_convergence
  enforcement_mode shadow (never land)" (documented recipe: `docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md` line 7). Without it,
  `dispatch-hetero.sh` refuses under Mission enforce. **BASE_SHA for row 1 = `1f81de14`.** Never modify, revert, or reset that commit, and never
  touch `.claude/owner-kernel-governance.json`. Depth-0 cherry-picks only hand commits.
- Never touch `/home/cookys/projects/autopilot` (the main checkout), and never run fetch or pull inside the clone.
- Irony to respect: the hand's OWN dispatch below is not bounded by `--timeout` (that is the bug). Your dead-man timer is the bound.

## The row (P1)
Evidence sidecar: `$C/docs/backlog/dispatch-hetero-grok-timeout-not-applied.md`. Depth-0 re-derived at 9dbe88a7 and found it WIDER than the sidecar says:

- `run_worker()` in `scripts/dispatch-hetero.sh` (the function starting with the comment `"$@" = argv of the worker; redirects to LOG`) has no
  wall-clock bound on ANY containment path (detached-child, cgroup via `systemd-run --user --scope`, setsid, plain). It just waits.
- `$TIMEOUT` reaches a worker only on the agy rail (agy's own `--print-timeout`). grok, cursor, codex, cc-shim/claude, kimi, opencode, pi,
  qoderclicn: unbounded. The manifest still emits `timeout_seconds` — a claim, not a fact (ADR-0001).
- `TIMEOUT` defaults to `9m`; `TIMEOUT_SUPPLIED=1` when the caller passed `--timeout`; `TIMEOUT_SOURCE` is `contract_wall` or `caller_within_wall`
  when a Mission contract's `budget.wall_seconds` is in play (see the block that dies with "exceeds contract budget.wall_seconds").

Operator-approved fix shape (2026-09-28 — "明訂上限才執行"; implement exactly this):
1. **Enforced iff explicit.** The bound is ENFORCED when the caller supplied `--timeout` OR a contract wall set it (`TIMEOUT_SOURCE` non-empty).
   The bare default (`9m`, nothing supplied, no contract) is NOT enforced — existing long runs that relied on the default must keep working.
2. **One central watchdog in `run_worker`**, covering every rail and every containment path — not per-runner CLI flags. Leave agy's own
   `--print-timeout` as-is (belt and braces). On expiry: SIGTERM the worker's whole tree (cgroup: `systemctl --user kill` the scope unit, or
   equivalent; setsid: the worker's process group/session; plain and detached-child: background the worker so it can be killed, and kill its
   group — NEVER the dispatcher's own process or session), wait a 10 s grace, then SIGKILL. The watchdog must be cancelled/reaped on normal exit
   (no stray `sleep` left behind; no kill of a recycled pid). `reap_container` still runs afterwards.
3. **Result JSON**: add fields `timed_out` (true|false) and `timeout_enforced` (true|false) to the main result object. A timed-out run's
   `status` is the EXISTING value `failure` (do NOT invent a new status value — consumers switch on it), `error` =
   `wall timeout (<N>s) exceeded — worker terminated`, and `commit`/diff fields still report whatever the branch actually holds.
   Update the OUTPUT contract comment near the top of the script.
4. **Manifest**: alongside `timeout_seconds`/`timeout_source`, emit `timeout_enforced` (true|false); for the unenforced default emit
   `timeout_source` as `default` so the record never implies a bound that was not applied.
5. Portability: bash, POSIX tools already used by the script; no new dependencies. Must work when `systemd-run` is absent (setsid/plain paths).

## Per row (keep it to ≤ 8 tool calls; combine read-only commands)
1. **Premise check (1 call):** grep `run_worker()` body for any timeout/kill-on-deadline logic at base → expect none. Gone → `SKIP 1 <evidence>`.
2. **Write `RUN/hand-1.md`** with these sections:
   - **Product:** the five points above, in prose. The redispatch-prompt hygiene gate rejects fenced code blocks and "around line N".
   - **Tests (RED-first):** new suite `hooks/tests/dispatch-hetero-wall-timeout.test.sh` (`chmod +x` AND `test -x` it — `git update-index --chmod`
     alone is reverted by a later add). Use a stub runner binary (look at how `hooks/tests/dispatch-hetero.test.sh` / `dispatch-hetero-cursor-routing.test.sh`
     stub a runner via its `*_BIN` env var and build a throwaway repo; reuse that pattern). The stub writes its pid to a file, then sleeps 120 s. Cases:
     `assert_r1_grok_enforced_timeout_kills` — grok rail, `--timeout 3s`: dispatch returns within 30 s, result `status` failure, `timed_out` true,
     `timeout_enforced` true, error mentions wall timeout, and the stub pid is no longer alive;
     `assert_r1_second_rail_enforced` — the same on one more non-agy rail (cursor or kimi, whichever the existing tests already stub most easily);
     `assert_r1_default_not_enforced` — no `--timeout`, stub sleeps 5 s then exits 0: completes normally, `timed_out` false, `timeout_enforced` false,
     manifest `timeout_source` default;
     `assert_r1_no_stray_watchdog` — after a normal fast run with `--timeout 60s`, no watchdog sleeper process from this run remains;
     `assert_r1_term_ignoring_worker_killed` — stub traps TERM and keeps sleeping: still dead after grace (SIGKILL path).
     Exercise whichever containment path the test host gives, and add one case forcing the setsid or plain path if the script has an env/test seam
     for it (say which). Record `# RED at <sha>:` output from the unmodified base before fixing.
   - **Verify:** `test -x` the new suite; then solo, foreground, each with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID ... < /dev/null`:
     the new suite; `bash hooks/tests/dispatch-hetero.test.sh`; `bash hooks/tests/dispatch-hetero-contract.test.sh`;
     `bash hooks/tests/dispatch-hetero-cursor-routing.test.sh`; `bash hooks/tests/dispatch-hetero-gc.test.sh`; every other suite
     `grep -rl 'timeout_seconds\|timeout_source\|dispatch-hetero' hooks/tests scripts/*.test.js` finds that parses the result JSON or manifest
     (list them in the hand file explicitly); `node scripts/check-js-syntax.js`; `bash scripts/sync-codex-plugin-skills.sh --check`.
   - **Allowed files:** `scripts/dispatch-hetero.sh`, `hooks/tests/dispatch-hetero-wall-timeout.test.sh`, existing dispatch-hetero test suites
     only where a pinned manifest/result shape must be adapted (adapt, never delete), `docs/scripts-inventory.md` row for dispatch-hetero only if
     it states timeout semantics, plus `platforms/codex/plugin/` mirrors via `bash scripts/sync-codex-plugin-skills.sh`.
   - This line, verbatim: "Commit ONE commit; touch no other file; run every Verify command in the foreground before committing."
3. **Dispatch** (Bash `run_in_background: true`, AND in the same turn a background `sleep 2700; echo WAKE-wdog-1`; then END YOUR TURN):
   `cd $C && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-hetero.sh --branch hands/wdog/1 --base 1f81de14 --ledger RUN/hands.ledger --run-id wdog-1 --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file RUN/hand-1.md > RUN/1.dispatch.json 2> RUN/1.dispatch.err; echo "rc=$?" >> RUN/1.dispatch.err`
   On any wake: look for `rc=` in `RUN/1.dispatch.err`. If absent, wait once with `node scripts/wait-dispatch-results.js --ledger RUN/hands.ledger --expect wdog-1.implement --timeout 500`
   (foreground, Bash timeout 560000).
4. **Review:** diff `1f81de14..hands/wdog/1` into `RUN/1.diff`, then
   `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file RUN/1.diff --spec-file RUN/hand-1.md > RUN/1.review.json`
   in the FOREGROUND with Bash timeout 1000000. Retry once with "You have no tools. Answer only with the verdict JSON." if no verdict.
   Ask the reviewer (in the spec) to scrutinise: can the watchdog ever kill the dispatcher itself or an unrelated recycled pid; is the watchdog
   reaped on every exit path; is the default truly unenforced; does every containment path get bounded.
   FIX-THEN-SHIP with 🔴/🟠 you judge real → ONE repair hand on `hands/wdog/1-r2` (base = head of `hands/wdog/1`), re-review the full range.
   You may not dismiss a 🔴/🟠 yourself — list it in the REPORT for depth-0.
5. Rail failure (quota, readiness, 402, "Cannot use this model", precondition) → `RAIL-FAIL 1 <rc> <stderr tail>`. NEVER author the code yourself.

## After the row
Throwaway worktree at the accepted head (`git -C $C worktree add RUN/verify <head>`): rerun the Verify list solo, one at a time. Then a real-rail
proof that does NOT depend on the stub: from the worktree, a real `dispatch-hetero.sh` run on the cursor rail with `--timeout 20s` and a prompt file
that asks the agent to run `sleep 300` before doing anything (branch `hands/wdog/proof`, base `1f81de14`, run-id `wdog-proof`, its own ledger
`RUN/proof.ledger`) — expect it to return within ~60 s with `timed_out` true, and `pgrep -f` style checks (mind: `pgrep -f` matches itself; use
the pid from the log/manifest) show no survivor. Then delete that proof branch and remove the worktree.

## Report
`RUN/REPORT.md`: `LAND 1 <head>` / `SKIP` / `FAIL` / `RAIL-FAIL` / `NO-VERDICT`, diff stat, review verdicts + findings, RED line, verify table (rc per suite),
real-rail proof output. Final message: the REPORT path and that line. Do not bump the version, edit CHANGELOG or BACKLOG, merge, or push.
