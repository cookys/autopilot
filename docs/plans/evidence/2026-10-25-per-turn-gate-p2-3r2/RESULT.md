# P2-3r2 (Haiku 4.5 second rerun): label PASS

Wrapper `run-p2-batch.js` (sha256 `773ecd3c3449d17e4d4cd2194b3934e66cd3f7e7e8e65f174a930d63debfd859`), manifest `docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r2/manifest.json`, preregistration `PREREG.md` in this directory (commit `e52f51cb4553bedf287de46abee070a58b265a9c`, 2026-10-25 13:06 Taipei), run directory `/home/cookys/.autopilot/bl0055-p2-3r2/run`, clone `/home/cookys/.autopilot/bl0055-p2-3r2/clone` at `1c5935da693cb7ccb73a39285f8f4f92c25cef74`. All times below are Taipei time (UTC+8); `invocation.log` stores UTC.

Scoring follows `PREREG.md` sections 2 and 3 as written. The preregistration names no scoring script; the scores are computed by `analyze-p2-3r2.js` (this directory), which implements exactly the registered recipe: M1, M2, M3 from the first JSON object of each run's `oracle.log` by two independent methods (JSON parse; text match), both compared with the wrapper's `SCORE` rows (all 60 agree; the script throws on any mismatch), one-sided Fisher exact tests, and the registered instrument-health counters. No unregistered metric is used.

## 1. Batch facts

| Item | Value |
|---|---|
| Start | 2026-10-25 13:44 (`WINDOW_START` 05:44:47Z) |
| Pause | 2026-10-25 18:02 (10:02:27Z): `PROBE_FAIL ON-24 rc=1 cost=0.000000` (saved response reason `source_token_expiring`), `PAUSE id not launched`, `WRAPPER_EXIT rc=7`. ON-24 was not launched at that point (`COMPLETE ON=23/30 C=22/30`). |
| Resume | 2026-10-25 18:07 (10:07:27Z), `WRAPPER_START first=47 last=60` after the credential source was refreshed; the launcher resumed on its own (`loop.status`: `ended rc=0 restarts=1`). ON-24 passed its second probe (`probes/ON-24-2.json`, auth_ok, cost 0.021683), started at elapsed 15766 s and ended `rc=0`. |
| End | 2026-10-25 19:27 (11:27:58Z): `WRAPPER_DONE last=60`, `COMPLETE ON=30/30 C=29/30`, `WRAPPER_EXIT rc=0`; launcher `LOOP_EXIT rc=0`. |
| Window | first START 05:44:47Z, last END 11:27:58Z: 5 h 43 min, inside the 8 h window. |
| Task hashes | `TASKHASH_DIFF pre ok` and `post ok` in both invocations. |
| Model | one resolved id in all 60 `MODEL` rows: `claude-haiku-4-5`. |
| CLI | `2.1.309 (Claude Code)` in all 60 `RUNVERSION` rows. |
| END rc | 60 of 60 ids ended `rc=0`; no `STOP_*`, `ABORT`, `REFUSE`, `COST_INVALID` row. |
| Spend, ON arm | runs 21.7825 USD + probes 0.6340 USD = **22.4165 USD** (cap 40) |
| Spend, C arm | runs 15.7287 USD + probes 0.6388 USD = **16.3675 USD** (cap 26) |
| Spend, both arms | 38.7840 USD |
| Failed probe | the ON-24 probe at the pause cost 0.000000 (included above as 0). |

### Audit (run again for this note)

```
cd /home/cookys/.autopilot/bl0055-p2-3r2/clone
node evals/orchestration/run-p2-batch.js --audit --manifest docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r2/manifest.json --run-dir /home/cookys/.autopilot/bl0055-p2-3r2/run --clone .
```

Output (exit 0):

```
AUDIT OK
```

## 2. Completion count (condition 8) and the C arm's missing completion

`COMPLETE ON=30/30 C=29/30`; the audit recomputes this line from `END` rc and `TURNS` and accepts it. The minimum is 27 of 30 in each arm: ON 30 and C 29 both meet it.

