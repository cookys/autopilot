# P2-3-h55 (Haiku 5.5): label PASS

Wrapper `run-p2-batch.js` (sha256 `773ecd3c3449d17e4d4cd2194b3934e66cd3f7e7e8e65f174a930d63debfd859`), manifest `docs/plans/evidence/2026-10-25-per-turn-gate-p2-3-h55/manifest.json`, preregistration `PREREG.md` in this directory (commit `e52f51cb4553bedf287de46abee070a58b265a9c`, 2026-10-25 13:06 Taipei), run directory `/home/cookys/.autopilot/bl0055-p2-3-h55/run`, clone `/home/cookys/.autopilot/bl0055-p2-3-h55/clone`. All times below are Taipei time (UTC+8); `invocation.log` stores UTC.

Scoring follows `PREREG.md` sections 2 and 3 as written. The scores are computed by `analyze-p2-3-h55.js` (this directory): M1, M2, M3 from the first JSON object of each run's `oracle.log` by two independent methods (JSON parse; text match), both compared with the wrapper's `SCORE` rows (all 60 agree; the script throws and exits non-zero on any mismatch), one-sided Fisher exact tests, and the registered instrument-health counters. No unregistered metric is used.

## 1. Batch facts

| Item | Value |
|---|---|
| Start | 2026-10-25 19:52 (`WINDOW_START` 11:52:33Z) |
| Pause | none: one invocation, `WRAPPER_START first=1 last=60`, no `PROBE_FAIL`, no `PAUSE`; `loop.status` `ended rc=0 restarts=0` |
| End | 2026-10-25 22:28 (14:28:22Z): `WRAPPER_DONE last=60`, `COMPLETE ON=30/30 C=30/30`, `WRAPPER_EXIT rc=0`; launcher `LOOP_EXIT rc=0` |
| Window | 2 h 36 min, inside the 8 h window. |
| Task hashes | `TASKHASH_DIFF pre ok` and `post ok`. |
| Model | one resolved id in all 60 `MODEL` rows: `claude-haiku-5-5`. |
| CLI | `2.1.309 (Claude Code)` in all 60 `RUNVERSION` rows. |
| END rc | 60 of 60 ids ended `rc=0`; no `STOP_*`, `ABORT`, `REFUSE`, `COST_INVALID` row. |
| Spend, ON arm | runs 1.1296 USD + probes 0.0594 USD = **1.1890 USD** (cap 3) |
| Spend, C arm | runs 0.8530 USD + probes 0.0590 USD = **0.9121 USD** (cap 3) |
| Spend, both arms | 2.1011 USD |

Spend is recomputed from the 60 `COST` rows of `invocation.log` (run and probe columns) and agrees with the 60 lines of `probes.tsv`.

### Audit (run again for this note)

```
cd /home/cookys/.autopilot/bl0055-p2-3-h55/clone
node evals/orchestration/run-p2-batch.js --audit --manifest docs/plans/evidence/2026-10-25-per-turn-gate-p2-3-h55/manifest.json --run-dir /home/cookys/.autopilot/bl0055-p2-3-h55/run --clone /home/cookys/.autopilot/bl0055-p2-3-h55/clone
```

Output (exit 0):

```
AUDIT OK
```

## 2. Completion count (condition 8)

`COMPLETE ON=30/30 C=30/30`; the audit recomputes it from `END` rc and `TURNS`. Every one of the 60 ids ended `rc=0` with 5 turns completed, so there is no failed, timed-out or incomplete run in either arm, and no denominator question arises: all 30 ON and 30 C runs are scored.

## 3. Result per registered threshold

M1, M2, M3 counts (denominator 30 per arm, recorded from `oracle.log`):

| Arm | M1 (constraints) | M2 (features) | M3 (both) | completed 5 turns |
|---|---|---|---|---|
| ON (hook) | 30/30 | 23/30 | **23/30** | 30/30 |
| C (concurrent control) | 30/30 | 0/30 | **0/30** | 30/30 |

Per-feature pass counts (features 1 to 5), reported, not gating: ON 30, 30, 30, 30, 23; C 30, 30, 30, 30, 0. Every C run failed feature 5 and nothing else; all 7 ON failures are feature 5 as well (`capability_fail`: ON-05, ON-20, ON-23, ON-24, ON-27, ON-29, ON-30).

