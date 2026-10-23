# Plan — per-turn gate (BL-0055): hook probe (P0) and baseline measurement (P1)

> Status: draft 2026-10-20, narrowed 2026-10-23 to P0 and P1 only; hetero plan review round `per-turn-gate-2026-10-23-p0p1-v3` is open; nothing dispatched

## 0. Thesis and evidence

BL-0055 asked whether a per-turn check that talks back to the model can hold stated rules without trading away features. Two frozen batches on one task answered that for a haiku alias. Owner decision d-9f311d27 (2026-10-20) was to write a plan, not to ship a default. Four plan-review generations on the earlier, larger plan did not converge (section 5), and owner decision d-b8606fdd (2026-10-23) narrowed the plan to the two phases whose results every later design depends on. Phases beyond P1 are not designed here (section 4).

Experiment 1 (`docs/projects/_archive/2026/10/2026-10-19-t14-gate-batch/report.md`, plan `docs/plans/2026-10-19-t14-per-turn-gate-experiment.md`): model alias `claude-haiku-4-5`, task `t14-constraint-horizon`, n=30 per arm, verdict FAIL-TRADE. M1 constraints held C 1/30, G 29/30; M2 features built C 23/30, G 17/30; M3 both C 1/30, G 16/30. The retry text named violations only. Seven retried G runs kept a missing export to the end.

Experiment 2 (`report-r2.md` in the same directory, plan `docs/plans/2026-10-19-t14-gate-round2.md`): the intended treatment change is the retry message, which also lists feature gaps and ends with a keep-what-works line. Verdict SUCCESS. M1 C 5/29, G 28/29 (Fisher p 1.99e-10); M2 C 11/29, G 27/29; M3 C 0/29, G 26/29. 28 mechanism runs, 43 G retries, four G runs exhausted retries (G-04, G-26, G-28, G-30). Other harness changes between the two batches (feedback flag, snapshot copy, analyzer, batch driver option) and unrecorded runtime differences exist, so the cross-batch difference is not attributed to the feedback text alone. Both experiments used Claude Code CLI 2.1.303, alias `claude-haiku-4-5`, one task, and a retry cap of 2. The reports' caveat stands: the result must not be extrapolated. The second experiment had two infra failures, G-15 attempt 1 runner_timeout (641 s) and C-16 attempt 1 runner_error (335 s, OAuth session expired mid-run), neither re-run.

Numbers this plan may repeat, and no others: the counts above; C-arm mean duration 292 s (first) versus 269 s (second); C-arm mean cost 0.0764 versus 0.0737 USD; cost band about 0.065 to 0.099 USD per haiku run; wall time 6.5 to 7.5 hours for 30 pairs; harness commits compared `6d9b22427` and `a93e98299`.

Open anomaly: the C arm M2 fell from 23/30 in the first experiment to 11/29 in the second. What the two batches are known to share is the task, the nominal alias, and the CLI pin. The model id actually served, the settings actually loaded, and the invocation flags were not recorded, so they are P1 evidence, not facts. `report-r2.md` says no cause was analysed. The drop is data to explain, not a reason to reopen the SUCCESS verdict. It also matters for any later design: an unexplained baseline makes a later comparison hard to size.

## 1. Scope, constraints, and what this plan does not do

In scope: P0 (probe what the hook layer can actually do) and P1 (measure the C-arm baseline and explain what can be explained). Both produce evidence notes only.

Constraints, to be pasted into each dispatch:

- Allowed paths for P0 and P1 are new files under `docs/plans/evidence/2026-10-20-per-turn-gate/` and scratch outside the repo. No script, test, hook, skill text, brief template, `CLAUDE.md`, `docs/BACKLOG.md`, or harness file is edited. A step that cannot be done without such an edit is reported BLOCKED, not worked around.
- Version stays 3.0.0. No version bump and no CHANGELOG entry.
- ADR-0001 stands: claims come from re-derivation (a real run, an official documentation URL, a copied log with its hash), never from attestation or from reading source alone.
- Nothing here makes any gate default-on or builds any gate. Raw logs are copied with a recorded sha256; the plan commits no raw session scratch other than what section 3 names.
- Do not run `scripts/dispatch-hetero.sh`, `dispatch-author.sh`, or `engine-capability-state.js` by hand unless `ENGINE_CAPABILITY_DIR` is a fresh temp directory and `AUTOPILOT_STRIKE_WRITER=off`. Never set `AUTOPILOT_SESSION_ID` or `CLAUDE_CODE_SESSION_ID`.
- A phase changes the plan only through a new plan review. A dispatch that widens the allowed paths is out of contract.

Not in this plan: any gate script, rail adapter, retry formatter, `## Gate` brief block, lineage or retry budget, depth-0 repair path, owner-card flow, larger-model rerun, shadow pilot, or default decision. Their earlier designs are not carried forward as authority; the last full text is `git show ed02e7f3a:docs/plans/2026-10-20-per-turn-gate.md` and is history only.

## 2. P0 hook probe

Purpose: replace three unverified readings of the hook layer with run output or an official documentation URL. Today `hooks.json` wires Stop hooks (opt-in-multiplexer, cost-tracker, dirty-protected-paths, owner-question-guard, awaiting-owner) and wires only awaiting-owner on SubagentStop. Reading that file proves nothing about runtime behaviour, so no claim below may rest on it alone.

Questions:

- A. When a Stop hook returns a block decision, does the tool call the hook again, and does the second call carry `stop_hook_active` true? Is a second block honored or ignored when it is true?
- B. Can a per-session counter kept in a file make the hook block exactly N times and allow the stop on call N+1?
- C. Does a SubagentStop hook block force the subagent to continue?

Procedure: a scratch session outside the repo (a temporary directory with its own project settings, not an operator lane), with a throwaway hook script written under that directory that logs its stdin JSON to a file and returns its decision from a counter file. For A, make the hook return a block on the first call and record how many times it is invoked and what `stop_hook_active` carries each time. For B, set N=2 and record the three outcomes. For C, run a scratch subagent with a SubagentStop hook that blocks once and record whether the subagent continues. Paste the transcripts and the hook log under the evidence directory.

Completion: each of A, B, C has an answer labelled `produced` (run output pasted), `documented` (official URL cited), or `unproduced` (with the reason). A claim backed only by reading `hooks.json` or hook source is not an answer.

Negative control: for each question, the opposite reading is stated before the run, and the note shows which of the two the output supports. If the output contradicts the expected reading, that is written down as the finding.

Consequence, fixed now: if C is `unproduced` or shows no continuation, a SubagentStop adapter is dropped from any later plan. The answers to A and B decide whether a Stop-hook adapter is feasible at all.

## 3. P1 baseline measurement

Purpose: say what is known about the C-arm M2 drop, using only evidence that can be re-derived, and measure the C-arm baseline again so that a later design can size itself. P1 makes no causal claim that the table below has not separated into "consistent with" and "excludes".

Step 1, copy the data. Locate the session scratch for both experiments and copy `results.jsonl`, and every per-run `oracle.log` and `run.log`, into `docs/plans/evidence/2026-10-20-per-turn-gate/`, recording the sha256 of each copied file in a sums file. If a file cannot be found or copied, say so in the note; no cause is named from data that was not copied.

Step 2, preregister, before collecting any new outcome. Write a preregistration note to the evidence directory and commit it; it fixes: the metrics (section 3.1), the sample and window (section 3.2), the decision rules (section 3.3), and the checklist of non-controlled checks (section 3.4). Outcomes of the third batch are not read until that note exists.

Step 3, run the third baseline batch. Step 4, fill the table and write the verdict.

### 3.1 Metrics

