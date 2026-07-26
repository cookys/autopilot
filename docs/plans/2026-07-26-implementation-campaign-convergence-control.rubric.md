# Frozen rubric — implementation campaign convergence control

- R1: The plan addresses the actual incident class: canonical implementation work can bypass existing scope, finding-disposition, convergence, and durability controls.
- R2: The proposed controller has one machine-owned immutable contract and state model, with explicit pre-spend failure and resume semantics.
- R3: `spike`/`poc` produce the smallest testable vertical slice under bounded generation, wall-clock, file, and churn limits without waiving immediate integrity or authorization defects.
- R4: Reviewer findings cannot redefine the ticket: every actionable Critical/Major has one disposition and only complete `must-fix-now` findings authorize repair.
- R5: The design reuses existing Autopilot mechanisms rather than adding competing finding, scope, convergence, or ledger sources of truth.
- R6: Canonical `/l5`, `/l6`, and `engine implement-review` routing cannot silently bypass the campaign controller, while low-level primitives remain usable inside the controller and for diagnostics.
- R7: Durability and observability cover process death, context/session changes, dispatch identity, endpoint normalization, invalid output, and branch/worktree cleanup without resetting budgets.
- R8: The phased implementation is concrete, dependency-ordered, testable, and bounded to Autopilot flow correction; it excludes Revival product work and unrelated harness redesign.
- R9: Acceptance includes a synthetic 057-shaped regression and a production-profile control proving the policy distinguishes deferrable POC hardening from explicitly required production behavior.
- R10: The plan has no unresolved Board decision that would force an implementer to invent product policy or scope.
