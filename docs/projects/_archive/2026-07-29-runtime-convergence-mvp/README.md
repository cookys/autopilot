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
| `durable-continuation-identity` | none | IMPLEMENTED + REGRESSION GREEN (UNRELEASED) |
| `qc-panel-honesty` | `durable-continuation-identity` | IMPLEMENTED + REGRESSION GREEN (UNRELEASED) |

The deliverables close independently but run in order because both must edit the engine boundary.
This prevents overlapping candidate diffs from hiding or reverting each other. Release is a later
human-authorized action, not a third deliverable.

## Verification

- `durable-continuation-identity`: focused forced-rotation, managed phase/generation/Git-bound
  resume, zero-duplicate-dispatch, and campaign/ledger/Mission regressions. The original
  admission target named a literal `16/34` replay and three rehydration artifacts that do not
  exist in the accepted implementation; the executable proof uses the runtime's supported
  campaign phases instead.
- `qc-panel-honesty`: undersized/full/single-seat panel matrix, then review-loop/task-status
  regressions, exact terminal-seat qualification, family diversity, receipt tamper rejection,
  and validated follow-up admission.
- combined: canonical invariants, completeness, secret scan, and a clean detached-worktree
  full regression run: `ALL TESTS PASSED (248 test files)`.

## Admission-to-delivery correction

The committed execution graph is the corrected current graph, not a claim that the first formal
Mission attempt completed successfully. That attempt failed closed and the session continued
through the `/l6`-authorized depth-0 fallback. During bounded repair review:

- the proposed generic `scripts/compaction-rehydrate.js`,
  `src/engine/continuation-admission.js`, and
  `hooks/tests/codex-compaction-rehydration.test.sh` surfaces were removed rather than shipped
  without an authoritative runtime owner;
- exact numeric `16/34` replay was replaced by executable phase/generation/Git identity
  assertions and a zero-duplicate-dispatch oracle;
- terminal campaigns are recognized but cannot be resumed or redispatched;
- terminal QC scope expanded to exact qualified seats and panel-level reviewer-family diversity.

No version bump, tag, release, merge, or push is implied by these implementation statuses.

## Links

- [Durable continuation plan](../../plans/2026-07-29-durable-continuation-identity.md)
- [Durable continuation rubric](../../plans/2026-07-29-durable-continuation-identity.rubric.md)
- [QC panel plan](../../plans/2026-07-29-qc-panel-honesty.md)
- [QC panel rubric](../../plans/2026-07-29-qc-panel-honesty.rubric.md)
- [Selecting review](../_archive/2026-07-29-bounded-backlog-intake/reviews/joint-review.md)
