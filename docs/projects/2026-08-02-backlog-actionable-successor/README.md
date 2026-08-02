# Backlog actionable successor

> Status: PLANNED — exact Mission packet under independent review; no implementation effect yet  
> Owner: depth-0 CEO + one worktree-isolated `/l5` foreman lineage  
> Plans: [R6 coordination](../../plans/2026-08-02-foreman-depth0-coordination-r6.md),
> [review-path efficiency](../../plans/2026-08-02-review-path-efficiency.md), and
> [skill metadata/hygiene](../../plans/2026-08-02-skill-metadata-portability-hygiene.md)

## Goal

Turn the current 51-entry backlog into a bounded executable successor: admit only triggered or
evidence-resolvable work, group related items into three deliverables, preserve one foreman/implementer
lineage across repairs, and leave Board-only or untriggered work honestly banked.

## Intake accounting

| Disposition | Count | Entries |
|---|---:|---|
| Scheduled or evidence-resolved in this Mission | 6 | R6 foreman/depth-0 coordination; review-efficiency B1/B2; review-response leakage/polarity; `tier:` frontmatter portability; `CLAUDE.md` capacity trigger; OpenCode check-16 recovery re-probe/disposition |
| Board-only | 2 | Tree calibration graduation; Fable skills absorption |
| Trigger bank | 43 | Leaf-output compaction plus every remaining entry whose trigger, prerequisite, or evidence threshold is not met |
| **Total real entries** | **51** | The `<Topic title>` heading in `docs/BACKLOG.md` is a template, not an entry |

“Scheduled or evidence-resolved” is not a promise that all six rows will be removed. A failed or
inconclusive real platform probe is a valid D3 terminal and keeps its backlog entry. Fresh OpenCode
1.17.15 evidence is negative (`dev-flow` discovery 0/1/0), so check 16 remains advisory in this Mission.
Leaf-output compaction is not admitted: the current complaint does not satisfy its concrete raw-leaf
output trigger.

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

Each node must satisfy its frozen rubric and exact command set. After the downstream node completes,
depth 0 runs authoritative whole-diff QC with independent reviewer seats and reconciles all 51 intake
rows. Bound to `root_run_id === sealed campaign_id`, it persists fresh task-status receipts before merge
(`can_merge=true`), after merge, and before marker clear (`can_close=true`); runs the canonical worktree
then branch reapers; and freshness-checks a `LifecycleResidueReceipt` with `zero_residue=true`. Every
attempt uses a unique caller-owned mode-0700 artifact directory outside leaf worktrees, and receipt paths
plus digests go into `dev-info.md`. Only after local integration and those gates does depth 0 move the
complete project/evidence directory to `_archive`, update the index, and clear the marker. There is no
version bump, release, push, pull request, CI dispatch, or external publication in scope.
