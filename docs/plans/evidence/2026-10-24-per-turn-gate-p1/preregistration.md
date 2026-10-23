# P1 preregistration (plan section 3, Step 3)

Written and committed before the first measurement call. Plan: `docs/plans/2026-10-20-per-turn-gate.md` as merged at e726bc485. Owner approvals: d-0ab59f36 (P1), d-66374200 (cap raised to 18 USD, never raised again).

## Runtime and preflight (recorded before this commit)

- `claude --version`: `2.1.309 (Claude Code)` (the pin set by owner d-ea7857ea).
- Authentication probe (same call shape as the driver's authProbe: credentials-only scratch HOME, `--setting-sources project --strict-mcp-config --dangerously-skip-permissions`, input "Reply with exactly AUTH_OK"): result `AUTH_OK`, `is_error=false`, cost 0.016617 USD (counted in the spend below). This probe is the only call before this commit.
- Dedicated config: HOME for the batch is a directory containing only `.claude/.credentials.json` (a copy) and `.claude.json` with `{"hasCompletedOnboarding":true}`; the harness then copies only the credential file into its own per-run scratch HOME. The real ~/.claude is never used.

## Procedure and provenance (section 3.2)

Thirty sequential harness calls, one per preallocated id C-01 to C-30, from `p1-wrapper.sh` (committed beside this note; sha256 976ace37a7a929c19bd71f0f694c149682e7178f41950d8661b94ef24b237075). Each call is exactly:
`HOME=<dedicated home> bash evals/orchestration/run-orchestration-eval.sh --task t14-constraint-horizon --arm off --runner cc --model claude-haiku-4-5 --out <run dir>/C-NN --gate observe`
with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`. These are the arguments that `runOne()` in `evals/orchestration/run-t14-gate-batch.js` passes for a C run (read in that file, lines 269-290). The driver passes no turn-count or scoring flag. Harness defaults, read in `run-orchestration-eval.sh`: the turns are the files in `tasks/t14-constraint-horizon/turns/` (5), the per-call timeout is `ORCH_TIMEOUT` default 10m, scoring is the harness's own oracle step, and the harness is byte-identical to the one the second experiment used (`git diff a93e98299 HEAD` on the harness and the task directory is empty). The batch driver is not used (it always adds G runs and reruns incomplete ids). Output directories: `<run>/runs/C-01` to `C-30`, refused if they exist; the wrapper never issues a second attempt for an id, requires the previous id to have finished, appends `START` with a timestamp to `invocation.log` before every call, and records the preregistration commit hash and time at its first start.

Order: C-01 to C-30 in id order. Window: one continuous window of at most 8 hours (the wrapper may be run in several segments; segment boundaries are logged; the first START to the last END must be within 8 hours).

## Metrics (section 3.1)

Per run from `oracle.log`: M1 (constraints_pass), M2 (features_pass), M3 (both), features 1 to 5, constraints 1 to 3; from `result.json`: duration, turns_completed, failure_class; from `run.log`: result objects (cost, model). A run's cost is the last result object's `total_cost_usd` (cumulative within the session, see `cost-derivation.md`).

## Validity, labels, decision rules (section 3.3, unchanged)

Valid only if all hold, else label U: all 30 ids launched exactly once in order, sequentially, within 8 hours; the task hashes equal the listing below; CLI 2.1.309 for every run; the preflight probe passed and no authentication failure occurred; no deviation from the command above; every launched run has a recoverable oracle score; at least 27 of 30 runs completed five turns; if resolved model ids appear, they are a single value. n=30, incomplete rows counted with their oracle-on-repo-as-left scores. M2_3 against 23/30 and 11/29 by two-sided Fisher exact test at 0.05; labels A (rejected vs 23/30 only), B (rejected vs 11/29 only), C (rejected against neither), D (rejected against both). A run stopped by the cost rule or an authentication failure leaves unlaunched ids, which makes the batch U. GO needs P0 (A1, B1 affirmative on 2.1.309, `docs/plans/evidence/2026-10-23-per-turn-gate-p0/`), a valid batch and its M2_3; the label does not decide GO; label U or an unproduced P0 answer is HOLD.

## Task hashes

`taskhash.pre.txt` is the listing produced by the plan's command inside the task directory; it is identical (`diff` empty) to the `frozen` map in the second experiment's batch header (18 files). The wrapper recomputes the listing at every start and aborts on any difference; the verdict repeats it after the last call.

## Candidate causes (section 3.4, unchanged)

Labels follow the observation-to-label function in plan section 3.4 exactly. Observations used: row 1 resolved model ids in the copied historical logs (all runs show one id, claude-haiku-4-5, in both batches: identical, so unresolved; the new batch gives no observation); row 2 the new batch start time against the two earlier windows; row 3 the A to D label; row 4 the diff `6d9b22427..a93e98299` (read before the verdict; a change on a path executed in observe mode is consistent, otherwise unresolved); row 5 the copied second-batch logs around C-16 attempt 1; row 6 unavailable unless the copied `run.log` files carry invocation lines or settings (they were checked in `hist-analysis.txt` inputs: none were seen in the result objects); row 7 the turn-1 work-directory listing if recoverable from the logs, else unavailable; row 8 unresolved by rule.

## Cost estimate and stop rule (section 3, Step 2)

A run costs its last cumulative result object. Historical C-arm means: 0.5453 USD (first batch), 0.4799 USD (second batch). Estimate for 30 runs, larger mean: 30 x 0.5453 = 16.36 USD, plus the 0.0166 probe = 16.38 USD; cap 18 USD (owner d-66374200), headroom 1.62 USD, about 2.5 standard deviations of a 30-run total (0.68). Stop rule, checked by the wrapper before every run: spent so far (probe plus every finished run's final cost) plus the remaining run count (including the one about to start) times 0.5453 must not exceed 18 USD; otherwise the wrapper stops, the remaining ids stay unlaunched, and the batch is U. Expected wall time about 30 x 290 s, about 2.4 hours.

## Not in this note

No outcome of the new batch is read before this commit. Historical data copied in Step 1 (`hist-sums.txt`, `hist-analysis.txt`) is not a new outcome.
