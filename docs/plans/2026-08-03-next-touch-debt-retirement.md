---
status: planned
date: 2026-08-03
size: L
entry_level: l5
project: next-touch-debt-retirement
---

# Next-touch debt retirement

## Background

The audit found 12 known gaps hidden behind invalid “next touch” deferrals; the owner admitted them
with two already-actionable gaps. This plan therefore covers the NOW queue exactly once: **14
technical entries in eight bounded deliverables**. Two Board decisions and 29 trigger-conditioned
entries remain outside the graph.

## Design decisions

- Execute D1 through D8 in order on one cumulative Mission branch and one isolated worktree. Keep
  one implementer lineage; a repair resumes it instead of opening a replacement branch.
- The eight rows below are deliverables, not source-document phases. Each row's commit includes its
  tests, repairs, docs and removal of exactly its named backlog headings; D8 also commits the
  authorization receipt and project/plan archival. All are therefore in the cumulative
  candidate before its SHA is frozen; integration makes no direct documentation mutation.
- Each deliverable gets at most two repair generations. Exhaustion is an escalation with the raw
  child log, not permission to add a phase or silently narrow acceptance.
- Mission admission freezes `base_sha` and the roster: implementer
  `grok/Grok-4.5/high/xai`, non-implementer verifier
  `agy/Gemini 3.5 Flash (High)/high/google`, and cross-family reviewer
  `claude-native/claude-opus/high/anthropic`; observed CLI/model versions and actor IDs enter the
  authorization receipt. No actor may occupy two roles.
- Remove obsolete wiring after migration; prefer one canonical implementation and existing helpers.
- This plan authorizes planning only. It does not authorize a version bump, release, push, or
  external publication.

## Ordered deliverable graph

```text
D1 correctness/test debt
  -> D2 controller authority helpers
  -> D3 dispatch-author containment
  -> D4 reviewer framing
  -> D5 distill maintenance
  -> D6 opt-in hook multiplexer
  -> D7 verification-strength routing
  -> D8 Grok calibration and tuning
```

D1–D8 share one isolated worktree, one cumulative branch, and one implementer transcript. Each row
has up to two repair generations; the next row starts after the previous row's acceptance commands
are green and its commit is recorded on the cumulative branch. Nothing lands on `develop` until the
base-bound integrated review passes. D8 owns two bounded gates inside its existing allowance:
G8a cumulative doc/backlog sync + receipts/archive, then G8b integrated verifier/reviewer + the one
integration. They are not deliverables, phases, repair resets, or fresh budgets.

## Frozen admitted-heading ledger

Admission records immutable `base_sha`; the reservation validator must match this ordered ledger
byte-for-byte against the `###` headings in `git show "$BASE_SHA":docs/BACKLOG.md` and map each once:

| IDs | Deliverable | Exact frozen-base headings |
|---|---|---|
| A01–A04 | D1 | Review-loop enum gate — behavioral per-field invalid-value proof; classify-error quota 共現 gate 偏寬 — 裸 `status`/`error` 子串共現即判 quota; Orchestrator edit-gate hermetic baseline; Generated `.opencode/agent-bodies/*.body.md` relative links break one level deep |
| A05–A06 | D2 | Explicit findings identity authority; Shared sealed zero-diff validator |
| A07 | D3 | dispatch-author codex transport：cgroup supervision tier（fd-less inter-poll escapee 殘差閉環） |
| A08 | D4 | `dispatch-review.sh` echo-hardening — derived/transformed delimiter (max-security variant) |
| A09–A11 | D5 | distill/learn 邊界句進 description(+ retro「session」詞彙鄰接註記); distill-scan 校準：friction bucket 混入非使用者文本 ＋ 複合命令儀式盲點; distill identifier lint 開放給外部 skill pack 使用（單獨入口） |
| A12 | D6 | Per-event opt-in hook multiplexer (perf) — avoid spawning gated-off opt-in hooks on every tool call |
| A13 | D7 | `verify_strength` as the third density input — decomposed into ordered precursors |
| A14 | D8 | grok implementer 摩擦調校（toolFailure 28%／零 commit 72%／effort 反效果假說） |

