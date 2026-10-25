# P2-4 Verdict: per-turn gate hook (BL-0055 phase 2)

Plan: `docs/plans/2026-10-24-per-turn-gate-phase2.md` section 5 (P2-4), section 6, decision O6. Times are Taipei time. This note reads the committed `RESULT.md` files only; it adds no measurement and draws no conclusion across batches.

## 1. Batches and labels

| Batch | Model alias | Label | Evidence |
|---|---|---|---|
| P2-3 (first) | `claude-haiku-4-5` | **U** (not counted) | `docs/plans/evidence/2026-10-24-per-turn-gate-p2-3/RESULT.md`: credential copy expired, ON 15/30, C 16/30 completed |
| P2-3r | `claude-haiku-4-5` | **U** (not counted) | `docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r/RESULT.md`: `STOP_COST` at the 12th position, ON 6/30, C 5/30 |
| P2-3r2 | `claude-haiku-4-5` | **PASS** | `docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r2/RESULT.md`, `AUDIT OK` |
| P2-3-h55 | `claude-haiku-5-5` | **PASS** | `docs/plans/evidence/2026-10-25-per-turn-gate-p2-3-h55/RESULT.md`, `AUDIT OK` |

The two U batches are listed for completeness and take no part in the verdict. Both PASS batches: task `t14-constraint-horizon`, n=30 per arm (ON = hook, C = concurrent control), 5 turns per run, CLI `2.1.309`, hook mode `violations`.

## 2. Registered thresholds, as recorded in the two RESULT files

| Check | Threshold | P2-3r2 (Haiku 4.5) | P2-3-h55 (Haiku 5.5) |
|---|---|---|---|
| M3 ON (constraints and features) | >= 20/30 | 28/30 | 23/30 |
| M3 C | reported | 1/30 | 0/30 |
| Fisher one-sided, M3 ON higher than C | p < 0.01 | 1.1429e-13 | 8.7055e-11 |
| Trade check, Fisher one-sided, M2 ON lower than C | FAIL-TRADE if p <= 0.05 | p = 1 (M2 29/30 vs 17/30) | p = 1 (M2 23/30 vs 0/30) |
| M1 ON | >= 25/30 | 29/30 | 30/30 |
| Hook errors | at most 2 ON runs | 0 | 0 |
| Max blocks in one turn | 2 | 2 | 2 |
| Completion 5 turns | >= 27/30 per arm | ON 30, C 29 | ON 30, C 30 |
| Audit | exit 0 | `AUDIT OK` | `AUDIT OK` |

Other counts, reported not gating: M1 C 5/30 and 30/30; M2 C 17/30 and 0/30; ON blocks 47 and 59 in total; ON runs that exhausted the cap 4 and 29 of 30.

## 3. How the numbers were checked

Two methods, which agree:

1. The `analyze-p2-3r2.js` / `analyze-p2-3-h55.js` scripts in each evidence directory (they read the run directories, score by two internal methods and throw on any mismatch with the wrapper's `SCORE` rows). Their output is what the RESULT tables quote.
2. `docs/plans/evidence/2026-10-25-per-turn-gate-p2-4/recompute-p2-4.js`, written for this note. It reads only the per-id tables of the two committed `RESULT.md` files, sums M1, M2, M3 and blocks per arm, checks M3 = M1 and M2 per id, and computes the one-sided Fisher exact p values from the hypergeometric tail. Run from the repo root, output:

```
p2-3r2 (Haiku 4.5) {"ON":{"n":30,"m1":29,"m2":29,"m3":28,"blocks":47},"C":{"n":30,"m1":5,"m2":17,"m3":1,"blocks":0}}
  Fisher M3 ON>C p=1.1429e-13  Fisher M2 ON<C p=9.9999e-1
p2-3-h55 (Haiku 5.5) {"ON":{"n":30,"m1":30,"m2":23,"m3":23,"blocks":59},"C":{"n":30,"m1":30,"m2":0,"m3":0,"blocks":0}}
  Fisher M3 ON>C p=8.7055e-11  Fisher M2 ON<C p=1.0000e+0
```

Counts and p values equal the RESULT files (the trade-check p of about 0.99999 is recorded there as 1). The raw run directories under `/home/cookys/.autopilot/bl0055-*` were not read for this note.

## 4. What was measured and what was not (plan section 6)

Measured: one hook (`hooks/per-turn-gate.js`, mode `violations`), one task (`t14-constraint-horizon`), one verifier (the t14 `verify-turn.js`), two Haiku aliases (`claude-haiku-4-5` and `claude-haiku-5-5`, each in its own preregistered batch), one CLI version (`2.1.309`), n=30 per arm.

Not measured:

- Any task other than t14 (a PASS covers this hook and this task only).
- Any model other than the two Haiku aliases; larger models were not run (O7, out of scope).
- Any other CLI version; the CLI auto-updates and a pin change goes to the owner.
- Mode `violations+features` (the W4 trigger and retry text): not part of these arms; it stays unevaluated.
- SubagentStop (C1): deferred (plan 2.4, O4); t14 has no subagents.
- Multi-project, real-user or long-session behaviour, and the cost or latency of the hook outside the harness.
- Why the batches differ: the two batches differ in model and are separate preregistrations, so no causal statement across them is made here.

## 5. Recommendation to the owner

Keep the hook opt-in, default off (decision O6), shipped at 3.0.0 with no CHANGELOG entry until the owner's release call. Describe it in the docs as evaluated on task t14 with Haiku only, citing the two PASS batches, and keep the W4 text described as unevaluated. Owner decision card d-7d8444a3 is still open; this note follows the recommendation above. If the owner chooses default-on instead, that goes into a separate commit (it is a guidance change and needs its own plan, W6).

The plan is not archived yet; archiving waits for the owner's answer.
