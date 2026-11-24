# 操作員「我問你的」清單（Operator Asks List）實作計畫

- **Fleet 單號**：`01M85TGX63`（Fleet-Task: `01M85TGX639NV8DHSJ391JD3XW`）
- **目標上線日**：2026-12-01（上線一週後 2026-12-08 量測成效）
- **依據**：PM 分析報告（18 個 session、2168 筆操作員訊息，重問率下限 15.7%，可完全避免約 54.6%）。

## 1. 目標與里程碑

讓操作員在 pane「我問你的」固定看到每件問過的事、狀態、最新答案與更新時間，不因訊息洗版而重問。

- **M1（資料層機械化）**：`askpm.jsonl` 支援同題合併、自動寫入 `reply` 與 `disposition`（`progress`/`close`）。
- **M2（介面與對接）**：`mods/live/askpm.ts` 擴充欄位並定義與 codeforge pane 底部熱區及 fleet `origin=operator` 的資料契約。
- **M3（上線與驗收）**：PM 席啟用並觀察一週，重問率明顯下降。

## 2. 資料模型與事件契約

於 `mods/live/askpm.ts`（現行僅有 `at`、`summary`、`replyLines`、`status`：`open`/`waiting`/`replied`）擴充為：
- **身分與群組**：`task` ULID 不唯一識別一題。每筆 ask 的主鍵為 `ask_id`（`askpm.jsonl` 已有 `ask_id` 欄位，格式 `a-<8-hex>`）；`group_key` 僅為合併用的視圖鍵——已綁 task 者以 task ULID，未綁者以「正規化問題文字」（去空白與標點、轉小寫、取前 80 字）。未綁群組於綁定 task 時併入該 task 群組；同群組 14 天無新問則封存。
- **呈現欄位**：問題摘要（≤40 字）與合併次數（`count`）、狀態（`未答` `open`／`已答` `replied`／`進行中＋綁定 task` `in_progress` + `task_id`）、最新答案一行（`reply` 第一行非空摘要）、更新時間（`taipeiStamp`，`YYYY-MM-DD HH:MM:SS`）。
- **事件契約與重算**：`askpm.jsonl` 事件類型為 `ask`、`reply`、`progress`、`close`、`supersede`；視圖由事件序重算，以事件時間排序、最後事件勝出。舊 2079 筆採讀取相容：缺欄補預設（`count=1`、無 `group_key` 者以正規化文字即時算），不做一次性回填。

## 3. 四個缺口與修法

1. **同一題重問合併成一筆並先回顯原答案**
   - **現況**：`hooks/askpm-log.js` 每次 `UserPromptSubmit` 皆新增一筆 `ask`；`mods/live/askpm.ts`（L13-14）僅顯示最近 5 筆（窄面板 3 筆），同題重問會洗掉其他問題。
   - **修法**：以 `group_key`（規則見第 2 節，或 `supersede` 關聯）合併同題，累加 `count` 並更新最近時間；若該 `group_key` 已有 `reply`，在 `UserPromptSubmit`（`hooks/advisory-relay.js`）注入 `additionalContext` 先回顯原答案與更新時間。
2. **disposition 紀錄 0 筆的原因與補法**
   - **現況**：`scripts/pm-ask.js`（L157-200）已實作 `close`/`progress`/`supersede`，但 `askpm.jsonl` 中 `disposition` 為 0 筆，主因全靠 PM 人工呼叫 CLI，未自動化。
   - **修法**：機械化觸發——(a) PM 派工建立或關聯 fleet task 時自動呼叫 `pm-ask.js progress <ask_id> --task <ulid>`；(b) `Stop` hook（`hooks/askpm-log.js`）不得只憑回覆含 commit sha／卡 id／URL 就自動 `close`，改為「該 ask 已綁 task 且 task 狀態為 `done`」或「操作員明講已收到／可關」二擇一才 `close`，其餘一律只更新 `progress`；(c) 既有 `pm-ask.js overdue --hours 24` 供巡檢曝光拖延。
3. **reply 覆蓋率 38% 機械化補齊**
   - **現況**：`askpm.jsonl` 有 2079 筆 `ask`、僅 791 筆 `reply`（38%）。`hooks/askpm-log.js`（L26-32）在 `UserPromptSubmit` 透過 `hooks/advisory-relay.js` 執行，而 `Stop` 透過 `hooks/opt-in-multiplexer.js`（`hooks/hooks.json`）執行；工作中插話（`queued_command`）與純工具回合常導致 `Stop` 未寫入 `reply`。
   - **修法**：不靠 PM 自律，全部機械化掛在 hook：
     - `hooks/askpm-log.js` 的 `Stop` 處理器：當 `last_assistant_message` 為空（純工具回合）時，回溯同 turn 最後一則含文字的 assistant 訊息或工具摘要寫入 `reply`。同 session 多筆未結 ask 時，`reply` 掛到「該 turn 開頭的 `UserPromptSubmit` 所建立的 `ask_id`」，而非最新未結；插話（`queued_command`）各自對自己的 `ask_id`。既有另一個 reply 寫入者 `hooks/askpm-remind.js` 由 `askpm-log.js` 在 `askpm-remind` 啟用且通過 PM console gate 時讓出寫入權，且同 `ask_id` 同 turn 只寫一次，避免雙寫。
     - `hooks/advisory-relay.js`（`UserPromptSubmit`）：捕捉工作中插話（`queued_command`）並保留未結 `ask_id` 的清單（非單一值），確保後續 `Stop` 能對應寫入 `reply`。
