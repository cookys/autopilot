# Campaign R2 report — relatable tasks, discriminating band (2026-07-04)

**Setup**: {t2 extract-verbatim, t6 version-bump, t7 config-rename, t8 log-redaction} ×
ON/OFF × 5 reps × haiku = 40 runs. New tasks are everyday-dev-work scenarios with
real-incident provenance (documented in evals README). Raw: `r2-results.jsonl`.

## Results
| Task | ON | OFF | Δ |
|---|---|---|---|
| **t2 extract-verbatim** | **80% (4/5)** | **0% (0/5)** | **+80pp — REPLICATED** |
| t6 version-bump | 60% | 60% | 0 |
| t7 config-rename | 60% | 60% | 0 |
| t8 log-redaction | 60% | 60% | 0 |

- **t2's procedure-lift replicated at n=5** (cumulative with R1b: ON 7/8 vs OFF 0/8 —
  Fisher exact p≈0.001; this is now a REAL effect, not noise).
- The three new relatable tasks: identical 60%/60% — haiku's general competence handles
  them at the same rate with or without the pack, and the pack's procedures don't target
  their failure modes (the misses are execution slips — a forgotten fourth version site, a
  missed error path — not procedure-absence).
- Adherence collapse vs R1b (adjudication 0/40, probe 0/40): the band tasks have no
  REVIEW-NOTES decoy (except none here) — nothing to adjudicate; patterns_named 65%/0%
  consistent with prior rounds.

## Reading (honest)
1. **The pack lifts outcomes precisely where its procedures match the task's dominant
   failure mode** (byte-fidelity discipline vs haiku's reformat instinct: +80pp,
   p≈0.001 cumulative). Where the failure mode is attention/coverage slips (t6/t7/t8),
   a static prompt pack does nothing — those are the L0-gate classes (a version-grep
   script, an error-path enumerator), which is EXACTLY the ladder's claim: demote to
   scripts, don't write more prose.
2. Relatable tasks worked as intended: everyday scenarios, no contrivance complaints
   possible, and they cleanly exposed the pack's boundary.
3. Caveats: single tier (haiku), single-turn, n=5/cell on new tasks.

## R2 conclusions → design consequences (trigger-gated R3 candidates)
- Procedure-shaped L1 content: KEEP; grow the acceptance-pattern menu with more
  operational recipes (each new pattern should name its target failure mode).
- t6/t7/t8-class misses: candidates for L0 mechanical gates in real pipelines
  (version-sync grep already exists in this repo as `sync-version.js --check` — the eval
  independently re-derived why it exists).
- R3 (operator decision): mechanical-contract ON/OFF as the manipulated variable on
  t6/t7/t8 (e.g. a required grep-evidence artifact) — tests the L0 half of the thesis.

## CORRECTION (same day) — 15 runs were auth-dead; clean re-analysis SUPERSEDES the above

A Claude Code re-login mid-campaign killed 15/40 runs (1-2s duration, "Not logged in",
all mis-scored as failures). Detected post-publication by a duration sanity sweep;
the 15 slots were re-run after auth restore (all healthy). Clean data (n=5/cell, all live,
`r2-results-clean.jsonl`):

| Task | ON | OFF |
|---|---|---|
| **t2 extract-verbatim** | **5/5** | **0/5** — perfect separation (p≈0.004; cumulative with R1b: 8/8 vs 0/8, p≈0.0001) |
| t6 / t7 / t8 | 5/5 | 5/5 — **ceiling for haiku, both arms** |

**Retractions vs the original reading:**
1. The "60%/60% attention-slip failures → L0-gate territory" narrative was ENTIRELY a
   dead-run artifact — haiku aces t6/t7/t8 with or without the pack. The L0-gate thesis
   may still be true but THIS experiment provides no evidence for it; the
   "eval re-derived sync-version --check" flourish is withdrawn.
2. The t2 effect is STRONGER than originally reported (perfect 5/5 vs 0/5 separation).
3. Adherence (clean): patterns 20/20 vs 0/20; adjudication ~0 both arms (these tasks give
   nothing to adjudicate — field is inapplicable here, not a compliance signal).

**Process lesson (shipped to memory + BACKLOG'd for the scorer): run-health validation
BEFORE scoring — any run with duration under a sanity floor is invalid, never a data point.
Silent infrastructure failure mimicking a negative result is precisely the false-signal
class this whole engine exists to catch; this time it caught US.**
