# session-mode 重新設計：不輪詢、不在磁碟上累積

- Fleet-Task: 01M7YVR04S7M46JNCTRGR68C47（PM 01M7YVR0）
- 基準：origin/develop 5260224a0；規模 S；階段：plan（計畫凍結後才派實作）
- 實作者：本地 27B 或 codex；本席只審查與整合

## 1. 問題

操作員看過 statx 風暴後問：這設計拿來幹嘛、為什麼要這樣？下面先講事實，再回答。

實際失敗（有數字）：

1. 檔案累積：`~/.autopilot/session-mode/` 每個 session 一個 `<sid>.json`，session 結束沒人刪，只等下一次寫入時的清掃。曾累積到 2,615 個。本機現在 24 個（`command ls | wc -l`，只數檔案，沒讀內容）。
2. statx 風暴：live mod 每 5 秒一次 tick（`mods/live/register.ts:104` `TICK_MS = 5000`），舊版對 envelope 列出的每個 marker 各 stat 一次。`mods/live/register.ts:562` 的註解記錄：每個 seat 燒掉 11–22% 一顆核心。03cda3928 已修：只列活的 marker，memo 後只 stat 群組目錄，2,000 個 marker 時每次輪詢 2,003 次 stat 降到 2（`git show --stat 03cda3928`）。
3. 還沒修的同類成本（這份計畫要處理的）：
   - `src/status/runs-watch.js:167` `unexpiredMarkers` 與 `:433` `markerFilesOf`：watcher 每 10 秒（`DEFAULT_INTERVAL_S = 10`，`:69`）`readdirSync` 整個目錄並對每個檔 `readFileSync` + `JSON.parse`。2,615 個檔就是每 10 秒 2,615 次讀取加解析。
   - `scripts/dispatch-author.sh:764`：`for marker in "$marker_dir"/*.json` 對每個 marker 各開一個 `node -e` 行程。N 個殘留檔 = N 次 node 啟動，每次 dispatch 一回。
   - 清掃只掛在「寫入」（`scripts/session-mode.js:747` `writeMarkerFile`、`:1603`），每次最多 500 個，過期超過 24 小時才刪，所以死檔最長活 48 小時。
   - hangar 另有每日輪換與清理（repo 外），代表 repo 自己沒有生命週期。

結論：失敗的根因不是「用檔案存狀態」，而是檔案有生，沒有死（沒有 SessionEnd 刪除），而且還有幾個讀者掃整個目錄。

## 2. 這機制為什麼存在

誰需要、什麼時候需要（出處為下列 file:line）：

| 讀者 | 何時 | 要的欄位 | 出處 |
|---|---|---|---|
| foreman-guard（PreToolUse） | 每個 Bash／Monitor 呼叫 | `level` | `hooks/foreman-guard.js:564` |
| orchestrator-edit-gate（PreToolUse） | 每次 Edit／Write | `level`、mission 路由 | `hooks/orchestrator-edit-gate.js:131` |
| run-approval-gate（PreToolUse） | 每次 Task／Agent | `level`、`started_at` | `hooks/run-approval-gate.js:113` |
| ask-decision、owner-question-rules、live-session-lib | 提問／Prompt 時 | `root_run_id`、`level` | `hooks/ask-decision.js:45`、`hooks/live-session-lib.js:227` |
| live mod（5 秒 tick） | 畫面上的 band 和 pane | `project_key`、`root_run_id`、`campaign_roots`、stage 欄位、`expires_at` | `mods/live/register.ts:520`、`mods/live/model.ts:1324` |
| runs-watch 常駐 watcher（10 秒） | 判斷哪些 session 還活著、屬於哪個專案 | `project_key`、`expires_at`、`campaign_roots` | `src/status/runs-watch.js:167` |
| CLI 與 shell（`session-mode.js set`、`stage-advance.js`、`dispatch-author.sh`） | 進入 /l3–/l6、換階段、派工前檢查 | 全部 | `scripts/stage-advance.js:1044`、`scripts/dispatch-author.sh:758` |

為什麼是檔案：hook 是「每個事件起一個新行程」，CLI 是另一個行程，watcher 是常駐 detached 行程，shell 腳本又是一種。它們要共用「這個 session 現在是 /l5、做到哪個階段」這件事，且要撐過 compact 與 resume，並且 codex 席（沒有 mod）也要讀。所以需要一個跨行程、持久的單一正本。這件事成立；不成立的是「放著不管」。

