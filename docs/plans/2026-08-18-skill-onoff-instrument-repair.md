# skill-onoff instrument repair — R2 (FROZEN; all G1 and G2 blockers adjudicated)

**Status**: R2 FROZEN, **RETIRED — owner ruled option B (2026-08-18)**. Neither Phase 1 nor
Phase 2 is bought and this plan is not resumed: it repairs the single-turn harness, and option B
replaces that harness rather than repairing it. What this document is now FOR is the record of
why the cheap repair does not exist — §1's shape taxonomy, §3's three-family ceiling, §5's
"a hygiene instrument cannot license a whole-skill swap" — all of which are binding constraints
on the option-B design. Terminal after G2 (generation cap). G1 verdict CONDITIONAL (sol STOP, grok STOP,
minimax CONDITIONAL); all 13 blockers adjudicated `accepted_blocker`, none refuted
(`evidence/…/g1-adjudication.md`, `…/g1-dispositions.json`).
**Predecessor**: `2026-08-18-dev-flow-contract-card.md` (FROZEN R2) — INSTRUMENT-INVALID,
1 of 5 families load-bearing.

## 1. Diagnosis

P6 recorded the repair direction as "harder tasks where sonnet's base rate drops". The
per-marker breakdown says the defect is marker SHAPE. **The three shapes are not one epistemic
kind** (G2-C1/C7), and the plan states each at its true strength:

- **Absence** markers — **entailed**. `f1_s_no_tracking` is true when no project dir exists;
  the OFF arm scores it by inaction. That follows from the marker's definition, so neither a
  larger n nor a difficulty manipulation can change it.
- **Base rate** markers — **entailed via headroom**. OFF already sits at 5/6 and 3/3, which
  bounds the discriminable interval structurally, not statistically.
- **Ceremony** markers — **hypothesis, not established**. FULL 0/3–1/3 is small-n, and
  "single-turn headless does the work and skips the setup" was not falsified. Truncation,
  prompt framing and sampling noise remain live alternatives.

Difficulty fixes neither entailed shape. Full table, the four properties F3's working markers
share, and the exhaustive enumeration of admissible behaviours:
`evidence/2026-08-18-skill-onoff-instrument-repair/marker-shape-analysis.md`.

**The enumeration yields four admissible-in-principle families plus one marginal; §3 then drops
one of the four as prerequisite-blocked, leaving three available** — counted
before any spend, not discovered after.

## 2. Absorbed since P6

- **The old F6 marker is invalid**, not weak: v2.34.19 scoped the quality-gate rule by size,
  so at Fix size `lint + test` *is* compliance. Requiring `Skill(quality-pipeline)` would
  measure a claim the body no longer makes.
- **All three packs re-freeze.** `skills/dev-flow/SKILL.md` changed bytes in v2.34.19, so
  `packs/dev-flow-full/` is a historical fixture. **P6 cells are therefore NOT comparable to
  any new block** (G1-B12) — no cross-campaign inference is permitted.

## 3. Corrected family set (G1-B2/B9)

| # | Family | Marker | Status |
|---|---|---|---|
| G1 | Branch discipline **incl. cleanup** | `fix/*` created → merged to develop → branch gone; `hotfix/*` from main, `--no-ff` to main | proven (6/6 vs 0/6, 3/3 vs 0/3); cleanup folded in, **not counted separately** |
| G2 | Commit-message contract | three clause predicates (root cause · what was wrong · how fixed) as fixture-specific greps — **line count is rejected as a proxy** | needs authoring; drop if predicates cannot be made fixture-specific |
| G3 | Maintenance ledger | row matches `\| MM-DD \| <sha> \| fix(...)` in a **pre-seeded** ledger file | needs fixture repair (the old task made the model invent a `docs/` tree) |
| ~~G5~~ | Config injection | `Read` of `.claude/test-strategy-config.md` before the first test run | **SPIKE LIST, not a candidate** (G2-C8): `transcript-query.js` emits no `detail` for `Read`, and the fixture has no `.claude/`. Counting a prerequisite-blocked family toward the ceiling was wishful |

G4 is deleted as a family — its first conjunct *is* G1's behaviour, so counting both inflated
the threshold arithmetic. **Maximum independent families available: three** (G1, G2, G3), of
which only G1 is proven. Any inherited "≥4 of 5" is therefore arithmetically unwinnable.

