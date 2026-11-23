# Plan - 白跑輪數改善：量測、逐項選做法、分段上線

> Status: frozen（凍結版：兩代審查到上限，PM 11-22 裁 A，不再開第 3 代審查）。Owner: autopilot lane。Branch: feat/wasted-turns-plan。Fleet-Task: 01M7XSVAGG1J7AZKV3861D2100。Frame: 只寫計畫，本次不改任何 hook 或腳本。Version 維持 3.0.0（版號暫停）。

## 0. Context / thesis

每多一輪 tool call，整段 context 就重讀一次。PM 席約 45 萬 token：快取命中時一輪約 4.6 萬 token，沒命中約 90 萬；一個工具的說明每輪只要幾十 token。所以「多一輪白跑」比「多一行工具說明」貴上千倍。便宜的解法是把「報錯後才知道正確指令」改成「第一次就拿到正確指令」。

量測（出處：PM 單 01M7XSVA，原文引用，只引用、不重測、不重算、不與真實 PM 席核對）：511 次 tool call、約 98 輪白跑、19%、查 `--help` 15、工具報錯 41、Stop hook 擋回 42。工具報錯原文依次數排：bash-footgun-guard（zsh glob）12、time_in_content 7、command hook（原文寫「5 共 4」，兩數不一致，維持未解，不重算、不覆蓋）、bash-launch-guard 3、dispatch-model-guard 2、其他 13。新窗口的腳本輸出另記，不要求對上 98/511。

旁證（本席撰寫此計畫時，4 次 Bash 呼叫就被擋 4 次：bare-ls、zsh glob、`=====` 被 zsh 展開、secret-print；各一輪白跑）。這只是旁證，不當量測。

## 1. Problem

要降低的是「白跑輪」：沒有推進任務、只是為了得知正確用法或被攔下而多花的一輪。目標是每個 guard 的拒絕訊息在第一次就讓模型照打就對。

## 2. OKR / KRs

- KR1：每席每百輪的白跑輪數，修前、修後各用同一支量測腳本量一次；白跑佔比從 19% 降到 5% 以下。
- KR2：全機隊每席跑過一次量測，前 N 名排行入庫，之後每週自動跑一次。
- KR3：納入範圍表（§3）每一項都有一個選定做法加一行理由，或標「外部 lane 負責」。
- **壓縮次數（每席每 24 小時）**：來源為既有 `bin/claude-seat-ctx.sh` 探針／updater 全機隊掃描所計數之 `compact_boundary` 事件（只取數字欄位，不讀訊息內容）。修前基準（2026-11-21 01:02Z 掃描）：`autopilot--claude` 64、`fleet--claude` 31、`hangar--claude` 28（對照：`alfred` 8、`codeforge` 13、`capacity` 12、`ops` 17、`pm` 1，其餘多為 0–5）。目標：各 lane 席位壓縮次數 <= 15 次 / 24 小時；於 P7 修後重開 session 後，以同一 `claude-seat-ctx.sh` 24 小時掃描重測並與基準對照。

### 2.1 壓縮頻繁的原因與改法

每次壓縮都會重寫整段快取，且壓縮後的接續會遺失細節。以下三席為 24 小時壓縮最高者（除 `autopilot` 的低門檻設定為已知事實外，其餘原因皆為「假設，待量測驗證」）：

- **`autopilot--claude`（64 次 / 24h，ctx 203456 / 1000000 window，未讀到 autoCompactWindow）**：
  - 最可能原因：**壓縮門檻設太低**（已知設定事實：Fable/Opus 席因單價較高，repo 刻意設低壓縮點，handoff 點 `t2 = 150K` token、`autoCompactWindow` 約 `233K`，相較 Sonnet/Haiku 的 `t2 = 250K`、`333K` 狹窄許多；`150K` hook 提示收尾到 `233K` 之間僅約 `80K` 緩衝，讀大輸出數十輪即觸發）＋ **單次工具輸出過大**（假設，待量測驗證）。
  - 驗證指標：在 P1 量測窗口內，從該席最後一次 session 的用量／大小欄位統計前 10 大 `tool_result` 位元組／token 數與單輪增量（絕不讀訊息內容）。
  - 改法（沿用 P2／P5）：不放寬任何 guard，於 P5 將常跑的長輸出指令收斂為只印摘要／行數上限的腳本，減少單輪把整份檔案或長 log 灌進 context。

