# P6D orchestration overreach incident

> Date: 2026-08-21
> Status: RECORDED; corrective engineering deferred to the linked BACKLOG entry
> Affected controller: Codex depth 0
> Affected consumer repository: `TWGameProject`
> User impact: delayed P6D delivery, noisy status reporting, and unnecessary Mission/governance churn

## Executive summary

The requested work was bounded and mechanically verifiable: continue the Mahjong P6D
semantic slot-layout kernel from an existing HANDOFF, produce exactly six named files, and run
three named verification commands. Codex nevertheless routed the task through the strict L5
Mission/heterogeneous implementation path.

The first implementation candidate was functionally sound and passed all three verification
commands. Its temporary worktree needed the consuming repository's existing Python and Node
dependencies, so two convenience symlinks were created at
`clients/peo-3d-lab/.venv` and `clients/peo-3d-lab/node_modules`. They were not ignored in that
worktree and were included by broad staging. The resulting commit therefore contained eight
paths instead of the contract's exact six and was correctly rejected by the scope gate.

The controlling error occurred after that rejection. The candidate required only a local artifact
repair: remove the two staged symlinks, amend the commit, and rerun the scope gate. Codex instead
treated the rejected workflow state as the unit of work, terminalized the campaign, repaired
Mission/governance state, created a successor adoption, and reran the implementation pipeline.
This turned a minute-scale candidate repair into a long orchestration incident.

No production asset, GLB/R2 publication, or user-authored HANDOFF content was overwritten. The
consumer worktree's pre-existing `HANDOFF.md` modification remained unstaged. The incident's cost
was time, attention, unnecessary history, and loss of confidence in controller judgment.

## Intended task contract

P6D required a semantic layout kernel with this flow:

```text
GameState
  -> stateToSlots()
  -> Semantic Slot Registry
  -> LayoutProfile / SeatFrame
  -> base transform
  -> local ViewModifier
  -> render transform
```

The implementation had to preserve Taiwanese 16-tile invariants, including the 16-tile rack plus
drawn 17th tile, 18 two-layer wall stacks per seat, directional sea layouts, player/meld/kong index
contracts, flower indices, and the rule that camera/view cheats remain local `ViewModifier` data.

The delivery manifest was exactly:

1. `clients/peo-3d-lab/scripts/mahjong_slot_layout.py`
2. `clients/peo-3d-lab/scripts/test_mahjong_slot_layout.py`
3. `clients/peo-3d-lab/scripts/mahjong_legacy_table_p6c_contract.py`
4. `clients/peo-3d-lab/scripts/test_mahjong_legacy_table_p6c_preview.py`
5. `clients/peo-3d-lab/docs/projects/mahjong-geometry-face-poc/ARCHITECTURE.md`
6. `clients/peo-3d-lab/docs/projects/mahjong-geometry-face-poc/DEVELOPMENT_LOG.md`

The acceptance commands were:

```bash
clients/peo-3d-lab/.venv/bin/python clients/peo-3d-lab/scripts/test_mahjong_slot_layout.py
clients/peo-3d-lab/.venv/bin/python clients/peo-3d-lab/scripts/test_mahjong_legacy_table_p6c_preview.py
npm --prefix clients/peo-3d-lab run build
```

This was therefore an acceptance-oracle task: both the output surface and the proof commands were
known before implementation. The contract contained no unresolved property that required Mission
governance or an L5 control plane to discover.

## Event sequence

### 1. Unnecessary escalation

Codex interpreted the user's `go` as authorization to implement P6D, which was correct, but then
selected the strict L5 route. Before reaching implementation, it created or amended four
Autopilot-governance commits in the consumer lineage:

- `339a66125` — admit the P6D slot-layout mission
- `4dbf8afb0` — bind the L5 review roster
- `a2040b4a2` — allow a bounded P6D successor
- `e98a39442` — restore the frozen P6D policy

The latter pair was net governance churn: policy content returned to the original
`max_stagnant_generations = 1`, while history retained the detour.

### 2. Zero-effect attempts before implementation

Three attempts produced no deliverable because the managed route rejected controller preconditions:

1. the QC roster was incomplete;
2. `AUTOPILOT_ROOT_RUN_ID` was absent;
3. the original consumer worktree was dirty because the user's `HANDOFF.md` was modified.

Codex then created a clean controller worktree rather than reconsidering whether the task needed the
managed route at all.

### 3. First candidate: correct behavior, invalid manifest

The first substantive candidate was commit `a6886cabee5d0f11e2906c16760a11f7b0259d08` on a Mission
worktree. Its functional evidence was green:

- new slot-layout tests: 9/9 passed;
- existing P6C preview tests: 47/47 passed;
- `npm --prefix clients/peo-3d-lab run build`: passed.

To make those commands runnable from the clean worktree, dependency symlinks were added for
`.venv` and `node_modules`. The symlinks were not covered by an ignore rule in that worktree. Broad
staging committed them together with the six allowed paths. The scope gate correctly rejected the
candidate because the commit manifest had eight paths.

This was not a semantic-layout defect. It was a preventable pre-commit manifest defect.

### 4. Wrong recovery unit