## Mission reservation contract

Admission writes `docs/projects/2026-08-03-next-touch-debt-retirement/evidence/authorization.json`
and fails before spend unless
`node scripts/validate-next-touch-reservation.js --ledger "$MISSION_LEDGER" --pre-spend` passes.
Reservations are exact ceilings: D1–D7 each get one initial + two same-lineage repairs, 180 minutes
and 240 tool calls; D4 also gets seven named adapters × 20 = 140 trials. D8 gets the same three
engine attempts, 360 minutes and 600 calls. Its within-model Grok study has distinct `medium` and
`high` buckets of 60 provider sessions each, including at most six retries per bucket: all primary,
extension and retry calls share the total 120-session ceiling. G8b's three verifier/reviewer pairs
(six seats) are already inside D8/integration, never additive. Totals: 24 engine attempts, 1,620
minutes, 2,280 calls, 140 D4 trials, at most 120 D8 sessions and six final seats. Unavailable
capacity rejects admission. The terminal receipt binds
planned/actual usage, all eight commits and acceptance digests, the 14 heading identities, roster,
review transports and frozen SHAs in the Git-common-dir authority store.

## D1 — Correctness and hermetic-test debt

**Backlog entries**: A01–A04.

**Implementation**

Exercise every review-loop enum invalid path; require numeric HTTP-error shape for payment/balance
quota; give edit-gate tests an allowlisted environment/fresh HOME; and fix generated-depth OpenCode
links with generator drift coverage.

**Acceptance**

- Every enum's invalid value takes its documented fallback; schema↔shell parity stays green.
- Benign payment prose is not quota; numeric 402/exhausted-balance fixtures remain quota.
- Edit-gate passes with fresh HOME/allowlisted env; generated links resolve and drift fails `--check`.

```bash
bash hooks/tests/contract-parity.test.sh
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/engine-capability-state.test.sh
node --test hooks/orchestrator-edit-gate.test.js
bash scripts/sync-agent-bodies.sh --check
node scripts/doc-drift-gate.js .
```

## D2 — Controller authority helper closure

**Backlog entries**: A05–A06.

**Implementation**

Require explicit findings identity at every call. One shared validator replaces copies consumed by
`scripts/dispatch-contract.js::validateSchema`,
`src/engine/campaign-dispatch-projection.js::validateZeroDiffReceipt`, and
`scripts/dispatch-hetero.sh` strict admission/postcheck; delete copies only after corpus parity.

**Acceptance**

- Missing findings identity is rejected. All three named consumers return identical verdicts for
  body/path/acceptance/projection/artifact mutations; one production validator remains.

```bash
bash hooks/tests/controller-execution-independent.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/dispatch-hetero.test.sh
bash hooks/tests/mission-routing-admission.test.sh
bash hooks/tests/sealed-zero-diff-validator-parity.test.sh
```

## D3 — `dispatch-author` cgroup containment

**Backlog entry**: A07; trusted-cwd is its caller-boundary acceptance, not another identity.

**Implementation**

Port `systemd-run --user --scope`, require empty `cgroup.procs`, and retain an honest unsupported-host
fallback; this is teardown hygiene, not same-UID security. Bind `dispatch-plan-review.js`'s Codex
child to the canonical reviewed repo while keeping the prompt private; never disable trust globally.

**Acceptance**

- Supported hosts reject/reap any scoped descendant; fallback hosts report process-tree/fd-holder
  provenance and never claim cgroup containment. Existing transport matrices stay green.
- A real Codex plan-review seat launched through `dispatch-plan-review.js` clears repository-trust
  preflight from its private prompt cwd, and a wrong/untrusted repo binding still fails closed.

