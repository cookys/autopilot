# Review Findings

## Finding F1 (🔴 Critical)
The query parser in `lib/buggy.js` crashes on flags without values (e.g. `?flag`). When no `=` is present, it attempts to call `.trim()` on `undefined`, leading to a TypeError.

## Finding F2 (🟠 Major)
In `lib/decoy.js`, the `formatDate` function is incorrect. `date.getMonth() + 1` returns the wrong month when the date is in UTC, because `date.getMonth()` returns the local month. It should use `date.getUTCMonth()` and `date.getUTCDate()` instead to be correct.
