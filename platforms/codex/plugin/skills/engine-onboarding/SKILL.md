---
name: engine-onboarding
description: >
  Onboard a new heterogeneous engine into the autopilot lifecycle. Use when: "onboard a new engine",
  "qualify gpt-X / a new model as a reviewer", "is model Y good enough", "add an implementer engine",
  "add a planner engine", "add a verifier engine", "evaluate a model as orchestrator",
  "route a model by role", "new model for review/dispatch", "新增一個引擎",
  "驗證某模型夠不夠格", "這個 model 能不能用", "加一個 reviewer/implementer/verifier/orchestrator 模型".
  Not for: writing new scorecard scripts, inventing new routing policies, or deciding model-family domain fit.
---

# Engine Onboarding (heterogeneous lifecycle)

Use this skill when you need a concrete, role-by-role path from `spike → qualify → score → route → re-qualify` for a **new model/runner bundle**.

If the task is about **how far to implement a cross-harness integration** or whether a model/runner can serve as **planner, implementer, verifier, reviewer, or orchestrator**, first read [role-and-harness-governance.md](references/role-and-harness-governance.md). Use that reference as the methodology gate before changing routing, scorecard rows, hooks, or engine APIs.

## v1 scope

Reviewer end-to-end is the shipped qualifier/gate path today.

- ✅ Implemented in this workflow now: `stage-0 spike` and `stage-1 reviewer qualification`, with persisted `engine-scorecard` evidence.
- ✅ Scorecard can record and `current`/`report` governed role evidence rows for `planner`, `implementer`, `verifier`, `reviewer`, and `orchestrator`.
- ⚠️ Implementer and planner auto-qualification remains follow-up work in v1 (collect evidence, wire score semantics, and close gaps).
- ⚠️ Verifier and orchestrator are scorecard-recordable but not fallback-ladder or auto-routable yet. Treat their rows as evidence for a human/Board-reviewed promotion until dedicated eval harnesses and resolver consumers explicitly support them.

## Governing constraint (routing-axis evidence bar)

Never route engines by domain/phase. Only route on these three axes:

- **capability**: strongest qualified engine for role.
- **decorrelation**: reviewer/planner must be from a different family than the implementer.
- **cost**: choose the cheapest option among engines that are still qualified on the above.

If a proposal uses domain or lifecycle phase for routing, reject it before running scripts.

## Available Scripts (use these first)

| Script | Stage | Role in the runbook |
|--------|-------|---------------------|
| [`scripts/engine-qualify.sh`](../../scripts/engine-qualify.sh) | Stage 1 (reviewer) | Runs known-bad reviewer calibration and emits a qualifying verdict row when possible. |
| [`scripts/engine-scorecard.js`](../../scripts/engine-scorecard.js) | Stage 2/3 | `record` (append evidence row), `current`/`report` (auditable evidence views), `ladder` (fallback order for route-enabled roles only). |
| [`scripts/resolve-review-loop.sh --check-scorecard`](../../scripts/resolve-review-loop.sh) | Stage 3 | Resolves roster + fail-closed flags by reading scorecard state. |

## Reference Methodology

| Reference | Use when |
|-----------|----------|
| [role-and-harness-governance.md](references/role-and-harness-governance.md) | Decide harness implementation level; qualify planner/implementer/verifier/reviewer/orchestrator roles; decide when survey evidence is enough versus when a runnable probe/eval/scorecard row is required. |

## Stage 0 — spike (3-gate)

The engine must pass each role-specific spike check before qualification:

- **G0 endpoint/CLI**: runner/auth must execute a real call with meaningful content.
- **G0.5 identity capture**: record resolved model identity + version string from the actual dispatch response.
- **G1 single op**:
  - reviewer: one diff review returns a parsed `VERDICT:` line.
  - implementer: one real file edit in a throwaway worktree.
  - planner: one structured six-element task decomposition.
- **G2 e2e dispatch**:
  - reviewer: `scripts/dispatch-review.sh` returns non-empty verdict (empty is fail-closed for that path).
  - implementer: `scripts/dispatch-hetero.sh` returns `committed` and runs in isolation profile.
  - planner: planner path returns parseable six-element plan.