欄位分兩類（對做法有影響）：

- session 內不變的身分：`session_id`、`project_key`、`repo_identity`、`repo_root`、`root_run_id`、`started_at`。
- session 內會變的狀態：`level`（`set` 會覆寫，`/l3` 重入）、`stage`、`stage_set_at`、`unit`、`size`、`campaign_roots`、`fleet_task_id`、`task_seq`。

marker 沒有 seat 欄位；seat 身分是 fleet 的事（見 3(b)）。

## 3. 三種做法比較

平台能力查證結果（附出處；查不到就寫未證實）：

- `$.state`：已證實存在。`mods/live/types/index.d.ts:1` 宣告 `autopilot.decide` 等 atom；`mods/live/register.ts:2191` 用 `$.state.get`。範圍是 mod 自己的 plugin，且「refs are owner-checked」（`mods/live/run-tests.sh:8`）。
- `$.store`：未證實。repo 內查無任何 `$.store` 使用或型別宣告。
- `$.fs`：已證實有 `read / write / list / stat / exists`（`mods/live/register.ts:262,539,1079`；`references/mods.md:40` 語意段）。fs watch：未證實，repo 與 `references/mods.md` 皆無。不得假設存在。
- `$.clock.every`：已證實（`register.ts:1912`），這就是輪詢的來源。
- SessionEnd：hook 側已證實有掛（`hooks/hooks.json:59` 的 session-handoff、awaiting-owner；`hooks/awaiting-owner.js:31` SessionEnd 時刪 turn 檔，已有先例）。mod 側 `session.end` 事件已證實（`references/mods.md:56`，`reason=clear` 時不停 timer）。payload 的 `reason` 取值清單：未證實（`docs/dev/hook-harness-matrix.md:42` 標「未驗證」）。
- hook 輸入有 `session_id`：已證實（`hooks/foreman-guard.js:455,562`；`hooks/run-approval-gate.js:98`；`scripts/session-mode.js:262` `readSessionRecord(sessionId)` 接受 payload id；`hooks/ask-decision.js:40`）。
- fleet directory：repo 內只有 `scripts/dispatch-panel.js:370–396` 以 `fleet directory --json` 取 courier／member／host 的識別字串；欄位清單與是否含 session_id：未證實。

| | (a) mod 用 `$.state`、hook 用 payload `session_id` 直讀 | (b) 身分改用 fleet directory，單一正本 | (c) 事件驅動：SessionStart／set 寫、SessionEnd 刪、TTL 清掃、mod 用 fs watch |
|---|---|---|---|
| 解決哪個失敗 | 只解 mod 側。hook 本來就是 O(1)（`readSessionRecord(sid)`）。watcher、`dispatch-author.sh` 的掃全目錄照舊；檔案照舊累積 | 檔案消失，累積問題消失 | 累積（刪除）；掃全目錄的成本因 N 變小而消失；mod 輪詢是否消失取決於 fs watch |
| 為什麼不夠或可行 | `$.state` 只在 mod 行程內；寫入者（`set`、`stage-advance`）是別的行程，mod 還是得讀檔。hook 已經這樣做 | fleet 只知道「這席是誰」，不知道 `level`、`stage`、`campaign_roots`；非 fleet 的 session（codex、本機手開）沒有 courier；hook 要多依賴 fleet 服務，離線就失效（違反 fail-open）。`directory` 欄位未證實 | 刪除與清掃可行（有先例）；fs watch 未證實，且 mod 本來就有 5 秒 tick 在做配額與任務，單拔 marker 這一項省不下什麼 |
| 改動檔案 | `mods/live/register.ts` | `session-mode.js`、全部 7 類讀者、fleet 整合、hook 的離線降級 | 新 hook、`session-mode.js`、`runs-watch.js`、`dispatch-author.sh` |
| 遷移 | 小 | 大：改所有讀者，且需 fleet 側（hangar／fleet lane）新增欄位，超出本 repo 授權 | 中 |
| 風險 | 低；效益低 | 高：把 hook 的可用性綁到 fleet；欄位語意不對（level 不是身分） | 中：SessionEnd 可能不觸發（crash、kill -9），所以 TTL 清掃要留；resume 失根（見 7） |
| 相依平台能力 | `$.state` 已證實 | fleet directory 欄位未證實 | SessionEnd hook 已證實；fs watch 未證實 |

