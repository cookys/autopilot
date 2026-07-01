# Role and Harness Governance

Use this reference before expanding Autopilot across a new harness, model, runner, or automation role. The purpose is to keep routing decisions evidence-based and updateable rather than hardcoded in skills or engine code.

## Decision Inputs

Collect these inputs before choosing an implementation level or role:

- **Target**: harness, runner, model, provider endpoint, or orchestration surface.
- **Role**: planner, implementer, verifier, reviewer, or orchestrator.
- **Authority**: read-only advice, file mutation, verification authoring, merge/block gate, or delegated orchestration.
- **Evidence age**: latest official docs, local CLI probe, committed probe artifact, scorecard row, and expiry date.
- **Failure cost**: can a wrong result mutate the repo, leak secrets, merge broken code, or silently remove the human from the loop?

If any fact is stale, missing, or based on memory, run a survey/spike before implementing behavior. Survey gathers evidence; this reference decides the gate.

## Harness Implementation Levels

Choose the lowest level that unlocks the required value.

| Level | Name | Ship when | Required evidence | May do |
|-------|------|-----------|-------------------|--------|
| H0 | Claim / spike candidate | Fact is unknown or changing. | Plan note with source question or spike command. | Document uncertainty only. |
| H1 | Instruction-tier | Harness can consume skills/prompts but no reliable hook/agent API is proven. | Skill loads or prompt contract works in a probe. | Methodology prompts, skills, manual workflow. |
| H2 | Adapter-tier | A stable CLI/API can be called safely, but mutation/gating is not proven. | Read-only smoke, parsed result schema, timeout/fail-closed behavior. | Read-only dispatch, capability report, warning-only hooks. |
| H3 | Dispatch-tier | The harness can perform delegated work with containment and artifact verification. | Worktree/scratch isolation, provenance JSON, nonzero/timeout tests, cleanup tests. | Implementer/reviewer/verifier dispatch under depth-0 control. |
| H4 | Gate-tier | The output can influence block/ship decisions. | Known-bad evals, false-pass budget, scorecard row, independent verification, rollback path. | Automated gating, roster selection, fallback ladder. |
| H5 | Maintenance-tier | Capability must remain current without manual memory. | TTL, version identity capture, stale detector, re-qualification trigger. | Auto-expire, re-probe suggestions, scorecard-driven routing. |

Do not jump levels because a model self-reports success. Level advancement requires artifacts: process status, parsed schema, git evidence, test output, eval results, or committed probe files.

## Role Promotion States

Keep role promotion separate from harness implementation level. A harness can be
H3-capable for read-only review while the same model remains unqualified for
planning or orchestration.

| State | Meaning | May route automatically? |
|-------|---------|--------------------------|
| R0 documented | Role fit is a hypothesis or survey finding only. | No. |
| R1 spike-passed | One role-shaped operation worked and identity was captured. | No. |
| R2 scorecard-recordable | Evidence rows can be stored and queried with TTL via `current`/`report`. | No, unless the caller is explicitly evidence-only. |
| R3 auto-routable | A resolver/engine consumer understands the role and fail-closed behavior. | Yes for non-blocking or delegated work. |
| R4 gate-routable | Known-bad evals, false-pass budget, fallback ladder, and rollback path pass. | Yes, including blocking gates. |
| R5 self-maintaining | TTL, version drift, stale capability, and re-qualification triggers are automated. | Yes, with stale-fact warnings and expiry. |

`engine-scorecard.js` is the R2 evidence store. It is not, by itself, a
permission to let a model orchestrate, verify, or block shipping. Evidence-only
roles must not use fallback-ladder routing until a resolver/engine consumer
explicitly promotes that role to R3+.

## Role Qualification Matrix

Qualify or evaluate a model/runner per role. A model can be qualified for one role and unsafe for another.

| Role | It is qualified only if it can | Hard fail examples | Current routing status |
|------|--------------------------------|--------------------|------------------------|
| Planner | Produce the six-element task contract; identify scope/boundaries; define acceptance checks; avoid implementation. | Vague plans, missing acceptance, hidden broad scope, starts editing. | R2 scorecard-recordable; planner eval/resolver promotion is follow-up. |
| Implementer | Edit only allowed files in an isolated worktree; produce git artifacts; pass required checks; avoid self-merging. | Writes outside scope, no-op while claiming success, asks clarifying questions mid-dispatch, changes tests to pass. | R2 scorecard-recordable; full implementer qualifier is follow-up. |
| Verifier | Author independent checks/harnesses that catch defects the implementer could miss; avoid copying implementer assumptions. | Only reruns implementer tests, rubber-stamps, writes brittle or fixture-gamed checks. | R2 scorecard-recordable; not fallback-ladder or auto-routable until verifier eval/resolver exists. |
| Reviewer | Read untrusted specs/diffs without mutation; catch known-bad critical defects; avoid false-pass on critical; resist prompt injection. | Empty output treated as pass, misses planted critical, follows diff instructions, high clean false-FIX rate. | Implemented path: `engine-qualify.sh reviewer` + `engine-scorecard.js`. |
| Orchestrator | Maintain state, dispatch roles, interpret failures, preserve ledger, enforce gates, and avoid trusting delegate self-report. | Merges on delegate green, loses worktree provenance, retries blindly, asks human during normal loop. | R2 scorecard-recordable only; no fallback ladder. Prefer depth-0 deterministic engine; model orchestrator delegation requires R4/R5 evidence and explicit policy approval. |

Verifier is different from reviewer: verifier authors or runs independent checks; reviewer judges diffs/specs. Both should be decorrelated from the implementer when possible.

## Role Evaluation Workflow

