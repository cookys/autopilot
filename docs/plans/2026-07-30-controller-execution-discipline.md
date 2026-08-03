# Controller Execution Discipline

Status: ✅ Shipped in v2.34.1 — final qualification repair merged as
`86f202f007505ee44125e555011bf5ce82f76a41`

## Background

The repair-lineage project closed the campaign-local branch, worktree, provider-session, and
finding-recurrence loop. It did not add the project-level controller authority needed to keep one
long-running Mission honest across dispatch, review, compaction, recovery, and cleanup.

The 2026-07-30 inventory compared every active convergence/lifecycle backlog entry with current
code and tests. The result is one related implementation batch:

| Backlog item | Inventory disposition |
|---|---|
| Review repair convergence | Already shipped; close the stale backlog row, do not reimplement. |
| Controller execution discipline | This batch's root contract. |
| Exact live quota identity | Include: it is a pre-spend identity gap on the same managed rail. |
| Mission output-path admission | Include: it controls the frozen deliverable's executable delta. |
| `boundary_rejected` status | Include: it is a controller terminal-semantics gap. |
| Missing finding disposition | Include: it must become a durable resumable wait. |
| QC minimum panel | Already shipped; close the stale backlog row. |
| Deterministic resume projection | Include: it prevents historical-output replay and fake work. |
| Codex compaction recovery | Include the host-neutral recovery gate, controller checkpoint, and hook-ready adapter; production Codex hook wiring remains evidence-gated by the user-owned probe. |
| Retained-worktree lifecycle | Lease enforcement and managed repair cleanup already shipped; include the missing generic outcome disposition/resource-debt admission. |
| Managed orphan mutation adoption | Include: it is the recovery path for the same durable work order. |
| Run-ledger rotation | Already shipped; retain only regression coverage. |
| Scheduler / portfolio optimization | Keep separate; its empirical trigger is not met. |
| Cross-harness authority hardening | Keep separate; it changes the threat model. |
| Session-local role qualification | Keep for Owner Kernel P4; transport observation must not become qualification authority. |

This is deliberately one frozen Mission deliverable. The three implementation seams below are
coverage inside that deliverable, not separately reviewable phases. Findings, retries, focused
tests, and repair rounds never increase the project denominator.

## Deliverable contract

Deliver one backward-compatible controller authority spanning Work Order, Mission admission,
Implementation Campaign, dispatch lifecycle, and compaction recovery.

### Authority and progress

1. Upgrade the durable Work Order without invalidating schema-2 records. One deliverable has one
   work-order identity and one CAS-governed record containing the frozen project/graph denominator,
   original dispatch run, branch/worktree/provider session, accepted commit, unresolved findings,
   review verdict, next action, expiry, resource inventory, and process parentage.
2. Repairs append immutable repair tickets and audit events to that work order. A repair may reuse
   the original resource lineage or present a machine-readable non-reuse/disposition receipt; it
   may not silently create a successor identity.
3. Emit a digest-bound progress receipt after each controller round with project, deliverable,
   generation, active process, completed and remaining deliverables from the frozen graph, blocked
   reason, ETA basis, gate state, and resource-debt state.
4. Persist one gate journal for authoritative full-diff review, focused verification, full suite,
   and joint review. Every gate has one owner, input digest, start/finish time, result, and explicit
   invalidation reason. A matching successful result is reused instead of forgotten and rerun.
5. Enforce a joint repair budget over model calls, fresh input bytes, fresh input tokens when
   observable, elapsed wall time, owned worktrees, and normalized finding recurrence. Any exceeded
   axis transitions durably to `awaiting_convergence_adjudication` before new model or checkout
   spend.
6. A transcript/resource audit reconstructed from root-run and work-order IDs must explain every
   dispatch/re-dispatch, resource creator, gate return, repair authorization, and disposition.
   Undispositioned owned resource debt blocks the next managed dispatch.