| Registered check | Threshold | Observed | Met |
|---|---|---|---|
| Primary: M3_ON | >= 20/30 | 23/30 | yes |
| Primary: one-sided Fisher exact, M3_ON higher than M3_C | p < 0.01 | p = 8.7055e-11 (23/30 against 0/30) | yes |
| Trade check: one-sided Fisher, M2_ON lower than M2_C | FAIL-TRADE if p <= 0.05 | p = 1 (M2 23/30 against 0/30) | not triggered: "no drop detected" |
| M1_ON | >= 25/30 | 30/30 | yes |
| Hook errors (`HOOKERR`) | in at most 2 of 30 ON runs | 0 runs | yes |
| `BLOCKMAX` | no run above 2 blocks in one turn | maximum 2 | yes |
| ON: `gate_trace = gate_log` and > 0 | every ON run | all 30 (29 runs 7 = 7, one run 6 = 6) | yes |
| C: `gate_trace` and `gate_log` both 0 | every C run | all 30 | yes |
| Completion (condition 8) | >= 27/30 in each arm | ON 30, C 30 | yes |
| Audit | exit 0 | `AUDIT OK` | yes |

Plugin Stop hook executions (`plugin=`): 0 in all 60 runs (reported separately, never in the comparison).

**Label: PASS** (all gating thresholds met; the audit exits 0; no `STOP_*`; the batch is finished). Per the preregistration, PASS permits documenting the hook as an evaluated opt-in; it does not decide a default.

### Reported, not gating

- M3_ON against round 2's 26/29: this batch 23/30 (round 2: 26/29).
- Blocks per ON run: 59 block records in total, mean 1.967 per run.
- Cap-exhausted ON runs (hook log records with reason `cap`): 29 of 30 (all but ON-13).
- Duration and turns: ON total 5102 s, 150 turns completed; C total 3998 s, 150 turns completed.
- Cost: section 1 and the tables below.

## 4. Instrument health

| Check | Result |
|---|---|
| `HOOKERR` | 0 in all 30 ON runs (limit: at most 2 runs) |
| `BLOCKMAX` | maximum 2 over the ON runs (limit 2) |
| `gate_trace` / `gate_log` | ON: equal and > 0 in all 30 (29 runs 7/7, one run 6/6); C: 0/0 in all 30 |
| `plugin=` | 0 in all 60 runs |
| Model / CLI | `claude-haiku-5-5` in 60 of 60; `2.1.309 (Claude Code)` in 60 of 60 |

## 5. Comparison with the previous Haiku 4.5 batch (p2-3r2), numbers only

No conclusion across the two batches is drawn here; they differ in model and are separate preregistrations.

| Item | p2-3r2 (Haiku 4.5) | p2-3-h55 (Haiku 5.5) |
|---|---|---|
| Label | PASS | PASS |
| M1 ON / C | 29/30 / 5/30 | 30/30 / 30/30 |
| M2 ON / C | 29/30 / 17/30 | 23/30 / 0/30 |
| M3 ON / C | 28/30 / 1/30 | 23/30 / 0/30 |
| Fisher p, M3 ON higher than C | 1.1429e-13 | 8.7055e-11 |
| Fisher p, M2 ON lower than C | 1 | 1 |
| Completed 5 turns ON / C | 30 / 29 | 30 / 30 |
| Blocks per ON run (mean) | 1.567 (47 total) | 1.967 (59 total) |
| Cap-exhausted ON runs | 4 | 29 |
| HOOKERR runs / BLOCKMAX max | 0 / 2 | 0 / 2 |
| Spend ON / C (USD) | 22.4165 / 16.3675 | 1.1890 / 0.9121 |

## 6. Per-id results and cost

`blocks` is the number of `block` decisions in the run's hook log (ON only); `run` and `probe` are the USD figures of the `COST` row of `invocation.log`; `features` is the pass flags of features 1 to 5.

### ON arm

