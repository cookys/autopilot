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

## 2. The 12 rows

1. menu row (the tab strip)
2. top frame
3-10. eight body rows (`BODY_ROWS = 8`). In the main window the first six (`MAIN_CONTENT_ROWS`) are content, the seventh is the divider `├───┤` and the eighth is the progress row. The progress row is inside the frame, not under it.
11. bottom frame, with a foot title right-aligned in the left window (the card position, `3/8`) and in the main window (the one-line hint)
12. quick row

The outer frame uses rounded corners `╭ ╮ ╰ ╯` because `└` already means "sub-item" in the pane. The divider joins the frame with `├` and `┤` at the main window's edges. Colour: the main window's lines are `here`, the other windows' `idle`, dividers `structure`; text colour only, no background, no inverse, no bold.

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

## 7. The shell appears only while a band tab is open

With no tab open, under 12 rows, or too narrow for a main window of 30, the band keeps the old layouts. codeforge confirmed this against ux-v7.

## 8. The 待決 card view (ux-v7)

- Left column: one row per pending question, `◐` the card in the main window (`here`), `◆` an answered one (`action`, `done` once sent) with its answer right-aligned, `○` an open one. More than 8 cards scroll so the current one is visible. A press on a row goes to that card. The foot title is the position, `3/8`.
- Main window: the title is `第 n 張，共 N 張`. Row 1 is the question; two background rows follow (the text is one line when narrow and two from 160, the second row stays blank otherwise, so the options sit on the same rows at every tier; the area gives rows back only when the options would not fit); then the options as hotkey Buttons `1`-`6` (the label padded to 10 cells inside the Button, `★` marks the recommended one, the description is dim, a picked one carries `◆`). A card the band cannot answer (typed text or the asker's own dialog) shows one dim line instead of options. The foot title is `按 1–n 直接選，選完換下一張`.
- A pick moves to the next card (it stops at the last one).
- Progress row: `▰▰▱▱▱▱▱▱ 2/8  ◆ 上一張 <card> → <answer>`. One cell per card: sent is `done`, picked `action`, open `idle`. After a send with nothing left to send the tail reads `✓ 已送出 N 張` instead of the last card. From 160 columns `· 待送 N 張` follows, with the names in `（ ）` only when all of them fit (never half a name).

## 9. Quick row

`0: 送出 N 張 │ 7: 上一張 │ 8: 下一張 │ 9: 下一個選單` then the tip (`Esc 還給輸入框` at 80, `ctrl+x tab 拿鍵盤 · Esc 還給輸入框` above). The four slots have fixed widths (15, 12, 12, 16) so the keys sit at columns 1, 16, 28, 40 at every tier. `0` sends the answered cards, `7`/`8` move, `9` goes to the next band tab. The other tabs keep their own quick row (the open-panel button).

## 10. Coordinates

Question, options, highlight and the four quick keys are at the same row and column at all five tiers (ux-v7 design section 2). Measured on the real terminal by `coords.js`; the table is in `band-shots/index.md`.

## Sources

codeforge `feature/panel-side` at `ccd3a44`, `doc/specs/panel-band-contract.md`: section 1.1 (tiers), 1.3, 2 (reader) and 3. The card flow, the progress row and the quick row: the same branch at `6cb6061`, `doc/projects/2026-11-06-integrated-panel/ux-v7/design.md` and `BRIEF.md`.
