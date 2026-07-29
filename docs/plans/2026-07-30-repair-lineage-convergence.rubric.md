# Repair Lineage Convergence Rubric

## R1 Stable lineage

Initial implementation and authorized repairs retain one campaign-bound branch and worktree; no
repair branch factory or successor checkout is used.

## R2 Provider session reuse

The Grok rail captures a session identity and resumes that exact session for repairs. Unsupported,
missing, ambiguous, or mismatched session evidence fails closed and is disclosed.

## R3 Bounded convergence

Normalized finding recurrence and non-reduction are counted across the durable campaign lineage.
The second recurrence or second non-reducing round stops before model spend with
`awaiting_convergence_adjudication`.

## R4 Context preservation

Repair input binds the prior commit, unresolved finding IDs, accepted invariants, no-regression
assertions, review scope, and full-diff versus focused-delta mode.

## R5 Durable accounting

Receipts and resumed state bind lineage, branch, worktree, provider session, generation, inherited
churn, delta churn, reuse outcome, and terminal worktree disposition without trusting model prose.

## R6 Cleanup and containment

Terminal clean outcomes remove the retained worktree once. Dirty, missing, foreign, or identity-
mismatched worktrees are blocked and remain explicitly owned for adjudication.

## R7 Regression safety

Campaign, dispatcher, continuation, compaction, lifecycle-budget, canonical invariant, and full
hook suites pass without modifying user-owned dirty files.