The C id that is not counted as complete is **C-21**. Its harness call ended `rc=0` but `result.json` reports `turns_completed` 3 of 5, `failure_class` `infra_fail`, `failure_cause` `runner_timeout`, `duration` 780 s (the harness per-call timeout), `run_error` true. Log rows: `START C-21 elapsed=13092` at 09:22:59Z, `END C-21 rc=0` at 09:35:59Z, `TURNS C-21 arm=C n=3`. The run directory holds turn files for turns 1 to 4 and a `stderr` file with no authentication hit. Its `oracle.log` is present and gives `constraints_pass` true, `features_pass` false (feature 5 failed: export file lacks the summary footer), so `SCORE C-21 m1=1 m2=0 m3=0`.

Treatment under the preregistration. Section 4, "Failed runs and the completion count", says one failed run does not invalidate the batch and the plan tolerates failures through "at least 27 of 30 completed five turns, in each arm"; the completion count is the only place it enters. The preregistration contains no rule that excludes an incomplete run from M1, M2 or M3, ids are "launched once ... no replacement runs" (section 1), and condition 7 requires the score to be recoverable from `oracle.log`, which it is. So C-21 stays in the C arm's denominator of 30 with its recorded scores (M1 1, M2 0, M3 0). It is not excluded and not replaced. The audit accepts it (`AUDIT OK`).

## 3. Result per registered threshold

M1, M2, M3 counts (denominator 30 per arm, recorded from `oracle.log`):

| Arm | M1 (constraints) | M2 (features) | M3 (both) | completed 5 turns |
|---|---|---|---|---|
| ON (hook) | 29/30 | 29/30 | **28/30** | 30/30 |
| C (concurrent control) | 5/30 | 17/30 | **1/30** | 29/30 |

Per-feature pass counts (features 1 to 5), reported, not gating: ON 30, 30, 30, 30, 29; C 30, 21, 30, 30, 24.

| Registered check | Threshold | Observed | Met |
|---|---|---|---|
| Primary: M3_ON | >= 20/30 | 28/30 | yes |
| Primary: one-sided Fisher exact, M3_ON higher than M3_C | p < 0.01 | p = 1.1429e-13 (28/30 against 1/30) | yes |
| Trade check: one-sided Fisher, M2_ON lower than M2_C | FAIL-TRADE if p <= 0.05 | p = 1 (M2 29/30 against 17/30) | not triggered: "no drop detected" |
| M1_ON | >= 25/30 | 29/30 | yes |
| Hook errors (`HOOKERR`) | in at most 2 of 30 ON runs | 0 runs | yes |
| `BLOCKMAX` | no run above 2 blocks in one turn | maximum 2 | yes |
| ON: `gate_trace = gate_log` and > 0 | every ON run | all 30 | yes |
| C: `gate_trace` and `gate_log` both 0 | every C run | all 30 | yes |
| Completion (condition 8) | >= 27/30 in each arm | ON 30, C 29 | yes |
| Audit | exit 0 | `AUDIT OK` | yes |

Plugin Stop hook executions (`plugin=`): 0 in all 60 runs (reported separately, never in the comparison).

**Label: PASS** (all gating thresholds met; the audit exits 0; no `STOP_*`; the batch is finished). Per the preregistration, PASS permits documenting the hook as an evaluated opt-in; it does not decide a default.

### Reported, not gating

- M3_ON against round 2's 26/29: this batch 28/30 (round 2: 26/29).
- Blocks per ON run: 47 block records in total, mean 1.567 per run (see the per-id table).
- Cap-exhausted ON runs (hook log records with reason `cap`): 4 of 30 (ON-12, ON-24, ON-25, ON-27).
- Duration and turns: ON total 11109 s, 150 turns completed; C total 8846 s, 148 turns completed.
- Cost: section 1 and the table below.

## 4. Per-id results and cost

`blocks` is the number of `block` decisions in the run's hook log (ON only); `run` and `probe` are the USD figures of the `COST` row of `invocation.log`; `features` is the pass flags of features 1 to 5.

### ON arm

