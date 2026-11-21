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
   - `scripts/dispatch-author.sh:764`：舊實作 `for marker in "$marker_dir"/*.json` 對每個 marker 各開一個 `node -e` 行程。N 個殘留檔 = N 次 node 啟動，每次 dispatch 一回。
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

一句話：marker 檔保留為單一正本，但補上死亡（SessionEnd 刪除 + 讀取端清掃），並把所有「掃全目錄」的讀者改成「按 sid 直讀」或「只掃有界的目錄」。

理由：

1. 失敗根因是缺生命週期，補上就夠；不用換儲存。
2. (b) 要動 fleet 側且會讓 hook 依賴外部服務，違反「hook 失敗要 fail-open」與本 repo 授權範圍；而且 fleet 沒有 level／stage，不能當正本。我們不需要兩個正本。
3. fs watch 未證實，不拿它當設計前提。mod 側已經是每 tick 一次 `readObject(own sid)`，成本與目錄大小無關（`register.ts:520`）；不另外為它加新機制。
4. 掃描型讀者（watcher、`dispatch-author.sh`、`dispatch-hetero.sh` 的指定 marker 驗證）本來就只認未過期的 marker，過期檔對它們沒有用處。所以「讀完就刪」：實作了讀取端清除的 watcher 與 `dispatch-author.sh` 讀到任何已過期 marker（包括有 `campaign_roots` 的 l5／l6）都以寬限 0 刪掉（見 5.A 的 `graceMs`）；每個殘留檔最多各由會清除的 reader 解析一次並在鎖內重驗後消失。首次接觸目錄付 O(N) 初讀及必要的鎖內重讀；穩態讀取數正比於未過期 marker 數，與歷史殘留量無關；不需要額外索引檔（索引檔是第二個正本，會漂移）。

保留的輪詢：mod 5 秒 tick 與 watcher 10 秒 tick 不是為了 marker 而存在，不動。要消掉的是「每 tick 的成本隨殘留檔數成長」。

## 5. 實作步驟（兩段：A 先，B／C／D 再平行）

B／C／D 依賴 A 匯出的 `unlinkIfStillExpired`、`sweepExpiredMarkers` 與 `scripts/sync-all.sh` 產生的鏡像，所以分兩段：第一段只有 A，合進 develop（含 `sync-all.sh` 鏡像）後；第二段 B、C、D 各開一個 worktree 平行。測試檔歸屬：`scripts/session-mode-session-end.test.js`、`hooks/session-mode-end.test.js`、`scripts/session-mode-scale.test.js` 屬 A；`scripts/runs-watch-sources.test.js` 的新增屬 B；`scripts/dispatch-author-marker-scan.test.js` 屬 C；`mods/live/live.test.ts` 屬 D。

### A. 生命週期：SessionEnd 刪除與清掃（本機模組）

檔案：

