---
status: approved
date: 2026-08-01
size: L
entry_level: l6
project: backlog-convergence-plan-set
---

# Backlog Convergence Plan Set

## Decision

The backlog is not an execution graph. A source plan heading, a review seat, a test batch, a
repair generation, and a documentation sync are coverage or gates inside one deliverable; none
becomes a new Mission node. This plan therefore groups the inventory into five bounded tracks and
leaves trigger-gated work in the backlog until its stated trigger is observed.

No version, release, or external publish is authorized by this plan. The three executable tracks
below are now admitted as one bounded Mission graph; existing plans and the active Owner Kernel
project remain the owners of their work. Track 4 and Track 5 stay design/Board-only.

## Inventory result

`docs/BACKLOG.md` contains 66 `###` headings, of which one is the format example. The real
inventory is **65 entries**:

| Classification | Count | Meaning |
|---|---:|---|
| Explicit `TRIGGERED` | 14 | The trigger is observed; it may enter one of Tracks 1–5 below. |
| `UNDECIDED` | 1 | Board disposition is required before implementation. |
| `OPEN` | 8 | Retained post-merge follow-ups; each still has its own trigger. |
| `DEFERRED` | 1 | The stated schema/consumer trigger has not fired. |
| No explicit status | 41 | Trigger-bearing historical entries; their individual trigger, not age, controls admission. |

The 14 explicit triggered entries are not all code-ready. “Triggered” means the follow-up may be
planned now; it does not waive a Board decision, a live probe, or an existing project dependency.

## Plan graph

```text
Track 1 — Mission admission and authority hygiene ──┐
                                                     ├─> Track 3 — Owner Kernel P4 qualification
Track 2 — Cross-harness readiness ───────────────────┘

Track 4 — Review budget/transport contract (design first)
Track 5 — Evidence and Board decisions (decision/measurement first)

All remaining entries stay in the trigger bank; they do not create work until their trigger fires.
```

Tracks 1 and 2 are the current implementation candidates. Track 3 is an existing project
continuation, not a new project. Tracks 4 and 5 can produce a design or Board receipt now, but
their implementation effects remain gated by the conditions in the source entries.

## Track 1 — Mission admission and authority hygiene

**Disposition:** ready to plan as one post-ship controller residual. It does not re-open the
archived Controller Execution Discipline project or recreate any already-shipped deliverable.

**Backlog entries:**

- `E1 dispatch-manifest 合規 merge gate（/lN 宣稱 ⇒ 機器可驗）`
- `Legacy ready Mission terminals lack exact controller Work Orders`
- `Dispatch/session tests inherit production Mission authority state`

**Goal:** make the live repository admit only an exact, authoritative Mission state and make
dispatch/session tests independent from production durable evidence. The merge gate is the
backstop for depth-0 protocol bypass; it must not become a second Mission authority.

**Bounded deliverable:** one authority-hygiene node containing the exact legacy disposition,
hermetic test authority store, and manifest/edit provenance gate. Tests, review, and repair remain
inside this node.

**Acceptance:**

1. The canonical ready B/C terminals either receive a validated, authority-preserving disposition
   or are explicitly retired; no Work Order, receipt, or ready history is synthesized or rewritten.
2. `mission-routing-admission` accepts the resulting canonical state and still fails closed for a
   missing, mismatched, or replayed controller Work Order.
3. Dispatch/session fixtures use an isolated Git common dir/authority store, while Mission
   fixtures seed exactly the state they assert; the full suite no longer inherits this checkout's
   production registry.
4. E1 rejects a product commit with no dispatch manifest or an unauthorized depth-0 edit and
   accepts a correctly bound manifest. The gate reports provenance rather than inferring it from
   commit prose.

**Dependency:** complete before Track 3 claims Mission integration. Do not use test cleanup or a
new branch as a substitute for authority reconciliation.

## Track 2 — Cross-harness transport and lifecycle readiness

**Disposition:** seven explicit triggered entries can be grouped into one portability/readiness
node. This is the next implementation batch after Track 1 admission is unblocked.

**Backlog entries:**

- `codex-native spawn_agent lifecycle / teardown 盲區納管（codex 當 depth-0 時）`
- `Codex 0.146 native spawn_agent schema/docs reconciliation`
- `codex 宿主 slash-entry 探針入 gate(committed、可重跑)`
- `preflight-portability.sh meta-smoke test`
- `agy reviewer/author hard isolation`
- `identity rail on dispatch-author non-strict path（2026-07-17, 低優先）`
- `agy generic model alias normalization（gemini-flash）`

**Goal:** make the next Codex/agy dispatch observable, bounded, and mechanically probeable. A
fresh probe is evidence for the current installed tool only; it does not turn transport success
into role qualification.

**Bounded deliverable:** one cross-harness readiness node. The Codex schema probe, slash probe,
and preflight meta-smoke are deterministic gates inside it; agy isolation, alias normalization,
and the non-strict identity rail are implementation seams in the same node.

**Acceptance:**

