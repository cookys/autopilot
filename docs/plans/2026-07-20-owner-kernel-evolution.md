# Plan — Owner Kernel evolution

> **Status**: Board-approved after five-family heterogeneous review — implementation authorized
> **Owner**: a qualified depth-0 principal, persisted as a logical role through durable events
> **Proposed branch**: `feat/owner-kernel-governance`
> **Frame**: replace flow-led autonomy with owner-led governance without weakening executable evidence

## 0. Context / thesis

Frontier coding models increasingly support long-horizon agentic work. Autopilot's current architecture
was built when the safer default was to compensate for model weakness with a fixed sequence of planning,
decomposition, implementation, re-review, panel review, and human gates. That sequence still prevents
omissions, but now has two costs:

1. a strong model spends attention satisfying workflow ceremony instead of adapting to the work; and
2. `think-tank`, dialectic, engine review, quality review, and depth-0 QC each implement reviewer-like
   dispatch while serving different purposes.

The target is an **Owner Kernel**: a strong model continuously owns intent, decisions, delegation,
recovery, and acceptance. Workers supply bounded labor. Counsel supplies alternative reasoning.
Challengers supply independent objections. Deterministic verification supplies executable evidence.
The user configures project governance and red lines once, then is interrupted only for irreversible,
externally costly, security-sensitive, public, acceptance-changing, or materially scope-expanding
decisions. Other non-explicit decisions are disclosed after completion from durable events.

Process can preserve state and expose errors; it cannot manufacture frontier judgment in a weak model.
Weak models therefore receive bounded, verifiable work and never inherit ownership authority.

## 1. Problem

Autopilot currently exposes execution topology as product semantics:

- `/l3` means inline;
- `/l4` means a foreman;
- `/l5` adds a heterogeneous implementer;
- `/l6` also delegates verification authoring.

The user chooses wiring before the owner knows the work's actual risk. Meanwhile, think-tank, engine
review, and QC panels partly duplicate dispatch, verdict, retry, and reporting contracts. Topology,
cognition, and authority look interchangeable even though they are not.

The desired contract is:

```text
versioned user intent + project governance
                    |
          persistent qualified owner
          decide / delegate / adapt
          /         |          \
     counsel      workers    verification
    advisory      bounded    evidence + challenge
                    |
          owner-event ledger
                    |
        acceptance + decision disclosure
```

The owner chooses topology at runtime. Self-review may improve an artifact but cannot approve it. An
independent model may veto judgment but cannot prove an executable property. A failing test, schema,
acceptance command, or provenance check always vetoes. A passing executable check is necessary whenever
the contract has an executable leg. A contract with no executable leg requires a qualified independent
challenge bound to the final artifact hash; an owner-authored acceptance statement is disclosure only.

## 2. OKR / KRs

**Objective**: make Autopilot an owner-led unattended project system whose governance is selected once
per project, while reducing review ceremony and preserving fail-closed acceptance.

1. A project sets `owner-led` or `milestone-led` governance once and can override it for one run without
   mutating the project default. `owner-led` is the unattended default.
2. The owner remains responsible across planning, execution, recovery, and acceptance; worker self-report
   and owner self-review never transfer or satisfy acceptance authority.
3. Decision authority is derived from deterministic operation facts where observable. Every host declares
   verified `full`, `partial`, or `none` observability; unknown or conflicting facts become
   `approve-before`, and `none` blocks both autonomous governance modes.
4. Final output includes a machine-rendered list of non-explicit decisions with rationale, evidence,
   reversibility, scope effect, and principal identity. Filtering is by event type and intent provenance,
   never owner recollection.
5. Model assessments expose three non-overlapping purposes: `counsel`, `repair`, and `challenge`. Only a
   qualified independent `challenge` bound to the reviewed artifact hash may be a model veto gate.
6. Acceptance is asymmetric: executable failure always vetoes; executable success is necessary when an
   executable leg exists; a non-executable contract requires an independent challenge; no model verdict
   can approve over a failing executable gate.
7. `/l3`–`/l6` remain compatibility aliases for exactly one release cycle, translated by one executable
   source of truth. They never select a second lifecycle or acceptance implementation.
8. On the frozen orchestration corpus, activation requires zero false acceptances, zero missed red-line
   escalations, and at least 30% fewer mandatory model-review dispatches than the P0 legacy baseline. A
   mandatory dispatch is one whose absence violates a red line, required challenge, or acceptance policy;
   optional counsel and repair are reported separately and never counted as mandatory.
9. On the three-task manual spike, mandatory review dispatches must fall by at least 30%, all accepted
   outcomes must remain accepted by independent adjudication, and a different session must reconstruct
   every open approval and non-explicit decision from the minimum JSONL ledger without the transcript.
10. After alias removal, the number of load-bearing skill/script/schema/module surfaces executed by a
    normal owner-led run is lower than the P0 baseline and its P0-projected absolute target. Compatibility
    stubs do not count as removed until their lifecycle and trust prose is deleted.
11. Exactly one qualified owner principal is active while a run is executing. Roster exhaustion or
    qualification loss suspends the principal and blocks with zero active owners; it never activates two or
    silently promotes a weaker owner. User-authority and executable-truth events are accepted only from
    their authenticated emitters.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Deterministic verification and artifact provenance remain authoritative; executable failure always vetoes and no model verdict may approve over it.
- Worker self-report and owner self-review are advisory evidence only; neither may approve its own artifact.
- Exactly one qualified owner principal is active; qualification expiry, ambiguity, or downgrade fails closed to `approve-before`.
- Owner decision capability is per-run, non-exportable, and expires no later than its qualification evidence; qualification is re-checked at every decision mint and acceptance.
- Acceptance is owned only by Owner Kernel; conservative rollback changes policy requirements inside the Kernel and never routes to a second lifecycle.
- Red-line operation facts are derived or cross-checked mechanically where the host exposes them; label conflict or unknown facts fail closed to `approve-before`.
- Each host has a probed `full`, `partial`, or `none` observability tier. `partial` must name the complete observable subset and mediate unobservable red-line actions; `none` blocks both autonomous governance modes.
- The resolved governance policy and acceptance contract are content-addressed at intake; changing, substituting, or weakening either is `approve-before` and preserves the original value and failing evidence.
- User approval binds to the exact decision content hash; a superseding decision invalidates prior approval.
- Red-line approval has an explicit use bound and is consumed atomically with the authorized action; irreversible decisions default to one use.
- `intent`, `approval`, and user-abort events come only from an authenticated user channel; authoritative `evidence`, `checkpoint`, and `acceptance` events come only from the Kernel or a trusted runner.
- A required challenge binds to the reviewed artifact hash; any later artifact change invalidates the result and requires re-challenge.
- A challenge result becomes acceptance input only through a Kernel-witnessed evidence event referencing the validated review-result hash and qualified challenger identity.
- The user is interrupted only for configured red-line decisions; all autonomous non-explicit decisions appear in the event-derived final disclosure.
- Blocked runs never time out into approval. A configured liveness limit may only emit a disclosed Kernel abort.
- External push, publish, send, charge, or deployment remains a separate red-line decision; artifact acceptance never implies delivery authority.
- Governance mode is a project default with a per-run override; model names and runner topology are not part of the user-facing governance vocabulary.
- Existing `/l3`–`/l6` commands translate through one executable table for exactly one release cycle and cannot weaken project red lines.
- A missing qualified challenger blocks and opens an `approve-before` escalation; self-review, same-family substitution, and silent downgrade are forbidden.
- New Kimi or Qoder runners cannot enter a gating roster until role-specific scorecard qualification passes with zero false-pass on critical cases.
- No subscription token, OAuth credential, raw reasoning, or model response body may be committed or emitted into result metadata.

