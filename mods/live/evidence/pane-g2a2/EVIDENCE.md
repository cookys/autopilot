# Pane UX gate round 2 — X1 / X4 / K1 / Z3 label

Base: `daedf7fbd824ef6f3e807ebc2cdfe0a2b846cb54`. Scope: `mods/live/` only.
Fleet task: `01M7PC93PGG8FQ28EMT6ZDP7NY`.

## 1. Task and acceptance

Use one numbered page navigation on screen: hide the band navigation when the pane is open, and show the shared page numbers when closed. Give the summary its available width; stale data must show a broken marker, age, full cause and repair command while the band remains two rows. Page changes start at the top; forge and help use the shared frame. Traditional Chinese page 0 is `鍛`.

Acceptance: 120×30 and 160×40 open/closed navigation and stale-data cases; 80×24 forge entry and all-page navigation; default band buttons open matching framed pages; source expiry is visible with a fresh live snapshot in both console modes; ui-lint passes; full-suite failures are at most the 15 accepted baseline failures, with no failing new test.

## 2. Located lines before editing

- `register.ts`: `if (consoleOn) { ... $.ui.panes() ... }` and `consoleOn && paneOpen` restricted navigation suppression to console mode.
- `band.tsx`: `const strip = con === null ? row1Strip : pageBarStrip(...)` selected the old five-tab navigation outside console mode. The non-console `leftRoom` subtracted `row1Strip.width` even though navigation occupied a separate row.
- `register.ts`: `if (id === panePage) return` was followed by page assignment without a scroll reset.
- `pages/index.ts`: `shell('forge', '0', 'forge')` fell back to the legacy pane renderer, including its independent strip.
- `locales/zh-TW.json`: `"tab.forge": "forge"` disagreed with the compact `鍛` label.

## 3–4. Red, smallest fix, verification

Raw local logs in this directory are ignored; the excerpts below are retained in this committed receipt. All red results are assertion failures, not import/collection failures.

| Finding | Red artifact / exit | Green artifact / exit |
| --- | --- | --- |
| X1 | `x1-focused-red.log` / 1: four failures, old five-tab Buttons remain or page digits are absent | `x1-green.log` / 0: 4 pass |
| X4 | `x4-red.log` / 1: four stale 12-minute scenarios lack `✗` | `x4-green.log` / 0: 8 pass including X1 |
| K1 | `k1-visible-red.log` / 1: forge has no framed first-row header and reuses the old navigation | `k1-visible-green.log` / 0: 10 pass |
| Z3 | `z3-red.log` / 1: page 0 uses `forge` at 120/160 and the old overflow chip removes the 80-column digit | subsequent focused runs / 0 |
| X4 source mode | `x4-source-mode-red.log` / 1: expired source beside fresh live data reads `◌ 待命` without console mode | `focused-final.log` / 0: all 284 tests pass across 4 files |

The additional focused files are `chrome.test.ts`, `bottom-anchor.test.ts` and `frame.test.ts`; `ux-gate2.test.ts` has 18 new finding-labelled cases. The focused wrapper copies the current live/viewer sources with only those four test files, the same plugin manifest/module wiring and isolated real-Claude helper as `run-tests.sh`.

Legacy contracts: `live.test.ts` already opts into `legacyTabs` for its old pane tests. Its old band fixture now explicitly uses the same opt-in, retaining every old assertion and the old band interactions. The default renderer has the new shared navigation and is tested without that flag. `full-after.log` records the initial conflicts that led to this separation. No existing test was deleted or skipped.

The first K1 scroll-call spy used an API unavailable to the testing client. It was replaced with the requested visible first-row/24-row assertions, re-run red against the original renderer before green. The closing-button fixture simulates host Escape directly because the testing client has no `ui.close` method.

## 5. Final verification

| Verify command | Exit | Result |
| --- | --- | --- |
| `AUTOPILOT_MODS_REAL_CLAUDE="$HOME/.local/share/claude/versions/2.1.327" bash mods/live/run-tests.sh < /dev/null` | 1 | 1549 pass / 15 accepted failures; identical failure names to the baseline; 18/18 new finding tests pass |
| `node --test mods/live/ui-lint.test.js` | 0 | 56 pass / 0 fail |
| Focused real-Claude wrapper with the four affected test files | 0 | 284 pass / 0 fail |
| Mechanical comparison of `baseline.log` and `final-suite.log`, checking the 15-failure ceiling, identical failure names and 18 passing finding cases | 0 | `acceptance.log` |
| `git diff --check` | 0 | no whitespace errors |

The absolute real-Claude binary is the caller-provided 2.1.327 binary; `$HOME` above resolves to the same tested location. The full-suite exit remains 1 because the supplied contract accepts the 15 pre-existing failures; the acceptance comparison exits 0.

### Final accepted failures

