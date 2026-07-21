# Owner Kernel governance

> **Plan**: [`docs/plans/2026-07-20-owner-kernel-evolution.md`](../../plans/2026-07-20-owner-kernel-evolution.md)
> **Target branch**: `feat/owner-kernel-governance`
> **Target version**: v2.32.57
> **Workflow**: CEO `/l6`, scope=Hold, involvement=just-results

## Project Goal

> **Final goal**: Replace flow-selected autonomy with a persistent qualified Owner Kernel so an
> unattended project can keep deciding, delegating, recovering, and accepting under one project-level
> governance default, while retaining fail-closed executable evidence and independent challenge.
>
> **Success criteria**:
> 1. `owner-led` and `milestone-led` both resolve from project config; a one-run override changes only the
>    current run. Verified by `node scripts/owner-kernel.js resolve --check` and translation tests.
> 2. P0's three-task spike records zero false acceptance, zero missed red-line escalation, at least 30%
>    fewer mandatory model-review dispatches, and a transcript-free cross-session resume. Failing any
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

### Explicitly Out Of Scope

- A weak model becoming owner merely because process surrounds it; weak models remain bounded workers.
- Remote/quorum witness infrastructure or defense against compromise of the trusted host itself.
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
| Version bump | Yes | P3 patch bump to v2.32.57 per project version policy |
| Version sync grep/check | Yes | P3 all-tracked-file old-version scan plus `sync-version.js --check` |
| Migration guide/notes | Yes | P3 `/lN` alias mapping and one-cycle retirement conditions |
| Dependent repos/consumers | Yes | P3 documents impact; actual downstream adoption explicitly out of scope |
| Credit/attribution | No | Design is internal synthesis; model review provenance remains in the plan review log |
| Dogfood target | Yes | P0 spike and P3 self-hosted shadow/dogfood run |
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
| P3 | Compatibility aliases, skill simplification, docs/config migration, generated mirrors, dogfood, release metadata | One executable translation table; legacy paths no longer own trust/lifecycle semantics |
| P4 | Owner/challenger/worker role qualification and optional native runner onboarding | Zero critical false-pass qualification; unqualified engines stay non-gating |
| L-5 | Final goal review, quality pipeline, merge, doc-sync, archive, session end, branch cleanup | Seven finish-flow gates produce concrete evidence |

## Progress

| Phase | Status | Evidence / Commit |
|---|---|---|
| Design | Complete | Board-approved five-family plan: `d98977c` |
| L-1.5 scope audit | Complete | Dimension and verbatim-requirement ledgers above |
| L-1.6 skill routing | Complete | dev-flow, l6, ceo-agent, test-strategy, harness-maintenance, quality-pipeline invoked in run `owner-kernel-p0-1784543437001` |
| P0 | **INCOMPLETE — blocked at the evidence gate** | 8/8 fixture attacks executed; strace execution-witness rail implemented and re-driven; 2/4 harnesses produced at least one driver-verified payload, but 0/4 hosts qualify and all 4 remain unverified because R4/default-mode/Claude/agy evidence is still incomplete. [`p0/P0-FINDINGS.md`](p0/P0-FINDINGS.md); classifier [`p0/host-classification.json`](p0/host-classification.json) |
| P1 | **NOT AUTHORIZED** | Because the P0 pass bar is **unproven**, not because it was failed. Missing P0 host operations must be executed before P1 can open |
| P2 | Blocked | Depends on P1 |
| P3 | Blocked | Depends on P2 |
| P4 | Blocked | Depends on P3 |
| L-5 | Not reached | P0 remains incomplete; finish-flow starts only after L-5 is actually reached |

### P0 outcome

**INCOMPLETE — 0 of 4 hosts qualify. P1 not authorized.**

Under the depth-0 Owner decision permitted by plan steps 5-6, all eight named step-4 attacks were
executed against frozen disposable fixtures, and the host probe was driven through each locally
installed harness in its own execution context. The classifier now treats both self-report and
missing evidence fail-closed: all four hosts are `unverified`, so the step-7 universal negative is
**not yet decidable** and this is not a STOP.