| id | M1 | M2 | M3 | turns | blocks | run | probe | features |
|---|---|---|---|---|---|---|---|---|
| ON-01 | 1 | 1 | 1 | 5 | 2 | 0.710553 | 0.020648 | 11111 |
| ON-02 | 1 | 1 | 1 | 5 | 1 | 0.607596 | 0.020643 | 11111 |
| ON-03 | 1 | 1 | 1 | 5 | 1 | 0.650438 | 0.021123 | 11111 |
| ON-04 | 1 | 1 | 1 | 5 | 2 | 0.640308 | 0.021493 | 11111 |
| ON-05 | 1 | 1 | 1 | 5 | 1 | 0.527419 | 0.020638 | 11111 |
| ON-06 | 1 | 1 | 1 | 5 | 2 | 0.624480 | 0.021418 | 11111 |
| ON-07 | 1 | 1 | 1 | 5 | 1 | 0.732583 | 0.021378 | 11111 |
| ON-08 | 1 | 1 | 1 | 5 | 1 | 0.644338 | 0.020643 | 11111 |
| ON-09 | 1 | 1 | 1 | 5 | 1 | 0.621182 | 0.020653 | 11111 |
| ON-10 | 1 | 1 | 1 | 5 | 1 | 0.682093 | 0.020618 | 11111 |
| ON-11 | 1 | 1 | 1 | 5 | 2 | 0.506791 | 0.020628 | 11111 |
| ON-12 | 1 | 1 | 1 | 5 | 3 | 0.717690 | 0.020998 | 11111 |
| ON-13 | 1 | 1 | 1 | 5 | 2 | 0.912831 | 0.021293 | 11111 |
| ON-14 | 1 | 1 | 1 | 5 | 1 | 0.727554 | 0.020853 | 11111 |
| ON-15 | 1 | 1 | 1 | 5 | 1 | 0.741657 | 0.020663 | 11111 |
| ON-16 | 1 | 1 | 1 | 5 | 2 | 0.653132 | 0.020888 | 11111 |
| ON-17 | 1 | 1 | 1 | 5 | 2 | 0.731291 | 0.024123 | 11111 |
| ON-18 | 1 | 1 | 1 | 5 | 1 | 0.847381 | 0.021253 | 11111 |
| ON-19 | 1 | 1 | 1 | 5 | 2 | 0.666442 | 0.021043 | 11111 |
| ON-20 | 1 | 1 | 1 | 5 | 2 | 0.847558 | 0.020868 | 11111 |
| ON-21 | 1 | 1 | 1 | 5 | 2 | 0.806143 | 0.020633 | 11111 |
| ON-22 | 1 | 1 | 1 | 5 | 1 | 0.776251 | 0.021018 | 11111 |
| ON-23 | 1 | 1 | 1 | 5 | 1 | 0.772182 | 0.021393 | 11111 |
| ON-24 | 1 | 1 | 1 | 5 | 2 | 0.724844 | 0.021683 | 11111 |
| ON-25 | 0 | 1 | 0 | 5 | 2 | 0.756302 | 0.021418 | 11111 |
| ON-26 | 1 | 1 | 1 | 5 | 1 | 0.852855 | 0.021363 | 11111 |
| ON-27 | 1 | 0 | 0 | 5 | 2 | 0.919963 | 0.021053 | 11110 |
| ON-28 | 1 | 1 | 1 | 5 | 2 | 0.806554 | 0.021203 | 11111 |
| ON-29 | 1 | 1 | 1 | 5 | 1 | 0.923956 | 0.021018 | 11111 |
| ON-30 | 1 | 1 | 1 | 5 | 2 | 0.650101 | 0.021338 | 11111 |
| total | 29 | 29 | 28 | 150 | 47 | 21.782500 | 0.634000 | |

### C arm

