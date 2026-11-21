# The outcome gate cannot read a full-suite record (BL-0390)

Source: PM, 2026-11-04/05 (approved).

## Problem
- `scripts/check-test-outcome.js` (the pre-push outcome gate) reads only the record that `affected-suites.js --run --record` writes at `qc-runs/<full-sha>.json`.
- A `tools/migrate/suite-baseline.js record` file for the same sha is ignored, so a merge verified by the full suite under the old operator rule d-a62f4abc still needed a second, partial affected-suites run to pass the gate. PM ruling 2026-11-21 on task 01M7XRRV (operator 11-21) supersedes that rule: pre-merge runs only the fast tier (`node scripts/affected-suites.js --base <develop> --head <merge-sha> --fast --run`); a selection of half or more no longer escalates to a pre-merge full suite. The full affected run is post-merge (`scripts/post-merge-suite.sh`). The full suite before a release tag is unchanged.

## Fix (PM approved)
- Make the gate accept the suite-baseline record, or make `suite-baseline.js record` also write the `qc-runs/<sha>.json` shape.

## Notes
- Trigger: PM dispatch. Effort S.
- Until fixed, `skills/quality-pipeline/references/test-policy.md` tells the merger to run both.