- 新增 `hooks/session-mode-end.js`：SessionEnd hook。讀 stdin JSON 的 `session_id`，呼叫 `scripts/session-mode.js` 新匯出的 `endSession(sessionId, { parentSessionId })`。
- `scripts/session-mode.js`：
  - 匯出 `sweepExpiredMarkers`（`:1929` 的 `module.exports`）。新增 `endSession(sessionId, opts)`：持 marker 鎖（沿用 `withWriteLock`，`:668` 同寫法）；檔不存在回傳 `absent`；檔內 `session_id` 與檔名不符回傳 `mismatch`；`sessionId === AUTOPILOT_PARENT_SESSION_ID` 回傳 `refused_parent`（子行程絕不刪父的 marker，與 `:849` 的規則一致）；若 marker 已過期，先在鎖內 unlink 並回傳 `removed`，再檢查保留條件；level 是 l5／l6 且 `campaign_roots` 非空且未過期時回傳 `kept_campaign`，檔案不動（marker 是 session 與背景 campaign 的唯一連結，見 `src/status/runs-watch.js:183` 註解；過期後由任何一條清掃路徑刪除，見下）；level 是 l3–l6 且無 campaign 時，不刪檔，而是把 `expires_at` 就地改成 `min(expires_at, now + RESUME_GRACE_MS)`（`RESUME_GRACE_MS = 20 分鐘`，不改 schema）並回傳 `clamped`，讓 exit 後立刻 resume 或 `/clear` 仍保有 level、stage、`root_run_id`，沒人 resume 就 20 分鐘後被清掃收走；plain marker（level null）直接 `unlink` 並回傳 `removed`（resume 時 SessionStart 的 `ensurePlainMarker` 會重建）。SessionStart 的 `ensurePlainMarker(sessionId)` 在 marker 鎖內讀取現存且未過期的 l3–l6 marker 時，若其 `expires_at` 早於 `now + 24 小時`，就原地刷新為 `now + 24 小時`，保留 `level`、`stage`、`root_run_id` 等欄位。Claude Code 是否會因 `/clear` 以 `source=clear` 觸發 SessionStart 未經本計畫驗證，因此不依賴該行為；由第一個 `UserPromptSubmit` 執行新增的 `hooks/session-mode-refresh.js`，呼叫 `refreshClampedMarkerOnUserPromptSubmit(sessionId)`；在鎖內重驗 session id，並將仍未過期的 clamped l3–l6 marker 刷新至 prompt 時間 + 24 小時，保留 level、stage、root_run_id；已過期 marker 不復活，因此首個 prompt 必須在 marker 的實際 expiry 前到達（通常是 SessionEnd 後 20 分鐘內）。在 `hooks/hooks.json` 的 `UserPromptSubmit` 與 default-on profile 登錄此 wrapper。清除與改寫都在鎖內重驗檔內 `session_id`。
  - 新增 `sweep` 子命令：`node scripts/session-mode.js sweep [--max N] [--grace-ms M]`，呼叫既有 `sweepExpiredMarkers`（`:764`），回傳 JSON `{removed, remaining}`。`remaining` 是本輪後仍符合本次 `graceMs` 條件、但因 `max` 上限尚未刪除的過期 marker 數；不含活 marker、受保護檔或目錄總檔數。預設 `--max 500`。
  - `sweepExpiredMarkers`（`:764`）的簽名擴成 `(dir, protectFile, now, { max = SWEEP_MAX_REMOVALS, graceMs = SWEEP_EXPIRED_AFTER_MS } = {})`，預設行為不變（寫入時的清掃照舊 500 個、24 小時寬限）。`graceMs: 0` 時，`expires_at` 已過的 marker 立即視為死檔，包含有 `campaign_roots` 的 l5／l6（過期的 marker 對 watcher 與 dispatch 都等於不存在，保留只會讓每次掃描重複付費）。所有讀者端與 CLI 的刪除都走新匯出的 `unlinkIfStillExpired(file, now, graceMs)`：持 `withWriteLock`，鎖內重讀並重驗 `expires_at` 仍過期才 `unlink`，所以不會與同一 sid 剛完成的 `writeMarkerFile`／`ensurePlainMarker` 改名互相踩。新增 `sweep` 子命令（`--max 0` 表示不設上限）與 watcher、`dispatch-author.sh` 讀取時的清除都走這個參數；marker 的 24 小時 TTL（`expires_at` 的算法）不動，只是已過期檔的刪除寬限在「讀者端」縮短，因為 hook 與 watcher 對過期 marker 的語意本來就是「不存在」（`ensurePlainMarker` 同樣直接取代過期檔，`:790` 註解）。
- `hooks/hooks.json`：SessionEnd 加一筆；`profiles/hook-classes.json` 登錄為 default-on（鏡像 `platforms/codex/plugin/profiles/hook-classes.json` 由 `scripts/sync-all.sh` 同步），旋鈕 `AUTOPILOT_SESSION_END_CLEANUP=0` 關閉；`hooks/README.md` 加一列；`docs/dev/hook-harness-matrix.md` 加一列（標「未驗證」，不得改寫成已驗證）。
- 鏡像：`platforms/codex/plugin/scripts/session-mode.js` 以 `scripts/sync-all` 同步（03cda3928 同樣改了兩份）；codex 無 SessionEnd，所以 codex 只靠清掃。

### B. watcher 讀取成本（`src/status/runs-watch.js`）