```bash
bash hooks/tests/dispatch-author-codex-transport.test.sh
bash hooks/tests/dispatch-author-contract.test.sh
bash hooks/tests/dispatch-author-result-provenance.test.sh
bash hooks/tests/dispatch-plan-review.test.sh
AUTOPILOT_LIVE_CODEX=1 bash hooks/tests/dispatch-plan-review-live.test.sh --repo "$PWD" --runner codex --assert-trusted-cwd
```

## D4 — Reviewer framing that cannot pass prompt echo

**Backlog entry**: A08.

**Implementation**

Replace the echoed nonce with one derived-delimiter parser. Probe the seven frozen production
adapters for 20 low-output trials each; 20/20 is required for cutover, otherwise deprecate/version or
redesign. Keep no permissive parser.

**Acceptance**

- Prompt echo cannot parse. Every adapter passes 20/20 through one parser; the report binds identity
  and prompt/parser digests. Wrong/duplicate/noisy/truncated/non-zero cases fail closed.

```bash
bash hooks/tests/dispatch-review-prompt-skeleton.test.sh
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/review-runner.test.sh
bash scripts/probe-review-framing.sh --all-supported --trials 20 --report .autopilot/evidence/review-framing.json
bash hooks/tests/review-framing-report.test.sh .autopilot/evidence/review-framing.json
```

## D5 — Distill routing, scan, and lint maintenance

**Backlog entries**: A09–A11.

**Implementation**

Put the fact/procedure boundary in discovery text; exclude injected teammate/dispatch/continuation
text; split compound shell rituals without parsing heredocs; expose one shared `--path <dir>` lint.

**Acceptance**

- Routing separates fact/procedure/retro; golden transcripts exclude injected text, recover compound
  steps, and ignore heredocs. Standalone/internal lint matches; Codex mirrors remain byte-equal.

```bash
bash hooks/tests/distill-scan-incremental.test.sh
bash hooks/tests/distill-consolidate.test.sh
bash scripts/validate.sh
bash scripts/sync-codex-plugin-skills.sh --check
```

## D6 — Per-event opt-in hook multiplexer

**Backlog entry**: A12.

**Implementation**

Replace the 16 opt-in event registrations with one canonical multiplexer per event. Remove direct
opt-in registrations. Benchmark base/candidate with
committed schema-v1 `hooks/tests/fixtures/hook-multiplexer-benchmark.json`: four fixtures
`cold|heavy × disabled|enabled`, each fixing event, payload SHA-256, enabled-hook IDs and expected
child count. Run 10 warm-ups + 50 paired alternating samples; admission seals base median/p95.

**Acceptance**

- A disabled opt-in handler starts no child process; an enabled handler preserves payload, order,
  exit/fail-open semantics, and event membership.
- The 15 unique hooks and the two-event `mcp-health` membership remain inventory-correct.
- MAD/median must be ≤10%. Disabled children = 0 and candidate median/p95 ≤75% of base; enabled
  median/p95 ≤105% of base. Absolute candidate p95 caps are 250 ms cold and 1,000 ms heavy. The
  schema fixes runtime, base/candidate SHAs and metrics; missing/changed baseline fails validation.

```bash
bash hooks/tests/check-hook-inventory.test.sh
bash hooks/tests/hook-handlers.test.sh
bash hooks/tests/all-hooks-fail-open.test.sh
node scripts/check-hook-inventory.js --check
node scripts/benchmark-hook-multiplexer.js --base "$BASE_SHA" --candidate "$CANDIDATE_SHA" --fixtures hooks/tests/fixtures/hook-multiplexer-benchmark.json --warmups 10 --repetitions 50 --report .autopilot/evidence/hook-multiplexer-benchmark.json
node scripts/validate-hook-multiplexer-benchmark.js .autopilot/evidence/hook-multiplexer-benchmark.json
```

## D7 — Verification-strength scorer and routing input

**Backlog entry**: A13.

