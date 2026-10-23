# P1 rerun result: adopted by owner decision after an accepted deviation (not a rule-valid batch), recommendation GO (BL-0055)

Replaces the invalid first batch (docs/plans/evidence/2026-10-24-per-turn-gate-p1/). Preregistration commit 55f5853c6532c72077836b568faa9f45f63e8fc3 (2026-10-24T03:08:04+08:00 = 2026-10-23T19:08:04Z); wrapper started 19:08:10Z, first START 19:08:15Z, so the commit time is earlier than the first call. History note, two histories: (1) the original history, branch hands/p1rerun/1: 55f5853c6 is an ancestor of HEAD (git merge-base --is-ancestor 55f5853c6 HEAD returns 0) and of refs/evidence/bl0055-p1rerun in the main repo, which points at the result commit 6a8179431. (2) The integration branch, where the same commits were cherry-picked (preregistration as cdd946243): there 55f5853c6 is not an ancestor, but the preregistration file is identical, blob 7438131e44847ecc7f5776f13b19de974dc9f0e5 in both, and the wrapper blob is 001a605d1b7e3ecce00701860b0cebc869186b51 in both.

## Validity (section 3.3): cannot be judged valid
Checklist, item by item, against the preregistered section 3.3 (evidence follows in the paragraph below):

| Item | Status |
|---|---|
| All 30 ids launched exactly once, in order, sequentially, within 8 hours | met (invocation.log; 2.6 hours) |
| Task hashes equal the preregistered ones | **NOT MET (not measured at the time)**: the wrapper compared once before the first call and saved nothing after the last call |
| CLI 2.1.309 for every run | met (30 result.json files) |
| Authentication probe passed, no expiry occurred | met (30 probes; no run ended in an authentication error) |
| No deviation from the preregistered command | met |
| Every launched run has a recoverable oracle score | met (30 of 30) |
| At least 27 of 30 runs completed five turns | met (29; C-30 runner_timeout after 3 turns) |
| Resolved model ids a single value | met (claude-haiku-4-5 in every run) |

Under the preregistration, one unmet item means the batch cannot be judged valid. No intermediate label is introduced here.


All 30 ids launched exactly once in order, sequentially (30 PROBE_OK and 30 START lines in invocation.log, no PROBE_FAIL, STOP, REFUSE or ABORT). Provenance of invocation.log: it was written by the pinned wrapper itself (sha256 3654620b37e9d3d687bcbdf2b398df1b2681779710cd02c11b325aa47fe65380 for p1-wrapper.sh, identical to the file committed in the preregistration); the committed copy is byte-identical to the scratch original (cmp, sha256 192bc27bb75aef880208b84873e9967ff95fdb254d110b22d353bd0f7606465f); no rewriting, reordering or merging was applied. Timestamp format: the host date is uutils coreutils 0.8.0, which ignores the width in %3N and prints the nanosecond count as an unpadded integer, so a fraction shows 6 to 9 digits, depending on how many leading zeros are dropped and a leading zero is dropped (a fraction of 0.099399865 s prints as .99399865). Reproduced here: 400 calls of the wrapper ts() format gave 364 nine-digit, 32 eight-digit and 4 seven-digit fractions (an independent acceptance run also saw a six-digit one). Read with the leading zeros restored, all 92 timestamped lines are in non-decreasing order; read as plain decimals, one line is out of order. That explains C-05: PROBE_OK 02.99399865 means 02.099399865, which is before START 02.106968393 (7.6 ms); the apparent 0.887 s inversion is an artifact of the format. The ordering of the lines in the file is also what the wrapper appended. Window 19:08:15Z to 21:44:29Z, about 2.6 hours (limit 8). Task hashes: the wrapper compared the listing with the preregistered one once, before the first call (equal); it saved no comparison after the last call, so a comparison at the end of the batch was **not measured at the time**. Post-hoc substitute, taken after the batch (about 21:55Z): the listing recomputed from the task directory equals taskhash.pre.txt (diff empty); no file in the task directory has a modification time later than 19:08Z on 2026-10-23 (the start of the window); git shows no change to the directory since 2026-10-19 and a clean status. This bounds a change inside the window but is weaker evidence than a comparison at the last call; this does not satisfy the preregistered item: a modify-and-restore inside the window cannot be excluded, so the item is **not met**. CLI 2.1.309 in all 30 result.json files. All 30 authentication probes passed; no run ended in an authentication error (no is_error result object in any run.log). No deviation from the preregistered command. All 30 runs have an oracle score. 29 of 30 completed five turns (needs 27): C-30 timed out at 716 s after 3 turns (failure_class infra_fail, runner_timeout; no authentication error in its log); it is counted with the oracle score on the repo as left. Resolved model id in the logs: a single value (claude-haiku-4-5) in every run.

## Measured values (adopted by owner decision d-baf11c30, see Owner decision)

M1 6/30, M2 13/30, M3 0/30. Recomputed three ways and equal: analyze-p1.js method A (JSON parse of the first oracle.log object), method B (text match on the two *_pass lines) and a plain grep count of "features_pass": true (13) and "constraints_pass": true (6); M3 equals M1 and M2 for every row (checked in the script). **M2_3 = 13/30.**

Two-sided Fisher exact tests, 0.05: against 23/30 (first experiment) p = 0.0169, rejected. Against 11/29 (second experiment) p = 0.7925, not rejected (11/30 gives the same value). Label A, label A rests on the owner's acceptance of the deviation (d-baf11c30), not on a section 3.3 validity judgement (numeric compatibility label only; the batch used a dedicated config directory and direct harness calls, so it is not a same-condition replication).