- 不另加啟動或每小時清掃（會與下一條互相遮蔽，負控制測不出來）；清除只有一條路徑，就是下一條的讀取端清除。
- 將 `src/status/runs-watch.js` 的 `unexpiredMarkers()`（`:167`）與 `markerFilesOf()`（`:433`）合併並取代為 `readLiveMarkers(dir, key, nowMs)`；它統一 parse／expiry 判斷，在 `readFileSync` 前過濾 `.json`，回傳同一 tick-cache 結果 `{ records, paths }`，供 consumers 投影各自需要的表示。讀到已過期 marker 時呼叫 `unlinkIfStillExpired(file, nowMs, 0)`（忽略錯誤）。明確合併函式：`unexpiredMarkers()` 與 `markerFilesOf()` → `readLiveMarkers()`。明確呼叫者：`createWatcher()` 內部的 `tick()`（`:834`）取 records；`sourceFingerprint()`（`:452`）取 paths；`createWatcher()` 內部的 `watchInputs()`（`:639`）取 records。三個呼叫點在同一 tick 共用 `readLiveMarkers()` 的單次結果（結果同時保存 records 與 paths，以 marker_dir、project key、nowMs 為 tick-local cache key），所以每檔初讀一次，刪除候選另有一次鎖內重讀／expiry 重驗。不另設啟動或每小時清掃，不加索引檔。
- 鏡像 `platforms/codex/plugin/src/status/runs-watch.js` 同步。

### C. shell 腳本（`scripts/dispatch-author.sh:758–772`、`scripts/dispatch-hetero.sh:1464–1543`）

- 把「每個 marker 起一個 `node -e`」改成一個 node 行程，一次判斷全部 marker 並輸出命中的 level；語意不變（同一 repo、未過期、level 為 l3–l6 才擋；仍是整個 repo 範圍的閘，不能改成只看自己的 sid）。同一個行程讀到過期的 marker 就以 `unlinkIfStillExpired(..., 0)` 刪除（單次最多 5,000 個，由 `sweepExpiredMarkers` 的 `max` 控制），所以第一次 dispatch 付一次 O(N)，之後讀取數 ≤ 未過期 marker 數。
- `scripts/dispatch-hetero.sh:1464–1543` 也屬本塊 touched surface：這段解析 marker_dir 中的 `.json` 路徑，將整批路徑傳給單一 `node -` 行程；Node 依 argv 順序逐一讀取與驗證 JSON、level、repo_root、started_at、expires_at，輸出 NUL 分隔的狀態；shell 再按同一順序採 first-offender-wins，遇無效／非檔／活躍 marker 時 fail closed。此路徑只驗證指定 marker，不負責刪除；執行時改由讀取過期 marker 後的 `scripts/session-mode.js sweep --max 0 --grace-ms 0` 清掃，勿在 shell Node 行程內引入另一套 unlink 邏輯。新增到 `scripts/dispatch-author-marker-scan.test.js` 的異動測試：5,000 過期 marker 僅一個 Node 行程、全量 sweep 收斂刪除；另以活 l5 marker 及無效 marker 驗證原有擋阻與 first-offender 行為。`dispatch-foreman.sh:442`、`dispatch-explore.sh:67` 仍是驗證指定 marker／清環境變數，無逐檔掃描，不在本塊。

### D. live mod（`mods/live/register.ts`）

- 不新增機制。補測試證明現況成立：5,000 個殘留 marker 時，一次 tick 對 `session-mode/` 沒有 `$.fs.list`、stat 次數 ≤ 小常數（見 6）。
- 若測試發現還有 O(N) 路徑，只修該路徑；不加 `$.store`、不加 fs watch。

## 6. 遷移與退役（同一次推送）

新機制與舊機制必須在同一次 push 上線；不設 dual-run period、不留相容墊片或雙跑旗標。該 push 同時新增 `hooks/session-mode-end.js`、`scripts/session-mode.js` 的 `endSession`／`sweep` 與 expiry helper，並改寫下列舊入口：

