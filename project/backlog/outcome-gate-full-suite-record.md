# The outcome gate cannot read a full-suite record (BL-0390)

Source: PM, 2026-11-04/05 (approved).

## Problem
- `scripts/check-test-outcome.js` (the pre-push outcome gate) reads only the record that `affected-suites.js --run --record` writes at `qc-runs/<full-sha>.json`.
- A `tools/migrate/suite-baseline.js record` file for the same sha is ignored, so a merge verified by the full suite (operator rule d-a62f4abc) still needs a second, partial affected-suites run to pass the gate.

## Fix (PM approved)
- Make the gate accept the suite-baseline record, or make `suite-baseline.js record` also write the `qc-runs/<sha>.json` shape.

## Notes
- Trigger: PM dispatch. Effort S.
- Until fixed, `skills/quality-pipeline/references/test-policy.md` tells the merger to run both.