## 4. 選定方案與理由

選定：混合，以 (c) 為骨幹，去掉 fs watch，加上 (a) 的「只按 session_id 直讀」原則，不採 (b)。

一句話：marker 檔保留為單一正本，但補上死亡（SessionEnd 刪除 + watcher 啟動與每小時清掃），並把所有「掃全目錄」的讀者改成「按 sid 直讀」或「只掃有界的目錄」。

理由：

1. 失敗根因是缺生命週期，補上就夠；不用換儲存。
2. (b) 要動 fleet 側且會讓 hook 依賴外部服務，違反「hook 失敗要 fail-open」與本 repo 授權範圍；而且 fleet 沒有 level／stage，不能當正本。我們不需要兩個正本。
3. fs watch 未證實，不拿它當設計前提。mod 側已經是每 tick 一次 `readObject(own sid)`，成本與目錄大小無關（`register.ts:520`）；不另外為它加新機制。
4. 活著的檔案數就等於活著的 session 數，掃描型讀者（watcher）的 N 自然有界，不需要額外索引檔（索引檔是第二個正本，會漂移）。

保留的輪詢：mod 5 秒 tick 與 watcher 10 秒 tick 不是為了 marker 而存在，不動。要消掉的是「每 tick 的成本隨殘留檔數成長」。

## 5. 實作步驟（可平行的四塊）

四塊檔案不重疊，各用一個 worktree；A 先定義共用函式簽名，B／C／D 只呼叫它，所以 A 先合，其餘平行（或 A 的簽名先寫進 brief，四塊同時開）。

### A. 生命週期：SessionEnd 刪除與清掃（本機模組）

檔案：

- 新增 `hooks/session-mode-end.js`：SessionEnd hook。讀 stdin JSON 的 `session_id`，呼叫 `scripts/session-mode.js` 新匯出的 `endSession(sessionId, { parentSessionId })`。
- `scripts/session-mode.js`：
  - 新增 `endSession(sessionId, opts)`：持 marker 鎖（沿用 `withWriteLock`，`:668` 同寫法）；檔不存在回傳 `absent`；檔內 `session_id` 與檔名不符回傳 `mismatch`；`sessionId === AUTOPILOT_PARENT_SESSION_ID` 回傳 `refused_parent`（子行程絕不刪父的 marker，與 `:849` 的規則一致）；level 是 l5／l6 且 `campaign_roots` 非空回傳 `kept_campaign`（marker 是 session 與背景 campaign 的唯一連結，見 `src/status/runs-watch.js:183` 註解）；其餘 `unlink` 並回傳 `removed`。
  - 新增 `sweep` 子命令：`node scripts/session-mode.js sweep [--max N]`，呼叫既有 `sweepExpiredMarkers`（`:764`），回傳 JSON `{removed, remaining}`。預設 `--max 500`。
  - `sweepExpiredMarkers` 的 `SWEEP_MAX_REMOVALS`（`:761`）改成參數，預設不變。
- `hooks/hooks.json`：SessionEnd 加一筆；`hooks/hook-classes.*`（現有 hook 分類檔，實作者用 `git grep -n foreman-guard -- hooks` 找到登錄處）登錄為 default-on，旋鈕 `AUTOPILOT_SESSION_END_CLEANUP=0` 關閉；`hooks/README.md` 加一列；`docs/dev/hook-harness-matrix.md` 加一列（標「未驗證」，不得改寫成已驗證）。
- 鏡像：`platforms/codex/plugin/scripts/session-mode.js` 以 `scripts/sync-all` 同步（03cda3928 同樣改了兩份）；codex 無 SessionEnd，所以 codex 只靠清掃。

### B. watcher 讀取成本（`src/status/runs-watch.js`）

- 啟動時與每小時呼叫一次 `sweepExpiredMarkers(markerDirOf(env), null, now, { max: 5000 })`，之後再列目錄。
- `unexpiredMarkers`（`:167`）與 `markerFilesOf`（`:433`）合併成一個函式（兩者的 parse 與過期判斷重複），並在 `readFileSync` 前用檔名過濾 `.json`。不加索引檔。
- 鏡像 `platforms/codex/plugin/src/status/runs-watch.js` 同步。

### C. shell 腳本（`scripts/dispatch-author.sh:758–772`）