1. `src/status/runs-watch.js` 與 `platforms/codex/plugin/src/status/runs-watch.js` 將 `unexpiredMarkers()`／`markerFilesOf()` 換成 `readLiveMarkers()`；`tick()`、`sourceFingerprint()`、`watchInputs()` 從同一個 tick-local `{ records, paths }` 結果取用各自投影，只有這個 helper 做讀取端清掃，取代任何額外啟動／每小時清掃指令；其 marker 每 tick 的線性重掃路徑由過期即刪取代。
2. `scripts/dispatch-author.sh:758–772` 舊逐 marker `node -e` 啟動迴圈，改為單一 Node 批次並在讀到過期 marker 時安全刪除。
3. `scripts/dispatch-hetero.sh:1464–1543` 的批次 marker 驗證保留單一 Node 行程、輸入順序、first-offender-wins 與 fail-closed 行為；marker 清掃由緊接的全量 `sweep --max 0 --grace-ms 0` 做，不在此 reader 增加第二種刪除邏輯。
4. hook 設定／文件入口 `hooks/hooks.json`、`profiles/hook-classes.json`、`hooks/README.md`、`docs/dev/hook-harness-matrix.md` 登錄新的 SessionEnd hook；Codex 鏡像由 `scripts/sync-all.sh` 更新，不手改生成目錄。

退役接受測試：同 push 的 diff 必須刪除／改寫上列舊入口；`git grep` 全 repo 檢查舊逐 marker `node -e` pattern、watcher 啟動／每小時 sweep 呼叫與重複 `unexpiredMarkers`／`markerFilesOf` 定義均為零結果（以明確 pattern 清單執行，排除本計畫中的歷史描述）；呼叫圖／測試須確認沒有 caller 仍使用舊入口或舊 helper。負控制：在隔離 fixture 還原任一舊 caller／啟動 sweep 時 grep 或測試必須紅。不存在雙跑期間，驗收同一 commit 同時包含新入口與舊路徑刪除／改寫。

一次性清理既有殘留：實作者在驗收時跑 `node scripts/session-mode.js sweep --max 0 --grace-ms 0`（不設上限、冪等，輸出 `removed === 0` 才算收斂），回報 before／after 數量。這是機械步驟，已腳本化，不手動逐檔刪。repo 外的 hangar 每日輪換與清理在 repo 清掃驗收後由 PM 轉 hangar lane 退役；其修改不屬本 repo 工作。發版不 bump 版號（版號凍結在 3.0.0-alpha；見 `hold-version-at-3-0-0`）。Done = used 探針仍以沙箱 HOME 驗證殘留清掃與 gate 的 fail-open 語意。

## 7. 測試（先紅後綠；每個新檢查附負控制）

全部用沙箱 HOME 或 `AUTOPILOT_SESSION_MODE_DIR=$(mktemp -d)`，不碰真目錄（呼應 `hooks/plain-session-marker.test.js:655` 的負控制）。

新檔 `scripts/session-mode-session-end.test.js`：

1. `endSession removes a plain marker`：造 plain marker，呼叫後檔案不存在、回傳 `removed`。
2. `endSession is idempotent`：再呼叫一次回傳 `absent`，不丟例外。負控制：令第二次呼叫回傳 `removed` 或拋出 `ENOENT`，此測試必須紅。
3. `endSession keeps an unexpired l5 marker with campaign_roots`：回傳 `kept_campaign`，檔案還在。
4. `endSession clamps an l5 marker without campaign_roots`：回傳 `clamped`，檔案還在，`expires_at` ≤ now + 20 分鐘，`level`、`stage`、`root_run_id` 不變。
5. `endSession never deletes the parent marker`：設 `AUTOPILOT_PARENT_SESSION_ID=<sid>`，回傳 `refused_parent`，檔案還在。
6. `endSession ignores a file whose session_id mismatches its name`：回傳 `mismatch`。
6a. `endSession removes an already-expired campaign marker before retention checks`（`scripts/session-mode-session-end.test.js`）：造已過期且帶 `campaign_roots` 的 l5 marker，呼叫 `endSession` 後檔案不存在且回傳 `removed`，證明 expiry unlink 先於 `kept_campaign`／clamped 判斷。負控制：還原先判 retention 再判 expiry 的舊順序，測試必須紅（得到 `kept_campaign` 且檔案仍在）。
7. 負控制（各自貼紅色輸出）：`endSession` 改成不刪，測試 1 紅；拿掉 `kept_campaign` 判斷，測試 3 紅；拿掉 clamp，測試 4 紅；拿掉 `refused_parent` 判斷，測試 5 紅；拿掉 `session_id` 比對，測試 6 紅。
8. `resume refreshes a clamped l5 marker`（`scripts/session-mode-session-end.test.js`）：SessionEnd 將無 campaign 的 l5 marker 夾至 `t0 + 20 分鐘`；在 `t0 + 19 分鐘` resume 並執行 SessionStart `ensurePlainMarker`，驗證 `expires_at = resume 時間 + 24 小時` 且 `level`、`stage`、`root_run_id` 不變；在 `t0 + 21 分鐘` 以 `graceMs=0` 清掃，marker 仍存在。負控制：停用 SessionStart 續期時，同一 fixture 在 `t0 + 21 分鐘` 被清掃刪除，測試必須紅。

