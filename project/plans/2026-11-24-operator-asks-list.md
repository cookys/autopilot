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
- **身分與群組**：`task` 綁定只是 metadata，不是問題身分。每筆 ask 主鍵為 `ask_id`（`a-<8-hex>`）；`group_key` 為「完整正規化問題文字（去空白與標點、轉小寫、不截斷）的 SHA-256 前 16 碼」，在同一 session 家族或同一操作員範圍內比對。綁定 `task` 時同一 `task` 下不同問題仍維持不同 group；未綁群組於綁定 `task` 後仍可合併同 `group_key` 且舊事件可追溯。滿 14 天無新問產生封存標記；封存群組若再收到同 `group_key` 新問，重開為 `open` 並延續累計 `count`。
- **呈現欄位**：問題摘要（≤40 字）與合併次數（`count`）、狀態（`open`／`replied`／`in_progress` + `task_id`；舊狀態 `waiting` 映射為 `open`）、最新答案一行（`reply` 第一行非空摘要）、更新時間（`taipeiStamp`，`YYYY-MM-DD HH:MM:SS`，取該群組最新事件時間）。
- **事件契約與重算**：保留既有 `pm-ask` 的 `kind=disposition` 外殼並將新事件類型放進 `action`（`loadState` 與 `askpm-remind` 實際位置未查到，均沿用此結構）。視圖由事件序重算，同時間戳依行序（後者勝出）；遇單行壞列記警示並跳過，不中斷視圖。舊記錄缺 `ask_id` 者以「行序＋文字雜湊」賦予合成身分；未帶 key 的舊 `reply` 依同 `session_id` 最近未結 `ask` 歸屬，否則標 `ambiguous`。
  - **事件範例**：
    - `ask`: `{"kind":"disposition","action":"ask","ask_id":"a-1a2b3c4d","group_key":"9f8e7d6c5b4a3210","session_id":"s1","turn":3,"ts":"2026-11-24T10:00:00Z","text":"..."}`
    - `reply`: `{"kind":"disposition","action":"reply","ask_id":"a-1a2b3c4d","session_id":"s1","turn":3,"ts":"2026-11-24T10:01:00Z","text":"..."}`（無法唯一歸屬時加 `"ambiguous":true`）
    - `progress`: `{"kind":"disposition","action":"progress","ask_id":"a-1a2b3c4d","task_id":"01J...","ts":"2026-11-24T10:02:00Z"}`
    - `close`: `{"kind":"disposition","action":"close","ask_id":"a-1a2b3c4d","ts":"2026-11-24T10:05:00Z"}`（終態）
    - `supersede`: `{"kind":"disposition","action":"supersede","ask_id":"a-1a2b3c4d","by":"a-5e6f7a8b","ts":"2026-11-24T10:06:00Z"}`（終態）
  - **Reducer 轉移**：`ask` → `open`；`reply`（非 `ambiguous`）→ `replied`；`progress` → `in_progress`；`close` / `supersede` → 終態（不可逆，除非同 `group_key` 新問重開）。

## 3. 四個缺口與修法

1. **同一題重問合併成一筆並先回顯原答案**
   - **現況**：`hooks/askpm-log.js` 每次 `UserPromptSubmit` 皆新增一筆 `ask`；`mods/live/askpm.ts`（L13-14）僅顯示最近 5 筆（窄面板 3 筆），同題重問會洗掉其他問題。
   - **修法**：以 `group_key`（規則見第 2 節，或 `supersede` 關聯）合併同題，累加 `count` 並更新最近時間；若該 `group_key` 已有 `reply`，在 `UserPromptSubmit`（`hooks/advisory-relay.js`）注入 `additionalContext` 先回顯原答案與更新時間。
