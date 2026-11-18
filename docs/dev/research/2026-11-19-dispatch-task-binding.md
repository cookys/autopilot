# 研究報告：強制所有派工綁定活體 Fleet Task 是否能解決跟丟問題？

> 日期：2026-11-19 ｜ 狀態：Research-only ｜ 結論：**Partial（分層攔截 + 自動回寫進度，不做全域一刀切硬擋）**

## 1. 四個派工入口的可行性與既有元件重用

> 命名對齊：現有程式碼已採用 `Fleet-Task: <ULID>`（`scripts/lib/dispatch-lane.sh:24-39`）；若新增 `Task: <id>` 應作為同義別名解析，避免分裂成兩套標頭。

| 入口 | 能否強制攔截 | 線上「存在且未結案」查法與離線降級 |
|---|---|---|
| `Agent`/`Task`（`PreToolUse`） | **僅 Claude Code 可硬擋**：`hooks/hooks.json:145-162` 已掛載 `hooks/dispatch-model-guard.js` 等三個 hook，回傳 `permissionDecision: "deny"` 可阻擋前景與 `claude -p` 呼叫（`hooks/dispatch-model-guard.js:18-23,205-215`）。Codex / OpenCode 無此 hook，僅為文字慣例（`AGENTS.md:89`）。 | 宿主機可由 Node `spawnSync(FLEET_BIN \|\| 'fleet', ...)` 查詢 courier（同 `scripts/lib/fleet-task.js:24-36`），但須壓在 `1.5–2s` 內（`hooks/hooks.json:158,189` timeout 為 `5s`）。無 `fleet` 或 socket 斷線時只能驗 Crockford ULID 格式（`^[0-9A-HJKMNP-TV-Z]{26}$`，`scripts/lib/event-attribution.js:20`）。 |
| `scripts/dispatch-author.sh` | **可硬擋**：在啟動任何 runner / `bwrap`（`scripts/dispatch-author.sh:1696`）前於宿主 shell 執行前置檢查（`scripts/dispatch-author.sh:948-952`），失敗走 `die_precondition`（exit 2，`status: "precondition_failed"`，`scripts/dispatch-author.sh:549-551`）。目前已載入 `scripts/lib/dispatch-lane.sh`（`scripts/dispatch-author.sh:150,1093,1174`）但缺值採 fail-open（`null`）。 | 宿主 shell 可直接呼叫 `fleet` CLI 驗證 task 狀態非 `done`/`failed`/`cancelled`；若在無 courier 的隔離環境或 standalone repo（`CLAUDE.md:16-17`）執行，僅能降級為離線 ULID 格式檢查。 |
| `scripts/dispatch-hetero.sh` | **可硬擋**：在建 worktree 與啟動 runner 前執行前置檢查（`scripts/dispatch-hetero.sh:3101-3156`），失敗走 `die_precondition`（exit 2，`scripts/dispatch-hetero.sh:2055-2067`）；目前已接 `dispatch_export_attribution` 與 `dispatch_attr_fields`（`scripts/dispatch-hetero.sh:439,2664,3106`）。**盲區警告**：code-loop 審查走 `scripts/hetero-review-loop.js:4` → `scripts/dispatch-review.sh:35-38`（`skills/hetero-review/SKILL.md:48-53`），不在這四個入口內。 | 與 `scripts/dispatch-author.sh` 相同：外層腳本跑在宿主端（`bwrap` 僅包內層 worker，`scripts/dispatch-hetero.sh:2150,5189`），可直接查 `fleet` CLI；離線環境僅能驗 ULID 語法或比對本地 `~/.autopilot/session-mode/<sid>.json` 的 `fleet_task_id`（`scripts/session-mode.js:25-28`）。 |
| `fleet dispatch` | **不可要求預填既有 `Task:`（雞生蛋死鎖）**：`fleet dispatch` 本身就是建立新 fleet task 並鑄造 ULID 的入口。`hooks/hooks.json:184-193` 已由 `hooks/fleet-send-work-order-guard.js:64-90` 攔截 `mcp__fleet__send` 偷渡派工，並在 PM console（`hooks/_shared/pm-console.js:60`）檢查 `mcp__fleet__dispatch` 的 `Size:`/`Plan:`（`scripts/lib/work-order-plan.js:24-70`），但經 `Bash` 呼叫 `fleet dispatch` 不經此 MCP matcher。 | 不適用「預先存在」檢查（建單成功即保證活體 task 存在）；僅子層轉派可選填 `Parent-Task:`，絕不可擋根層建單。 |

