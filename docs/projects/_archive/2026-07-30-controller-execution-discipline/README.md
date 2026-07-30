# Controller Execution Discipline

Status: completed — locally merged and archived

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
- [x] Merge locally, confirm payload parity, and archive the completed project

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
- Local merge: `d25c74257ded548d075e474488e7a89562b08f93`.

## Review boundary

The managed completion campaign stopped honestly before its final panel because no exact QC-seat
qualification receipt existed. No panel seat was dispatched and no qualification was inferred from
transport or quota evidence. Depth 0 used a fresh independent whole-diff reviewer and a separate
fresh read-only verifier; it does not claim a managed three-family panel receipt. The missing
session-local qualification provider remains an explicit backlog item rather than being repaired
inside this bundle.

The bundle includes a host-neutral post-compaction recovery adapter, not production Codex
`PostCompact` registration. Production wiring remains trigger-bound on accepted live probe or
official adapter evidence.

## Finish-flow compatibility note

This campaign predates the current task-status artifact. Its historical Mission root is terminal
`ABORTED`, so no `can_merge` or `can_close` lifecycle receipt was fabricated. The local merge used
the deterministic merge-intent preflight instead: receipt
`5f3f7958f73cf472284fccdaba6c46d702b7d6dd642f384594aeedf225b12c64` was
`safe`, reported zero overlap with preserved dirty paths, and authorized the exact source
`74ed636ecdee5b9605513241031d9940ad483ce5` into `develop`
`05b3b6e297defc1009795799063c03ae6b9508b3`.

Remote push/release was intentionally not performed in this session.

## Preserved user state

The existing dirty Codex hook-probe files, `docs/HANDOFF.md`, the untracked mission-convergence
portfolio directory, and all six stashes are outside this project's commit set.