新檔 `hooks/session-mode-end.test.js`：

8. `SessionEnd hook deletes only the payload session's marker`：造 3 個 marker，payload 指其中一個，hook 跑完剩 2 個，被刪的正是那個。
9. `hook is a no-op with AUTOPILOT_SESSION_END_CLEANUP=0`。
10. `hook fails open`：stdin 不是 JSON，exit 0、不刪任何檔。
11. `reason=clear` 對 plain marker 刪除、對 l3–l6 marker clamp；新增 `hooks/session-mode-refresh.js` 並登錄於 `hooks/hooks.json` 的 `UserPromptSubmit` 和 default-on profile。新增 `hooks/session-mode-clear-refresh.test.js` 測試 `clear clamps then first prompt refreshes the same level marker`：以 `reason=clear` 執行 SessionEnd，接著透過已登錄 hook wrapper 送出第一個 UserPromptSubmit，斷言 marker 有效且原 level、stage、root_run_id 保留，`expires_at` 刷新為 prompt 時間 + 24 小時；prompt 必須早於 marker expiry。Claude Code 是否以 `source=clear` 觸發 SessionStart 未經驗證，本設計不依賴它；payload `reason` 完整取值清單也未證實，測試只驗證收到字串 `clear` 時行為。負控制：略過 UserPromptSubmit refresh 時，同 fixture 的 marker 仍只有 clamp expiry 並在 grace=0 清掃後不存在，該斷言必須紅。
11b. 負控制：hook 不讀 `session_id` 而改刪全部檔，`hooks/session-mode-end.test.js` 的測試 8 預期紅（原本兩個非 payload marker 也被刪）。在 `hooks/session-mode-end.test.js` 加具名測試 `SessionEnd hook is registered in manifest and default-on profile`，直接讀取 `hooks/hooks.json` 與 `profiles/hook-classes.json` 並斷言 SessionEnd command 與 default-on class 對應；負控制分別從 manifest 移除 hook、從 profile 移除登錄，該測試各自預期紅；移除旋鈕判斷，測試 9 預期紅；讓 hook 遇壞 JSON 時丟例外，測試 10 預期紅。
11c. session end cleanup（`scripts/session-mode-session-end.test.js` 與 `hooks/session-mode-end.test.js`）：normal SessionEnd 必須刪除 plain marker／按規則 clamp mode marker；abnormal end/kill（不觸發 hook）後由明確 sweep 清除已過期 marker，讀取端接觸殘留時也依設計清除。負控制：停用 SessionEnd 且不執行 fallback cleanup 時，plain marker 留存；停用 fallback sweep 時，kill fixture 中已過期 marker 留存，兩者都須使相應斷言紅。讀取端刪除的負控制在 `scripts/session-mode-scale.test.js` 新增「reader-side unlink removes expired marker」：已過期 marker 被讀取後應消失；以 deliberately broken `unlinkIfStillExpired` no-op variant 執行時，該測試預期紅（marker 仍存在）。

新檔 `scripts/session-mode-scale.test.js`（5,000 殘留檔效能測試，確定性斷言用操作次數，不用 wall clock 當主要斷言）：

