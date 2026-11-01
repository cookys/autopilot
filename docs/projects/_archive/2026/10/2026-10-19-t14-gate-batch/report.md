# t14 per-turn verification gate — batch result (BL-0055)

**Date**: 2026-10-19 · **Plan**: [2026-10-19-t14-per-turn-gate-experiment](../../../../plans/2026-10-19-t14-per-turn-gate-experiment.md) · **Size**: S6 write-up

Numbers below are the analyzer's frozen output. This report does not recompute them and does not change the verdict.

## Result in three lines

The pre-registered verdict is **FAIL**, reason **FAIL-TRADE** (plan KR2 g). The gate held the constraints (M1: control 1/30, gate 29/30) and lost features (M2: control 23/30, gate 17/30; the floor was M2_C minus 3 = 20). Both together (M3) were control 1/30 and gate 16/30.

## Pre-registered KRs and verdict rule

Plan section 2 freezes the rule before the batch. Arms are C (control, no gate) and G (gate), n = 30 valid runs each. M1 is constraints held, M2 is features built, M3 is both. Tests are one-sided Fisher exact, G greater than C, taken from each run's `oracle.log`.

KR1 (SUCCESS) needs all of: (a) M1_G minus M1_C at least 6 runs and Fisher p ≤ 0.05; (b) M2_G at least M2_C minus 3; (c) M3_G at least M3_C; (d) at least 3 mechanism runs (violation reported, retry, next check passed); (e) KR4 validity. KR2 (FAIL) is either (f) no effect, or (g) FAIL-TRADE: the M1 lift holds but M2 falls below M2_C minus 3. KR3 is INCONCLUSIVE for everything else, including a validity failure. No optional stopping and no n extension; a follow-up needs a new plan. Full text: [plan §2](../../../../plans/2026-10-19-t14-per-turn-gate-experiment.md).

On this batch: KR1 (a) pass, (b) fail (M2_G 17 is below 20), (c) pass, (d) pass, (e) pass. KR2 (g) holds, so the verdict is FAIL-TRADE.

## Analyzer table

C = control, G = gate. n = 30 valid runs each.

| Metric | C | G |
|--------|---|---|
| M1 constraints held | 1/30 | 29/30 |
| M2 features built | 23/30 | 17/30 |
| M3 both | 1/30 | 16/30 |

- M1 one-sided Fisher p = 7.6e-15.
- Mechanism runs (violation reported, retry, next check passed): 26.
- Analyzer mismatches: none.
- Infra attempt rate: C 0, G 0.0323 (one `runner_timeout`, G-02 attempt 1, 795 s).
- KR4 validity passed.
- Single `runner_version` 2.1.303 (Claude Code), single model `claude-haiku-4-5`.
- G retries total 26, all at turn 5, none exhausted.
- First failing constraint turn: 28 runs at turn 5 and 1 at turn 3 (constraint 1 key).
- Verifier-passed-but-oracle-failed G runs: 1.

## Run log S4 and S5

**S4.** 4 real runs, C-01, G-01, G-02, C-02, in a discarded out dir. C 253 s and 251 s, G 336 s and 295 s. G one retry each at turn 5. `total_cost_usd` 0.065 to 0.099 per run. Pin held (2.1.303, haiku-4-5). No verifier error. Zero analyzer mismatches. Decision GO. Pilot rows never enter the n=30.

**S5.** Start 2026-10-19 10:48 (+08:00). The driver printed `DONE pairs=30` about 17:36. First row started 02:48Z, last row 09:30Z, about 6 h 42 min including the auth wait. 60 valid runs, 61 result rows. Valid-run time C 8767 s (mean 292 s), G 9091 s (mean 303 s). No sample padding, no early stop.

## Post-hoc observations

Every item in this section is **post-hoc**. None of them changes the verdict. Each cites run ids and files under `/tmp/claude-<uid>/-home-<user>-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/t14-s5/out/runs/<run>/attempt-1/`.

### A. What the retry did (post-hoc)

The only violation in the whole batch is the turn 5 footer. 26 G runs got `retry_5_1.md` (rule 1, evidence `run`/`export` footer not a `#` comment). 29 of 30 C runs had the same violation at the end. Every retried run ended with constraint 1 held (26/26). Each retry summary (last line of `run.log`, for example G-03, G-07, G-08, G-13, G-28) says the footer was changed to a `# Total rows: N` comment and features were kept. No run shows a feature deleted to satisfy the rule. No retry budget was exhausted: one retry per run, limit was 2. Retries cannot have eaten turns: they happen after turn 5.

