# WLB Phase 0 — RED Lifecycle Oracle

> RED: `32e10d0..7bc9cad`
>
> Status: READY

## Frozen Boundary

Phase 0 owns only the failure oracle and retained-state fixtures. It does not implement the
occupancy lock, lifecycle controller, branch disposition, or residue receipt.

The oracle requires:

1. Four retained same-root leaves fill the default budget.
2. A fifth sequential creator is rejected before branch/worktree creation.
3. Eight concurrent creators yield exactly four admissions and four budget rejections.
4. Clean, dirty, live, unsupported-lock, malformed, legacy, pending, and custom-branch states can
   be constructed without touching a real provider.

## RED Evidence

At `7bc9cad`, `bash hooks/tests/dispatch-worktree-lifecycle.test.sh` produced 28 passing and 10
failing assertions. The failures were the intended behavior gaps: the fifth leaf was admitted,
all eight concurrent creators passed, and rejected creators leaked branch/worktree state. Fixture
construction itself passed.

The WLB review panel mapped each failure to Phase 1 ownership and found no import, setup, provider,
or unrelated test failure masquerading as RED evidence. Phase 1 later turns the same oracle green;
P2/P3's missing receipt surface remains an explicit non-failing evidence line.

## Final Verdict

`READY`. The RED is behavioral, deterministic, provider-free, and scoped to the missing
race-safe occupancy transaction.
