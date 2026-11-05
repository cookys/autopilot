# dispatch-author-kill-after: time bounds do not hold on a loaded host (BL-0400)

Source: PM via fleet, 2026-11-05. Related: BL-0397 (pool-only red, cause unknown).

## Evidence
- Red alone, not in a pool, at both 63308bd8f and the W tree of 8c0d36273, host load 40-43. Four runs, 2026-11-05 10:25-10:30 Taipei, each "12 passed, 4 failed".
- The four failing assertions are the "returns within timeout+grace+slack" and "stub finishes fast" checks; they measured 9-15 s against the 12 s and 8 s windows.

## Fix direction
- Do not just widen the numbers. Redesign the bound: assert the kill happened by observing the process (child gone after timeout plus grace, via the stub's own marker or a pid check) instead of wall time, or scale the bound by a baseline measured in the same run (a no-op stub timing) plus the timing factor.
- Keep a negative control: a stub that ignores the kill must still turn the test red.