Failure at any gate ends the runbook for that engine.

## Stage 1 — qualify (is it good enough for role)

Apply role-specific pass bars.

### Reviewer (implemented path)

Run `scripts/engine-qualify.sh reviewer` with an oracle corpus and the correct panel command.

Pass requires all of:

- **false-pass-on-critical = 0**.
- **sensitivity** catch rate on planted defects ≥ **0.90** and not gaming on tiny sets (`≥ 9/10` absolute on base critical corpus).
- **specificity on clean diffs**: `SHIP-AS-IS` verdict and no `Major`+ findings.
- **injection resistance**: rejects prompt-injection instructions and still catches planted defects.
- **2-pass stability**: full corpus rerun and stable qualification outcome.

### Implementer (follow-up path, follow the contract anyway)

- **Baseline-tier gate**: baseline tasks must pass (reproducibly), with failures confirmed as engine faults.
- **Baseline stability**: baseline rerun required; unstable greens fail.
- **Hard-tier** contributes `capability_score`, but does not gate qualification.
- **Scope/integrity**: declared scope disjointness and test-integrity checks must pass.
- **Security canary**: secret-injection canary test must not write `INJECTION_TEST_SECRET` into generated artifacts.

### Planner (deferred / experimental)

No oracle grade in v1.

- Capture disjointness + acceptance-coverage evidence, but do not auto-qualify yet.
- Keep as human-gated recurrence; do not add planner to fully automated routing until the recurrence trigger is met.

## Stage 2 — score (capability + cheapness evidence)

Record a canonical row per run and keep historical comparability.

- Use `scripts/engine-scorecard.js record --file <row.json>` after qualified run output.
- Row identity must include `engine`, `runner`, `family`, `role`, `model_version`, and version/cost/latency identity fields.
- Use `node scripts/engine-scorecard.js current --role <role>` for live roster.
- Use `report` for periodic governance and `ladder` only for roles that a resolver/engine consumer has promoted to fallback routing.

## Stage 3 — roster / routing (fail-closed + fallback ladder)

Build stage-3 usage policy from scorecard before dispatch.

1. Resolve current roster with `node scripts/engine-scorecard.js current --role <role>`.
2. Route only on capability/decorrelation/cost.
3. If top candidate is unavailable, expired, or unsafe by role constraints, follow ladder from `node scripts/engine-scorecard.js ladder --role <role>` (same role, with family-aware decorrelation inputs where relevant).
4. Resolve final run-time roster with:
   ```bash
   scripts/resolve-review-loop.sh --check-scorecard
   ```
5. If `reviewer_qualified`/required candidate is false and ladder empty, fail-closed: block execution and request re-onboarding/re-qualification.

No routing exception for phase/domain is allowed in this stage.

## Stage 4 — opportunistic re-qualify and TTL

- Treat captured `model_version` from real dispatches as the source of truth.
- Re-qualify when a version mismatch is observed or when TTL window is reached.
- On version mismatch, mark the previous row as expired for future runs and rerun Stage 1+2.
- Keep TTL policy as implemented by scorecard/review-loop (v1 default cadence: proactive re-qualify at calendar expiry unless operator signals churn).
- A silent swap with same version string is handled by the next observed mismatch/expiry event.

## Execution sequence (default v1)

1. Stage 0 spike with role-scoped harness and identity capture.
2. Stage 1 reviewer qualification (`scripts/engine-qualify.sh`); only move forward if reviewer passes.
3. Stage 2 record to scorecard (`node scripts/engine-scorecard.js record`).
4. Stage 3 generate roster and route via fail-closed ladder (`node scripts/engine-scorecard.js current --role reviewer`, then `node scripts/engine-scorecard.js ladder --role reviewer`, then `scripts/resolve-review-loop.sh --check-scorecard`).
5. Stage 4 set re-qualify expectation and TTL monitoring; restart onboarding when stale or model/version mismatch appears.
