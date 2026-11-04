# suite-baseline run-all does not rerun a red serial suite alone (BL-0392)

Source: PM, 2026-11-05 (approved).

## Problem
- `tools/migrate/suite-baseline.js run-all` reruns a pool-red suite alone, but a suite listed in `hooks/tests/lib/serial-suites.txt` is not rerun.
- 2026-11-05: `hooks/bash-launch-guard.test.js` went red on 3 recipe cases that wait a fixed 4 s for detached results, under host load; the same suite was green alone at the same tree, yet it read as a regression.

## Fix (PM approved)
- Rerun a red serial suite alone, the same way as a pool suite, and print the same `flaky-under-parallel:` / `red-in-both-runs:` lines.
- Review that test's fixed 4 s wait: derive it from load or widen it.

## Notes
- Trigger: PM dispatch. Effort S.