- **既有元件能否直接重用**：
  - `hooks/dispatch-model-guard.js`：**可重用標頭解析與拒絕骨架**。它已透過 `hooks/lib/brief-header-template.js:7-16,34-49`（`headLines(prompt, 10)`，`hooks/lib/brief-head.js:3-17`）檢查第 1 行 `Engine:`（`hooks/dispatch-model-guard.js:418-439`）、前 6 行 `Cost:`（`hooks/dispatch-model-guard.js:268-276`）及 `Lane:` 存在時的 `Size:`/`Used-by:`/`Stages:`（`hooks/dispatch-model-guard.js:299-323`；`Lane:` 本身由 `hooks/subagent-budget.js:179-184,501-532` 強制）。但它目前零外部程序且 fail-open（`hooks/dispatch-model-guard.js:28-29,341-346`），若加入 `fleet` CLI 查詢須配獨立開關與短逾時。
  - `scripts/run-ledger.sh`：**不可直接重用**。它是本地 JSONL 階段狀態機（`pending..merged`，`scripts/run-ledger.sh:72-147`），只驗 `flock`、`generation`/`nonce` 與 PID + `/proc/<pid>/stat` `start_time` 存活（`scripts/run-ledger.sh:297-354,615-767`）；其 `--ticket-id`（`scripts/run-ledger.sh:617,637,731-738,759`）僅為不透明字串，不查 fleet，且在派工軌為選填（`scripts/dispatch-hetero.sh:638-645`）。
  - `scripts/lib/dispatch-branch-ledger.sh`：**不可做入口閘**。它只在建立 worktree 分支時（`scripts/dispatch-hetero.sh:4588`）將 `{branch, session_id, run_id, root_run_id, created_at, base_sha}` 寫入 `<git-common-dir>/autopilot/dispatch-branches.jsonl`（`scripts/lib/dispatch-branch-ledger.sh:4-8,24-48`），明確設計為 **fail-open**（`scripts/lib/dispatch-branch-ledger.sh:15-16,44-47`），且唯讀軌與 `Agent` 完全不會呼叫它。

## 2. 結案證據自動回寫與 Patrol 喚醒鏈

- **可否自動回寫證據**：**可以，但只能回寫進度/證據（`fleet task update` / `task_evidence`），絕不可自動標 `done`**。依 `ADR-0001`（`docs/dev/adr/0001-verification-over-attestation.md:32-48`）與 `references/hetero-dispatch.md:29-30`，子代理或異質引擎跑完只是產出待驗製品，若自動 `task_result(done)` 會直接關閉 patrol，讓「跑完卻沒人綜合/合併」徹底隱形。
- **Hook 掛載位置與陷阱**：
  1. **Subagent 端應掛 `SubagentStop` + `PostToolUse(TaskStop)`，而非單靠 `PostToolUse(Agent)`**：
     - `PostToolUse` `Task|Agent`（`hooks/hooks.json:242-249`）在 `run_in_background: true` 時於**啟動瞬間**即觸發（僅拿到背景 handle），且同一 `claude` 程序執行 `/clear` 或 `/reload-plugins` 後 `PostToolUse` 分派表會靜默失效（`hooks/README.md:57-60`）。
     - `SubagentStop`（`hooks/hooks.json:380-394`）才代表子代理真正結束（含背景執行）；雖 stdin 無原始 prompt，但可循 `hooks/subagent-budget.js:214-231,281-288` 讀取 `<subagents>/agent-<agent_id>.jsonl` 首則 user 訊息取回 `Fleet-Task:`。另因強殺背景代理的 `TaskStop` **不會觸發 `SubagentStop`**（`hooks/awaiting-owner.js:37-39`、`hooks/live-session-lib.js:175-180`），須同步在 `PostToolUse(TaskStop)` 補寫中止紀錄。
  2. **Hetero 端掛在最終 JSON 輸出旁**：`scripts/dispatch-hetero.sh` 的 inline（`scripts/dispatch-hetero.sh:7149-7158`）與 R1 `setsid` 背景 `detached_main`（`scripts/dispatch-hetero.sh:6927-6940`）皆匯流至 `classify_outcome`（`scripts/dispatch-hetero.sh:6614-6836`）與 `emit()`（`scripts/dispatch-hetero.sh:974-1285`）；在 `scripts/dispatch-hetero.sh:1280` `dispatch-usage.js append` 旁（並將輔助函式列入 `scripts/dispatch-hetero.sh:7013-7018` `declare -f` 清單）以 fail-soft 呼叫 `scripts/lib/fleet-task.js:38` 寫入 `run_id`、`status`、`commit`、`agent_log`（同理 `scripts/dispatch-author.sh:539-545` `emit_result`、`scripts/dispatch-review.sh:2945`）。
