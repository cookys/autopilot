# Pane batch 2 — UX gate round 2: X2, X3, Y1, Y3, Z2

Fleet-Task: `01M7PC93PGG8FQ28EMT6ZDP7NY`  
Base: `daedf7fbd824ef6f3e807ebc2cdfe0a2b846cb54`  
Scope: `mods/live/` only, existing `fix/pane-g2b2` worktree.

## 1. Task and acceptance

Fix the assigned 現況/艦隊/shared-count/seat-detail findings. Each finding must first fail a regression test, then pass after its smallest fix. Existing tests stay; exact expectations superseded by the findings carry finding-id comments.

| Finding | Acceptance | Regression |
|---|---|---|
| X2 | 80×24 overflow includes category/severity and shows the most urgent quota pool; 80×3 retains quota severity/pool; residue uses tab 8 | Three `X2:` tests in `pages/ux-gate2-share.test.ts`, including no-pending and seat-only data |
| X3 | 現況, 艦隊, band tab and band summary use the same bus counts/classifier; offline is ✗; normal rows say 正常（無異常明細） | `X3:` compares all four rendered summaries and expanded normal rows |
| Y1 | Hidden lines include state counts; previous/next Buttons retain their target and reveal focus outside the first window | `Y1:` covers 80×24, compact overflow, and offscreen focus |
| Y3 | Both pages use 產線 狀態（時長）; 220 minutes appears once as 3 時 40 分 | `Y3:` covers both widths and both exception ingestion paths |
| Z2 | Positive seat count explains absent details; a cut quota table contains one o Button | `Z2:` covers folded/expanded at 80/160 columns and a 25-pool cut table |

## 2. Located lines before editing

- `pages/now.ts`: `body.push(...exc, ...pr)` placed all quota pools after exceptions; `t('page.now.more_items', { n: hiddenCount })` omitted category/severity; residue added a separate `[8]` action.
- `pages/now.ts`: `const n = s.lines[k]`; `pages/fleet.ts`: `const sum = snap.counts.summary.lines`; `tabs.ts`: `const stuck = stuckLinesOf(con)`; `register.ts`: `slotFleet({ stuck: fleetNow.totals.stuck, running: fleetNow.totals.running, waiting: fleetNow.totals.waiting }, t)` used different count projections.
- `pages/rows.ts`: `if (worst === null) return { sid: 'pending', word: t('page.fleet.w_normal'), worst: null }` omitted the missing-detail explanation.
- `pages/fleet.ts`: `t('page.fleet.more_items', { n: flat.length - keep.length, arrow: GLYPHS.structure.behind })` omitted hidden states; narrow actions contained only o/z/f.
- `pages/fleet.ts`: `age(r.worst.since_ms, ctx)` and `r.worst.subject + '（' + r.worst.rule + '）'` repeated rounded idle duration; 現況 separately used `ageUnit()`.
- `pages/quota.ts`: `const count = fp.seats === null ? ... : t('page.quota.f_seats_n', { n: fp.seats })`; `if (mine.length === 0) expandedSeatRows.push(kv('', t('page.quota.seat_none')))` contradicted that count; `openRow` and cut-table navigation both owned o.
- Y1 follow-up: `pages/frame.ts` used `if (alt.body.length <= alt.room) lay = alt`; the new page-budgeted overflow needs an explicit `overflow` flag so automatic unfold still requires the entire content to fit.

## 3–4. Red → fix → green, one finding at a time

See [red-green.log](red-green.log) for assertion failures and passing reruns. X2's original full-suite red run returned **1**, with **17** `(fail)` lines: the **15** accepted baseline failures plus the **2** new X2 tests. Each following finding was added and run red before its code change. X3, Y1, Y3 and Z2 focused red runs returned **1**; each immediate focused green run returned **0**. X2's no-pending edge and Y1's offscreen focus also went red before their follow-up fixes.

The focused runner used the same real-Claude isolation helper as `run-tests.sh`, with a disposable wrapper containing production sources, the autopilot manifest/hooks/type declarations and selected tests. Original test files were never removed or disabled. The disposable wrapper was removed before final lint/suite execution.

## 5. Final verification

| Command / check | Exit | Result |
|---|---:|---|
| `AUTOPILOT_MODS_REAL_CLAUDE=$HOME/.local/share/claude/versions/2.1.327 bash mods/live/run-tests.sh < /dev/null` | **1** | **1538 pass, 15 fail**, 1553 tests / 40 files; [suite.log](suite.log) |
| Required acceptance check: `(fail)` count ≤15, failure names equal the original accepted set, all seven new tests pass | **0** | Exactly the same 15 baseline failures; **7/7** new tests pass |
| `node --test mods/live/ui-lint.test.js` | **0** | **56/56** pass; [ui-lint.log](ui-lint.log) |
| Focused page/gate suites through the isolated real-Claude runner | **0** | **212/212** pass; [pages.log](pages.log) |
| `git diff --check` | **0** | No whitespace errors |

Evidence home-directory fields (including fictional test homes) were sanitized with `node scripts/redact-personal.js` after the normal pre-commit leak guard rejected those path strings; assertions, failure names and exit codes are unchanged. `$HOME` in the recorded command is a redaction placeholder for the caller-provided absolute binary path.

The full suite's raw exit **1** is reported explicitly; the user-authorized 15-failure acceptance check is green. No test, lint or source check was bypassed. The raw suite contains the final production source and all seven new regressions.