| id | M1 | M2 | M3 | turns | blocks | run | probe | features |
|---|---|---|---|---|---|---|---|---|
| ON-01 | 1 | 1 | 1 | 5 | 2 | 0.039725 | 0.001983 | 11111 |
| ON-02 | 1 | 1 | 1 | 5 | 2 | 0.046287 | 0.001983 | 11111 |
| ON-03 | 1 | 1 | 1 | 5 | 2 | 0.049241 | 0.001983 | 11111 |
| ON-04 | 1 | 1 | 1 | 5 | 2 | 0.036890 | 0.001983 | 11111 |
| ON-05 | 1 | 0 | 0 | 5 | 2 | 0.031730 | 0.001983 | 11110 |
| ON-06 | 1 | 1 | 1 | 5 | 2 | 0.037081 | 0.001949 | 11111 |
| ON-07 | 1 | 1 | 1 | 5 | 2 | 0.036529 | 0.001983 | 11111 |
| ON-08 | 1 | 1 | 1 | 5 | 2 | 0.027267 | 0.001983 | 11111 |
| ON-09 | 1 | 1 | 1 | 5 | 2 | 0.046672 | 0.001983 | 11111 |
| ON-10 | 1 | 1 | 1 | 5 | 2 | 0.049392 | 0.001983 | 11111 |
| ON-11 | 1 | 1 | 1 | 5 | 2 | 0.034891 | 0.001983 | 11111 |
| ON-12 | 1 | 1 | 1 | 5 | 2 | 0.040882 | 0.001983 | 11111 |
| ON-13 | 1 | 1 | 1 | 5 | 1 | 0.038029 | 0.001983 | 11111 |
| ON-14 | 1 | 1 | 1 | 5 | 2 | 0.039841 | 0.001949 | 11111 |
| ON-15 | 1 | 1 | 1 | 5 | 2 | 0.040091 | 0.001983 | 11111 |
| ON-16 | 1 | 1 | 1 | 5 | 2 | 0.041789 | 0.001983 | 11111 |
| ON-17 | 1 | 1 | 1 | 5 | 2 | 0.039480 | 0.001983 | 11111 |
| ON-18 | 1 | 1 | 1 | 5 | 2 | 0.032850 | 0.001983 | 11111 |
| ON-19 | 1 | 1 | 1 | 5 | 2 | 0.042066 | 0.001983 | 11111 |
| ON-20 | 1 | 0 | 0 | 5 | 2 | 0.037346 | 0.001983 | 11110 |
| ON-21 | 1 | 1 | 1 | 5 | 2 | 0.043879 | 0.001983 | 11111 |
| ON-22 | 1 | 1 | 1 | 5 | 2 | 0.038787 | 0.001983 | 11111 |
| ON-23 | 1 | 0 | 0 | 5 | 2 | 0.030047 | 0.001949 | 11110 |
| ON-24 | 1 | 0 | 0 | 5 | 2 | 0.026139 | 0.001983 | 11110 |
| ON-25 | 1 | 1 | 1 | 5 | 2 | 0.043963 | 0.001983 | 11111 |
| ON-26 | 1 | 1 | 1 | 5 | 2 | 0.031944 | 0.001983 | 11111 |
| ON-27 | 1 | 0 | 0 | 5 | 2 | 0.024331 | 0.001983 | 11110 |
| ON-28 | 1 | 1 | 1 | 5 | 2 | 0.036747 | 0.001983 | 11111 |
| ON-29 | 1 | 0 | 0 | 5 | 2 | 0.030288 | 0.001983 | 11110 |
| ON-30 | 1 | 0 | 0 | 5 | 2 | 0.035417 | 0.001983 | 11110 |
| total | 30 | 23 | 23 | 150 | 59 | 1.129621 | 0.059388 | |

### C arm

