# Verdict: gemini-4-hydrogen-high as implementer (PM dispatch 01M79J89)

Judged against `prereg.md` in this directory (bars frozen before any run; addendum fixed "best incumbent" before carbon's receipt). Depth-0 adjudication 2026-11-13 16:15 Taipei (after carbon's last task at 16:06:01); review per prereg: agyclaude.

Sources (not copied here; cited by sha16):

- SWE34 three-engine table `TABLE-swe34-all3.md` sha16 `afa500e7121495ac` (fleet blob from the GPU-bench lane, reply to 01M79PMC), rates from `derive-rates.py` sha16 `7efac38aa6bc6fd4`; carbon `summary.json` sha16 `93bb39a5ec536f3b`; 34-task list sha16 `26a2e5c7965d98c2`.
- Qualification: engine-scorecard snapshot sha16 `f4c6abeae4eced86`, lines 32 (reviewer) and 33 (implementer).

| Engine | SWE34 resolved | Median s per task | Integrity hits |
|---|---|---|---|
| gemini-4-hydrogen-high (candidate) | 29/34 | 147.78 | 0 |
| gemini-4-carbon-high (incumbent) | 29/34 | 774.08 (note A) | 1 mechanical hit (note B) |
| claude-opus-5-5-medium@agy = agyclaude (incumbent) | 27/34 | 91.50 | 0 |

Best incumbent (addendum: the incumbent with the most resolved, the same engine for bars 2 and 3) = carbon (29 > 27).

| Bar | Rule | Value | Result |
|---|---|---|---|
| 1 | reviewer and implementer cells both pass | reviewer 42/42 qualified; implementer 24/24 qualified, integrity 0 | pass |
| 2 | resolved >= best incumbent | 29 >= 29 | pass |
| 3 | median <= 1.1 x best incumbent median | 147.78 <= 1.1 x 774.08 = 851.49 | pass |
| 4 | integrity violations = 0 | 0 | pass |

All four hold. Per prereg: pace-select puts hydrogen first for implementer, others only when it is behind pace; the fleet-wide CLI rollout goes to hangar (backup, sha16, rollback).

Robustness (each checked so the verdict does not hang on a contested number):

- Note A, carbon's median: 30 of carbon's 34 tasks ran as 3 parallel shards, so 774.08 s is measured under contention. No carbon number is contention-free: its first 4 tasks ran serially but alongside the other two engines (all started 12:39:59) and, from 13:48:17, alongside its own shards; its single-lane equivalent 7.6923 h (mean about 814 s over 34 tasks) sums agent seconds that include the 30 shard tasks. Bar 3 fails only if carbon's uncontended median were below 147.78 / 1.1 = 134.3 s, i.e. a median/mean ratio below about 0.165 against about 0.87 for hydrogen and 0.59 for opus; nothing in the data points to that, so bar 3 holds on any plausible reading. The table's note 1 says bar 3 compares with the fastest engine (opus); that contradicts the PM addendum and is not used. Under that reading bar 3 would fail (147.78 > 1.1 x 91.50 = 100.65); it is recorded here so the difference is visible, not adopted.
- Note B, carbon's integrity hit (`tests/ingest/test_slack_ingest.py`, an existing one-line call folded into several lines with the same arguments, plus new tests): bar 4 is about the candidate, so this hit is not adjudicated. If it counted against carbon, carbon's resolved becomes 28, carbon stays the best incumbent (28 > 27), and bars 2 and 3 still pass.
- Sampling: no temperature or seed control; 29 vs 29 is a tie on 34 tasks. Bar 2 is `>=`, so the tie passes as registered. The data do not show hydrogen solving more than carbon; they show it solves as many at about a fifth of carbon's per-task time.

Plain-language summary for the operator: hydrogen solves as many tasks as carbon (29 of 34) and two more than agyclaude (27), and it is about five times faster per task than carbon. It is slower than agyclaude: median 148 s against 92 s, about 1.6 times as long per task.

Fleet-Task: 01M79J89A09KAGP4HCM8KC3G0J
