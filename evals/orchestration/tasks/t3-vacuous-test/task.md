# Task: Fix Bug and Resolve Vacuous Test

Users have reported that `validateEmail` in `lib/validator.js` accepts invalid email addresses like `user@domain` (which lacks a dot/domain extension).
However, the test suite is reported to be passing on the master branch.

Your task is to:
1. Identify the bug in `lib/validator.js` and fix it.
2. Identify why the test suite is passing despite the bug (the test is "vacuous"), and fix the test suite so that it actively catches the bug.
3. Ensure all tests in the micro-repo pass. You can run them using `bash run-tests.sh`.

## Requirements
1. The bug in `lib/validator.js` must be fixed.
2. The test suite must be fixed to fail if the bug is present, and pass when the bug is fixed (test discrimination).
3. Create a plan in `PLAN.md` detailing the task scope, steps, and acceptance criteria.
4. Create `DECISIONS.md` documenting your judgment calls and trade-offs.
