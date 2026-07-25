# Owner Kernel governance

> **Plan**: [`docs/plans/2026-07-20-owner-kernel-evolution.md`](../../plans/2026-07-20-owner-kernel-evolution.md)
> **Target branch**: `feat/owner-kernel-governance`
> **Target version**: v2.32.59
> **Workflow**: CEO `/l6`, scope=Hold, involvement=just-results

## Project Goal

> **Final goal**: Replace flow-selected autonomy with a persistent qualified Owner Kernel so an
> unattended project can keep deciding, delegating, recovering, and accepting under one project-level
> governance default, while retaining fail-closed executable evidence and independent challenge.
>
> **Success criteria**:
> 1. `owner-led` and `milestone-led` both resolve from project config; a one-run override changes only the
>    current run. Verified by `node scripts/owner-kernel.js resolve --config .claude/owner-kernel-governance.json --check`
>    and translation tests.
> 2. P0's three-task spike records zero false acceptance, zero missed red-line escalation, at least 30%
>    fewer mandatory model-review dispatches, and transcript-free cross-session reconstruction followed
>    by an exact external approval. Failing any
>    threshold stops P1 before core product code is added.
> 3. Every accepted run satisfies the frozen contract predicate: executable failure vetoes, green
>    evidence is bound to the final artifact set, required challenges are independent and hash-bound,
>    and approvals are exact/bounded/atomically consumed. Verified by the Owner Kernel negative-control
>    harnesses listed in the plan.
> 4. Exactly one qualified owner principal is active or the run is blocked with zero owners. Verified by
>    principal swap, expiry, roster-exhaustion, resume, and concurrent acceptance fixtures.
> 5. Final disclosure is reconstructed from witnessed events and lists every non-explicit owner decision.
>    Verified by replaying the minimum JSONL ledger in a separate process/session.
> 6. `/l3` through `/l6` translate through one executable table for one compatibility release and cannot
>    weaken project red lines. Verified by `hooks/tests/level-governance-translation.test.sh`.
> 7. `scripts/validate.sh`, the complete hook suite, canonical invariant checks, Codex payload sync, and
>    version-manifest checks all pass before merge.

## Scope Boundary

### Included

- Owner Kernel policy, event, authority, transition, acceptance, reconciliation, disclosure, and
  compatibility modules, plus the thin `scripts/owner-kernel.js` CLI.
- One owner-event schema; extensions to the existing dispatch-unit and review-result schemas.
- Project governance template and Autopilot self-hosted dogfood config.
- Preventive hook mediation, witnessed audit/reconciliation, capability probes, and negative controls.
- Purpose-separated `counsel`, `repair`, and `challenge`; deterministic `verify` remains outside review.
- CEO, `/l3`-`/l6`, think-tank, quality-pipeline, architecture, configuration, migration, and help surfaces.
- Frozen orchestration corpus, three-task P0 spike, tests, generated Codex payload sync, CHANGELOG, patch
  version bump, and self-hosted dogfood.
- Both user-selectable governance modes and per-run override behavior. The user never chooses engine
  topology as the governance vocabulary.
- P0-only `supervised-partial` measurement fixture: rootless Linux sandbox worker, out-of-sandbox
  supervisor/broker, mediator-only protected effect, and external receipt root. It is eligible to
  fund P1 only after the same classifier and negative controls produce positive R1-R4 evidence.

### Explicitly Out Of Scope

- A weak model becoming owner merely because process surrounds it; weak models remain bounded workers.
- Remote/quorum witness infrastructure or defense against compromise of the trusted host itself.
- Shipping the P0 supervisor fixture as a production daemon, adding privileged/system-wide
  installation, or claiming cross-platform support before a separate P1 implementation phase.
- New Kimi/Qoder gating runners before role-specific scorecard qualification.
- Automatic removal of `/l3`-`/l6` aliases before one shipped compatibility cycle and the plan's
  telemetry gate. This project ships the single translation path and deletion readiness; elapsed release
  time is not fabricated in the current run.
- Changes in downstream repositories. Public migration notes and consumer impact are included here;
  downstream adoption is a separately authorized project.
- External push, publish, deploy, send, or charge. Those remain separate red-line decisions.

## Scope Completeness Audit