1. A fresh Codex 0.146 minimal probe records the actual `spawn_agent` schema, lifecycle boundary,
   teardown limitation, and child model identity; stale 0.144 wording is removed from canonical
   and Codex-facing docs.
2. The committed Codex slash-entry probe is rerunnable, self-skips only when the required live
   tool/quota is absent, and proves the expected exec event and MUST-READ resolution.
3. A sandboxed copy of `preflight-portability.sh` with one planted violation exits non-zero;
   the clean fixture remains green.
4. The agy reviewer and verification-author probes prove the actual filesystem/process boundary
   before wiring; unsupported sandbox behavior fails closed. The generic `gemini-flash` alias
   resolves to the current canonical slug before a QC/author roster is dispatched.
5. The explicit non-strict author path obtains the repository root and runs the identity snapshot/
   restore rail; no identity value is placed in public output.
6. Native Codex children and agy workers have an explicit teardown/disposition result. No claim is
   made that an engine-internal child is covered by shell process-group reaping when it is not.

**Out of scope:** production Codex `PostCompact` registration (its accepted live-hook trigger is
still unmet), malicious same-UID isolation, and role qualification. Those remain in the trigger
bank or Track 3.

## Track 3 — Owner Kernel P4 role qualification

**Disposition:** use the existing active Owner Kernel project; do not create a duplicate plan.

**Backlog entry:** `Readiness gate 的 session-local qualification provider`.

**Owner:** `docs/projects/2026-07-20-owner-kernel-governance/` P4, with the readiness contract in
`docs/plans/2026-07-26-provider-readiness-orchestrator.md`.

**Goal:** provide exact-tuple, host-injected qualification authority for implementer,
verification-author, and QC roles. Transport/live probes and disk-backed scorecards remain
independent observations and cannot promote a role.

**Admission condition:** Track 1 must first make Mission integration authoritative. The existing
project may prepare fixtures and the provider contract before then, but it must not claim P4
completion or release readiness from a provisional scorecard row.

**Acceptance:**

- a session-local provider can produce a non-serializable or externally bound exact-role receipt;
- implementer, verification-author, and QC reviewer-role qualification each have an explicit
  red/green fixture;
- a transport probe, stale scorecard, or telemetry row alone cannot satisfy the receipt;
- ICC consumes the receipt before any effectful branch/worktree/runner spend.

## Track 4 — Reviewer budget and transport contract

**Disposition:** design now; implementation only after the runner matrix is frozen. This track is
deliberately not a generic “add a flag everywhere” change.

**Primary backlog entry:**
`dispatch-review.sh` runner-aware reviewer output-token budget (`--max-tokens`).

**Related trigger-gated entries covered by the same design boundary:**

- `B1/B2 review 路徑效率（diff-only 強制 + delta re-review）`
- `Reviewer transport exits can erase an otherwise valid fail-closed verdict`
- `dispatch-review.sh echo-hardening — derived/transformed delimiter (max-security variant)`
- `Review-response leakage false reject + RED/green polarity tripwire`
- `Leaf-level output compaction for dispatched implementer / qc shell commands (rtk-style)`

**Design deliverable:** one canonical reviewer-budget/transport contract specifying:

1. the meaning and unit of `max_tokens`;
2. per-runner mappings for Codex, agy, Grok, cc-shim, Anthropic-compatible,
   Claude-native, and Qoder;
3. fail-closed behavior when a runner cannot enforce the requested budget;
4. separation of process truth, parseable verdict bytes, and framing failure;
5. the round-2 delta input shape and reviewer-safe redaction rules.

**Acceptance before implementation:** a runner capability matrix, unsupported-case fixtures, and
one canonical contract review. No wrapper may silently forward a same-named option whose semantics
are unknown, and no transport exit may turn a missing verdict into a pass.

**Implementation trigger:** only after the matrix and unsupported behavior are accepted. B1/B2,
echo-hardening, polarity, and output-compaction changes still require their own stated runtime
trigger; this plan does not pull them forward merely because they are adjacent.

## Track 5 — Evidence and Board decisions

**Disposition:** one decision/measurement packet, not an implementation phase. It consolidates
related calibration and Board work without silently approving any methodology change.

**Backlog entries:**

- `Skill-transport payoff A/B — implementer arm Phase 2 closure`
- `Tree-engine graduation Board review`
- `Fable skills absorption plan — Board triage`
- `t14 long-horizon per-turn verification gate`
- `agy 遙測盲區 — transcript 無 token 欄位且 91% 被平台截斷`
- `grok implementer 摩擦調校（toolFailure 28%／零 commit 72%／effort 反效果假說）`
- `certified-clean 語料庫重建`
- `qc-panel refute pass — graduate from shadow to gating (calibration-gated)`

**Decision order:**

1. Record the overdue Tree-engine `graduate / extend / abort` decision; two samples are not a
   qualification corpus.
2. Record a Board disposition for Fable before touching P1–P4; the existing plan remains the
   source of truth and is not silently archived.
