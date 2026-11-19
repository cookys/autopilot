# Add JSON output to the CLI

1. Limit production edits to `src/cli/args.js` and `src/cli/run.js`. The supplied CLI entry point is `src/index.js`, which already passes parsed arguments to `run`. Entry-point changes, color styling, and unknown-option validation are outside the scope of this change.

2. Add parser tests in `tests/args.test.js` and subprocess tests that invoke `src/index.js` with Node. Cover the following behavior.

   - `json` defaults to `false`. With `--json --quiet --no-color`, the parser sets `json` and `quiet` to `true` and `color` to `false`, retains positional paths in order, and ignores unrecognized `--` options.
   - JSON mode exits successfully and writes exactly one newline-terminated JSON array to stdout. Assert the full stdout and verify that parsing it returns the original path strings in order. Include paths containing quotes and backslashes, an empty path list that produces `[]`, and `--json --quiet`, which still produces JSON.
   - Without `--json`, default output is `found: <path>` per line and quiet output is the bare path per line.

3. Run the new and changed tests before editing production code. Confirm that each test for missing JSON behavior fails at its intended assertion. For each new or changed test that already passes against existing behavior, temporarily introduce a targeted fault, such as retaining an unknown option as a path or swapping the default and quiet output formats. Verify that the test fails for the expected reason, then revert the fault before proceeding.

4. In `src/cli/args.js`, group the flag checks and add a `json` boolean that is `true` when `--json` is present. Preserve the existing checks for `--quiet` and `--no-color` and the existing filter that excludes all `--` arguments from positional paths.

5. In `src/cli/run.js`, check `opts.json` before the text-output loop. In JSON mode, write `JSON.stringify(opts.paths)` followed by a newline to stdout and return. Otherwise, use the existing text-output loop.

6. Run `npm test` after implementing the change. Confirm that every test exercised by the negative controls now passes and that the full suite is green.
