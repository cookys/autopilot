# O4 band shell: layout and rules

Status: written from `shell.ts`, `band.tsx` (`Shell`, `cardMain`, `cardQuick`) and `register.ts`. The contract and the ux-v7 design live in codeforge (see Sources); codeforge compared this shell against ux-v7 and the three differences it found are done (section 2, the card list in section 8, the quick row in section 9).

## 1. Five tiers

The tier is chosen on `bodyColumns`, the width the host hands the band, not on the terminal width.

| bodyColumns | tier | right columns (inner width) |
|---|---|---|
| >= 235 | 240 | roundtable 42, usage 42, fleet · memory 44 |
| >= 195 | 200 | roundtable 44, usage 45 |
| >= 155 | 160 | roundtable · usage 50 (one column, roundtable on top, a divider, then 3 usage rows) |
| >= 115 | 120 | roundtable · usage 32 |
| otherwise | 80 | none |

The left column is 26 wide at every tier. The main window starts at the same column at every tier and grows to the right up to 76. Each window edge costs one vertical line. If the main window would be under 30 cells the band keeps the old tab-row layout.

A right column with nothing to show is not drawn and its width goes to the roundtable, so there is no hole. At 200 with no full usage table the roundtable takes both. At 240 the same rule applies to the usage column (no `usage_full`) and the fleet column (no lanes and no memory).

## 2. The rows (r5: the menu row is the second-to-last band row, the quick row is the last; both sit next to the prompt)

From the top: **menu row**, top frame, body rows, bottom frame (with a foot title right-aligned in the left window, the card position `3/8`, and in the main window the one-line hint), **quick row**. The menu row is band row 0 and the quick row is always the last band row; only the body between the frames grows.

