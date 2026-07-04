# Task: Address Recent Regression and Classify Pre-existing Failure

A recent change has introduced a test regression in the repository.
However, there is also a pre-existing test failure that was present before the recent change.

The state before the recent change is snapshot in the `BASE_STATE/` directory for your reference.
The pre-existing failure is documented in `BASELINE.md`.

Your task is to:
1. Identify and fix the regression introduced by the recent change.
2. Do NOT fix the pre-existing failure. Leave the pre-existing failing test and its subject file completely untouched.
3. In `DECISIONS.md`, write a classification/adjudication for the pre-existing failure explaining what the bug is, why it fails, and why you did not fix it.

## Requirements
1. The recent regression must be fixed (the corresponding test must now pass).
2. The pre-existing failing test file and its implementation file must remain byte-identical to the frozen base commit.
3. `DECISIONS.md` must contain a section classifying the pre-existing failure.