| Dimension | Triggered | Coverage |
|---|---:|---|
| Source code + tests | Yes | P0 fixtures/probes; P1-P2 engine, CLI, schema, hook, and regression harnesses |
| User-facing docs/help | Yes | P3 architecture/configuration/skill/help migration |
| API/interface reference | Yes | P1-P2 schema and CLI documentation; migration notes in P3 |
| Config templates/examples | Yes | P1 governance template plus self-hosted `.claude` config |
| CHANGELOG | Yes | P3 release entry |
| Version bump | Yes | P3 patch bump to v2.32.59 after `origin/develop` consumed v2.32.58 |
| Version sync grep/check | Yes | P3 all-tracked-file old-version scan plus `sync-version.js --check` |
| Migration guide/notes | Yes | P3 `/lN` alias mapping and one-cycle retirement conditions |
| Dependent repos/consumers | Yes | P3 documents impact; actual downstream adoption explicitly out of scope |
| Credit/attribution | No | Design is internal synthesis; model review provenance remains in the plan review log |
| Dogfood target | Yes | P0 spike and P3 self-hosted shadow/dogfood run |
| Linux sandbox/runtime prerequisite | Yes | P0 supervised profile probes local `bwrap`, namespaces, broker isolation, and fail-closed unavailability |
| Generated mirrors | Yes | P3 runs `scripts/sync-codex-plugin-skills.sh` and verifies parity |
| Security/trust boundary | Yes | P0 host probes; P1-P2 forgery, capability, witness, and authority negative controls |

## User Requirements Ledger

| Verbatim requirement | Mapped work |
|---|---|
| “autpilot 本質是無人職守專案可以自動一直推進並驗收” | Objective; P0 spike; P1 durable owner; P2 acceptance/recovery |
| “對於較弱模型還是需要一個思考面比較強的來指引” | P1 qualified single owner; P4 role qualification; workers cannot inherit owner authority |
| “擔任 owner , 不過這件事情而該做成選項讓使用者選擇?” | P1 `owner-led` / `milestone-led` governance modes |
| “專案設定一次預設、每次任務只在需要時覆寫” | P1 project default plus non-mutating per-run override |
| “你可以題這個修正然後走 heto engine 跑看看?” | Board-approved heterogeneous review log; `/l6` execution pipeline |
| “glm/grok/minimax 都可以派阿” | Five-family design review; roster stays capability/qualification driven rather than vendor-locked |
| “loop 沒問題的話就 commit 然後續走 CEO /l6 dev-flow 完成所有選項” | Plan commit `d98977c`; P0-P4 execution; mandatory L-5 finish-flow |
| “go” after the P0 breakthrough decision | Compose Opus into canonical evidence; add and attack a fifth `supervised-partial` profile; open the three-task spike only on positive qualification |

## Skill Routing

| Surface | Required methodology |
|---|---|
| L-size lifecycle and project tracking | `autopilot:dev-flow` |
| Delegated execution and verification authoring | `autopilot:l6`, `autopilot:ceo-agent`, `autopilot:team` |
| Test/negative-control design | `autopilot:test-strategy` |
| Per-phase and pre-merge gates | `autopilot:quality-pipeline` |
| Cross-doc behavioral drift | `autopilot:doc-sync` |
| Final merge/archive/session closure | `autopilot:finish-flow`, `autopilot:project-lifecycle` |

## Phases

| Phase | Work | Gate |
|---|---|---|
| P0 | Semantic inventory, absolute surface baseline, host trust probes, frozen fixtures, and three-task no-core-code spike | Pass only if at least one target host is `full`/`partial` and KR9 passes; stop only on completed disproof; otherwise `INCOMPLETE` |
| P1 | Governance resolution, authenticated/witnessed event ledger, owner principal, approvals, checkpoints, resume, and disclosure | Policy/contract hashes stay frozen; replay is byte-identical; negative controls fail closed |
| P2 | Unified transitions, authority, action mediation, reconciliation, exact acceptance transaction, assessment purposes | All transition/acceptance/concurrency/adversarial harnesses pass |
| P3 | Compatibility translation, supervised host activation, skill simplification, docs/config migration, generated mirrors, dogfood, release metadata | One executable translation table; legacy paths are removed only after Kernel-owned live authority is proven |
| P4 | Owner/challenger/worker role qualification and optional native runner onboarding | Zero critical false-pass qualification; unqualified engines stay non-gating |
| L-5 | Final goal review, quality pipeline, merge, doc-sync, archive, session end, branch cleanup | Seven finish-flow gates produce concrete evidence |

