# suite-baseline run-all is serial, full run about 9 hours (BL-0353)

## Evidence
- tools/migrate/suite-baseline.js run-all runs one suite at a time.
- 2026-10-31 on 19e2511fa: 2.5 hours finished 201 of 727 suites; projected total about 9 hours.
- Relayout P1 to P5 each compare against the full baseline, so each phase would wait 9 hours.

## Fix direction
- Add `--jobs N` to run-all, reusing the serial list `hooks/tests/lib/serial-suites.txt` the way hooks/tests/run.sh does: listed suites run one at a time, the rest in parallel.
- Or accept the output format of `affected-suites.js --run --jobs`, which `record` already supports.
- Equivalence: run the same commit once parallel and once serial; compare every suite's rc and assertion count between the two.
- Negative control: a suite on the serial list must never overlap another suite (show red before green).

## Trigger
Must land before relayout P1 starts. Efficiency work jumps the queue (owner rule).