| P0 measurement | Value |
|---|---|
| Step 4 — named attacks vs fixtures | **8 of 8 executed, all contracts held**; all 8 oracles mutation-proven LIVE (0 vacuous) |
| Step 4 — per-harness capability | **4 of 4 harnesses driven**; driver strace execution witness added; OpenCode default+bypass and Codex bypass produced driver-verified payloads; agy bypass remained `self_reported`; Claude Code is blocked by weekly limit |
| Hosts **qualified** `full`/`partial` | **0 of 4** |
| Hosts `none` (completed disproof) | **0** — no host has enough completed evidence to resolve to host-level `none` |
| Hosts `unverified` (missing ops named) | **4** — all |
| Step 7 kill condition | **NOT DECIDABLE** — every host still has at least one named missing operation; missing evidence is not proof of incapability |
| Step 5 — baseline categories | **15 of 15 frozen**; only `event_log_tampering` exercised end-to-end (step 6 work) |
| Step 6 — three-task spike | **Not run** — precondition (a qualifying host) unmet. Not claimed impossible |
| Legacy absolute load-bearing surface baseline | **42** (44 with `/l5`-armed opt-in hooks) |
| Projected post-P3 absolute target | **51** — KR10 fails, projecting a rise of 9 |
| Mandatory model-review dispatch baseline (KR8/KR9 denominator) | **6** (distinct from 28 mandatory QC steps overall) |

**Key host finding (fail-closed)**: the execution-witness re-drive produced completed R2 same-uid
parent-environment reads for OpenCode and Codex, and a completed OpenCode default-mode R3
fail. Those findings do not qualify any host; P0 remains blocked on missing R4 authoritative
witness-root attacks, Claude Code evidence, Codex default-mode mediation evidence, and agy
execution-proven evidence.

**Named missing operations** (what would make the gate decidable):
- **every host**: attack a real authoritative witness/receipt root once one exists. R4 is
  unclassifiable until then.
- **claude-code**: re-drive default and bypass/permissive modes after the weekly limit resets.
- **codex**: obtain execution-proven default-mode mediation evidence plus captured self-disable
  evidence before scoring R3 as a completed disproof.
- **agy**: obtain execution-proven bypass/permissive-mode evidence; the latest nonce-bearing bypass
  payload failed the strace witness check and remains `self_reported`.

## Verification Contract

The authoritative per-phase commands are frozen in strict dispatch-unit contracts before engine spend.
The final mechanical gate includes at least:

```bash
node scripts/owner-kernel.js resolve --check
bash hooks/tests/owner-kernel.test.sh
bash hooks/tests/owner-kernel-adversarial.test.sh
bash hooks/tests/level-governance-translation.test.sh
bash hooks/tests/run.sh
scripts/validate.sh
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
bash scripts/check-canonical-invariants.sh
bash scripts/sync-codex-plugin-skills.sh --check
```

## Decision Log

