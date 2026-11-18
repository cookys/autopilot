# Pane batch 2 / UX gate round 2 — evidence

Fleet-Task: 01M7PC93PGG8FQ28EMT6ZDP7NY

Base: `daedf7fbd824ef6f3e807ebc2cdfe0a2b846cb54`；分支 `fix/pane-g2c2`。
所有版本控制變更都在 `mods/live/`；本工作是呼叫端安排的實作席，提交後交由不同模型家族獨立審查。

## 1. 任務與驗收

修正 X5、Y2、Y4、Y6、Z1、Z3（不含分頁 0 標籤）、Z4。

| Finding | 驗收條件 |
| --- | --- |
| X5 | 空白只在內容上方；額度表格至詳情、動作與分頁列之間沒有空列；focus anchor 不增加分頁列後的列數。 |
| Y2 | console 卡保留背景、卡住、選項及說明、建議、補充的順序，顯示「到 h1 答」；本席不能選答、送出或填答。 |
| Y4 | 80×24 額度表在一般及 compact render 都有 7 天、5 時、預測的表頭；極短頁面的既有池資料優先順序保留。 |
| Y6 | 繪製只能使用 ui 語意色表的主題 token；執行期傳入的 ANSI/裸色碼不能穿透 drawSeg。 |
| Z1 | 子句標點優先於子句內空白；`statusline 沒在跑`、`· z 收合` 不被拆開，文字、顏色及寬度保持正確。 |
| Z3 | 無階段的專案雜湊標示「專案 …（讀不到狀態）」；中文上下文欄位使用「上下文」。 |
| Z4 | 本席與不可答卡在 80、120、160 欄的標題同列保留 `(1/3 · 1 天)`。 |

## 2. 定位與原始修改點

以下為 base 中的原文；最終差異由本提交的 diff 提供。

- X5 — `pages/frame.ts`: `const body = r.body.flatMap(x => wrapRow(x, ctx.size.cols, WRAP_HANG))`；`pane.tsx`: `{rows.map(drawRow)}{focusAnchor(el, epoch)}`。
- Y2 — `console.ts`: `return { id, question, status: status as ConsoleCard['status'], opened_at_ms, executor_display }`；`pages/decide.ts`: `if (wide) return [leftRight([mark, seg(c.id + ' ' + pos + '  ' + c.question)], ...)]`。
- Y4 — `pages/quota.ts`: `if (!ctx.shortBody) {` 同時包住章節標題與欄位表頭；compact 分支為 `const picked = pickPools(Math.max(0, room - vLen), tier === 'narrow')`。
- Y6 — `ui.ts`: `return { color: s.color, bold: s.bold, dimColor: s.dim }`。現有 PALETTE 已是主題 token；此修正補上執行期邊界，沒有更換語意角色或宣稱截圖驗收。
- Z1 — `pages/rows.ts`: `while (k > i && !CLAUSE_END.test(chars[k - 1].ch)) k--`，其中 `CLAUSE_END` 同時包含標點與空白。
- Z3 — `pages/now.ts`: `const proj = d.project ?? live.project_key` 與 `'ctx ' + live.metrics.ctx`；`locales/zh-TW.json`: `"header.ctx": "ctx"`。
- Z4 — `pages/decide.ts`: `seg(id0 + pos + '  ' + d.question + old)`；窄版把 `id0 + pos` 放在第二列。

## 3–4. 逐項紅測、最小修正與驗證

先後順序是 X5 → Y2 → Y4 → Z1 → Z3 → Z4 → Y6。
每項先加入 finding id 命名的測試，透過真實 Claude 2.1.327 的 `plugin test` 執行，確認行為斷言失敗後才修改產品碼。
focused wrapper 使用與 `run-tests.sh` 相同的 plugin manifest、hooks module 與 `mods_run_plugin_test` 隔離環境，只選取指定的測試檔；沒有模型呼叫。

| Finding | 修改前 plugin test exit | 修改後 plugin test exit |
| --- | ---: | ---: |
| X5（兩個測試） | 1 | 0 |
| Y2 | 1 | 0 |
| Y4 | 1 | 0 |
| Z1 | 1 | 0 |
| Z3 | 1 | 0 |
| Z4 | 1 | 0 |
| Y6 | 1 | 0 |

focused runner 輸出（僅移除行尾空白）與 exit code 收錄於 [red-green.txt](red-green.txt)。
最終相同的八個測試，在暫存 wrapper 換回 immutable base 的產品碼後：`0 pass / 8 fail`，exit **1**；失敗都是行為斷言，沒有 import/collect 錯誤。
受影響範圍擴大驗證為 **519 pass / 0 fail，18 files，exit 0**。

既有測試只更新 finding 指定改變的精確期望值並註明 id：Z3 的上下文文案、Z4 的標題進度與天數位置、Y2 的回答目的地、X5 的空列位置。
gate3 保留池數、列格式與寬度斷言，改用詳情標題結束表格並新增無空列斷言；現況溢位 fixture 增加真實項目以繼續驗證溢位。沒有刪除或跳過既有測試。