## 3. File-structure and deletion map

The implementation adds one event schema, one cohesive engine package, one thin CLI, and one project
config. The package splits policy, event, transition, authority, acceptance, reconciliation, and disclosure
responsibilities behind one public entry point. Other changes extend existing contracts. No second
governance validator, decision script, review schema, or review dispatcher is added.

| Surface | Action | Responsibility / replacement |
|---|---|---|
| `project-config-template/governance-config.md` | Add | Project mode, red lines, approval classes, conservative profile, and run override syntax. The resolved policy is hash-pinned at intake. Replaces per-run involvement/scope/topology startup questions. |
| `.claude/governance-config.md` | Add | Self-hosted policy for shadow and dogfood. |
| `schemas/owner-event.schema.json` | Add | One hash-chained union for `intent`, `decision`, `approval`, `abort`, `evidence`, `principal_change`, `suspension`, `checkpoint`, `acceptance`, and non-authoritative `translation_used`, including emitter provenance and per-type minting constraints; unifies intent/decision/approval/evidence typing. |
| `src/engine/owner-kernel/` | Add | Cohesive package: `index.js` public API plus narrowly scoped `policy.js`, `events.js`, `transitions.js`, `authority.js`, `acceptance.js`, `reconciliation.js`, `disclosure.js`, and `compatibility.js`. Compatibility calls the fixed `events.js` API and cannot import acceptance/transitions; no module owns both event minting and acceptance. |
| `scripts/owner-kernel.js` | Add | Thin CLI over the engine package: `resolve`, `verify`, `reconcile`, `status`, `disclose`, `translate-level`. It exposes no generic event append path; host adapters and Kernel internals call typed package APIs. This is the only `/lN` translation table. |
| `src/engine/autopilot-engine.js` | Extend | Calls Owner Kernel while retaining worktree and runner seams. |
| `schemas/dispatch-unit-contract.schema.json` | Extend | Add assessment `purpose` and requested `authority`; keep the generic dispatch contract as the one injection point. |
| `schemas/review-result.schema.json` | Extend | Add effective `purpose`, `authority`, reviewed artifact hash, and reviewer qualification evidence; reject self/same-family gate claims. Evidence remains a typed ledger event, not a review result. |
| `src/runners/review.js`, `scripts/dispatch-review.sh` | Extend | Transport and validate the existing canonical review result. No parallel review-result contract. |
| `scripts/resolve-review-loop.sh` | Narrow | Resolve model availability/qualification and repair/challenge roster only; governance stays in Owner Kernel. |
| `hooks/orchestrator-edit-gate*.js`, `hooks/audit-log.js` | Extend | Pre-action red-line check on `full` hosts; normalized audit evidence and capability declaration for reconciliation. Atomically claim a bounded decision use and revalidate intent, principal, approval, and observability immediately before the side effect. Protect the resolved policy, Kernel package/CLI, owner schema, and gate source from owner/worker edits. `partial` hosts expose only red-line capabilities that are enforceably mediated. |
| `skills/ceo-agent/SKILL.md` | Replace sections | Delete startup involvement/topology questions, duplicated DOA table, scope forcing prose, and tree authority loop; load resolved governance and owner obligations. |
| `skills/l3/SKILL.md` through `skills/l6/SKILL.md` | Reduce, then retire | One-cycle alias stubs calling `translate-level`; delete independent lifecycle/trust bodies immediately, remove aliases after telemetry gate. |
| `skills/ceo-agent/references/level-front-door.md` | Delete after alias cycle | Translation is executable SSOT; generated `owner-kernel translate-level --all` output replaces hand-maintained prose. |
| `skills/think-tank*.md` | Narrow | Counsel and rare stalemate escalation only; delete acceptance/review implications. |
| `skills/quality-pipeline/SKILL.md` | Narrow | Executable verification plus policy-selected challenge; delete model gates duplicated in CEO and `/lN` bodies. |
| `docs/architecture.md`, `docs/configuration.md` | Update | Owner/counsel/worker/challenger/evidence model and project policy. |
| `evals/orchestration/` and existing test surfaces | Extend | Frozen comparison corpus, negative controls, and transition tests. |

Generated Codex payload files remain sync outputs, not manual edit targets.

### Deletion gate

P0 records the current per-run load-bearing responsibility surfaces and the modules actually executed,
then amends this plan with the projected absolute post-P3 target. P3 cannot complete until every added
surface maps to the deleted or narrowed surface above and the normal owner-led path executes fewer
load-bearing surfaces than both the legacy baseline and the projection. Splitting a god-object into focused
modules is not a regression by itself, but every executed module counts. If the total does not fall, the
refactor has failed its simplification objective.

#### P0 measurement (recorded 2026-07-20, run `owner-kernel-p0-1784543437001`)

Method, per-class members, and exclusions:
[`docs/projects/2026-07-20-owner-kernel-governance/p0/surface-baseline.md`](../projects/2026-07-20-owner-kernel-governance/p0/surface-baseline.md).

| Field | Value |
|---|---:|
| **Legacy absolute baseline** (proven executed, normal width-1 `/l5` run) | **42** |
| — with the two opt-in hooks `/l5` entry arms | 44 |
| **Projected absolute post-P3 target** (derived from § 3 above) | **51** |
| KR10 requirement | post-P3 < baseline |
| **KR10 status against this projection** | **FAILS — projects a rise of 9** |

The baseline is a **floor, not a ceiling**: scripts fired by the foreman's inline
`dev-flow` → `finish-flow` → `quality-pipeline` phases were not traced in this pass and are
excluded rather than assumed. An undercounted baseline makes the projection conservative in this
plan's favour, and the projection still fails.