**Owner design**: [`2026-07-09-verify-strength-precursors.md`](2026-07-09-verify-strength-precursors.md)
Segments 2 and 3. Do not duplicate Segment 1, which is already shipped.

**Implementation**

Build and calibrate the deterministic real-suite strength scorer, then consume its ordinal in the
review-loop resolver. Unknown or inconclusive evidence takes the weakest/safest route; a strong
score reduces review by at most one loop only when a held-out corpus has at least 60 known-outcome
cases, zero escaped defects labelled strong, and a one-sided 95% Wilson upper escape bound at most
5%. Protected-path/source-trust minima never reduce; any failed condition routes as weak.

**Acceptance**

- A committed calibration corpus ties scorer outputs to known escape outcomes and prevents score
  drift.
- Real-repository fixtures produce deterministic `weak | medium | strong | inconclusive` results.
- Resolver fixtures prove weak/inconclusive never lower review, strong cannot bypass protected-path
  or source-trust requirements, and invalid values fail closed.

```bash
bash hooks/tests/verify-red-green.test.sh
bash hooks/tests/pipeline-bench.test.sh
bash hooks/tests/resolve-review-loop.test.sh
```

## D8 — Grok implementer controlled calibration

**Backlog entry**: A14.

**Implementation**

Run a within-model paired crossover through `dispatch-hetero.sh`: the same admitted
`grok/Grok-4.5/xai` actor uses reserved effort buckets A=`medium`, B=`high`; this is not a second
actor. Freeze 30 tasks and arm-order seed, extending once to at most 60 pairs. Primary endpoint is
paired difference in usable-session rate (`wrapper_commit && toolFailure==0`), higher is better;
material effect is 10 percentage points. Quality is independent-review acceptance rate with a
5-point non-inferiority margin. Use 10,000 task-pair bootstrap resamples with the committed seed.

**Acceptance**

- Only pre-run invalid-task/infra exclusions with a schema-valid reason are allowed. Initial 30
  pairs, the one extension, and retries together must remain ≤120 provider sessions. Missing arms
  are never dropped/imputed; after the per-arm six-retry cap, D8 stays open.
- Both arms run the same 30 paired tasks (60 sessions); if the interval cannot support superiority
  or equivalence, the pre-frozen extension runs up to 60 pairs.
- `tune-medium` requires the endpoint interval lower bound above +10 points; `tune-high` requires its
  upper bound below −10; either also requires quality lower bound at least −5. `no-change` requires
  the endpoint interval wholly within ±10 points and no quality breach. A
  still-indeterminate 60-pair result escalates and leaves D8 open; it cannot close calibration.
- A schema-validated durable report records the decision and evidence; any config change has
  resolver/dispatch regression coverage. Its validator rejects session/pair/exclusion counts that
  differ from the frozen seed/corpus, silent drops, imputation, or post-hoc shrink.

```bash
bash scripts/run-grok-implementer-ab.sh --tasks evals/grok-implementer-ab/tasks.json --report .autopilot/evidence/grok-implementer-ab.json
node scripts/validate-grok-implementer-ab.js --report .autopilot/evidence/grok-implementer-ab.json
bash hooks/tests/dispatch-hetero.test.sh
bash hooks/tests/resolve-dispatch.test.sh
```

## Integrated completion gate

Inside D8/G8a, before freezing each candidate, the cumulative diff removes exactly A01–A14 (set
difference against `base_sha`, no other heading), doc
drift is clean, and lifecycle moves the project, plan and authorization receipt under
`docs/projects/_archive/2026-08-03-next-touch-debt-retirement/`. The persisted attempt ledger keys on
the admission `base_sha`, candidate SHA and source-deliverable lineage. For every initial or repaired
candidate the named verifier reruns all commands below, then the named reviewer independently reviews
exactly `base_sha..candidate_sha`; receipts bind actor/model/version, command bytes/results and SHAs.
Invalid provenance/parser output, timeout or exhausted transport yields no verdict and blocks
authorization. A repair resumes its mapped D1–D8 implementer transcript and consumes that row's
existing allowance; candidate, runner, session or branch changes never reset accounting. Attempt 3
is the second repair and terminal ceiling: generation 3 is impossible.

