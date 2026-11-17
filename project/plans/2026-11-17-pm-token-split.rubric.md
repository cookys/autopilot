# Rubric — 2026-11-17-pm-token-split.md

> Source plan: project/plans/2026-11-17-pm-token-split.md

R1: Every work-order item (1)–(6) and the added plan-first gate maps to exactly one phase with a dev-flow size and a testable "done when" acceptance.
R2: Each phase names the concrete files, commands and output shape so a zero-context implementer can start without guessing; no load-bearing TODO/TBD.
R3: Each phase's acceptance includes a negative control (red before, green after) and one real run on the PM host.
R4: The switchboard runner cannot approve, open cards, dispatch new work, reply to the operator, touch credentials, extend deadlines or edit authority; shadow mode has no write tool; operator messages never enter it.
R5: The packet contract (≤ 1,500 tokens, ≤ 5 items, the listed item fields, auto-handled count + 3 samples, split never truncate) is enforced by deterministic code, not by the model.
R6: Non-PM sessions and sessions with the opt-in off see no behaviour change; every new hook/script is wired into the inventories the repo's checks read.
R7: The plan-first gate is reachable on both sides: a PM dispatch of Size M+ without a marker is refused at send, and a lane cannot reach implementation on such an order without a plan receipt; a mislabelled order has a stated recovery.
R8: The de-identification step fails closed before any consultant seat is called, and no Chinese-made model receives PM traffic.
R9: Phase dependencies and the A/B delivery split are explicit and consistent with the deadlines.
R10: Stated risks name a concrete failure (input/state → wrong result) with a mitigation; nothing is added that the work order did not ask for without being listed as out of scope or an open question.
