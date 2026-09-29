Engine: sonnet

# Foreman brief — dispatch-hetero watchdog follow-ups (5 rows)

You are the foreman: you orchestrate and never edit product/test files yourself. Hands write the code; you verify from git
artifacts (`git diff --stat`, the hand's result JSON), never from a hand's self-report. Depth-0 lands the result.

## Setup (already done by depth-0 — authorized here, in the brief)
- Clone `C=/tmp/claude-1000/-home-cookys-projects-autopilot/f66e4da1-524e-49e7-9bb6-ef4e7a6c5451/scratchpad/wdogfu/clone`. Git hooks are enabled and push is disabled.
  `RUN=/tmp/claude-1000/-home-cookys-projects-autopilot/f66e4da1-524e-49e7-9bb6-ef4e7a6c5451/scratchpad/wdogfu/run`.
- develop base = `ab00b82e`. On top of it the clone carries ONE clone-local commit `a1ca251e` "PARALLEL-RUN LOCAL ONLY — mission_convergence
  enforcement_mode shadow (never land)". This is the documented parallel-run recipe (`docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md`
  line 7). Without it, `dispatch-hetero.sh` refuses under Mission enforce. **BASE_SHA for row 1 = `a1ca251e`.** Never modify, revert, or reset that commit, and never
  touch `.claude/owner-kernel-governance.json`. Depth-0 cherry-picks only hand commits.
- Never touch `/home/cookys/projects/autopilot` (the main checkout), and never run fetch or pull inside the clone.

## The plan
`$C/docs/backlog/dispatch-hetero-watchdog-followups.md`: rows R1..R5 (defined below; each groups numbered items of the sidecar), in that order (P1..P5; do not reorder).
Full row text: `$C/docs/BACKLOG.md` (grep the title) and each row's `Pointer` sidecar under `$C/docs/backlog/`.

## Per row (keep it to ≤ 8 tool calls; combine read-only commands)
1. **Premise check (1 call):** re-derive the defect at the current base (grep the symbol / run the repro). Gone → `SKIP <n> <evidence>`, no hand.
2. **Write `RUN/hand-<n>.md`** with these sections:
   - **Product:** what to change and why, described in prose. The redispatch-prompt hygiene gate rejects fenced code blocks and "around line N".
   - **Tests (RED-first):** a new case function `assert_r<n>_…` in the NEW suite `hooks/tests/dispatch-hetero-watchdog-followups.test.sh`. Row 1's hand creates that file (`chmod +x`); later rows append.
     Before fixing, run it against the unmodified base and record the red output as a `# RED at <sha>:` comment.
   - **Verify:** `test -x` on the new suite, then run the new suite AND every CONSUMER suite of the contract the row changes, not only the bundle suite.
     Add any suite `grep -l` finds for the symbol you changed, plus `node scripts/check-js-syntax.js` and `bash scripts/sync-codex-plugin-skills.sh --check`.
   - **Allowed files:** the minimal set, from the plan's scope section (plus `platforms/codex/plugin/` mirrors, synced via `bash scripts/sync-codex-plugin-skills.sh`).
   - This line, verbatim: "Commit ONE commit; touch no other file; run every Verify command in the foreground before committing."
3. **Dispatch** (Bash `run_in_background: true`, AND in the same turn a background `sleep 2700; echo WAKE-wdfu-<n>`; then END YOUR TURN):
   `cd $C && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-hetero.sh --branch hands/wdfu/<n> --base <prev accepted head or a1ca251e> --ledger RUN/hands.ledger --run-id wdfu-<n> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file RUN/hand-<n>.md`
   On any wake: look for `rc=` in the dispatch output. If it is not there, wait once with `node scripts/wait-dispatch-results.js --ledger RUN/hands.ledger --expect wdfu-<n>.implement --timeout 500`
   (foreground, Bash timeout 560000).
4. **Review:** diff `<base>..hands/wdfu/<n>` into `RUN/<n>.diff`, then run
   `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file RUN/<n>.diff --spec-file RUN/hand-<n>.md > RUN/<n>.review.json`
   in the FOREGROUND with Bash timeout 1000000. If you get no verdict or tool-call-shaped text, retry once with "You have no tools. Answer only with the verdict JSON." added to the spec.
   If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on `hands/wdfu/<n>-r2` (base = the head of `hands/wdfu/<n>`) and re-review.
