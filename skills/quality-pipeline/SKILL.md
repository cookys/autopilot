---
name: quality-pipeline
description: >
  Unified quality gate — test, scan, completeness check, code review. Triggered by dev-flow
  before commit (S) or merge (L). Reads project config for specific commands.
---

# Quality Pipeline (Unified Quality Gate)

**Pipeline is a dispatcher. Each step follows its reference doc.**

## Project Config (auto-injected)
!`cat .claude/quality-gate-config.md 2>/dev/null || echo "_No config — using defaults: lint + test before commit._"`

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

```
Follow references/code-review.md (via superpowers:code-reviewer subagent)
  → Critical/Important? → fix → re-review (repeat until clean)
  → Suggestion/Minor? → dispatch analysis (see references/code-review.md)
  → LGTM? → pass
```

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
- `autopilot:dev-flow` — dispatches pipeline (decides which route)
