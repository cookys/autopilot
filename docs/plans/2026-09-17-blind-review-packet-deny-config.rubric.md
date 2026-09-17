# Rubric — 2026-09-17-blind-review-packet-deny-config.md

> Source plan: docs/plans/2026-09-17-blind-review-packet-deny-config.md

R1: The effective packet deny-list is always a superset of the shipped defaults; no configuration value, absent or present, valid or invalid, can remove a default pattern.
R2: The pattern grammar has exactly one owner (the packet builder's normalizer); every other validator of the same field is proven equivalent to it by a shared table, and an invalid element refuses the whole configuration before any seat is spent, with the offending element named.
R3: The configured extra patterns reach every managed review dispatch through the roster and the engine's packet identity, and a malformed value blocks at prepare time rather than falling back to the defaults silently.
R4: The effective list is visible and hash-bound through the existing manifest `deny_list` and `packet_hash` — no new receipt, attestation or trust artifact.
R5: The packet builder, the runner rail, the launcher and intake are byte-identical to base; the contract's always-on field set is unchanged and the schema/shell/JS parity gate is green.
R6: Tests are RED-first with the observed base message; a planted path is shown denied by an extra pattern with a different hash; no assertion is weakened.
R7: Every command in plan §4.1 exits 0 at the candidate and the same set was green at base before sealing (detached checkout).
R8: Docs — the deny-list paragraph, the config field documentation, the template and the BACKLOG redesign row (Context ≤240 bytes, Status `open`) are updated with their mirrors in sync.
