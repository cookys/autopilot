# Plan — Dispatch Worktree Lifecycle Budget and Zero-Residue Finish Gate
> Status: Draft for bounded hetero review
> Owner: Autopilot maintainers
> Target branch: `fix/dispatch-worktree-lifecycle-budget`
> Frame: Fix — the root cause is known; implementation spans orchestration, lifecycle tooling, tests, and docs

## 0. Context / thesis

A completed `/l6` worktree-safety project left 13 temporary worktrees and 26 process branches. The product result was merged, but cleanup happened only after a user requested a repository-wide inventory.

Autopilot already removes a successful `dispatch-hetero.sh` worktree unless `--keep-worktree` is set, and `engine implement-review` has a per-invocation `loop_max_rounds` cap. Those controls do not bound:

- retained worktrees from failed, interrupted, or explicitly kept dispatches;
- multiple fresh `engine implement-review` invocations for the same logical review unit;
- custom `hetero/*` branches outside `reap-dispatch-branches.sh`'s built-in name grammar;
- finish-flow completion while dispatch-owned worktrees still exist.

The repair is a lifecycle protocol, not another reminder: stable run/unit identity, a race-safe occupancy budget before creation, a durable cross-invocation generation budget, immediate safe reclamation, and a zero-residue finish gate.

### Current control surfaces → observed gap

| Current surface | Present behavior | Gap exposed by the incident |
|-----------------|------------------|-----------------------------|
| `scripts/dispatch-hetero.sh`, immediately before `git worktree add` | Runs the context-window gate, then creates a branch/worktree directly | No same-root occupancy count or creation transaction exists before allocation |
| `scripts/dispatch-hetero.sh::classify_outcome` | Calls `reap_worktree` after clean committed success; keeps failure, dirty, no-op, engine-unavailable, and `--keep-worktree` outcomes | Correct per-leaf preservation accumulates when the caller never disposes retained leaves |
| `src/engine/autopilot-engine.js::runImplementationReviewLoop` | Reads `loop_max_rounds` and bounds one JavaScript invocation | A fresh process starts a fresh counter for the same logical review unit |
| `scripts/reap-dispatch-branches.sh` | Classifies its anchored grammar plus explicit patterns | Custom `hetero/*` branches are invisible without caller-supplied exact scope |
| `skills/finish-flow/SKILL.md` L-5.6 | Runs the dispatch-branch check, then clears L4–L6 session mode | No dispatch-worktree zero-residue gate or frozen exact branch inventory exists |

## 1. Problem

The user needs one autonomous project to converge without accumulating an unbounded number of temporary Git worktrees or process branches. A completed project must be mergeable without a separate forensic cleanup session, while dirty failure artifacts and uncontained commits remain protected from destructive cleanup.

## 2. OKR / KRs

**Objective:** Make leaf-dispatch resource use bounded during execution and mechanically clean at finish.