The cause is structural: this plan's deletions are concentrated in **prose** (`/l3`–`/l6` bodies,
`level-front-door.md`, duplicated trust narration), while its additions are concentrated in
**executed modules** (a nine-module engine package, a CLI, a schema) — and the gate counts executed
modules. Closing it requires either a named deletion manifest of ≥ 9 currently-executed surfaces, a
revised KR10 that counts responsibility surfaces rather than module cardinality, or an explicit
Board decision that KR10 is not a release gate. Changing a KR's definition after seeing its
measurement is a Board decision, not an implementation choice — cf. § 6 *"The acceptance test is
laundered."*

Also recorded for KR8/KR9: the **mandatory model-review dispatch baseline is 6**, not the 28
mandatory QC steps overall. Measuring "30% fewer" against 28 would mostly be measuring
deterministic `verify` scripts this plan commits to preserving. See
[`semantic-inventory.md`](../projects/2026-07-20-owner-kernel-governance/p0/semantic-inventory.md).

## 4. Phases

### P0 — Semantic inventory, baseline, and no-core-code spike

**Size**: L, with a Size-S three-task spike as the funding gate
**Depends on**: none
**Acceptance**: the semantic/deletion matrix is complete and the manual spike meets KR9; otherwise stop
without adding schemas, engine modules, or product code.

1. Inventory every invocation of think-tank, dialectic, engine review, quality review, and depth-0 QC;
   classify it as `decide`, `counsel`, `repair`, `challenge`, or `verify` and name its current authority.
2. Record load-bearing responsibility surfaces and actually executed modules. Amend this plan before P1
   with the legacy absolute count and projected post-P3 absolute target; percentages alone cannot fund P1.
3. Count a mandatory model-review dispatch only when omitting it violates a red line, required challenge,
   or acceptance policy. Report optional counsel and repair separately. Count ceremony tokens as UTF-8
   bytes divided by four over injected lifecycle/policy prose, using the same frozen prompt builder for the
   baseline and Kernel candidate.
4. Probe each target harness and record `full`, `partial`, or `none` observability with captured capability
   evidence. `full` has preventive pre-action events plus complete audit; `partial` declares its complete
   observable subset and proves that red-line capability outside it is unavailable or mediator-only;
   `none` cannot enter either autonomous governance mode. The probe also attempts protected-event envelope
   forgery, direct decision append, worker-artifact decision injection, child-process capability theft,
   policy/Kernel mutation, mediated-action bypass, capability-set drift, and witness-head rewrite. A host
   capability passes only when the owner handle stays in host memory or a broker/IPC handle inaccessible to
   model tools and worker processes; a prose promise is not evidence.
5. Add baseline fixtures for low/high-risk executable work, mixed executable/non-executable work,
   non-executable design, irreversible action,
   mislabeled reversibility, acceptance substitution, approval supersession, worker failure, unavailable
   challenger, owner principal swap/expiry, session resume, intent amendment, event-log tampering, and an
   unknown decision class.
6. Run three real low/medium-risk tasks with the existing engine and the minimum proposed JSONL event
   fields. The owner chooses topology; existing deterministic gates still execute; an independent reviewer
   adjudicates acceptance and ledger completeness. Resume at least one task in a different session using
   only the ledger and durable evidence store.
7. Stop the project if the spike misses any KR9 threshold. No architectural code is justified by model
   release claims alone. Also stop if no target host achieves `full` or `partial` with the authenticated
   user channel, active-owner capability, mediator/pre-action enforcement, and append-only witness roots.

> **P0 EXECUTION STATUS (recorded 2026-07-20, run `owner-kernel-p0-1784543437001`): INCOMPLETE —
> BLOCKED. Step 4 was NOT performed and step 7 is NOT EVALUABLE.** Evidence:
> [`docs/projects/2026-07-20-owner-kernel-governance/p0/P0-FINDINGS.md`](../projects/2026-07-20-owner-kernel-governance/p0/P0-FINDINGS.md).
>
> **Step 4 as written cannot be executed in P0.** It requires eight named attacks per target
> harness, but **six of the eight attack Owner Kernel surfaces that P1 creates** — protected-event
> envelopes, the decision-append path, owner capability handles, the mediator, and the capability
> set. A gate that authorizes P1 cannot depend on P1's artifacts. Actual coverage achieved: **2 of
> 8 attacks on 1 of 4 hosts** (witness-head rewrite executed; policy/Kernel mutation partial).
>
> Consequently the step-7 kill condition — a universal negative over four hosts — **has not been
> evaluated**, and must not be treated as met. Three target harnesses were never probed; an
> unprobed host is *not qualified*, which is **not** the same as *proven incapable*. P1 remains
> unauthorized because the pass bar is unproven, not because it was failed.
>
> **Board decision required before P0 can be completed or fairly failed.** Options: (1) split the
> gate so P0 probes only pre-existing roots and the six Kernel-surface attacks become a P1-exit
> gate; (2) authorize a throwaway probe harness in P0, which is product code and needs an explicit
> exception to the no-core-code rule; (3) amend the kill condition to something P0 can evaluate.
> No option is recommended here.
>
> Findings that DO survive, scoped to the executing host (Claude Code) only: an actively-executed
> **witness-head rewrite succeeded** (no append-only attribute, no external receipt chain), and
> **no pre-action mediation is currently active** (the only preventive gate is default-off,
> unarmed, fails open, and its control surfaces are model-writable).

### P1 — Governance and durable owner events

**Size**: L
**Depends on**: P0 gate passes
**Acceptance**: low-risk owner-led dogfood resolves project policy, survives session replacement, blocks
hash-invalid approvals, and renders complete disclosure from the unified event ledger.

1. Support only two modes:
   - `owner-led`: the qualified owner continuously decides, delegates, monitors, and accepts;
   - `milestone-led`: the qualified owner is re-instantiated at plan, milestone, and acceptance boundaries;
     this is a model-owner checkpoint, not a human result-approval gate.
2. Define and enforce the event-minting matrix:
   - authenticated user channel only: `intent`, `approval`, and explicit user `abort`;
   - current qualified owner only: `decision`;
   - Kernel or trusted runner only: authoritative `evidence`, `checkpoint`, timeout `abort`, and
     `acceptance`;
   - Kernel only from witnessed intent derivation: `suspension`;
   - Kernel after deterministic roster resolution only: `principal_change`;
   - translation code path only, witnessed but without acceptance authority: `translation_used` telemetry.
   Every event carries emitter kind, identity, channel, timestamp, run ID, previous-event hash, and content
   hash. Every run has a distinct capability nonce and witness stream; cross-run append is rejected. The
   Kernel rejects type/emitter mismatches before append, and the shell CLI has no generic append command.
   Decisions require a per-run active-owner capability held in host memory outside every model tool and
   worker environment and verified by the Kernel's in-process API. Only the harness owner-turn adapter may
   mint a decision, and its structured payload binds current principal, run, and owner-turn envelope;
   workspace files, tool output, and worker artifacts are not valid decision sources.
   User events require a harness-witnessed input envelope whose witness key/channel is outside the
   model-readable environment and repository. Evidence requires the Kernel's `verify` path or an allowlisted
   runner identity plus a Kernel-verified attestation reference; unverifiable attestations are rejected. P0
   actively probes these roots of trust before assigning `full` or `partial`.