2. **disposition 紀錄 0 筆的原因與補法**
   - **現況**：`scripts/pm-ask.js`（L157-200）已實作 `close`/`progress`/`supersede`，但 `askpm.jsonl` 中 `disposition` 為 0 筆，主因全靠 PM 人工呼叫 CLI，未自動化。
   - **修法**：機械化觸發——(a) PM 派工建立或關聯 fleet task 時自動呼叫 `pm-ask.js progress <ask_id> --task <ulid>`（`ask_id→task` 權威關聯來源為派工整合點，實際位置未查到，查不到則降級為未綁）；(b) `Stop` hook（`hooks/askpm-log.js`）不得只憑回覆含 commit sha／卡 id／URL 就自動 `close`，改為「該 ask 已綁 task 且 task 狀態為 `done`」或「操作員明講已收到／可關（僅於同回合唯一未結時自動歸屬；多筆未結時不關、列出請操作員指明）」二擇一才 `close`，其餘一律只更新 `progress`；未綁 `task` 的 `ask` 不要求 `task progress`，維持 `open` 或 `replied`；(c) 既有 `pm-ask.js overdue --hours 24` 供巡檢曝光拖延。
3. **reply 覆蓋率 38% 機械化補齊**
   - **現況**：`askpm.jsonl` 有 2079 筆 `ask`、僅 791 筆 `reply`（38%）。`hooks/askpm-log.js`（L26-32）在 `UserPromptSubmit` 透過 `hooks/advisory-relay.js` 執行，而 `Stop` 透過 `hooks/opt-in-multiplexer.js`（`hooks/hooks.json`）執行；工作中插話（`queued_command`）與純工具回合常導致 `Stop` 未寫入 `reply`。
   - **修法**：不靠 PM 自律，全部機械化掛在 hook：
     - **session＋turn 關聯契約**：每筆 `ask` 事件記 `session_id` 與 `turn` 序；插話（`queued_command`）在被 `advisory-relay` 捕捉當下就寫 `ask` 事件並進待答清單，其 `reply` 由清單消費時的下一次 `Stop` 寫入，不得掛到主回合 `ask_id`；多筆未結同時存在、無法唯一歸屬時，`reply` 事件標 `ambiguous` 並不關閉任何 `ask`。
     - **冪等與雙寫防護**：兩個 `reply` 寫入者（`replyGate`／`writeReply` 所有呼叫端，含 `hooks/askpm-remind.js`；實際位置未查到）皆套同一契約，以 `(ask_id, turn)` 為持久冪等鍵；「查是否已寫過」與 append 必須在同一把檔案鎖內完成。當 `last_assistant_message` 為空（純工具回合）時，回溯同 turn 最後一則含文字的 assistant 訊息或工具摘要寫入 `reply`；掃描視窗不足以確定歸屬時放棄寫入（abstain），不猜。
4. **面板位置與 fleet `origin=operator` 對接（只寫介面需求）**
   - **面板位置**：`mods/live/askpm.ts`（L3 註明 `Panel placement is paused`）。解除暫停後，放置於 pane 底部靠近提示列的熱區；**幾何排版歸 codeforge**，autopilot 僅透過 `askpmLines(view, u, folded)`（`mods/live/askpm.ts` L92）提供資料與折疊狀態。清單只在 PM 席與操作員 pane 可見，不進 web／alfred 共用介面。
   - **fleet `origin=operator`**：fleet 已於 2026-11-24 回覆契約：以 shell 指令 `fleet tasks --origin operator --json` 讀取（欄位 `task_id`、`title`、`state`、`origin_quote`、`days_stalled`、`next_step` 等，含原話與 ULID）；以 `operator_msg:<時間>` 記來源者不在此 feed，需另用 `fleet tasks --all --json`；MCP 側沒有同等讀取欄位，且每席只看得到自己 courier 的單（完整清單須在 PM 席的 courier 上跑）。codeforge 已回覆版位：pane 底部沒有外部 owner 也沒有預留固定區塊，全屬 `mods/live`；T4 比照 B69 的 `hasStatusRow` 機制，在 tab strip 之上加 1–2 列預設收合的摺疊條（真的畫出來才佔列），並同步更新 `doc/design/pane-design-language.md`，新字元須過 `mods/live/width-lint.test.js`。codeforge 的 pane 幾何與 fleet 的 `origin=operator` 契約皆為 T4 的前置相依；回覆截止訂於 **T4 開工前**，逾期未答即採「本機 only」退路上線，待契約到位後另開小單補接。本席已送出介面問題（owner：`autopilot--claude`）。

## 4. 子工作切分（每件 ≤ S）