- **KR1 — bounded occupancy:** For an `/l5` or `/l6` root run, no more than 4 dispatch-owned leaf worktrees may be registered at once. A fifth creation attempt fails before `git worktree add`. Verified by a concurrent fixture test that produces exactly four registered worktrees and observes a precondition failure on the fifth.
- **KR2 — bounded generations across restarts:** A stable logical `loop_id` may consume at most the resolved generation cap across repeated `engine implement-review` processes. Starting a new process, changing session ID, runner, model, or branch name must not reset the counter. Verified by two processes sharing one `root_run_id + loop_id`, where the first consumes part of the budget and the second is rejected at the cap without dispatch.
- **KR3 — immediate reclamation:** Once a leaf commit is captured and no longer requires its worktree, a dead clean worktree is removed while its branch/ref remains. Verified by a committed fixture whose worktree disappears from `git worktree list` and whose exact branch tip still resolves.
- **KR4 — preservation:** Live, dirty, lock-unsupported, malformed-marker, and unknown-lineage worktrees are never auto-removed. Verified by one negative-control fixture per state.
- **KR5 — zero-residue finish:** `finish-flow` cannot complete an `/l4`–`/l6` session while any worktree owned by that root run remains. Its cleanup pass reaps dead clean worktrees, then its check fails closed on every remaining owned worktree. Verified by finish-flow wiring tests plus an end-to-end fixture.
- **KR6 — exact branch accounting:** Branch disposition consumes exact branch names/tips recorded by the lifecycle protocol rather than relying only on naming regexes. Contained branches remain eligible for preserve-first reaping; uncontained branches remain explicit handoff/disposition items. Verified with a custom `hetero/<name>` branch fixture.
- **KR7 — no regression:** Existing dispatch, engine-loop, worktree-reaper, finish-flow, schema, and canonical-invariant suites pass.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Never auto-remove a live, dirty, lock-unsupported, malformed-marker, or unknown-lineage worktree.
- Never delete an uncontained branch; branch deletion remains preserve-first and exact-tip verified.
- Enforce the occupancy budget before `git worktree add` while holding `${GIT_COMMON_DIR}/autopilot-worktree-budget.lock` with a blocking exclusive flock across journal reconciliation, count, safe reap, creation-intent publication, add, and marker publication.
- Key the cross-process generation budget by canonical git identity plus `root_run_id` plus `loop_id`; session, model, runner, branch name, and process identity are metadata and cannot reset it.
- `/l5` and `/l6` must supply a non-empty stable `loop_id`; direct one-shot `dispatch-hetero.sh` remains backward compatible.
- Finish-flow success requires zero worktrees owned by the finishing root run after the safe cleanup pass.
- Do not use worktree path prefixes, mtimes, PID existence, or branch-name regexes as sole ownership or liveness proof.
- Keep the default per-root occupancy cap at 4 and the per-loop generation cap resolved from `loop_max_rounds`.

## 3. File-structure map

| File | Responsibility |
|------|----------------|
| `scripts/dispatch-hetero.sh` | Publish schema-2 ownership markers; enforce the locked pre-creation occupancy budget; retain existing success cleanup semantics. |
| `scripts/lib/worktree-reap.sh` | Parse and validate marker identity; expose safe live/dead/clean eligibility primitives without weakening the flock contract. |
| `${GIT_COMMON_DIR}/autopilot-worktree-creation/` (runtime state, not tracked) | Hold atomic pending-creation records that close the `worktree add` → marker-publication crash window; reconcile under the budget lock. |
| `scripts/resolve-worktree-teardown.sh` | Resolve and validate the default occupancy limit and finish cleanup policy. |
| `project-config-template/worktree-teardown-config.md` | Document `max_leaf_worktrees_per_root: 4` and lifecycle behavior. |
| `scripts/reap-dispatch-worktrees.sh` (new) | Deterministic `scan`, `reap`, and `check` surface scoped by canonical repo identity and `root_run_id`. |
| `bin/autopilot.js` | Accept and forward stable `--root-run-id` and `--loop-id` on `engine implement-review`. |
| `scripts/resolve-review-loop.sh` | Remain the single resolver for `loop_max_rounds`; emit the cap consumed by the durable generation claimant. |
| `src/engine/autopilot-engine.js` | Consume resolved `loop_max_rounds`, claim durable generations before dispatch, and preserve the same logical identity across repair rounds and resume. |
| `scripts/run-ledger.sh` | Store compare-and-swap generation claims for canonical repo + root run + loop ID, or provide the existing fenced primitive if it already satisfies this contract. |
| `scripts/reap-dispatch-branches.sh` | Accept an exact lifecycle-produced branch inventory in addition to its existing anchored grammar; retain bundle and containment checks. |
| `skills/l5/references/hetero-impl-loop.md` | Require stable loop identity and immediate leaf disposition. |
| `skills/l6/references/full-dispatch-pipeline.md` | Propagate root/loop identity through implementation and verification-author dispatches. |
| `skills/ceo-agent/references/level-front-door.md` | Define the occupancy/generation stop conditions and prohibit opening a replacement loop to reset them. |
| `skills/finish-flow/SKILL.md` | Run safe worktree reap + zero-residue check before clearing session mode; feed exact recorded branches into the branch gate. |
| `CLAUDE.md` | Add the new deterministic lifecycle script to the script inventory. |
| `references/hetero-dispatch.md` | Document marker schema, budgets, exit behavior, recovery, and finish ownership. |
| `hooks/tests/dispatch-worktree-lifecycle.test.sh` (new) | End-to-end lifecycle, race, preservation, zero-residue, and finish-flow cleanup → zero-check → branch-gate → marker-clear ordering oracle. Its lifecycle marker parser is the schema validator; no parallel schema SSOT is introduced. |
| `hooks/tests/dispatch-hetero.test.sh` | Marker schema and pre-creation budget regression tests. |
| `hooks/tests/autopilot-engine.test.sh` | Stable loop identity and cross-process generation-cap tests. |
| `hooks/tests/reap-dispatch-branches.test.sh` | Exact custom-branch inventory and preservation tests. |

