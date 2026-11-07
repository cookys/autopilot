# band 用量分頁的後續整理（BL-0424）

usagetab g1/g2 審查留下的 Suggestion，都是顯示面的小修：

1. 空的 tier 會蓋掉別的 tier：mods/live/shell.ts 的 `pickUsageTier`（錨點 `export function pickUsageTier`）挑到一個空陣列時，`usageRows` 會當成沒有版面，別的 tier 就被擋住。
2. 窄於 40 欄時退回最小 key：同一個函式在放不下任何 tier 時取最小的 key（錨點 `Math.min(...keys)`），內容再被截斷。
3. 指示符號 `›` 佔掉指示器 2 格，窄欄時吃掉內容寬度（用量分頁的列繪製，mods/live/band.tsx 的 `usageDraw` 一帶）。
4. 一個測試標題寫錯（mods/live/live.test.ts 或 mods/live/shell.test.js 內用量分頁的測試，開工時以 `git grep -n usage` 找出）。
5. mods/live/register.ts 的註解與程式漂移（錨點 `usageDraw(el, usageRows(panel, mainCols, MAIN_CONTENT_ROWS, t))` 附近）。

出處：usagetab 的 g1/g2 審查（2026-11-07）。
