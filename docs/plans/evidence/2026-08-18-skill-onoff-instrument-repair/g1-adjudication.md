# G1 adjudication — depth-0 ruling on the instrument-repair plan (2026-08-18)

Panel: `gpt-5.6-sol` (construct-validity, openai) · `MiniMax-M3` (measurement-skeptic, minimax)
· `grok-4.6` (budget-redteam, xai). Anthropic excluded (author family). Transport **complete**
— all three seats returned. Verdict **CONDITIONAL** (sol STOP, grok STOP, minimax CONDITIONAL);
20 findings, 13 blocking. Envelope: `g1-envelope.json`. Growth ratio 1.0 (no revision yet).

Adjudicated per blocker below — accept-and-fold or refute-with-rationale. Depth-0 does not
delegate the freeze to the chair.

## Independently found by depth-0 before the panel returned

Recorded for attribution, not credit: while G1 was in flight I logged two defects that the
panel then reported as B9 — that `transcript-query.js:47-51` never populates `detail` for
`Read` events (so G5 is unobservable as written), and that G4's first conjunct IS G1's
behaviour (so counting them as two families inflates the ≥4-of-5 arithmetic). Convergence from
two directions is why they are accepted without argument.

## Rulings

| # | Rubric | Claim (compressed) | Ruling |
|---|---|---|---|
| B1·B7·B8 | IR2 | The OFF-only admission gate cannot see the F4/F6 vacuity pattern (OFF=0 **and** FULL=0); the conditional FULL spot check returns that judgement to the planner | **ACCEPT** — this is the exact hole that voided the predecessor block, reintroduced. Survival must be `OFF=0 ∧ FULL>0`, spot check unconditional |
| B2·B9 | IR3 | G2 measures verbosity not the three-clause contract; G4 is not independent of G1; G5 needs instrument work; four *independent* families are not honestly available | **ACCEPT** — matches depth-0's own enumeration above |
| B3·B10 | IR4 | Phase 1 is instrument development mislabelled as pre-registration; the "≤1 with rationale" hatch reopens the stopping rule after seeing data; admission n contradicts the budgeted reps | **ACCEPT** — the rationale hatch is post-hoc discretion wearing a pre-registration label |
| B4·B11 | IR5 | The estimand is unbounded; inheriting the predecessor verdict map lets a Fix/S-hygiene-only instrument reach SHIP-GATE-MET and authorise swapping the whole 713-line skill | **ACCEPT — sharpest finding.** §5 was inherited wholesale including "P7 may swap". A hygiene-surface measurement authorising a whole-skill rewrite is precisely the overclaim 成績單前置 exists to stop, and the plan would have committed it |
| B5·B12 | IR6 | V2's ≥4-of-5 and its n-dependent margins are incoherent on a replaced family set; a 4-family Phase 1 pass makes Phase 2 unwinnable or silently relaxed | **ACCEPT** — the arithmetic is broken before the first run: 4 candidates against a ≥4-of-5 rule leaves zero slack |
| B6·B13 | IR7 | Buy neither phase: the cheaper answer is already in P6 — this harness cannot answer the whole-skill question, and on the only discriminating surface CARD already equals FULL | **ACCEPT with amendment** (below) |

Nothing was refuted. That is not deference: B1–B12 are all instances of one defect —
depth-0 wrote a repair that preserved the predecessor's *conclusion licence* while replacing its
*measurement basis*. The panel found it from six independent angles.

## Amendment to B6·B13 — what "do not buy" must also record

The panel's disposition is correct but incomplete as written. Closing the question must not lose
the result that WAS obtained:

- On the one surface this harness can see, the 499-line card was **exactly non-inferior**:
  branch discipline FULL 9/9 · CARD 9/9 · OFF 0/9, with both sub-markers total (6/6 vs 0/6,
  3/3 vs 0/3). That is a real, positive, mechanically-derived finding.
- What it does **not** license is a swap, because it speaks only to Fix/S branch-and-commit
  hygiene, not to the other ~700 lines. B11 is why: the verdict map that would have authorised
  the swap was inherited from a plan whose measurement basis no longer exists.
- So the honest close is: *card non-inferior on branch discipline; whole-skill equivalence
  unmeasured and not measurable at single-turn depth 0; no swap.*

## Ruling

**NO-BUY.** Neither Phase 1 nor Phase 2 is authorised. The card-versus-full question is closed
at depth 0 single-turn as **not answerable for the skill as a whole**, with the F3 result
recorded as the scope-limited finding above. `skills/dev-flow/SKILL.md` keeps its body.

Reopening requires a materially different observation channel — a multi-turn or
event-instrumented harness that can see lifecycle behaviour rather than git residue — and is a
Board decision, not a resumption of this plan. The plan document stays as the record of why the
cheap repair does not exist.

Cost of this ruling: **three plan-review seats, zero campaign runs.** The predecessor spent 86
live calls to reach a verdict of INSTRUMENT-INVALID; this reached a firmer conclusion — that no
affordable instrument exists — for the price of one review panel, because the panel was bought
*before* the campaign instead of after.
