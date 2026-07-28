# Plan — Implementation Campaign Convergence Control
<!-- autopilot-authority-claims: ["campaign_generation","runner_transport_envelope"] -->

> **Status**: ✅ Shipped in v2.34.0 — merged as `c66349e`
>
> **Owner**: Core / depth-0
>
> **Target branch**: `develop`
> **Frame**: Autopilot flow correction; no Revival product implementation in this plan

## 0. Context / thesis

Revival World 3D ticket 057 exposed a control-plane failure, not one bad reviewer:

- the ticket ran for roughly 11.5 hours, produced 32 commits, and repeatedly dispatched
  implement/review work;
- the surrounding Codex session crossed several older tickets, compacted repeatedly, and
  retained stale concerns from 030/device QA;
- the first implementation unit covered Python, Rust, React, and harness surfaces without
  a file/LOC budget, so a POC entered review as a broad production-hardening campaign;
- Autopilot already had `resolve-review-loop`, `adjudicate-findings`,
  `check-repair-scope`, `check-loop-convergence`, durable ledgers, and status tools, but
  the actual run invoked none of the first four;
- raw dispatch scripts remained valid building blocks, so the orchestrator could repeatedly
  call them without one machine-owned campaign budget or terminal policy;
- transport defects and a long idle gap increased elapsed time, while branch/worktree churn
  and cross-ticket context made the state difficult to reason about.

The completed `review-scope-stop-loss` ship (`8d5140a`, v2.32.60) correctly constrains
which review findings may authorize repair and how far a repair may grow. It is necessary
but not sufficient: it is still possible for a canonical implementation flow to omit those
checks entirely.

**Thesis**: make `engine implement-review` the machine-owned implementation campaign
controller. A campaign freezes scope, delivery profile, budgets, and evidence once; composes
the existing dispatch/review/adjudication/scope/convergence primitives; and returns a
terminal outcome instead of relying on the orchestrator to remember prose rules.

## 1. Problem

Autopilot currently owns many correct local mechanisms but does not own their mandatory
composition. The failure mode is therefore:

1. a broad prompt is accepted without an explicit vertical slice or size budget;
2. review findings are treated as work orders before relevance disposition;
3. repair and re-review continue within a generous generic round count;
4. each dispatch has local durability, but no campaign-level deadline, growth accounting,
   or “new topic goes to backlog” terminal;
5. context compaction or a resumed session can re-enter through a raw primitive and silently
   lose the original boundary.

The goal is not to weaken review or forbid security work. The goal is to decide, before
mutation, whether a finding protects the current deliverable or belongs to a later ticket.

## 2. OKR / KRs

**Objective**: a bounded POC implementation reaches a testable vertical slice or stops with
an explicit disposition; it cannot turn into an open-ended hardening programme.

- **KR1 — Mandatory contract**: canonical `/l5`, `/l6`, and
  `engine implement-review` runs cannot mutate before a sealed campaign contract has passed
  schema, repository, base-SHA, scope, and budget validation.
- **KR2 — One controlled state machine**: every implementation, verification, review,
  adjudication, repair, and terminal transition is represented in one append-only campaign
  ledger and is resumable without replaying a completed mutation. ICC is the sole owner of
  campaign/repair generations; worktree lifecycle records those IDs only as provenance.
- **KR3 — Bounded POC**: the `poc` profile admits one vertical slice, at most two automatic
  repair generations, a frozen wall-clock budget, and explicit file/churn growth limits.
  A budget trip returns `STOP_FOLLOW_UP`, never another automatic dispatch.
- **KR4 — Review cannot redefine scope**: every actionable Critical/Major is disposed as
  `must-fix-now`, `follow-up`, or `reject-out-of-scope`; only the complete
  `must-fix-now` set may enter repair.
- **KR5 — Observable convergence**: `autopilot status runs --json` exposes campaign phase,
  generation, budget remaining, last durable artifact, and terminal reason without reading
  model prose. It is a raw campaign projection, not task-level `DONE|NOT DONE` or `can_close`.
- **KR6 — Regression proof**: a synthetic replay shaped like 057 reaches a visible vertical
  slice, defers optional preview hardening, and stops by generation two. A production-profile
  control retains the existing stricter review policy. Resource cleanup is proved by consuming,
  not reimplementing, a WLB lifecycle receipt.
