---
status: planned
date: 2026-08-03
size: L
entry_level: l5
project: next-touch-debt-retirement
---

# Next-touch debt retirement

## Background

The 2026-08-03 backlog audit found 48 real entries. Twelve known gaps were still guarded by an
opportunistic clause such as “next time touching X”, “下次修改”, or “when the schema next changes”.
Those clauses do not describe an external prerequisite: the requirement and acceptance gap already
exist. Per the owner's decision, they are admitted now instead of waiting for an unrelated edit.

This plan also gives the other two currently actionable technical gaps an owner, so the complete
NOW queue is covered once: **14 technical entries in eight bounded deliverables**. The two Board
decisions and 32 genuinely conditional entries remain outside this implementation graph.

## Design decisions

- Execute D1 through D8 in order on one cumulative Mission branch and one isolated worktree. Keep
  one implementer lineage; a repair resumes it instead of opening a replacement branch.
- The eight rows below are deliverables, not source-document phases. Tests, repair attempts,
  documentation sync, and review seats stay inside their owning deliverable.
- Each deliverable gets at most two repair generations. Exhaustion is an escalation with the raw
  child log, not permission to add a phase or silently narrow acceptance.
- The implementer may run local smoke tests, but cannot authoritatively verify its own work. Freeze
  the original `base_sha` and final `candidate_sha`; one independent verification/review pass covers
  that exact cumulative range after all deliverable acceptance commands are green and before any
  integration into `develop`.
- Do not preserve obsolete wiring merely for compatibility. Prefer one canonical implementation
  and established libraries or repository helpers over parallel legacy paths.
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
  -> one integrated independent verification/review + doc sync