## 4. Corrected admission (G1-B1/B7/B8/B3/B10)

- Survival requires **OFF = 0/3 AND FULL ≥ 2/3**, at equal OFF/FULL allocation, declared before
  any run (G2-C2 — `FULL > 0` is a floor, not a threshold). An OFF-zero marker that FULL also
  scores zero on is vacuous: that is precisely how F4 and F6 died, and an OFF-only screen
  cannot see it.
- The FULL spot check is **unconditional** on every OFF-zero survivor, not left to judgement.
- **Stop rule, restored (G2-C4): fewer than four surviving families → STOP**, no Phase 2. This
  line was lost when R1 was compressed to stay under the growth cap; dropping a stopping rule
  while shrinking a document is exactly how post-hoc discretion returns. With the ceiling now
  at three (§3), this rule fires before Phase 1 is even bought.
- **The "≤1 with rationale" hatch is deleted.** It was post-hoc discretion wearing a
  pre-registration label.
- Phase 1 is **instrument development**, not pre-registration. Pre-registration attaches only
  to Phase 2, over data Phase 1 never saw. The candidate list above is frozen as **exhaustive**
  before any live run; no family may be added after seeing results.
- Per-marker n and reps are stated with the budget in §6, not left to differ from it.

## 5. Corrected verdict rules (G1-B4/B11/B5/B12)

- **The swap branch is removed.** No Phase 2 outcome authorizes replacing
  `skills/dev-flow/SKILL.md`. The predecessor's map (SHIP-GATE-MET → "P7 may swap") was
  inherited while its measurement basis was replaced; a Fix/S-hygiene instrument cannot license
  a whole-skill rewrite.
- **Estimand, pre-declared**: *the card is non-inferior to the full body on Fix/S
  branch-and-commit hygiene, for sonnet-class single-turn depth 0, on this task set and this
  skill version.* Whole-skill equivalence is **not measured and not claimable**.
- **V2 must be re-derived** as a function of the surviving *independent* family count, with
  per-family n, exclusions, minimum evaluable pairs and margins written **before** Phase 1.
  This is a **precondition on option C, not a promise** (G2-C5): the table does not exist and
  the plan does not pretend otherwise. Under option A it is moot. Fixture and oracle authoring
  for G2/G3 is likewise a precondition on C, not a defect in this decision (G2-C3).

## 6. Options and recommendation (G1-B6/B13)

| | Option | Cost | What it buys |
|---|---|---|---|
| **A** | **Close the question at depth 0** | zero runs | Records: card non-inferior on branch discipline (FULL 9/9 · CARD 9/9 · OFF 0/9); whole-skill equivalence unmeasured and unmeasurable here; no swap |
| B | Multi-turn / event-instrumented harness | large, undesigned | The only path to a whole-skill claim; a new Board decision, not a resumption of this plan |
| C | Narrowed Phase 1 — **feasibility only** (G2-C6) | ~21 runs, **plus an unpriced confirmatory 3-arm campaign** before any claim exists | Whether three families can be made to discriminate. It does **not** by itself yield a hygiene claim, and no outcome authorizes a swap (§5) |

**Recommendation: A**, and G2 strengthened it from both ends. C8 dropped G5 to the spike list,
so the ceiling is **three** families and §4's stop rule fires before Phase 1 is bought. C6
established that C's ~21 runs buy feasibility only — the claim itself needs a further,
unpriced campaign. Fewer families and a higher true price than R1 stated; neither correction
was available to depth-0 when R1 recommended A on other grounds.

**Evidence that would change this**: if the three candidate families were shown to cover a
behaviour the owner considers *decision-relevant on its own* — i.e. if "the card preserves
Fix/S hygiene" were itself the thing being bought, rather than a proxy for whole-skill
equivalence — then C becomes rational and should be authorized at the stated ~21 runs.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Closing hides a real regression the card would introduce | The card is not shipping; there is nothing to protect. Reopen with option B if it ever ships |
| "Not answerable" becomes a habit of retiring hard questions | The scope limit is recorded with its measured basis, so reopening needs only a better channel, not a re-argument |
| Option C is chosen and still cannot conclude | §4's OFF=0 ∧ FULL>0 rule makes the vacuous case a Phase 1 stop rather than a Phase 2 surprise |
| Instrument repaired to fit the answer | The swap branch is gone, so there is no answer left to fit toward |
