# Backlog convergence

> **Plan**: [`docs/plans/2026-08-01-backlog-convergence-plan-set.md`](../../plans/2026-08-01-backlog-convergence-plan-set.md)
> **Mission graph**: [`docs/mission-backlog-convergence-execution-graph.json`](../../mission-backlog-convergence-execution-graph.json)
> **Target branch**: `feat/v2.34.1-backlog-convergence`
> **Workflow**: CEO `/l5`, one bounded deliverable, no external publish

## Goal

Converge the backlog into one admitted Mission that executes only trigger-bearing work with
current evidence: Mission authority repair, cross-harness readiness, and Owner Kernel P4
qualification. Keep reviewer-budget/transport design and Board decisions deferred until their
explicit triggers or approvals exist.

## Scope boundary

Included: the three executable tracks in the plan, their tests, evidence, documentation sync,
and bounded repair generations inside the single `backlog-convergence` deliverable.

Excluded: version bump, release, push, production deployment, external publish, and Track 4–5
design/Board-only items. Existing B/C Mission receipts remain immutable historical evidence.

## Acceptance

The 12 rubric IDs in the plan rubric pass, the Mission receipt is terminal and authority-bound,
all listed verification commands are green, and the final evidence names deferred items without
claiming they were implemented.

## Progress

| Stage | Status | Evidence |
|---|---|---|
| Inventory and plan | Complete | Approved plan and rubric; one-node graph admitted |
| Mission execution | **Blocked before spend** | L5 attempt 1 stopped at `reviewer_qualification`; engine receipt `/tmp/backlog-convergence-engine.raw.log` (`4d5c0132…`); no implementation/review/provider/worktree effect |
| Resource reconciliation | Complete | Canonical `no_effect_release`, digest `dd8e06c6…`; reservations zero; graph node remains pending |
| Final gates and closure | Pending unblock | Scorecard read-only inspection fails `UNRESOLVED_EVIDENCE_REFERENCE` from malformed legacy qualification evidence; do not bypass or synthesize a qualification |

## Blocker evidence

The sealed Mission admission and campaign were valid (`admission_digest=f9a9605b…`,
`campaign_id=campaign-v2-0889e4…`). The canonical engine stopped before the first implementer
dispatch because the configured MiniMax reviewer was not qualified and no valid cross-family
fallback ladder was available. `node scripts/engine-scorecard.js current --role reviewer` fails
closed while reading the local qualification store with `UNRESOLVED_EVIDENCE_REFERENCE`.

The next attempt must repair or re-issue that qualification evidence through its authoritative
provider, then resume this same Mission graph/lineage. `--allow-unqualified-reviewer`, a new
Mission graph, and `/l5 --solo` are not authorized by this record.

## Verification contract

The authoritative command set is frozen in the Mission graph. The final run must also preserve
the existing repository invariants and leave no untracked worktree or branch residue beyond the
declared feature branch.
