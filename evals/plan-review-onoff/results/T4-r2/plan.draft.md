1. In `config/default.json`, rename `timeout` to `timeoutMs`. Keep the value at `5000` and leave `retries` at `3`.
2. Update `src/a.js` to pass `cfg.timeoutMs` to `setTimeout`. In `src/b.js`, rename the local config binding to `cfg2` and calculate the limit with `cfg2.timeoutMs * 2`. The distinct bindings prevent a duplicate `const` declaration when the build concatenates the two files.
3. Run `node build.js` from the repository root to regenerate `dist/bundle.js` from the updated sources.
4. Verify that no `timeout` key or property access remains. Run `node --check dist/bundle.js`, confirm both the source and bundled `wait()` pass `5000` to `setTimeout`, and confirm both versions of `limit()` return `10000`.