## 4. Phases

### Phase 0 — Lock the failure oracle

**Dev-flow size:** Fix

1. Add a fixture repo with four marker-owned linked worktrees sharing one `root_run_id`.
2. Add the red case: the current implementation allows a fifth `git worktree add`.
3. Add a fork-and-join case that launches 8 fixture creators against one root ID and asserts exactly 4 registered leaves plus 4 budget rejections.
4. Add retained states for clean/dead, dirty/dead, live-lock, lock-unsupported, malformed marker, schema-1 marker, an unmarked worktree with a pending creation record, and a custom `hetero/*` branch.
5. Run the new test against the base revision and record the expected failing assertion, not an import/setup failure.

**Commands**

```bash
bash hooks/tests/dispatch-worktree-lifecycle.test.sh
```

**Acceptance:** Base fails because the fifth worktree is admitted or finish-check is absent; all fixtures themselves initialize successfully.

### Phase 1 — Ownership marker and race-safe occupancy budget

**Dev-flow size:** L

1. Extend `.autopilot-worktree` to schema 2 with flat validated fields:
   `created_at`, `branch`, `base_sha`, `run_id`, `root_run_id`, `loop_id`, and `schema=2`.
2. Resolve `max_leaf_worktrees_per_root`, default 4, as an integer `1..32`; invalid values fail closed to the default.
3. Resolve `GIT_COMMON_DIR` by realpath-canonicalizing `git rev-parse --git-common-dir` relative to the consuming repository. Open `${GIT_COMMON_DIR}/autopilot-worktree-budget.lock` through the existing owner/symlink/inode-validated fd helper and take a blocking exclusive flock; competing creators wait instead of racing the count.
4. Under that lock, reconcile atomic pending records in `${GIT_COMMON_DIR}/autopilot-worktree-creation/`. Each record contains exact root/run/loop IDs, branch, base SHA, and planned absolute path. If the path is registered but its schema-2 marker is absent after a creator crash, safely reap only dead clean state after normal identity/ref checks; otherwise preserve and count/block it. An unmarked basename match without an exact pending record is never ownership proof.
5. Still under the same lock, enumerate registered worktrees, validate markers, count the same canonical repo + `root_run_id`, and attempt safe reclamation of dead clean owned entries.
6. If the count remains at the cap, emit `precondition_failed` with machine-readable `resource_budget` details and create neither branch nor worktree.
7. Before `git worktree add`, atomically publish the pending creation record. Hold the lock through add and atomic schema-2 marker publication; remove the pending record only after marker identity re-reads successfully, then release the lock.
8. Treat schema-1 markers as legacy/unknown lineage: visible to scans and counted as unresolved repository residue, but never auto-attributed to a root or deleted.

**Acceptance:** Concurrent creation cannot exceed four; rejected creation leaks neither branch nor worktree; SIGKILL at every boundary from pending-record publication through marker verification is recovered or preserved without invisibility; existing one-shot calls without L5/L6 lineage retain their current behavior.

