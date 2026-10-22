# t14 per-turn verification gate — second experiment (BL-0055)

**Date**: 2026-10-20 · **Plan**: [2026-10-19-t14-gate-round2](../../../../plans/2026-10-19-t14-gate-round2.md) · **Size**: S6 write-up

Numbers below are the analyzer's frozen output. This report does not recompute them and does not change the verdict.

## Result in three lines

The pre-registered verdict is **SUCCESS**. KR1 (a) through (e) all pass. M1 (constraints held): C 5/29, G 28/29, one-sided Fisher p 1.99e-10. M2 (features built): C 11/29, G 27/29. M3 (both): C 0/29, G 26/29. Mechanism runs: 28.

## Pre-registered KRs and verdict rule

Plan section 2 freezes the rule before the batch. Arms are C (observe) and G (`violations+features`), n = 30 attempted pairs. A valid run is one whose turns completed and whose failure class is not an infra failure. M1 is constraints held, M2 is features built, M3 is both. The M1 test is one-sided Fisher exact, G greater than C.

KR1 (SUCCESS) needs all of: (a) M1_G minus M1_C at least 6 runs and Fisher p ≤ 0.05; (b) M2_G at least M2_C minus 3; (c) M3_G at least M3_C; (d) at least 3 mechanism runs; (e) KR4 validity (at least 27 valid runs per arm, one pinned CLI version, infra failures at most 10% of attempts). The decision rule is closed: no optional stopping and no n extension after reading results (plan line 39). Full text: [plan §2](../../../../plans/2026-10-19-t14-gate-round2.md).

On this batch: (a) pass (difference 23, p 1.99e-10); (b) pass (27 is above 11 minus 3); (c) pass (26 ≥ 0); (d) pass (28 mechanism runs); (e) pass (29 valid runs per arm, one version, infra 3.3%). Verdict **SUCCESS**.

## Analyzer table

C = observe, G = violations plus feature gaps. n = 29 valid runs each (30 run ids; one infra failure per arm, not re-run).

| Metric | C | G |
|--------|---|---|
| M1 constraints held | 5/29 | 28/29 |
| M2 features built | 11/29 | 27/29 |
| M3 both | 0/29 | 26/29 |

- M1 one-sided Fisher p = 1.99e-10 (analyzer `fisher_p` 1.9869847497081906e-10).
- Mechanism runs: 28.
- Analyzer mismatches: none. Verifier and oracle disagreements: 0 (the first experiment had 1).
- Infra attempt rate: C 0.0333, G 0.0333 (3.3% each), under the KR4 10% limit.
- KR4 validity passed. Single runner version 2.1.303 (Claude Code CLI), single model claude-haiku-4-5.
- G retries total 43. Four G runs exhausted retries: G-04, G-26, G-28, G-30.
- First failing turn: turn 5 in 24 cases (analyzer `first_failing_turn` key 1).
- Wall time about 5 h 40 min (2026-10-19 20:19 +08:00 to 2026-10-20 02:00 +08:00).

## Snapshot section (reported, not in the verdict)

| Trigger kind | persisted | fixed | introduced |
|--------------|-----------|-------|------------|
| violations only | 0 | 0 | 0 |
| features only | 5 | 12 | 0 |
| both | 2 | 9 | 1 |

Retries broke a working feature only once (the single `introduced` count, in the both row).

## Infra failures (not supplemented)

Two infra failures, each attempt 1 only:

- G-15 attempt 1: `runner_timeout`, 641 s, 1 turn done.
- C-16 attempt 1: `runner_error`, 335 s, 4 turns. The run text was "Failed to authenticate: OAuth session expired and could not be refreshed" (OAuth session expired mid-run).

The driver did not re-run them as the plan describes (infra failures are re-run, at most 3 times each). It printed DONE with only attempt 1. Depth-0 ruled not to supplement: the plan decision rule is closed, and after reading results n may not be extended (plan line 39). 29 valid runs per arm already meet the 27 threshold. The infra failure rate 3.3% is below the KR4 10% limit.

## C-arm baseline gap (open anomaly)

The first experiment C arm M2 was 23/30. This experiment's C arm M2 is 11/29, with the same settings. The cause has not been analysed. This is an open anomaly: no conclusion and no guessed cause.

Also noted, still without a cause: C M1 is 5/29 here versus 1/30 in the first experiment, and the first failing turn was turn 5 in 24 cases.

## Raw results

`results.jsonl` is not in the repo. The raw run directory stays in session scratch, not in the repo. The file at `t14r2-s5/out/results.jsonl` has 61 lines, 54396 bytes, sha256 `af069a0e14feced0df139a8a4826d83d8fc1395843b75a707429de83f9105bd8`. The analyzer text is [analysis-r2.txt](analysis-r2.txt).

## Caveat

This is haiku-4-5, Claude Code CLI 2.1.303, one task set. It must not be extrapolated.

## Follow-ups

- [BL-0253](../../../../../backlog/agy-142-headless-envelope-no-exit.md) — agy 1.4.2 headless large output can print SUCCESS and not exit.
- [BL-0254](../../../../../backlog/t14-batch-driver-infra-rerun-oauth.md) — the t14 batch driver does not re-run infra failures and does not see mid-run OAuth expiry.
- [BL-0255](../../../../../backlog/campaign-control-initial-state-rename.md) — rename of the persisted `initial_state` field needs an owner decision.
- [BL-0256](../../../../../backlog/run-ledger-max-rotations-sweep-env.md) — `RUN_LEDGER_MAX_ROTATIONS` reads the sweep environment with unclear intent.
- BL-0257 (`docs/backlog/bl0039-notes-instant2-filter.md`, 2026-10-23 BL-0257 結案時刪除，內容見 git 歷史) — BL-0039 notes 7 and 8: re-anchor the instant2 fixture and add a filter check.
