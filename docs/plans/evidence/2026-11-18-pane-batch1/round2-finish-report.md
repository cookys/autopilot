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
actually observed red then green in Part 1 were appended to `receipt.log`; load failures
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
repairs, pushing, and credential/config reads. Independent cross-family review remains with the caller.


Part 2 starts from `ca129357c27a2bb6c170871c4f60b602c2d10c32`. The only production behavior change moves frame padding before the displayed body; height, wrapping, overflow, actions and strip remain intact.

R14 negative control: `git show ca129357c27a2bb6c170871c4f60b602c2d10c32:mods/live/pages/frame.ts > /tmp/pane-r3-finish/part1-frame.ts`, then `PANE_R3_FRAME_OVERRIDE=/tmp/pane-r3-finish/part1-frame.ts python3 /tmp/pane-r3-finish/run-target.py r14-final-red live/bottom-anchor.test.ts`: exit 1, **35 pass / 3 fail**. The override touches only the copied temporary wrapper. Original pre-fix run `r14-red` also exited 1 with 35 pass / 3 fail; after the one-line frame fix `r14-green` exited 0 with 38 pass.

Final target: `python3 /tmp/pane-r3-finish/run-target.py part2-final live/bottom-anchor.test.ts live/frame.test.ts live/pages/frame.golden.test.ts live/gate1.test.ts live/gate2.test.ts live/gate3.test.ts live/pages/now.test.ts live/pages/decide.test.ts live/pages/fleet.test.ts live/pages/quota.test.ts live/pages/integration.golden.test.ts live/chrome.test.ts`: exit 0, **386 pass / 0 fail** across 12 files (`part2-final.log` / `.exit`).

All sequential collateral checks use `python3 /tmp/pane-r3-finish/run-target.py <label> <test-file>`; label names below identify their `.log` and `.exit` artifacts.

| Label / test-file | Exit | Pass / fail |
|---|---:|---:|
| `r14-collateral-red` / final target list excluding chrome | 1 | 371 / 7 |
| `r14-frame-green` / `live/frame.test.ts` | 0 | 219 / 0 |
| `r14-gate2-green` then `r14-gate2-final` / `live/gate2.test.ts` | 1, 0 | 15 / 1, then 16 / 0; local translator-name typo corrected |
| `r14-table-green`, `r14-priority-green`, `r14-gate3-green` / `live/gate3.test.ts` | 1, 1, 0 | 4 / 2, 5 / 1, 6 / 0 |
| `r14-fleet-green` / `live/pages/fleet.test.ts` | 0 | 11 / 0 |
| `r14-allpages-red` / bottom-anchor with Part 1 frame | 1 | 35 / 3 |
| `r14-allpages-green`, `r14-allpages-final`, `r14-allpages-verified` / `live/bottom-anchor.test.ts` | 1, 1, 0 | 37 / 1, 37 / 1, 38 / 0; renderer handles host-omitted empty props, new shell checks compare rendered strip vertically |

New R14 tests (all observed red against Part 1, then green):

- `R14: every page bottom-anchors short content in a fixed frame at all three sizes and H=5..7`: all eleven page IDs, content order/adjacency, fixed height, all spare rows above, also a two-row strip at 60 columns.
- `R14: real page content ends directly above actions with null or short snapshots`: actual page renderers and empty shell bodies at all three sizes.
- `R14 mounted: every page keeps content adjacent to actions at 80x24 inline and 120x30/160x40 dock`: actual navigation to all eleven pages; framed content touches actions, shell content touches its rendered strip. Existing legacy footer assertions are unchanged.

Existing tests migrated without removing assertions or filtering all blank rows:

- `frame: no action says 沒有待決卡 on one row only; a short body keeps the strip on the last row, blank rows only between the body and the actions` → same name ending `blank rows only above the body`: header/height/action positions retained, body sequence located semantically and adjacent to action.
- `gate2 item 1: actions sit directly above the strip, the body starts under the head, only the leftover is blank between them` → `gate2 item 1: actions sit directly above the strip, the body touches the actions, only the leftover above the body is blank`: same contiguous padding check now ends before content; content touches action.
- `gate3 item 1: quota draws exactly one row per pool at 160x40, 120x30, 80x24 and narrow docked widths, no continuation fragment, short verdict in table, full verdict in focus, dropping 重置 then 近 6 時`: table positions relative to section/header, exact pool count and widths retained.
- `gate3 item 2: when body has 4 rows or fewer, no section title and no column header are drawn; 額度 shows >= 1 pool row and 現況 shows >= 1 item ordered red pools -> unknown pools -> stuck lines`: first semantic item followed immediately by red/unknown; last item touches action.
- `gate4 empty state with pending cards: 3 pending cards (console.cards or live.pending) with sources ok on 艦隊 and 額度 shows page.now.go_decide (after frame.unknown_pools when n > 0), never 沒有要你處理的事 or 沒有待決卡`: pending, stuck line and red pool remain adjacent in order, anchored before action.
- `fleet golden: 80x24 folded, expanded, stale and no-source rows` and `fleet golden: 120x30 and 160x40 folded`: shared comparison helper removes only leading frame padding; every original golden row, internal blank and any trailing gap remains compared.

Files additionally changed in Part 2 (one purpose each):

- `mods/live/bottom-anchor.test.ts`: add three R14 tests and support omitted empty props in actual host nodes.
- `mods/live/pages/frame.ts`: place blank padding above content and correct placement comments.
- `mods/live/frame.test.ts`: preserve short-body order and adjacency relative to actions.
- `mods/live/gate2.test.ts`: preserve contiguous padding and action/strip assertions under bottom anchoring.
- `mods/live/gate3.test.ts`: preserve table/order expectations relative to semantic content.
- `mods/live/pages/quota.fixture.ts`: remove only leading frame padding from fleet golden comparisons.
- `receipt.log` and this report: record the three R14 and seven collateral red-to-green pairs; two renamed tests explicitly map old red name to new green name.


Final required verification:

- `AUTOPILOT_MODS_REAL_CLAUDE=$HOME/.local/bin/claude bash mods/live/run-tests.sh < /dev/null`: exit **1**, **1464 pass / 15 baseline fail**, 1479 tests across 32 files; preceding 10 Node suites: **187 pass / 0 fail** (`/tmp/pane-r3-finish/final-suite.log`, `.exit`).
- `bash scripts/sync-all.sh`: exit **0**, `ok=true`, `changed=false` (`sync-all.log`, `.exit`).
- `bash scripts/sync-all.sh --check`: exit **0**, all 16 checks pass, `ok=true` (`sync-check.log`, `.exit`).
- `git diff --check`: exit **0**.

The following normalization retains every failure, including untimed load failures; the result has exactly 15 lines. The diff runs in the supplied `bandrow-brief` directory. Both commands exit **0**, and the diff output is **empty** (no deduplication):

```bash
sed -n '/^(fail)/{s/ \[[^][]*\]$//;p;}' /tmp/pane-r3-finish/final-suite.log > /tmp/pane-r3-finish/final-failures.txt
diff -u <(LC_ALL=C sort fb.txt) <(LC_ALL=C sort /tmp/pane-r3-finish/final-failures.txt)
```

Diff stdout: empty. The 15 existing baseline failures remain out of scope; independent review by another model family remains with the caller. No push or protected-file edits.