### Phase 2 — Durable loop-generation budget

**Dev-flow size:** L

1. Add `--root-run-id` and `--loop-id` to `engine implement-review`; reserve them from extra-argument override.
2. Require both fields on the L5/L6 canonical path; an empty or missing value returns `precondition_failed` before dispatch. `engine implement-review` with no active L5/L6 session marker may omit both and remains a one-shot invocation.
3. Define `canonical_git_identity` as the realpath-canonical Git common directory for this local repository. Do not mix in remote URLs: separate clones own separate local worktree resources and budgets.
4. Resolve `loop_max_rounds` through the existing `scripts/resolve-review-loop.sh` path, then before each implementation generation atomically claim a monotonic row keyed by `(canonical_git_identity, root_run_id, loop_id)` against that cap. A changed key is a different logical budget; model, runner, session, PID, or branch changes are not.
5. Reuse the existing run-ledger fencing/atomic-write substrate where its ownership and CAS semantics match; do not create an unfenced second state store.
6. Make resume idempotently adopt only a persisted claim with the same canonical key, generation, and idempotency token. A new process with the same logical key continues the durable count; a conflicting token or generation fails closed.
7. On cap exhaustion return `non_converged/resource_budget` before implementation dispatch. Opening a new branch or changing provider cannot reset it.

**Acceptance:** Two separate Node processes share the same budget; a concurrent duplicate claim has one winner; retry/resume does not double-charge; changing `loop_id` is the only way to represent a genuinely different logical review unit.

### Phase 3 — Safe worktree lifecycle controller

**Dev-flow size:** L

1. Add `scripts/reap-dispatch-worktrees.sh`:
   - `scan --repo <dir> --root-run-id <id>` emits exact owned worktree/branch/tip/state JSON.
   - `reap ... --yes` removes only dead, clean, schema-2, identity-matching worktrees while preserving refs.
   - `check ...` exits 0 only when owned worktree count is zero.
2. Validate canonical git common-dir identity, marker ownership, field grammar, and exact registered absolute path from `git worktree list --porcelain`.
3. Define liveness with the existing `_wt_is_live` flock oracle: held lock = live, acquired lock = dead while the probe fd remains held through disposition, and unsupported/open failure = preserve. Define cleanliness as empty `git -C <exact-path> status --porcelain=v1`; command failure = preserve.
4. While holding both the repository lifecycle lock and the dead-worktree probe fd, capture a frozen exact `<branch>@<sha>` inventory, verify `refs/heads/<branch>` still resolves to that SHA, then re-read marker identity, registration, and cleanliness immediately before `git worktree remove`.
5. Define a race as any marker bytes, registered path, branch tip, cleanliness, or lock verdict changing between the frozen compare and remove. Abort that entry, preserve it, and require a fresh scan; never retry from stale evidence.
6. Report dirty, live, unsupported, malformed, raced, pending-creation, and legacy entries separately with actionable reasons.
7. Emit the frozen exact branch/tip inventory needed by branch disposition before removing marker-bearing paths.

**Acceptance:** Every positive fixture is reaped and every negative-control fixture survives; branch tips remain; a compare/remove race aborts safely.

### Phase 4 — Exact branch disposition and finish-flow gate

**Dev-flow size:** L

1. Extend the preserve-first branch reaper with an exact frozen branch-inventory input whose names and tips were captured before Phase 3 removed marker-bearing paths. Reject missing, duplicate, malformed, moved, or integration-target entries.
2. Retain the existing authoritative-target containment check, verified full-history bundle, occupancy recheck, and compare-delete CAS.
3. In finish-flow L-5.6, resolve the active `root_run_id`, then execute this fixed order: worktree `reap --yes` → worktree `check` (must be zero) → exact branch disposition from the frozen pre-reap inventory → branch `check`.
4. The branch gate passes only when every inventory entry is either contained and safely reaped or has an exact-tip preservation/handoff acknowledgement with rationale. Preserved-but-undecided residue blocks completion.
5. Clear the session-mode marker only after both lifecycle gates pass.
6. If dirty/live/unknown work or an undecided branch remains, halt with exact paths/refs and disposition instructions. Backlog entries do not waive residue.