For every run in the two earlier C arms and the new batch, from the raw `oracle.log` (not from a driver row): M1 (constraints held), M2 (features built), M3 (both), per-feature results for features 1 to 5 with export and footer reported separately, constraint 1 and 2 failures, mean duration and cost, and, where the raw logs carry them, the resolved model id and the invocation line with its settings flags. The earlier definitions of M1, M2, M3 are the ones in the experiment reports.

### 3.2 Sample and window

A fresh C-only observe batch: 30 runs, same task bytes (the experiment-2 pins: `oracle.sh`, `CONSTRAINTS.md`, `turns/`, `task.md`, `repo/` byte-identical, `git hash-object` recorded), same alias, same CLI pin 2.1.303, observe mode so no retry text is ever sent, run sequentially in one continuous window of at most 8 hours, starting from a fresh authentication state. The per-run command is the harness invocation the earlier `run.log` files show; the hand copies those invocation lines and reuses them, and changes the harness or the batch driver not at all. If the batch cannot be run without a harness edit, the hand reports BLOCKED. Expected cost from the numbers in section 0: about 30 runs at roughly 270 to 290 s each (about 2.5 hours) and about 2.3 USD.

No run is replaced. A run that does not complete five turns is kept as an `incomplete` row and scored by the oracle on the repo as left. The batch is valid when at least 27 of 30 runs completed five turns on the pinned CLI version and one resolved model id (when the logs carry it); otherwise the batch is `unavailable`, which is reported as such and is not an inconclusive result.

### 3.3 Decision rules, fixed now

Let M2_3 be M2 of the new batch over its n runs. "Consistent with" an earlier batch means a two-sided Fisher exact test on M2 against that batch's count (23/30 for the first, 11/29 for the second) gives p above 0.05; "inconsistent" means p at or below 0.05. Exactly one of the following labels is assigned, from the table:

- A, near the second batch: consistent with 11/29, inconsistent with 23/30. Reading: the first experiment's C arm looks like the outlier. Only reproduction evidence.
- B, near the first batch: consistent with 23/30, inconsistent with 11/29. Reading: something about the second window or the observe path stays open.
- C, between: consistent with both. Reading: the M2 baseline is unstable at this sample; a later design must assume a wide spread.
- D, outside both: inconsistent with both. Reading: the instrument itself is unstable; no later phase is planned until that is investigated.
- U, batch `unavailable`.

The third batch is reproduction evidence only. It excludes no candidate cause by itself, and it is not a controlled comparison.

### 3.4 Candidate causes and the table

The table has one row per candidate. Each row records, for the listed observation, one of three labels: consistent with the candidate, excludes the candidate, or unresolved. A check that cannot be run is recorded `unavailable` with its reason, which differs from `unresolved`. Any candidate may end unresolved; the table is complete when every row has a label and every checklist item below was either run or recorded unavailable.

1. The alias resolved to a different snapshot or was served differently between the two windows. Observation: the resolved model id in the copied logs. If one id appears in both, that is consistent with a shared snapshot and does not exclude the candidate; if the field is absent or differs, record that.
2. Provider-side variance or load by time of day. Observation: the new batch's start time against the two earlier windows (02:48Z to 09:30Z and a start at 12:19Z on 2026-10-19). Agreement or disagreement is reproduction evidence only.
3. Plain sampling variance. Observation: the label A to D of section 3.3 against the counts in section 0. The comparison and thresholds are the ones fixed above, not chosen after the data.
4. A harness side effect in observe mode. Observation: read the diff `6d9b22427..a93e98299` for any change on the observe path, and, if that read leaves it open, run a few C runs on the old harness commit. A diff with no observe-path change is consistent with no side effect and does not exclude the candidate.
5. Scratch HOME or auth-state differences, including the OAuth expiry in C-16 attempt 1. Observation: whether the run logs show an auth error before that attempt and whether export and footer failures cluster after it. The new batch starts from a fresh authentication state.
6. CLI settings or project settings loaded differently, or tool permissions differing. Observation: the invocation lines and the settings files actually loaded, copied from `run.log`, not assumed to match.
7. Task-state leakage, such as stale artifacts in the shared task-repo copy. Observation: each run's work directory is created empty, and no file present at turn 1 that the task did not seed.
8. Export and footer failures both rose (export 5/30 to 10/29, footer 2/30 to 9/29). Observation: the per-feature columns of the new batch. If both move together again this describes the symptom, not yet a cause.