The cheapest recovery was to repair the candidate artifact. Instead, Codex attempted to reconcile
the managed workflow state. A controller lease-identity mismatch produced an additional
`LEASE_FENCED` detour. Codex then used the formal terminalization API, charged the conservative
reservation, created successor Mission generation 1, manipulated acceptance/stagnation state, and
started a second managed implementation campaign from another clean controller worktree.

This recovery choice increased cost without increasing information: the rejected candidate had
already demonstrated that the requested behavior and verification contract were satisfied.

### 5. Second candidate

The successor campaign produced commit `22a4f7bdf` with exactly the six required files and no
dependency symlinks. At the point this incident was escalated to the user, the managed engine was
still performing its review/verification tail even though the candidate worktree was clean.

## Impact

- **Delivery latency:** a local amend became multiple managed attempts and a successor campaign.
- **Attention cost:** the controller emitted frequent procedural status updates that did not help
  the user assess the actual P6D artifact.
- **Repository history:** four consumer-side governance commits were introduced before the product
  deliverable was integrated.
- **Resource cost:** external implementation/review seats and Mission reservations were spent on a
  task with a complete deterministic acceptance oracle.
- **Trust cost:** the controller described pipeline motion as progress instead of plainly stating
  that two unintended symlinks had been committed.

## Root-cause analysis

### Decision root cause 1: procedure availability substituted for task classification

Codex selected a route because the route existed and appeared rigorous. It did not first ask whether
the route could discover or verify anything beyond the six-path manifest and three commands already
provided by the HANDOFF.

### Decision root cause 2: workflow state replaced the artifact as the unit of recovery

After scope rejection, Codex reasoned from `campaign rejected` rather than from `candidate differs
from acceptance by two paths`. This made terminalization and successor mechanics appear mandatory
while the almost-complete artifact became disposable.

### Control failure: the manifest gate ran too late

The exact-path check existed as a downstream scope gate, but no equivalent comparison blocked the
commit itself. Functional tests therefore went green before the path violation was surfaced.

### Communication failure: procedural narration obscured responsibility

Frequent updates emphasized Mission states, leases, and review activity. The concise user-relevant
fact was: the implementation passed, but the commit contained two forbidden symlinks. That fact was
not given priority.

## Fable 5 independent judgment

At the user's direction, Codex sent the full incident chain and its own proposed seven-point remedy
to `claude-fable-5`. The prompt explicitly requested an unsympathetic judgment, decision-level root
causes, a minimal enforceable protocol, persistence boundaries, and the single correct next action
for P6D.

Fable 5's central ruling was:

> 這不是一次 git 失誤，是兩次判斷失誤——先用重流程處理輕任務，再用流程手段處理產出物問題。

On the recovery choice, it stated:

> 這等於因為快遞在玄關多放了兩個箱子，就把整棟房子拆掉重蓋。

It rejected Codex's initial seven-point checklist for three reasons:

1. it mostly patched the current symptoms rather than the failure class;
2. its important rules still depended on the same unaided judgment that had failed;
3. answering over-governance with seven more prose rules reproduced the original reflex.

Fable 5 proposed four minimal controls:

1. **Contract-first escalation gate.** A task with an enumerable deliverable manifest and
   deterministic verification is locked to direct implementation. Heavy dispatch must name a
   property the contract cannot verify; absent justification mechanically blocks dispatch.
2. **Pre-commit manifest gate.** Compare `git diff --cached --name-only` with the task's
   machine-readable allowlist before a commit can be created.
3. **Failure-response ladder.** The first response to a gate failure must be the cheapest local
   artifact repair and rerun of that gate. Pipeline rerun, successor creation, or governance edits
   are unavailable until an attempted local repair fails the same gate again.
4. **Status-report budget.** Deterministically verifiable work reports at start and completion;
   locally repaired intermediate gate failures belong in the completion report.

For the active P6D task, Fable 5 ruled that the only reasonable next action was to run the three
HANDOFF verification commands on the clean six-file candidate, accept it if green, and stop. It
explicitly rejected another Mission, governance retrofit, or review round as part of P6D.

## Corrective-action boundary

This record does **not** claim the four controls are implemented. Implementing them changes
Autopilot product behavior and requires its own bounded design, negative controls, and compatibility
review. The linked BACKLOG entry owns that future work.

The incident-specific facts that should not become global policy are the six P6D paths and a blanket
ban on symlinks. The persistent controls should target the general classes: unjustified escalation,
pre-commit manifest divergence, and workflow expansion before a local repair attempt.

## Immediate disposition

- Preserve this record and the BACKLOG pointer in Autopilot.
- Do not extend P6D with corrective-governance implementation.
- Resume from clean candidate `22a4f7bdf`.
- Run exactly the three HANDOFF verification commands.
- If all pass, integrate the six-path candidate and stop.

## Evidence index

- Consumer base before the clean successor: `e98a394425ff2f3d1b09ba7bcbaacd65ea76c321`
- Rejected but functionally green candidate: `a6886cabee5d0f11e2906c16760a11f7b0259d08`
- Clean six-path candidate: `22a4f7bdf`
- Fable 5 consultation: live `claude -p --model claude-fable-5` response on 2026-08-21;
  quoted above without changing its wording
- Corrective-work pointer: [`docs/BACKLOG.md`](../../../BACKLOG.md), entry
  “Contract-first escalation and local-repair gates — P6D incident follow-up”