| Date | Decision | Reason |
|---|---|---|
| 2026-07-20 | Governance is project-default with per-run override | User-selected product semantics; avoids choosing wiring on every task |
| 2026-07-20 | Strong qualified model owns; weaker models are bounded workers | Engineering process can expose failures but cannot manufacture judgment |
| 2026-07-20 | P0 remains a funding/kill gate | The host trust roots and 30% review reduction must be measured before architecture is funded |
| 2026-07-20 | Ship aliases for one compatibility release; do not fake elapsed telemetry | Preserves the approved migration contract without inventing future evidence |
| 2026-07-20 | **P0 steps 4+5 EXECUTED under depth-0 Owner decision** | Steps 5-6 permit frozen fixtures, so all 8 named attacks were run against a disposable no-core-code fixture: 8/8 contracts held, 8/8 oracles mutation-proven LIVE. 15/15 baseline categories frozen |
| 2026-07-20 | Per-harness probe replaces the shell-label probe | `run-harness-probes.sh` drives each real CLI and retains fresh nonce echoes as `self_reported`; `probe-host-trust-roots.sh` marked SUPERSEDED (it measured the shell and asserted a host name) |
| 2026-07-20 | R3 scoring narrowed after root QC | Completed R3 requires execution-proven default-mode evidence or captured self-disable evidence; nonce-only self-reports are unscored |
| 2026-07-20 | **P0 = INCOMPLETE, 0/4 hosts qualify; NOT a STOP** | 0 hosts `none`, 4 `unverified`. A universal negative needs every host classified from completed evidence; declaring STOP would again convert missing evidence into proof of incapability |
| 2026-07-20 | Nonce-only harness payloads downgraded to self-report | The nonce is disclosed in the model instruction, so it proves freshness but not execution of `host-capability-probe.js`; no R2/R3 host disproof is scored from it |
| 2026-07-20 | Fixture results excluded from host classification by construction | `classify-hosts.js` takes only execution-proven harness evidence. A sound contract qualifies no host |
| 2026-07-20 | Every attack must be re-run against production at P1 exit | Depth-0 Owner decision, recorded in the fixtures and findings. Fixture pass is a design gate, never a host qualification |
| 2026-07-20 | Target v2.32.57 | Externally visible change without a new skill/agent uses a patch bump in this repo |
| 2026-07-20 | ~~P0 = STOP; kill condition met~~ **WITHDRAWN** | Not supported. Step 4 was never performed, so the universal-negative kill condition could not have been established. Superseded by the row below |
| 2026-07-20 | ~~P0 INCOMPLETE; step 4 not performed (2/8, 1/4)~~ **SUPERSEDED** | Superseded by the Owner-decision stage: 8/8 fixture attacks executed and per-harness probing re-driven. P1 blocked because the pass bar is **unproven**, not failed. Current counts live in [`p0/P0-FINDINGS.md`](p0/P0-FINDINGS.md) |
| 2026-07-20 | ~~Plan P0 step 4 is unexecutable as written~~ **WITHDRAWN** | Impossibility was never demonstrated. Steps 5–6 permit frozen fixtures and a minimum JSONL/manual spike, so a disposable no-core-code harness may exercise the Kernel-surface attacks. Superseded below |
| 2026-07-20 | ~~Phase ordering is an unresolved ambiguity~~ **RESOLVED by Owner decision** | Depth-0 chose the fixture route under steps 5-6, and it worked: all 8 attacks ran pre-P1. The residual question is only whether the same attacks are *also* required at P1 exit — this run records them as required |
| 2026-07-20 | ~~All 8 attacks relabelled unimplemented / not run; 0 executed~~ **SUPERSEDED** | Superseded by the Owner-decision stage: 8/8 fixture attacks executed and mutation-proven live |
| 2026-07-20 | ~~R4 "executed witness-head rewrite" claim withdrawn; root → `suspect`~~ **SUPERSEDED** | Current classifier marks R4 `unverified` until a real authoritative witness/receipt root exists and is attacked |
| 2026-07-20 | ~~R3 `fail` → `suspect`; deployment split from capability~~ **SUPERSEDED** | Current classifier scores completed R3 fails only from execution-proven default-mode unapproved writes or captured self-disable evidence |
| 2026-07-20 | Codex-quota justification **removed** | Codex is the live depth-0 harness in this run and is demonstrably reachable; a stale quota record is not evidence about probe feasibility |
| 2026-07-20 | R1 weakened `fail` → `suspect`; `suspect` value added | Writable transcript files are a record, not proof the live in-memory authenticated envelope is forgeable; the forge attack was never run. `suspect` (evidence of weakness) is now distinct from `candidate` (evidence toward passing) |
| 2026-07-20 | ~~Option (A) — real per-target probes — not performed, not impossible~~ **SUPERSEDED** | Per-harness probes were performed for available CLIs, but missing host operations remain; P0 is incomplete rather than impossible |
| 2026-07-20 | ~~Probe verdicts four-valued~~ **SUPERSEDED — now five-valued** | The first probe derived `pass` from absence of a disproof on all four roots, and let `blocking_gate: verified` alone qualify a host. Unreachable today, but it would have minted a false `pass` on a future host. `pass` now requires a named positive proof; none is implemented, so qualification is unreachable by construction |
| 2026-07-20 | ~~Two claims weakened; STOP retained~~ **SUPERSEDED — STOP withdrawn entirely** | R2 `fail` → `unverified`, target hosts tier `none` → `unverified`, and later Claude Code R3 `fail` → `suspect`. The current claim is only that 0 hosts are *qualified* |
| 2026-07-20 | Three-task spike deliberately not run | Step 6's precondition is a qualifying host. No host qualifies, so the spike is blocked by the P0 evidence gate; it is not claimed impossible |
| 2026-07-20 | No product code, schema, or engine module added | The gate is a funding gate. Writing Kernel code before a host has trust roots would build an authority boundary the host cannot enforce |
| 2026-07-20 | KR10 arithmetic recorded as failing (42 → 51) | Independent second finding: the plan's deletions are prose, its additions are executed modules, and the deletion gate counts executed modules. Options handed to the Board without a recommendation |
| 2026-07-20 | GLM-5.2 challenge discarded as vacuous | 143-byte raw log, bare `SHIP-AS-IS`, zero engagement. A favourable but contentless pass is not evidence; counting it would have manufactured a confirmation |
| 2026-07-20 | MiniMax-M3 findings adjudicated individually | 4 accepted and fixed (incl. a genuinely misleading gate field), 1 rejected as a false positive with reasoning recorded, 2 acknowledged. None disturbed the verdict |