- **KR7 — Immutable verification receipt**: authoritative verification runs against a frozen
  candidate with a closed writer lease and emits a reusable receipt keyed by
  `{tree_sha, argv_hash, env_fingerprint}`. Tree, command, or allowlisted environment drift is
  a cache miss; red receipts are never reused as green.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Reuse `adjudicate-findings.js`, `check-repair-scope.js`, `check-loop-convergence.js`, `run-ledger.sh`, and the existing dispatch rails; do not create competing sources of truth for findings, scope, convergence, or leases.
- A campaign contract is immutable after its first mutation; changing scope or budget requires a new ticket and a new contract.
- Severity alone never authorizes mutation: every actionable Critical/Major must have exactly one disposition, and only `must-fix-now` may enter repair.
- `spike` and `poc` optimize for the smallest testable vertical slice; hardening outside immediate integrity, authorization, or the frozen acceptance criteria becomes `follow-up`.
- No automatic path may exceed two repair generations for `spike` or `poc`, five for `internal-pilot` or `production`, or 120 minutes of campaign wall time.
- Raw dispatch scripts remain low-level primitives, but `/l5`, `/l6`, and `engine implement-review` may not bypass the campaign controller.
- Every mutating dispatch carries explicit allowed paths, maximum changed files, and maximum churn; an omitted budget fails before model spend.
- Terminal review is one bounded full-scope panel after focused repair validation; reviewer prose cannot schedule another generation.
- Transport failure, context compaction, or process death may resume the same durable campaign generation but may not reset its clocks, budgets, rubric, or completed stages.
- ICC is the only controller that claims campaign generations and owns the effectful `engine implement-review` intake composition.
- A Mission grant, provider-readiness receipt, and worktree-occupancy admission are versioned inputs to the ordered intake; ICC validates/consumes them but does not recompute their source facts.
- Mission atomic claim precedes ICC contract validation. Any later pre-spawn rejection emits a
  content-bound `PreSpendNoEffectReceipt` and releases the full Mission reservation exactly once
  before ICC can claim a generation.
- Campaign terminal usage must be at or below the claimed reservation on every axis; the receipt
  splits it into exact actual consumption plus freed reservation. Overspend is an accounting breach,
  not silently clamped.
- `CampaignReceipt` never asserts task-level `can_close`; lifecycle, merge, push, and finish authority remain downstream.

## 3. File-structure map

| File / surface | Responsibility |
|---|---|
| `schemas/implementation-campaign-contract.schema.json` | Versioned input contract: ticket, profile, Mission grant ref, base, vertical acceptance, allowed paths, file/churn limits, time/generation caps, verification command, review rubric. |
| `schemas/implementation-campaign-receipt.schema.json` | Campaign terminal and immutable verification receipt bindings. |
| `schemas/runner-transport-envelope.schema.json` | Shared mechanical runner status/request/private-raw-reference envelope; no semantic payload. |
| `src/transport/runner-envelope.js` | Sole shared exit/timeout/quota/unavailable classifier and request-binding validator. |
| `src/engine/implementation-campaign.js` | Pure campaign state machine and transition validation; no process spawning. |
| `src/engine/campaign-intake.js` | Sole ordered pre-spend composition point: Mission grant → campaign contract → readiness receipt → context gate → worktree occupancy. |
| `src/engine/autopilot-engine.js` | ICC-owned effectful adapter; compose existing implement/review calls through `campaign-intake` and the state machine. |
| `bin/autopilot.js` | Require `--campaign-contract` for `engine implement-review`; expose `campaign inspect` and `campaign resume`. |
| `scripts/implementation-campaign-check.js` | Deterministic schema/seal/grant/base/scope/budget preflight plus campaign/test receipt verifier. |
| `scripts/run-ledger.sh` | ICC-owned compare-and-swap campaign generation claims and additive campaign events; retain existing lease/idempotency semantics. |
| `src/status/` and `scripts/dispatch-status.js` | Join campaign ledger state with leaf telemetry for raw campaign status only. |
| `skills/ceo-agent/`, `skills/l5/`, `skills/l6/`, `skills/dev-flow/`, `skills/quality-pipeline/` | Route canonical mutation through the controller and define Core’s scope-adjudication duty. |
| `platforms/codex/plugin/**` mirrors | Generated/synchronized packaged copies; never hand-diverge from canonical files. |
| `hooks/tests/implementation-campaign.test.sh` | State-machine, fail-closed, resume, budget, and synthetic 057 regression cases. |
| `hooks/tests/autopilot-engine.test.sh` | Engine integration and backward-compatibility assertions. |
| `hooks/tests/implementation-campaign-receipt.test.sh` | Detached immutable candidate, writer fence, exact receipt hit/miss, red receipt, and generated-sync invalidation. |
| `docs/projects/<project>/` | Execution evidence and review artifacts after user approves this reviewed plan. |

