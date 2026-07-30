# Controller Execution Discipline

Status: qualified — pending merge/archive

Plan: `docs/plans/2026-07-30-controller-execution-discipline.md`

This project consolidates the related controller, Mission admission, compaction recovery, and
resource-lifecycle backlog into one frozen deliverable. It intentionally uses one combined
candidate and one final full-diff review instead of per-finding phases or repeated QC panels.

## Inventory decision

- Implement now: Controller P0; exact capability identity; executable Mission delta; honest
  boundary/disposition states; deterministic resume projection; remaining compaction/resource-debt
  recovery; managed orphan adoption.
- Close as already shipped: repair-lineage convergence, minimum QC panel enforcement, rotation-
  aware campaign replay, retained managed-repair lease.
- Keep separate: scheduler optimization, malicious same-UID/cross-harness authority, Owner Kernel
  P4 qualification, and unrelated maintenance backlog.

## Progress

- [x] Reconcile handoff, Git, worktrees, processes, run ledger, and stash inventory
- [x] Three-surface read-only audit and backlog disposition
- [x] Freeze one combined deliverable contract and rubric
- [x] Admit the new Mission graph and enter L6 execution
- [x] Implement the combined authority/campaign/recovery candidate
- [x] Author and pass an independent cross-component execution oracle
- [x] Run the full suite and one blind whole-diff joint review
- [ ] Merge, sync payload, push, and close lifecycle receipts

## Qualification result

- Frozen production repair: `47d0beefcb199f689d39a7c1afd06d6d7f73cd86`.
- Independent whole-diff review: PASS with zero unresolved Critical or Major findings.
- Full hook qualification: 255/258 suites passed; the only failures were three contract-evolved
  fixtures/inventory assertions.
- Frozen closure repair: `6af53524be02ff3b2edda45f68147068d5da79a9`.
- Independent incremental qualification of exactly those three suites: PASS
  (`codex-compaction-rehydration` 195 assertions,
  `implementation-campaign-state` 276 assertions,
  `supervised-engine-bridge-contract` 12 assertions).
- The external audit's four Critical findings are closed. Its Major/minor observations were
  adjudicated into nine non-blocking backlog entries; none reopened this ticket.

## Review boundary

The managed completion campaign stopped honestly before its final panel because no exact QC-seat
qualification receipt existed. No panel seat was dispatched and no qualification was inferred from
transport or quota evidence. Depth 0 will run the same frozen three-family roster once over the
final whole diff; the missing session-local qualification provider remains an explicit backlog
item rather than being repaired inside this bundle.

The bundle includes a host-neutral post-compaction recovery adapter, not production Codex
`PostCompact` registration. Production wiring remains trigger-bound on accepted live probe or
official adapter evidence.

## Preserved user state

The existing dirty Codex hook-probe files, `docs/HANDOFF.md`, the untracked mission-convergence
portfolio directory, and all six stashes are outside this project's commit set.