- 把「每個 marker 起一個 `node -e`」改成一個 node 行程，一次判斷全部 marker 並輸出命中的 level；語意不變（同一 repo、未過期、level 為 l3–l6 才擋）。
- 實作者先 `git grep -n 'markerDir\|session-mode' -- 'scripts/*.sh'` 確認 `dispatch-hetero.sh`、`dispatch-foreman.sh` 有沒有同型迴圈；有就同一塊處理，沒有就寫「已查無」。

### D. live mod（`mods/live/register.ts`）

- 不新增機制。補測試證明現況成立：5,000 個殘留 marker 時，一次 tick 對 `session-mode/` 沒有 `$.fs.list`、stat 次數 ≤ 小常數（見 6）。
- 若測試發現還有 O(N) 路徑，只修該路徑；不加 `$.store`、不加 fs watch。

## 6. 遷移與退役（同一次推送）

同一次 push 內：

1. 新 hook、`endSession`、`sweep` 子命令上線；`runs-watch.js` 啟動清掃上線；`dispatch-author.sh` 改成單一 node 行程。
2. 舊的「每個 marker 起一個 node」迴圈在同一個 commit 刪除，不留相容墊片、不留旗標雙跑。
3. 一次性清理既有殘留：實作者在驗收時跑 `node scripts/session-mode.js sweep --max 5000`（冪等），回報 before／after 數量。這是機械步驟，已腳本化，不手動逐檔刪。
4. repo 外的退役：hangar 的每日輪換與清理（本機是 hangar lane 的工作）在 repo 清掃上線並驗收後才可退役。本席不能編輯 hangar；plan 凍結後由 PM 轉給 hangar lane，附驗收證據。退役前兩者並行不衝突（都只刪過期檔，且 `endSession` 與清掃都容忍檔案已不存在）。
5. 發版：不 bump 版號（版號凍結在 3.0.0-alpha；見 `hold-version-at-3-0-0`）。
6. 驗收（Done = used）：在實機 session 結束後 `command ls ~/.autopilot/session-mode | wc -l` 少一個；加一次反向探針：用沙箱 HOME 手造殘留檔，確認清掃真的刪、gate 在 marker 被刪後失效為 fail-open（符合現行語意）。

## 7. 測試（先紅後綠；每個新檢查附負控制）

全部用沙箱 HOME 或 `AUTOPILOT_SESSION_MODE_DIR=$(mktemp -d)`，不碰真目錄（呼應 `hooks/plain-session-marker.test.js:655` 的負控制）。

新檔 `scripts/session-mode-session-end.test.js`：

1. `endSession removes a plain marker`：造 plain marker，呼叫後檔案不存在、回傳 `removed`。
2. `endSession is idempotent`：再呼叫一次回傳 `absent`，不丟例外。
3. `endSession keeps l5 marker with campaign_roots`：回傳 `kept_campaign`，檔案還在。
4. `endSession removes l5 marker without campaign_roots`。
5. `endSession never deletes the parent marker`：設 `AUTOPILOT_PARENT_SESSION_ID=<sid>`，回傳 `refused_parent`，檔案還在。
6. `endSession ignores a file whose session_id mismatches its name`：回傳 `mismatch`。
7. 負控制：把 `endSession` 暫時改成不刪，測試 1 必須紅（實作者貼紅色輸出）。

新檔 `hooks/session-mode-end.test.js`：

8. `SessionEnd hook deletes only the payload session's marker`：造 3 個 marker，payload 指其中一個，hook 跑完剩 2 個，被刪的正是那個。
9. `hook is a no-op with AUTOPILOT_SESSION_END_CLEANUP=0`。
10. `hook fails open`：stdin 不是 JSON，exit 0、不刪任何檔。
11. `reason=clear deletes the old sid marker`（payload 的 `reason` 欄位取值未證實，測試只驗證收到字串 `clear` 時行為；其他值同樣刪除，不依賴清單）。

新檔 `scripts/session-mode-scale.test.js`（5,000 殘留檔效能測試，確定性斷言用操作次數，不用 wall clock 當主要斷言）：

