# P1 Step 2: cost accounting and the 30-run estimate

Derived only from the copied historical logs (no measured call). Owner approval d-0ab59f36: P1 allowed, cap 15 USD, never raised.

## Step 1 data

Both C arms were copied to scratch (`<p1base>/run/hist/exp1` from the first experiment, `exp2` from the second): `results.jsonl`, `schedule.json`, and for each of the 30 C run ids `oracle.log`, `run.log`, `result.json` (attempt-1 only exists for every id). 184 files; sha256 and scratch-relative paths in `hist-sums.txt`. The analysis script is `analyze-hist.js` and its output `hist-analysis.txt`.

## Is `total_cost_usd` cumulative?

Yes, within a run. Evidence from the 300 result objects (2 batches x 30 runs x 5 turns):

- All 5 result objects of a run carry one session id (the harness resumes one session), and `total_cost_usd` rises with each object (for example C-01 of the second batch: 0.0659, 0.1551, 0.1695, 0.2660, 0.3772).
- The `usage` block of each object is per invocation. Pricing it with the haiku rates (input 1, output 5, cache write 1-hour 2, cache read 0.1 USD per million tokens) reproduces each object's cost increment (`total_cost_usd` minus the previous object's) with a maximum relative deviation of 0.000 over all 300 objects. A non-cumulative field would equal the priced usage itself, not the difference.

So a run's cost is the `total_cost_usd` of its last result object. The driver's recorded cost (the first match in `run.log`) is the first turn's cost only; it understated a run by about a factor of seven.

## 30-run estimate

Per-run final cost, C arms: first batch mean 0.5453 USD (sd 0.1249, range 0.309 to 0.822); second batch mean 0.4799 USD (sd 0.1163, range 0.253 to 0.686); pooled 0.5126.

- Larger of the two batch means (the plan's rule for an uncertain estimate): 30 x 0.5453 = **16.4 USD**.
- Second batch alone: 30 x 0.4799 = 14.4 USD; pooled: 15.4 USD. The standard deviation of a 30-run total is about 0.65 USD.

Every central estimate except the second batch alone exceeds the 15 USD cap, and even that one leaves a margin of 0.6 USD, under one standard deviation. A batch stopped part-way would be invalid by section 3.3 (all 30 ids must be launched).

## Decision

The estimate (16.4 USD, 15.4 USD pooled) exceeds the 15 USD cap, so the batch is not launched. Reported to depth-0 for a decision (options for the owner: raise the cap to about 18 USD, or accept a changed design such as fewer runs, which is a plan change needing its own review). Nothing past Step 2 was started; no measurement call was made.