| 編號 | 子工作 | 大小 | 可平行 | 驗收與負控制 |
|---|---|---|---|---|
| T1 | `hooks/askpm-log.js` + `hooks/advisory-relay.js` + `replyGate`/`writeReply` 呼叫端（含 `askpm-remind`）補齊 `reply` | S | 可與 T2 平行 | 驗收：多筆待答、並行 session、插話、`askpm-remind` 開啟時之 hook／transcript fixture 皆正確歸屬；兩寫入者同時各 append 100 筆後逐行 JSON parse 全數可讀；重複 `Stop` 同 turn 只寫一次。負控制：injected `turn` 不得寫入 `reply`。 |
| T2 | `scripts/pm-ask.js` 新增 `group_key` 合併與同題計數 | S | 可與 T1 平行 | 驗收：同 `group_key` 問 3 次僅佔 1 筆且 `count=3`；綁定後群組合併且舊事件可追溯；滿 14 天無新問產生封存標記。負控制：同 `task` 兩個不同問題不得併；前 80 字相同、後文不同不得併。 |
| T3 | `hooks/askpm-log.js` 自動寫入 `disposition`（`progress`/`close`） | S | 依賴 T1、T2（與 T1 序列合併） | 驗收：綁定 task 且 `done` 或唯一未結時操作員明講收到／可關時標 `close`，其餘只更新 `progress`。負控制：僅含 commit sha／卡 id／URL 或無關確認語句不關任何 `ask`；未綁 `task` 的 `reply` 不報錯。 |
| T4 | `mods/live/askpm.ts` 擴充 4 欄位與 `origin=operator` 合併介面 | S | 依賴 T2、T5 | 驗收：`askpmLines` 輸出含問題、狀態、最新答案一行、更新時間（逾期未答採本機 only 退路）；舊狀態 `waiting` 映射為 `open` 相容測試通過。負控制：無 `reply` 時顯示「未答」而非空字串。 |
| T5 | 對接文件：codeforge 底部熱區幾何 + fleet `origin=operator` 契約（T4 開工前截止） | XS | 可與 T1/T2 平行 | 驗收：記錄對方 owner（`autopilot--claude`）與介面證據，並區分「本機版上線驗收」與「fleet 轉接與實際 pane 版位驗收」。負控制：本單不修改 codeforge 幾何實作。 |
| T6 | 重問時於 `UserPromptSubmit` 以 `additionalContext` 先回顯原答案與更新時間 | S | 依賴 T2 | 驗收：同題第二次問時注入內容含原答案一行與時間。負控制：拿掉注入時測試轉紅；無關問題不得被注入舊答案；視窗外文字不得被持久化或注入。 |

## 5. 風險、不做什麼與成效量法

- **風險與內容安全**：(1) 同題合併以 `ask_id` 為主鍵、`group_key` 僅作視圖合併，避免誤併。(2) `Stop` hook 回讀上限 200 行或 256 KB（取小者）；工具摘要只收白名單來源與固定長度上限（≤200 字），並遮蔽疑似憑證字串（token/key/secret）。(3) `askpm.jsonl` 並發寫入採檔案鎖內原子 append，保留 90 天後歸檔。
- **不做什麼**：不將 capacity 帳號池用量與全線狀況等即時輪詢數字放進清單（走常駐 widget / `fleet pm status`，清單僅放連結）；清單只在 PM 席與操作員 pane 可見，不進 web／alfred 共用介面；不在本單實作 codeforge 面板幾何或修改 fleet 核心程式。
- **成效量法**：以 `askpm.jsonl` 的 `ask` 事件為人口、7 天為視窗（分母＝視窗內 `ask` 總數，分子＝同 `group_key` 於 7 天內再次出現的 `ask` 數）；排除合成回覆（工具摘要不計入有效 `reply` 覆蓋率分子）。上線前先用同一支 `scripts/ask-repeat-rate.js` 對上線前 7 天重算基線作為 PASS 比較基準（15.7% 僅作歷史參考；若原基線為語意分類則另報語意重問估計）。上線後 7 天（2026-12-08）重問率較重算基線減半且有效 `reply` 覆蓋率 **≥ 90%**（基線 38%）即為 PASS。
