# Plan — L6 Status, Merge, and Honest Closeout Contract
<!-- autopilot-authority-claims: ["task_can_close"] -->
> Status: Ownership-consolidated revision; prior generation-1 READY is historical / Owner: CEO / Branch: to be created at execution / Frame: downstream closeout owner

## 0. Context / thesis

During the 2026-07-26 closeout, “merged and clean” was reported while safety worktrees and branches
still existed, and “merge and merge worktree” required later clarification of the actual source and
target pairs. The existing status surface reports quota, runs, and roster, while finish-flow checks
several closing steps separately. Neither produces one task-level answer to:

`what is merged, what remains, and may this task be called complete?`

This plan adds a read-only task status contract and an explicit merge-intent preflight. It is the
sole owner of task-level `can_merge`, `can_close`, human `DONE|NOT DONE`, and finish-marker
clearing. It consumes, rather than duplicates, Mission, campaign, readiness and lifecycle receipts.

## 1. Problem

Product integration, consumer-worktree update, push state, dirty preservation, review acceptance,
temporary-worktree teardown, and branch residue are currently reported in different places. A
successful merge can therefore be confused with a fully closed task. Merge direction is free-form,
and committed-tip merge analysis does not account for staged/unstaged/untracked consumer changes.

## 2. OKR / KRs

**Objective:** Make “can merge” and “finished cleanly” deterministic, inspectable statements.

- **R1 / KR1 — task status:** Given a `root_run_id`, emit goal, phase, candidate commit, acceptance
  verdict, open blockers, deferred count, active owned worktrees, active owned branches, integration
  target, push state, `mission_terminal`, `can_merge`, and `can_close`.
- **R2 / KR2 — honest meanings:** `product_merged`, `consumer_updated`, `pushed`, and `zero_residue`
  are separate booleans. Human output never summarizes them as “clean” unless `can_close=true`.
- **R3 / KR3 — exact ownership:** Worktree/branch counts come from the lifecycle ledger and creation
  journal, not name regex or global repository guesses.
- **R4 / KR4 — explicit merge intent:** A merge manifest names ordered `{source,target,mode}` pairs
  and forbidden reverse edges before mutation.
- **R5 / KR5 — dirty preservation:** Preflight inventories staged, unstaged, and untracked paths in
  every target worktree and checks them against incoming changed paths before proposing a scoped
  preservation action.
- **R6 / KR6 — no implicit mutation:** Status and preflight are read-only. Merge execution requires an
  explicit sealed manifest and emits before/after evidence without deleting branches/worktrees.
- **R7 / KR7 — finish integration:** L5/L6 finish-flow cannot clear its session marker or claim
  completion while owned blockers, worktrees, branches, unpushed required integration, or an
  unexecuted required merge edge remains. LSM is the only plan that wires this predicate into
  `finish-flow`.
- **R8 / KR8 — plain CEO output:** Default human output begins with `DONE|NOT DONE`, followed by at
  most the current blocker and next action; `--json` retains full evidence.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- `product_merged`, `consumer_updated`, `pushed`, and `zero_residue` are independent booleans; never summarize them as one inferred state.
- `can_close=true` requires zero owned worktrees, zero owned unintegrated branches, zero accepted blockers, and every required merge edge complete.
- `can_close=true` also requires a valid `mission_terminal=true` receipt and terminal campaign
  receipts. Mission terminal alone is never task closeout.
- `can_merge=true` requires an accepted terminal review verdict, zero accepted blockers, a sealed merge manifest whose source and target refs still match their pinned SHAs, and no unresolved dirty-path overlap or forbidden edge; push state and post-merge residue do not affect `can_merge`.
- Worktree and branch ownership comes only from a valid WLB lifecycle receipt bound to the current
  repository/root state, never from branch-name regex or LSM re-scanning.
- Merge intent is an ordered sealed list of explicit `{source,target,mode}` edges plus explicit forbidden reverse edges.
- Status and merge preflight are read-only; execution requires the caller to pass the sealed manifest hash.
- Dirty preservation is path-scoped and must cover staged, unstaged, and untracked files without dropping user changes.
- No automatic push, branch deletion, worktree deletion, or stash drop is introduced by this plan.
- Existing `autopilot status quota|runs|roster|readiness` behavior remains backward compatible.

## 3. File-structure map