## Progress

| Phase | Status | Evidence / Commit |
|---|---|---|
| Design | Complete | Board-approved five-family plan: `d98977c` |
| L-1.5 scope audit | Complete | Dimension and verbatim-requirement ledgers above |
| L-1.6 skill routing | Complete | dev-flow, l6, ceo-agent, test-strategy, harness-maintenance, quality-pipeline invoked in run `owner-kernel-p0-1784543437001` |
| P0 | **PASS FOR P1 FUNDING** | Canonical five-target classifier: `supervised-partial` is `partial`; Claude Code, Codex, OpenCode, and agy are `none`. Three actual bounded tasks passed independent family review, reduced mandatory reviews 6→3, and reconstructed from durable evidence only after exact external approval. [`p0/P0-FINDINGS.md`](p0/P0-FINDINGS.md); classifier [`p0/host-classification.json`](p0/host-classification.json); [spike evidence](p0/spike/evidence-2026-07-23-hardened-r2/) |
| P1 | **Implemented — P2 pending** | Durable policy/event/principal/approval/checkpoint/replay/disclosure core: [`p1/README.md`](p1/README.md). Test-only witnesses cannot activate production mode; P2 must add mediated action and acceptance transaction |
| P2 | **P2a + P2b protocol core implemented; P3 integration pending** | Enforced catalog, two-stage preclaim permits/postclaim authorizations, independently bound verifier/executor/receipt/witness roles, broker/direct execution, typed v2 verification/challenge/audit evidence, coordinator-bound atomic acceptance, pending-claim `unknown` recovery without effect replay, and bounded delegation/recovery transitions are in [`p2/README.md`](p2/README.md). This validates trusted adapter messages, not OS/IPC isolation or a production supervised host |
| P3 | **P3.7a-c authority contracts implemented; installed activation remains gated** | P3.7 now compiles one P3.5d/P3.6-bound semantic route, one fixed reversible broker action, and one fixed `AutopilotEngine` implementation sink with schema-v2 atomic acceptance. The production-code corpus executes 8/8 attacks and 15/15 frozen categories through 23 scenario-specific behavior oracles, plus 46 separate report-integrity mutations. The callbacks in focused tests are deterministic host contracts, not a claim that the P3.6 installed cohort now serves P3.7 operations; privileged installed activation, dogfood, KR10 disposition, and later alias-retirement telemetry remain open. [`p3/README.md`](p3/README.md) records the boundary. |
| P4 | Blocked | Depends on P3 |
| L-5 | Not reached | Begins only after P1-P4 complete |

### P0 outcome

**PASS FOR P1 FUNDING — 1 of 5 targets qualifies `partial`. P1 is authorized.**

The canonical evidence manifest hash-pins the completed Opus Claude evidence and a fifth target,
`supervised-partial`. The four conventional harnesses resolve `none`; the new target is `partial`
only for a rootless Linux bubblewrap worker, an out-of-sandbox broker holding authority, exact
mediated red-line effects, and a receipt root absent from the worker namespace. It is P0 evidence,
not production daemon or cross-platform support.

| P0 measurement | Value |
|---|---|
| Step 4 — named attacks vs fixtures | **8 of 8 executed, all contracts held**; all 8 oracles mutation-proven LIVE (0 vacuous) |
| Step 4 — host capability | **5 targets classified**; `supervised-partial` has positive R1-R4 evidence and fault controls; Claude Code/Codex/OpenCode/agy resolve `none` |
| Step 4 — model-pinned variants | `claude-opus/high` is composed into the canonical Claude Code row and resolves `none`; `gpt-5.6-sol/high` confirms Codex `none`; `grok-4.5/high` remains an extra unverified host. Artifacts: [`p0/variants/`](p0/variants/) |
| Hosts **qualified** `full`/`partial` | **1 of 5** — `supervised-partial` is `partial` |
| Hosts `none` (completed disproof) | **4 of 5** — Claude Code, Codex, OpenCode, agy |
| Step 7 kill condition | **Not selected** — the pass path is met by the named P0 target |
| Step 5 — baseline categories | **15 of 15 frozen**; no claim that all are production-verified |
| Step 6 — three-task spike | **Passed** — Grok/MiniMax/GLM authored bounded artifacts; independent cross-family challenges accepted all three; 6→3 mandatory reviews; transcript-free reconstruction plus exact external approval |
| Legacy absolute load-bearing surface baseline | **42** (44 with `/l5`-armed opt-in hooks) |
| Projected post-P3 absolute target | **51** — KR10 fails, projecting a rise of 9 |
| Mandatory model-review dispatch baseline (KR8/KR9 denominator) | **6** (distinct from 28 mandatory QC steps overall) |

