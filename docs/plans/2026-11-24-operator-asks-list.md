# 操作員「我問你的」清單（Operator Asks List）實作計畫

- **Fleet 單號**：`01M85TGX63`（Fleet-Task: `01M85TGX639NV8DHSJ391JD3XW`）
- **目標上線日**：2026-12-01（上線一週後 2026-12-08 量測成效）
- **依據**：PM 分析報告（18 個 session、2168 筆操作員訊息，重問率下限 15.7%，可完全避免約 54.6%）。

## 1. 目標與里程碑

讓操作員在 pane「我問你的」固定看到每件問過的事、狀態、最新答案與更新時間，不因訊息洗版而重問。

- **M1（資料層機械化）**：`askpm.jsonl` 支援同題合併、自動寫入 `reply` 與 `disposition`（`progress`/`close`）。
- **M2（介面與對接）**：`mods/live/askpm.ts` 擴充欄位並定義與 codeforge pane 底部熱區及 fleet `origin=operator` 的資料契約。
- **M3（上線與驗收）**：PM 席啟用並觀察一週，重問率明顯下降。

## 2. 資料模型（每筆最少欄位）

於 `mods/live/askpm.ts`（現行僅有 `at`、`summary`、`replyLines`、`status`：`open`/`waiting`/`replied`）擴充為：
- **問題**：問題摘要（≤40 字）與合併次數（`count`）。
- **狀態**：`未答`（open）／`已答`（replied）／`進行中＋綁定 task`（in_progress + `task_id` ULID，來自 `pm-ask.js progress`）。
- **最新答案一行**：`reply` 第一行非空摘要。
- **更新時間**：台北時間（`taipeiStamp`，`YYYY-MM-DD HH:MM:SS`）。

## 3. 四個缺口與修法

1. **同一題重問合併成一筆並先回顯原答案**
   - **現況**：`hooks/askpm-log.js` 每次 `UserPromptSubmit` 皆新增一筆 `ask`；`mods/live/askpm.ts`（L13-14）僅顯示最近 5 筆（窄面板 3 筆），同題重問會洗掉其他問題。
   - **修法**：以 `group_key`（優先綁定 `fleet task ULID`，未綁定者以正規化問題前綴或 `supersede` 關聯）合併同題，累加 `count` 並更新最近時間；若該 `group_key` 已有 `reply`，在 `UserPromptSubmit`（`hooks/advisory-relay.js`）注入 `additionalContext` 先回顯原答案與更新時間。
2. **disposition 紀錄 0 筆的原因與補法**
   - **現況**：`scripts/pm-ask.js`（L157-200）已實作 `close`/`progress`/`supersede`，但 `askpm.jsonl` 中 `disposition` 為 0 筆，主因全靠 PM 人工呼叫 CLI，未自動化。
   - **修法**：機械化觸發——(a) PM 派工建立或關聯 fleet task 時，由派工腳本自動呼叫 `pm-ask.js progress <ask_id> --task <ulid>`；(b) `Stop` hook（`hooks/askpm-log.js`）若偵測回覆含結案證據（commit sha / 卡 id `d-xxxxxxxx` / URL）自動寫入 `close`；(c) 既有 `pm-ask.js overdue --hours 24` 供巡檢曝光拖延。
3. **reply 覆蓋率 38% 機械化補齊**
   - **現況**：`askpm.jsonl` 有 2079 筆 `ask`、僅 791 筆 `reply`（38%）。`hooks/askpm-log.js`（L26-32）在 `UserPromptSubmit` 透過 `hooks/advisory-relay.js` 執行，而 `Stop` 透過 `hooks/opt-in-multiplexer.js`（`hooks/hooks.json`）執行；工作中插話（`queued_command`）與純工具回合常導致 `Stop` 未寫入 `reply`。
   - **修法**：不靠 PM 自律，全部機械化掛在 hook：
     - `hooks/askpm-log.js` 的 `Stop` 處理器：當 `last_assistant_message` 為空（純工具回合）時，回溯同 turn 最後一則含文字的 assistant 訊息或工具摘要寫入 `reply`。
     - `hooks/advisory-relay.js`（`UserPromptSubmit`）：補捉工作中插話（`queued_command`）並保留未結 `ask_id`，確保後續 `Stop` 能對應寫入 `reply`。
