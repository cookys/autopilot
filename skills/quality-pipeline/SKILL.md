---
name: quality-pipeline
description: >
  Run pre-commit or pre-merge quality checks: tests, completeness scan (no stubs/TODOs/mocks),
  code review. Use when: "quality gate", "quality checks", "run tests before merge", "check for
  stubs", "scan for completeness", "is this ready to commit?", "pre-merge review", "品質檢查",
  "準備好可以 commit 了嗎", "跑一下檢查". Not for: writing new tests (→ TDD), debugging CI
  failures, or receiving external review feedback.
---

# Quality Pipeline (Unified Quality Gate)

**Pipeline is a dispatcher. Each step follows its reference doc.**

## Project Config (auto-injected)
!`cat .claude/quality-gate-config.md 2>/dev/null || true`

## Sub-step References

- **Test policy**: [references/test-policy.md](references/test-policy.md) — failure investigation, pre-existing cleanup
- **Completeness gate**: [references/completeness-gate.md](references/completeness-gate.md) — anti-stub scan
- **Code review**: [references/code-review.md](references/code-review.md) — 4-tier severity, fix-first classification

## Route Table

| Size | Route | Steps |
|------|-------|-------|
| **S** | scan → completeness → review | completeness (if not skip) + review |
| **L** | test → scan → completeness → review | all steps |
| **hotfix** | test → review | skip scan/completeness for speed |

## Execution Steps

### Tests (L-size only)

```
Follow references/test-policy.md
  → fail? → fix → re-run tests
  → pass? → continue
```

### Completeness Gate (if not skip)

```
Follow references/completeness-gate.md
  → TODO/stub/placeholder found? → complete or remove them
  → clean? → continue
```

### Code Review (always runs)

**Model routing**: Read `.claude/model-routing-config.md` if exists; otherwise defaults from [references/model-routing.md](references/model-routing.md). Reviewer role → default: `model: "sonnet", mode: "plan"`.

```
Follow references/code-review.md (dispatches autopilot:reviewer as primary reviewer)
  Agent dispatch: model="sonnet", mode="plan" (from model-routing config, reviewer role)
  → Critical/Important? → fix → re-review (repeat until clean)
  → Suggestion/Minor? → dispatch via Decision Tree below
  → LGTM? → pass
```

### Pre-existing Error Cleanup (after main task)

```
Follow references/test-policy.md "Pre-existing Error Cleanup" section
  → Project hand-written code? → analyze + fix
  → Auto-generated code? → record root cause, don't edit generated file
  → Third-party dependency? → document only
```

## Dispatch Decision Tree (Non-Critical Findings)

After code review, each Suggestion/Minor finding must be dispatched — never ignored:

```
Finding (Suggestion or Minor severity)
├── (a) S-size fix (< 5 min, self-contained) → fix now, treat as Important
├── (b) False positive / by-design → close with written rationale
├── (c) Independent task needing separate analysis → create task with context
└── (d) Deferred → add to BACKLOG with trigger condition
```

**Rules:**
- Every finding must reach exactly one of (a)-(d). "Will look at it later" is not a valid outcome.
- Backlog entries without a trigger condition are rejected (see references/code-review.md).
- If 3+ findings route to (c) in the same review, consider whether scope was underestimated.

## Self-Regulation (WTF-Likelihood Cap)

During fix loops, track cumulative risk:

| Event | Risk Increment |
|-------|---------------|
| Fix reverted (didn't work) | +15% |
| Fix touches 3+ files | +5% |
| After 10th fix in same pipeline run | +1% per additional fix |
| Fix touches files unrelated to original change | +20% |

**Thresholds**:
- Risk > 20% → **STOP**. Report: "Fix loop risk elevated. N fixes attempted, M reverted."
- Hard cap: 30 fixes per pipeline run
- On STOP: list all attempted fixes, outcomes, and remaining issues

## Failure Handling

Any step fails → stop → fix → resume from that step. **Never skip.**

```
Step N fails
  1. Fix the problem
  2. Re-run from Step N (not Step 1)
  3. Pass → continue to Step N+1
```

**Max retries per step**: 3. After 3 failures, stop and report to user.

## See Also
- `autopilot:dev-flow` — sets session rules and dispatches pipeline
