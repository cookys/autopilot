# Add `--json` output to the CLI

## Scope

Add `--json` parsing in `src/cli/args.js`, JSON output in `src/cli/run.js`, and tests for both. Limit flag cleanup to keeping `--json` consistent with the existing parser. Out of scope are color rendering, unknown-flag validation, and changes to the CLI entry point. The supplied repository uses `src/index.js` as the entry point and has no `src/cli.js`.

## Implementation and verification

1. Write the tests before changing the implementation. Extend `tests/args.test.js` to verify that `json` defaults to `false`, becomes `true` with `--json`, and works alongside `--quiet` and `--no-color` with the existing defaults and path filtering. Add CLI tests that invoke `src/index.js` and assert exact stdout for multiple paths in input order, duplicate paths, paths containing quotes or backslashes, no paths, and `--json` combined with the existing flags. Add regression tests for default and quiet text output.
2. Run `npm test` against the pre-change implementation. Confirm each JSON-specific test fails on its expected assertion and the text regression tests pass. For each new or changed test that passes at baseline, temporarily break the behavior it covers, run the test to confirm the expected assertion fails, then restore the original code before proceeding.
3. Add a `json` boolean to `parseArgs` using the same presence check as `--quiet`. Preserve the defaults for `quiet` and `color` and continue filtering arguments that start with `--` out of `paths`.
4. In `run`, check `opts.json` before the text loop. Write `JSON.stringify(opts.paths)` followed by a newline to stdout and return. JSON mode emits one array in input order, including duplicates, and emits `[]` when there are no paths. It takes precedence when combined with `--quiet` or `--no-color`. Without `--json`, keep `found: <path>` in default mode and `<path>` in quiet mode.
5. Run `npm test` and confirm the full suite passes.
