# Frozen review rubric — Bounded Backlog Intake

Only these criteria may affect disposition or priority.

- R1: Trigger truth and incident evidence — score 0–20.
- R2: Risk reduction before the next managed Mission/L5/L6 campaign — score 0–20.
- R3: Dependency leverage and prevention of duplicate mutation/data loss — score 0–15.
- R4: Smallest independently shippable correction is explicit — score 0–15.
- R5: Objective done condition, negative control, and rollback boundary are explicit — score 0–15.
- R6: Scope is bounded to existing behavior; speculative architecture receives no score — score 0–10.
- R7: Deferral has a safe interim control and an observable trigger — score 0–5.
- R8: A no-finding conclusion identifies inspected candidate IDs and evidence; bare PASS is invalid.
- R9: A criticism without a concrete correction cannot block and becomes a follow-up at most.
- R10: The MVP portfolio contains at most three independently closable implementation plans.
- R11: Portfolio union is score-and-dependency gated; raw finding union is forbidden.

Priority bands:

- 80–100: `keep-now`
- 55–79: `follow-up`, unless required by a `keep-now` dependency
- 0–54: `cut`
