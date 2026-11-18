# Pane round 2 finish and R14

Base: `fd48c4504`; branch `fix/pane-r3-finish`. No push.

Part 1 follows reproduce → one criterion edit → targeted verification. Raw logs and
exit-code files remain outside the commit at `/tmp/pane-r3-finish/`.

| Verification | Exit | Result / artifact |
|---|---:|---|
| `AUTOPILOT_MODS_REAL_CLAUDE=$HOME/.local/bin/claude bash mods/live/run-tests.sh < /dev/null` on base | 1 | `base-suite.log`, 300 pass / 19 fail; 17 import failures, R1 and R2/R11 assertion failures |
| `python3 /tmp/pane-r3-finish/run-target.py cycle live/bottom-anchor.test.ts live/console.test.ts live/consoleframe.test.ts live/pages/now.test.ts live/pages/decide.test.ts live/pages/quota.test.ts live/pages/fleet.test.ts live/pages/integration.golden.test.ts live/gate3.test.ts` | 1 | `cycle.log`, 125 pass / 3 fail; imports load, R1/R2/R11 and newly exposed R5 red |
| `python3 /tmp/pane-r3-finish/run-target.py r1 live/pages/now.test.ts live/pages/quota.test.ts live/pages/integration.golden.test.ts` | 1 | `r1.log`, 38 pass / 1 fail; R1 green, R5 still red |
| `python3 /tmp/pane-r3-finish/run-target.py r11 live/pages/decide.test.ts` | 0 | `r11.log`, 29 pass; R2/R11 and existing decide goldens green |
| `python3 /tmp/pane-r3-finish/run-target.py r5 live/pages/quota.test.ts` | 0 | `r5.log`, 17 pass |
| `python3 /tmp/pane-r3-finish/run-target.py part1 live/bottom-anchor.test.ts live/console.test.ts live/consoleframe.test.ts live/pages/now.test.ts live/pages/decide.test.ts live/pages/quota.test.ts live/pages/fleet.test.ts live/pages/integration.golden.test.ts live/gate3.test.ts` | 0 | `part1.log`, 128 pass / 0 fail; all R1/R2/R3/R4/R5/R8/R10/R11 tests green |
| `python3 /tmp/pane-r3-finish/run-target.py r1-seat-red live/pages/quota.test.ts` | 1 | `r1-seat-red.log`, 17 pass / 1 fail; missing facts.seat duplicated pool verdict |
| `python3 /tmp/pane-r3-finish/run-target.py r1-seat-green live/pages/quota.test.ts` | 0 | `r1-seat-green.log`, 18 pass |
| `python3 /tmp/pane-r3-finish/run-target.py part1-final live/bottom-anchor.test.ts live/console.test.ts live/consoleframe.test.ts live/pages/now.test.ts live/pages/decide.test.ts live/pages/quota.test.ts live/pages/fleet.test.ts live/pages/integration.golden.test.ts live/gate3.test.ts` | 0 | `part1-final.log`, 129 pass / 0 fail |

The targeted runner copies unchanged production sources and selected original test
files into a temporary plugin wrapper, preserving test imports, and calls
`mods_run_plugin_test` with the real binary in its empty no-auth environment.

Added test: `quota R1: a blocked seat without facts.seat uses its id, retaining stale source without repeating the pool verdict` checks all three terminal sizes. The fallback derives the seat from the `seat_blocked:` ID; if absent it uses the existing localized seat label, never raw title/text.

The R1 duplicate was a second fleet.brief pool verdict in the focus area; it now
identifies the blocked seat and retains the stale-source reason. The quota module
still supplies the full verdict. Wide other-card rows reserve a four-cell gutter
between question and owner/age, truncating with `…` before that column; age stays
at the right edge and existing short-title goldens remain unchanged.

Changed test: `quota R5: at 120x30 and 80x24 with many pools and a multi-row wrapped
verdict, focused pool full reason is kept whole and never cut by ↓ 還有 N 列`.
Its deep-focus fixture previously placed `deepfocus` at source index 15 but danger
rank 9, while selecting rank 15. The fixture now has fifteen more-urgent pools,
then `deepfocus`, then calmer pools, with an added assertion that its rank is 15.
All original reason/overflow/no-ellipsis/75%-verdict assertions remain. This was a
fixture correction, not a production focus-semantics change. Only the four tests
actually observed red then green were appended to `receipt.log`; load failures
were not counted as assertion red-to-green evidence.

Files changed in Part 1 (one purpose each):
- `mods/live/pages/layout.ts`: leaf shared strip threshold, independent of page registry.
- `mods/live/pages/frame.ts`: consume and re-export the leaf threshold without changing placement.
- `mods/live/pages/now.ts`: use leaf threshold, removing runtime frame cycle.
- `mods/live/pages/quota.ts`: use leaf threshold and show blocked seat without a duplicate pool verdict.
- `mods/live/pages/decide.ts`: reserve other-card metadata gutter before title truncation.
- `mods/live/pages/quota.test.ts`: correct and assert the intended deep-focus rank; add missing-seat duplicate-verdict regression.
- `docs/plans/evidence/2026-11-18-pane-batch1/receipt.log`: append only observed assertion red-to-green pairs.
- `docs/plans/evidence/2026-11-18-pane-batch1/round2-finish-report.md`: concise commands, outcomes, changed files/tests and boundaries.

Out of scope: forge speed-tab budget, `mods/live/consolefeed.ts`, baseline failure
repairs, pushing, and credential/config reads. Full final-suite/failure comparison,
sync checks and R14 evidence follow in Part 2; independent cross-family review is
reserved for the caller.