Existing leaf dispatch scripts are dependencies, not ICC-owned decision surfaces. The
`autopilot-engine.js` adapter passes their public run/stage identity flags and normalizes their
result into the common transport envelope; leaf scripts never receive campaign generation or scope
authority from this plan.

## 4. Phases

### Phase 0 — Freeze the campaign contract and RED replay · Size S

Define schema version 1 with these required fields:

```json
{
  "schema_version": 1,
  "ticket": "057",
  "profile": "poc",
  "mission_grant_ref": "<content-addressed parent grant>",
  "repo_identity": "<canonical git identity>",
  "base_sha": "<immutable sha>",
  "branch": "impl/057",
  "vertical_acceptance": ["one end-to-end asset reaches the preview"],
  "allowed_path_prefixes": ["worker/", "server/", "client/"],
  "max_changed_files": 18,
  "baseline_churn": 900,
  "max_growth_ratio": 1.5,
  "max_extra_churn": 450,
  "max_repair_generations": 2,
  "max_wall_seconds": 7200,
  "verify_cmd": "<bounded command>",
  "rubric_ids": ["R1", "R2", "R3"]
}
```

Profile defaults are ceilings, never grants:

| Profile | Intended evidence | Automatic repair ceiling | Review treatment |
|---|---|---:|---|
| `spike` | answer one technical uncertainty | 1 | immediate integrity only; everything else follow-up |
| `poc` | one testable vertical slice | 2 | frozen acceptance + immediate integrity |
| `internal-pilot` | bounded trusted-user workflow | 5 | acceptance, integrity, operability within allowed paths |
| `production` | release-ready path | 5 | full configured production policy |

The contract must choose explicit values at or below profile ceilings. No profile may infer
allowed paths or expand a ticket. `implementation-campaign-check.js seal` writes an
independent digest seal; `check` rejects same-path seals, SHA drift, unknown fields, missing
budgets, path escape, and ceiling increases.

`mission_grant_ref` is nullable only while Mission supervision is project-configured `off|shadow`;
the campaign receipt then reports the parent axis as `unknown|shadow`. Once Mission enforcement is
enabled, it is required and must bind the exact campaign digest before spend. This lets ICC ship
first without fabricating a parent grant or creating a permanent bypass flag.

Before implementation, add RED fixtures proving current canonical flows can:

1. start without a campaign contract;
2. re-dispatch beyond a POC’s second repair;
3. omit finding disposition/scope checks;
4. reset control state by resuming under a new session;
5. run verification against a moving tree or reuse a green receipt after tree/argv/env drift.

**Acceptance**: schema fixture validation is deterministic; all five exploit fixtures fail
on current `develop` for the intended reason and are recorded before GREEN work.

### Phase 1 — Machine-owned campaign state and pre-spend gate · Size L

Implement a pure transition reducer with:

```text
PREPARED
  -> IMPLEMENTING
  -> VERTICAL_VERIFICATION
  -> REVIEWING
  -> ADJUDICATING
  -> REPAIRING -> VERTICAL_VERIFICATION
  -> TERMINAL_READY | TERMINAL_FOLLOW_UP | TERMINAL_STOP
```

Each event carries `campaign_id`, contract digest, generation, idempotency key, input/output
artifact digests, timestamp, and process-independent stage identity. The reducer rejects:

- skipped phases;
- two live leases for one generation;
- mutation without a sealed contract;
- review without vertical evidence;
- repair without registry-wide completeness plus a passing `repair-gate`;
- post-mutation progress without a passing `check-repair-scope`;
- a generation/wall/growth ceiling reset on resume.

`engine implement-review` gains required `--campaign-contract <file>`. It creates or resumes
the durable campaign by canonical repo identity + ticket, automatically passes ledger/run/stage
identity to every dispatch, and checks budget before any model process is spawned.