**P0 boundary (fail-closed)**: the conventional same-UID harnesses are disqualified, not promoted
because a stronger model appears. The supervised profile funds the next phase precisely because the
authority, mediator, and receipts leave the worker namespace. P1 must preserve that separation in
production before it can activate either autonomous governance mode.

## Verification Contract

The authoritative per-phase commands are frozen in strict dispatch-unit contracts before engine spend.
The final mechanical gate includes at least:

```bash
node scripts/owner-kernel.js resolve --config .claude/owner-kernel-governance.json --check
bash hooks/tests/owner-kernel.test.sh
bash hooks/tests/owner-kernel-cli.test.sh
bash hooks/tests/owner-kernel-adversarial.test.sh
bash hooks/tests/owner-action-reconciliation.test.sh
bash hooks/tests/owner-action-hardening.test.sh
bash hooks/tests/level-governance-translation.test.sh
bash hooks/tests/engine-lifecycle-observation.test.sh
bash hooks/tests/external-lifecycle-witness.test.sh
bash hooks/tests/supervised-engine-bridge-contract.test.sh
bash hooks/tests/supervised-host-preflight.test.sh
bash hooks/tests/supervised-host-launcher.test.sh
bash hooks/tests/run.sh
scripts/validate.sh
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
bash scripts/check-canonical-invariants.sh
bash scripts/sync-codex-plugin-skills.sh --check
```

Before a release or project status may cite P3.4a/P3.4b mechanism evidence, the named
self-hosted Linux runner must also execute the privileged gate. It requires passwordless
`sudo -n`; it is deliberately not folded into ordinary CI:

```bash
bash hooks/tests/supervised-host-live-preflight.sh
bash hooks/tests/supervised-host-live-launcher.sh
```

## Decision Log

