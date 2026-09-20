# Frozen Rubric — Mission Convergence Supervisor

> **Scope**: Review readiness of the ownership-consolidated Mission plan and its interfaces to the
> sibling plans. Review the future design, not current implementation.
> **Generation cap**: 2. Generation 2 may repair only admitted generation-1 blockers.
> **Blocking rule**: A blocker must map to one rubric ID, be `decision-now`, block the next
> implementation slice or cause immediate integrity/authorization damage, and be unsafe to defer
> to an implementation spike.

## R1 — Incident and layer fit

PASS when the design addresses root Mission long tails, successor/session/model budget resets,
direct/no-agent stagnation, ignored user closure, and provider maintenance leakage without claiming
that a Mission supervisor fixes local campaign defects.

BLOCK if a central Mission-level causal shape has no deterministic fixture or terminal behavior.

## R2 — Exclusive ownership

PASS when ownership is unambiguous:

- Mission supervisor: lineage, aggregate budget, parent grants, authenticated control, Mission terminal;
- ICC: campaign contract/generation/mutation/finding/test/campaign terminal;
- PRO: exact-tuple readiness receipt;
- WLB: worktree occupancy/lifecycle and residue receipt only;
- LSM: task status/merge/`can_merge`/`can_close`/finish marker;
- PRS/CTR/RSS retain plan-review, transcript and finding/scope ownership.
- one shared runner transport primitive owns only mechanical exit/status/request/raw-reference
  envelopes; ICC/PRS/PRO separately own their purpose-bound semantic validation.

The sole effectful intake is ICC; siblings export pure predicates/receipts.

BLOCK if two controllers can independently authorize the same generation, runner spend, cleanup,
task terminal, or marker clear.

## R3 — Lineage, grants, and aggregate budget

PASS when project default/task override provenance is frozen; only authenticated user/DOA control
may loosen a ceiling; active reservations plus consumption cannot exceed it; grants are atomic,
idempotent, campaign-bound and pre-spend; successor Missions inherit unresolved usage/reservations;
model, runner, reviewer, session, PID, branch and leaf IDs are provenance only. Every tightening or
loosening is a sequenced `ceiling_adjust` receipt; agent tightening is never silent.

BLOCK if unit splitting, fallback, resume, successor creation or identity changes can increase/reset
the authorized Mission budget.

## R4 — State, progress, and user control

PASS when Mission states and closure allowlist are mechanical; progress comes only from acceptance,
verified-blocker and scope-debt deltas; two stagnant campaign boundaries stop automatic expansion;
authenticated sequenced `finish|scope-freeze|abort` invalidates stale effects.

BLOCK if narration/tool/churn activity keeps a Mission alive, or a user stop remains advisory prose.

## R5 — Receipt and authority composition

PASS when the fixed pre-spend order is Mission grant → ICC contract → PRO readiness → context gate
→ WLB occupancy → spawn; every receipt is versioned/content-bound; raw invalid model output has zero
authority; Mission supervisor validates bindings but does not rejudge findings/tests/readiness/
lifecycle/merge; only Mission convergence may accept/reject the ICC grant claim; mechanical
transport and purpose-bound semantic normalization have distinct owners; `mission_terminal` is
explicitly distinct from `can_close`.

BLOCK if a missing/unknown receipt is treated as green, raw prose can authorize mutation, or sibling
judgment is silently duplicated.

## R6 — Projection, observability, and disclosure

PASS when Mission projections are compact and sufficient for a fresh context; known and unknown
counters stay distinct; terminal receipts expose lineage usage, blockers, sibling receipt states and
`undelegated_decisions[]`; no generic human result-approval gate is added.

BLOCK if compaction requires transcript replay to recover authority, missing telemetry becomes zero,
or the final report hides consequential model-made decisions.

## R7 — Enforcement and operational safety

PASS when rollout is shadow-first, current Codex blocking semantics are execution-probed, unsupported
harness/receipt axes remain `unknown|shadow`, terminal BLOCKED is visible, provider maintenance is a
separate Mission, and one setting rolls enforcement back to shadow. No daemon is introduced.

BLOCK if documentation/installation is treated as proof of blocking, activation can strand work
without a receipt, or the plan claims cross-harness enforcement without evidence.

## R8 — Bounded implementation and portfolio convergence

PASS when the plan has three independently mergeable phases no larger than L; ICC precedes Mission
binding; LSM follows Mission/WLB receipts; PRO/WLB cores can proceed independently; native Kimi,
PRS and CTR cannot block the core convergence path; changed sibling review verdicts are treated as
historical until re-reviewed; out-of-rubric discoveries go to backlog.

BLOCK if the plan still contains a duplicate sibling implementation, an unresolved ownership choice,
or an open-ended multi-platform/transport expansion that prevents the next slice from starting.