3. Mint versioned `intent` events from user-authored text captured by the host's authenticated user-input
   adapter, including the existing intent-capture seam where verified. A new intent version suspends all
   derived decisions and approvals until the owner re-derives them; acceptance-contract impact remains
   `approve-before`. Supersession emits suspension events for derived decisions and invalidates their
   in-flight dispatch contracts; pre-action gates and the mediator reject suspended work. An action that
   completed before witnessing is recorded as superseded and requires re-authorization before acceptance.
4. Freeze both the resolved governance policy and acceptance contract as content hashes at intake. The
   contract contains each executable command and declared artifact/leg mapping; the acceptance transaction
   recomputes that complete hash, so command substitution is contract drift. Any substitution, weakening,
   or drift is `approve-before` and includes the original policy/contract and failing evidence.
5. Store approval as its own event referencing `decision_id`, decision content hash, and `max_uses`.
   Irreversible actions always use exactly one regardless of payload. Another red-line class may use N>1
   only when its frozen policy row permits that bound and the authenticated user approval references the
   exact N. The pre-action gate atomically claims/decrements one use under the action lock; supersession,
   exhaustion, mismatch, or failed revalidation re-blocks.
6. Enforce exactly one active owner principal. The intake-frozen governance policy pins the qualified-owner,
   challenger, and trusted-runner rosters plus their attestation issuers/verification material, identities,
   roles, families, and expiry. Record runner, model alias, version when available, and the verified
   attestation URI/hash with issue and expiry times. Owner capability expiry is
   `min(attestation_expiry, configured_capability_ttl)`. Re-check qualification before every decision mint,
   checkpoint/resume, and acceptance; failure revokes the capability and becomes `approve-before`.
   An equally qualified replacement resolved against this protected roster is `disclose`; roster
   exhaustion suspends the principal and enters `blocked`/`approve-before`, then may timeout-abort, but the
   Kernel cannot mint a replacement outside the frozen roster. The
   `principal_change` event records prior/new identity, attestation reference, resolver outcome, and reason,
   so disclosure is derived without a second event type. P4 replaces initial attestations with formal
   scorecard evidence without changing this contract.
7. In `milestone-led`, every re-instantiation emits an atomic `principal_change`: the prior instance loses
   authority in the same event that activates the new one. Same qualified identity is `disclose`; any
   qualification change follows step 6. There is never a zero-owner or two-owner interval.
8. Derive disclosure mechanically: user-minted intent IDs are explicit; every other intent link is
   derived; only `decision` events enter disclosure, never routine tool/audit events.
9. Checkpoint after a configurable event interval (default 100 closed events) or every milestone,
   whichever comes first. A checkpoint is a deterministic full state projection plus ledger-head hash;
   replaying raw events must produce byte-identical state. The projection excludes generation metadata and
   the active-owner capability and uses RFC 8785 JCS canonical serialization. Resume reads the latest
   checkpoint plus later individually witnessed raw events; after step 6 qualification succeeds it issues a
   fresh host-memory owner capability. Capabilities are never serialized. Raw events remain archived and
   hash-chained. The host atomically appends every event head and type to a per-run authenticated append-only
   witness outside the model's write path and returns a receipt containing run ID, sequence, event head, and
   previous witnessed head before the event becomes authoritative. Resume and acceptance verify the full
   receipt chain and require the current ledger head to match its receipt; witness outage blocks before
   append, never defers witnessing. The activation trust boundary is the host plus configured witness;
   remote/quorum witnessing is defense-in-depth and host compromise is outside Kernel prevention. A host
   without the base witness capability is `none`.
10. Copy evidence referenced by a closed decision to the durable run store by content hash before cleanup.
11. Store `blocked_since` and project-configurable `max_blocked_duration` (default 24 hours, minimum 1 hour;
    `0` means disabled). Reaching the limit can only mint a Kernel timeout-abort and disclosure; it never
    implies approval or authority. A Kernel timer polls while the run is live and blocked; every status,
    approval delivery, transition, resume, or intake evaluation also checks elapsed duration before any
    other operation and mints the witnessed timeout-abort when the enabled limit has elapsed.

### P2 — Enforced Owner Kernel and unified authority

**Size**: L
**Depends on**: P1
**Acceptance**: low-risk owner-led runs use one authority path; every accepted action reconciles with a
classified event; assessment purpose cannot escalate its own authority; the acceptance predicate is exact.

#### State transition table

| From | Allowed next | Gate |
|---|---|---|
| `intake` | `decide`, `blocked` | versioned intent + frozen acceptance contract + supported host observability |
| `decide` | `delegate`, `blocked`, `accept` | decision event validated; red-line approval resolved |
| `delegate` | `observe`, `blocked` | dispatch contract accepted |
| `observe` | `decide`, `recover`, `accept`, `blocked` | artifact/evidence event recorded |
| `recover` | `delegate`, `decide`, `blocked` | recovery decision recorded; `max_recover_cycles` and `max_delegate_per_decision` have not been exhausted |
| `blocked` | `decide`, `complete` | authenticated approval/availability resolution, authenticated user abort, or disclosed Kernel timeout-abort |
| `accept` | `complete` | atomically entered only after the acceptance predicate is true under a candidate write lock |
| `complete` | none | terminal |

An authenticated user `abort` is a global interrupt from every non-terminal state to `complete` with
`terminal_reason: user_abort`. All authoritative events share one host/witness sequence. If abort is ordered
before the acceptance transaction's linearization point, acceptance cannot mint; if acceptance is ordered
first, the later request is recorded as post-terminal and cannot retroactively change the delivered result.
Resolving one of several `approve-before` events consumes only that event; the next `decide` evaluation
immediately re-enters `blocked` while any other required approval remains open.

1. Derive red-line, reversibility, and contract-leg facts from the intake-frozen governance catalog mapping
   operation/tool class to policy row plus observable tool/dispatch inputs. Free-text owner labels may raise
   but never lower the catalog class; conflict, unknown, or non-enumerable facts are `approve-before`.
   Every `decision` carries a machine-matchable action descriptor: operation/tool class plus an exact
   command hash or bounded target pattern and allowed-use count. A bounded pattern has a complete match set
   enumerable at decision-mint time; open-ended wildcards are ambiguous.