- Every tab except 待決 keeps the 12 rows: eight body rows (`BODY_ROWS = 8`), the first six (`MAIN_CONTENT_ROWS`) content, the seventh the divider `├───┤`, the eighth the progress row (inside the frame, not under it).
- r4 (a short band): the shell takes the rows the host gives, `min(maxRows, 12)`, 6 at least (`SHELL_MIN_ROWS`). Under 9 rows the frame is compact (no divider, no progress row): the card view lists the question and the options first, then the rest scrolled; the left window lists as many cards as fit. Under 6 rows the band is one hint line `待決 N 張 · 視窗高度不足（目前 M 列，需要 6 列）`. The console band and the framed pages take the shell whatever `legacyTabs` says and with or without a snapshot; the old tab-row band (legacyTabs, no console) keeps its strip and shows the shell only with a band tab open at 12 rows. Each change of maxRows or bodyColumns appends one JSON line `{ts, maxRows, bodyColumns, shellRows}` to `band-geometry.log` in the live dir. The band's source error (✗) counts only tasks, peers, cards and quota_now.
- The 待決 tab is the card view. It has **no right-hand columns** (`shellGeometry(.., noRight)`, shell.ts): the roundtable and the usage have their own tabs and are drawn there as before, so only this tab lost them; the main window takes every cell the band allows. The body is `N + 2` rows, `N = clamp(card rows, 6, rows - 6)`, so a long card grows the frame upward (total `N + 6 <= maxRows`); the menu row stays band row 0 and the quick row stays the last row.
- The card (`cardMain`, band.tsx) is shown whole: the question, 背景, then each option on its own line `N: <label> ✧  <description>` (✧ on the recommended option whether or not `why` is set; no digit hotkey). A description that does not fit wraps onto the next line, indented under the description column, and no row is wider than the main window. Split mode (a card taller than the frame) keeps the descriptions in the scrolling rows, each led by its option number, and the option names in the fixed strip. 建議 with its why, 不授權, then the note / typed-answer button. Nothing is cut with `…`. A sent or closed card puts its state line and the 改答案 button right under the question. When the card is drawn whole, a one-line background is padded to two rows so the first option sits on band row 5.
- A card taller than the frame (`rows - 6` body rows) is split (§12.10 of the design system, owner d-60e13bd4; `cardSplit`, band.tsx): the question, 背景, option descriptions (each led by its option's number), 建議, why and 不授權 scroll in a top-anchored window (`fixedWindow`, scrollmath.ts) with a one-cell scrollbar at the right (track `structure`, thumb `here`, `thumbOf`); under them stand one rule and the fixed strip: every option (name wrapped whole, ✧ after the last piece), the 附註／其他回答 or 打字回答 Button, and the page row (`↑ 還有 N 行 · ↓ 還有 M 行`, `scroll:up` / `scroll:down` Buttons, one page each). The strip never scrolls. A card that fits keeps the old order (each description right under its option). The strip has priority: at 12 rows it can leave the window one row, and a strip too tall for one window row plus the page row (six options at 12 rows), or a sent card (nothing to press), scrolls whole with the page row only. The offset is kept per tab (`bandScroll` in register.ts) and reset when the card changes. The tree is never taller than `maxRows`: a host that gets more opens a window of its own and hides the quick row behind `n more`, so the band draws no spare row; the page Buttons are the reliable way to scroll, the wheel and PgUp/PgDn reach `ui.scroll` only when the engine sends it.
- The scroll machinery is mods/live's own (`scrollmath.ts`, as the viewer and the pane use). codeforge's `pane-view.ts` (52ee3d2) was read but not copied: the repos are separate and live already has the same math.

## 3. Roundtable summary and `✦ N`

The roundtable column shows the newest room's last messages, one line each, newest at the foot, like a chat. `✦ N` in its title counts roundtable messages that someone other than the owner sent after the shell opened. The baseline is the newest seq seen when the shell opened; the owner's own rows never count.

## 4. The forge-stats panel reader

The shell only reads codeforge's `forge-stats.panel` (`codeforge.panel/1`); it never writes it.

- Missing file, broken JSON, or another schema: treated as no summary. Nothing is drawn from it.
- A `side` table that contains `$` is dropped whole (no money on the band). Only `side` is dropped: `usage` and `pet` are still drawn.
- Each of `side.usage`, `side.usage_full`, `side.memory` is read on its own; a broken one does not take the others down. A column is given the largest tier whose key fits its inner width, never one made for a wider column.
- Older than 60 seconds: the first row of the first right column reads "資料 N 分鐘前" (N rounded, at least 1).

## 5. `panel_open_at_ms`

While the shell is drawn the tick writes `autopilot.panel_open_at_ms` every 15 seconds; when the shell is closed (not drawn for 15 s) it stops. forge-stats treats the value as fresh for one minute, so the write interval must stay under 60 seconds.

## 6. Fleet fetch throttle (240 tier)

The 240 tier has a fleet column fed by the Fleet CLI (`fleet tasks --tree --json`). It fetches only while the shell is actually drawn (it counts as open for 15 s after its last draw), at most once per 30 s (`FLEET_TTL_MS`), and stops when the shell closes. The other tiers never fetch for the shell. Tests: `live.test.ts` "O4 shell fleet fetch" (3 cases x 2 surfaces).

## 7. The shell is the band's normal state

The shell is drawn whenever `maxRows >= 12` and the width holds a main window of 30 (`shellGeometry`), whether or not a band tab was pressed, whether or not `legacyTabs` or console mode is on, and whether or not the pane is open. The selected menu defaults to `d` (待決). Keys `d` / `r` / `u` / `p` / `h` and `9` change that menu; they do not open a pane page. When `legacyTabs` is off and `maxRows < 12`, the only fallback is one hint line (`待決 N 張 · 視窗高度不足 12 列（目前 M 列）`), never the old tab row plus a second pending list. When `legacyTabs` is on and `maxRows < 12`, the old two-row bar stays (the E1 suites). A band too narrow for a main window of 30 keeps that old bar too.

## 8. The 待決 card view (ux-v7)

- Left frame title: it says what the left column lists. In the card view it is the open tab's name (`待決`); a column that lists the tabs is titled `選單`.
- Left column: one row per pending question, `◐` the card in the main window (`here`), `⬥` an answered one (`action`, `done` once sent) with its answer right-aligned, `○` an open one. More than 8 cards scroll so the current one is visible. A press on a row goes to that card. The foot title is the position, `3/8`.
- Main window: the title is `第 n 張，共 N 張`. The first content row is the question (band row 2); two background rows follow, so the first option is band row 5. Each option is its own line `N: <label> ✧  <description>` (✧ whether or not `why` is set; the description wraps under its column). A card with no `title` uses the first sentence of its question (`cardSentenceOf`: cut at the first `。！？.!?;；` or before a `(1)` / `1.` list, and the whole question when that cut is empty) in the left list and would-be header; the main window still shows the full question. Each card id appears once in the left list; a step or look card keeps a `要你做` marker on that one line. Under the options one Button fills the prompt box: 附註／其他回答 on an option card, 打字回答 on a typed card (it replaces the grey line). The press is `$.prompt.fill` in `replace` mode and nothing else (never a submit): the box then holds `[待決回覆]` and the reply line up to the owner's text (`<id>｜<question excerpt> → <picked label or 都不選>｜補充：`, a typed card ends after the arrow, built by `decideFillText` so it is the line `decideLine` writes), and the owner types the note or the answer and presses Enter. No band Button takes a digit hotkey. The asker's own dialog card (`ask_user_question`) keeps the dim line and has no Button: its dialog answers it. The compact tab-row form (`legacyTabs` and fewer than 12 rows) has no such Button. The foot title names the options whose Button is actually drawn.
- A pick only selects and stays on the card.
- The side pane no longer renders a pending-decision page. Its 待決 tab stays (key `2`) and shows one line, `待決在 band 上（d）`. The shell is the only pending panel.
- Card states (bandsent): the card list is the pane's batch (`decidebatch.ts` `batchSync`, the same `DecideState`), kept in the band's own variable and closed when the tab is left. A card the owner sent says `已送出，等處理` (dim, on the row under the options, or in front of the question when the six rows are full), its question, options and list row are dim theme text, its options are plain text (no Button, no hotkey, no 附註 Button) and a `改答案` Button reopens it. A card in its undo window says `即將送出，可撤回`, has no option Buttons, and the quick row's `0` slot reads `撤回（剩 N 秒）` and takes it back. A card the session or the CLI closed stays in its place and its number, grey, with its question kept and the line `已在別處回答`, no Button; it is not counted in the progress meter or in `送出 N 張`. A card being corrected is open again and says nothing.
- Progress row: `▰▰▱▱▱▱▱▱ 2/8  ⬥ 上一張 <card> → <answer>`. One cell per card: sent is `done`, picked `action`, open `idle`. After a send with nothing left to send the tail reads `✓ 已送出 N 張` instead of the last card. From 160 columns `· 待送 N 張` follows, with the names in `（ ）` only when all of them fit (never half a name).

## 9. Quick row

`0: 送出 N 張 │ 7: 上一張 │ 8: 下一張 │ 9: 下一個選單` then the tip (`Esc 還給輸入框` at tier 80, `ctrl+x tab 拿鍵盤 · Esc 還給輸入框` above). The four slots have fixed widths (15, 12, 12, 16) so the keys sit at columns 1, 16, 28, 40 on the last band row at every tier. `0` sends the answered cards, `7`/`8` move, `9` goes to the next shell menu (`d → r → u → p → h`). The same four slots are drawn on every menu, including an empty 待決. The digits are label text, never hotkeys. The top menu row is `d: 待決 ⏶N ▾   r: 圓桌 N     u: 用量     p: 寵物     h: 說明`, and `待你動手 N` sits on that row (not in a window title). The pet menu may show `寵物：尚未接上`.

## 10. Coordinates

Relative to the band's first row (r5: the top frame is row 0, the menu row is second to last, the quick row last; older text below that says menu row = band row 0 now reads: question at band row 1, first option at row 4), at body widths 75, 115, 155, 195 and 235 (ux-v7 section 2): menu row = band row 0 (pre-r5); the question's first character at (band row 2, col 29); the first option's digit at (band row 5, col 31); quick-row `0` / `7` / `8` / `9` at columns 1 / 16 / 28 / 40 on the last band row; the left frame occupies columns 0–25; the main frame's border starts at column 27. No row is wider than `bodyColumns`. The card view draws two frames with one gap cell between them (left inner 24, not the joined 26), so the main window's inner width at body 75 is 46.

## 11. r5: menu at the bottom, collapse, fit ladder, tok/s

- **Rule (operator, rejection of r4 on 11-19):** the menu row (d 待決 / r / u / p / h) and the quick row (0/7/8/9) sit at the very bottom of the band, next to the prompt. Order: top frame, body, bottom frame, menu row, quick row. Why it matters: a top menu moved when the band changed height (real 2.1.328 pane: row 27 became row 30 after one answer), so the next click missed; at the bottom its distance from the prompt never changes (test `r5 D2`).
- **Collapse:** `d` on the 待決 menu collapses the band to ONE row (the menu row plus `待決 N 張 · 按 d 展開`); `d` again expands; r/u/p/h expand and select. Default is expanded; reset at session start. `band-geometry.log` lines carry `expanded` and the real row count (`shellRows`).
- **Height:** the host gives `maxRows` and the band uses all of it (49x209: 19; v5 measured 209x49 as 17 rows: the host's floor(rows/2) includes the prompt). Cards that do not fit shed in this order: padding and the 建議 reason row (tight), divider and progress row (compact), frames and left window (bare), then split and scroll. Priority options > 建議 > 不授權 > 背景.
- **Asking the host for rows is not possible (2.1.328, strings in the o4dbg2 dump, `cc328-strings.txt`):** `maxRows = min(rows, bandHeight + room)`, `room = Rt - height(wt) - height(So)`, `Rt = (vt||Pt) ? rows-2 : floor(rows/2)` (offset about 49518743). `vt` is true only for the `history-search` overlay; `Pt` for elicitation, elicitation-url, background-task-details, model-picker and prompt-help (offsets about 38689596-38689745). A mod-registered above-prompt band sets neither, and no band API requests an overlay or more rows.
- **Options and steps are one row each:** `N: label ✧  description` (hanging wrap); a question with (1)(2)(3) or 1. 2. 3. puts each step on its own row (`paraRows`).
- **tok/s** is drawn on the menu row (shell mode never drew the BandBar that carried it); a Button keyed `speed`.
- **Digits** are not hotkeys (a bare digit in an empty composer would press the Button): 1-5 and 0/7/8/9 are clickable; letters d/r/u/p/h work after `ctrl+x tab`.

## Sources

codeforge `feature/panel-side` at `ccd3a44`, `doc/specs/panel-band-contract.md`: section 1.1 (tiers), 1.3, 2 (reader) and 3. The card flow, the progress row and the quick row: the same branch at `6cb6061`, `doc/projects/2026-11-06-integrated-panel/ux-v7/design.md` and `BRIEF.md`.