### B. Where the M2 loss sits (post-hoc)

Oracle feature 2 (export) failed in G 9 of 30 and C 5 of 30. Feature 5 (footer in export or run) failed in G 5 and C 2. G-09 failed both, so 13 distinct G runs versus 7 C runs.

Export failures: `oracle.log` says "export did not create file" in G-03, G-04, G-07, G-09, G-13, G-19, G-22, G-23, G-28 and C-01, C-03, C-14, C-27, C-29.

Footer failures: "export file lacks the summary footer" in G-08, G-12, G-26, G-30 and C-10, C-23.

The verifier already wrote the feature gap "export did not write a file" into `gate.jsonl` at turn 3 for all 9 G export failures and all 5 C export failures, before any retry could happen. At turn 3 the gap appeared in C 10/30 and G 17/30 (one-sided Fisher p = 0.059), at a point where the two arms are treated identically (the gate sends nothing before turn 5; G had 0 violations in turns 1-4). So most of the M2 gap is already present before the gate acts. M2 difference one-sided Fisher p = 0.085, export difference p = 0.18, footer difference p = 0.21 (post-hoc, uncorrected, no claim of significance).

### C. What the gate does not feed back (post-hoc)

The retry text carries violations only. Feature gaps ("export did not write a file", "export file unavailable for footer check") were recorded in `gate.jsonl` but never sent to the model. In the 7 retried G runs with a missing export (G-03, G-07, G-13, G-19, G-22, G-23, G-28) the gap persisted to the end. Of the 4 G runs with no retry (G-04, G-09, G-26, G-30) all 4 failed M2.

### D. Not provable from this data (post-hoc)

Whether the retry itself ever cost a feature is not provable. Two retried G runs (G-08, G-12) lack the export footer at the end. The pre-retry state was not saved, so a loss by retry cannot be separated from a turn 5 miss.

### E. Verifier and oracle disagreement (post-hoc)

The single case is G-25 (`verifier_final_ok` true, oracle constraint 2 false, `decoy_respected` false, features all true, 1 retry). The verifier checks each timestamp token it finds with a pattern. `oracle.sh` checks that every non-comment data line ends in `Z` or `+00:00` (the oracle's constraint 2 check). The turn 1 summary of G-25 in `run.log` states the column order timestamp, user, action, so rows end with the action, not the timestamp. This is the likely cause, inferred from `run.log` text only: the final `cli.py` was not kept and the failure was not reproduced. **Hypothesis.**

Context for C: 29 of 30 C runs fail constraint 2 in the oracle because the plain footer line does not end in `Z`, so the oracle couples constraints 1 and 2 through the footer.

## Next-step candidates

Candidates only. No recommendation and no decision. This plan is closed.

1. Send verifier `feature_gaps` back in the retry text ("export did not write a file").
2. Retry text asks to keep every existing feature and names the files to look at again.
3. Move the first check earlier than turn 5 or add a check at the end of each turn for features, not only rules.
4. Save the pre-retry repo state per run so a retry-caused loss can be measured.
5. Align the verifier constraint 2 check with the oracle (line-end rule) or document the difference; then re-run only if a new plan is written.
6. Rerun with another model (new plan; this plan is closed, no n extension, section 2 rule).
7. Stop here: the lever as built trades function for constraints at haiku-4-5.

## Limits

One model (haiku-4-5), one task (t14), one retry cap (2). The verifier is the oracle in disguise (plan section 7), so M1 is a ceiling for what a rule-aware checker enforces. Run order alternated by pair parity. One auth stop (`STOP reason=auth` after G-18, resumed with the printed command, no data edited) and one `runner_timeout`. Old reinject rows are context only (CLI 2.1.204 vs 2.1.303). Post-hoc analysis is uncorrected and exploratory. Raw transcripts are not archived.

## Raw data location

Copied into the repo:

- `docs/plans/evidence/2026-10-19-t14-gate-experiment/results.jsonl`
- `docs/plans/evidence/2026-10-19-t14-gate-experiment/analysis.txt`
- `docs/plans/evidence/2026-10-19-t14-gate-experiment/schedule.json`

The raw runs directory is `/tmp/claude-<uid>/-home-<user>-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/t14-s5/out/runs` (60 run folders, 4.5 MB). It lives in session scratch and is not kept.