4. **面板位置與 fleet `origin=operator` 對接（只寫介面需求）**
   - **面板位置**：`mods/live/askpm.ts`（L3 註明 `Panel placement is paused`）。解除暫停後，放置於 pane 底部靠近提示列的熱區；**幾何排版歸 codeforge**，autopilot 僅透過 `askpmLines(view, u, folded)`（`mods/live/askpm.ts` L92）提供資料與折疊狀態，並同步輸出至網頁/alfred 共用資料介面（避免 pane 故障時無法查看）。
   - **fleet `origin=operator`**：目前 repo 內未查到 `origin=operator` 的正式欄位契約（「未查到」）。介面需求：fleet task 查詢介面需支援以 `origin=operator` 過濾並回傳 `{ task_id, title, status, updated_at, last_note }`，由 `askpmView` 依 `task_id` 合併進同一份清單。

## 4. 子工作切分（每件 ≤ S）

| 編號 | 子工作 | 大小 | 可平行 | 驗收與負控制 |
|---|---|---|---|---|
| T1 | `hooks/askpm-log.js` + `hooks/advisory-relay.js` 補齊 `reply`（純工具回合與插話） | S | 可與 T2 平行 | 驗收：模擬純工具回合 `Stop` 後 `askpm.jsonl` 必有 `reply`；負控制：injected `turn` 不得寫入 `reply`。 |
| T2 | `scripts/pm-ask.js` 新增 `group_key` 合併與同題計數 | S | 可與 T1 平行 | 驗收：同 `group_key` 問 3 次僅佔 1 筆且 `count=3`；負控制：不同 `group_key` 不得誤併。 |
| T3 | `hooks/askpm-log.js` 自動寫入 `disposition`（`progress`/`close`） | S | 依賴 T2 | 驗收：回覆含 `d-12345678` 或綁定 task 時自動產生 `disposition`；負控制：無證據文字不得誤標 `close`。 |
| T4 | `mods/live/askpm.ts` 擴充 4 欄位與 `origin=operator` 合併介面 | S | 依賴 T2 | 驗收：`askpmLines` 輸出含問題、狀態、最新答案一行、更新時間；負控制：無 `reply` 時顯示「未答」而非空字串。 |
| T5 | 對接文件：codeforge 底部熱區幾何需求 + fleet `origin=operator` 契約 | XS | 可與 T1/T2 平行 | 驗收：雙方確認欄位清單與 `ASKPM_SECTION`；負控制：本單不修改 codeforge 幾何實作。 |

## 5. 風險、不做什麼與成效量法

- **風險**：(1) 同題合併若關鍵詞過寬可能誤併不同子問題（如 ThinkSmart 的 ssh 與 buildroot）；解法是以 `task_id` 為主鍵，文字僅作輔助。(2) `Stop` hook 若讀取過大 transcript 可能逾時；需限制掃描尾端行數。
- **不做什麼**：不將 capacity 帳號池用量與全線狀況等即時輪詢數字放進清單（走常駐 widget / `fleet pm status`，清單僅放連結）；不在本單實作 codeforge 面板幾何或修改 fleet 核心程式。
- **成效量法**：上線一週後（2026-12-08）以同一分析口徑重跑 PM 席 transcript，比較**重問率**（基線下限 **15.7%**，報告指出可完全避免約 **54.6%**／約 **55%**）與 `askpm.jsonl` 的 `reply` 覆蓋率（基線 **38%**，目標 ≥ 90%）。