**Acceptance:** A custom `hetero/*` branch is handled without a regex; finish-flow blocks with one dirty owned worktree; after preservation/removal it passes and only then clears session mode.

### Phase 5 — Documentation, compatibility, and dogfood

**Dev-flow size:** S

1. Update the L5/L6/front-door contracts with the stable identity and budget rules.
2. Update config template, dispatch reference, script inventory, and CLI help.
3. Dogfood in a fixture root run: create four clean retained leaves, observe the fifth blocked, safely reap them, confirm zero residue, and confirm exact branches remain available for contained reaping.
4. Run the complete scoped suite and canonical invariant checks.

**Commands**

```bash
bash hooks/tests/dispatch-worktree-lifecycle.test.sh
bash hooks/tests/dispatch-hetero.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/reap-dispatch-branches.test.sh
bash scripts/validate.sh
node scripts/check-contract-schema.js
bash scripts/check-canonical-invariants.sh
```

**Acceptance:** All commands exit 0; dogfood output shows `owned_worktrees: 0`; no untracked fixture worktree remains.

## 5. Test / validation

| Invariant | Positive oracle | Negative control |
|-----------|-----------------|------------------|
| Occupancy cap | First four same-root creations succeed | Concurrent fifth fails before branch/worktree creation |
| Stable generation budget | Claims advance across two processes | New session/model/branch cannot reset the same loop |
| Immediate cleanup | Dead clean owned worktree disappears | Dirty dead owned worktree remains |
| Liveness | Dead unlocked entry is eligible | Held flock and unsupported lock remain |
| Identity | Exact schema-2 repo/root marker is attributed | Malformed, legacy, foreign-root, and path-mismatched markers remain |
| Creation crash | Pending record reconciles an add-before-marker SIGKILL | Unmarked worktree without an exact pending record is never attributed or removed |
| Branch safety | Contained exact branch is bundled and reaped | Moved-tip, uncontained, checked-out, or integration-target branch remains |
| Finish ordering | Reap → zero check → branch gate → marker clear | Any residue prevents marker clear |

Human review verifies only policy choices that scripts cannot decide: whether 4 is the desired default and whether a dirty/uncontained artifact should be preserved, integrated, or deliberately discarded. Scripts own identity, counting, liveness, cleanliness, containment, and ordering.

## 6. Risks + inversion

This plan is guaranteed to fail if:

- the budget count and `git worktree add` are not under one repository-common lock, allowing concurrent dispatches to exceed the cap;
- identity is inferred from branch/path naming, allowing loop reset by renaming;
- finish cleanup uses `--force` on dirty or unknown worktrees;
- a per-process counter is mistaken for a durable loop budget;
- schema-1 markers are silently attributed to the current root run;
- worktree removal happens before exact branch/tip evidence is captured;
- session mode clears before residue and branch gates pass;
- exact-branch support bypasses the existing containment/bundle/CAS protections.

Mitigations are the negative-control matrix in §5, canonical git identity, stable root/loop IDs, repository-common serialization, fail-closed legacy handling, and preserve-first branch disposition.

## 7. Out of scope

- Deleting unrelated user, Mahjong, archive, or manually created worktrees.
- Automatically deleting dirty worktrees or uncontained branches.
- Remote branch deletion beyond existing finish-flow feature-branch behavior.
- Replacing Git worktrees with containers.
- Changing reviewer quality policy, provider selection, or the terminal QC panel.
- Raising the engine loop above its existing maximum.
- Repository-wide cleanup of pre-schema-2 historical residue; that remains an explicit migration/recovery action.

## 8. Open questions

None. The default cap of 4 follows the user's stated desired operating envelope and remains configurable within a bounded range.

## Review log

- R0 — 2026-07-26 — Codex authored from the observed 13-worktree/26-branch incident and current Autopilot lifecycle code.
