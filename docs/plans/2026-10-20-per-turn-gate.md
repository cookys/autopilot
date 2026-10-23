# Plan — per-turn gate (BL-0055): hook probe (P0) and baseline measurement (P1)

> Status: plan review v3 CONDITIONAL at generation cap; depth-0 adjudicated 2026-10-23: 7 blocking findings fixed without re-review; P0 probe requires a separate owner approval with a cost estimate

## 0. Thesis and evidence

BL-0055 asked whether a per-turn check that talks back to the model can hold stated rules without trading away features. Two frozen batches on one task answered that for a haiku alias. Owner decision d-9f311d27 (2026-10-20) was to write a plan, not to ship a default. Six plan-review generations (g1 and g2 in each of three rounds) on the earlier, larger plan did not converge (section 5), and owner decision d-b8606fdd (2026-10-23) narrowed the plan to the two phases whose results every later design depends on. Phases beyond P1 are not designed here (section 4).

Experiment 1 (`docs/projects/_archive/2026/10/2026-10-19-t14-gate-batch/report.md`, plan `docs/plans/2026-10-19-t14-per-turn-gate-experiment.md`): model alias `claude-haiku-4-5`, task `t14-constraint-horizon`, n=30 per arm, verdict FAIL-TRADE. M1 constraints held C 1/30, G 29/30; M2 features built C 23/30, G 17/30; M3 both C 1/30, G 16/30. The retry text named violations only.

Experiment 2 (`report-r2.md` in the same directory, plan `docs/plans/2026-10-19-t14-gate-round2.md`): the intended treatment change is the retry message, which also lists feature gaps and ends with a keep-what-works line. Verdict SUCCESS. M1 C 5/29, G 28/29 (Fisher p 1.99e-10); M2 C 11/29, G 27/29; M3 C 0/29, G 26/29. 28 mechanism runs, 43 G retries, four G runs exhausted retries (G-04, G-26, G-28, G-30). Other harness changes and unrecorded runtime differences exist between the batches, so the difference is not attributed to the feedback text alone. Both experiments used Claude Code CLI 2.1.303, alias `claude-haiku-4-5`, one task, and a retry cap of 2. The reports' caveat stands: the result must not be extrapolated. The second experiment had two infra failures, G-15 attempt 1 runner_timeout (641 s) and C-16 attempt 1 runner_error (335 s, OAuth session expired mid-run), neither re-run.

Historical figures this plan repeats, and no others: the counts above; C-arm mean duration 292 s (first) versus 269 s (second), as recorded by the driver; wall time about 6 h 42 min for the first experiment (including an authentication wait) and about 5 h 40 min for the second, each for 30 pairs; harness commits compared `6d9b22427` and `a93e98299`. The driver-recorded cost figures (about 0.065 to 0.099 USD per run) are first-response costs, not the cost of a complete five-turn run, and no cost estimate for the P1 batch is made from them (section 3, Step 2). Section 2 derives a bounded P0 estimate from them per CLI result object, because a P0 session is far lighter than a t14 turn. Any other historical number (per-feature, per-half-schedule, constraint-failure counts) is a P1 output re-derived from the raw logs, not a premise. Thresholds and sample sizes below are planned values, not evidence.

Open anomaly: the C arm M2 fell from 23/30 in the first experiment to 11/29 in the second. What the two batches are known to share is the task, the nominal alias, and the CLI pin. The model id actually served, the settings actually loaded, and the invocation flags were not recorded, so they are P1 evidence, not facts. `report-r2.md` says no cause was analysed. The drop is data to explain, not a reason to reopen the SUCCESS verdict.

## 1. Scope, constraints, artifact policy

In scope: P0 (probe what the hook layer can actually do) and P1 (measure the C-arm baseline and explain what can be explained). Both produce evidence notes only.

Constraints, to be pasted into each dispatch:

- Allowed repo paths for P0 and P1 are new files under `docs/plans/evidence/2026-10-20-per-turn-gate/`. Everything else the work needs (throwaway hook scripts, the batch wrapper, run outputs, raw logs) lives in a scratch directory outside the repo. No script, test, hook, skill text, brief template, `CLAUDE.md`, `docs/BACKLOG.md`, or harness file in the repo is edited. A step that cannot be done without such an edit is reported BLOCKED, not worked around.
- Artifact policy, one rule for both phases: raw logs and raw hook output stay in scratch. The repo receives derived notes, short excerpts, tables, and a sums file of sha256 values of every raw file with its original path. Hook stdin and run logs can carry session identifiers, so any excerpt committed is redacted of session ids, account names, and tokens.
- Version stays 3.0.0. No version bump and no CHANGELOG entry.
- ADR-0001 stands: claims come from re-derivation (a real run, an official documentation URL, a hashed log), never from attestation or from reading source alone.
- Do not run `scripts/dispatch-hetero.sh`, `dispatch-author.sh`, or `engine-capability-state.js` by hand unless `ENGINE_CAPABILITY_DIR` is a fresh temp directory and `AUTOPILOT_STRIKE_WRITER=off`. Never set `AUTOPILOT_SESSION_ID` or `CLAUDE_CODE_SESSION_ID`.
- A phase changes the plan only through a new plan review. A dispatch that widens the allowed paths is out of contract.