12. 設定：沙箱目錄寫 5,000 個殘留 marker：2,000 個過期超過 25 小時、2,000 個只過期 1 小時、500 個過期 1 小時且為 l5 帶 `campaign_roots`、500 個 l3 無 campaign（每個明確設定 `expires_at = now + 1 小時`）、500 個 l3 無 campaign且過期超過 25 小時；另加 1 個自己的活 marker。配置符合 `SWEEP_MAX_REMOVALS = 500` 的單次上限 fixture。
13. 斷言（hook 熱路徑）：先載入 `scripts/session-mode.js` 與其依賴，再安裝 fs spy；spy 只計數 `path.resolve(file)` 等於 marker_dir 或位於 `marker_dir + path.sep` 下的路徑（turn 檔另以其明確路徑計數），不計 module load。設 `AUTOPILOT_SESSION_ID=<sid>`，呼叫 `readSessionRecord(sid)`、`readMarker()`、`readSessionRoot(sid)` 各一次，用已過期 marker 加近期 turn fixture；三次未快取呼叫各讀一次 marker，`readSessionRoot` 另讀一次 turn 檔，故 marker 路徑 `readFileSync` ≤ 3、turn 路徑 `readFileSync` ≤ 1（合計 ≤ 4），`readdirSync` 次數 = 0，`statSync` 與 `existsSync` 各 ≤ 2。同一組呼叫在 5 檔與 5,000 檔兩種目錄下，各項計數必須相同（計數與 N 無關）；這些分別對應設計的每 sid 定向讀取與 `readSessionRoot` 最多兩次 stat／exists。
14. 斷言（時間上限，只留寬鬆絕對值）：在規定的 5,000 個 stale marker setup 下，量測 session-start `ensurePlainMarker`／resume marker read-and-refresh 操作，端到端耗時 < 200 ms（一般開發／CI host class 的寬鬆上限；路徑只讀單一 sid marker、不依殘留檔數成長，且一次原子改寫）。每次使用獨立 fixture、預熱一次後取 5 次中位數；任一次中位數 ≥ 200 ms 為失敗。另保留 hook 熱路徑 5,000 檔整組呼叫 < 200 ms，不比較兩種情況的耗時比（毫秒級比值不穩定）。負控制：把 `readSessionRecord` 暫改成掃目錄，13 紅；讓 SessionStart 對 5,000 個檔逐一 stat/read 時，此效能斷言必須紅。
15. 斷言（清掃收斂）：`sweep --max 500 --grace-ms 0` 連跑 10 次後目錄只剩 1 個檔（自己的），每次 `removed ≤ 500`，第 10 次 `remaining = 0`；另以獨立 fixture 寫 2,000 個過期超過 25 小時的 marker 及 1 個受保護的活 marker，跑預設參數（`max=500`、24 小時寬限）一次；只刪 500 個，結果 `removed=500`、`remaining=1500`（5.A 定義為本輪後仍符合該 `graceMs`、但因 `max` 上限尚未刪除的過期 marker 數，不含活 marker、受保護檔或目錄總檔數）、目錄有 1,501 個檔，證明上限與預設寬限。另以新 fixture 跑 `sweep --max 0 --grace-ms 0`，一次刪除全部 5,000 個過期 marker、保留自己的活 marker。`--max 0` 明確表示不設上限，非拒絕值；負控制：將 `max=0` 當成零或回退為預設 500 時，5,000 檔斷言必須紅；把 `graceMs` 改回固定 24 小時時收斂斷言必須紅；另開 2,000 個只過期 1 小時的 marker fixture，使用預設 `max=500`、預設 grace 一次執行應 `removed=0` 且 2,000 個仍存在；負控制：將預設 grace 錯誤沿用為 0，同一呼叫刪除 500 個且剩 1,500 個，該斷言必須紅。
16. 斷言（watcher）：在 `scripts/runs-watch-sources.test.js` 旁新增 `runs-watch with 5000 expired markers`。殘留檔沿用 12 的組成（含過期 l5 campaign marker），外加 3 個活 marker。先載入 watcher 模組再安裝 fs spy；spy 只計 `path.resolve(file)` 位於 fixture `marker_dir` 下的讀取（不計 CommonJS module loads），也不計目錄外資料。第一次 tick 對每個過期 marker 做初讀以辨識，再由 `unlinkIfStillExpired` 在鎖內重讀及重驗；因此 `readFileSync` 次數 ≤ 10,003 + 常數（5,000 次初讀 + 最多 5,000 次鎖內重讀 + 3 個活 marker 的讀取及固定開銷），結束後目錄只剩 3 個檔。第二個 tick 之前另寫 100 個剛過期的 marker；下一個 tick 同樣有初讀與鎖內重讀，`readFileSync` ≤ 203 + 常數（100×2 + 3 活 marker + 固定開銷），之後目錄剩 3 個。乾淨後續 tick：`readdirSync` 次數 = 1、`readFileSync` 次數 ≤ 3 + 常數 5、`JSON.parse` 次數 ≤ 3 + 5。舊碼後續 tick 仍讀 5,000+（紅）。
17. 斷言（shell）：新檔 `scripts/dispatch-author-marker-scan.test.js`，殘留檔沿用 12 的組成（不放活 marker）。第一次 `dispatch-author.sh` 的 marker 檢查只起 1 個 node 行程（以 PATH 內的 `node` 包裝計數，計數 = 1），結束後殘留檔 = 0；第二次同樣只起 1 個、marker `readFileSync` ≤ 常數 5，以子行程注入 Node `--require` 的 fs spy 包裝器計數，僅計 `path.resolve(file)` 位於 fixture `marker_dir` 下的 marker 路徑（明確排除 CommonJS 模組載入與其他目錄路徑）。舊碼第一次起 5,000 個行程（紅）。再加一例：另有 1 個同 repo 的活 l5 marker 時，檢查仍擋（回傳 level），證明整個 repo 範圍的閘語意沒變。負控制一：恢復每 marker 一個 `node -e`，行程數斷言必須紅；負控制二：略過 l5 的 repo-wide gate 應漏擋，活 l5 marker 例必須紅。
18. 負控制：（a）拿掉 watcher 讀取端清除，`scripts/runs-watch-sources.test.js` 測試 16 的第二個 tick 預期紅；（b）把 `graceMs` 改回 24 小時，該檔測試 16 的第二個 tick 預期紅（只過期 1 小時的那組留下）；（c）讀取端清除略過有 campaign 者，該檔測試 16 預期紅；（d）在 `scripts/runs-watch-sources.test.js` 的 Block B 新增 `expired marker recheck preserves concurrent replacement`：拿掉 `unlinkIfStillExpired` 的鎖內重驗，在清除瞬間令同 sid 被 `writeMarkerFile` 換成未過期新檔；斷言新檔仍存在且內容為新 marker，故 deliberately broken no-recheck variant 預期紅。