- **逾期未結案是否會透過 Patrol 喚醒派工者**：**僅當 `requester == dispatcher` 時成立**（本地 `hooks/stuck-hand-lib.js:21-41` 寄生在 `PostToolUse`，session 閒置時無法自醒，必須靠 courier patrol 推播喚醒）。若派工者自開子單（`requester = dispatcher`），回寫證據後若超過 15 分鐘仍未綜合結案或超過 `until`，patrol 會喚醒派工者；但若 lane 直接沿用上游母單（`requester = PM`, `assignee = lane`），靜默逾時喚醒的是 **PM** 而非該 lane（除非設為 stale `waiting`）。

## 3. 實效驗證：(a)(b)(c) 逐案推演與無法封堵的破洞

- **(a) PM 跑四輪三引擎 hetero review 沒綁單，靠記憶才綜合**：
  - 若只鎖題述四個入口：plan review（`scripts/dispatch-plan-review.js:78` 呼叫 `scripts/dispatch-author.sh`）會被攔下，但 **code review（`scripts/hetero-review-loop.js:4` → `scripts/dispatch-review.sh:35-38`，`skills/hetero-review/SKILL.md:48-53`）完全漏網**！
  - 若連 `scripts/hetero-review-loop.js` / `scripts/dispatch-review.sh` 一併納管，且 PM 為該次審查開立專屬 task（`requester = PM`）：三席跑完回寫證據後，若 PM 忘記綜合且未關單，15 分鐘靜默或 `until` 到期時 **patrol 能抓到並喚醒 PM**。
- **(b) PM 派 subagent 重分類 37 筆項目沒綁單**：
  - `PreToolUse(Agent)`（`hooks/hooks.json:145`）強制要求先建單再派工（`requester = PM`）；子代理跑完後若 PM 遺忘未執行 `task_result(done)`，**patrol 會在 >15 分鐘靜默或逾期時喚醒 PM**——此場景效果最直接。
- **(c) 各 lane 派短工沒綁單，PM 看不到短工與是否回報**：
  - **單靠入口硬擋幾乎無效**。因為該 lane 手上本來就有一張 `in_progress` 的母單 `T_lane`（可由 `$AUTOPILOT_FLEET_TASK` / `$AUTOPILOT_UPSTREAM_TASK_ID` 繼承，`scripts/lib/dispatch-lane.sh:35-37`），lane 只要把所有短工都綁在 `T_lane` 上就完全合規過關，不會產生子單；而本地 manifest 與 `dispatch_usage/1`（`scripts/lib/dispatch-usage.js:5-8,135`）只寫本機磁碟，PM 跨 session/跨機依然看不見短工，除非搭配第 2 節的「啟動/結束自動回寫進度行至 `T_lane`」。