| Date | Decision | Reason |
|---|---|---|
| 2026-07-20 | Governance is project-default with per-run override | User-selected product semantics; avoids choosing wiring on every task |
| 2026-07-20 | Strong qualified model owns; weaker models are bounded workers | Engineering process can expose failures but cannot manufacture judgment |
| 2026-07-20 | P0 remains a funding/kill gate | The host trust roots and 30% review reduction must be measured before architecture is funded |
| 2026-07-20 | Ship aliases for one compatibility release; do not fake elapsed telemetry | Preserves the approved migration contract without inventing future evidence |
| 2026-07-23 | **P0 passes only for the supervised-partial measurement target** | Hash-pinned live broker/sandbox evidence yields one narrow `partial` target; three actual cross-family-reviewed tasks meet KR9. This authorizes P1, not a production or cross-platform claim |
| 2026-07-23 | P0 spike approval and review accounting hardened after independent review | Resume now requires an external key-bound approval over task/descriptor/ledger head; model-family and six-review denominator derive from frozen trusted inputs |
| 2026-07-23 | P3.3 freezes the Engine-to-Kernel bridge before live activation | The P3.1/P3.2 same-UID observer cannot establish production authority. A deterministic, hash-only contract prevents an accidental live wiring while P3.4 builds the required cross-UID host boundary |
| 2026-07-23 | P3.3 verification authoring falls back from `/l6` to depth-0 | The strict verifier-author contract has no qualified tuple for its configured engine. The fallback preserves the qualification gate rather than treating an unqualified model as an acceptance authority |
| 2026-07-23 | P3.4a records a host-specific cross-UID mechanism probe, not a host boundary | A manual privileged fixture uses a root-owned helper snapshot + systemd `nobody:nogroup` worker + exact `SO_PEERCRED`/cgroup check to reject the broker UID and a wrong-cgroup worker while preserving root-only state and collecting transient units. P3.4b must add the root-owned launcher and dedicated worker; P3.3 intake verification, witness durability, and Engine action mediation remain deliberately absent |
| 2026-07-23 | P3.4b installs a bounded root-owned launcher, not autonomous authority | A root operator snapshots fixed launcher/helper/wrapper bytes and a private `autopilot-worker` account; each run freezes its unit/endpoint/nonce, binds the gateway to systemd `MainPID` plus cgroup-v2, and removes the unit/runtime afterward. P3.3 intake verification, witness durability, Engine action mediation, and acceptance remain absent |
| 2026-07-23 | P3.5a/P3.5b add authenticated intake and a fail-closed shadow admission record | A root-installed cross-UID host verifies the signed P3.3 intake through a pinned verifier; the verifier may record only a hash/ID shadow capsule. Interrupted state becomes `recovery_required`, never Engine completion. Independent witness, descriptor-pinned workspace, effects, and acceptance remain absent |
| 2026-07-23 | P3.5c adds root-held workspace provenance and a separate-UID shadow witness | The v1 signed workspace hash/base is exact-matched to a root-held descriptor ticket without changing portable owner intent. A separate UID journal accepts only the exact gateway identity and root readback; it remains hash-only, zero-effect, non-P2 diagnostic evidence. P3.3/envelope v2 is required before any effect-capable descriptor use or multi-map owner choice |
| 2026-07-23 | P3.5d adds a v2 descriptor-bound, path-free shadow intake lane | Root configuration registration remains the only raw-path surface. V2 separately versions bridge, signed envelope/replay, and host request; it exact-binds a root-issued registration/root-hash/base/descriptor/ticket commitment and exposes only no-effect shadow evidence. V1 remains unchanged and cannot be implicitly upgraded; Engine, P2, broker, acceptance, and production witness authority remain absent |
| 2026-07-20 | **P0 steps 4+5 EXECUTED under depth-0 Owner decision** | Steps 5-6 permit frozen fixtures, so all 8 named attacks were run against a disposable no-core-code fixture: 8/8 contracts held, 8/8 oracles mutation-proven LIVE. 15/15 baseline categories frozen |
| 2026-07-20 | Per-harness probe replaces the shell-label probe | `run-harness-probes.sh` drives each real CLI and retains fresh nonce echoes as `self_reported`; `probe-host-trust-roots.sh` marked SUPERSEDED (it measured the shell and asserted a host name) |
| 2026-07-20 | R3 scoring narrowed after root QC | Completed R3 requires execution-proven default-mode evidence or captured self-disable evidence; nonce-only self-reports are unscored |
| 2026-07-21 | **P0 = INCOMPLETE, 0/4 hosts qualify; NOT a STOP** | OpenCode, Codex, and agy resolve `none`; the main Claude artifact remains `unverified`, but the `claude-opus-high` variant resolves Claude Code to `none`. A universal negative still needs the canonical main classifier to consume that combined evidence explicitly rather than silently substituting a variant row |
| 2026-07-20 | Nonce-only harness payloads downgraded to self-report | The nonce is disclosed in the model instruction, so it proves freshness but not execution of `host-capability-probe.js`; no R2/R3 host disproof is scored from it |
| 2026-07-20 | Fixture results excluded from host classification by construction | `classify-hosts.js` takes only execution-proven harness evidence. A sound contract qualifies no host |
| 2026-07-20 | Every attack must be re-run against production at P1 exit | Depth-0 Owner decision, recorded in the fixtures and findings. Fixture pass is a design gate, never a host qualification |
| 2026-07-24 | Target moved to v2.32.58 | `origin/develop` consumed v2.32.57 before Owner Kernel activation; release metadata must use the next free patch consistently |
| 2026-07-25 | Target moved to v2.32.59 | `origin/develop` consumed v2.32.58 before Owner Kernel integration; the merge keeps both release records and advances this milestone to the next free patch |
| 2026-07-25 | P3.7a-c production-code authority contracts completed | Semantic receipts bind the authenticated handoff and durable cohort; the fixed probe and Engine implementation actions use P2 mediation; the acceptance coordinator writes one externally verified atomic terminal batch. Project-default and per-run override policy hashes cannot diverge. Installed cross-UID P3.7 host wiring is still reported separately rather than inferred from deterministic callbacks. |
| 2026-07-20 | ~~P0 = STOP; kill condition met~~ **WITHDRAWN** | Not supported. Step 4 was never performed, so the universal-negative kill condition could not have been established. Superseded by the row below |
| 2026-07-20 | ~~P0 INCOMPLETE; step 4 not performed (2/8, 1/4)~~ **SUPERSEDED** | Superseded by the Owner-decision stage: 8/8 fixture attacks executed and per-harness probing re-driven. P1 blocked because the pass bar is **unproven**, not failed. Current counts live in [`p0/P0-FINDINGS.md`](p0/P0-FINDINGS.md) |
| 2026-07-20 | ~~Plan P0 step 4 is unexecutable as written~~ **WITHDRAWN** | Impossibility was never demonstrated. Steps 5–6 permit frozen fixtures and a minimum JSONL/manual spike, so a disposable no-core-code harness may exercise the Kernel-surface attacks. Superseded below |
| 2026-07-20 | ~~Phase ordering is an unresolved ambiguity~~ **RESOLVED by Owner decision** | Depth-0 chose the fixture route under steps 5-6, and it worked: all 8 attacks ran pre-P1. The residual question is only whether the same attacks are *also* required at P1 exit — this run records them as required |
| 2026-07-20 | ~~All 8 attacks relabelled unimplemented / not run; 0 executed~~ **SUPERSEDED** | Superseded by the Owner-decision stage: 8/8 fixture attacks executed and mutation-proven live |
| 2026-07-20 | ~~R4 "executed witness-head rewrite" claim withdrawn; root → `suspect`~~ **SUPERSEDED** | Superseded again by the 2026-07-21 root-owned receipt-root re-drive: OpenCode, Codex, and agy R4 pass; Claude Code R4 remains unverified |
| 2026-07-20 | ~~R3 `fail` → `suspect`; deployment split from capability~~ **SUPERSEDED** | Current classifier scores completed R3 fails only from execution-proven default-mode unapproved writes or captured self-disable evidence |
| 2026-07-20 | Codex-quota justification **removed** | Codex is the live depth-0 harness in this run and is demonstrably reachable; a stale quota record is not evidence about probe feasibility |
| 2026-07-20 | R1 weakened `fail` → `suspect`; `suspect` value added | Writable transcript files are a record, not proof the live in-memory authenticated envelope is forgeable; the forge attack was never run. `suspect` (evidence of weakness) is now distinct from `candidate` (evidence toward passing) |
| 2026-07-20 | ~~Option (A) — real per-target probes — not performed, not impossible~~ **SUPERSEDED** | Per-harness probes were performed for available CLIs, but missing host operations remain; P0 is incomplete rather than impossible |
| 2026-07-20 | ~~Probe verdicts four-valued~~ **SUPERSEDED — now five-valued** | The first probe derived `pass` from absence of a disproof on all four roots, and let `blocking_gate: verified` alone qualify a host. That would have minted a false `pass` on a future host. `pass` now requires named positive proof per root |
| 2026-07-20 | ~~Two claims weakened; STOP retained~~ **SUPERSEDED — STOP withdrawn entirely** | R2 `fail` → `unverified`, target hosts tier `none` → `unverified`, and later Claude Code R3 `fail` → `suspect`. The current claim is only that 0 hosts are *qualified* |
| 2026-07-20 | Three-task spike deliberately not run | Step 6's precondition is a qualifying host. No host qualifies, so the spike is blocked by the P0 evidence gate; it is not claimed impossible |
| 2026-07-20 | No product code, schema, or engine module added | The gate is a funding gate. Writing Kernel code before a host has trust roots would build an authority boundary the host cannot enforce |
| 2026-07-20 | KR10 arithmetic recorded as failing (42 → 51) | Independent second finding: the plan's deletions are prose, its additions are executed modules, and the deletion gate counts executed modules. Options handed to the Board without a recommendation |
| 2026-07-20 | GLM-5.2 challenge discarded as vacuous | 143-byte raw log, bare `SHIP-AS-IS`, zero engagement. A favourable but contentless pass is not evidence; counting it would have manufactured a confirmation |
| 2026-07-20 | MiniMax-M3 findings adjudicated individually | 4 accepted and fixed (incl. a genuinely misleading gate field), 1 rejected as a false positive with reasoning recorded, 2 acknowledged. None disturbed the verdict |
