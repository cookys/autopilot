# Controller Execution Discipline Rubric

## R1 Frozen denominator

The admitted Mission graph is the only project/deliverable denominator. Findings, retries,
verification batches, repair tickets, and review rounds cannot add phases or deliverables.

## R2 One durable work order

One deliverable retains one backward-compatible Work Order across implementation, review, repair,
compaction, recovery, and completion. Repair tickets and audit events append without creating a
successor identity.

## R3 Full-diff-before-repair

Every candidate generation has exactly one authoritative frozen-base-to-candidate full-diff
verdict before repair spend. Focused delta review is supplemental and cannot impersonate it.

## R4 Mechanical progress and gates

Digest-bound progress receipts expose completed/remaining denominator, active process, blockage,
ETA basis, gate owner/input/timing/result, and resource debt. Matching successful gates are reused;
drift requires an explicit invalidation.

## R5 Joint repair budget

Model calls, fresh input bytes/tokens, wall time, owned worktrees, and finding recurrence are
counted on one lineage. Any observable overage stops before effects in
`awaiting_convergence_adjudication`; unobservable telemetry is disclosed rather than zero-filled.

## R6 Executable Mission delta

Admission distinguishes allowed paths, required changed paths, and explicit creates; verifies
generator/version closure; rejects historical replay; and can adopt a byte-bound completed no-op
without cosmetic mutation or attempt spend.

## R7 Honest terminal semantics

`boundary_rejected` preserves its candidate and reason. Valid findings without disposition wait
durably and resume on the same work order; malformed or mismatched authority remains fail-closed.

## R8 Exact capability identity

Live observation and strict admission use the same runner/model/effort/endpoint key. Legacy,
neighboring, stale, or probe-only evidence cannot authorize an exact tuple or role qualification.

## R9 Recovery and resource debt

Post-compaction/restart recovery mechanically reconciles Git, rotation-aware ledger, manifests,
worktrees, resource dispositions, and process parentage before managed effects. Unknown, dirty,
unique, over-capacity, or undispositioned resources block new checkout/runner spend.

## R10 Orphan adoption

A proven-dead controller's exact completed leaf can be adopted once with bound result/Git/scope/
digest/generation evidence and no duplicate mutation. Ambiguous evidence is preserved and stopped.

## R11 Compatibility and containment

Schema-2 work orders, legacy Mission graphs, existing campaign/repair/rotation behavior, and
canonical Codex payload remain compatible. User-owned dirty hook-probe files and stashes are not
modified or committed.

## R12 Combined acceptance

Focused deterministic tests and the full repository suite pass, followed by one blind full-diff
joint review with no unresolved Critical or Major findings. No intermediate seam becomes a
separate QC phase.
