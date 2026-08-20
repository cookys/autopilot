# Task B — fix the failing interval-merge test

The test suite under `evals/engine-capabilities/impl-baseline/` fails:

    node --test evals/engine-capabilities/impl-baseline/

Find the bug in `evals/engine-capabilities/impl-baseline/merge-intervals.js`
and fix it so the whole suite passes.

Rules:

- Do NOT modify `merge-intervals.test.js` or any other file — the only file you
  may change is `merge-intervals.js`.
- The fix must be minimal: correct the logic error, do not rewrite the module.
- Run the suite yourself and confirm it is green before committing.
- Commit with a single one-line commit message.
