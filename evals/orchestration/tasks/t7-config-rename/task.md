# Task: Rename Config Key with Backward Compatibility

We are standardizing config keys across our products. The key `timeout` (configured in seconds) in `config.json` is being renamed to `timeout_ms` (configured in milliseconds).

## Requirements

1. Modify the configuration reading logic in `bin/tool.js` so that:
   - The key becomes `timeout_ms` (in milliseconds).
   - If both `timeout` and `timeout_ms` are present, `timeout_ms` takes precedence, and no warning is printed.
   - If only `timeout_ms` is present, use it, and no warning is printed.
   - If only the old `timeout` key is present, use it (converting it from seconds to milliseconds: `timeout * 1000`) and print a one-line deprecation warning to `stderr` (e.g. `Warning: "timeout" config is deprecated, use "timeout_ms" instead`).
   - If neither is present, use a default timeout of `30000` ms.
2. Update the README.md documentation to document `timeout_ms` instead of `timeout`.
3. Update and expand tests in `tests/tool.test.js` to assert the new behavior and backward compatibility.
4. Ensure all tests pass. You can run them using `bash run-tests.sh`.
5. Create a plan in `PLAN.md` detailing the task scope, steps, and acceptance criteria.
6. Create `DECISIONS.md` listing judgment calls.

## Provenance
Config-key migrations with backward compatibility are routine platform work.
