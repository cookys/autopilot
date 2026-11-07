# band 用量分頁的後續整理（BL-0424）

usagetab g1/g2 審查留下的 Suggestion，都是顯示面的小修：

1. 空的 tier 會蓋掉別的 tier：mods/live/shell.ts 的 `pickUsageTier`（錨點 `export function pickUsageTier`）挑到一個空陣列時，`usageRows` 會當成沒有版面，別的 tier 就被擋住。
2. 窄於 40 欄時退回最小 key：同一個函式在放不下任何 tier 時取最小的 key（錨點 `Math.min(...keys)`），內容再被截斷。
3. 指示符號 `›` 佔掉指示器 2 格，窄欄時吃掉內容寬度（用量分頁的列繪製，mods/live/band.tsx 的 `usageDraw` 一帶）。
4. 一個測試標題寫錯：mods/live/live.test.ts 約第 6441 行，錨點是標題原文 `at 90 columns and up forge is drawn and there is no`。錯誤是 en 在 90 欄時沒有用量分頁、`›` 還在；要到 91 欄（en）與 83 欄（zh-TW）以上才不會出現 `›`。測試本身的斷言是對的，只有標題寫錯。出處：usagetab g2 審查 db9a5e08。
5. mods/live/register.ts 的註解與程式漂移（錨點 `usageDraw(el, usageRows(panel, mainCols, MAIN_CONTENT_ROWS, t))` 附近）。

出處：usagetab 的 g1/g2 審查（2026-11-07）。