Per-feature pass counts (features 1 to 5; feature 2 is export, feature 5 is the footer), rerun / first experiment / second experiment (C arms): 30,22,30,30,20 / 30,25,30,30,28 / 30,20,30,30,20. Half schedule M2: first 15 ids 5, last 15 ids 8.

## Candidate table (section 3.4)

1. Alias snapshot: unresolved (resolved id identical, claude-haiku-4-5, in both historical batches and here).
2. Time of day: unresolved (rerun window 19:08Z to 21:44Z on 2026-10-23; earlier windows 02:48Z to 09:30Z and from 12:19Z on 2026-10-19).
3. Sampling variance: unresolved (label A; label A rests on the owner's acceptance of the deviation (d-baf11c30), not on a section 3.3 validity judgement; under section 3.3 alone the batch is not valid and this row would read U: unavailable).
4. Harness side effect: consistent. The diff 6d9b22427..a93e98299 changes run-orchestration-eval.sh on the gate path that observe mode executes (apply_gate and the new reportable predicate). It does not show a retry in observe mode. Per the rule, a change on the observe path is consistent.
5. Auth state: consistent, with a disclosure. The only authentication error in the copied second batch is C-16 attempt 1 itself, not one before it. The position test: of the 20 export (feature 2) plus footer (feature 5) failures among the second-batch C rows, 12 start at or after C-16 attempt 1 (export 5 of 10, footer 7 of 10), a majority of the pooled set. Read per feature, export alone is exactly half, so the pooled reading is the one that makes this row consistent; the rule text does not say which reading.
6. CLI settings: unavailable (no invocation lines or loaded-settings evidence in the copied logs).
7. Task-state leakage: unavailable (turn 1 work-directory listings are not recoverable from the logs).
8. Export and footer failures: unresolved by rule. Failure counts (of 30 C-arm rows each): export (feature 2) first experiment 5, second experiment 10, rerun 8; footer (feature 5) first experiment 2, second experiment 10, rerun 10. Against the first experiment both rose in the second experiment and in the rerun; the rerun export count (8) is lower than the second experiment (10) and the footer count equals it. So the earlier wording that both rose is true only against the first experiment; it is not a trend inside the rerun.

## Decision (section 3.5) and Owner decision

Rule reading, unchanged: GO needs P0 A1 and B1 affirmative on 2.1.309 (met, docs/plans/evidence/2026-10-23-per-turn-gate-p0/) and a valid P1 batch with a measured M2_3. Under the preregistration this batch is **not** a valid batch, because the section 3.3 item "task hashes equal the preregistered ones after the last call" was not measured at the time. That remains true; it is not rewritten as met. On the rule alone the recommendation was HOLD.

Owner decision (d-baf11c30, 2026-10-24, Taipei time): the owner explicitly accepted the deviation of the unmeasured post-run task-hash comparison and adopted this batch's result on the substitute evidence. The substitute evidence is limited to: the listing recomputed after the batch equals the preregistered one, no file in the task directory has a modification time after 19:08Z on 2026-10-23, git shows no change since 2026-10-19 and a clean status. Its limit: it cannot exclude a change that was made and reverted inside the window. The adoption is the owner's acceptance of a deviation, not a rule judgement; the two are kept apart here.

Conclusion after the accepted deviation: this batch is adopted, so the GO condition "measured M2_3" is treated as satisfied together with P0 A1 and B1 on 2.1.309. **Recommendation: GO to the next stage** (advice; the decision stays with the owner). Observed values adopted: M1 6, M2 13, M3 0, M2_3 13/30, Fisher p 0.0169 against 23/30 and 0.7925 against 11/29, label A (label A rests on the owner's acceptance of the deviation (d-baf11c30), not on a section 3.3 validity judgement).

## Cost

Runs (last result object each): 15.7299 USD. 30 authentication probes: 0.5007 USD. Total 16.2306 USD, under the 18 USD cap (highest projected total was 16.9025 before C-07, headroom 1.10, the stop rule never fired). Cumulative run time 9240 s.

## Files

preregistration.md, p1-wrapper.sh (no scratch path), taskhash.pre.txt, invocation.log (byte-identical to the scratch original, see Validity), costs.tsv, probes.tsv, results-table.tsv, analyze-p1.js, sums-p1.txt. Raw logs stay in scratch.

## Recheck of the scoring tables (after four-seat review)

results-table.tsv was regenerated from the raw oracle.log files by analyze-p1.js and compared with an independent shell-only extraction (tr, grep, awk) of constraints_pass, features_pass and the five feature flags: all 30 rows identical (diff empty), M1 6, M2 13, M3 0, feature 2 passes 22, feature 5 passes 20. The M2-true rows are C-01, 03, 04, 06, 09, 18, 19, 21, 22, 23, 26, 27, 28 (13). A review reading of 11 M2 rows without C-22 and C-23 (and 23 feature-2 passes) does not match the raw logs or the committed table; both of those runs have features_pass true and feature 2 true in their oracle.log. M3 is 0 because no run has both M1 and M2 true. Numbers unchanged (M2_3 13/30, Fisher p 0.0169 against 23/30 and 0.7925 against 11/29); label A: label A rests on the owner's acceptance of the deviation (d-baf11c30), not on a section 3.3 validity judgement; the recommendation follows the Owner decision section.

## Lesson: every validity condition needs a contemporaneous artifact

The preregistration listed "task hashes equal the preregistered ones after the last call" as a validity condition, but the wrapper implemented only the comparison before the first call. Nothing was captured at the end, so the condition could not be checked afterwards and the batch cannot be called valid. Rule for later preregistrations: each validity condition must have a matching artifact written by the wrapper at the moment it applies (here, a post-run task hash listing and its diff result appended to invocation.log after the last call), and the wrapper should list the conditions and the artifact for each before the first call.