- **規則仍無法封堵的五大破洞**：
  1. **大傘單寄生（Umbrella task laundering）**：把多組無關審查或短工全綁在同一張長期活躍的母單上；其他活動持續刷新 15 分鐘靜默計時，單一遺忘分支不會觸發 patrol。
  2. **離線降級下的假 ULID**：26 碼 Crockford ULID 極易偽造；只要離線 fallback 退回純語法檢查（如 `hooks/owner-question-guard.js:57-59` 的純文字檢查模式），佔位假 ID 即可過關。
  3. **不經派工的 inline 實作或旁路執行**：模型直接在主執行緒 `Edit`/`Write`/`Bash`（未開 opt-in `hooks/orchestrator-edit-gate.js`，`hooks/README.md:137`）或直接呼叫底層 CLI，完全繞過派工閘。
  4. **自建自關卻未落地（Premature self-close）**：派工者拿到產出就順手 `task_result(done)`，實質結果卻未寫入 plan 或未合併（`ADR-0001` `docs/dev/adr/0001-verification-over-attestation.md:19-25`；`scripts/check-unmerged-ship.js:4-35` 僅能抓未合併的 `SHIP-AS-IS` git commit，抓不到純綜合任務）。
  5. **跨機舊版 plugin 與非 Claude 載體**：遠端 lane 若 plugin 未更新、跑在 Codex/OpenCode（`AGENTS.md:89`），或 `claude` 在 `/clear` 後 `PostToolUse` 失效（`hooks/README.md:57-60`），機械閘即出現破口。

## 4. 延遲成本、誤殺場景與豁免清單

- **每次派工新增延遲估算**：
  - **程序內標頭 regex 解析**（併入 `hooks/dispatch-model-guard.js:330-351`）：**< 0.002s**（零額外 spawn）。
  - **本地快取 / `session-mode` marker 讀取**（`scripts/session-mode.js:25`）：**~0.005–0.04s**（參考 `hooks/run-approval-gate.js:73-75` 模組載入約 38ms）。
  - **呼叫 `fleet` CLI 查活體狀態**：本機 courier socket 正常約 **0.05–0.25s**；跨網查詢約 **0.3–1.5s**；courier 卡死時達 **1.5–2.0s timeout 上限**（三席序列啟動則累加 **0.2–6.0s**）。
  - **隱性重試成本（最大開銷）**：漏寫標頭被 `PreToolUse` `deny` 時，多耗 **1–2 輪主模型 turn（+5–25s 牆鐘時間 + 整包 context cache-read tokens）**；headless 下甚至可能重試約 4 次（`hooks/dispatch-model-guard.js:21-23`）。
- **會被誤殺的合理場景**：
  1. **唯讀快速查找與 `Explore` 子代理**：`hooks/depth0-delegate-gate.js:7-18,27-35` 明文催促（甚至在 guarded model 讀滿 16 次時硬擋）主執行緒把讀檔交給 `Explore`；若連 `Explore` 都逼開 fleet task，兩道 hook 直接互毆，且製造大量 30 秒垃圾工單。
  2. **一單多席的 Plan / Code Review 與 Batch Fan-out**：`scripts/dispatch-plan-review.js:7,78`（1–4 席，底層呼叫 `scripts/dispatch-author.sh`）、`scripts/hetero-review-loop.js:4`、`scripts/dispatch-batch.sh:2-10`（同一母單展開多個 `Agent` worker）天生是「一張 task 對多個 seat」，且內部動態組裝 temp prompt，不會手寫 `Task:` 行。
  3. **Consult / 引擎資格評測 / 非 Fleet 獨立專案**：`scripts/dispatch-consult.sh:9`（底層同樣走 `scripts/dispatch-author.sh`）、`scripts/engine-qualify.sh` 與 `scripts/probe-engine-capability.sh`（`CLAUDE.md:34`）及無 `fleet` 的外部 repo（`CLAUDE.md:16-17`）。
- **建議豁免清單（Log-only，不阻擋）**：
  - `Agent` 之 `subagent_type` 為 `Explore` / `Plan`，或無 `Engine:` 前綴之非受管查詢 brief（對齊 `hooks/subagent-budget.js:25-26,508-510`）。
  - 已帶 `AUTOPILOT_PARENT_RUN_ID` 之子席位，或角色為 `reviewer` / `plan-review` / `consult` / `discuss` 時，允許由環境變數 `AUTOPILOT_FLEET_TASK` / `AUTOPILOT_UPSTREAM_TASK_ID` 繼承母單（`scripts/lib/dispatch-lane.sh:35-37`），免除逐席建單與內層 prompt 標頭檢查。
  - 評測與測試通道（`engine-qualify*`、`probe-*`、`--bin`/`--*-bin` 替身）及未啟用 fleet 之 standalone repo（非 `isPmConsole` 且 `hooks.fleet-stop` 未開，`hooks/fleet-stop.js:7-11`）。

## 5. 結論與具體建議（Partial）

