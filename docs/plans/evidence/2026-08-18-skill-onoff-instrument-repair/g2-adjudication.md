# G2 adjudication — terminal depth-0 ruling (2026-08-18)

G2 verdict **CONDITIONAL, terminal** (generation cap reached, `next_generation: null`). Same
three seats, transport complete. sol STOP; minimax and grok both moved STOP → CONDITIONAL.
Blocking findings 13 → **8**. Envelope: `g2-envelope.json`.

Per the standing rule, a cap-terminal CONDITIONAL is closed by depth-0 adjudicating every
residual blocker and freezing. **The freeze test is "no unresolved construct- or
mechanism-level finding", not "zero findings."** Below, five are accepted, two are partially
refuted, one is reclassified. This is a ruling, not a countersignature.

## Partial refutation — C1 · C7 (IR1, the shape diagnosis)

**Panel claim**: the per-marker table is *consistent with* a marker-shape defect but does not
causally establish it; difficulty, single-turn truncation and small-n noise remain live;
supply Fisher exact on 5/6 vs 3/6.

**Ruling: REFUTED for two of the three shapes, ACCEPTED for the third.** The three shapes are
not one epistemic kind and must not be treated as one:

- **Absence markers — deductive, no inference involved.** `f1_s_no_tracking` scores true when
  no project dir exists. The OFF arm has no skill telling it to create one, so it scores by
  inaction. This is entailed by the marker's definition, not estimated from three reps; a
  larger n cannot change it and no difficulty manipulation is relevant. Statistical critique
  does not reach it.
- **Base-rate markers — near-deductive via headroom.** OFF sits at 5/6 and 3/3. Whatever the
  true rate, the remaining discriminable interval is bounded by the ceiling. The claim "no
  headroom" follows from where OFF already is, not from a significance test.
- **Ceremony markers — ACCEPTED, this one IS an inference.** FULL 0/3–1/3 across d2 is small-n,
  and "single-turn headless does the work and skips the setup" is a hypothesis I did not
  falsify. Truncation, prompt framing and sampling noise are genuinely not excluded.

Repair: §1 states the first two as entailments and the third as an untested hypothesis. I do
not add Fisher exact for the base-rate cells — a significance test on a ceiling argument would
be ceremony of a different kind, and would imply the interval question is statistical when it
is structural.

## Reclassification — C3 (IR3, class `implementation-spike`)

**Panel claim**: the four families are not yet frozen executable fixtures and oracles.

**Ruling: TRUE but not a blocker on this decision.** The plan asks whether to *buy* the work of
building those fixtures. Requiring them to exist before that question can be answered is
circular. The seat classified it `implementation-spike`, which is the correct kind: it is a
**precondition on option C**, and it is recorded as one. It does not gate option A.

## Accepted

| # | Rubric | Ruling |
|---|---|---|
| C2 | IR2 | **ACCEPT.** `FULL > 0` is a floor, not a threshold. Frozen: equal OFF/FULL allocation, OFF = 0/3 and FULL ≥ 2/3, declared before any run |
| C4 | IR4 | **ACCEPT — and this is my regression, not the panel's pedantry.** R1 dropped the explicit `<4 survivors → STOP` rule when I compressed the plan to stay under the growth cap. Removing a stopping rule while shrinking a document is exactly how post-hoc discretion gets reintroduced. Restored |
| C5 | IR6 | **ACCEPT.** R1 promises a re-derived V2/V3 and does not supply the table. Under option A it is moot; under option C it is a hard precondition, and is recorded as one rather than as a promise |
| C6 | IR7 | **ACCEPT — sharp.** Option C was priced at ~21 runs for feasibility while its stated benefit ("a broader hygiene claim") requires an unpriced confirmatory 3-arm block. Relabelled feasibility-only, with the confirmatory phase named as unpriced |
| C8 | IR3 | **ACCEPT.** G5 is blocked on two prerequisites (`transcript-query.js` must emit `detail` for `Read`; the fixture needs a seeded `.claude/`), so counting it toward the ceiling was wishful. Moved to a spike list |

## The consequence the panel did not draw

C8 and C6 together settle the decision rather than merely improving the plan.

Dropping G5 leaves **three** admissible families, not four. Any inherited "≥4 of 5" is then
arithmetically unwinnable, and re-deriving V2 for three families means re-deriving it around a
set whose only *proven* member is the one P6 already measured. Meanwhile C6 establishes that
option C's ~21 runs buy feasibility only — the claim itself needs a further, unpriced campaign.

So the corrected picture is worse for buying than R1's was: **fewer families, and a higher true
price than the table stated.** Both corrections came from the panel; neither was available to
depth-0 when R1 recommended option A on other grounds.

## Terminal ruling

Freeze at R2. No construct- or mechanism-level finding is left unresolved: C1/C7 are answered
by separating entailment from inference, C3 is a precondition on a path not taken, and C2/C4/
C5/C6/C8 are folded into the document.

**Recommendation stands and is strengthened: option A.** Close the card-versus-full question at
depth 0 single-turn as not answerable for the skill as a whole; record that the card was
exactly non-inferior on branch discipline (FULL 9/9 · CARD 9/9 · OFF 0/9); no swap;
`skills/dev-flow/SKILL.md` keeps its body. Reopening requires a different observation channel
and is a fresh Board decision.

Total cost of reaching this conclusion: **two plan-review generations, zero campaign runs.**
The predecessor spent 86 live calls to learn its instrument was invalid.

## Owner ruling (2026-08-18): option B

The owner took neither the recommendation (A) nor the purchase (C), but **B — build a
multi-turn / event-instrumented harness**. That is a stronger reading of the same evidence than
depth-0's: A and B agree the single-turn harness cannot answer the question, and differ only on
whether the question is worth a new channel. The owner says it is.

Consequences, so the next session does not re-derive them:

- **This plan is retired, not paused.** It repairs the single-turn instrument; B replaces it.
- **Its constraints survive and bind the B design**: the shape taxonomy (§1 — absence and
  base-rate defects are entailments, ceremony is an untested hypothesis), the admissibility
  properties (positive · specific · cheap · non-default), the three-family ceiling under
  single-turn observation (§3), and above all §5 — **no instrument may carry a verdict map that
  licenses more than it measures**. That last one is what G1-B11 caught and is the reason this
  round existed.
- **The first hard constraint on B is already measured**: headless `claude -p` has **no
  TaskCreate tool** (Phase-0 probe, predecessor plan). Every dev-flow forcing function — L-1.6,
  L-5, H-9, S-scope-gate — is therefore unobservable in that runtime *regardless of turn count*.
  A multi-turn harness built on `claude -p` inherits that blindness; B must first establish which
  runtime can see forcing functions at all.
- What B is FOR is the whole-skill claim that A would have foreclosed: the ceremony hypothesis
  becomes testable (is L setup skipped because of truncation, or because the skill does not
  drive it?), and the families that died as "ceremony" return as candidates.