| id | M1 | M2 | M3 | turns | blocks | run | probe | features |
|---|---|---|---|---|---|---|---|---|
| C-01 | 0 | 1 | 0 | 5 | 0 | 0.748461 | 0.021013 | 11111 |
| C-02 | 0 | 0 | 0 | 5 | 0 | 0.330150 | 0.020853 | 10111 |
| C-03 | 0 | 0 | 0 | 5 | 0 | 0.540708 | 0.021228 | 10111 |
| C-04 | 0 | 1 | 0 | 5 | 0 | 0.430706 | 0.021263 | 11111 |
| C-05 | 0 | 1 | 0 | 5 | 0 | 0.470291 | 0.020653 | 11111 |
| C-06 | 0 | 0 | 0 | 5 | 0 | 0.373850 | 0.021153 | 10111 |
| C-07 | 0 | 1 | 0 | 5 | 0 | 0.531750 | 0.021778 | 11111 |
| C-08 | 0 | 0 | 0 | 5 | 0 | 0.393548 | 0.022163 | 10111 |
| C-09 | 1 | 0 | 0 | 5 | 0 | 0.296295 | 0.020893 | 10110 |
| C-10 | 1 | 1 | 1 | 5 | 0 | 0.504763 | 0.020703 | 11111 |
| C-11 | 0 | 0 | 0 | 5 | 0 | 0.384220 | 0.021408 | 10111 |
| C-12 | 0 | 0 | 0 | 5 | 0 | 0.857041 | 0.021698 | 11110 |
| C-13 | 0 | 1 | 0 | 5 | 0 | 0.661836 | 0.021198 | 11111 |
| C-14 | 0 | 1 | 0 | 5 | 0 | 0.446185 | 0.021028 | 11111 |
| C-15 | 0 | 0 | 0 | 5 | 0 | 0.319218 | 0.021788 | 10111 |
| C-16 | 0 | 1 | 0 | 5 | 0 | 0.576865 | 0.021628 | 11111 |
| C-17 | 0 | 1 | 0 | 5 | 0 | 0.587434 | 0.021373 | 11111 |
| C-18 | 0 | 1 | 0 | 5 | 0 | 0.969634 | 0.020398 | 11111 |
| C-19 | 0 | 0 | 0 | 5 | 0 | 0.503013 | 0.021923 | 10111 |
| C-20 | 0 | 1 | 0 | 5 | 0 | 0.360233 | 0.020848 | 11111 |
| C-21 | 1 | 0 | 0 | 3 | 0 | 0.590611 | 0.021518 | 11110 |
| C-22 | 0 | 1 | 0 | 5 | 0 | 0.584959 | 0.021088 | 11111 |
| C-23 | 0 | 1 | 0 | 5 | 0 | 0.618127 | 0.021483 | 11111 |
| C-24 | 0 | 1 | 0 | 5 | 0 | 0.415498 | 0.022463 | 11111 |
| C-25 | 1 | 0 | 0 | 5 | 0 | 0.670436 | 0.021308 | 11110 |
| C-26 | 0 | 1 | 0 | 5 | 0 | 0.500838 | 0.021333 | 11111 |
| C-27 | 0 | 0 | 0 | 5 | 0 | 0.658259 | 0.021053 | 11110 |
| C-28 | 0 | 1 | 0 | 5 | 0 | 0.448512 | 0.020643 | 11111 |
| C-29 | 0 | 1 | 0 | 5 | 0 | 0.540093 | 0.021083 | 11111 |
| C-30 | 1 | 0 | 0 | 5 | 0 | 0.415133 | 0.021878 | 10110 |
| total | 5 | 17 | 1 | 148 | 0 | 15.728700 | 0.638800 | |

## 5. Commands (reproducible)

Audit and scoring read the run directory only; nothing there was modified.

```
cd /home/cookys/.autopilot/bl0055-p2-3r2/clone
node evals/orchestration/run-p2-batch.js --audit --manifest docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r2/manifest.json --run-dir /home/cookys/.autopilot/bl0055-p2-3r2/run --clone .
node docs/plans/evidence/2026-10-25-per-turn-gate-p2-3r2/analyze-p2-3r2.js /home/cookys/.autopilot/bl0055-p2-3r2/run
```

The second command prints the tab-separated per-id table and a JSON summary (arm counts, spend, Fisher p values, instrument-health flags) from which sections 1 to 4 are taken. Batch facts come from `invocation.log`, `loop.status`, `probes/` and `runs/C-21/` in the same run directory.

## 6. Deviations from the preregistration

None. The wrapper, launcher, harness, hook, manifest, order seed, model, CLI, caps and thresholds are those pinned in `PREREG.md`; the batch ran once, sequentially, in one window; the single pause was the registered credential-expiry pause (exit 7) and the registered launcher resume, with no id repeated or replaced. The scoring script `analyze-p2-3r2.js` is new evidence added with this note; it adds no metric or rule.