Runtime identity for both phases, preregistered: the executable is the `claude` on PATH and its `--version` must print 2.1.303 (the pin of both experiments); model alias `claude-haiku-4-5`; every run uses a dedicated config directory seeded only with a copy of the existing credentials file, never the real `~/.claude`, because a child process resets the real one; the settings sources used are written down. Before P0 and before the P1 window the hand records the version output and a successful authentication probe. A wrong version or a failed probe is BLOCKED. Limitation, stated here and again in section 3.3: the new P1 batch runs in a dedicated config directory through direct harness calls, so its execution conditions differ from the historical driver C arms; labels A to D and GO are therefore never read as a same-condition replication. An authentication expiry in the middle of the P1 window makes the batch `unavailable` (label U, section 3.3); there is no mid-batch replacement or renewal. The one exception to the credentials-only config directory is the P0 Step 0 control run (section 2), which must load this plugin's hooks.

Not in this plan: any gate script, rail adapter, retry formatter, `## Gate` brief block, retry budget or state store, repair flow, owner-card flow, larger-model rerun, shadow pilot, or default decision. Their earlier designs are not carried forward as authority; the last full text is `git show ed02e7f3a:docs/plans/2026-10-20-per-turn-gate.md` and is history only.

## 2. P0 hook probe

Purpose: replace unverified readings of the hook layer with run output or an official documentation URL. `hooks.json` wires five Stop hooks (opt-in-multiplexer, cost-tracker, dirty-protected-paths, owner-question-guard, awaiting-owner) and wires only awaiting-owner on SubagentStop. Reading that file proves nothing about runtime behaviour, so no answer may rest on it alone.

Isolation, verified positively and by trace. The scratch project's settings define only the throwaway hook for Stop and SubagentStop, and every isolated run uses the dedicated config directory of section 1. Silence in the throwaway hook's log proves nothing, so two kinds of evidence are required.

Control run loading the plugin hooks. `claude --help` lists `--plugin-dir <path>` (load a plugin from a directory) on the installed binary. The control run uses a second dedicated config directory, also seeded only with the credentials copy, and passes `--plugin-dir` pointing at this plugin's checkout (read only). Whether the flag works on the pinned 2.1.303 is a Step 0 item to confirm by running it; if no mechanism loads the plugin hooks in a dedicated config directory, P0 is BLOCKED.

Execution trace. `claude --help` lists `--debug hooks` with `--debug-file <path>` and `--include-hook-events`. Every trial and both Step 0 runs capture a hook trace with them, or an equivalent execution record such as the session transcript, saved in scratch. The control run's trace must list the plugin Stop hooks executing, which proves the trace can see them. Each isolated trial's trace must show the throwaway hook as the only hook executed. If the trace is unobtainable on the pinned version, empty in the control run, or shows any plugin hook in an isolated run, P0 is BLOCKED.