5. **Stacking:** each row's `--base` = the previous row's accepted head (its `-r2` head if repaired). Track this in `RUN/accepted-heads.txt`.
6. A hand-rail failure (quota, readiness, 402, "Cannot use this model", precondition) → `RAIL-FAIL <n> <rc> <stderr tail>`, then continue. NEVER author the code yourself.

## After all rows
In a throwaway worktree at the last accepted head (`git -C $C worktree add RUN/verify <head>`), run, one at a time and solo, each with the env prefix and `< /dev/null`:
- the new suite and the plan's consumer-suite list;
- `check-js-syntax`;
- `sync --check`.

Then remove the worktree.

## Report
`RUN/REPORT.md`: per row, `LAND <n> <head>` / `SKIP` / `FAIL` / `RAIL-FAIL` / `NO-VERDICT`, together with the diff stat, the review verdict and findings, and the RED line. At the end, the aggregate verify table (rc per suite).
Final message: the REPORT path and those per-row lines. Do not bump the version, edit CHANGELOG or BACKLOG, merge, or push.


## Rows (units of work; the sidecar's numbered items 1-10 are the source text)
The plan is `docs/backlog/dispatch-hetero-watchdog-followups.md`. It has no BACKLOG-row Pointer indirection: use its item numbers. All ten items are in scope (operator decision), grouped so each hand touches one area of `scripts/dispatch-hetero.sh`:
- **R1** items 1 and 9 — no-setsid / no-job-control degrade. When `set -m` fails on the no-setsid fallback, the run must report `timeout_enforced: false` (a disarmed flag) instead of true; and the fallback must not leave job-control notices on stderr for the rest of the run (scope `set -m`/`set +m` tightly, or silence the notices).
- **R2** items 2 and 6 — kill paths. cgroup path: if `systemctl --user kill` fails, fall back to a pgid-scoped kill of the worker (still never a bare pid). Sleeper: drop the bare `kill "$sp"` or verify `/proc/$sp/cmdline` carries the watchdog tag first.
- **R3** item 3 — deadline coincidence: if the worker exited naturally, the run must not be stamped `timed_out: true` just because `.fired` was created in the same instant. The verdict should come from whether the worker was actually still alive when the watchdog signalled it. If this cannot be made race-free without a redesign, `SKIP` with the evidence and say why.
- **R4** items 4, 5, 7, 10 — first premise-check 4 (are there really duplicate `timeout_seconds`/`timeout_source` keys in strict-contract manifests? run a strict-contract dry run and inspect) and 7 (does the campaign preflight leave a `caller` label where `caller_within_wall` belongs? run the repro). Fix only what reproduces; SKIP the rest with evidence. Items 5 and 10 are one doc fix: the OUTPUT contract comment must not list `default` as a result-JSON `timeout_source` value.
- **R5** item 8 — detached path and `reap_container` on the worker's own session. Premise-check first against `hooks/tests/dispatch-hetero-gc.test.sh` and the GC/cancel logic. If a real leak reproduces, fix it; if it is only theoretical, `SKIP` with evidence.

## Extra constraints (from the v2.36.101 landing, `docs/plans/evidence/2026-09-29-dispatch-hetero-wall-timeout/README.md`)
- A stub-only suite proved nothing last time (the detached path was never exercised). Every row that changes behavior must include one test that runs the REAL detached dispatch path (not just the stubbed function), or state in the hand brief exactly why it cannot.
- Never use a bare-pid kill fallback (that was the 🟠 that combined review found).
- The watchdog code must keep working when `set -e`/`pipefail` are active in the caller.
- Existing watchdog suites must stay green: find them with `grep -l "run_worker\|hetero-wall-watchdog\|timeout_enforced" hooks/tests/*.sh` and run them all in each Verify.
- Do not bump the version or edit CHANGELOG/BACKLOG (depth-0's landing does that).