3. Run the already-approved skill-transport implementer arm or record an explicit won’t-do.
4. Keep t14, certified-clean, qc-panel graduation, agy telemetry, and grok calibration in
   measurement mode until their own evidence thresholds are satisfied.

**Acceptance:** each entry receives exactly one durable disposition (`execute`, `measure`,
`extend`, `abort`, or `keep-triggered`), with evidence and an owner. No Board silence is treated as
approval, and no telemetry row is promoted into role authority.

## Trigger bank — not scheduled

The following 40 entries remain in `docs/BACKLOG.md` and are intentionally not admitted to a
project. They are grouped for discovery only; each keeps its own trigger and source.

### Payload, controller, and threat-model extensions

- `Codex payload install-time generation（C-Spike SPIKE-PASS）`
- `Release-time payload branch（B）重啟條件`
- `Foreman↔depth-0 coordination R6 — reliable state, ownership lease, and adaptive recovery`
- `Mission graph scheduler 與 portfolio optimization`
- `Mission authority store 與 cross-harness enforcement hardening`
- `Codex production PostCompact recovery wiring`
- `dispatch-author codex transport：cgroup supervision tier`
- `context-budget T3 deny tier — calibration and obedience evidence`
- `L1 block-mode override re-enable — needs a REAL isolation boundary`
- `/l5` hetero-parallel width fan-out`
- `Domain-aware routing — consume the work_domain telemetry`
- `First local runner capability semantics（availability/load，不是 quota）`
- `broader shared-config containment / per-worktree isolation`

### Correctness, lifecycle, and test integrity

- `OpenCode \`debug skill\` truncation — restore portability check 16 to hard-fail`
- `Review-loop enum gate — behavioral per-field invalid-value proof`
- `CLAUDE.md 逼近 40k 硬上限`
- `hooks/tests/dispatch-output-quiescence.test.sh 時間敏感 flake 未根治`
- `classify-error quota 共現 gate 偏寬`
- `Dispatch-branch lifecycle — SHA-256 check --ack residual`
- `Orchestrator edit-gate hermetic baseline`
- `skills frontmatter \`tier:\` 欄位（B4 step 2 — 分層進 frontmatter）`
- `Generated \`.opencode/agent-bodies/*.body.md\` relative links break one level deep`
- `M3-band fixtures（t15-t17）若供對抗性 implementer 情境重用，需 process-isolation 邊界`
- `verify_strength as the third density input`

### Methodology, docs, and distill maintenance

- `distill/learn 邊界句進 description`
- `distill-scan 校準`
- `distill identifier lint 開放給外部 skill pack`
- `Per-event opt-in hook multiplexer (perf)`

### Post-merge controller follow-ups

- `Durable merge execution crash recovery`
- `Bind dirty content continuity from preflight to execution`
- `Recover stale backlog admission locks safely`
- `Controller helper API fail-closed hardening`
- `Boundary outcome and root dispatch semantics`
- `Portable byte and Work Order lifecycle hardening`
- `Durable resume and review authority binding`
- `Explicit findings identity authority`
- `Mission graph and campaign capacity boundary hardening`
- `Orphan leaf liveness and resource reconstruction`
- `Terminal status and receipt trust boundary`
- `Shared sealed zero-diff validator`

These entries are not “forgotten”; no plan is opened until the entry's trigger is observed. A
future admission must attach to the relevant track or create a new bounded track only when the
source contract cannot be satisfied by an existing one.

## Overlap and non-duplication rules

- The Owner Kernel P4 item is attached to the active Owner Kernel project, not copied into a new
  project.
- Skill-transport uses `docs/plans/2026-07-15-skill-transport-payoff-ab.md`; this portfolio only
  records the missing implementer arm disposition.
- Fable uses `docs/plans/2026-07-08-fable-skills-absorption.md`; no implementation is authorized
  without its Board decision.
- The archived Controller, Evidence/Eval, and Correctness projects remain shipped. Track 1 is
  only the later Mission-admission/test-authority residual and does not replay their deliverables.
- Track 4 is a contract/spike boundary. It does not claim that a runner supports
  `--max-tokens` merely because another runner does.

## Portfolio acceptance

This plan set is complete when:

1. all 65 real backlog entries appear exactly once in Tracks 1–5 or the trigger bank;
2. the 14 explicit triggered entries are all accounted for without treating Board/measurement
   work as code-ready;
3. no existing project or shipped plan is duplicated;
4. no test, review seat, repair retry, or doc-sync step is promoted to a new deliverable;
5. Track 1–3 have a bounded owner/dependency/acceptance boundary, while Tracks 4–5 retain their
   source triggers and evidence requirements;
6. the final review is performed once over this complete plan set.

## Risks and out of scope

- Do not create a mega-project that implements all 65 entries.
- Do not make a second Mission authority, a compatibility shim, or a generic scheduler to make
  this map look complete.
- Do not close a backlog row because it was mentioned in this plan; closure requires shipped code
  or a recorded Board/measurement disposition in the source project.
- No version bump, release, push, branch, worktree, or destructive cleanup is part of this plan
  draft.