G8b has one mechanical integration predicate/transaction:
`node scripts/validate-next-touch-terminal.js --receipt "$MISSION_LEDGER/terminal.json" --base "$BASE_SHA" --candidate "$CANDIDATE_SHA" --assert-removed-ledger A01:A14 --integrate-worktree "$DEVELOP_WORKTREE"`.
It must validate all authority/evidence, exact heading set difference, archive state and current
develop tip before performing the sole `--ff-only` merge; only then does it atomically advance
`reviewed_archived → integrated`. Non-zero means no merge and no state advance.

```bash
bash scripts/sync-all.sh --check
bash scripts/validate.sh
bash hooks/tests/run.sh
node scripts/doc-drift-gate.js .
git diff --check
```

## Risks

D3/D4 must fail closed at transport/framing boundaries. D6 needs event/fail-open parity. D7 routes
unknown evidence weak. D8 freezes tasks/randomization before outcomes to prevent selection bias.

## Out of scope

- The two Board decisions (Fable absorption and Tree graduation).
- The 29 entries whose trigger depends on an upstream platform contract, a real incident/sample
  threshold, a new runner/consumer, or an expanded threat model.
- Version bump, release, push, and external publication.

Canonical conditional ledger (exact `docs/BACKLOG.md` headings at admission):
C01 Codex payload install-time generation（2026-08-02 residual spike：NO-GO）
C02 Release-time payload branch（B）重啟條件
C03 OpenCode `debug skill` truncation — restore portability check 16 to hard-fail
C04 t14 long-horizon per-turn verification gate
C05 Mission graph scheduler 與 portfolio optimization
C06 Mission authority store 與 cross-harness enforcement hardening
C07 Dispatch-branch lifecycle — SHA-256 `check --ack` residual
C08 context-budget T3 deny tier — calibration and obedience evidence
C09 skills frontmatter `tier:` 欄位（B4 step 2 — 分層進 frontmatter）
C10 certified-clean 語料庫重建 — evals/clean/ 已重定性為「已合併真實 diff 對照集」,絕對 specificity 門檻需要真 certified 集
C11 Reviewer transport exits can erase an otherwise valid fail-closed verdict
C12 Domain-aware routing — consume the `work_domain` telemetry to route reviewer/implementer by diff domain
C13 L1 block-mode override re-enable — needs a REAL isolation boundary (cgroup is NOT enough)
C14 qc-panel refute pass — graduate from shadow to gating (calibration-gated)
C15 `/l5` hetero-parallel width fan-out (machinery built, deliberately unwired)
C16 Leaf-level output compaction for dispatched implementer / qc shell commands (rtk-style)
C17 M3-band fixtures（t15-t17）若供對抗性 implementer 情境重用，需 process-isolation 邊界
C18 First local runner capability semantics（availability/load，不是 quota）
C19 broader shared-config containment / per-worktree isolation（2026-07-17, follow-up）
C20 Durable merge execution crash recovery
C21 Bind dirty content continuity from preflight to execution
C22 Recover stale backlog admission locks safely
C23 Controller helper API fail-closed hardening
C24 Boundary outcome and root dispatch semantics
C25 Portable byte and Work Order lifecycle hardening
C26 Durable resume and review authority binding
C27 Mission graph and campaign capacity boundary hardening
C28 Orphan leaf liveness and resource reconstruction
C29 Terminal status and receipt trust boundary

## Open questions

None. The owner decision that opportunistic next-touch clauses are not valid deferral conditions
settles admission; evidence gates inside D4, D6, D7, and D8 decide implementation details, not
whether those deliverables run.
