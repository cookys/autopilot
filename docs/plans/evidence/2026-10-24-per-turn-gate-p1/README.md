# P1 result: INVALID (label U), recommendation HOLD (BL-0055)

Preregistration commit 86fd6682a01d7ba6104b85433227fd163defaaf7 (2026-10-24T00:19:46+08:00), before the first call (first START 2026-10-23T16:20:02Z).

## Outcome

- Launched C-01 to C-28 in order, sequentially, one call each. C-29 and C-30 were never launched: the wrapper stopped itself (STOP_AUTH) after C-28 at 2026-10-23T18:43:56Z.
- C-28 ended in 2 s with an authentication error ("Failed to authenticate: OAuth session expired and could not be refreshed", is_error=true, 0 turns). C-27 hit the 10 minute timeout after turn 1 (655 s, infra_fail runner_timeout), the same period; it is probably the same expiry but the log does not say so. The owner confirmed the login expired at that time and re-logged in. No other run has an error result object (checked by is_error in each run.log; other keyword hits were token counts).
- Section 3.3 validity: 26 of 30 runs completed five turns (needs 27), two ids unlaunched, one authentication expiry occurred. The batch is **U (invalid)**. Per the coordinator, no extra runs were added and the credential was not refreshed mid-batch.
- Task hashes after the last call equal the preregistered listing (diff empty). CLI 2.1.309 in every run (result.json runner_version). All 28 launched runs have a recoverable oracle score.

## Descriptive numbers (not a valid M2_3, not used for any label)

Over the 28 launched runs: M1 6, M2 16, M3 0. Over the 26 runs that completed five turns: M2 16 of 26. Per-run table: results-table.tsv. No Fisher comparison or A to D label is given because the batch is U; the candidate table rows follow the section 3.4 function: row 3 unavailable (label U), the others as preregistered (row 5 auth: this batch itself had an expiry, so it adds an observation but excludes nothing).

## Decision (section 3.5)

GO conditions: P0 A1 and B1 affirmative on 2.1.309 (met), valid P1 batch with M2_3 (not met). Recommendation: **HOLD**. To obtain a valid batch the whole 30-run batch must be redone with a fresh preregistration (owner decision; this cap is spent).

## Cost

Sum of final result-object costs of C-01 to C-28: 14.1229 USD, plus the 0.016617 USD probe: 14.1395 USD total, under the 18 USD cap. Wall time of the 28 runs 8618 s of run time (first START 16:20:02Z, last END 18:43:56Z, about 2.4 hours).

## Files

preregistration.md, p1-wrapper.sh (as committed in the preregistration, unchanged; its scratch path contains a session directory name), taskhash.pre.txt, invocation.log (scratch path redacted), results-table.tsv, analyze-p1.js, sums-p1.txt; earlier Step 2 files unchanged. Raw logs stay in scratch.