## Changed files (one line each)

- `mods/live/pages/now.ts` — X2 prioritized quota and categorized overflow/tab-8 handling; X3 shared counts; Y3 shared line status/duration.
- `mods/live/pages/fleet.ts` — X3 shared classification/counts; Y1 hidden-state counts, navigation and visible focus; Y3 unified status/duration.
- `mods/live/pages/rows.ts` — X3 bus count projection/offline classification/normal explanation; Y3 shared duration/status formatter.
- `mods/live/pages/frame.ts` — Y1 keeps automatic unfold from accepting a truncated page as a complete view.
- `mods/live/register.ts` — X3 feeds the band's own summary from the same console bus snapshot as the pages.
- `mods/live/model.ts` — X3 adds offline and normal chips to the band summary using semantic palette roles.
- `mods/live/tabs.ts` — X3 uses the shared bus projection and semantic glyph helpers for the closed-band fleet tab.
- `mods/live/pages/quota.ts` — Z2 retains positive seat totals with missing details and removes duplicate o in cut-table layouts.
- `mods/live/locales/zh-TW.json` — Y1 navigation and Z2 missing-seat-detail wording; removes the obsolete separate last-age column/day-unit labels.
- `mods/live/locales/en.json` — Matching locale keys/placeholders and obsolete-key removal required by locale validation.
- `mods/live/locales.ts` — Regenerated with `node mods/live/gen-locales.js`.
- `mods/live/pages/ux-gate2-share.test.ts` — Seven finding-id regression tests, with red evidence before fixes.
- `mods/live/pages/now.test.ts` — X2 updates exact old overflow-summary expectations.
- `mods/live/pages/fleet.test.ts` — X3/Y1/Y3 update superseded static rows and verify visible-plus-hidden totals and the shared duration grammar.
- `mods/live/pages/quota.test.ts` — Z2 updates exact old contradictory seat-detail expectations.
- `mods/live/pages/batch2-mn.test.ts` — X3 updates the old aggregate that counted offline lines as stalled.
- `mods/live/chrome.test.ts` — X3 updates the exact closed-band badge to include the same unlisted/normal count as the pages.
- `mods/live/gate1.test.ts` — X3/Y3 updates superseded normal-detail and line-format expectations.
- `mods/live/gate3.test.ts` — X2 updates exact old compact overflow summaries.
- `mods/live/evidence/pane-g2b2/red-green.log` — Per-finding failing assertions, exit codes and immediate passing reruns.
- `mods/live/evidence/pane-g2b2/pages.log` — Complete fast page-suite output (212 pass, zero failures).
- `mods/live/evidence/pane-g2b2/ui-lint.log` — Final named UI lint output.
- `mods/live/evidence/pane-g2b2/suite.log` — Final named complete live-suite output.
- `mods/live/evidence/pane-g2b2/receipt.md` — Ordered process, command results, per-file reasons and boundaries.

## Deferred / out of scope

Other gate findings and the 15 accepted baseline failures were not repaired. No changes outside `mods/live/`, new dependencies, version bump, real bus mutation, merge, push or deployment. The existing task-only band fallback remains when no console snapshot exists; whenever a bus snapshot exists it owns both page and band counts. No fresh real-terminal screenshot run was requested/performed in this implementation pass. This commit is the implementation artifact for the caller's independent review by another model family; this receipt does not claim that review has happened.

Accepted baseline failure names (timings removed; compared as an exact set):

```text
(fail) C1 U7 control: without the console config the same fetch draws the counts on the band line and still never asks for a second row (terminal)
(fail) C1 U7: console mode: an alive forge-stats with summary_row is never asked for the second row (next(e) 0 calls) and the band row carries the console tab names (terminal)
(fail) G33a: a stale, foreign, unreadable or oversized heartbeat does not stop the fetch, and the band stays one row (terminal)
(fail) G33a: the feed runs with no summary_row heartbeat, and before any run the band has no fleet counts; the reader is never asked (terminal)
(fail) G33a: the tick publishes `autopilot.fleet` and the band draws those counts on its own line; the reader beneath is never asked for a second row (terminal)
(fail) speed tab: a maxRows that is NaN or missing draws no label and asks nothing; the survey is passed down untouched (desktop)
(fail) speed tab: a maxRows that is NaN or missing draws no label and asks nothing; the survey is passed down untouched (terminal)
(fail) speed tab: a timed request draws the label on the left after the i (ours, ϟ N tok/s and a trend from two requests) and the strip gets one short last tab, a Button keyed forge (desktop)
(fail) speed tab: a timed request draws the label on the left after the i (ours, ϟ N tok/s and a trend from two requests) and the strip gets one short last tab, a Button keyed forge (terminal)
(fail) speed tab: opened, the ━ stands under the forge tab and the speed view is drawn under the rule: the speed column, the recent-requests table and the mod below beside them (desktop)
(fail) speed tab: opened, the ━ stands under the forge tab and the speed view is drawn under the rule: the speed column, the recent-requests table and the mod below beside them (terminal)
(fail) speed tab: pressing it again closes it, and the speed view is gone (desktop)
(fail) speed tab: pressing it again closes it, and the speed view is gone (terminal)
(fail) speed tab: scroll.bodyRows follows maxRows and never goes below 0; a scroll that was not there stays absent (desktop)
(fail) speed tab: scroll.bodyRows follows maxRows and never goes below 0; a scroll that was not there stays absent (terminal)
```