2. Enforce the P0-probed observability tier:
   - `full`: pre-action gating blocks red-line actions without an approved matching decision, and complete
     normalized audit events are reconciled before acceptance;
   - `partial`: the adapter declares the exact complete subset. A run is accepted into owner-led only when
     every possible red-line action is either preventively observable or available exclusively through a
     model-unwritable `owner-kernel` executor that alone may perform the mediated side effect. If P0 cannot
     prove that sole path, the host is `none` for that action class and intake is rejected rather than
     relying on post-hoc detection;
   - `none`: both `owner-led` and `milestone-led` autonomous intake are rejected. The host may run only a
     separately user-operated/manual workflow outside Owner Kernel; it can never advertise unattended
     governance.
   Content-address the probed host capability set at intake. Verify its hash or re-probe at every decision
   mint, checkpoint/resume, immediately before a red-line side effect, and at acceptance. Hook/witness loss,
   expanded tool/PATH capability, or a new unmediated sink emits capability evidence, revokes outstanding
   action claims, and transitions to `blocked`; a tier regression is never repaired by post-hoc audit.
3. Treat `accept` as a transient serializable transaction, never a durable waiting state. The Kernel
   acquires and continuously holds the candidate/delivery write lock and witnessed-ledger sequencing lock
   from head pin through both terminal receipts, pins the latest receipt,
   drains any earlier authenticated control event, computes the delivered/final hash set, evaluates the
   predicate on that exact head, and mints witnessed `acceptance` plus `complete` events before releasing
   the locks. The transaction has a bounded timeout. Timeout or witness outage releases both locks without
   minting any event or retrying inside the transaction, leaves the run in its source state, and routes to
   `blocked`; a false predicate routes mechanically to `recover` for remediable evidence failure or
   `blocked` for missing authority/availability. No state can be stranded in `accept`.
   Define the predicate exactly as:

   ```text
   every declared contract leg satisfied:
     executable leg => trusted Kernel/runner evidence green
       AND evidence artifact-provenance hash equals the final candidate hash set
     non-executable leg => qualified independent challenge required
   AND every qualified independent challenge bound to the final candidate has no blocking finding
   AND each required challenge's reviewed artifact hash equals the final candidate hash
   AND no unresolved approve-before event exists
   AND the evaluated ledger head is the latest witnessed head
   AND no superseding intent, user abort, or suspension is ordered before acceptance
   AND the active principal and qualification match the principal evaluated by acceptance
   AND the probed host-capability hash remains current
   AND final leg classification re-derived from the frozen policy matches the accepted leg projection
   AND acceptance-contract hash is unchanged or its change is approved
   AND tool/audit reconciliation is complete
   AND disclosure is rendered from validated owner events
   ```

4. Classify contract legs mechanically at intake. An approved contract change invalidates the prior leg
   projection and requires every leg to be re-derived and re-satisfied. Re-derive classification against
   the final artifact and frozen catalog at acceptance; a changed or newly non-executable leg is
   `approve-before` and voids stale evidence. Mixed contracts require both green hash-bound executable
   evidence and challenge of every non-executable residue; unclassifiable legs are `approve-before`.
   Require an independent challenge for high-risk or non-executable contracts. Other policy may add one
   only through the same qualified, attested challenger roster; it may never remove those two cases. Extend existing dispatch/review schemas with `counsel`, `repair`,
   and `challenge`. Counsel and repair are advisory. A challenge may veto only when independent,
   role-qualified, bound to the exact reviewed artifact hash, and current; no policy can waive a blocking
   finding from a qualified current challenge. The validated review result is hashed and ingested only as a
   Kernel-witnessed `evidence` event whose emitter provenance names the qualified independent challenger;
   owner, worker, self, and same-family result appends are rejected. Any artifact mutation invalidates the
   result. The owner may skip optional counsel, never a required challenge.
5. Keep `verify` outside the review-purpose enum. Authoritative executable evidence is minted only by the
   Kernel running the frozen command or by a trusted runner whose attested result the Kernel witnesses. It
   records command, exit code, stdout/stderr hashes, artifact provenance, runner identity, and timestamp.
   The provenance hash set must equal the final candidate hash set at acceptance; any later mutation
   invalidates green evidence and requires re-verification. Owner- or worker-authored test claims remain
   advisory and cannot satisfy the predicate.
6. If a required challenger is unavailable or unqualified, enter `blocked`, emit an `approve-before`
   escalation with reason, and deliver it through the P0-verified interruption adapter for that host.
   `status` exposes the same event. Only an authenticated approval/abort, qualification recovery, or
   disclosed timeout-abort resolves the block; never silently substitute or auto-approve.
7. Reconciliation mechanically matches observed tool class/targets or exact command hash to the authorized
   decision descriptor. Under one host action lock, the pre-action gate first requires the current external
   witness head to equal the fully ingested Kernel head, then revalidates current intent,
   principal qualification, decision/approval hashes, use balance, suspension state, and host capability,
   then atomically claims one use immediately before the side effect. Missing, conflicting, incomplete,
   exhausted, or post-approval-drifted matches block acceptance; an irreversible action is never treated as
   repaired by later rejection.
   Hooks call the Owner Kernel classifier/matcher through its public API and contain no independent red-line
   classification or policy-resolution logic.
8. Think-tank becomes optional counsel. Dialectic runs only when the owner records a costly unresolved
   decision after counsel; neither produces acceptance authority.
9. Emit `terminal_reason` as `accepted`, `user_abort`, or `timeout_abort` on the terminal event so status,
   telemetry, and CI never infer successful completion from the `complete` state alone.
10. The accepted hash set is the delivered artifact set, not a pre-merge worktree approximation. Any write
    attempted after lock release starts a new decision/evidence cycle; it cannot mutate a completed run.
11. Push, publish, deploy, send, charge, and other external effects are separate red-line decisions and are
    never implied by artifact acceptance. Every such action records witnessed authoritative outcome
    evidence before it is considered complete. When delivery is an explicit contract leg, acceptance waits
    for that verified outcome; otherwise the run still cannot complete while an external-delivery event is
    pending verification.
12. Project policy defines `max_recover_cycles` and `max_delegate_per_decision`. Exhaustion transitions to
    `blocked` and opens `approve-before`; only a new authenticated decision may reset a counter.

### P3 — Compatibility translation, activation, and deletion

