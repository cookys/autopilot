---
name: test-strategy
description: Testing strategy and baseline management — test pyramid placement, baseline守則, failure investigation funnel, regression scoping, flaky-test systemic handling. Invoke when validating changes or designing test approach. Not for: TDD red-green-refactor coding cycle (→ superpowers:test-driven-development if installed; this skill is orthogonal — see Coexistence section), specific test debugging (→ debug), or quality gate (→ quality-pipeline).
---

# Test Strategy

## Coexistence with Superpowers

This skill is autopilot's standalone fallback for testing methodology. If the `superpowers` plugin is installed, `superpowers:test-driven-development` is available — note these are **NOT equivalent**.

Differences worth knowing:

- **TDD ≠ test-strategy.** `superpowers:test-driven-development` focuses on the「先寫測試再寫實作」red-green-refactor cycle. **autopilot:test-strategy** covers test pyramid, baseline 守則, failure investigation funnel — orthogonal scope.
- If you want both, use them together: TDD as the *coding loop*, test-strategy as the *strategy frame*. `.claude/dispatch-config.md`'s `## Testing methodology` chain controls orchestrator preference.

<!-- Project-specific config (test commands, framework, conventions) -->
!`cat .claude/test-strategy-config.md 2>/dev/null || echo "No project-specific test config found. Using generic defaults."`

## Test Pyramid

Unit (frequent, per build) > E2E (per feature) > Stress (pre-release, rare)

## Test Categories

| Type | Purpose | When | Scope |
|------|---------|------|-------|
| Unit | Logic correctness | Every build | Single function/class |
| E2E | System integration | Per feature / nightly | Full stack |
| Stress | Capacity limits | Before release | System under load |
| Regression | No breakage | Every PR | Affected modules |

---

## Baseline Principle

**Run tests BEFORE and AFTER changes. New failures = your regression.**

If baseline is not green: record pre-existing failures, fix if in your area, document if unrelated, never add new failures on top.

---

## Test Failure Investigation

```
Tests fail?
+-- Stop implementation immediately
+-- Investigate root cause:
|   +-- Test bug?                    -> fix the test
|   +-- Code bug (your changes)?    -> fix the code
|   +-- Pre-existing?               -> verify with git stash + re-run
+-- Fix and re-run until all pass
+-- Report: count, names, root cause classification, resolution
```

**Never**: skip failures, comment out tests, commit with red tests, assume "pre-existing" without stash-verify.

---

## Feature Flag Levels

| Level | Mode | Rollback |
|-------|------|----------|
| 0 | Legacy only | N/A |
| 1 | Dual mode, old default | Disable flag |
| 2 | Dual mode, new default | Flip to level 1 |
| 3 | New only, flag removed | Revert commit |

Use when: changing core business logic, replacing algorithms, instant rollback needed.

---

## When to Write Tests

| Situation | Test Type |
|-----------|----------|
| New function/class | Unit test |
| Bug fix | Regression test (reproduces the bug) |
| New feature | Unit + E2E |
| Refactoring | Ensure existing tests pass |
| Performance concern | Benchmark / stress test |

---

## Test Quality Checklist

- [ ] Assert behavior, not implementation details
- [ ] Clear failure messages
- [ ] Independent (no order dependency)
- [ ] Deterministic (no flaky random failures)
- [ ] Negative cases covered
- [ ] Edge cases covered (empty, max, concurrent)

## See Also

- `autopilot:dev-flow` — invokes test commands during quality gate
- `autopilot:quality-pipeline` — orchestrates test → scan → completeness → review
- `autopilot:learn` — record test-strategy findings (flaky tests, baseline patterns)
- `superpowers:test-driven-development` (if installed) — complementary, not equivalent (see Coexistence section)