`mods/live/live.test.ts` 新增：

19. `tick with 5000 residual markers does not list the session-mode dir`：沿用現有 2,000 個 marker 的測試寫法（03cda3928 已有），把 N 調成 5,000，斷言 `$.fs.list` 對該目錄次數 = 0、`$.fs.stat` 次數 ≤ 5。memo 還原成舊版時必須紅（沿用 03cda3928 的負控制）。

套件執行：每塊跑 `scripts/affected-suites.js --fast --run`；完整套件在合併前單獨跑一次（見 CLAUDE.md Process rules）。`mods/live` 套件已知有 10 個既有紅（03cda3928 合併訊息記載 tip 1743 pass／10 fail），驗收只比對「紅的名稱集合沒有新增」。

## 8. 不做的事

- 不採 (b)：不把 level／stage 搬進 fleet；不新增 fleet 欄位需求。
- 不加 fs watch、不加 `$.store`（兩者都未證實；要用先另開單證明）。
- 不加索引檔、事件帳本或其他第二份正本（ADR-0001：靠重新推導驗證，不加信任機制）。
- 不改 marker 的欄位 schema，不動 `readSessionRoot` 的「turn 檔證明還活著」判斷。
- 不降低 marker 的 24 小時 TTL（`expires_at` 算法不動），也不改 fail-open 語意；讀者端以寬限 0 刪除任何已過期 marker，包含已過期的 campaign marker；未過期的 campaign marker 仍保留（見 5.A）。
- 不改 mod 的 5 秒 tick 與 watcher 的 10 秒 tick。
- 不動 hangar（只轉給 hangar lane 退役它那份每日清理）。
- 不 bump 版號、不做 hosted CI。

## 9. 風險與未證實假設

