# The code-review severity table edit shipped without its own ON/OFF evidence

BL-0323. Source: bltidy20 handoff list, 2026-10-28.

The findings-batch guidance (a98e37668, BL-0295 P2) said a Major is fixed after the pooled round, while the 4-Tier table in `skills/quality-pipeline/references/code-review.md` said "Fix immediately, before commit". The evaluated change arm of the findings-batch run did not include that table. The literal contradiction was removed afterwards in 33224ad72 (the Critical and Major rows now point at the Findings Batch section and say it governs, and the Re-review Loop section carries a priority sentence).

What is left: that table edit and priority sentence are guidance changes that no ON/OFF run measured. Per the scorecard-first rule they need evidence, or an explicit owner acceptance that they are a consistency fix to wording already evaluated. A single (non-parallel) lane is meant to be unchanged; that has not been measured either.
