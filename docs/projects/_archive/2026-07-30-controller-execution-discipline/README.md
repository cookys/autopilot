# Controller Execution Discipline

Status: completed — final qualification repair merged to `develop` and archived

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
- [x] Apply the consolidated post-review authority repair and independently requalify its complete
  13-file diff

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

The bullets above preserve the initial qualification history. The authoritative final state is:

- Consolidated post-review repair:
  `1a52dae97c038a4331111027d0dc049a57826c0b`.
- Exact reviewed diff SHA-256:
  `0be278f5405df631f74fcff2302b6b25933151ac0319d9c98cf0dabff0abd02c`.
- Fresh independent verifier: Aquinas (`/root/fresh_final_full_qualification`), PASS with zero
  unresolved Critical or Major findings, all 258 hook test files passing, and all seven prescribed
  mechanical gates passing.
- The verifier's initial and final candidate fingerprints were identical; qualification performed
  no implementation mutation.
- Final merge:
  `86f202f007505ee44125e555011bf5ce82f76a41`, carrying
  `QC-Verdict: PASS (reviewer Aquinas, 2026-07-31)`.

## Review boundary

The managed completion campaign stopped honestly before its final panel because no exact QC-seat
qualification receipt existed. No panel seat was dispatched and no qualification was inferred from
transport or quota evidence. Depth 0 used a fresh independent whole-diff reviewer and a separate
fresh read-only verifier; it does not claim a managed three-family panel receipt. The missing
session-local qualification provider remains an explicit backlog item rather than being repaired
inside this bundle. The 2026-07-31 post-review repair reused that independent-verifier boundary; it
did not dispatch another implementer or another review panel.

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

For the final repair, the same historical task-status limitation remained: the archived Mission
root cannot retroactively produce a truthful `can_merge=true` receipt. After the Board explicitly
authorized completion, a fresh deterministic merge-intent preflight returned `safe`, with zero
incoming/dirty overlap and no blockers. Its receipt digest is
`c5444765656094b285ecb961005bd3b92069f67d960347e93cd687077378326f`
(manifest seal
`be2015fd0285bee6998d407e33cf0fdd8785ef3a9f6ebeb46c2a130f15424345`).
The earlier no-push statement applies to the original merge; the 2026-07-31 continuation is the
publishing finish-flow.

## Preserved user state

All pre-existing dirty files, untracked trees, archive refs/stashes, and concurrent B/C worktrees
remain outside the final repair commit. The main checkout's status, unstaged-diff, and staged-diff
fingerprints were identical before and after the merge.