1. SessionEnd 並非每次都觸發（crash、kill -9、斷線）；`reason` 的取值清單未證實（`hook-harness-matrix.md:42` 標「未驗證」）。對策：清掃作為底線，且測試 15／16 不依賴 SessionEnd。
2. exit 或 `/clear` 後以同一個 sid resume：SessionStart 對 resume 刷新 clamped marker；`/clear` 不假設會觸發 SessionStart，第一個 UserPromptSubmit 透過 `hooks/session-mode-refresh.js`（`hooks/hooks.json` 已登錄）執行 `refreshClampedMarkerOnUserPromptSubmit(sessionId)`，在 marker expiry 前刷新至 prompt 時間 + 24 小時。若首個 prompt 到達時 marker 已過期，不復活並可能重新建立 root。實作完成後要在實機做一次 exit → resume 與 `/clear` → first-prompt 探針。
3. fleet directory 的欄位清單與是否含 session_id 未證實；本計畫刻意不依賴它。
4. 在本分支執行 `git grep -n -E 'for .*marker.* in .*\\.json|node -e.*session-mode|check_session_mode_gate|marker_dir.*\\.json|session-mode\\.js.*(read|sweep)|readFileSync.*marker|readdirSync.*marker' -- 'scripts/*.sh' 'scripts/**/*.sh' 'hooks/*.sh' 'hooks/**/*.sh'`；本次掃描命中如下，逐項記錄處置：
   - `hooks/tests/autopilot-cli.test.sh:235` marker fixture 讀取：**unaffected**，測試資料檢查，非 production scan。
   - `hooks/tests/child-session-identity.test.sh:129,131,134` `node -e` SessionStart identity fixture：**unaffected**，只驗一個指定 sid。
   - `hooks/tests/engine-bind-campaign-root.test.sh:88,92,121,126` marker fixture 讀取：**unaffected**，測試資料斷言。
   - `hooks/tests/mission-routing-campaign-bridge.test.sh:598` fixture 目錄列舉：**unaffected**，測試專用。
   - `hooks/tests/session-mode-phase.test.sh:6` 註解提及 gate：**unaffected**，沒有讀取行為。
   - `hooks/tests/session-mode.test.sh:230,455` marker fixture 讀取：**unaffected**，測試資料檢查。
   - `hooks/tests/skill-onoff-findings-batch-v2.test.sh:548` JSON fixture 讀寫：**unaffected**，無 session marker scan。
   - `hooks/tests/skill-onoff-findings-batch-v3.test.sh:94` git fixture 讀寫：**unaffected**，無 session marker scan。
   - `hooks/tests/skill-onoff-g67.test.sh:315` plugin manifest assertion：**unaffected**，不是 runtime marker reader。
   - `hooks/tests/skill-onoff-stage-graph.test.sh:278` stage marker fixture parser：**unaffected**，不是 session-mode marker directory reader。
   - `scripts/check-canonical-invariants.sh:272` command string assertion：**unaffected**，只掃 invariant 字串。
   - `scripts/dispatch-author.sh:757,769,771`：`check_session_mode_gate()` marker glob 和每 marker `node -e`：**rewire** 為 C 的單一 Node 批次檢查與讀取端清除；`:983` 的 gate 呼叫點 **unaffected**，只維持同名呼叫。
   - `scripts/dispatch-hetero.sh:1463,1475,1476`：`check_session_mode_gate()` marker glob：**rewire** 為 C 批次 marker 驗證；`:3899` gate 呼叫點 **unaffected**，維持同名呼叫。`:1949,1951,1973` campaign marker glob 與 Node 讀取是 admission bridge，**unaffected**，保留同一 repo 與 first-offender 語意；此區另列為 C touched surface，清理由 planned sweep 完成。
   - `scripts/dispatch-hetero.sh:2139` gate 順序註解：**unaffected**，沒有讀 marker。
   - 實際檢查 `scripts/dispatch-foreman.sh:442` 與 `scripts/dispatch-explore.sh:67`：**unaffected**，分別是 parent id 說明及清除環境變數，無 marker glob 或逐檔讀取。
   本盤點列出該命令所有命中與兩個相關但未命中的 shell helper，為完整 shell 範圍；不把掃描任務留給 C 實作者。

## 10. 排程與單號

- 計畫凍結後先開 A 的 worktree 與 fleet 子單，A 合併後再同時開 B／C／D 三個（共四張子單）（單號由 PM／實作 lane 開，寫回本單 01M7YVR04S7M46JNCTRGR68C47）。
- 實作引擎：本地 27B 或 codex；優先級 P1。審查走 hetero，不走 sonnet。每塊做完立刻審，不等全部。
- 上線：target live date 2026-11-22（Taipei）；合併 develop 後依 PM pin 流程固定 SHA，記錄 pinned SHA，並在 live 執行 reverse probe；hangar 退役項在 PM 給 go 後轉出。
