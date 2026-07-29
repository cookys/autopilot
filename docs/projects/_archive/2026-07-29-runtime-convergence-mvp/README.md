# Runtime Convergence MVP

## Goal

Ship the three review-selected runtime correctness items as two independently closable
deliverables, then prove the combined tree has no known blocker before any release.

## Requirements ledger

| Requirement | Delivery |
|---|---|
| Continue in CEO mode `/l6`. | Mission admission was attempted, then failed closed to the permitted depth-0 fallback when the admitted graph proved inaccurate. Heterogeneous implementation and verification dispatch remained leaf-owned; depth 0 owns final acceptance. |
| Do not release until there are no known problems. | Version bump, tag, and release are explicitly excluded until terminal review and full regression pass. |
| Fix rotation and compaction correctness. | `durable-continuation-identity` deliverable. |
| Enforce reviewer panel minimum. | `qc-panel-honesty` deliverable. |
| Avoid another unbounded backlog sweep. | Only the three `keep-now` items are admitted; all other backlog entries remain excluded. |

## Deliverables

| Deliverable | Dependencies | Status |
|---|---|---|
| `durable-continuation-identity` | none | MERGED TO `develop` + REGRESSION GREEN (UNRELEASED) |
| `qc-panel-honesty` | `durable-continuation-identity` | MERGED TO `develop` + REGRESSION GREEN (UNRELEASED) |

The deliverables close independently but run in order because both must edit the engine boundary.
This prevents overlapping candidate diffs from hiding or reverting each other. Release is a later
human-authorized action, not a third deliverable.

## Verification

- `durable-continuation-identity`: durable Work Order v2 under the Git common directory,
  mandatory post-compaction reconciliation, strict process/lease/ledger identity, terminal
  receipt and exact-root binding, CAS duplicate prevention, forced rotation, and the exact
  recorded `16/34` replay with zero duplicate dispatch. Focused acceptance passes 189 assertions.
- `qc-panel-honesty`: undersized/full/single-seat panel matrix, then review-loop/task-status
  regressions, exact terminal-seat qualification, family diversity, receipt tamper rejection,
  and validated follow-up admission.
- combined: canonical invariants, sync/package checks, Sol High plus GLM High independent
  acceptance, and the complete clean-worktree regression suite.

## Admission-to-delivery correction

The first formal Mission attempt failed closed and the session continued through the
`/l6`-authorized depth-0 fallback. Adversarial review then expanded the accepted implementation
to the runtime-owned Work Order/reconciliation surfaces above rather than weakening the frozen
`16/34` acceptance. The final A9 candidate passed Sol High and GLM High review before integration.

The implementation was merged to `develop` in `e342bb5`; Codex payload and archive-routing
closeout fixes followed in `832b8e7` and `019456a`. No version bump, tag, release, remote push,
or publication was performed.

## Links

- [Durable continuation plan](../../plans/2026-07-29-durable-continuation-identity.md)
- [Durable continuation rubric](../../plans/2026-07-29-durable-continuation-identity.rubric.md)
- [QC panel plan](../../plans/2026-07-29-qc-panel-honesty.md)
- [QC panel rubric](../../plans/2026-07-29-qc-panel-honesty.rubric.md)
- [Selecting review](../2026-07-29-bounded-backlog-intake/reviews/joint-review.md)
