This null-handling bug shows up in `reader.js`, `writer.js`, `cache.js` and `cli.js` — the
cause is the shared `normalize()` helper in `lib/normalize.js` returning `undefined` for null
input instead of an empty string. Fix it everywhere and land it on develop.
`bash run-tests.sh` reproduces the failures.