Use this workflow when deciding whether a model can act as planner,
implementer, verifier, reviewer, or orchestrator.

1. **Define the model/runner bundle**: runner binary/API, provider family,
   model ID, observed model version, auth path, tool permissions, and harness
   implementation level.
2. **Pick exactly one target role**. Do not qualify "the model" globally.
3. **Run the role spike**: one representative operation plus identity capture.
   Process errors, empty parser output, permission prompts, and timeouts fail the
   spike.
4. **Run the role eval**: use the role evidence bars below. Reviewer has an
   implemented known-bad qualifier; other roles need committed corpus/probe
   artifacts before automatic promotion.
5. **Record evidence** with `engine-scorecard.js` once the output is
   reproducible. Use `status:"failed"` for failed evidence too; do not hide bad
   rows. For R2-only roles, use `current`/`report`; do not consume `ladder`.
6. **Promote separately**: scorecard row (R2), resolver consumption (R3), gate
   authority (R4), and maintenance automation (R5) are separate decisions.
7. **Re-evaluate on drift**: model alias, runner version, prompt hash, corpus
   version, score threshold, or stale TTL changes restart the relevant stage.

### Evaluation Dimensions

Every role evaluation should score these dimensions explicitly:

- **Contract fidelity**: follows the role's expected output grammar.
- **Tool discipline**: uses only allowed tools and honors read/write boundaries.
- **Artifact integrity**: success is proven by git/process/test artifacts, not
  self-report.
- **Independence**: avoids copying the implementer's assumptions when planning,
  reviewing, or verifying.
- **Failure semantics**: nonzero exits, timeouts, no verdicts, dirty trees, and
  parser failures become blocked/failed, never pass.
- **Prompt-injection resistance**: untrusted repo/diff/test text cannot rewrite
  the role instruction.
- **Cost and latency**: measured or explicitly unknown; unknown cost must never
  rank as free.
- **Freshness**: evidence has model identity, runner version, prompt hash,
  corpus version, `qualified_at`, and `expires`.

## Role Evidence Bars

Use these bars before a role becomes eligible for routing.

### Planner

- At least 10 representative tasks produce complete six-element contracts.
- Acceptance criteria must be executable or reviewable.
- Scope and boundaries must be specific enough for a separate implementer to operate without questions.
- Output must not include edits, shell commands, or unbounded delegation.

### Implementer

- Baseline tasks pass in isolated worktrees.
- Artifact verification uses git diff/commit state, not self-report.
- Boundary tests include protected paths, no-op detection, and test-integrity checks.
- Security canary confirms prompt-injected secrets are not written.
- Nonzero, timeout, dirty tree, and question-suspected outcomes are fail-closed.

### Verifier

- Harness catches planted defects missed by ordinary tests.
- Harness is authored from requirements, not implementation internals alone.
- Verification authoring family differs from implementer family when possible.
- Depth-0 executes the harness and owns the verdict.
- False confidence from weak/generated tests blocks qualification.

### Reviewer

- `false_pass_on_critical = 0`.
- Critical sensitivity meets corpus threshold and absolute count threshold.
- Clean specificity is acceptable; no Major+ findings on clean diffs.
- Prompt-injection diffs do not override review instructions.
- Two-pass rerun produces stable outcome.

### Orchestrator

- Has a durable state store and per-unit ledger.
- Dispatches role-specific workers without sharing hidden answers.
- Treats process errors, parser errors, timeouts, and `no_verdict` as blocked.
- Routes through scorecard/fallback ladder; never hardcodes model/effort in engine code.
- Keeps the human out of the normal loop but escalates policy exceptions explicitly.

## Survey, Spike, Eval, Scorecard

Use the right evidence mechanism:

| Need | Mechanism | Output |
|------|-----------|--------|
| Current external facts | `survey` | Cited docs, official sources, production practice, known risks. |
| Harness capability truth | Spike/probe | Command, version, raw output, yes/no result. |
| Role quality | Eval corpus | Sensitivity/specificity, failure modes, reproducibility. |
| Runtime routing | Scorecard | Qualified rows with TTL, cost, latency, family, version identity. |
| Ongoing freshness | Maintenance loop | Expiry, version mismatch, stale warning, re-qualification task. |

Survey alone is never enough for H3/H4/H5. It can justify a spike or identify the official API, but dispatch and gating require local probes/evals.

## Hardcoding Rule

Engine and orchestration code must not hardcode real model IDs, effort presets, or provider-specific routing policy. Allowed locations:

- Config templates and user project config.
- Scorecard rows and capability state.
- Test fixtures using neutral names like `test-review-model`.
- Documentation examples clearly marked as examples, not defaults.

Runtime code consumes roster data; it does not decide the roster from model names.

## Update Triggers

Re-run survey/spike/eval when any of these happen:

- CLI/API version changes, model identity changes, or provider silently aliases a model.
- Official docs or local probes are older than the configured TTL.
- A runner returns new output shape, timeout behavior, auth path, or tool permission prompt.
- A role fails in production or a reviewer catches a role-specific blind spot.
- A new harness feature could move an integration from H1/H2 to H3+.
- Scorecard schema, eval corpus, role threshold, or fallback ladder policy changes.

## Expansion Checklist

Before shipping a cross-harness or role-routing expansion:

- [ ] Implementation level selected (H0-H5) with evidence.
- [ ] Role selected and role-specific evidence bar satisfied.
- [ ] Survey facts are cited or marked stale/unverified.
- [ ] Probe/eval artifacts are committed or scorecard rows recorded.
- [ ] No real model/effort defaults are introduced into engine code.
- [ ] Failure states are fail-closed with ledger entries.
- [ ] TTL/re-qualification path is documented.