- **決策**：**Partial（部分採納）**——在 PM 層對「實質工作與審查迴圈」硬攔截以根治 (a)(b)，在 Lane 層改採「母單繼承 + 生命週期自動回寫進度」以低噪音補齊 (c) 的可觀測性，絕不對唯讀 `Explore` 與根層 `fleet dispatch` 硬擋；`fleet send/reply` 維持本機 `mcp__fleet__send` 派工詞攔截（重播實訊前不擴擋一般 `reply`），`reply_to` 任務鏈自動歸戶交由 fleet courier 負責。
- **具體設計（Block vs Log）**：
  1. **Block（硬擋）**：(i) `isPmConsole`（`hooks/_shared/pm-console.js:60`）下所有帶 `Engine:` 且非 `Explore`/`Plan` 的 `Agent` 派工（擴充 `hooks/dispatch-model-guard.js:299-323` + `hooks/lib/brief-header-template.js:7-16`，以 `1.5s` timeout 呼叫 `fleet` 驗 open 狀態）；(ii) `isPmConsole` 下的 `scripts/hetero-review-loop.js:4`（`collect`）與 `scripts/dispatch-plan-review.js:110-118`（要求 `--fleet-task` 或 `AUTOPILOT_FLEET_TASK` 指向活體 task，真正堵住 (a)）；(iii) 當 `scripts/session-mode.js:25` marker 已綁 `fleet_task_id` 時，`scripts/dispatch-hetero.sh:3106` 缺有效 ULID 則 `die_precondition`。
  2. **Log + 自動回寫（不擋）**：`Explore` 子代理、`scripts/dispatch-author.sh`、`scripts/dispatch-review.sh` 及 lane 內短工，自動從 brief 或 `scripts/session-mode.js:25` 繼承 `Fleet-Task`；於 `SubagentStop`（`hooks/hooks.json:380`）+ `PostToolUse(TaskStop)`（`hooks/awaiting-owner.js:37-39`）及 `scripts/dispatch-hetero.sh:1280` / `scripts/dispatch-author.sh:539` / `scripts/dispatch-review.sh:2945` 透過 `scripts/lib/fleet-task.js:38` 非阻塞回寫一行 `[dispatch:<role>] <run_id> <status> sha=<commit> log=<path>`，讓 PM 直接從母單 timeline 看見所有短工與審查席是否歸隊。`fleet dispatch` 維持現有 `hooks/fleet-send-work-order-guard.js:64-90` 不加前置 `Task:` 鎖。
- **規模（Size）與執行引擎**：規模 **`M`**（約 7–9 個檔案）。因規模超過 `S`、觸及核心 hooks/`scripts/` 且需讀取 subagent transcript，依 `scripts/lib/cn-model-dispatch-gate.js`（`CLAUDE.md:69`、`references/hetero-dispatch.md:288-290`）**禁用雲端 CN 模型**；建議由 `/l5` 派 **`codex`（`gpt-5.4-codex` high）** 或 `/l4` **`claude-sonnet`** 實作，並交由跨家族席位（`agy/gemini-4-carbon-high` + `grok`）執行 `scripts/hetero-review-loop.js` 驗收。
- **必備負向控制（Negative Controls，`CLAUDE.md:24` / `scripts/CLAUDE.md:13`）**：
  1. **漏標頭紅燈**：PM console 下 `Role: implementer` 的 `Agent` 缺 `Fleet-Task:` 時必須回 `deny`（先證紅燈再證補齊放行）。
  2. **假 ID 與已結案 ID 紅燈**：傳入語法合法但 `FLEET_BIN` stub 回報 `not_found` 或 `done`/`failed` 的 26 碼 ULID，必須被擋（證明非純離線 regex）。
  3. **豁免正反對照**：同環境下 `subagent_type: "Explore"` 無 `Fleet-Task:` 必須放行（exit 0），而受管實作子代理無標頭必須被擋。
  4. **背景收尾與 Fail-open 控制**：驗證 `SubagentStop` 與 `PostToolUse(TaskStop)` 會觸發回寫而 `PostToolUse(Agent)` 啟動瞬間不會誤報完成；且當 `FLEET_BIN` 逾時或失敗（exit 3）時，回寫路徑 fail-open，絕不影響 `scripts/dispatch-hetero.sh:1278` 的 stdout JSON 或 exit code。