| File | Responsibility |
|---|---|
| `src/status/task-status.js` (new) | Pure aggregation of Mission/campaign/lifecycle receipts, review verdict, git integration, dirty state, and push state. |
| `src/status/merge-intent.js` (new) | Manifest validation, hash sealing, source/target resolution, forbidden-edge and incoming-path analysis. |
| `src/status/cli.js` | Add `status task --root-run-id` and human/JSON rendering. |
| `src/merge/cli.js` (new) | `merge preflight` and explicit `merge execute` front doors. |
| `bin/autopilot.js` | Expose task status and merge commands. |
| `schemas/task-status.schema.json` (new) | Stable task-level status evidence contract. |
| `schemas/merge-intent.schema.json` (new) | Ordered merge edges, forbidden reverse edges, preservation policy, and seal. |
| `schemas/lifecycle-residue-receipt.schema.json` | Consumed WLB contract; LSM validates freshness/binding and never reimplements lifecycle inference. |
| `skills/finish-flow/SKILL.md` | Gate marker clearing and “clean” language on `can_close=true`. |
| `skills/ceo-agent/references/level-front-door.md` | Require plain task status at phase transitions and before/after merge. |
| `hooks/tests/status-task.test.sh` (new) | Boolean independence, owned residue, blockers, push state, human output. |
| `hooks/tests/merge-intent.test.sh` (new) | Direction, dirty overlap, sealed manifest, forbidden reverse, read-only preflight. |
| `hooks/tests/merge-execute.test.sh` (new) | Ordered execution, pinned-SHA drift rejection before mutation, scoped dirty restoration, and execution receipts. |
| `hooks/tests/finish-flow.test.sh` or existing finish-flow evals | Marker/terminal gate integration. |
| `platforms/codex/plugin/**` | Generated mirror only. |

## 4. Phases

### Phase 1 — Task-status schema and read-only aggregation (L)

**Depends on:** Mission terminal receipt, ICC campaign receipts, and WLB lifecycle receipt.

1. Define the task-status schema with independent integration/consumer/push/residue booleans.
2. Resolve repository and refs without checking out or modifying a worktree.
3. Validate the WLB lifecycle receipt against canonical repo identity, `root_run_id`, observed head,
   and freshness. If it is missing, stale, or unknown, emit `unknown` and make
   `can_close=false`; do not fall back to regex or a second scan.
4. Aggregate accepted blockers and deferred findings from authoritative artifacts.
5. Validate `mission_terminal` and terminal campaign receipts, then compute `can_merge` and
   `can_close` from explicit predicates and include every failed predicate.

**Acceptance:** fixtures prove a merged commit with one owned worktree is
`product_merged=true`, `zero_residue=false`, `can_close=false`.

### Phase 2 — Merge-intent manifest and dirty-aware preflight (L)

**Depends on:** Phase 1.

1. Define an ordered manifest with exact refs/worktrees, merge mode, required result, and forbidden
   reverse edges. Allowed modes are only `no-ff` (a merge commit whose first parent is the prior
   target and whose second parent contains the pinned source) and `ff-only` (the target becomes the
   pinned source or its verified descendant without a merge commit). Squash, rebase, and implicit
   default modes are rejected.
2. Resolve every ref to an immutable SHA and seal the manifest hash.
3. Inventory staged, unstaged, and untracked target paths. Compare against changed paths introduced
   by each incoming edge.
4. Report safe, overlapping, ambiguous, or blocked. For overlaps, propose a path-scoped
   stash/preservation set but perform no mutation.
5. Reject source==target, missing refs, dirty paths outside the declared preservation policy,
   reverse forbidden edges, and manifest drift.

**Acceptance:** the TWGame-shaped fixture explicitly permits
`safety -> develop` then `develop -> peo`, forbids `peo -> develop`, and reports staged consumer
scripts before any merge.

### Phase 3 — Explicit execution receipts (L)

**Depends on:** Phase 2.

1. Require the caller to provide the sealed manifest hash.
2. Before each edge, revalidate source/target SHAs and dirty inventory; halt on drift.
3. Execute only the declared merge mode and record before/after SHAs, merge commit, conflicts, and
   preservation action.
4. Restore path-scoped preserved changes and verify their staged/unstaged state matches the receipt.
5. Do not push, delete branches/worktrees, or drop unrelated stashes.

**Acceptance:** sandbox fixtures demonstrate ordered execution, drift rejection before mutation,
preserved dirty changes, and no reverse-edge merge.

### Phase 4 — Finish-flow and CEO reporting integration (L)