The single ordered intake is:

1. send a Mission `claim_request` and require its `grant_claimed` result when supervision is enabled;
2. validate campaign seal/base/scope/profile budget;
3. validate the exact provider-readiness receipt;
4. run the existing context-window gate;
5. acquire WLB worktree occupancy admission;
6. claim the ICC campaign generation and spawn the effect.

Steps 2–5 retain their owning rejection codes. ICC binds any rejection to the Mission claim in one
`PreSpendNoEffectReceipt`; Mission releases the full reservation, actual usage remains zero, and
resume cannot reuse the released claim. Terminal `CampaignReceipt` reports per-axis
`actual_usage + reservation_freed = original_reservation`; observed overspend yields
`accounting_breach` and blocks further grants.

Sibling modules return pure versioned decisions/receipts. They do not independently wire
`autopilot-engine.js`.
Before PRO/WLB/Mission axes ship, their ordered slots may return explicit `unknown|shadow` only;
the run cannot advertise full L5/L6 enforcement or clean closeout. An enabled/enforced axis may
never translate missing evidence to ready.

A temporary `--legacy-unmanaged` compatibility flag may exist for one release only, but:

- it emits a machine-readable deprecation terminal;
- it is rejected when `AUTOPILOT_LEVEL` is `l5` or `l6`;
- packaged CEO/dev-flow skills never emit it;
- its removal is a dated follow-up in the same project, not an indefinite escape hatch.

**Acceptance**: unit tests cover every valid transition and every rejected edge; marker-file
tests prove invalid/missing contracts spawn no runner and create no worktree.

### Phase 2 — Compose existing review and repair stop-losses · Size L

Wire the controller in this exact order:

1. preflight contract/seal/base/budget;
2. implement one vertical slice;
3. run the contract’s bounded verification;
4. if vertical evidence is absent, repair only the implementation acceptance failure within
   the same generation budget—do not start broad review;
5. dispatch focused implementation review against the frozen rubric;
6. ingest findings into `adjudicate-findings.js`;
7. depth-0 or a deterministic policy records exactly one disposition for every actionable
   Critical/Major;
8. run registry-wide `completeness`, then `repair-gate` for the must-fix set;
9. run `check-repair-scope` before repair, after mutation, and before acceptance;
10. run `check-loop-convergence` and campaign budget checks;
11. perform focused revalidation for a repair generation;
12. perform exactly one final full-scope panel, then terminate.

Verification freezes a clean candidate SHA, closes the campaign writer lease, and runs in a
detached immutable checkout. A green receipt is reusable only for an exact
`{tree_sha, argv_hash, env_fingerprint}` match. Secret values are excluded from the fingerprint;
generated-mirror synchronization creates a new tree and invalidates the old receipt. Baseline and
final full-suite runs are bounded; targeted repair verification remains available inside the
campaign cap.

Disposition admission:

- `must-fix-now`: maps to a frozen rubric/acceptance ID or proves immediate integrity or
  authorization harm inside allowed paths;
- `follow-up`: real and valuable, but deferrable or outside the current vertical slice; receipt
  includes context, trigger, and proposed backlog title;
- `reject-out-of-scope`: false premise, duplicate, policy mismatch, or unrelated subsystem.

The controller must not auto-write `docs/BACKLOG.md`; it emits a structured follow-up receipt
for lifecycle handling at depth-0. This prevents a reviewer from mutating tracking state.

**Acceptance**: synthetic findings containing one in-scope Major, one optional hardening Major,
and one refuted Major cause exactly one bounded repair; the other two are retained without
mutating the ticket. Missing/conflicting dispositions fail closed.

### Phase 3 — Canonical routing, durability, and raw campaign observability · Size L

Update `/l5`, `/l6`, CEO-agent, and dev-flow instructions so their only mutating implementation
entry is `engine implement-review --campaign-contract`. Low-level scripts remain documented for
tests, diagnostics, and controller internals, not as an equivalent workflow.

Supplying campaign identity automatically enables durable detach/ledger behavior; callers do not
need to discover magic flags. Implement the shared `RunnerTransportEnvelope` as a mechanical
exit/timeout/quota/unavailable + request-binding + private-raw-reference primitive; it never extracts
semantic JSON. PRS/PRO consume this module instead of creating another transport truth.