## 6. `fleet send` / `reply` 訊息入口評估

- **(a) 自動綁單與證據歸戶（Autopilot vs Fleet Courier；`fleet` 程式碼不在本 repo，見 `references/peer-addressing.md:3-8,75`，不臆測其內部實作）**：
  - **Autopilot 端上限（僅能依顯式標頭補寫進度行）**：`PreToolUse` 的 `hooks/fleet-send-work-order-guard.js:3-4,78-90`（`hooks/hooks.json:184-193` matcher 為 `mcp__fleet__send|mcp__fleet__dispatch`，不含 `mcp__fleet__reply`）在送出前執行，尚無 `message_id` 與投遞收據（`references/peer-addressing.md:42-46`、`scripts/open-decision.js:1297-1302`），不可在此預寫證據。`hooks/hooks.json:195-270` 的 `PostToolUse` 現僅有 `.*` 觀察鏈（`hooks/hooks.json:197-220`）與 `Bash|mcp__.*` 的 `hooks/pm-output-cap.js:149-151`（`hooks/hooks.json:260-269`），無 `mcp__fleet__send` / `mcp__fleet__reply` 專屬處置；若新增 `PostToolUse` hook，可由 `hooks/transcript-reader-lib.js:255-276` 取回成功呼叫、擷取內文顯式 `Fleet-Task: <ULID>`（`scripts/lib/dispatch-lane.sh:28`）並以 `scripts/lib/fleet-task.js:38-40`（`fleet task update`）附加進度證據。惟本 repo 無建立結構化 sub-step 的封裝（`scripts/lib/fleet-task.js:4-13`），裸掃任意 26 碼 ULID（`scripts/lib/event-attribution.js:20`）會誤抓位址 `@01M…` generation 或 `message_id`/`answer_id`（`references/peer-addressing.md:20`、`hooks/advisory-relay.js:107`），且漏掉 `Bash` `fleet send|reply`（`skills/agent-call/SKILL.md:14-17`）並在同程序 `/clear` 後靜默失效（`hooks/README.md:57-60`）。
  - **唯 Fleet Courier 能做的事**：`mcp__fleet__reply` 僅傳入目標 `message_id`（`skills/agent-call/SKILL.md:18`、`references/peer-addressing.md:33`），本 repo 不保存跨機訊息圖譜或 `message_id -> dispatch` 索引；沿 `reply_to` 祖先鏈追溯根 `dispatch` 並自動掛為子步驟或證據，以及涵蓋 CLI／tmux 全通道的一致歸戶，只能由 fleet courier 實作。
- **(b) 攔截 `[no-task]` 偷渡派工（重用既有偵測器）**：
  - 重用 `hooks/fleet-send-work-order-guard.js:29-32,48-52` 的 `isWorkOrder(content)`：該檔已明定 `[no-task: ...]` 非豁免（`hooks/fleet-send-work-order-guard.js:10,28`、`hooks/fleet-send-work-order-guard.test.js:10,20-27`），以不分大小寫子字串 `.includes()` 比對 `WORK_ORDER_PHRASES` 共 **17 個詞組**——7 個交件詞（`'回一行'`, `'回報'`, `'附 run id'`, `'回 sha'`, `'交件'`, `'report back'`, `'reply with'`，`hooks/fleet-send-work-order-guard.js:30`）與 10 個立即行動祈使詞（`'現在就跑'`, `'去跑'`, `'開跑'`, `'請做'`, `'請跑'`, `'請修'`, `'要你'`, `'run it now'`, `'please run'`, `'please implement'`，`hooks/fleet-send-work-order-guard.js:31`）。
  - 若要完整拒絕帶 `[no-task]` 的派工訊息，須補三個現存破口：(i) `hooks/fleet-send-work-order-guard.js:86` 在 `toolInput.fyi === true` 時無條件放行派工詞（`hooks/fleet-send-work-order-guard.test.js:33-35`），違背 `references/peer-addressing.md:75`（派工禁標 `fyi`）；(ii) `hooks/fleet-send-work-order-guard.js:87` 無條件放行 `@channel` 廣播；(iii) `mcp__fleet__reply` 未納入 `hooks/hooks.json:185` 與 `hooks/fleet-send-work-order-guard.js:84`（`hooks/fleet-send-work-order-guard.test.js:40-42`），且 `Bash` `fleet send|reply`（`skills/agent-call/SKILL.md:14-17`）繞過 MCP hook（本機無 courier 查鏈時，僅能增擋顯式含 `[no-task` 且命中 `isWorkOrder` 的 `reply`）。
