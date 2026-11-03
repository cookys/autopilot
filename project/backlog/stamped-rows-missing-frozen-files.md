# Stamped eval rows may have lost files from their frozen set

BL-0310. Rough starting point from the fbstamp closure-scan, 2026-10-26. Files a row reads but does not freeze:

- `bpack`: `lib-gdorm/gdorm-markers.sh`, `lib/dcard-markers.sh`, `lib/dcard-v3-markers.sh`, `lib/transcript-query.js`
- `gdorm`: `lib/transcript-query.js`
- `dcard-v3`: `lib-r2/p1w-markers.sh`, `lib/p1w-markers.sh`, `lib/transcript-query.js`, `run-skill-onoff-matrix.sh`
- `qs-v3`: `prereg/qs-v3.json`, `run-skill-onoff-eval.sh`, `run-skill-onoff-matrix.sh`

Past batch evidence must not be edited. What to check is whether any of these files changed after the stamp; if one did, that row's result can no longer be re-derived from the original files. `transcript-query.js` has not changed since 10/4.
