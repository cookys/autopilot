# Rubric — 2026-09-18-blind-review-panel-station.md

> Source plan: docs/plans/2026-09-18-blind-review-panel-station.md

R1: When intake sealed a complete panel, the implementation loop's review station is that panel — no single reviewer seat is dispatched — and the station's receipt is consumed by the loop adjudication exactly as a single review is: must-fix findings authorise a bounded repair round after which the panel reviews the repaired candidate; findings without an authority park the campaign durably; a panel below quorum blocks or parks with the quorum reason and never degrades to one seat.
R2: The terminal panel station never spends a second panel on a candidate tree the station already reviewed with the same sealed roster and packet identity; the terminal receipt keeps its shape and its adjudication semantics.
R3: The station choice is resolved once at intake, sealed in the panel snapshot with its digest, read only from the snapshot at run time, and a live value that differs is recorded as drift; an input without a snapshot or sealed to the single station is byte-identical to base in trace, ledger and receipts.
R4: A candidate's review packet is built and its tree integrity verified once per candidate; every seat launches against a private materialisation of that build and reports the shared build's hash; the hash equals the one a per-seat build produces at base, and no seat can write into another seat's view.
R5: Batched tree hashing yields the same verdict and the same error text as per-file hashing, including symlinks and unusual file names.
R6: Runner rail, cleanroom launcher, fan-out helper and every resolver except the review-loop resolver are byte-identical to base; the panel aggregation rule, seat timeouts, pocket and verify-once are unchanged.
R7: Tests are RED-first with the observed base message and cover: panel-as-station with a repair round and terminal reuse, the single/no-snapshot controls, the below-quorum station, the sealed knob and its drift, one build per panel with equal hashes and distinct seat dirs, batched-vs-per-file hashing; no assertion is weakened.
R8: Every command in plan §4.1 exits 0 at each candidate and the same set was green at base before sealing (detached checkout); docs, both review-loop-config documents, the l5 recipe and the BACKLOG rows are updated with mirrors in sync.