- **(c) 預估誤攔率（本 repo 無實況訊息語料；以下依 `hooks/fleet-send-work-order-guard.js:29-32,48-52` 靜態推估，定案前須抽樣重播真實訊息驗證）**：
  - **自由文字操作員轉達、否定句與原文引述 — High**：`hooks/fleet-send-work-order-guard.js:48-52` 純 `.includes()` 不識否定與引號，「操作員說先別開跑、不用回報」或引述卡片文字（如 `scripts/open-decision.js:1271` 含 `'回報'`）直接命中 `hooks/fleet-send-work-order-guard.js:30-31`，且要求停手的轉達不設 `fyi=true`（`scripts/open-decision.js:1307`）。
  - **排程裁定、`go`、更正（Rulings）— Medium–High**：對既有任務發 `go，現在就跑` 或 `更正：改去跑 B，回一行` 常含祈使詞（`hooks/fleet-send-work-order-guard.test.js:10`），且 GO/STOP 決策禁標 `fyi=true`（`references/peer-addressing.md:75`），誤走 `send` 而非 `reply` 即遭攔截。
  - **第一人稱狀態同步與除錯引述 — Medium**：「我剛開跑測試，稍後回報」或討論規則引述 `'reply with'`/`'report back'`，漏標 `fyi=true` 即因無主詞區辨誤觸。
  - **純事實提問與短 Ack — Low**：詞表已刻意避開一般疑問詞（`hooks/fleet-send-work-order-guard.js:27`、`hooks/fleet-send-work-order-guard.test.js:44-46`），僅問句偶含 `'回報'`/`'要你'`（「何時回報？」）時零星誤傷。
- **(d) 豁免清單與固定規則可判定性**：
  - **可由固定規則判定**：`fyi=true`（MCP `tool_input.fyi === true` `hooks/fleet-send-work-order-guard.js:86`；CLI `FLEET_FYI=1` `references/peer-addressing.md:75`，惟須排除同文標 `[no-task` 夾祈使詞）；**程式化** `operator relays`（`scripts/open-decision.js:1336-1341` `[操作員答覆] d-xxxxxxxx`、`scripts/lib/card-notice.js:27` `AUTOPILOT-CARD/1 `、`scripts/request-decision.js:31` `AUTOPILOT-REQ/1 ` 固定封包，防偽仍賴 courier 驗發送端與 `answer_digest`）；**封閉短句** `acks`（限短長度的 `收到`/`ack`/`ok`/`thanks` 白名單且不含 `hooks/fleet-send-work-order-guard.js:30-31` 詞組）；`replies to an existing task thread` **限 courier 端**可由 `reply_to -> dispatch` 鏈固定判定（Autopilot 本機僅能識別 `Fleet-Task: <ULID>` 標頭 `scripts/lib/dispatch-lane.sh:28`，無法單憑 `message_id` 驗活體 task）。
  - **無法由固定規則安全判定**：`pure information / status` 與長句 `acks`（中文常省主詞，與祈使句共用 `hooks/fleet-send-work-order-guard.js:30-31` 詞彙，須靠發送端顯式標 `fyi=true`）；`ruling results`（`裁定`、`go`、`更正`，本機面板單行 `[待決回覆·更正]` `scripts/lib/decide-line.js:21,55` 除外）與**自由文字** `operator relays`（與無單偷渡派工詞彙完全重疊，見字豁免即成萬用繞過後門，應要求走原任務串 `reply` 或附 `Fleet-Task: <ULID>`）。
- **(e) 單行建議**：Autopilot 端維持 `hooks/fleet-send-work-order-guard.js:29-32,78-90` 現有 17 詞 `mcp__fleet__send` 攔截（僅補擋 `fyi: true` 夾帶 `[no-task` 派工詞，先重播真實訊息校準誤攔率，不在本機硬擋一般 `mcp__fleet__reply`），並將 `reply_to` 任務鏈自動歸戶與執行緒級豁免交由 fleet courier 實作。
