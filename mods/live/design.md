# O4 band shell: layout and rules

Status: written from `shell.ts`, `band.tsx` (`Shell`) and `register.ts` as of this commit. The contract lives in codeforge (see Sources). Two points are marked "待 codeforge 對照 ux-v7" because the contract does not settle them.

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
3. 4-9. seven content rows (`BODY_ROWS = 7`)
10. bottom frame
11. progress row
12. quick row

The outer frame uses rounded corners `╭ ╮ ╰ ╯` because `└` already means "sub-item" in the pane. Colour: the main window's lines are `here`, the other windows' `idle`, dividers `structure`; text colour only, no background, no inverse, no bold.

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

## 7. Open points

- 待 codeforge 對照 ux-v7: the shell appears only while a band tab is open.
- 待 codeforge 對照 ux-v7: the progress row draws only the `unit` slot.

## Sources

codeforge `feature/panel-side` at `ccd3a44`, `doc/specs/panel-band-contract.md`: section 1.1 (tiers), 1.3, 2 (reader) and 3.
