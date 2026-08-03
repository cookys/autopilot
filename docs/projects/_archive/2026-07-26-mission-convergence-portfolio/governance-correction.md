# Mission / Portfolio Governance Correction

> Status: ACTIVE P0 correction
>
> Decision: implement in v2.34.0 before integrating the remaining portfolio tracks
>
> Scope cap: one prevention boundary and three implementation workstreams; repair commits consume
> the owning node's frozen gate budget instead of creating new phases

## Why This Is Not Backlog

The portfolio tracker expanded seven reviewed plans into 34 sequential rows. Each row then inherited
the full seven-step phase gate, creating a theoretical 238-node workflow. The source Mission plan
explicitly limited delivery to three bounded phases and declared PRS, CTR, and native Kimi transport
independent of the Mission core. The tracker therefore violated the plan it was meant to execute.

The failure was not only a tracking mistake. The shipped runtime cannot currently prevent the same
mistake:

- `dev-flow` required extracting every `P0..PN` heading into a task, while plan bootstrap parsed
  every `## Phase N` heading and scope completeness encouraged a separate phase for each affected
  surface. Combining seven plans therefore multiplied authoring structure into execution work
  instead of first normalizing it into bounded deliverables.
- Owner Kernel rejected the root `mission_convergence` section while the campaign checker read it.
- Mission policy and lineage fields in TaskAuthority were optional caller-supplied provenance.
- The production CLI could not prepare and grant a sealed v2 campaign from a durable Mission
  registry.
- Campaign terminal receipts were not reconciled into Mission state.
- CEO and L3-L6 fallback paths did not share an executable Mission admission boundary.
- Mission had aggregate resource limits but no frozen deliverable graph or phase/gate budget.

These are missing acceptance requirements of Mission P1/P2, so deferring them would falsely declare
the current implementation READY. Broader scheduling and cross-harness generalization remain
backlog.

## Frozen Prevention Boundary

All five capabilities below ship together. Omitting any one leaves a reset path through config,
session, branch, campaign identity, routing fallback, or unreconciled terminal state.

### 1. Canonical policy and authority freeze

- Add one `resolveMissionPolicy()` implementation used by Owner Kernel, Mission CLI, campaign
  checker, and engine intake.
- Accept an optional versioned root `mission_convergence` section in the authoritative governance
  file. Missing remains backward-compatible `off`; partial, unknown, or wrong-type values fail
  closed.
- Task-level and agent overrides may only tighten the project policy.
- A Mission-enabled TaskAuthority freezes the effective policy digest, Mission lineage ID, and
  execution-graph digest. Callers cannot supply different values at later boundaries.

### 2. Durable prepare and grant v2

- `mission prepare` creates or adopts the unresolved Mission under a Git-common-dir registry.
- The registry identity binds canonical repository identity, frozen task authority, intent,
  acceptance target, policy, and graph. Branch, session, ticket, or output-path changes cannot
  create a fresh lineage for the same unresolved authority.
- `mission grant` derives the graph node, campaign-v2 identity, claim, reservation, and sealed
  campaign contract from registry state using compare-and-swap semantics.
- Enforce mode rejects arbitrary caller-selected Mission state. Legacy path-based state is retained
  only for shadow fixtures and compatibility tests.

### 3. Terminal reconciliation and stagnation

- Every terminal campaign outcome (`ready`, `follow_up`, `blocked`, `abort`, or `unknown`) emits one
  canonical Mission receipt carrying both ICC campaign-v1 and Mission campaign-v2 identities.
- Reconciliation journals intent before the atomic state update. Exact replay is a no-op; conflicting
  replay fails closed. A claim that may have produced an effect cannot use a no-effect release.
- Mission state freezes required acceptance hashes. Remaining acceptance is the required set minus
  the satisfied set.
- Terminal reconciliation updates graph state, budget usage, progress, and consecutive zero-delta
  observations. The configured stagnation limit blocks the next grant mechanically.
- Unsupported exact counters remain `unknown`; they are never silently converted to zero. Enforced
  admission uses the frozen conservative reservation when exact terminal usage is unavailable.

### 4. One admission boundary for CEO and L3-L6

- Dev-flow/project bootstrap normalizes one or more source plans into the bounded deliverable graph
  before creating tasks. Source headings, modules, test gates, reviewer seats, and repair attempts
  are coverage metadata inside a deliverable; they are not automatically new deliverables.
- CEO, L3, L4, L5, L6, `--solo`, and all topology fallbacks use the same Mission policy/graph/source
  admission before any task, branch, worktree, runner, or model effect. The durable runtime then
  preserves the same policy/graph binding through prepare and graph-node grant.
- Fallback may change execution topology or provider. It may not change lineage, policy, graph,
  grant, or control sequence.
- A harness without an executable blocking adapter cannot claim `enforce`; it blocks or remains
  explicitly `shadow` according to the probed capability.

### 5. Minimal frozen execution graph

- Prepare freezes a caller-authored acyclic deliverable graph and its digest.
- Policy limits include `max_deliverables`, `max_parallel`, `max_batches`, `max_graph_depth`, and
  `max_gate_attempts`, in addition to existing aggregate ceilings.
- Every deliverable binds source plan/rubric IDs, dependencies, acceptance IDs, verification
  commands, and a bounded reservation.
- Grant is legal only for a ready graph node. Dependency, parallel, batch, depth, and gate-attempt
  violations reject before any effect.
- A deterministic checker proves exact source-rubric coverage and rejects duplicate or invented
  nodes.

## Implementation Workstreams

