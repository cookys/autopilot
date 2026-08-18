# Frozen review rubric — skill-onoff instrument repair plan

IR1: Diagnosis validity. The plan claims the predecessor block failed because of marker
SHAPE (absence / ceremony / base-rate), not task difficulty, and cites a per-marker
FULL/CARD/OFF table. Is that classification actually entailed by those numbers? Is there a
competing explanation the table also fits — for example that the tasks were too easy, that
single-turn truncation dominates, or that three reps is too few to distinguish 5/6 from 3/6?
Does any marker get misclassified? If the diagnosis is wrong, the whole repair is aimed at the
wrong lever.

IR2: Admissibility rule and its blind spot. The plan admits a marker only if an OFF-arm pilot
measures its base rate at 0 (or <=1 with rationale), plus four qualitative criteria (positive,
specific, cheap, non-default). An OFF-zero marker that FULL also scores zero on is still
vacuous — that is exactly how F4 and F6 died, and the pilot as specified CANNOT see it, since
the FULL spot check is conditional and left to judgment. Is the gate therefore incomplete? What
is the minimum FULL-side evidence needed before freezing, and does making it unconditional cost
more than it saves?

IR3: Candidate families. G2 (commit body non-empty / >=3 lines), G3 (ledger row appended to a
pre-seeded file), G4 (fix branch created AND deleted after merge), G5 (Read event on
`.claude/test-strategy-config.md` before the first test run). For each: is it genuinely
non-default for a competent model without the skill, or a base-rate behaviour in disguise? Is
each mechanically observable in single-turn headless (no TaskCreate tool exists there)? Is G4's
conjunction actually immune to the absence-marker defect it claims to solve? Is G2 gameable or
so weak that it measures verbosity rather than the commit-message contract?

IR4: Pre-registration integrity. Phase 1 is OFF-arm only and is claimed to be untunable toward
a card verdict because it cannot see FULL or CARD. Is that argument sound, or does selecting
which markers survive on OFF data still bias the eventual FULL-vs-CARD comparison? Does Phase 1
data leak into Phase 2's frozen set in a way that breaks pre-registration? Is the <4-family
stopping rule genuinely falsifiable and stated before the data, or is it re-openable after a
disappointing result?

IR5: Claim scope after repair. The plan concedes that L-size ceremony is unobservable at
single-turn depth 0. If the family set is rebuilt entirely from Fix/S-shaped, cheap, positive
markers, what is the resulting claim actually about — the skill as a whole, or only its
branch-and-commit hygiene surface? Can a card be declared non-inferior on that basis without
overclaiming? If the honest answer is "this harness can only ever measure a narrow surface",
say so plainly, because that changes whether Phase 2 is worth buying at all.

IR6: Carry-over coherence. V1/V2/V3, the verdict map, paired exclusion and the >=4-of-5
threshold are inherited unchanged from the frozen predecessor plan while the family SET is
replaced. Is that coherent — do the n-dependent V2 margins (>=3 for n=9, >=2 for n<=6) still
mean the same thing under the new families? All three packs are re-frozen because the live
dev-flow body changed in v2.34.19: does that make any comparison with the previous block
invalid, and is the plan honest about that?

IR7: Cheaper or better alternatives. Is there a materially cheaper design that answers the same
question — a different observation channel, a multi-turn harness, a different subject model, or
simply retiring the card question as unanswerable at depth 0? Argue the strongest case AGAINST
buying either phase, and say what evidence would change your mind.