**Size**: L
**Depends on**: P2
**Acceptance**: Owner Kernel is the sole acceptance path, KR8/KR10 pass, duplicated lifecycle bodies are
deleted, and conservative rollback changes requirements inside the Kernel rather than bypassing it.

1. Change `ceo-agent` startup to load project governance. Ask only when intent cannot yield an objective
   completion test or a bounded final artifact that an independent challenger can assess.
2. Replace `/l3`–`/l6` bodies with one-cycle aliases calling `owner-kernel translate-level`; status shows
   the exact translated topology preference and unchanged project red lines. Every use emits a trusted
   `translation_used` telemetry event from the translation code path, never a public append command or
   model output. It has no acceptance authority but receives the same per-run witness receipt, making the
   zero-use deletion counter mechanically trustworthy.
3. Provide `conservative` policy as rollback: require the legacy-equivalent challenge/panel coverage but
   retain Owner Kernel as the sole decision and acceptance authority. There is no `legacy-flow` bypass.
   A Kernel-code defect rolls back by pinning the prior autopilot plugin version or reverting the activation
   commit; policy fallback is not misrepresented as a code rollback.
4. Activate low-risk dogfood, then high-risk only after zero false acceptance/missed escalation on the
   frozen corpus and a qualified challenger is available.
5. At the end of the release cycle, remove aliases and `level-front-door.md` only when trusted telemetry
   shows zero `translation_used` events for the preceding 14 days, zero unresolved translation deltas, and
   all documented callers have migrated and a deterministic scan confirms no lifecycle/trust prose remains
   in the stubs. Failure to meet this gate blocks project completion rather than extending aliases silently.
6. Measure load-bearing surface and ceremony tokens again. KR8 and KR10 are release gates.

### P4 — Role qualification and optional native runners

**Size**: L, separate release after Owner Kernel activation
**Depends on**: P3
**Acceptance**: owner, worker, counsel, and challenger qualification are independent; no provider label or
general benchmark promotes a model to owner or gate duty.

1. Add an `owner` scorecard role measuring intent retention, decision classification, escalation honesty,
   principal handoff, recovery, and evidence-based acceptance.
2. Keep implementer and challenger qualification separate. A strong generator is not automatically an
   owner or independent challenger.
3. Qualify or renew Kimi K3, Qwen3.8-Max-Preview, GLM-5.2, Grok 4.5, MiniMax-M3, and any later candidate only
   through role-specific corpora; existing unexpired role evidence remains valid. The new Kimi/Qoder native
   subscription transports are a separate implementation change with their own isolation, no-verdict,
   output parsing, quota, and credential tests. Existing Grok and Anthropic-compatible GLM/MiniMax
   transports keep their current gates.
4. Route by qualified role and availability, never by a hardcoded model-to-worktype table.
5. Keep OAuth/subscription credentials in each native CLI's user-owned credential home. Enforce negative
   leak tests with `scripts/secret-scan-diff.js` and shared `hooks/_shared/secret-patterns.js` redaction;
   raw reasoning and response bodies stay outside result metadata and durable project artifacts.

## 5. Test / validation

```bash
node scripts/owner-kernel.js resolve --check
bash hooks/tests/owner-kernel.test.sh
bash hooks/tests/owner-events.test.sh
bash hooks/tests/owner-action-reconciliation.test.sh
bash hooks/tests/owner-disclosure.test.sh
bash hooks/tests/level-governance-translation.test.sh
bash hooks/tests/review-purpose-authority.test.sh
bash hooks/tests/contract-parity.test.sh
bash hooks/tests/orchestration-eval.test.sh
bash hooks/tests/run.sh
scripts/validate.sh
bash scripts/check-canonical-invariants.sh
node scripts/sync-version.js --check
```

Mandatory negative controls:

- irreversible action mislabeled reversible;
- red-line tool action with no matching decision event;
- partial-observability intake can reach a red-line action outside an enforceable mediator-only path;
- `none`-observability host attempts owner-led or milestone-led autonomous intake;
- approval references an old/superseded content hash;
- a second irreversible action reuses an exhausted one-use approval;
- irreversible approval carries `max_uses > 1` or a multi-use approval lacks a permitting policy row;
- owner/dispatcher mints an `intent`, `approval`, or user-abort event;
- worker or shell caller directly appends a `decision` event;
- worker-authored file/tool output is submitted as an owner-turn decision payload;
- a decision mint uses an owner capability after qualification/TTL expiry but before checkpoint;
- an event or capability from one run is appended to another run's witness stream;
- owner/worker mints authoritative executable evidence;
- unverifiable or non-allowlisted runner attestation claims authoritative evidence;
- owner/self/same-family review result is ingested as authoritative challenge evidence;
- acceptance command is replaced after it fails;
- acceptance command is trivially green or does not exercise its declared artifact;
- resolved governance policy drifts after intake;
- host capability set regresses or gains an unmediated sink after intake;
- owner/worker edits Kernel, CLI, owner schema, or gate source;
- non-executable contract has no independent challenge;
- mixed contract skips either its executable or non-executable leg;
- final artifact hash differs from the artifact hash reviewed by the challenger;
- final artifact changes after green executable evidence;
- candidate mutates between acceptance evaluation and terminal-event mint;
- acceptance predicate false strands the run in `accept`;
- worker or owner self-review claims gate authority;
- same-family challenge claims independence;
- failing verification plus `SHIP-AS-IS` model verdict;
- missing challenger silently falls back;
- a current qualified optional challenge has a blocking finding that acceptance ignores;
- owner principal changes without event/provenance;
- principal change references a forged or non-allowlisted qualification attestation;
- roster exhaustion activates a principal outside the intake-frozen roster;
- owner qualification expires across checkpoint/resume;
- amended intent leaves prior decisions or approvals active;
- amended intent leaves an in-flight dispatch executable;
- ledger event is truncated, rewritten, or appended with the wrong previous hash;
- ledger is rewritten from genesis with recomputed hashes that disagree with the external witness;
- post-checkpoint tail is rewritten with recomputed hashes or lacks a per-event witness receipt;
- witness outage allows an authoritative event append;
- witness outage during acceptance retries in-transaction or leaves either lock held;
- checkpoint serialization includes generation metadata/capabilities or is not byte-deterministic;
- resume reuses an owner capability minted before qualification re-check;
- user abort or superseding intent is witnessed between acceptance evaluation and terminal-event mint;
- principal changes between acceptance evaluation and terminal-event mint;
- intent/approval/capability changes after pre-action check but before side effect;
- pre-action Kernel head lags the current external witness head;
- live blocked run exceeds its timeout without a witnessed abort;
- external delivery fails or changes target after artifact verification;
- final artifact causes a contract-leg reclassification that stale evidence still satisfies;
- disclosure omits a derived decision or includes routine actions;
- evidence pointer dangles after worktree cleanup;
- `/lN` translation weakens a red line;
- `translation_used` can be omitted or minted without a witness receipt;
- compatibility code imports acceptance/transitions or mints outside the fixed events API;
- conservative profile routes around Owner Kernel;
- recovery/delegation exceeds configured counters without blocking;
- an unqualified candidate enters a gating seat;
- Kimi/Qoder credential or raw response body appears in result metadata, logs, or a staged diff.

