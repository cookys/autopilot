# P1 rerun result: valid batch, label A, recommendation GO (BL-0055)

Replaces the invalid first batch (docs/plans/evidence/2026-10-24-per-turn-gate-p1/). Preregistration commit 55f5853c6532c72077836b568faa9f45f63e8fc3 (2026-10-24T03:08:04+08:00 = 19:08:04Z); first wrapper start 19:08:10Z, first START 19:08:15Z; the commit is an ancestor of HEAD (git merge-base --is-ancestor passed).

## Validity (section 3.3): VALID

All 30 ids launched exactly once in order, sequentially (30 PROBE_OK and 30 START lines, no PROBE_FAIL, STOP, REFUSE or ABORT). Window 19:08:15Z to 21:44:29Z, about 2.6 hours (limit 8). Task hashes after the last call equal the preregistered listing (diff empty). CLI 2.1.309 in all 30 result.json files. All 30 authentication probes passed; no run ended in an authentication error (no is_error result object in any run.log). No deviation from the preregistered command. All 30 runs have an oracle score. 29 of 30 completed five turns (needs 27): C-30 timed out at 716 s after 3 turns (failure_class infra_fail, runner_timeout; no authentication error in its log); it is counted with the oracle score on the repo as left. Resolved model id in the logs: a single value (claude-haiku-4-5) in every run.

## Measured values

M1 6/30, M2 13/30, M3 0/30. Recomputed three ways and equal: analyze-p1.js method A (JSON parse of the first oracle.log object), method B (text match on the two *_pass lines) and a plain grep count of "features_pass": true (13) and "constraints_pass": true (6); M3 equals M1 and M2 for every row (checked in the script). **M2_3 = 13/30.**

Two-sided Fisher exact tests, 0.05: against 23/30 (first experiment) p = 0.0169, rejected. Against 11/29 (second experiment) p = 0.7925, not rejected (11/30 gives the same value). **Label A** (numeric compatibility label only; the batch used a dedicated config directory and direct harness calls, so it is not a same-condition replication).

Per-feature pass counts (features 1 to 5; feature 2 is export, feature 5 is the footer), rerun / first experiment / second experiment (C arms): 30,22,30,30,20 / 30,25,30,30,28 / 30,20,30,30,20. Half schedule M2: first 15 ids 5, last 15 ids 8.

## Candidate table (section 3.4)

1. Alias snapshot: unresolved (resolved id identical, claude-haiku-4-5, in both historical batches and here).
2. Time of day: unresolved (rerun window 19:08Z to 21:44Z on 2026-10-23; earlier windows 02:48Z to 09:30Z and from 12:19Z on 2026-10-19).
3. Sampling variance: unresolved (label A).
4. Harness side effect: consistent. The diff 6d9b22427..a93e98299 changes run-orchestration-eval.sh on the gate path that observe mode executes (apply_gate and the new reportable predicate). It does not show a retry in observe mode. Per the rule, a change on the observe path is consistent.
5. Auth state: consistent, with a disclosure. The only authentication error in the copied second batch is C-16 attempt 1 itself, not one before it. The position test: of the 20 export (feature 2) plus footer (feature 5) failures among the second-batch C rows, 12 start at or after C-16 attempt 1 (export 5 of 10, footer 7 of 10), a majority of the pooled set. Read per feature, export alone is exactly half, so the pooled reading is the one that makes this row consistent; the rule text does not say which reading.
6. CLI settings: unavailable (no invocation lines or loaded-settings evidence in the copied logs).
7. Task-state leakage: unavailable (turn 1 work-directory listings are not recoverable from the logs).
8. Export and footer failures both rose: unresolved by rule; columns above.

## Decision (section 3.5)

GO conditions: P0 A1 and B1 affirmative on 2.1.309 (docs/plans/evidence/2026-10-23-per-turn-gate-p0/), valid P1 batch with measured M2_3 = 13/30. Met. The label does not decide GO. **Recommendation: GO** (advice; the owner decides).

## Cost

Runs (last result object each): 15.7299 USD. 30 authentication probes: 0.5007 USD. Total 16.2306 USD, under the 18 USD cap (never reached the stop rule; lowest headroom was before the final id at projected 16.59). Cumulative run time 9240 s.

## Files

preregistration.md, p1-wrapper.sh (no scratch path), taskhash.pre.txt, invocation.log (only transformation: scratch path to <scratch>; none occurred), costs.tsv, probes.tsv, results-table.tsv, analyze-p1.js, sums-p1.txt. Raw logs stay in scratch.
