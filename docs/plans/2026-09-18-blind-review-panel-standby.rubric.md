# Rubric — 2026-09-18-blind-review-panel-standby.md

> Source plan: docs/plans/2026-09-18-blind-review-panel-standby.md

R1: The sealed minimum panel size is a quorum: a panel with at least that many reviewed seats, the required family diversity among them, consistent findings and one packet identity is reviewed even when other dispatched seats failed; with fewer reviewed seats than the minimum the first failure blocks as today.
R2: Every dispatched seat keeps a receipt row with its status and reason; a seat that is not load-bearing is marked so explicitly, and the terminal receipt states whether the quorum was met; the validator re-derives both from the rows and refuses any receipt whose flags disagree with its rows.
R3: Family diversity is checked twice — over the sealed roster before any spend and over the reviewed seats after the batch — and neither check can be satisfied by a failed seat.
R4: Intake records the admitted panel (seat tuples in order, minimum, family requirement) once, durably in its receipt, and the final panel resolves from that record; a live roster that differs is recorded as drift and never wins; an input without a record behaves exactly as before.
R5: No new roster field, no new seat status, no change to the 2-A launch path, timeouts, pocket or verify-once; runner rail, helper, packet builder and resolvers are byte-identical to base.
R6: Tests are RED-first with the observed base message and cover the quorum-met-with-failure, quorum-missed, families-lost-after-failure, snapshot-wins-over-drift and no-snapshot cases; no assertion is weakened.
R7: Every command in plan §4.1 exits 0 at the candidate and the same set was green at base before sealing (detached checkout).
R8: Docs — the panel-execution paragraphs, both review-loop-config documents, the l5 recipe sentence and the BACKLOG redesign row (Context ≤240 bytes, Status `open`) are updated with mirrors in sync.