The Board approves activation after reviewing baseline versus Kernel outcomes, every disagreement and
adjudication, false-acceptance/missed-escalation counts, dispatch and ceremony-token deltas, principal
handoffs, and the deletion manifest.

## 6. Risks + inversion

- **Owner Kernel becomes another flow layer.** Stop at P0 if KR9 fails; P3 requires the deletion and
  load-bearing-surface gates.
- **The owner writes honest-looking false labels.** Observable red-line facts are mechanically derived or
  cross-checked; conflict/unknown escalates.
- **The owner rewrites the rules.** Resolved governance and acceptance hashes are frozen; Kernel, schema,
  CLI, and gate sources are protected by pre-action enforcement and verified again before acceptance.
- **The ledger is a diary beside unobserved actions.** Verified observability tiers fail closed. Partial
  hosts mediate unobservable red-line actions; `none` hosts cannot enter either autonomous mode.
- **The owner fabricates authority or proof.** Event-type minting is emitter-restricted; user authority
  comes from authenticated input adapters and executable truth from the Kernel/trusted runners.
- **Approve-then-drift.** Approval binds decision content hash; supersession invalidates it.
- **Approve-once, execute-many.** Red-line approvals default to one use and the gate consumes the use under
  the same lock that revalidates and starts the side effect.
- **Challenge-then-drift.** Challenge binds the reviewed artifact hash; any mutation invalidates the pass.
- **The acceptance test is laundered.** Intake freezes the contract; changes are `approve-before` and
  preserve original evidence.
- **Tests pass on an older artifact.** Executable evidence provenance must equal the final candidate hash;
  later mutation invalidates the evidence.
- **Owner identity or capability silently changes.** Principal changes are events; capability TTL is bound
  to qualification expiry and revalidated at decision mint and acceptance.
- **Host capability silently degrades.** The intake capability hash is rechecked at every authority boundary;
  regression revokes claims and blocks before action.
- **The owner rewrites ledger history.** Hash chaining detects local drift and an external witnessed head
  detects full-chain recomputation before resume or acceptance.
- **Model review is mistaken for proof.** Executable failure always vetoes; model gates are veto-only.
- **Unavailable reviewers kill liveness.** The run blocks visibly and escalates to the user; it never
  downgrades trust silently. A liveness timeout may abort but never approve.
- **Acceptance is mistaken for publication.** External delivery is a separately approved and evidenced
  red-line action; acceptance cannot grant push/publish/deploy authority.
- **Aliases live forever.** One exact release cycle and explicit P3 deletion criteria are completion gates.
- **A frontier release triggers promotion by reputation.** Every role has separate, expiring evidence.

## 7. Out of scope

- Making weak models equal to frontier models through prompting or ceremony.
- Selecting one permanent vendor or model as owner.
- Letting a model verdict override deterministic failure.
- Removing worktree isolation, artifact provenance, secret handling, process cleanup, or immutable-base
  verification.
- Shipping Kimi/Qoder production runners during architecture activation; their R1–R6 use is manual and
  advisory, and native integration is P4 with a separate transport gate.
- Requiring users to approve ordinary implementation results after project governance and red lines are
  established.

## 8. Open questions

No unresolved product-direction question remains. Implementation authority is a separate Board decision
after approval of this revised design and successful P0 measurement spike.

## Review log

### R0 — author synthesis

- Selected Owner Kernel; adaptive exceptions inside the old flow remain a migration tactic, not the end
  architecture. Frontier council is reserved for costly unresolved decisions, not default topology.

### R1 — independent blind design review (2026-07-20)

| Reviewer | Transport | Settings | Verdict |
|---|---|---|---|
| Kimi K3 | official Kimi Code OAuth CLI | `k3`, 1M context, `max` effort | `FIX-THEN-SHIP` |
| Qwen3.8-Max-Preview | official Qoder CN browser-login CLI | 400K context, 16K max output, max effort | `FIX-THEN-SHIP` |

The first Qoder dispatch exited zero but emitted attempted tool calls instead of a verdict because tools
were disabled. It was classified `no_verdict`, then blindly re-dispatched with a reviewer-only system
prompt. Only the second result is adjudicated.

Accepted Kimi findings: deterministic cross-check of owner labels; action-to-ledger enforcement; freeze
acceptance contract; remove `worker-led`; hash-bind approvals; persist versioned intent and principal
identity; define veto asymmetry and exact acceptance; visible unavailable-challenger escalation;
deterministic disclosure; durable evidence and expanded negative controls.

Accepted Qwen findings: deletion manifest and net-complexity gate; remove alternate legacy acceptance;
type executable evidence outside review results; quantify KR8; executable translation SSOT; add the
three-task pre-code spike; define transitions, checkpointing, and ceremony-token measurement.

Adjusted Qwen finding: `dispatch-unit-contract.schema.json` remains the generic dispatch SSOT rather than
being folded into `dispatch-review.sh`; the correction is to extend that existing schema and keep review
transport subordinate to it. `resolve-review-loop.sh` also remains the capability/roster resolver and is
narrowed rather than merged with governance, avoiding a new policy/capability coupling.

### R2 — independent blind re-review (2026-07-20)

| Reviewer | Transport | Settings | Verdict |
|---|---|---|---|
| Kimi K3 | official Kimi Code OAuth CLI | `k3`, 1M context, `max` effort | `FIX-THEN-SHIP` |
| Qwen3.8-Max-Preview | official Qoder CN browser-login CLI | 400K context, 16K max output, max effort | `FIX-THEN-SHIP` |

Accepted shared findings: declare and enforce host observability tiers; mediate irreversible actions where
pre-tool prevention is unavailable; bind challenge results to final artifact hashes; define mandatory
review dispatches; split the Owner Kernel god-object while retaining one public authority path; add exact
checkpoint, liveness, alias telemetry, and ceremony-token rules.

Accepted Kimi findings: define an emitter/minting authority matrix for user intent, approval, abort, and
executable evidence; require an independent challenge for non-executable contracts; define mechanical
decision-to-action matching; cascade intent supersession; hash-chain the ledger; name authenticated
escalation resolution and code-level rollback.

