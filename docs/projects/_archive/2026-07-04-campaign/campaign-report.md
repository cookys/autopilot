# Quality-floor lift campaign R1 — report (2026-07-04)

**Setup**: 5 tasks × ON/OFF × 3 reps = 30 runs; runner cc / model sonnet, single-turn;
credential-only scratch-HOME isolation; identical oracles + required-artifacts contract in
both arms; OFF arm carries length-matched neutral padding. Raw: `campaign-results.jsonl`.

## Results
- **Oracle pass: 30/30, BOTH arms — ceiling effect.** Sonnet single-turn solves all five
  tasks with or without the assets. Combined with the earlier haiku floor (0/4 both arms),
  the current task set does not discriminate at either tested tier: haiku < floor,
  sonnet > ceiling.
- **Duration: no signal** (ON mean 139s vs OFF 147s; per-task deltas within noise at n=3).
- **Adherence** (the interesting part):
  - `patterns_named`: **80% ON vs 0% OFF** — the pack reliably changes vocabulary/framing
    (expected; semi-tautological).
  - `adjudication_valid`: **40% vs 40% — IDENTICAL.** The full protocol text in the ON pack
    did not improve compliance over the bare file-name requirement in the shared contract
    (the helper script is present in both arms).
  - `probe_evidence_present`: 40% vs 40% — identical.

## Honest conclusions
1. **No outcome lift is demonstrable in this configuration** — not because the assets fail,
   but because the instrument saturates: tasks too easy for sonnet, too hard for
   single-turn haiku.
2. **The strongest real finding is about MECHANISM**: prompt-pack guidance moved vocabulary
   (80/0) but NOT protocol compliance (40/40). What compliance existed came from the
   MECHANICAL side (a named required artifact + the tool being present). This is
   independent evidence FOR the plan's core thesis — the ladder's value concentrates in
   L0/L3 mechanical contracts, not in L1 prose packs — and against over-investing in
   longer prompt packs.
3. Caveats: n=3/cell; one model tier; single-turn `-p`; adherence fields are coarse.

## Designed follow-up (trigger-gated, NOT scheduled)
- R2 discriminating configurations, cheapest first: (a) a mid-tier between floor and
  ceiling (flash-class via agy runner — needs the agy-arm isolation gap closed first);
  (b) 2-3 HARD tasks (multi-file coupling, misleading symptom chains) aimed at sonnet's
  edge; (c) score gate-compliance as the primary axis (mechanical-contract ON/OFF as the
  manipulated variable, instead of prose packs).
- Trigger: an operator decision to spend again, informed by this report.

## R1b — haiku tier (same day, post permissions-fix): FIRST MEASURABLE LIFT

Same 5×2×3 design, model haiku (its earlier all-fail was the harness permissions defect;
this is its true tier).

- **Outcome: ON 12/15 (80%) vs OFF 9/15 (60%)** — the entire delta is
  **t2-extract-verbatim: ON 3/3 vs OFF 0/3**. With the acceptance-pattern pack (A3
  fidelity: reconstruct-and-diff, derive expectations mechanically), haiku produces
  byte-identical extractions; without it, 0/3 (reformats during the move). Fisher exact
  p≈0.05 at n=3/cell — suggestive, not conclusive.
- Tier map confirmed: t4 = haiku's floor (0/3 both arms), t1/t3/t5 = haiku's ceiling
  (100% both), t2 = the discriminating band.
- Adherence: adjudication 26.7% vs 13.3%, probe evidence 13.3% vs 0%, patterns 100% vs 0%.
- **Mechanism refinement**: the lift concentrated where the pack carries an OPERATIONAL
  PROCEDURE (the fidelity check recipe) — consistent with R1's finding that vocabulary
  alone changes nothing; procedure-shaped content is the L1 payload that works.
- R2 design implication: more procedure-differentiable tasks (t2-class) × more reps for a
  conclusive n; keep mechanical-contract-ON/OFF as a second manipulated variable.