## 5. 最終驗證

真實 Claude 版本為呼叫者指定的 **2.1.327**。等價重跑命令（`CLAUDE_2_1_327` 指向呼叫者提供的絕對路徑）：

```bash
AUTOPILOT_MODS_REAL_CLAUDE="$CLAUDE_2_1_327" bash mods/live/run-tests.sh < /dev/null
node --test mods/live/ui-lint.test.js
node mods/live/gen-locales.js --check
```

| 驗證 | exit code | 實際結果 |
| --- | ---: | --- |
| 修改前完整 live suite | 1 | 15 個已接受 baseline 失敗。 |
| 最終完整 live suite | 1 | 1539 pass / 15 fail，1554 tests / 41 files；15 個失敗名稱與 baseline 完全一致。 |
| baseline 與新測試驗收比對 | 0 | 失敗數 ≤15、零新增失敗、八個新測試全部通過。 |
| `node --test mods/live/ui-lint.test.js` | 0 | 56 pass / 0 fail。 |
| `node mods/live/gen-locales.js --check` | 0 | 產生檔與語系 JSON 一致。 |
| focused affected plugin test | 0 | 519 pass / 0 fail，18 files。 |
| 最終測試套回 immutable base | 1 | 0 pass / 8 個 assertion fail（預期紅燈）。 |
| `git diff --check` | 0 | 無空白格式錯誤。 |

摘要、八個新測試 PASS 行、baseline/最終相同的失敗名稱，以及 lint 輸出見 [verification.txt](verification.txt)。
第一輪完整驗證曾有 17 個失敗：15 個 baseline 加上 gate3 與花費 golden 的舊空列假設；已在 X5 內修正精確測試期望，第二輪完整驗證回到同一組 15 個 baseline 失敗。
提交使用設定好的 `.githooks/pre-commit`，不使用 `--no-verify`。

## 逐檔變更原因

- `mods/live/console.ts` — Y2：以型別檢查保留不可答卡的背景、卡住、選項與建議。
- `mods/live/pane.tsx` — X5：focus anchor 併入最後分頁列。
- `mods/live/ui.ts` — Y6：drawSeg 只接受語意色表中的主題 token。
- `mods/live/pages/frame.ts` — X5：移除內容空列，把剩餘空間留在內容上方。
- `mods/live/pages/decide.ts` — Y2/Z4：共用完整卡片內容並禁用不可答卡選答；標題保留進度與天數。
- `mods/live/pages/quota.ts` — Y4：compact 額度表保留精簡欄位表頭。
- `mods/live/pages/rows.ts` — Z1：優先在子句邊界斷行，讓中點跟隨後面的提示。
- `mods/live/pages/now.ts` — Z3：補上未知專案狀態說明並使用翻譯後的上下文欄名。
- `mods/live/locales/zh-TW.json` — Y2/Z3：繁體中文回答目的地、專案狀態與上下文文案。
- `mods/live/locales/en.json` — Z3：補上同一新翻譯 key 的英文對應。
- `mods/live/locales.ts` — 由 gen-locales.js 重新產生翻譯表。
- `mods/live/pages/ux-gate2.test.ts` — X5/Y2/Y4/Z1/Z3/Z4：七個頁面與 frame 行為紅測。
- `mods/live/ux-gate2.test.ts` — Y6：語意色 token 與裸色碼邊界紅測。
- `mods/live/live.test.ts` — Z3：更新中文上下文的精確斷言及雙語 header 尋找器。
- `mods/live/pages/now.test.ts` — Z3/X5：更新上下文 golden，增加溢位資料量。
- `mods/live/pages/decide.test.ts` — Z4/Y2：更新標題 metadata golden 與不可答卡回答目的地斷言。
- `mods/live/pages/batch2-mn.test.ts` — Z4：進度改在標題同列驗證。
- `mods/live/gate3.test.ts` — X5：表格以詳情標題為邊界，保持池列數與格式驗證。
- `mods/live/pages/spend.test.ts` — X5：精確驗證寬版的原內容空列已移到上方。
- `mods/live/ux-gate2-evidence/red-green.txt` — 保存逐項紅綠及 immutable-base 負對照輸出（僅移除行尾空白）。
- `mods/live/ux-gate2-evidence/verification.txt` — 保存 baseline/最終完整套件、lint 與驗收摘要。
- `mods/live/ux-gate2-evidence/receipt.md` — 任務範圍、修改點、逐檔原因與驗證證據索引。

## 未做／範圍外

- 不改分頁 0 標籤或其他批次 findings。
- 不修改 `mods/live/` 以外的檔案，不改版本、CHANGELOG、追蹤圖或其他分支。
- 不修已接受的 15 個 baseline 失敗。
- 不補拍淺色主題截圖：依任務由 codeforge 補拍；此提交不宣稱白底視覺驗收已完成。
- 不送出卡片、不發送訊息、不發布、不合併；獨立異模型審查由呼叫端接續。
