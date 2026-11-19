# Rename `timeout` to `timeoutMs`

1. In `config/default.json`, rename `timeout` to `timeoutMs`. Keep its value at `5000` and `retries` at `3`.
2. In `src/a.js`, update `wait()` to pass `cfg.timeoutMs` to `setTimeout`. In `src/b.js`, rename the local config binding to `cfg2` and update `limit()` to return `cfg2.timeoutMs * 2`. The distinct bindings prevent a duplicate `const` declaration when the build concatenates the source files.
3. Run `node build.js` from the repository root to regenerate `dist/bundle.js` from the updated sources.
4. Verify the rename and runtime behavior.
   - Search the repository for uses of the old `timeout` config key, including property accesses and string-key lookups. Confirm that no uses remain in the config, source files, or generated bundle.
   - Run `node --check dist/bundle.js`.
   - Stub `setTimeout` to capture the delay and invoke its callback. Confirm that `wait()` from `src/a.js` and from `dist/bundle.js` each pass `5000` and resolve.
   - Confirm that `limit()` from `src/b.js` and from `dist/bundle.js` each return `10000`.
