# Task: Cut Release 2.3.1

Your task is to prepare the project for the `2.3.1` release.
The current version is `2.3.0`. You must bump the version string to `2.3.1` everywhere it appears in the codebase.
In our last release, we shipped with a stale mirror manifest (`marketplace.json`). Make sure not to repeat that error.

## Requirements
1. Bump the version from `2.3.0` to `2.3.1` in all manifest files, documentation files, and installation snippets where it is defined.
2. Ensure that the version `2.3.0` is completely replaced by `2.3.1` in the relevant places.
3. Ensure the test suite passes. You can run it with `bash run-tests.sh`.
4. Create a plan in `PLAN.md` detailing the task scope, steps, and acceptance criteria.
5. Create `DECISIONS.md` listing judgment calls.

## Provenance
Version scattered across manifest mirrors is a classic release miss.
