# Rubric — 2026-09-18-blind-review-panel-parallel.md

> Source plan: docs/plans/2026-09-18-blind-review-panel-parallel.md

R1: Final-panel seats execute concurrently in separate processes, yet every artifact — seat receipts, the panel digest, ledger rows — is identical to a sequential run in seat-index order; completion order is never observable.
R2: There is exactly one launch path for review dispatch, and a single-seat dispatch through it is byte-identical to today's; the composer remains synchronous.
R3: A panel seat's timeout is the whole budget available to the panel, never a per-seat share, and no seat is ever handed more than its consumer's remaining budget.
R4: The panel's extra budget is a sealed, bounded contract limit visible in the ledger; with it unset behaviour is unchanged, and when both wall and pocket are spent the panel is refused before any seat is spent.
R5: The full-suite station reuses a verification receipt only when the receipt's complete identity (tree, full sealed argv, environment) equals its own request and the receipt is a green, attested, detached-checkout run; a focused or stale receipt can never satisfy it; the sealed knob can only force a fresh run.
R6: Tests are RED-first with the observed base message; concurrency is exercised with real processes of distinct durations; the packet builder, runner rail, launcher and resolver are byte-identical to base; no assertion is weakened.
R7: Every command in plan §4.1 exits 0 at the candidate and the same set was green at base before sealing (detached checkout).
R8: Docs — the panel-execution paragraph, the l5 recipe sentences, the scripts inventory row, the CLAUDE.md group and the BACKLOG rows are updated with mirrors in sync.
