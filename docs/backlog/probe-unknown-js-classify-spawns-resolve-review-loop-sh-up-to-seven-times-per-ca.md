# `probe-unknown.js classify` spawns `resolve-review-loop.sh` up to seven times per call — memoize one resolver invocation

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a foreman round-end ledger or `cost-tracker` sample showing `probe-unknown.js classify` taking ≥ 10 s wall time, or a round that runs classify ≥ 3 times (each resolver spawn is a full config + topology resolution with a 15 s timeout).
- **Context**: v2.36.15 P1/P2 read `unknown_escalation`, the three budgets, `consult_dispatch`, `consult_resolved_from` and `unknown_resolved_from` through separate `resolve-review-loop.sh --field` calls (`scripts/probe-unknown.js` resolverField). The resolver already emits all seven in one JSON; one `resolve-review-loop.sh` run parsed once would replace them. Correctness is unaffected (every call site pins the flags in tests); this is cost only. Raised by the pre-merge reviewer (delta pass 3) as CUT/FOLLOW-UP.
- **Effort**: S
- **Source**: pre-merge review of `feat/v2.36.15-unknown-escalation-ladder`, 2026-09-07.

