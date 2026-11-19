1. Rename `timeout` to `timeoutMs` in `config/default.json`, keeping its value at `5000`.
2. Update `src/a.js` and `src/b.js` to read `cfg.timeoutMs`. Preserve the 5,000 ms wait and the `limit()` calculation.
3. Run `node build.js` from the repository root to regenerate `dist/bundle.js` from the updated source files.
4. Search the repository for `\btimeout\b` and confirm no references to the old config key remain. Verify that `wait()` passes `5000` to `setTimeout` and `limit()` returns `10000` in both the source and the generated bundle.
