# Controller Execution Discipline

Status: bootstrap

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
- [ ] Admit the new Mission graph and enter L6 execution
- [ ] Implement the combined authority/campaign/recovery candidate
- [ ] Run the focused pack, full suite, and one blind joint review
- [ ] Merge, sync payload, push, and close lifecycle receipts

## Preserved user state

The existing dirty Codex hook-probe files, `docs/HANDOFF.md`, the untracked mission-convergence
portfolio directory, and all six stashes are outside this project's commit set.