Side effect, as a second check. The hand picks, from the five Stop hooks, one whose side effect is a file write outside any hook log (named in the P0 note header after reading that hook's source for the path). The control run shows the side effect; the isolated run, from a fresh state directory, does not; file listings before and after are recorded. Without an observable side effect, the trace alone decides. If any isolated run shows the side effect, P0 is BLOCKED, whatever the trace says.

Time and cost bounds. Each trial and Step 0 run is capped at 30 minutes and P0 at 4 hours; a trial at the cap is `unproduced`. Cost bound: P0 is at most 12 short sessions (Step 0 control and isolated, A0, A1, A2, B0, B1, C0, C1, plus up to 3 re-runs), each of 1 to 5 CLI result objects. Using the driver-recorded first-response cost of 0.065 to 0.099 USD only as a per-result-object ceiling, the bound is at least 9 x 1 x 0.065, about 0.6 USD, and at most 12 x 5 x 0.099, about 5.9 USD, so about 0.6 to 6 USD. It is recomputed from Step 2 of section 3 once the cost semantics are known, and P0 needs a separate owner approval with that estimate before it starts.

The throwaway hook is a script in scratch that appends the exact stdin JSON, its own exit status, and its stdout to a log file, and takes its decision from a counter file. Expected readings are written into the P0 note header and committed before any run, so the pairs are not chosen after seeing the log.

Trials, each with a matched baseline that changes only the hook's decision:

- A0 baseline: the Stop hook never blocks. Record how the session stops and how many times the hook is called.
- A1: the hook blocks call 1 and allows call 2. Record whether the tool calls the hook again, what `stop_hook_active` carries on each call, and whether the model continues after the block.
- A2: the hook blocks calls 1 and 2 with distinct reasons. Record whether the second block is honored (the model continues again with the second reason) or ignored, and any third call.
- B0 baseline: counter file at zero, so the hook never blocks. B1: counter N=2. Record exactly how many blocks occur before the stop is allowed.
- C0 baseline: a scratch subagent with a SubagentStop hook that never blocks. C1: the hook blocks once. Record whether the subagent continues.

Completion labels are assigned per trial, not per question: `produced` (run output excerpted and hashed), `documented` (official URL cited), or `unproduced` (with the reason). The note records the exact hook stdout, exit status, stdin fields, and transcript outcome for each trial, as excerpts.

Consequences, fixed now: if C1 is `unproduced` or shows no continuation, a SubagentStop adapter is dropped from any later plan. A1 and A2 decide whether a Stop-hook adapter can re-enter more than once; B1 decides whether a file counter can bound it. Negative or unproduced A1 or B1 means a Stop-hook adapter is not available (section 3.5).

## 3. P1 baseline measurement

Purpose: say what is known about the C-arm M2 drop from re-derivable evidence, and measure the C-arm baseline again so a later design can size itself. P1 makes no causal claim beyond the labels of section 3.4.

Step 1, copy and hash the data. Locate the session scratch for both experiments. For every run of both C arms copy into a scratch directory `results.jsonl` (once per experiment) and each run's `oracle.log`, `run.log`, and `result.json`, and write a sums file (path, sha256) into the evidence directory. Sources of record: `oracle.log` for scoring (M1, M2, M3, per-feature results), `result.json` for harness duration and turns completed, `run.log` for the CLI result objects (cost fields, resolved model id when present). If a file is missing, the note says so and no cause is named from data that was not copied. The copied `run.log` files are checked for invocation lines and loaded-settings evidence; if they carry none, that evidence is `unavailable` and is not assumed equal.

Step 2, derive the cost accounting. From the copied logs and the CLI's documentation only (no measured call before the preregistration commit, Step 3), establish whether `total_cost_usd` is cumulative across the CLI result objects of a run, then compute a cost estimate for the 30-run batch and write it into the preregistration; if the semantics stay unresolved, the estimate uses the larger of the two readings. The hand does not launch the batch until the estimate is in the preregistration note and the owner has acknowledged it (otherwise BLOCKED).

Step 3, preregister before any new outcome. Write a preregistration note into the evidence directory and commit it. It fixes: the run manifest and wrapper (section 3.2), the metrics (3.1), the validity checklist and labels (3.3), the observation-to-label function of every candidate (3.4), and the cost estimate. The commit must be earlier than the first measurement call. The wrapper verifies this itself and refuses to start otherwise: it requires the preregistration file to be tracked and unmodified in `git status`, records `git log -1 --format=%H%n%cI` of that commit, and appends a start timestamp to its invocation log before each call; the verdict note repeats the check by comparing the commit time with the first invocation timestamp and by `git merge-base --is-ancestor <prereg commit> HEAD`. New outcomes are not read until that commit exists.

Step 4, run the batch. Step 5, fill the tables and write the verdict.

### 3.1 Metrics

For every run in the two earlier C arms and the new batch: M1, M2, M3 with the experiment-report definitions, from `oracle.log`; per-feature results for features 1 to 5; constraint 1 and 2 results; harness duration and turns completed from `result.json`; the CLI result objects from `run.log` (cost fields, resolved model id when present). The per-feature, constraint, and half-schedule tabulations (runs 1 to 15 against 16 to 30 of a batch, in run-id order) are supplementary observations, reported without causal labels.

### 3.2 Sample, procedure, window

The batch is 30 C-only observe runs with preallocated ids C-01 to C-30, run sequentially in one continuous window of at most 8 hours. The existing batch driver `evals/orchestration/run-t14-gate-batch.js` must not be used: it always schedules a G enforce run beside each C run and reruns incomplete ids, which breaks both C-only and no-replacement. The procedure is driver-free: 30 invocations of `evals/orchestration/run-orchestration-eval.sh` issued from a wrapper in scratch, each with exactly the arguments `runOne()` in the driver passes for a C run: `--task t14-constraint-horizon --arm off --runner cc --model claude-haiku-4-5 --out <run dir> --gate observe`. The driver passes no turn-count or scoring flag; those are the harness defaults, which the preregistration records by reading the pinned harness. The preregistration states this provenance. If the harness cannot be invoked that way without editing it, the hand reports BLOCKED.

The preregistration note commits, before collection: the 30 ids with their output directories; the exact command per id; the CLI version output and authentication probe; the task hash listing, produced by running inside `evals/orchestration/tasks/t14-constraint-horizon` the command `find . -type f | LC_ALL=C sort | while read -r f; do printf '%s  %s\n' "$(git hash-object "$f")" "$f"; done`, which covers every file under the task directory as the driver's `frozenHashes()` does. The check is `diff` between the listing taken before the first call, the listing taken after the last call, and the `frozen` map in the experiment-2 batch header copied in Step 1 (relative paths and hashes, same file set); any difference makes the batch U. The wrapper invokes each id exactly once, refuses an existing output directory, never issues a second attempt, and logs every invocation before it starts. Observe mode means no retry text is ever sent. No run is replaced: a run that does not complete five turns is kept as an `incomplete` row, scored by the oracle on the repo as left.

### 3.3 Validity, labels, decision rules

The batch is valid only if all of these hold, and any failure makes it `unavailable` (label U, with the failed items listed): all 30 ids were launched exactly once, in the preregistered order, sequentially, inside one window of at most 8 hours; the task hashes equal the preregistered ones; the CLI version was 2.1.303 for every run; the authentication probe passed and no expiry occurred; no deviation from the preregistered command occurred; every launched run has a recoverable oracle score in its `oracle.log` (a run with none is `invalid` and makes the batch U, because M2 cannot be counted); and at least 27 of the 30 runs completed five turns. If resolved model ids appear in the new batch's logs, they must be a single value across its runs, otherwise the batch is U; if they are absent, the batch stays valid. The new batch provides no observation for candidate 1; its label is decided only by row 1 of section 3.4.

For a valid batch, n is 30, every launched run counts, and `incomplete` rows enter the counts with their oracle-on-repo-as-left scores. M2_3 is M2 over those 30. "Not rejected" against an earlier batch means a two-sided Fisher exact test of M2_3/30 against that batch's count (23/30 for the first, 11/29 for the second) gives p above 0.05; "rejected" means p at or below 0.05. Exactly one label is assigned:

- A: rejected against 23/30, not rejected against 11/29.
- B: not rejected against 23/30, rejected against 11/29.
- C: not rejected against either.
- D: rejected against both.
- U: the batch is not valid.

The new batch uses a dedicated config directory and direct harness calls, the historical C arms used the driver, so a label is a numeric compatibility label, not a same-condition replication, and diagnoses nothing. The batch is reproduction evidence only: it excludes no candidate cause by itself and is not a controlled comparison.

### 3.4 Candidate causes: observation-to-label function

Each candidate gets exactly one of four labels, assigned by the rule stated here and written into the preregistration. `consistent`: the observation fits the candidate. `excludes`: the observation rules the candidate out. `unresolved`: the observation neither fits nor rules out. `unavailable`: the observation cannot be obtained. The table is complete when every row has a label and every item was either run or recorded unavailable; any row may end `unresolved`.

Eight rows follow.

1. Alias served a different snapshot. Ids present in both copied batches and different: consistent. Present and identical: unresolved (an identical id cannot rule out a backend change). Absent: unavailable. Never excludes.
2. Provider-side variance by time of day. Always unresolved; the observation (new batch start time against the two earlier windows, 02:48Z to 09:30Z and a start at 12:19Z on 2026-10-19) is recorded. Never excludes.
3. Plain sampling variance. Label C: consistent. Labels A, B, D: unresolved. U: unavailable. Never excludes.
4. A harness side effect in observe mode. Read the diff `6d9b22427..a93e98299`. A change on the observe path: consistent. No change on the observe path: unresolved (a diff read cannot rule out timing effects). The diff cannot be read: unavailable. Old-harness runs are not part of this plan.
5. Auth-state differences, including the OAuth expiry in C-16 attempt 1. The copied logs show an authentication error in the second batch before that attempt, or the run-order position of export and footer failures puts a majority of them after it: consistent. Neither: unresolved. Logs missing: unavailable. Never excludes.
6. CLI settings or tool permissions differing. The historical invocation lines and loaded-settings evidence are `unavailable` (they were not logged); the label for this row is therefore `unavailable` unless the copied logs turn out to carry them, in which case: differ means consistent, same means unresolved.
7. Task-state leakage. Every run's work-directory listing at turn 1 is recoverable from the logs and equals the seeded files: excludes. A non-seeded file at turn 1 in any run: consistent. Listing not recoverable: unavailable.

8. Export and footer failures both rose. This is a symptom that several of the candidates above would produce, not a separate cause, so its label is `unresolved` by rule, whatever the data show; the per-feature export and footer columns of both earlier batches and the new batch (3.1) are reported beside the row.

### 3.5 What P1 hands to the next decision

P1 ends with a note stating the label A to D or U, the two tables, the P0 trial labels, the measured batch cost and duration, and a recommendation GO or HOLD to write a plan for later phases. GO needs all of: A1 and B1 each `produced` or `documented` and affirmative (the hook re-enters after a block and a file counter bounds the blocks at N), P0 run on CLI 2.1.303, and a valid batch with its measured M2_3. The label A to D is a numeric compatibility label against two batches run under different conditions (3.3); GO does not depend on it, and D is reported, not a HOLD by itself. C1 may be unproduced or negative, which only drops the SubagentStop adapter. HOLD otherwise, including label U and any unproduced or negative A1 or B1; a negative P0 result is itself a finding the owner may act on. The recommendation is advice; the owner decides, and any later plan gets its own review.

## 4. Later phases and the questions P1 must answer for them

Later phases (a verifier script, a dispatch-rail adapter, a batch-driver rework, a larger-model rerun, a shadow pilot on real lanes, a default decision) are written only after P1 data exists, each as its own plan with its own plan review. Nothing about their design is fixed here. P0 and P1 must leave these questions answered or marked unanswered: which hook points are viable (A1, A2, B1, C1); the measured M2_3 and its label on this task and host, so a later comparison can be sized without guessing; whether the resolved model id is recorded in the raw logs and is stable; what a complete C run costs and how long it takes (Step 2 and the measured batch); and which causes of the anomaly stay unresolved, so a later plan does not cite one it does not have. Questions about a gate's own design belong to the later plan.

## 5. Review history

Six plan-review generations over three rounds reviewed the earlier, larger plan (a verifier, a rail adapter, a larger-model rerun, a shadow pilot, and a default decision). Each ended CONDITIONAL; blockers clustered on retry-budget bookkeeping and the larger-model rerun's rule and arms. Those designs rested on a baseline that had not yet been measured, which is why this plan stops at P0 and P1. Artifacts (history only, removed from the tree so this review reads blind; all present at commit `ed02e7f3a` under `docs/plans/`, except the middle round): round `per-turn-gate-2026-10-20`, files `2026-10-20-per-turn-gate.{g1,g2}-artifact.json` and `.{g1,g2}-dispositions.json`; round `per-turn-gate-2026-10-23-perturnreview`, g1, g2 and dispositions only at commit `91023e419` (`git show 91023e419 --stat` lists `2026-10-23-per-turn-gate.perturnreview.*`); round `per-turn-gate-2026-10-23-perturnreview-v2`, files `2026-10-23-per-turn-gate.perturnreview-v2.{g1-artifact,g1-dispositions,g2-artifact}.json`. The v3 round ended CONDITIONAL at the generation cap (25 and 14 findings); depth-0 adjudicated on 2026-10-23 that its 7 blocking g2 findings are fixed here without further review.

## Review log

R0 (2026-10-20): authored by foreman lane bl55plan from the two t14 reports.

R1 and R2 (2026-10-20): round `per-turn-gate-2026-10-20`, g1 and g2, both CONDITIONAL. R3 and R4 (2026-10-23): round `per-turn-gate-2026-10-23-perturnreview`, g1 and g2, both CONDITIONAL. R5 and R6 (2026-10-23): round `per-turn-gate-2026-10-23-perturnreview-v2`, g1 and g2, both CONDITIONAL.

R7 (2026-10-23): narrowed to P0 and P1 by owner decision d-b8606fdd; round `per-turn-gate-2026-10-23-p0p1-v3`: g1 CONDITIONAL (25 findings, one STOP), g2 CONDITIONAL and terminal (14 findings, two STOP).

R8 (2026-10-23): depth-0 adjudication of round v3 at the generation cap, no further review: the 7 blocking g2 findings are fixed (positive isolation proof, oracle score required for validity, different-conditions limitation, the harness arguments the driver passes, the eighth candidate, preregistration ordering, executable task-hash command), with the wall-time, invocation-line and P0 cap fixes. A later code review added: the Step 0 control-run mechanism, an execution trace for isolation, GO independent of the A to D label, and candidate 1 decided by row 1 only.