- **`fleet--claude`（31 次 / 24h，ctx 140440 / 1000000 window）**：
  - 最可能原因：**subagent 回傳結果過長** 或 **單次工具輸出過大**（假設，待量測驗證：作為調度／派工席，頻繁接收子席回報或長 CLI 輸出易快速推高 context）。
  - 驗證指標：於 P1 窗口統計該席最後一次 session 中，各 `tool_result` 與 subagent 回傳訊息的 size 欄位分布（只讀大小欄位，不讀內容）。
  - 改法（沿用 P1／P6）：透過 P6 把量測數據送交 fleet lane，請其於 P5 對應的腳本化／MCP 回傳格式中限制單次狀態查詢與子席回報只回摘要欄位。

- **`hangar--claude`（28 次 / 24h，ctx 171654，autoCompactWindow 250000，佔 68.7%）**：
  - 最可能原因：**單次工具輸出過大**（假設，待量測驗證：主機側巡檢／維運指令若把整段系統 log 或多步輸出直接印回 context，在 `250K` 上限下極易反覆觸發壓縮）。
  - 驗證指標：於 P1 窗口統計該席最後一次 session 的最大 `tool_result` size 欄位與 `compact_boundary` 前一輪的單次增量（只讀用量／大小欄位，不讀內容）。
  - 改法（沿用 P5／P6）：透過 P6 請 hangar lane 依 §3.2「hangar 腳本 (c)+(e)」原則，將多步巡檢 shell 收斂為只輸出異常摘要的腳本，不刪除任何檢查。

## 2.5 Global Constraints (copied verbatim into every dispatch)