### Campaign and Mission semantics

7. The first candidate receives one authoritative frozen-base-to-candidate full-diff review before
   any repair dispatch, including when vertical verification failed. A focused delta may supplement
   but never satisfy or replace the generation's full-diff barrier.
8. Preserve `boundary_rejected` as a first-class non-success outcome with candidate reference and
   exact boundary reason. It must never collapse to unknown status or fabricated mutation-failure
   evidence.
9. Valid review findings without bound disposition authority enter resumable
   `awaiting_disposition`; malformed or identity-mismatched findings remain a hard fail. Resume
   consumes the same work order and findings.
10. Mission graph admission separates paths allowed to change from paths required to change,
    rejects absent outputs unless they are explicitly authorized creates, verifies named generator
    closure for version mirrors, and rejects historical-output replay before dispatch.
11. A receipt can adopt an already-satisfied node as a no-op only when its base, acceptance
    evidence, and current bytes are mechanically bound. A precondition/no-effect result with
    `dispatcher_called === false` consumes no mutation/gate attempt. Narrow repair output does not
    require cosmetic changes to every historically allowed path.
12. Live capability probing writes and reads the same exact runner/model/effort/endpoint identity.
    Legacy capability rows remain telemetry and cannot authorize a strict exact-tuple dispatch.

### Recovery and lifecycle

13. Before the first managed effect after handoff/compaction/restart, reconcile the work order with
    Git HEAD and dirty digest, rotation-aware Run Ledger/campaign state, manifests/results, current
    worktree inventory, and PID/start-time plus parent-chain identity. Narrative text is never an
    authority source.
14. The same recovery gate classifies active, terminal, aborted, unknown, orphaned, and
    disposition-blocked resources. Generic retained dispatch outcomes receive a durable
    disposition; clean/recoverable residue can be bundled and released, while dirty/unique/unknown
    residue remains owned and blocks dispatch.
15. Admission performs a configurable high-water check before checkout creation. Insufficient
    temporary capacity or an unresolved retained-resource ceiling fails closed with zero new
    branch/worktree/runner effects.
16. A controller-death adoption transition may consume an implementation or repair leaf result
    only after proving the old controller dead and binding leaf result, branch tip/tree, base
    ancestry, scope/churn, worktree digest, and generation. Valid adoption advances the same
    campaign without duplicate mutation; ambiguity preserves evidence and stops.
17. Expose a deterministic, hook-ready PostCompact adapter that runs the same recovery gate.
    Shipping it in the production Codex manifest requires accepted live probe evidence for event
    payload, cwd/root identity, trust, timeout, and blocking semantics. The adapter must not infer
    those facts or overwrite the user's in-progress hook-probe files.

## Execution policy

- One Mission graph node, one implementation campaign, one work order, and one candidate lineage.
- Authority/campaign/recovery seams may be implemented in any dependency-safe order, but no
  sub-seam receives a separate QC task or intermediate review panel.
- Deterministic focused tests may run during implementation. The authoritative review begins only
  after the combined candidate satisfies the implementation contract and focused test pack.
- The final review consumes the entire frozen-base-to-candidate diff. Any authorized repair stays
  on the same work order and lineage; it does not create a new deliverable or denominator entry.

## Expected implementation surfaces

- `src/engine/work-order.js`
- `src/engine/implementation-campaign.js`
- `src/engine/campaign-composition.js`
- `src/engine/campaign-intake.js`
- `src/engine/autopilot-engine.js`
- `src/engine/mission-execution-graph.js`
- `src/campaign/cli.js`
- `scripts/mission-routing-admission.js`
- `scripts/compaction-rehydrate.js`
- `scripts/dispatch-hetero.sh`
- `scripts/probe-engine-capability.sh`
- schemas and deterministic tests directly owned by those components

