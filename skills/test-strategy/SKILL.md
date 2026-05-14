---
name: test-strategy
description: Testing strategy and baseline management. Invoke when writing tests or validating changes.
---

# Test Strategy

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
