# Bounded Backlog Intake

Status: frozen review intake; no implementation is authorized by this document.

## Project goal

Produce one bounded, evidence-backed portfolio for the Mission Convergence follow-ups that are
already triggered after the v2.34.0 archive.

Success means one four-family review round produces:

1. exactly one disposition for every candidate: `keep-now`, `cut`, or `follow-up`;
2. a normalized 0–100 priority score per candidate and a maximum-value MVP portfolio;
3. an explicit dependency DAG and independently closable plan boundaries;
4. a concrete minimum fix and objective oracle for every `keep-now` item;
5. a `NO-FINDING-PROOF` containing inspected evidence when a seat reports no finding;
6. no new implementation phase, architecture expansion, or untriggered backlog item.

## Bounded review deliverable

The only executable deliverable is `bounded-backlog-intake`. Reviewer seats, retries, synthesis,
and report formatting are gates inside it, never additional deliverables.

### Candidate set

| ID | Triggered backlog item | Current evidence |
|---|---|---|
| C1 | Exact-tuple capability probe/admission parity | A live probe can write a legacy partition that strict admission will not consume. |
| C2 | Mission `output_paths` existence and mirror-closure preflight | v2.34 closeout required superseding an impossible output path before spend. |
| C3 | First-class `boundary_rejected` campaign outcome | Controller currently obscures a real boundary stop as unknown failure. |
| C4 | Resumable finding-disposition wait | Missing depth-0 disposition authority terminal-stops instead of parking durable findings. |
| C5 | QC `min_panel_size` enforcement | A three-seat roster has produced a terminal receipt with `final_panel_count: 1`. |
| C6 | Resume-projection/no-op adoption gate | Historical outputs and pre-spend no-effect attempts currently force human correction or burn budget. |
| C7 | Codex compaction rehydration and dispatch idempotency | A real `16/34` continuation regressed to the wrong phase after compaction. |
| C8 | Retained-worktree lease and outcome disposition | A real inventory found 26 retained worktrees, including 14 explicit keep outcomes. |
| C9 | Managed-campaign orphan mutation adoption | A killed controller stranded a live detached mutation with no legal resume transition. |
| C10 | Rotation-aware active campaign ledger view | A 262144-byte rotation made a live campaign appear `not_found`. |
| C11 | Session-local exact-role qualification provider | Effectful readiness cannot lawfully promote implementer/verification/QC roles from transport probes alone. |

### Required reviewer output

Each reviewer independently returns:

- a 0–100 score for every C1–C11 using the frozen rubric;
- `keep-now`, `cut`, or `follow-up` for every candidate;
- the smallest implementable change, objective done condition, and dependency edges for each
  `keep-now`;
- a proposed portfolio under a maximum of three implementation plans;
- no more than three blocking criticisms, each paired with a concrete correction;
- `NO-FINDING-PROOF` with inspected candidate IDs and evidence if it has no blocking criticism.

Depth 0 normalizes scores and selects the highest-value feasible portfolio. It does not take the raw
union of all suggestions. A candidate enters the MVP union only when its normalized score and
dependency feasibility clear the frozen threshold; the remainder stays trigger-bearing backlog.

## Scope boundary

Included: the C1–C11 disposition, ordering, grouping, acceptance oracles, and follow-up boundaries.

Excluded: implementation, version bump, release/push, generic scheduling/dashboard work,
cross-harness malicious-worker authority, unrelated backlog entries, and a mega-plan containing all
candidates.

## Verification

The final artifact is
`docs/projects/2026-07-29-bounded-backlog-intake/reviews/joint-review.md`.
It must enumerate C1–C11 exactly once, identify all four requested engine outcomes, contain no more
than three recommended implementation plans, and include a dependency DAG plus a follow-up list.