Prefer extending the existing Work Order/campaign/Run Ledger authority over introducing a parallel
project tracker. New mechanical helpers must be registered in the scripts inventory and relevant
skill table; generated Codex payload is updated only through the canonical sync script.

## Acceptance

1. A one-node and a multi-node fixture prove the frozen denominator is stable across findings,
   retries, test batches, compaction, and resume; progress receipts remain digest-valid.
2. Initial candidate with failing vertical verification still records an authoritative full-diff
   review before any repair call. A focused-only verdict cannot authorize repair.
3. One work order survives initial implementation, findings, repair, compaction, and completion.
   Repair tickets append; duplicate active dispatch produces zero new branch/worktree/runner calls.
4. Each repair-budget axis has an independent red test and all overages converge on
   `awaiting_convergence_adjudication` before spend.
5. Gate-journal tests prove matching results are reused, changed inputs require explicit
   invalidation, and owners/timing/results remain reconstructable.
6. `boundary_rejected` retains committed candidate and reason; missing disposition pauses and
   resumes; malformed finding authority still fails closed.
7. Mission admission rejects a typo/nonexistent output, missing create authority, incomplete
   version-mirror closure, and historical replay; it accepts a narrow required-change set and a
   digest-bound no-op without spending an attempt.
8. Exact effort/endpoint capability probe rows authorize only the matching strict tuple; legacy,
   stale, or neighboring tuples do not.
9. Recovery replay of `16/34` remains `16/34`, reconciles Git/ledger/manifests/process parentage,
   and blocks a second dispatch while resource debt is unresolved.
10. Generic clean/dirty/unique/unknown outcomes receive safe dispositions; high-water admission
    creates zero resources; every released item has a verifiable recovery bundle/receipt.
11. A pre-checkpoint controller kill adopts the exact completed leaf once, keeps candidate bytes
    and generation monotonic, performs zero duplicate mutation dispatches, and resumes ordinary
    verification/review. Ambiguous cases remain stopped with evidence.
12. Rotation during implementation/review remains green; existing repair-lineage, campaign,
    Mission, dispatcher, lifecycle, capability, and compaction suites do not regress.
13. Full repository validation, canonical invariants, Codex payload sync, completeness/security
    scans, and the repository hook suite pass once after implementation.
14. One blind final joint review evaluates the complete frozen-base-to-candidate diff and returns
    no unresolved Critical or Major findings.

## Risks and mitigations

- **Broad shared-state change**: keep one authority spine and backward-compatible readers; add
  red/green fixtures for schema-2 continuation and legacy Mission graphs.
- **Recovery may destroy evidence**: all uncertain/dirty/identity-mismatched cases fail closed;
  cleanup requires a digest-bound disposition and recoverable bundle.
- **Unavailable token telemetry**: missing token counts remain `unobserved`, never zero. A byte/call
  ceiling still applies and the receipt discloses which axes were observable.
- **Codex hook semantics are not yet production evidence**: land a host-neutral adapter and tests,
  but do not modify or claim production hook wiring until the separate live probe is accepted.
- **User-owned dirty files/stashes**: preserve them byte-for-byte and stage only project-owned
  paths.

## Out of scope

- Critical-path scheduling, dynamic reorder, cross-repository portfolio dashboards, or a second
  Mission authority.
- Protection from a malicious same-UID process or unsupported cross-harness blocking adapters.
- Turning transport/probe success or disk-backed scorecards into role qualification authority.
- Owner Kernel P4 role qualification and release decision; it starts only after this controller
  project closes.
- Unrelated Kimi, CLAUDE.md size, release-prose, or test-flake backlog entries.
- Destructive cleanup of historical branches, stashes, worktrees, or manifests without an exact
  disposition receipt.

## Open questions

None block implementation. Production Codex PostCompact wiring is a conditional closure item:
accepted live probe evidence permits it in this batch; absent that evidence, the hook-ready adapter
ships while the manifest remains deliberately unchanged and the backlog records the exact missing
evidence.
