# Rename `timeout` to `timeoutMs`

## Scope

Rename the configuration key and all its consumers, give the config binding in `src/b.js` a distinct name so the concatenated bundle loads, and regenerate `dist/bundle.js` with `build.js`. Changes to the build script, `retries`, and the public `wait()` and `limit()` APIs are outside scope.

## Implementation

1. Rename `timeout` to `timeoutMs` in `config/default.json` and keep its value at `5000`.
2. Update `src/a.js` to pass `cfg.timeoutMs` to `setTimeout`. In `src/b.js`, rename the top-level config binding from `cfg` to `cfg2` and calculate `limit()` as `cfg2.timeoutMs * 2`. The distinct binding names prevent duplicate `const` declarations when the build concatenates the files.
3. From the repository root, run `node build.js` to regenerate `dist/bundle.js`.

## Verification

1. Check the old-key scan against a temporary copy of the original files. Confirm that `rg -n '\btimeout\b'` reports the original config key and its consumers. Run the same scan on the updated repository, inspect any matches, and confirm no old config-key references remain.
2. In temporary copies of the updated files, remove `timeoutMs` from `config/default.json` and run the runtime checks below in a fresh Node process. Confirm that each assertion fails independently for both the source modules and the generated bundle.
3. Run `node --check dist/bundle.js` on the updated bundle. Then run the same runtime checks in a fresh Node process against `src/a.js`, `src/b.js`, and `dist/bundle.js`. Stub `setTimeout` to record the delay and invoke the callback immediately. Assert that `wait()` passes `5000` and resolves, and that `limit()` returns `10000`, for both the source and bundle exports.
4. Review the diff and confirm it contains only `config/default.json`, the two source files, and the regenerated bundle. Confirm `retries` still equals `3`.