Constraints 1 and 2 moved the other way (failed in 29 of 30 C runs, then 24 of 29), so a cause that predicts "the model got uniformly worse" must account for that column. The table includes it. Mean duration and cost barely moved, which excludes nothing by itself. Half-schedule M2 (11/15 then 12/15, versus 7/15 then 4/14) is also tabulated; it is not turned into a turn-5-only claim without the per-turn rows.

### 3.5 What P1 hands to the next decision

P1 ends with a note that states the labels A to D or U, the table, the P0 answers, and a recommendation of GO or HOLD to write a plan for later phases. GO needs: P0 complete, a valid batch, and label A, B, or C. HOLD otherwise. The recommendation is advice; the owner decides, and any later plan gets its own review.

## 4. Later phases and the questions P1 must answer for them

Later phases (a verifier script, a dispatch-rail adapter, a batch-driver rework, a larger-model rerun, a shadow pilot on real lanes, a default decision) are written only after P1 data exists, each as its own plan with its own plan review. Nothing about their design is fixed here. P0 and P1 must leave these questions answered or marked unanswered:

- Which hook points are viable (P0 A, B, C)?
- How wide is the C-arm M2 spread on this task and host (P1 label), so a later comparison can be sized without guessing?
- Is the resolved model id recorded in the raw logs, and is it stable across the batches?
- Does the observe path perturb timing or results (candidate 4)?
- What does a C run cost and how long does it take on this host (section 3.2 against the measured values)?
- Which causes of the anomaly stay unresolved, so a later plan does not cite one it does not have?

Questions about a gate's own design (retry budget, state storage, repair flow, which brief commands exist) are for the later plan.

## 5. Review history

Four plan-review generations over three rounds reviewed the earlier, larger plan (a verifier, a rail adapter, a larger-model rerun, a shadow pilot, and a default decision). Each ended CONDITIONAL with blockers that moved around the same cluster: lineage and retry-budget bookkeeping, the rule for the larger-model rerun, and the arm structure of that rerun. The designs of those phases rested on a baseline that had not yet been measured, which is why this plan stops at P0 and P1. Artifacts (history only, removed from the tree so this review reads blind; all present at commit `ed02e7f3a` under `docs/plans/`): round `per-turn-gate-2026-10-20`, files `2026-10-20-per-turn-gate.{g1,g2}-artifact.json` and `.{g1,g2}-dispositions.json`; round `per-turn-gate-2026-10-23-perturnreview`, g1, g2 and dispositions, in git history only (`git show 91023e419 --stat` lists `2026-10-23-per-turn-gate.perturnreview.*`); round `per-turn-gate-2026-10-23-perturnreview-v2`, files `2026-10-23-per-turn-gate.perturnreview-v2.{g1-artifact,g1-dispositions,g2-artifact}.json`. Facts from those rounds that still apply here are folded into sections 2 and 3, including the correction that `scripts/check-repair-scope.js` is called from `src/engine/` and not from `scripts/dispatch-hetero.sh`, which calls `scripts/check-hands-commit.js` (around line 4328).

## Review log

R0 (2026-10-20): authored by foreman lane bl55plan from the two t14 reports.

R1 to R6 (2026-10-20 to 2026-10-23): the three earlier rounds above; all CONDITIONAL, none passed.

R7 (2026-10-23): narrowed to P0 and P1 by owner decision d-b8606fdd; new logical plan id `per-turn-gate-2026-10-23-p0p1-v3`; generation 1 open, maximum two generations.
