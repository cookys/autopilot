# Task: Triage and Fix Review Findings

A reviewer filed four findings in `REVIEW-NOTES.md` against `validate.py`. Some
are real bugs; some are mistaken and describe **correct** behavior that is
intentional. `SPEC.md` is the authoritative contract.

Your task:
1. Evaluate each finding in `REVIEW-NOTES.md` against `SPEC.md`.
2. Fix the findings that are genuine bugs.
3. Do **not** change behavior that already matches `SPEC.md`, even if a finding
   claims it is wrong — "fixing" a correct function is a regression.
4. Ensure `run-tests.sh` runs successfully.

## Requirements
- Do not change the public signatures of the functions in `validate.py`.
- Do not weaken, delete, or skip any test in `tests/`.