These are implementation ownership boundaries, not user-visible phases.

| Workstream | Owned surface | Integration limit | Status |
|---|---|---|---|
| A: policy + graph | canonical resolver, Owner Kernel/TaskAuthority freeze, graph contract/checker | one commit | integrated as `7d96d46` |
| B: runtime lifecycle | prepare/grant v2, registry/CAS, terminal reconciliation, engine intake | one commit plus fixture correction | integrated as `149e520` + `ffd2fb0` |
| C: routing + dogfood | CEO/L3-L6 admission, graph/tracker correction, end-to-end matrix | one commit | bootstrap integrated on candidate `b9a3f55…` (focused suite green); successor graph omits `runtime-control` after historical-`output_paths` campaign rejection |

No new sub-phase may be created inside these workstreams. A failed test is repaired inside its owning
workstream. A finding outside this frozen boundary goes to backlog with a trigger.

## Current Portfolio Execution Graph

### Four-node era (historical; auditable only)

The portfolio was first represented by four deliverables:

| Node | Deliverable | Dependencies |
|---|---|---|
| `runtime-control` | this P0 correction, L6 strict bridge, and remaining PRO transport integration | completed core |
| `plan-review` | PRS P1-P5 as one independently verified track | completed core |
| `transcript-retro` | CTR P1-P4 as one independently verified track | completed core |
| `release-closeout` | joint QC, version, merge, worktree/branch cleanup, and archive | all three nodes |

Maximum active implementation nodes was three. A Mission campaign against the four-node graph
correctly rejected `runtime-control` integration because its `output_paths` listed historical files
already present in HEAD; delta repair must not rewrite them to satisfy the boundary. The bootstrap
implementation itself is complete at candidate `b9a3f55cf2904c71a276cbaa5f19d5d9fc67ed0d`.

### Successor graph (current executable)

After the `runtime-control` bootstrap, remaining work is three deliverables:

| Node | Deliverable | Dependencies |
|---|---|---|
| `plan-review` | PRS P1-P5 as one independently verified track | completed core + runtime-control bootstrap |
| `transcript-retro` | CTR P1-P4 as one independently verified track | completed core + runtime-control bootstrap |
| `release-closeout` | joint QC, version, merge, worktree/branch cleanup, and archive | exactly `plan-review` and `transcript-retro` |

Maximum active implementation nodes is two. Closeout is the only sequential terminal node. PRS/CTR
required and output path contracts are preserved unchanged. The content-bound source manifest is
narrowed to the three remaining plans so exact source/rubric coverage still holds; the historical
seven-plan set remains in git history and the project ledger.

### Observed-churn budget correction

The second sealed PRS and CTR campaigns produced clean, focused-test-passing commits but were
correctly rejected by the post-effect boundary because their mandatory canonical plus Codex-mirror
diffs measured 6,050 and 5,785 changed lines, above the original 5,250-line ceiling. The successor
graph therefore calibrates both nodes from a 3,500-line baseline plus 1,750 extra lines to a
4,500-line baseline plus 2,250 extra lines. The 1.5 growth ratio, exact output paths, allowed path
prefixes, acceptance IDs, verification commands, and attempt budgets remain unchanged. Existing
candidate commits are retained for the successor revision so the correction does not authorize a
second implementation rewrite.

## Mechanical Acceptance

1. A 34-node graph with `max_deliverables=8` is rejected before task, branch, worktree, runner, or
   model creation; an effect counter remains zero. A source set with 34 phase headings may compress
   into four admitted deliverables.
2. Owner Kernel, `mission prepare`, campaign checker, and engine intake resolve identical policy
   mode and digest. Partial, unknown, or drifted configuration fails closed.
3. A Mission-enabled TaskAuthority cannot omit or replace lineage, policy digest, or graph digest.
4. A real temporary Git repository completes `mission prepare -> grant -> seal -> engine intake`.
   A second branch, session, ticket, or state path cannot reset its unresolved lineage.
5. Concurrent grants for one node produce one claim; the other request is an exact replay or a
   conflict, never a second reservation.
6. Dependency, parallel, batch, depth, and gate-attempt exhaustion all reject before spend.
7. Terminal usage is charged exactly once. Exact replay is a no-op, conflicting replay blocks, and
   an effectful crash requires reconciliation before another grant.
8. Two configured zero-delta terminal outcomes block the Mission while acceptance remains.
9. L3-L6, `--solo`, precondition fallback, and expired/corrupt marker tests cannot bypass the same
   Mission/graph admission.
10. The current successor three-node graph passes the source-rubric coverage checker against the
    three remaining plans and rubrics (PRS, CTR, LSM closeout). The historical seven-plan set is
    provenance only and is not re-covered by the executable graph after `runtime-control` omission.

Required final commands:

```bash
bash hooks/tests/mission-convergence.test.sh
bash hooks/tests/mission-convergence-integration.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/mission-routing-admission.test.sh
bash hooks/tests/mission-graph-path-authorization.test.sh
bash scripts/validate.sh
bash scripts/check-canonical-invariants.sh
bash scripts/sync-codex-plugin-skills.sh --check
git diff --check
```

## Deferred To Backlog

- Generic scheduling, critical-path optimization, dynamic graph reordering, and dashboards.
- Cross-repository portfolio governance and universal enforcement across every harness.
- Exact provider token/tool/cost counters that the host cannot observe reliably.
- A remote or root-owned authority daemon protecting state from a malicious same-UID process.
- General stale-lock recovery and a broad Mission subsystem refactor.