- 不得在 session 中途改變工具清單的前段（會讓快取整段重寫）。新增或改名的工具、改過說明的工具，下次 session 開頭才生效；本計畫所有「工具」類變更都以此為上線條件。
- 每個新增或修改的檢查（gate、hook、scan）都附負控制：故意做錯的案例先紅、改完才綠（scripts/CLAUDE.md 的 negative control 規則）。
- 量測只讀自己席位的逐字稿（d-7436a800）；別席只讀用量數字欄位（model、token 數、時間戳），絕不讀訊息內容（d-d031e0de）。不碰真實 ~/.claude 的設定、hooks、憑證。
- 不加 trust machinery（ADR-0001）；腳本用獨立重算驗證，不用簽章或帳本。
- 不得為了降低數字而放寬真正在擋危險操作的 guard（rm、秘密、跨 lane 派工）；這類只改拒絕訊息，不改判定。
- 不 bump 版號，不寫 CHANGELOG 以外的發版動作；committed 檔案不放私網 IP 字面值。

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`。受影響的是本 repo 的 hook 拒絕訊息文字與新增的量測腳本；不改任何 hook 的 deny/allow 判定。唯一例外是 §4 P2 已點名的 bare-ls spike。P3 只做做法 (e)：拒絕訊息附可直接照打的指令，Stop 檢查的 allow/deny 維持不變，並以該檢查的既有測試驗證。若 spike 證明 harness 不支援改寫輸入，表上做法維持 (e)，仍是 internal-only。
- **Dependency decision**: `none`。只用 Node 內建模組，沿用 `hooks/transcript-reader-lib.js` 與 `hooks/cost-tracker-lib.js` 已有的逐字稿解析。

## 3. 納入範圍與每項選的做法

做法代號：(a) MCP 工具、說明寫必填欄位與拒絕碼；(b) skill，只放一行說明、用時才載入；(c) 腳本；(d) guard 自動修正；(e) 拒絕訊息附可直接照打的正確指令。行號由 worktree 內 grep 取得（2026-11-21）。

### 3.1 本 repo 內（autopilot 負責）

實際清單來自 `git ls-files hooks scripts | grep -i guard` 與 `hooks/hooks.json` 的 PreToolUse / Stop 段。

| 項目 | 位置 | 現況 | 做法 | 一行理由 |
|---|---|---|---|---|
| Bash 啟動規則（bare-ls、pkill 自比對、rm 變數目標、rm 包在 -c、偵離無喚醒） | `scripts/lib/bash-launch-rules.js`，由 `hooks/depth0-delegate-gate.js:249` 回 deny | 拒絕訊息已列改寫法，但各規則詳略不一 | (e) | 每條拒絕附一條照打指令，不改判定。bare-ls 的 (d) 只是 §2.6 點名的 spike，不是本列做法；spike 失敗就停在 (e) |
| foreman-guard | `hooks/foreman-guard.js:531` | context 上限、bash 數量上限、Monitor 規則 | (e) | 拒絕理由已含下一步（寫 handoff）；補上可貼的指令即可，不改判定 |
| dispatch-model-guard（ask / deny、brief 標頭） | `hooks/dispatch-model-guard.js:200`、`:212`、`:342` | PM 席原文引用 2 次；`:342` 缺 Size/Used-by 就 deny | (e) | deny 附 `model:` 範例；`:342` 的拒絕只指向 `scripts/brief-head.sh` 印出的整段標頭。不改判定 |
| fleet-send-work-order-guard | `hooks/fleet-send-work-order-guard.js:105` | 擋把工單當訊息送 | (e) | 訊息已告知改用 task_comment；補上欄位範例 |
| pii-read-guard | `hooks/pii-read-guard.js:73` | 擋直接讀含個資的目標 | (e) | 附 `safe-inspect` 的可貼指令 |
| scheduled-wakeup-guard | `hooks/scheduled-wakeup-guard.js` | 擋以時間點等待 | (e) | 附 `fleet watch` 的可貼寫法，對應 CLAUDE.md「等待要寫可檢查事件」 |
| 路徑與設定保護（exec-boundary、branch-protection、config-protection） | `hooks/exec-boundary.js:319`、`hooks/branch-protection.js:64`、`hooks/config-protection.js:43`（exit 2） | 多為 opt-in，擋破壞性操作 | (e) | 只補 exit 2 的可貼指令，allow/deny 不變 |
| Stop：per-turn-gate | `hooks/per-turn-gate.js:576`（decision block） | Stop 擋回來源之一 | (e) | 拒絕附照打指令，不改判定；記在既有單 01M7XQVB |
| Stop：owner-question-guard | `hooks/owner-question-guard.js:87-90` | 有自報誤擋通道（`:17`，`OWNER-GUARD-FALSE-POSITIVE`） | (e) | 拒絕附照打指令，不改判定；記在既有單 01M7XQVB |
| Stop：askpm-remind | `hooks/askpm-remind.js` | opt-in | (e) | 只補可貼指令，不改判定 |
| Stop：awaiting-owner | `hooks/awaiting-owner.js` | Stop 包裝 | (e) | 只補可貼指令，不改判定 |
| brief 標頭腳本 | `scripts/brief-head.sh` | 缺標頭時要有機械產出 | (c) | `--role <r> --lane <l> --size <s>`，印合格標頭 |
| open-decision.js、decision-ledger.js、request-decision.js | `scripts/open-decision.js` 等 | 參數錯誤時靠 `--help` | (e) | 用法錯誤直接印一條完整範例指令，退出碼固定 |
| run-ledger.sh（本 repo） | `scripts/run-ledger.sh` | 同上 | (e) | 同上 |

不入上表（不是做法列）：`hooks/run-approval-gate.js` 是派工前權限詢問，不改訊息、不改判定，P0 只計次數。`scripts/lib/bash-launch-rules.js:11-12` 的 zsh 警告只警告、不擋，不在拒絕路徑；擋人的 bash-footgun-guard 見 §3.2。`hooks/fleet-stop.js` 只包裝 `fleet hook stop`，判定見 §3.2。`scripts/leak-guard.js`、`scripts/lib/root-scan-guard.js`、`scripts/lib/disk-guard.js`、seat-id-guard、vision-guard、replay-stop-guard、`agy-shell-guard.zsh` 與 `hooks/tests` 的 `*-guard` 不在每輪 tool call 路徑。

### 3.2 不在本 repo（標「外部 lane 負責」，autopilot 只提供介面）

| 項目 | 負責 | 預計做法（建議，由該 lane 決定） | 理由 |
|---|---|---|---|
| bash-footgun-guard（zsh glob，12 次，最大單項） | 外部 lane，來源待查（本 repo `git grep` 無此名稱） | (d)：自動給 glob 加引號；做不到則 (e) | 規則 3 的拒絕訊息已含正確寫法，等於已經知道答案卻要模型重打一輪 |
| time_in_content（7 次） | fleet lane（`due_reason` 規則，本 repo 無此檢查） | (e)：訊息附合格的 `依據:` 單行範例 | 規則已寫在使用者記憶 fleet-evidence-due-reason-basis，應由拒絕訊息攜帶 |
| command hook（原文「5 共 4」，未解，不重測） | hangar lane（主機側 command hook；不在本 repo） | (e) | 小計矛盾只保留引用；autopilot 不重算、不改該 hook |
| fleet CLI 與 MCP | fleet lane | (a)：MCP 工具說明寫必填欄位與拒絕碼；requester 四個（task_status、task_accept、task_progress、task_comment）已在 fleet 單 01M7XSNQ | 工具說明每輪只幾十 token，勝過每次查 help |
| inbox-cli | fleet lane | (a) 或 (e) | 同上 |
| 各 repo 的 ledger.sh（本 repo 以外） | 各 repo 的 lane | (e) | 各自的用法錯誤印可貼範例 |
| hangar、capacity 的腳本 | hangar lane、capacity 負責人 | (c)+(e) | 重複的多步 shell 變成一支腳本，帶 usage 範例（hangar 只能從 <host> 讀，本席不碰） |
| fleet hook stop 的判定 | fleet lane | 與 01M7XQVB 對接 | 判定在 fleet 二進位內 |

## 4. 分段與上線

時間為台北時間。除 P3 外，fleet 單號欄先填「待開」，開單後回填。P3 只記在既有單 01M7XQVBYG2Q8A4M6RFR8Z4MBR（01M7XQVB），不開第二張、不回填另一張。依賴欄寫前置段。改程式的段（P2、P3、P4、P5）必須排在 P1 之後：該席的基準檔被接受之前不得改碼。P1 與 P7 仍用同一支腳本、同一窗口天數，每席至少 300 輪；P7 只在變更過的 session 重開後才跑。

| 段 | 內容 | 大小 | 上線日 | fleet 單號 | 依賴 | 驗收 |
|---|---|---|---|---|---|---|
| P0 | 量測腳本 `scripts/wasted-turns-report.js` 與測試；先跑本席，再發給各席各跑一次；排前 N 名 | M | 2026-11-22 | 待開 | 無 | 見 §5 |
| P1 | 修前基準：各席對新窗口跑 P0 腳本，JSON 進 `docs/plans/evidence/2026-11-21-wasted-turns/`。只記新窗口，不回寫、不覆蓋 §0 的 511、約 98、19%、15、41、42，也不要求對上 98/511 | S | 2026-11-23 | 待開 | P0 | 每個參加席有一份已接受的基準檔；KR1 修前欄用新窗口 |
| P2 | 拒絕訊息附可貼指令（做法 (e)）：bash-launch-rules、dispatch-model-guard、fleet-send-work-order-guard、pii-read-guard、scheduled-wakeup-guard、foreman-guard、路徑與設定保護。spike 只試 bare-ls 能否改寫輸入；不能就維持 (e)。此 spike 是唯一可改判定的例外 | M | 2026-11-25 | 待開 | P1 | 該席 P1 基準檔已接受。每個被改的 hook 一個負控制；訊息中的指令被測試照字面執行並通過同一個 guard |
| P3 | Stop hook 拒絕訊息（做法 (e)）：訊息附可直接照打的指令，allow/deny 不變 | M | 2026-11-26 | 01M7XQVBYG2Q8A4M6RFR8Z4MBR | P1 | 該席 P1 基準檔已接受。每個被改的 hook 一個負控制；訊息中的指令被測試照字面執行並通過同一個 guard。既有 allow/deny 測試仍為原判定 |
| P4 | 查 help 的來源：`scripts/open-decision.js`、`decision-ledger.js`、`request-decision.js`、`run-ledger.sh` 的用法錯誤印完整範例；新增 `scripts/brief-head.sh`（做法 (c)；訊息列為 (e)） | S | 2026-11-27 | 待開 | P1 | 該席 P1 基準檔已接受。缺必填欄位時輸出含完整範例且退出碼固定；測試把該範例照字面執行，須通過剛才拒絕它的同一支腳本並以成功退出碼結束 |
| P5 | 重複多步 shell 的清單（P0 輸出第五類）→ 逐項腳本化或進既有腳本；超過兩次手跑的才做 | S | 2026-11-30 | 待開 | P1 | 每項附腳本與測試。每個新增或修改的腳本有負控制，其拒絕範例照字面跑過同一支腳本。清單中未做的標明理由 |
| P6 | 外部 lane 對接：把 §3.2 的表和 P1 數字送 fleet lane、hangar lane、PM；MCP 變更在下次 session 開頭生效 | S | 2026-11-24 | 待開 | P0 | 對方回覆單號；autopilot 不改它們的程式 |
| P7 | 修後量測：全機隊每席跑一次，與 P1 對照；每週自動跑一次 | S | 2026-12-03 | 待開 | P2–P5 合併且新 session 已開 | KR1 的「修後」欄 < 5%；週跑排程上線 |

### 4.1 量測腳本規格（P0）

- 腳本：`scripts/wasted-turns-report.js`；共用邏輯放 `scripts/lib/wasted-turns-classify.js`；測試 `scripts/wasted-turns-report.test.js`。登記進 `docs/scripts-inventory.md` 和 `scripts/CLAUDE.md` 的分組（Mission, campaign & session state 之外另開「Session efficiency」一行）。Node >= 20.10，只用內建模組，逐字稿解析沿用 `hooks/transcript-reader-lib.js`，用量欄位沿用 `hooks/cost-tracker-lib.js`（每個 assistant 回應只算一次，避免多行重複計）。
- 輸入：
  - `--self`：只分析本席逐字稿（預設），範圍依 d-7436a800（本席現在與先前的 session）。
  - `--usage-only --transcript <path>`：別席，只讀 model、token 數、時間戳；程式內只建立這些欄位的投影，訊息內容不進記憶體的輸出路徑，依 d-d031e0de。此模式五類中只能算「輪數與 context 成本」，分類欄輸出 `null`。（別席的分類改由該席自己跑 `--self` 後交 JSON。）
  - `--window <days>`（預設 7）、`--out <path>`、`--top <N>`（預設 10）。
  - `--aggregate <dir>`：讀各席交來的 JSON，排前 N 名，不再讀任何逐字稿。
- 五類定義（一輪只算一次，優先序由上而下，前四類加總為「白跑輪」，與 PM 單口徑相同；第五類另列、不計入白跑佔比）：
  1. `stop_block`：Stop hook 回 block 後的下一輪。
  2. `hook_block`：PreToolUse hook 的 deny 或 hook error 結果（用結果文字前綴辨識 hook 名稱）。
  3. `help_lookup`：Bash 指令的最後一個參數為 `--help`、`-h`、`help`，或指令為 `man`。
  4. `error_retry`：tool_result 為錯誤，且之後三輪內同一工具再試。再試只在整段指令文字（不是只比第一個詞）、經過本段所載正規化（去掉前後空白、連續空白併成一個）之後，與被拒的那條指令相同時才計入。
  5. `repeat_chain`（僅供 P5）：同一串 >= 2 步的 shell 序列（正規化後）在窗口內出現 >= 2 次。
- 成本：每個被分類的輪，取該輪前一個 assistant 回應的 context 大小（input + cache_read + cache_creation token）。輸出 `ctx_tokens` 原值，另依假設係數估算 `cost_hit` 與 `cost_miss`：命中約為 context 的 0.10 倍、未命中約為 2.0 倍（由 PM 單的 45 萬對 4.6 萬與 90 萬換算，**假設值**，放在檔頭常數，可由 `--hit-factor` `--miss-factor` 覆寫）。命中與否以該回應 cache_read > 0 判定。
- 輸出 JSON schema（`schema: "autopilot.wasted-turns/1"`）：

```json
{
  "schema": "autopilot.wasted-turns/1",
  "seat": "<address or label>",
  "mode": "self | usage-only",
  "window": {"from": "<UTC+8 ISO>", "to": "<UTC+8 ISO>"},
  "turns_total": 0,
  "whiff": {
    "stop_block": {"turns": 0, "ctx_tokens": 0, "cost_hit": 0, "cost_miss": 0},
    "hook_block": {"turns": 0, "by_hook": {"<hook-name>": 0}, "ctx_tokens": 0, "cost_hit": 0, "cost_miss": 0},
    "help_lookup": {"turns": 0, "ctx_tokens": 0, "cost_hit": 0, "cost_miss": 0},
    "error_retry": {"turns": 0, "ctx_tokens": 0, "cost_hit": 0, "cost_miss": 0},
    "repeat_chain": {"chains": [{"shape": "<normalized>", "count": 0}]}
  },
  "whiff_turns": 0,
  "whiff_per_100": 0.0,
  "whiff_share": 0.0
}
```

  `mode: usage-only` 時 `whiff` 內各類為 `null`，`turns_total` 與 context 欄位照填。`--aggregate` 輸出 `{schema: "autopilot.wasted-turns.rank/1", top: [{seat, whiff_per_100, whiff_cost_hit, whiff_cost_miss}], fleet: {...}}`。時間一律台北時間，不寫 Z。
- 測試做法：
  - 合成逐字稿 fixture（`scripts/fixtures/wasted-turns/*.jsonl`），每類至少一正一反例，期望計數用手算寫死。
  - 負控制：故意把「報錯後換了不同指令」的案例標成不該算 `error_retry`，先確認舊分類器把它誤算（紅），修分類後綠。
  - usage-only 隱私測試：fixture 的訊息內容放一個哨兵字串，斷言輸出 JSON 與 stderr 都不含該字串。
  - 回算測試：以 PM 單數字（511 輪、98 白跑）建一份縮小比例的 fixture，斷言前四類加總與佔比公式正確，不斷言真實席位數字。
  - 所有測試用暫存目錄與沙箱 HOME，不讀真實 ~/.claude。
- 週跑：腳本不自帶排程。排程由 PM 指定的執行席以 fleet 的排程機制每週觸發各席 `--self`，結果交到共用收集目錄，再跑 `--aggregate`；排程設定屬外部 lane，本計畫只交腳本與一行呼叫範例（P7）。

### 4.2 fleet 分工與介面

- **歸 fleet**：所有 MCP 工具的新增或說明改寫（做法 (a)）、fleet CLI 的 help 與錯誤碼、time_in_content 訊息、`fleet hook stop` 的判定。requester 四個工具已在 01M7XSNQ，本計畫不重複開。
- **歸 autopilot**：本 repo 內 §3.1 全部項目、量測腳本、brief-head 腳本、Stop hook 的 hook 側（與 01M7XQVB 合併）。
- **介面對接**：
  1. autopilot 交 `autopilot.wasted-turns/1` JSON 與 `hook_block.by_hook` 排行；fleet 依排行決定先改哪個工具的說明。
  2. fleet 的拒絕碼表以 `docs/` 內一份純文字清單交給 autopilot；autopilot 的拒絕訊息只引用拒絕碼，不複製說明（單一正本）。
  3. 工具清單前段凍結：fleet 新增或改說明的 MCP 工具，在 fleet 單上寫明「下次 session 開頭生效」；autopilot 的 P7 修後量測要等這些 session 重開後才跑。
  4. Stop hook：hook 側歸 autopilot，判定側歸 fleet，雙方只記在既有單 01M7XQVBYG2Q8A4M6RFR8Z4MBR，不另開第二張。

## 5. Test / validation

- script-gated：§4.1 全部測試；每個 P2/P3/P4 被改的 hook 或腳本的負控制測試；`bash scripts/sync-all.sh --check`；`node scripts/affected-suites.js` 選出的套件。
- 人為判定：§3.2 外部項目的做法由各 lane 判。P3 只改拒絕訊息，不把刪除或收緊交給本計畫判定。
- 真用驗收（Done = used）：P7 在 live 以實際席位跑 `--self`，貼出該席修前修後同一欄位的對照一行（新窗口對新窗口，不與 §0 的 98/511 核對）。gate 類改動各做一次反向探測（故意違規，確認仍被擋，且訊息的指令照字面貼上後通過同一個 guard）。P4 的 `open-decision.js`、`decision-ledger.js`、`request-decision.js`、`run-ledger.sh`、`brief-head.sh` 同樣：拒絕訊息裡的完整範例照字面執行，通過剛才拒絕不完整指令的同一支腳本。

## 6. Risks + inversion

- 做法反了：把 guard 放寬而不是改訊息，白跑數字下降但真問題漏過。緩解：Global Constraints 禁放寬；每個改動附負控制。
- 數字自欺：修後樣本太短或席位工作類型不同。緩解：修前修後用同一支腳本、同窗口天數，並列出 `turns_total`；兩次都要 >= 300 輪才採計。
- (d) 自動修正改變模型原意（例如改寫後的指令與原本意圖不同）。緩解：P2 spike 只允許 bare-ls 這類改寫唯一的規則；其餘維持 (e)。
- 工具清單中途變動使快取整段重寫，反而增加成本。緩解：所有工具類變更只在 session 開頭生效。
- 拒絕訊息變長，每次被擋多吃 token。緩解：訊息只附一條指令，不附說明段。
- 保證失敗的情況：修前基準沒量就開改。P1 是 P2、P3、P4、P5 的前置；該席基準檔未接受不得改碼。修前修後同一支腳本、同一窗口，每席至少 300 輪，修後只在 session 重開後採計。

## 7. Out of scope

- 不改任何 guard 的 deny/allow 判定（除 §2.6 的 bare-ls spike）。哪些 Stop 檢查是誤擋、可以收緊或刪除，是記在既有單 01M7XQVBYG2Q8A4M6RFR8Z4MBR 的另一項決定，由 PM 用 P1 資料判定；本計畫不刪除、不收緊任何檢查。
- 不改 fleet、hangar、capacity 與其他 repo 的程式。
- 不建 hosted CI；不 bump 版號。
- 不分析別席的訊息內容。
- 不新增 skill（做法 (b) 本次沒有項目選用：沒有一項是「偶爾才需要、又說不完一行」）。若 P1 資料顯示某類 help 查詢集中在單一流程，再回頭評估。

## 8. Open questions

1. `bash-footgun-guard` 的來源 hook 在哪個外部 repo？（本 repo 搜不到；請 PM 指派查證。command hook 的「5 共 4」維持原文未解，不重算。）
2. PreToolUse hook 回傳改寫後輸入是否被 harness 支援？由 P2 spike 在沙箱回答，不需 PM 決定，列出只為透明。表上做法仍是 (e)。

## Review log

- R0 author：autopilot planner（本檔）。frozen rubric：`docs/plans/2026-11-21-wasted-turns.rubric.md`。
- plan-review-manifest：待 PM 決定是否送審；`logical_plan_id: 2026-11-21-wasted-turns`。
- generation 1（astra + grok，皆 STOP），8 項發現全部接受，已折入本次修訂。
- generation 2 (astra CONDITIONAL, grok STOP): R8 and R5 blockers folded at the cap (deletions moved out of scope to 01M7XQVB; one row per hook); R3, R7 non-blocking folded.
- PM 11-22 裁 A 後補齊：新增「壓縮次數（每席每 24 小時）」量測項與 `§2.1 壓縮頻繁的原因與改法`（`autopilot`、`fleet`、`hangar`），並依指示將本計畫設為凍結版。