**Depends on:** Phases 1–3.

1. Add `autopilot status task --root-run-id <id> [--json]`.
2. Human output starts with `DONE` only when `can_close=true`. When `can_close=false`, it starts with
   `NOT DONE`, followed by the first blocker and exact next action.
3. Call task status before merge, after merge, and before session-marker clear.
4. Evaluate the same §2.5 `can_close` predicate for L5/L6 sessions and block finish-flow terminal
   completion when it is false. The S/Fix/H exemption changes only marker/terminal gating; their
   existing finish-flow behavior is otherwise unchanged.
5. Replace ambiguous “merged and clean” templates with the four independent state labels.
6. Before closeout, let depth-0 consume ICC/PRS follow-up candidate artifacts. Dedupe by stable
   finding fingerprint; admit only evidence-backed valuable work to `docs/BACKLOG.md` with
   `Source`, `Context`, and `Trigger`. Rejected/nitpick candidates remain in the immutable campaign
   receipt but do not enter backlog. A backlog admission never reopens the current ticket:
   `/next` may select it later only after its trigger is true, under a new ticket, contract, and
   budget.

**Acceptance:** finish-flow fixture cannot clear the marker with branch/worktree residue, and the
final human report distinguishes merged/not-pushed/consumer-dirty states. A valuable out-of-scope
review suggestion is admitted exactly once to backlog without changing current-ticket terminal
state; a duplicate, unsupported, or preference-only suggestion is not admitted.

### Phase 5 — Docs/package sync (S)

**Depends on:** Phase 4.

1. Document source/target examples and the non-mutating preflight boundary.
2. Sync the Codex plugin mirror and add CHANGELOG entry at ship time.

**Acceptance:** documentation checks and plugin mirror check pass.

## 5. Test / validation

```bash
bash hooks/tests/status-task.test.sh
bash hooks/tests/merge-intent.test.sh
bash hooks/tests/merge-execute.test.sh
bash hooks/tests/status-cli.test.sh
bash hooks/tests/resolve-worktree-teardown.test.sh
bash hooks/tests/dispatch-status.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
```

Required red cases: ledger unavailable, owned residue, accepted blocker, forbidden reverse edge,
dirty overlap, SHA drift, unpushed required integration, and attempted marker clear before
`can_close`. A named false-clean fixture must set `product_merged=true` while leaving an owned
worktree/branch and assert that human output begins `NOT DONE`.

## 6. Risks + inversion

| Failure guarantee | Mitigation |
|---|---|
| Recompute ownership with branch regex | Consume lifecycle ledger only; unknown fails close. |
| Call a merge “clean” because Git merged successfully | Independent booleans and explicit close predicates. |
| Damage dirty user changes | Read-only inventory first, path-scoped preservation, receipt and restore verification. |
| Execute the wrong direction | Ordered sealed edges plus forbidden reverse edges. |
| Turn a status command into cleanup automation | Status/preflight never mutate; execution excludes deletion/push. |
| Duplicate lifecycle mechanisms | Treat lifecycle ledger as an explicit dependency and source of truth. |

## 7. Out of scope

- Creating/budgeting worktrees is owned by WLB; implementation/review generations are owned by ICC.
- Choosing product integration policy when the Board has not supplied merge intent.
- Automatic push, remote branch deletion, worktree removal, or stash garbage collection.
- General-purpose release deployment status.
- Provider readiness and review panel control.
- Mission lineage/aggregate budget/control and campaign mutation/testing.

## 8. Open questions

None. Merge intent is supplied per task; the mechanism does not choose business direction.

## Review log

- R0 (2026-07-26): Authored from the transcript investigation. Rubric frozen in
  `2026-07-26-l6-status-merge-contract.rubric.md`.
- R0.5 Kimi K3: STOP on the missing `can_merge` predicate; confirmed and repaired. Also clarified
  execution tests, allowed merge modes, finish-flow scope, and compatibility checks.
- R1 MiniMax-M3 + GLM-5.2: both semantic READY. GLM reported three nonblocking traceability
  clarifications (`NOT DONE`, false-clean fixture, and L5/L6 predicate scope); all were confirmed and
  applied without changing scope or opening generation 2.
- R2 ownership consolidation: LSM is now explicitly the sole `can_close`/finish-marker owner and
  consumes versioned Mission, campaign, and WLB receipts instead of lifecycle ledger inference.
  R1 remains historical because the plan/rubric hash changed; a new bounded review is required.