12. 設定：沙箱目錄寫 5,000 個過期超過 25 小時的 marker（`expires_at` 25 小時前）加 1 個自己的活 marker。
13. 斷言（hook 熱路徑）：包住 `fs.readdirSync`、`fs.statSync`、`fs.readFileSync` 計數；呼叫 `readSessionRecord(sid)`、`readMarker()`、`readSessionRoot(sid)` 各一次，`readdirSync` 次數 = 0，`readFileSync` 次數 ≤ 2（marker 本身，加 turn 檔），`statSync` 次數 = 0。
14. 斷言（時間上限，寬鬆）：同一組呼叫在 5,000 檔和 5 檔兩種情況下耗時比 < 3 倍，且 5,000 檔情況 < 50 ms。
15. 斷言（清掃收斂）：`sweep --max 500` 連跑 10 次後目錄只剩 1 個檔（自己的），每次 `removed ≤ 500`，第 10 次 `remaining = 1`。
16. 斷言（watcher）：在 `scripts/runs-watch-sources.test.js` 旁新增 `runs-watch with 5000 expired markers`：啟動清掃後第一個 tick 的 `readFileSync` 次數 ≤ 活 marker 數 + 常數 5；清掃前（舊碼）為 5,000+（紅），清掃後（新碼）綠。
17. 斷言（shell）：新檔 `scripts/dispatch-author-marker-scan.test.js`：5,000 殘留檔時，`dispatch-author.sh` 的 marker 檢查只起 1 個 node 行程（以 PATH 內的 `node` 包裝計數，計數 = 1）；舊碼為 5,000（紅）。
18. 負控制：把清掃上限改回 500 且不加啟動清掃，測試 16 必須紅。

`mods/live/live.test.ts` 新增：

19. `tick with 5000 residual markers does not list the session-mode dir`：沿用現有 2,000 個 marker 的測試寫法（03cda3928 已有），把 N 調成 5,000，斷言 `$.fs.list` 對該目錄次數 = 0、`$.fs.stat` 次數 ≤ 5。memo 還原成舊版時必須紅（沿用 03cda3928 的負控制）。

套件執行：每塊跑 `scripts/affected-suites.js --fast --run`；完整套件在合併前單獨跑一次（見 CLAUDE.md Process rules）。`mods/live` 套件已知有 10 個既有紅（03cda3928 合併訊息記載 tip 1743 pass／10 fail），驗收只比對「紅的名稱集合沒有新增」。

## 8. 不做的事

- 不採 (b)：不把 level／stage 搬進 fleet；不新增 fleet 欄位需求。
- 不加 fs watch、不加 `$.store`（兩者都未證實；要用先另開單證明）。
- 不加索引檔、事件帳本或其他第二份正本（ADR-0001：靠重新推導驗證，不加信任機制）。
- 不改 marker 的欄位 schema，不動 `readSessionRoot` 的「turn 檔證明還活著」判斷。
- 不降低 24 小時 TTL，也不改 fail-open 語意。
- 不改 mod 的 5 秒 tick 與 watcher 的 10 秒 tick。
- 不動 hangar（只轉給 hangar lane 退役它那份每日清理）。
- 不 bump 版號、不做 hosted CI。

## 9. 風險與未證實假設

1. SessionEnd 並非每次都觸發（crash、kill -9、斷線）；`reason` 的取值清單未證實（`hook-harness-matrix.md:42` 標「未驗證」）。對策：清掃作為底線，且測試 15／16 不依賴 SessionEnd。
2. exit 後以同一個 sid resume：marker 已刪，`root_run_id` 會重新產生、l3–l6 模式要由前門指令重進。這與現行「過期後換新 root」同型，但窗口變成「結束後立刻」。未證實這會不會打斷實際工作流；對策是 l5／l6 且有 `campaign_roots` 的 marker 保留。實作完成後要在實機做一次 exit → resume 探針。
3. fleet directory 的欄位清單與是否含 session_id 未證實；本計畫刻意不依賴它。
4. 有沒有其他 shell 腳本含同型的逐檔迴圈，這份計畫只確認了 `dispatch-author.sh:764`；C 塊要求實作者再掃一次。

## 10. 排程與單號

- 計畫凍結後同時開 A／B／C／D 四個 worktree 與 fleet 子單（單號由 PM／實作 lane 開，寫回本單 01M7YVR04S7M46JNCTRGR68C47）。
- 實作交本地 27B 或 codex；審查走 hetero，不走 sonnet。每塊做完立刻審，不等全部。
- 上線：合併 develop 後走 PM 的 pin 流程；hangar 退役項在 PM 給 go 後轉出。
