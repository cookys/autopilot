# Backlog actionable successor

> Status: COMPLETE — locally merged to `develop` as `fa076b3c`; no version bump or push
> Owner: depth-0 CEO + one worktree-isolated implementer lineage; effective `/l4` closeout
> Plans: [R6 coordination](../../../plans/2026-08-02-foreman-depth0-coordination-r6.md),
> [review-path efficiency](../../../plans/2026-08-02-review-path-efficiency.md), and
> [skill metadata/hygiene](../../../plans/2026-08-02-skill-metadata-portability-hygiene.md)

## Goal

The 51-entry intake was normalized into three bounded deliverables and completed through one
implementer transcript/branch lineage. Four completed entries were removed, one newly exposed strict
`/l5` trust-root prerequisite was added, and the remaining 48 entries stay honestly trigger- or
Board-gated.

## Intake accounting

| Terminal disposition | Count | Entries |
|---|---:|---|
| Completed and removed | 4 | R6 coordination; review-path B1/B2; review-response leakage/polarity; `CLAUDE.md` capacity hygiene |
| Trigger bank retained | 46 | Includes frontmatter portability after an `inconclusive` real probe, OpenCode after a negative re-probe, and the new strict `/l5` provider-readiness trust root |
| Board-only retained | 2 | Tree calibration graduation; Fable skills absorption |
| **Current real entries** | **48** | `51 - 4 completed + 1 newly exposed prerequisite`; the `<Topic title>` template is excluded |

The frontmatter probe ended truthfully as `inconclusive`, so no `tier:` migration occurred. Fresh
OpenCode 1.17.15 evidence remained negative (`dev-flow` discovery 0/1/0), so check 16 stays advisory.
Leaf-output compaction was not admitted because its concrete raw-leaf-output trigger was not met.

## Bounded deliverable DAG

| Batch | Mission node | Source plan | Depends on | Gate attempts | Repair generations | Closeout owner |
|---:|---|---|---|---:|---:|---|
| 1 | `skill-metadata-portability-hygiene` | skill metadata/hygiene | none | 3 | 2 | node receipt + exact stale-link correction |
| 1 | `foreman-coordination-r6` | R6 coordination | none | 4 | 3 | node receipt only |
| 2 | `review-path-efficiency` | review-path efficiency | both batch-1 nodes | 4 | 3 | final shared backlog/changelog/index/project reconciliation |

The graph has three deliverables, two batches, maximum depth two, and 11 aggregate gate attempts. The
two batch-1 nodes are dependency-independent but execute serially through the same foreman to avoid
parallel writers. Tests, review seats, repair generations, evidence capture, and doc sync are gates
inside these nodes, never additional phases.

## Resource and lineage contract

| Node | Campaigns | Wall seconds | Tool calls | Engine seats | Blocking wait seconds | Owned paths | Evidence bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| `skill-metadata-portability-hygiene` | 1 | 7,200 | 250 | 1 | 1,800 | 100 | 8,000,000 |
| `foreman-coordination-r6` | 1 | 10,800 | 450 | 2 | 1,800 | 24 | 8,000,000 |
| `review-path-efficiency` | 1 | 10,800 | 450 | 2 | 1,800 | 40 | 8,000,000 |

The controller attaches every repair to the existing `l5_foreman` transcript. Within a node the foreman
resumes the same implementer transcript, immutable base, worktree, branch lineage, and frozen rubric.
A test or review failure consumes that node's budget; it must not create a new graph, ticket, phase,
branch lineage, implementer, or model seat.

## Path ownership

- R6 owns the bounded run-ledger/watch-foreman coordination scripts, focused tests, and the exact
  controller-methodology references that describe the condition/action state machine.
- Metadata/hygiene owns the disposable frontmatter probe, focused probe test, conditional canonical
  skill metadata plus deterministic Codex mirrors, exact documentation-capacity work, the exact stale
  archived-link correction (but no semantic backlog disposition), and its evidence receipt.
- Review-path efficiency owns the bounded reviewer/author/delta rails, focused review tests, blind-review
  references, polarity evidence, final shared lifecycle documents, canonical terminal receipts, and the
  complete active-to-archive project move after local integration.
- Frozen plans, rubrics, source manifest, and execution graph are inputs. Implementers may not rewrite
  them. Shared lifecycle semantics have one writer: the downstream review-path node; D3's earlier
  shared-doc authority is limited to the already identified one-link correction.

The exact machine-readable path allowlists live in the frozen Mission graph. Any needed path outside an
allowlist is a depth-0 scope decision before writing, not an implicit expansion.

## Board packet — excluded from implementation authority

- **Tree calibration:** `scripts/calibration.sh report` currently shows 2 samples and 0 agreement, so
  graduation criteria are not met. Recommendation: explicit Board `abort` rather than silent extension.
  No `board_signoff` event or backlog removal is authorized without the user's decision.
- **Fable absorption:** keep deferred. The three admitted deliverables already consume the bounded
  successor and do not require a behavior-rule change. Revisit only through its existing Board trigger.

## Acceptance and closeout

All three node rubrics are terminal. The final blind whole-diff panel produced one clean Architect seat;
the Ops and Skeptic seats each raised one Major that deterministic source inspection refuted. No verified
Critical or Major remains. The one complete-suite run ended 261/262 with only the unchanged-base
`retro-review-loop` date-window fixture failing; the same failure reproduced on immutable base, its
test-only clock was pinned, and an independent focused rerun passed 140 assertions. Mirrors and
`sync-all --check` pass.

Strict `/l5` status authority was unavailable: the actual dispatch run was
`l4-backlog-actionable-successor-20260803-001`, and `status task` correctly returned
`TASK_STATUS_INPUT_UNAVAILABLE`. Closeout therefore uses the actual effective `/l4` authority instead of
forging `can_merge`/`can_close` receipts; the missing strict-L5 CLI trust root is explicitly banked.
Artifact paths and digests are recorded in `dev-info.md`. Product code was locally merged once with a QC
trailer. There was no version bump, release, push, pull request, CI dispatch, or external publication.
