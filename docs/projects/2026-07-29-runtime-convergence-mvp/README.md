# Runtime Convergence MVP

## Goal

Ship the three review-selected runtime correctness items as two independently closable
deliverables, then prove the combined tree has no known blocker before any release.

## Requirements ledger

| Requirement | Delivery |
|---|---|
| Continue in CEO mode `/l6`. | Mission admission plus heterogeneous implementation and verification dispatch; depth 0 owns final acceptance. |
| Do not release until there are no known problems. | Version bump, tag, and release are explicitly excluded until terminal review and full regression pass. |
| Fix rotation and compaction correctness. | `durable-continuation-identity` deliverable. |
| Enforce reviewer panel minimum. | `qc-panel-honesty` deliverable. |
| Avoid another unbounded backlog sweep. | Only the three `keep-now` items are admitted; all other backlog entries remain excluded. |

## Deliverables

| Deliverable | Dependencies | Status |
|---|---|---|
| `durable-continuation-identity` | none | ADMISSION BOOTSTRAP |
| `qc-panel-honesty` | `durable-continuation-identity` | ADMISSION BOOTSTRAP |

The deliverables close independently but run in order because both must edit the engine boundary.
This prevents overlapping candidate diffs from hiding or reverting each other. Release is a later
human-authorized action, not a third deliverable.

## Verification

- `durable-continuation-identity`: focused forced-rotation and `16/34` compaction replay oracles,
  then campaign/ledger/Mission regressions.
- `qc-panel-honesty`: undersized/full/single-seat panel matrix, then review-loop/task-status
  regressions.
- combined: canonical invariants, completeness, secret scan, and heterogeneous terminal review.

## Links

- [Durable continuation plan](../../plans/2026-07-29-durable-continuation-identity.md)
- [Durable continuation rubric](../../plans/2026-07-29-durable-continuation-identity.rubric.md)
- [QC panel plan](../../plans/2026-07-29-qc-panel-honesty.md)
- [QC panel rubric](../../plans/2026-07-29-qc-panel-honesty.rubric.md)
- [Selecting review](../_archive/2026-07-29-bounded-backlog-intake/reviews/joint-review.md)