4. **面板位置與 fleet `origin=operator` 對接（只寫介面需求）**
   - **面板位置**：`mods/live/askpm.ts`（L3 註明 `Panel placement is paused`）。解除暫停後，放置於 pane 底部靠近提示列的熱區；**幾何排版歸 codeforge**，autopilot 僅透過 `askpmLines(view, u, folded)`（`mods/live/askpm.ts` L92）提供資料與折疊狀態。清單只在 PM 席與操作員 pane 可見，不進 web／alfred 共用介面。
   - **fleet `origin=operator`**：目前 repo 內未查到 `origin=operator` 的正式欄位契約（「未查到」）。codeforge 的 pane 幾何與 fleet 的 `origin=operator` 契約皆為 T4 的前置相依；契約缺席時，視圖只顯示本機 askpm 項目並標示「fleet 項目未接」。本席在凍結前各送一則介面問題（owner：`autopilot--claude`）。

## 4. 子工作切分（每件 ≤ S）

| 編號 | 子工作 | 大小 | 可平行 | 驗收與負控制 |
|---|---|---|---|---|
| T1 | `hooks/askpm-log.js` + `hooks/advisory-relay.js` 補齊 `reply`（純工具回合與插話） | S | 可與 T2 平行 | 驗收：模擬純工具回合 `Stop` 後 `askpm.jsonl` 必有 `reply`；負控制：injected `turn` 不得寫入 `reply`。 |
| T2 | `scripts/pm-ask.js` 新增 `group_key` 合併與同題計數 | S | 可與 T1 平行 | 驗收：同 `group_key` 問 3 次僅佔 1 筆且 `count=3`；負控制：不同 `group_key` 不得誤併。 |
| T3 | `hooks/askpm-log.js` 自動寫入 `disposition`（`progress`/`close`） | S | 依賴 T2 | 驗收：綁定 task 且狀態 `done` 或操作員明講已收到／可關時標 `close`，其餘只更新 `progress`；負控制：僅含 commit sha／卡 id／URL 不得誤標 `close`。 |
| T4 | `mods/live/askpm.ts` 擴充 4 欄位與 `origin=operator` 合併介面 | S | 依賴 T2、T5 | 驗收：`askpmLines` 輸出含問題、狀態、最新答案一行、更新時間（契約缺席時僅顯示本機 askpm 並標示「fleet 項目未接」）；負控制：無 `reply` 時顯示「未答」而非空字串。 |
| T5 | 對接文件：codeforge 底部熱區幾何需求 + fleet `origin=operator` 契約（凍結前送出介面問題，owner：`autopilot--claude`） | XS | 可與 T1/T2 平行 | 驗收：雙方確認欄位清單與 `ASKPM_SECTION`；負控制：本單不修改 codeforge 幾何實作。 |
| T6 | 重問時於 `UserPromptSubmit` 以 `additionalContext` 先回顯原答案與更新時間 | S | 依賴 T2 | 驗收：同題第二次問時注入內容含原答案一行與時間；負控制：拿掉注入時測試轉紅。 |

## 5. 風險、不做什麼與成效量法

- **風險**：(1) 同題合併若關鍵詞過寬可能誤併不同子問題（如 ThinkSmart 的 ssh 與 buildroot）；解法是以 `ask_id` 為主鍵、`group_key` 僅作視圖合併，未綁群組只在正規化文字完全相同時合併。(2) `Stop` hook 若讀取過大 transcript 可能逾時；每次最多回讀 200 行或 256 KB（取小者）。(3) `askpm.jsonl` 並發寫入採 append 單行原子寫，保留 90 天後歸檔。
- **不做什麼**：不將 capacity 帳號池用量與全線狀況等即時輪詢數字放進清單（走常駐 widget / `fleet pm status`，清單僅放連結）；清單只在 PM 席與操作員 pane 可見，不進 web／alfred 共用介面；不在本單實作 codeforge 面板幾何或修改 fleet 核心程式。
- **成效量法**：上線後 7 天（2026-12-08）由本席所寫 `scripts/ask-repeat-rate.js`（唯讀 `askpm.jsonl`，排除合成回覆）判定：**重問率**（同一 `group_key` 在 7 天內再被問的比例）從基線 **15.7%** 降到 **≤ 8%**（約減半）且 `reply` 覆蓋率 **≥ 90%**（基線 38%）即為 PASS。
