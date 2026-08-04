# Frozen rubric — Next-touch debt retirement

R1: The plan covers exactly the 14 admitted technical backlog entries and names each entry once.

R2: D1 through D8 form one dependency-ordered cumulative implementation lineage; tests, repairs,
review seats, and doc sync remain gates inside their owning deliverable rather than unbounded new
phases or duplicate work.

R3: Each deliverable has concrete implementation boundaries, acceptance commands, and observable
pass/fail criteria that exercise production paths rather than prose-only claims.

R4: The plan preserves authority separation: the implementer may smoke-test but cannot be the
authoritative verifier; the final review is independent, cross-family, and bound to the exact
frozen base SHA and candidate SHA.

R5: The plan enforces the two-repair-generation ceiling, same-lineage resume, fail-closed handling
of exhausted or invalid reviewer transport, and no generation-3 escape.

R6: Mission/resource reservations, D8 sample/capacity controls, admission-before-spend, and
terminal evidence are sufficient to prevent hidden scope, post-hoc sample shrinking, or budget
fabrication.

R7: D1–D8 preserve the current portability, generated-mirror, fail-closed, and no-backward-
compatibility requirements; unsupported platform capabilities remain explicitly bounded rather than
being claimed as implemented.

R8: Scope cuts are explicit: Board decisions, 29 trigger-conditioned entries, release/version/push,
and external publication are not silently pulled into this plan.

R9: The integrated completion gate is mechanically checkable and has a clear terminal condition for
implementation authorization, doc-sync, backlog removal, and project archival.

R10: The design chooses the simplest current implementation, avoids compatibility shims and second
authorities, and leaves no materially ambiguous open question that blocks execution.