```text
(fail) C1 U7 control: without the console config the same fetch draws the counts on the band line and still never asks for a second row (terminal)
(fail) C1 U7: console mode: an alive forge-stats with summary_row is never asked for the second row (next(e) 0 calls) and the band row carries the console tab names (terminal)
(fail) G33a: a stale, foreign, unreadable or oversized heartbeat does not stop the fetch, and the band stays one row (terminal)
(fail) G33a: the feed runs with no summary_row heartbeat, and before any run the band has no fleet counts; the reader is never asked (terminal)
(fail) G33a: the tick publishes `autopilot.fleet` and the band draws those counts on its own line; the reader beneath is never asked for a second row (terminal)
(fail) speed tab: a maxRows that is NaN or missing draws no label and asks nothing; the survey is passed down untouched (desktop)
(fail) speed tab: a maxRows that is NaN or missing draws no label and asks nothing; the survey is passed down untouched (terminal)
(fail) speed tab: a timed request draws the label on the left after the ⓘ (ours, ϟ N tok/s and a trend from two requests) and the strip gets one short last tab, a Button keyed forge (desktop)
(fail) speed tab: a timed request draws the label on the left after the ⓘ (ours, ϟ N tok/s and a trend from two requests) and the strip gets one short last tab, a Button keyed forge (terminal)
(fail) speed tab: opened, the ━ stands under the forge tab and the speed view is drawn under the rule: the speed column, the recent-requests table and the mod below beside them (desktop)
(fail) speed tab: opened, the ━ stands under the forge tab and the speed view is drawn under the rule: the speed column, the recent-requests table and the mod below beside them (terminal)
(fail) speed tab: pressing it again closes it, and the speed view is gone (desktop)
(fail) speed tab: pressing it again closes it, and the speed view is gone (terminal)
(fail) speed tab: scroll.bodyRows follows maxRows and never goes below 0; a scroll that was not there stays absent (desktop)
(fail) speed tab: scroll.bodyRows follows maxRows and never goes below 0; a scroll that was not there stays absent (terminal)
```

### New finding tests in the final full suite

```text
(pass) X4: 120 columns expired console source stays visible beside a fresh live snapshot, console mode false [989.83ms]
(pass) X4: 120 columns expired console source stays visible beside a fresh live snapshot, console mode true [626.32ms]
(pass) X4: 160 columns expired console source stays visible beside a fresh live snapshot, console mode false [496.61ms]
(pass) X4: 160 columns expired console source stays visible beside a fresh live snapshot, console mode true [486.35ms]
(pass) X4: 120x30 stale 12 minutes, pane closed, keeps the full reason and repair in two band rows [435.17ms]
(pass) X4: 120x30 stale 12 minutes, pane open, keeps the full reason and repair in two band rows [430.73ms]
(pass) X4: 160x40 stale 12 minutes, pane closed, keeps the full reason and repair in two band rows [425.46ms]
(pass) X4: 160x40 stale 12 minutes, pane open, keeps the full reason and repair in two band rows [411.14ms]
(pass) X1: 120x30 open pane leaves only its shared navigation on screen [413.62ms]
(pass) X1: 120x30 closed band lists shared page numbers 1-9 and 0 [443.03ms]
(pass) X1: 160x40 open pane leaves only its shared navigation on screen [476.43ms]
(pass) X1: 160x40 closed band lists shared page numbers 1-9 and 0 [428.00ms]
(pass) K1: at 80x24 pressing 0 after an old scroll offset shows the forge header on the first row [432.08ms]
(pass) K1: every page has exactly one shared strip with the same digit mapping and labels at 80x24 [516.77ms]
(pass) Z3: page 0 is labelled 鍛 in both shared strips at 80 columns [428.30ms]
(pass) Z3: page 0 is labelled 鍛 in both shared strips at 120 columns [457.29ms]
(pass) Z3: page 0 is labelled 鍛 in both shared strips at 160 columns [396.13ms]
(pass) X1: each closed-band page button opens its matching framed page and leaves the band at two rows [580.93ms]
```

### Red evidence excerpts

`x1-focused-red.log` — exit 1:

```text
(fail) X1: 120x30 open pane leaves only its shared navigation on screen [626.62ms]
  AssertionError: expect(received).toEqual()

  Expected: []
  Received: [
    "tab:now",
(fail) X1: 120x30 closed band lists shared page numbers 1-9 and 0 [515.00ms]
  AssertionError: expect(received).toEqual()

  Expected: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
  Received: [undefined, undefined, undefined, undefined, undefined]

(fail) X1: 160x40 open pane leaves only its shared navigation on screen [516.62ms]
  AssertionError: expect(received).toEqual()

  Expected: []
  Received: [
    "tab:now",
(fail) X1: 160x40 closed band lists shared page numbers 1-9 and 0 [495.90ms]
  AssertionError: expect(received).toEqual()

  Expected: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
  Received: [undefined, undefined, undefined, undefined, undefined]

```

`x4-red.log` — exit 1:

```text
(fail) X4: 120x30 stale 12 minutes, pane closed, keeps the full reason and repair in two band rows [500.52ms]
  AssertionError: expect(received).toContain()

  Expected: containing "✗"
  Received: "資料過舊 · 上次發佈 18:00 · watcher 沒有在發佈 │ ⓘ "

(fail) X4: 120x30 stale 12 minutes, pane open, keeps the full reason and repair in two band rows [392.37ms]
  AssertionError: expect(received).toContain()

  Expected: containing "✗"
  Received: "資料過舊 · 上次發佈 18:00 · watcher 沒有在發佈 │ ⓘ "

(fail) X4: 160x40 stale 12 minutes, pane closed, keeps the full reason and repair in two band rows [384.43ms]
  AssertionError: expect(received).toContain()

  Expected: containing "✗"
  Received: "資料過舊 · 上次發佈 18:00 · watcher 沒有在發佈 │ ⓘ "

(fail) X4: 160x40 stale 12 minutes, pane open, keeps the full reason and repair in two band rows [369.38ms]
  AssertionError: expect(received).toContain()

  Expected: containing "✗"
  Received: "資料過舊 · 上次發佈 18:00 · watcher 沒有在發佈 │ ⓘ "

```

`k1-visible-red.log` — exit 1:

```text
(fail) K1: at 80x24 pressing 0 after an old scroll offset shows the forge header on the first row [379.07ms]
  AssertionError: expect(received).toBe()

  Expected: "forge"
  Received: ""

(fail) K1: every page has exactly one shared strip with the same digit mapping and labels at 80x24 [389.56ms]
  AssertionError: forge navigation

  expect(received).toEqual()

  Expected: [
```

`z3-red.log` — exit 1:

```text
(fail) Z3: page 0 is labelled 鍛 in both shared strips at 80 columns [352.42ms]
  AssertionError: expect(received).toBe()

  Expected: "0 鍛"
  Received: "鍛"

(fail) Z3: page 0 is labelled 鍛 in both shared strips at 120 columns [330.86ms]
  AssertionError: expect(received).toBe()

  Expected: "鍛"
  Received: "forge"

(fail) Z3: page 0 is labelled 鍛 in both shared strips at 160 columns [315.58ms]
  AssertionError: expect(received).toBe()

  Expected: "鍛"
  Received: "forge"

```

`x4-source-mode-red.log` — exit 1:

```text
(fail) X4: 120 columns expired console source stays visible beside a fresh live snapshot, console mode false [712.43ms]
  AssertionError: expect(received).toContain()

  Expected: containing "✗"
  Received: "◌ 待命 │ ⓘ "

(fail) X4: 160 columns expired console source stays visible beside a fresh live snapshot, console mode false [504.08ms]
  AssertionError: expect(received).toContain()

  Expected: containing "✗"
  Received: "◌ 待命 │ ⓘ "

```



## Changed files (one line each)

- `mods/live/band.tsx` — shared default navigation, fixed two rows, available summary width, stale/expired cause and repair priority; retain explicit legacy rendering.
- `mods/live/bottom-anchor.test.ts` — K1 replaces the obsolete help padding assumption with its framed first-row header assertion.
- `mods/live/chrome.test.ts` — X1 accounts for shared page numbers while retaining unknown/zero pending-count checks.
- `mods/live/live.test.ts` — X1 marks the legacy band fixture explicitly, preserving its existing assertions.
- `mods/live/locales.ts` — regenerate the Traditional Chinese forge label from JSON.
- `mods/live/locales/zh-TW.json` — Z3 sets the full page-0 label to `鍛`.
- `mods/live/pages/forge.ts` — K1 renders speed measurements and recent requests through the shared frame.
- `mods/live/pages/frame.ts` — share page keys with the band and accept measured steps for forge.
- `mods/live/pages/index.ts` — register forge and the existing help content as framed pages.
- `mods/live/pages/layout.ts` — X1 provides the common page-number table.
- `mods/live/pane.tsx` — pass measured steps into the framed page context.
- `mods/live/register.ts` — default shared navigation, all-mode source health, stale clock, page-entry scroll reset and forge data wiring.
- `mods/live/tabs.ts` — number the shared band pages using the common key table.
- `mods/live/ux-gate2.test.ts` — finding-labelled mounted regression cases and recording fake host.
- `mods/live/evidence/pane-g2a2/.gitignore` — keep verbose local runner logs and exit files out of the shipped diff.
- `mods/live/evidence/pane-g2a2/EVIDENCE.md` — retain the task sequence, outcomes, file inventory and scope boundaries.

## Not done / out of scope

- No other gate findings, including Z3's raw hash explanation or `ctx` wording.
- No files outside `mods/live/`, dependency/version changes, push, merge or deployment.
- No fresh real-terminal screenshot run or independent cross-family review; those remain with the caller's external gate. This receipt does not claim either was performed.
- Explicit legacy rendering remains for the in-repository legacy contract consumers; it is not the default path.