Accepted Qwen findings: P0 must publish an absolute post-P3 surface target; principal qualification uses an
opaque expiring attestation before P4 scorecards; alias removal requires trusted zero-use telemetry for a
fixed window; credential hygiene names its enforcement and negative test.

### R3 — independent blind convergence review (2026-07-20)

| Reviewer | Transport | Settings | Verdict |
|---|---|---|---|
| Kimi K3 | official Kimi Code OAuth CLI | `k3`, 1M context, `max` effort | `FIX-THEN-SHIP` |
| Qwen3.8-Max-Preview | official Qoder CN browser-login CLI | 400K context, 16K max output, max effort | `FIX-THEN-SHIP` |

Accepted shared findings: bind executable evidence provenance to the final candidate hash; treat mixed
contracts as a conjunction of executable and non-executable legs; reject `partial`-host intake unless every
reachable red-line capability is preventively observable or mediator-only.

Accepted Kimi findings: hash-pin resolved governance as well as acceptance; protect Kernel/policy/gate
surfaces from owner edits; externally witness checkpoint heads so a fully recomputed ledger cannot pass
resume; verify runner attestations against an allowlist and non-model-readable trust anchor.

Accepted Qwen findings: prevent shell/worker decision minting; invalidate in-flight dispatches on intent
supersession; emit a discriminated terminal reason. Its suggestion to keep terminal causality only in raw
events was tightened into a required field because downstream status must not conflate abort with success.

### R4 — independent blind convergence review (2026-07-20)

| Reviewer | Transport | Settings | Verdict |
|---|---|---|---|
| Kimi K3 | official Kimi Code OAuth CLI | `k3`, 1M context, `max` effort | `FIX-THEN-SHIP` |
| Qwen3.8-Max-Preview | official Qoder CN browser-login CLI | 400K context, 16K max output, max effort | `FIX-THEN-SHIP` |

Accepted Qwen finding: `accept` cannot be a durable state with no false-predicate exit. It is now an atomic
write-locked evaluation that enters only after the predicate passes; failure remains in the source state
and routes mechanically to recovery or blocking. The same atomic step binds the delivered hash set.

Accepted Kimi findings: `none` hosts support no autonomous governance mode; every event head receives an
external witness receipt rather than leaving a rewritable post-checkpoint tail; the frozen policy pins the
qualified-owner roster and attestation verification material. Existing qualified challenge findings cannot
be ignored merely because policy did not require their dispatch.

Accepted shared hardening: distinguish owner decision minting with a host-memory session capability; make
milestone principal replacement atomic; require hooks to consume the Kernel classifier instead of growing a
second red-line implementation; block on witness outage; re-derive contract legs after an approved change.

### R5 — independent blind convergence review (2026-07-20)

| Reviewer | Transport | Settings | Verdict |
|---|---|---|---|
| Kimi K3 | official Kimi Code OAuth CLI | `k3`, 1M context, `high` effort | `FIX-THEN-SHIP` |
| Qwen3.8-Max-Preview | official Qoder CN browser-login CLI | 400K context, 16K max output, max effort | `SHIP-AS-IS` |

Qwen found no remaining Critical/Major issue. Its minor implementation clarifications were incorporated:
canonical checkpoint serialization, explicit multi-approval blocking, bounded acceptance-lock timeout, and
an enumerable definition for bounded target patterns.

Accepted Kimi finding: user abort and intent supersession must share the acceptance transaction's event
ordering, not only its artifact lock. The final design uses one witnessed sequence and explicit
linearization point, permits authenticated abort from every non-terminal state, and prevents acceptance
when an earlier control event exists.

### R6 — targeted blind convergence review (2026-07-20)

| Reviewer | Transport | Settings | Verdict |
|---|---|---|---|
| Kimi K3 | official Kimi Code OAuth CLI | `k3`, 1M context, `high` effort | `SHIP-AS-IS` |

Kimi found no remaining Critical/Major issue. Its remaining minor completions were incorporated: add
`suspension` and non-authoritative `translation_used` to the event union/minting matrix, check timeout on
resume, and stop at P0 when no target host can provide all required trust roots. Qwen was not re-dispatched
because R6 touched only those non-authoritative schema and P0 liveness clarifications after its R5 pass.

### R7 — expanded three-family blind panel (2026-07-20)

| Reviewer | Transport | Settings | Canonical result |
|---|---|---|---|
| GLM-5.2 | `anthropic-compatible`, endpoint `glm` | high | `SHIP-AS-IS` |
| MiniMax-M3 | `anthropic-compatible`, endpoint `minimax` | high | `FIX-THEN-SHIP` |
| Grok 4.5 | official Grok CLI | high | `no_verdict` (2 attempts) |

The review log was removed from the artifact. GLM focused owner/user authority, MiniMax focused
simplification/testability, and Grok focused adversarial enforcement/operations. Grok produced substantive
prose twice but prepended narration before the required nonce wrapper both times; the canonical parser
correctly rejected both results. Its raw findings were used only for discovery, never counted as a vote.

Accepted MiniMax findings: remove generic shell `append`; make acceptance-command bytes part of the frozen
contract mapping; revalidate host capability during the run; witness compatibility telemetry; bind active
principal at acceptance; freeze trusted-runner/challenger verification material. `principal_change` now
contains resolution provenance, so no second disclosure event type was added.

Accepted Grok advisory findings: approvals have bounded atomic consumption; owner capability TTL follows
qualification expiry and is checked at every decision/acceptance; pre-action revalidation and use claim are
one locked operation; live blocked runs have an active timer; external delivery remains a separately
authorized/evidenced red-line action; recovery counters are explicit.

Rejected/adjusted findings: per-event receipts already form a previous-head chain, so a second Merkle system
is not required; the P0 forged-capability probe is a valid implementation boundary, but its pass criteria
were made concrete; timeout-on-resume already existed and was extended rather than duplicated.

### R8 — MiniMax convergence re-check (2026-07-20)

| Reviewer | Transport | Settings | Verdict |
|---|---|---|---|
| MiniMax-M3 | `anthropic-compatible`, endpoint `minimax` | high | `FIX-THEN-SHIP` |

The remaining findings were bounded state-machine clarifications, not a new architecture objection. Accepted:
roster exhaustion means zero-owner `blocked`, never off-roster promotion; irreversible approval is always
single-use; witness outage aborts the acceptance transaction without an in-transaction retry; policy-added
challengers use the qualified roster; pre-action compares the external witness head; all external delivery
records witnessed evidence; final leg classification is re-derived at acceptance; compatibility cannot
import acceptance/transitions. The duplicated every-decision qualification finding was already satisfied
by P1 step 6 and was not added again. Further model iteration is deferred to the P0 executable fixtures so
the plan does not grow ceremony in response to progressively smaller prose ambiguities.
