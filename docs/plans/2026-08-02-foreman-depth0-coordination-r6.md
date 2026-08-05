---
status: frozen-for-execution
date: 2026-08-02
size: L
entry_level: l5
project: backlog-actionable-successor
---

# Foreman-depth-0 coordination R6

## Background and admission

The current session reproduced the backlog trigger: a quiet/stalled implementer was treated as a
controller problem, the user had to ask whether the same implementer transcript was still attached,
and re-dispatch was considered before durable state had settled the worker's real condition. Existing
lineage, heartbeat, watcher, and advisory-directive rails remain report-only and cannot distinguish
`working`, `waiting`, `blocked`, and `dead` authoritatively.

This plan admits exactly one control-plane deliverable. Tests, review seats, repair generations,
documentation sync, and final QC are gates inside it, not execution nodes.

## Deliverable contract

Build Stage-3 coordination on the existing run-ledger generation/nonce lease and directive channel:

1. Derive a typed worker condition from durable signals using the precedence table below. `quiet`
   alone is never `dead`; missing or unreadable identity evidence is `unknown`, not permission to
   intervene.
2. Preserve one stage owner. Depth 0 may inquire through `steer`, but cannot seize a live lease,
   mutate the stage, or issue a replacement while its exact generation/nonce remains authoritative.
3. Use the fixed intervention sequence: inquiry -> bounded acknowledgement wait -> exact process
   identity and heartbeat re-observation -> bounded termination of an exact alive-but-nonresponsive
   process -> Git/result/side-effect/resource reconciliation -> generation advance -> one authorized
   re-dispatch in the same campaign/ticket lineage.
4. Fence stale children. A late result from an older generation is recorded and reconciled but cannot
   supersede the replacement or cause a second merge/effect.
5. Keep adaptive intervention feature-gated. The rollback is the existing report-only watcher and
   advisory directive behavior; enabling it cannot create a second scheduler or Mission authority.

### Condition precedence

Evaluate from top to bottom against the current lease generation/nonce:

| Condition | Required evidence | Action authority |
|---|---|---|
| `unknown` | PID/start-time unreadable or mismatched, lease ambiguous, or durable evidence malformed | Observe/escalate only; no signal, lease advance, or replacement |
| `dead` | Exact prior PID/start-time is absent and no D-state/resource holder remains | Reconcile first; replacement only after resources are clear |
| `blocked` | Lease-bound explicit blocked event, or an exact live process has stale heartbeat/progress and did not acknowledge the bounded inquiry | Exact nonresponsive process may enter bounded termination |
| `waiting` | Lease-bound explicit wait reason plus fresh process identity/heartbeat | Keep ownership; no termination or replacement |
| `working` | Exact live process plus fresh heartbeat/progress | Keep ownership; no termination or replacement |

For `blocked:nonresponsive`, send SIGTERM to the exact process group, wait the frozen grace period,
then SIGKILL only if the same PID/start-time still owns it. If the process remains alive or enters
uninterruptible D state, quarantine the resource and forbid replacement on it. Generation advance is
allowed only after process absence and Git/result/side-effect/resource reconciliation succeeds.

## Acceptance criteria

- Deterministic fixtures cover `working`, `waiting`, `blocked`, `dead`, and `unknown`, including a
  long-running quiet worker that must not be killed.
- A directive acknowledgement before the deadline prevents kill/re-dispatch. Silence permits bounded
  termination only when the same exact PID/start-time remains alive, owns the lease, and meets the
  `blocked:nonresponsive` predicate; identity mismatch or unreadability remains `unknown` and prevents it.
- A dead owner with a committed Git result is adopted, not reimplemented; an unreconciled side effect
  blocks replacement.
- Two controllers racing the same stage yield one lease owner and at most one replacement generation.
- A stale child cannot overwrite the canonical result, merge twice, or consume a second effect.
- Existing report-only behavior is byte/semantics-compatible while the feature gate is off.
- The full dispatch/ledger suite and complete repository suite pass, followed by one whole-diff
  Architect/Ops/Skeptic review with no unresolved Critical or Major finding.

## Execution binding and verification commands

Mission node: `foreman-coordination-r6`. Dependencies: none. Gate-attempt budget: 4; campaign repair
generations: 3. Reservation: 1 campaign, 10,800 wall seconds, 450 tool calls, 2 engine attempts,
1,800 external-wait seconds, 24 canonical changed files, and 8,000,000 output bytes.

Exact acceptance commands:

```bash
bash scripts/tests/run-ledger.test.sh
bash scripts/tests/run-ledger-concurrency.test.sh
bash hooks/tests/run-ledger-directive.test.sh
bash hooks/tests/watch-foreman.test.sh
bash hooks/tests/dispatch-detach.test.sh
bash hooks/tests/autopilot-engine-resilience.test.sh
bash scripts/sync-all.sh --check
bash scripts/validate.sh
AUTOPILOT_TEST_TIMING_FACTOR=3 bash hooks/tests/run.sh
```

Repairs, focused reruns, review seats, and final QC consume this node's gate budget and reuse its
campaign/branch/foreman lineage. They cannot author a successor graph or replacement ticket.

## Scope boundary

In scope: worker-condition state, lease-safe inquiry/intervention, same-lineage recovery, deterministic
negative controls, operator/reference docs, generated Codex mirrors when their canonical sources move,
and a node-specific durable receipt. Shared backlog/project/index/changelog closeout is owned by the
downstream `review-path-efficiency` node after all three nodes are terminal.

Out of scope: a generic scheduler, portfolio optimization, Mission authority-store changes, malicious
same-UID isolation, `/l5` width fan-out, automatic quota-reset scheduling, version bump, release, push,
or external publication.

## Dependencies and compatibility impact

The node reuses the existing ledger, watcher, directive, and process-group rails and introduces no new
runtime dependency. It may execute in the first Mission batch; the controller runs it after the
metadata baseline for shared-worktree hygiene, but correctness does not depend on tier metadata. With
the feature gate off, existing report-only behavior is preserved.

## Risks and rollback

- False death classification could destroy live work. Mitigation: exact identity, ordered evidence,
  bounded inquiry, and fail-closed `unknown`.
- A killed worker may already have committed or emitted a side effect. Mitigation: mandatory
  reconciliation before generation advance.
- An unkillable/D-state holder may retain resources. Mitigation: quarantine and no same-resource
  replacement.
- Rollback is disabling adaptive intervention; report-only watching and advisory directives remain.

## Open questions

None. Timeout/grace values are configuration with deterministic fixture clocks, not model judgment.

## Review synthesis

| Lens | Finding incorporated |
|---|---|
| Architect | Keep R6 independent because it changes control-plane ownership and recovery authority. |
| QA/Skeptic | Prove the complete typed state set and the inquiry/wait/non-response ordering with negative controls. |
| Ops/SRE | Reconcile Git and side effects before intervention; feature-gate recovery with report-only rollback. |