| id | M1 | M2 | M3 | turns | blocks | run | probe | features |
|---|---|---|---|---|---|---|---|---|
| C-01 | 1 | 0 | 0 | 5 | 0 | 0.024450 | 0.001983 | 11110 |
| C-02 | 1 | 0 | 0 | 5 | 0 | 0.029770 | 0.001949 | 11110 |
| C-03 | 1 | 0 | 0 | 5 | 0 | 0.033517 | 0.001949 | 11110 |
| C-04 | 1 | 0 | 0 | 5 | 0 | 0.028545 | 0.001983 | 11110 |
| C-05 | 1 | 0 | 0 | 5 | 0 | 0.023936 | 0.001983 | 11110 |
| C-06 | 1 | 0 | 0 | 5 | 0 | 0.030032 | 0.001983 | 11110 |
| C-07 | 1 | 0 | 0 | 5 | 0 | 0.025982 | 0.001983 | 11110 |
| C-08 | 1 | 0 | 0 | 5 | 0 | 0.022560 | 0.001983 | 11110 |
| C-09 | 1 | 0 | 0 | 5 | 0 | 0.022740 | 0.001983 | 11110 |
| C-10 | 1 | 0 | 0 | 5 | 0 | 0.034887 | 0.001983 | 11110 |
| C-11 | 1 | 0 | 0 | 5 | 0 | 0.028429 | 0.001949 | 11110 |
| C-12 | 1 | 0 | 0 | 5 | 0 | 0.025375 | 0.001949 | 11110 |
| C-13 | 1 | 0 | 0 | 5 | 0 | 0.028474 | 0.001949 | 11110 |
| C-14 | 1 | 0 | 0 | 5 | 0 | 0.028401 | 0.001949 | 11110 |
| C-15 | 1 | 0 | 0 | 5 | 0 | 0.037276 | 0.001949 | 11110 |
| C-16 | 1 | 0 | 0 | 5 | 0 | 0.025443 | 0.001983 | 11110 |
| C-17 | 1 | 0 | 0 | 5 | 0 | 0.035155 | 0.001949 | 11110 |
| C-18 | 1 | 0 | 0 | 5 | 0 | 0.025245 | 0.001983 | 11110 |
| C-19 | 1 | 0 | 0 | 5 | 0 | 0.034547 | 0.001949 | 11110 |
| C-20 | 1 | 0 | 0 | 5 | 0 | 0.023810 | 0.001983 | 11110 |
| C-21 | 1 | 0 | 0 | 5 | 0 | 0.027609 | 0.001949 | 11110 |
| C-22 | 1 | 0 | 0 | 5 | 0 | 0.032253 | 0.001949 | 11110 |
| C-23 | 1 | 0 | 0 | 5 | 0 | 0.039776 | 0.001983 | 11110 |
| C-24 | 1 | 0 | 0 | 5 | 0 | 0.028102 | 0.001983 | 11110 |
| C-25 | 1 | 0 | 0 | 5 | 0 | 0.031339 | 0.001983 | 11110 |
| C-26 | 1 | 0 | 0 | 5 | 0 | 0.022500 | 0.001983 | 11110 |
| C-27 | 1 | 0 | 0 | 5 | 0 | 0.024359 | 0.001983 | 11110 |
| C-28 | 1 | 0 | 0 | 5 | 0 | 0.030965 | 0.001949 | 11110 |
| C-29 | 1 | 0 | 0 | 5 | 0 | 0.024132 | 0.001949 | 11110 |
| C-30 | 1 | 0 | 0 | 5 | 0 | 0.023439 | 0.001983 | 11110 |
| total | 30 | 0 | 0 | 150 | 0 | 0.853048 | 0.059048 | |

## 7. Commands (reproducible)

Audit and scoring read the run directory only; nothing there was modified.

```
cd /home/cookys/.autopilot/bl0055-p2-3-h55/clone
node evals/orchestration/run-p2-batch.js --audit --manifest docs/plans/evidence/2026-10-25-per-turn-gate-p2-3-h55/manifest.json --run-dir /home/cookys/.autopilot/bl0055-p2-3-h55/run --clone /home/cookys/.autopilot/bl0055-p2-3-h55/clone
node docs/plans/evidence/2026-10-25-per-turn-gate-p2-3-h55/analyze-p2-3-h55.js
```

The second command prints the tab-separated per-id table and a JSON summary (arm counts, spend, Fisher p values, instrument-health flags) from which sections 1 to 6 are taken; it takes an optional run directory argument and defaults to the batch run directory above.

## 8. Deviations from the preregistration

None. Wrapper, launcher, harness, hook, manifest, order seed, model, CLI, caps and thresholds are those pinned in `PREREG.md`; the batch ran once, sequentially, in one window, with no pause and no id repeated or replaced. The scoring script `analyze-p2-3-h55.js` is new evidence added with this note; it adds no metric or rule.