```

D1–D8 share one isolated worktree, one cumulative branch, and one implementer transcript. Each row
has up to two repair generations; the next row starts after the previous row's acceptance commands
are green and its commit is recorded on the cumulative branch. Nothing lands on `develop` until the
base-bound integrated review passes.

## D1 — Correctness and hermetic-test debt

**Backlog entries**

- Review-loop enum gate — behavioral per-field invalid-value proof
- classify-error quota 共現 gate 偏寬 — 裸 `status`/`error` 子串共現即判 quota
- Orchestrator edit-gate hermetic baseline
- Generated `.opencode/agent-bodies/*.body.md` relative links break one level deep

**Implementation**

Add executable invalid-value coverage for every review-loop enum; bind payment/balance quota
classification to a numeric HTTP-error shape instead of naked prose; construct the edit-gate test
environment from an explicit allowlist and temporary HOME; and make generated OpenCode agent-body
links resolve from their generated depth, with a deterministic regression check in the generator.

**Acceptance**

- Every declared enum rejects an invalid value through the real resolver and asserts the documented
  fallback; schema↔shell declared-set parity remains green.
- Benign prose containing `payment required` plus naked `status`, `error`, or `http` is not quota;
  genuine 402/payment and exhausted-balance fixtures remain quota.
- The edit-gate suite passes with an empty/fresh HOME and does not inherit unrelated host variables.
- All links in generated agent bodies resolve, and generator drift fails `--check`.

```bash
bash hooks/tests/contract-parity.test.sh
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/engine-capability-state.test.sh
node --test hooks/orchestrator-edit-gate.test.js
bash scripts/sync-agent-bodies.sh --check
node scripts/doc-drift-gate.js .
```

## D2 — Controller authority helper closure

**Backlog entries**

- Explicit findings identity authority
- Shared sealed zero-diff validator

**Implementation**

Remove the fail-open `findingsIdentityOk = true` default and require an explicit identity verdict at
every call. Extract the three sealed zero-diff validation copies into one deterministic helper used
at the shell, Engine, and runner boundaries; remove the superseded copies after parity is proven.

**Acceptance**

- Omitting findings identity is rejected, and every production caller passes an explicit verdict.
- All three zero-diff consumers accept and reject the same positive/negative corpus, including body
  digest, path set, acceptance digest, projection, and artifact-type mismatches.
- There is one production validator, with no compatibility copy left behind.

```bash
bash hooks/tests/controller-execution-independent.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/dispatch-hetero.test.sh
bash hooks/tests/mission-routing-admission.test.sh
```

## D3 — `dispatch-author` cgroup containment

**Backlog entry**: dispatch-author codex transport：cgroup supervision tier（fd-less inter-poll escapee 殘差閉環）

**Implementation**

Port the established `systemd-run --user --scope` containment tier to the Codex author transport,
retain an honestly labelled fallback where the host has no supported user cgroup, and verify an
empty `cgroup.procs` before accepting the result. Treat this as teardown hygiene, not a security
attestation against a malicious same-UID process. Also close the live 2026-08-04 caller-boundary
failure: `dispatch-plan-review.js` currently launches the Codex author from an untrusted temporary
cwd, so Codex 0.146.0 exits before model invocation. Bind the child to the canonical reviewed repo
cwd (while retaining the private prompt artifact) or use an equally explicit verified trust flag;
do not globally disable repository trust checks for unrelated author calls.

**Acceptance**

- Supported hosts reject a result while any scoped descendant remains and reap the full scope on
  timeout or failure.
- Unsupported hosts use the existing process-tree/fd-holder fallback and report that provenance;
  they never claim cgroup containment.
- Existing honest-orphan, deleted-fd-holder, timeout, and normal-success matrices remain green.
- A real Codex plan-review seat launched through `dispatch-plan-review.js` clears repository-trust
  preflight from its private prompt cwd, and a wrong/untrusted repo binding still fails closed.

```bash
bash hooks/tests/dispatch-author-codex-transport.test.sh
bash hooks/tests/dispatch-author-contract.test.sh
bash hooks/tests/dispatch-author-result-provenance.test.sh
bash hooks/tests/dispatch-plan-review.test.sh
```

## D4 — Reviewer framing that cannot pass prompt echo

**Backlog entry**: `dispatch-review.sh` echo-hardening — derived/transformed delimiter (max-security variant)

**Implementation**

Freeze a supported-runner reliability matrix, then replace the plain echoed nonce boundary with a
derived delimiter protocol. Add a live probe that exercises 20 low-output framing trials per
supported runner against the exact production parser. A runner must pass 20/20 before cutover; a
failure requires an explicit deprecation/versioning decision or a new canonical design that passes
the same matrix. Do not retain a second permissive parser.

**Acceptance**

- A byte-for-byte prompt echo, including nonce markers at byte zero, cannot be parsed as a verdict.
- Valid verdicts from every supported reviewer runner pass 20/20 live trials through the same
  canonical parser; the committed report binds runner/model/version and prompt/parser digests.
- Wrong transforms, duplicate frames, pre-banner noise, truncation, and non-zero transport exits
  remain fail-closed.

```bash
bash hooks/tests/dispatch-review-prompt-skeleton.test.sh
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/review-runner.test.sh
bash scripts/probe-review-framing.sh --all-supported --trials 20 --report .autopilot/evidence/review-framing.json
bash hooks/tests/review-framing-report.test.sh .autopilot/evidence/review-framing.json
```

## D5 — Distill routing, scan, and lint maintenance

**Backlog entries**

- distill/learn 邊界句進 description(+ retro「session」詞彙鄰接註記)
- distill-scan 校準：friction bucket 混入非使用者文本 ＋ 複合命令儀式盲點
- distill identifier lint 開放給外部 skill pack 使用（單獨入口）

**Implementation**

Put the fact-vs-procedure boundary in the `learn` and `distill` discovery text; exclude injected
teammate/dispatch/continuation text from friction atoms; split compound shell rituals without
parsing heredoc bodies as commands; and expose the existing identifier lint as one reusable
`--path <dir>` entry used internally by distill and by external skill packs.

**Acceptance**

- Routing fixtures distinguish “record this fact” from “extract a reusable procedure”, while retro
  remains selected for session analysis.
- Golden transcript fixtures remove injected text and recover repeated compound-command steps
  without false atoms from heredocs.
- The standalone lint and distill-internal lint return identical findings for the same directory.
- Canonical and Codex payload skill/script copies remain byte-equal.

```bash
bash hooks/tests/distill-scan-incremental.test.sh
bash hooks/tests/distill-consolidate.test.sh
bash scripts/validate.sh
bash scripts/sync-codex-plugin-skills.sh --check
```

## D6 — Per-event opt-in hook multiplexer

**Backlog entry**: Per-event opt-in hook multiplexer (perf) — avoid spawning gated-off opt-in hooks on every tool call

**Implementation**

Replace the 16 opt-in event registrations with one canonical multiplexer per event. Each process
reads the manifest and effective config once, then invokes only enabled handlers. Remove the direct
opt-in registrations rather than keeping dual wiring. Record before/after latency and process-count
evidence, but do not use lack of telemetry as a reason to defer the known disabled-process spawn.

**Acceptance**

- A disabled opt-in handler starts no child process; an enabled handler preserves payload, order,
  exit/fail-open semantics, and event membership.
- The 15 unique hooks and the two-event `mcp-health` membership remain inventory-correct.
- A deterministic benchmark records cold and heavy-session before/after latency with no regression
  for the enabled path.

```bash
bash hooks/tests/check-hook-inventory.test.sh
bash hooks/tests/hook-handlers.test.sh
bash hooks/tests/all-hooks-fail-open.test.sh
node scripts/check-hook-inventory.js --check
```

## D7 — Verification-strength scorer and routing input

**Backlog entry**: `verify_strength` as the third density input — decomposed into ordered precursors

**Owner design**: [`2026-07-09-verify-strength-precursors.md`](2026-07-09-verify-strength-precursors.md)
Segments 2 and 3. Do not duplicate Segment 1, which is already shipped.

**Implementation**

Build and calibrate the deterministic real-suite strength scorer, then consume its ordinal in the
review-loop resolver. Unknown or inconclusive evidence takes the weakest/safest route; a strong
score may reduce review only when the frozen calibration supports it.

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

**Backlog entry**: grok implementer 摩擦調校（toolFailure 28%／零 commit 72%／effort 反效果假說）

**Implementation**

Run a paired randomized-crossover A/B across the current Grok effort choices using the normal
`dispatch-hetero.sh` write path. Before any call, commit a 30-task minimum corpus, arm-order seed,
exclusion rules, primary endpoint, equivalence margin, and a capacity receipt reserving the full
120-session ceiling plus bounded transport retries. Capture tool failures, wrapper commit success,
repair generations, wall time,
and independent quality verdicts. Extend once to the pre-frozen ceiling of 60 paired tasks when the
minimum sample is indeterminate; no further ad-hoc sampling is allowed.

**Acceptance**

- The task corpus, randomized arm order, sample exclusions, primary endpoint, ±10 percentage-point
  equivalence margin, and 95% paired-bootstrap interval are frozen before results are read.
- Both arms run the same 30 paired tasks (60 sessions); if the interval cannot support superiority
  or equivalence, the pre-frozen extension runs up to 60 pairs. Missing Grok capacity blocks
  admission before spend rather than shrinking the sample after results are visible.
- `tune` requires the interval to support a material primary-endpoint improvement with no quality
  non-inferiority breach. `no-change` requires the full interval inside the equivalence margin. A
  still-indeterminate 60-pair result escalates and leaves D8 open; it cannot close calibration.
- A schema-validated durable report records the decision and evidence; any config change has
  resolver/dispatch regression coverage.

```bash
bash scripts/run-grok-implementer-ab.sh --tasks evals/grok-implementer-ab/tasks.json --report .autopilot/evidence/grok-implementer-ab.json
node scripts/validate-grok-implementer-ab.js --report .autopilot/evidence/grok-implementer-ab.json
bash hooks/tests/dispatch-hetero.test.sh
bash hooks/tests/resolve-dispatch.test.sh
```

## Integrated completion gate

After D8 is committed to the cumulative branch, freeze `base_sha` and `candidate_sha`, run the full
deterministic suite once, then one independent cross-cutting review over exactly
`base_sha..candidate_sha`. Repairs stay on the same cumulative branch, resume the source
deliverable's implementer transcript, and produce a new frozen candidate SHA. Only after that
base-bound review is green may the branch integrate once into `develop`, doc-sync remove the 14
backlog entries, and project lifecycle archive this plan.

```bash
bash scripts/sync-all.sh --check
bash scripts/validate.sh
bash hooks/tests/run.sh
node scripts/doc-drift-gate.js .
git diff --check
```

## Risks

- D3 and D4 touch process/framing trust boundaries; false-green acceptance is worse than a
  fail-closed unavailable runner.
- D6 can replace process overhead with a long-lived correctness hotspot; event membership and
  fail-open behavior need executable parity, not prose review.
- D7 can under-review changes if calibration is optimistic; unknown and inconclusive signals must
  take the safest route.
- D8 is vulnerable to task-difficulty selection bias; freeze and randomize before reading results.

## Out of scope

- The two Board decisions (Fable absorption and Tree graduation).
- The 32 entries whose trigger depends on an upstream platform contract, a real incident/sample
  threshold, a new runner/consumer, or an expanded threat model.
- Version bump, release, push, and external publication.

## Open questions

None. The owner decision that opportunistic next-touch clauses are not valid deferral conditions
settles admission; evidence gates inside D4, D6, D7, and D8 decide implementation details, not
whether those deliverables run.