The canonical mutating entry also accepts one structured depth-0 disposition-authority artifact
or an explicitly selected deterministic policy and binds it to the review digest before invoking
the Phase 2 `campaignDispositionProvider` seam. A missing, stale, or reviewer-authored authority
remains fail-closed; the CLI never silently self-authorizes a non-empty review.

ICC separately owns product-review semantic normalization. Zero-byte/invalid/ambiguous product
review output has no authority. PRS keeps its plan-review normalizer, and PRO keeps readiness
observation validation. Endpoint normalization and provider truth belong to PRO/common config
transport; worktree cleanup belongs to WLB.

Campaign status joins campaign and leaf runs and reports idle versus dead versus completed. It does
not infer Mission terminal, integration, push, residue, `can_merge`, or `can_close`.

Status JSON includes:

```json
{
  "campaign_id": "...",
  "ticket": "057",
  "profile": "poc",
  "phase": "REVIEWING",
  "generation": 1,
  "repair_generations_remaining": 1,
  "wall_seconds_remaining": 3120,
  "growth": {"files": 9, "churn": 610, "ratio": 1.08},
  "last_artifact": "...",
  "terminal_reason": null
}
```

**Acceptance**: kill-and-resume tests adopt git truth and continue the same generation without
repeating implementation; status remains correct across a new shell/session; a terminal campaign
emits an exact lifecycle receipt reference or `unknown`, never an invented zero-residue claim.

### Phase 4 — Dogfood the 057 failure shape and ship · Size L

Create a hermetic miniature repo whose POC asks for one end-to-end asset transformation and whose
review fixture proposes an unrelated authenticated device-publication subsystem. Exercise:

1. `poc`: vertical slice passes, relevant defect repairs once, publication hardening becomes
   follow-up, final panel runs once, terminal READY/CONDITIONAL within two repairs;
2. runaway repair: generation three is rejected before model spend;
3. cross-ticket resume: different ticket/contract cannot acquire the campaign;
4. production control: a production acceptance criterion explicitly requiring authenticated
   publication makes the same finding eligible for `must-fix-now`;
5. process kill after committed mutation: resume adopts the commit and owes verification/review,
   not a duplicate implementation;
6. lifecycle handoff: campaign terminal references the WLB receipt and remains product-terminal
   even when residue is nonzero; downstream LSM keeps `can_close=false`.

Run focused tests, the complete dispatch/engine/quality suites, `sync-all`, package parity checks,
and the standard release/version/changelog workflow. Perform implementation Heto and final QC
under the project roster only after the implementation exists.

**Acceptance**: all six dogfood cases pass; canonical packaged skills contain the same routing
contract; no test weakens existing high-risk review, authorization, or artifact-integrity gates.

## 5. Test / validation

### Script-gated

- JSON schema positive/negative fixtures and seal immutability.
- Pure reducer transition table, idempotent replay, and illegal-edge tests.
- Pre-spend marker tests: cap/deadline/scope/disposition failures spawn no model process.
- Full-diff growth accounting and no-reset tests using real temporary Git repositories.
- Engine integration: vertical-first, one final panel, generation cap, terminal receipts.
- Receipt tests: immutable checkout, writer fence, exact green reuse, drift misses, red receipt,
  shared mechanical envelope, purpose-bound semantic normalization, zero-authority invalid
  transport, and kill/resume.
- Package parity: canonical and Codex/plugin mirrors match through `sync-all`.
- Existing `hooks/tests/autopilot-engine.test.sh`, dispatch tests, repair-scope tests,
  adjudication tests, convergence tests, and `scripts/tests/run-ledger*.test.sh`.

### Human/depth-0 gated

- Before implementation: user accepts this plan’s boundary and delivery-profile semantics.
- Before each repair: Core verifies evidence and assigns disposition; reviewers do not own scope.
- Before merge: at least one synthetic 057 receipt is read end-to-end and compared with the
  frozen contract; terminal status must be understandable without transcript archaeology.

## 6. Risks + inversion

