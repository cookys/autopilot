# segments() is superlinear on long runs of `$(`

Surfaced 2026-11-03 by the br3 lane of the PM base-reds triage, while converting the absolute wall-clock
cost bounds in `hooks/bash-launch-guard.test.js` into load-proof ratio tests.

## Measurement

`segments()` in `scripts/lib/bash-launch-rules.js`, input = `'$('.repeat(n)`, one call each:

| n (units) | chars | ms |
|---|---|---|
| 2000 | 4000 | 4.8 |
| 8000 | 16000 | 6.1 |
| 16000 | 32000 | 16.6 |
| 32000 | 64000 | 54.9 |
| 64000 | 128000 | 514 |

Past the 16 KB `SEG_MAX_TEXT` boundary a 2x input costs 3x to 9x the time. The ratio test (16x the input
must cost under 64x the time) fails on it, so `$(` is excluded from the default ratio test.

## Suspected cause

In the character loop, `c === '(' && cur.trim() === ''` runs `cur.trim()` on a string that is grown one
character at a time (`cur += c`). `trim()` flattens the V8 cons-string each call, so the loop is quadratic.
The `big` flag skips the structural passes but not this check.

## Unquarantine condition

Fix the check so it does not flatten `cur` per character (track "cur is blank" with a boolean updated when a
non-space character is appended). Then add `['$(', '$(', <n>]` back to the unit list of the default
`segments()/expandSegments() grow linearly` test in `hooks/bash-launch-guard.test.js`, remove the
exclusion comment there, and mark this row shipped.

The opt-in `@slow` absolute variant (`BLG_SLOW_TIMING=1`) still bounds the real hook on this input meanwhile.