| Failure guarantee | Mitigation |
|---|---|
| Add another advisory skill but leave raw canonical paths usable | Enforce the contract in the engine/CLI before model spend; test `/l5`/`/l6` payloads mechanically. |
| Duplicate ledger/finding/scope logic and create drift | State machine composes existing tools; new schema stores references/digests, not parallel findings. |
| Treat `poc` as permission to skip integrity or authorization | Immediate integrity/authorization harm is always eligible; production control proves profile changes relevance, not truth. |
| Make contracts so costly that operators bypass them | Provide a generated minimal contract template and clear fail messages; POC requires only one vertical acceptance plus explicit budgets. |
| Resume resets the budget | Durable identity is canonical repo + ticket + contract digest; session IDs remain metadata. |
| “At most two repairs” becomes two full-repo reviews plus a final loop | Focused repair revalidation inside the cap; one final full panel; reviewer prose has no scheduling authority. |
| Campaign controller becomes a giant process-spawning monolith | Pure reducer separate from engine adapters; transitions and effects tested independently. |
| Fixing transport expands into a general harness rewrite | Only the five reproduced 057 transport gaps are in scope; all other improvements become follow-ups. |

## 7. Out of scope

- Revival World asset-pipeline product code or ticket 057 completion.
- Replacing reviewer models, changing severity definitions, or introducing majority voting.
- Weakening production security, integrity, authorization, or artifact provenance requirements.
- A general workflow language, distributed scheduler, web dashboard, or new agent protocol.
- Automatically implementing reviewer-created follow-up tickets.
- Rewriting raw dispatch scripts when a narrow adapter or argument propagation is sufficient.
- Expanding `dispatch-plan-review.js` beyond its current bounded two-seat generation; this plan’s
  own four-seat review is an orchestration requirement, not a product requirement.
- Mission lineage/aggregate ceilings/authenticated user controls; owned by the Mission supervisor.
- Provider probing or qualification; owned by PRO.
- Worktree cleanup, branch disposition, or zero-residue judgment; owned by WLB.
- Task-level `DONE|NOT DONE`, merge, push, `can_merge`, `can_close`, or finish marker; owned by LSM.

## 8. Open questions

None. The user has already chosen the direction: write the systemic repair as a plan and send it
through at least four heterogeneous Heto seats before implementation.

## Dependency map

`Phase 0 contract/RED` → `Phase 1 state/pre-spend` → `Phase 2 review/receipt composition` →
`Phase 3 routing/durability/status` → `Phase 4 dogfood/release`.

Phases 1 and 2 may be implemented as separate commits but Phase 2 cannot merge without Phase 1.
Phase 3 may develop in parallel only after the contract schema freezes. Phase 4 is strictly last.
ICC ships before Mission supervisor binding. PRO and WLB provide versioned pure receipts; their
absence remains `unknown|shadow` during ICC core delivery rather than being reimplemented here.

## Self-review

- **Scope coverage**: campaign drift, review relevance, round/time/growth limits, vertical-first
  evidence, immutable verification, durability, session boundaries, transport authority, and raw
  campaign observability each map to a phase and KR; lifecycle cleanup is a consumed receipt.
- **Placeholder scan**: no `TODO`, `TBD`, or implementation-defining open question remains.
- **Dependency check**: every consumer names its producer; existing tools remain authoritative.
- **Inversion check**: the plan fails if it is advisory-only, duplicates state, lets resume reset
  budgets, or turns a POC profile into an integrity waiver; each has a mechanical negative test.

## Review log

- **R0 / 2026-07-26 / Core**: authored from transcript telemetry and current v2.32.60 source.
  Scope deliberately builds on `review-scope-stop-loss` instead of reopening it. Frozen rubric:
  `docs/plans/2026-07-26-implementation-campaign-convergence-control.rubric.md`.
- **Historical R1 / 2026-07-26**: gpt-5.6-sol, MiniMax, Gemini, and GLM reported READY on the
  pre-consolidation revision. Their reviewed hash predates the ownership audit.
- **R2 ownership consolidation / 2026-07-26**: ICC is now the sole campaign-generation and
  effectful-intake owner; immutable test receipts moved here from TCC; provider/lifecycle/task
  closeout were removed. A new bounded portfolio review is required before implementation.
- **R3 depth-0 portfolio-union correction / 2026-07-26**: final supplemental review proved Mission
  claim order and reservation release needed one exact ICC mirror. Claim now precedes ICC/PRO/WLB
  checks; any pre-spawn rejection emits one no-effect receipt and releases the full reservation;
  terminal usage cannot exceed the reservation without an explicit accounting breach. No new
  standalone review generation was opened.
