# Plan - 白跑輪數改善：量測、逐項選做法、分段上線

> Status: draft（待 PM 判定）。Owner: autopilot lane。Branch: feat/wasted-turns-plan。Fleet-Task: 01M7XSVAGG1J7AZKV3861D2100。Frame: 只寫計畫，本次不改任何 hook 或腳本。Version 維持 3.0.0（版號暫停）。

## 0. Context / thesis

每多一輪 tool call，整段 context 就重讀一次。PM 席約 45 萬 token：快取命中時一輪約 4.6 萬 token，沒命中約 90 萬；一個工具的說明每輪只要幾十 token。所以「多一輪白跑」比「多一行工具說明」貴上千倍。便宜的解法是把「報錯後才知道正確指令」改成「第一次就拿到正確指令」。

量測（出處：PM 單 01M7XSVA，原文引用，本計畫不重測）：PM 席 511 次 tool call 中約 98 輪白跑，佔 19%。
- 查 `--help`：15 次。
- 工具報錯：41 次。依次數排：bash-footgun-guard（zsh glob）12、time_in_content 7、command hook 5（原文寫「5 共 4」，兩個數字不一致，待 P0 腳本重算）、bash-launch-guard 3、dispatch-model-guard 2、其他 13。
- Stop hook 擋回：42 次。

15 + 41 + 42 = 98，與原文總數相符。

旁證（本席撰寫此計畫時，4 次 Bash 呼叫就被擋 4 次：bare-ls、zsh glob、`=====` 被 zsh 展開、secret-print；各一輪白跑）。這只是旁證，不當量測。

## 1. Problem

要降低的是「白跑輪」：沒有推進任務、只是為了得知正確用法或被攔下而多花的一輪。目標不是少放 guard，而是每個 guard 的拒絕訊息在第一次就讓模型照打就對；沒擋到真問題的 guard 刪掉。

## 2. OKR / KRs

- KR1：每席每百輪的白跑輪數，修前、修後各用同一支量測腳本量一次；白跑佔比從 19% 降到 5% 以下。
- KR2：全機隊每席跑過一次量測，前 N 名排行入庫，之後每週自動跑一次。
- KR3：納入範圍表（§3）每一項都有一個選定做法加一行理由，或標「外部 lane 負責」。

## 2.5 Global Constraints (copied verbatim into every dispatch)

- 不得在 session 中途改變工具清單的前段（會讓快取整段重寫）。新增或改名的工具、改過說明的工具，下次 session 開頭才生效；本計畫所有「工具」類變更都以此為上線條件。
- 每個新增或修改的檢查（gate、hook、scan）都附負控制：故意做錯的案例先紅、改完才綠（scripts/CLAUDE.md 的 negative control 規則）。
- 量測只讀自己席位的逐字稿（d-7436a800）；別席只讀用量數字欄位（model、token 數、時間戳），絕不讀訊息內容（d-d031e0de）。不碰真實 ~/.claude 的設定、hooks、憑證。
- 不加 trust machinery（ADR-0001）；腳本用獨立重算驗證，不用簽章或帳本。
- 不得為了降低數字而放寬真正在擋危險操作的 guard（rm、秘密、跨 lane 派工）；這類只改拒絕訊息，不改判定。
- 不 bump 版號，不寫 CHANGELOG 以外的發版動作；committed 檔案不放私網 IP 字面值。

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`。受影響的是本 repo 的 hook 拒絕訊息文字與新增的量測腳本；不改任何 hook 的 deny/allow 判定（P2 的 (d) 自動修正除外，見 §4 P2 的 spike 條件）。若 spike 證明 harness 不支援改寫輸入，就退回 (e)，仍是 internal-only。
- **Dependency decision**: `none`。只用 Node 內建模組，沿用 `hooks/transcript-reader-lib.js` 與 `hooks/cost-tracker-lib.js` 已有的逐字稿解析。

## 3. 納入範圍與每項選的做法

做法代號：(a) MCP 工具、說明寫必填欄位與拒絕碼；(b) skill，只放一行說明、用時才載入；(c) 腳本；(d) guard 自動修正；(e) 拒絕訊息附可直接照打的正確指令；(f) 刪掉沒在擋真問題的 guard。行號由 worktree 內 grep 取得（2026-11-21）。

### 3.1 本 repo 內（autopilot 負責）

實際清單來自 `git ls-files hooks scripts | grep -i guard` 與 `hooks/hooks.json` 的 PreToolUse / Stop 段。

| 項目 | 位置 | 現況 | 做法 | 一行理由 |
|---|---|---|---|---|
| Bash 啟動規則（bare-ls、pkill 自比對、rm 變數目標、rm 包在 -c、偵離無喚醒） | `scripts/lib/bash-launch-rules.js`，由 `hooks/depth0-delegate-gate.js:249` 回 deny | 拒絕訊息已列改寫法，但各規則詳略不一 | (e)，其中 bare-ls 在 P2 spike 通過後升 (d) | bare-ls 的正確指令唯一（`command ls`），自動改寫比讓模型重打省一輪 |
| zsh 展開規則（`=` 開頭字、未匹配 glob） | `scripts/lib/bash-launch-rules.js:11-12`（warn only） | 本 repo 只警告；PM 席實測擋人的 `bash-footgun-guard` 在本 repo 搜不到 | 本 repo：維持；擋人那條歸外部（見 3.2） | 同一種錯有兩處檢查會互相矛盾；先查出 footgun-guard 來源再決定 (d) 或 (f) |
| foreman-guard | `hooks/foreman-guard.js:531` | context 上限、bash 數量上限、Monitor 規則 | (e) | 拒絕理由已含下一步（寫 handoff）；補上可貼的指令即可，不改判定 |
| dispatch-model-guard | `hooks/dispatch-model-guard.js:200`（ask）、`:212`（deny）、`:342`（brief 缺 Size/Used-by） | PM 席實測 2 次 | (e) | deny 訊息直接附完整三行標頭（Engine / Role / Lane）與 `model:` 範例，模型複製即可 |
| fleet-send-work-order-guard | `hooks/fleet-send-work-order-guard.js:105` | 擋把工單當訊息送 | (e) | 訊息已告知改用 task_comment；補上欄位範例 |
| pii-read-guard | `hooks/pii-read-guard.js:73` | 擋直接讀含個資的目標 | (e) | 附 `safe-inspect` 的可貼指令 |
| scheduled-wakeup-guard | `hooks/scheduled-wakeup-guard.js` | 擋以時間點等待 | (e) | 附 `fleet watch` 的可貼寫法，對應 CLAUDE.md「等待要寫可檢查事件」 |
| run-approval-gate | `hooks/run-approval-gate.js:168`（ask） | 派工前詢問 | 保留 | 是權限提示不是白跑；量測腳本只記次數 |
| 路徑與設定保護（exec-boundary、branch-protection、config-protection） | `hooks/exec-boundary.js:319`、`hooks/branch-protection.js:64`、`hooks/config-protection.js:43`（exit 2） | 多為 opt-in | 保留 | 擋破壞性操作，屬 Global Constraints 禁放寬；exit 2 的訊息只補指令 |
| Stop：per-turn-gate | `hooks/per-turn-gate.js:576`（decision block） | PM 席 Stop 擋回的主要來源之一，待 P0 分攤 | 與 01M7XQVB 合併處理，主做法 (e)，誤擋類 (f) | 先用 P0 算出各 Stop hook 的擋回次數與誤擋比，誤擋的收緊或刪，真擋的訊息附照打指令 |
| Stop：owner-question-guard | `hooks/owner-question-guard.js:87-90`（block） | 有 `OWNER-GUARD-FALSE-POSITIVE` 自報誤擋通道（`:17`） | 與 01M7XQVB 合併處理 (e)+(f) | 自報誤擋紀錄就是 (f) 的證據來源，直接餵 P0 |
| Stop：askpm-remind、fleet-stop、awaiting-owner | `hooks/askpm-remind.js`；`hooks/fleet-stop.js`（只是呼叫 `fleet hook stop` 的包裝，判定在 fleet） | askpm-remind 為 opt-in | 與 01M7XQVB 合併；fleet-stop 的判定歸外部 | 包裝層沒有判定可改 |
| dispatch brief 標頭規則（Engine/Role/Lane、Size、Used-by） | `hooks/dispatch-model-guard.js:342`、`hooks/lib/brief-head.js` | 缺標頭 deny | (c)：新增 `scripts/brief-head.sh --role <r> --lane <l> --size <s>` 印出合格標頭；(e) 訊息指向它 | 標頭是固定樣板，機械步驟要腳本化（全域「Mechanize repeats」） |
| open-decision.js、decision-ledger.js、request-decision.js | `scripts/open-decision.js` 等 | 參數錯誤時靠 `--help` | (e)：參數錯誤的 usage 錯誤直接印一條完整可貼的範例指令，退出碼固定 | 查 --help 15 次的主因是不知道必填欄位；錯誤訊息即說明，不用多一輪 |
| run-ledger.sh（本 repo） | `scripts/run-ledger.sh` | 同上 | (e) | 同上 |
| scripts/ 下其他 guard 類（leak-guard、root-scan-guard、disk-guard、seat-id-guard、vision-guard、replay-stop-guard、agy-shell-guard.zsh；hooks/tests 下的 *-guard 檔是測試） | `scripts/leak-guard.js`、`scripts/lib/root-scan-guard.js`、`scripts/lib/disk-guard.js` 等 | 非 hook 路徑，多為 dispatch 或 CI 時才跑 | 保留，不在白跑範圍 | 不在每輪 tool call 路徑上；P0 如發現它們出現在逐字稿錯誤中再補 |

### 3.2 不在本 repo（標「外部 lane 負責」，autopilot 只提供介面）

| 項目 | 負責 | 預計做法（建議，由該 lane 決定） | 理由 |
|---|---|---|---|
| bash-footgun-guard（zsh glob，12 次，最大單項） | 外部 lane，來源待查（本 repo `git grep` 無此名稱） | (d)：自動給 glob 加引號；做不到則 (e) | 規則 3 的拒絕訊息已含正確寫法，等於已經知道答案卻要模型重打一輪 |
| time_in_content（7 次） | fleet lane（`due_reason` 規則，本 repo 無此檢查） | (e)：訊息附合格的 `依據:` 單行範例 | 規則已寫在使用者記憶 fleet-evidence-due-reason-basis，應由拒絕訊息攜帶 |
| command hook（原文 5 或 4 次） | 待 P0 辨識 | 待 P0 | 來源不明，不亂指派 |
| fleet CLI 與 MCP | fleet lane | (a)：MCP 工具說明寫必填欄位與拒絕碼；requester 四個（task_status、task_accept、task_progress、task_comment）已在 fleet 單 01M7XSNQ | 工具說明每輪只幾十 token，勝過每次查 help |
| inbox-cli | fleet lane | (a) 或 (e) | 同上 |
| 各 repo 的 ledger.sh（本 repo 以外） | 各 repo 的 lane | (e) | 各自的用法錯誤印可貼範例 |
| hangar、capacity 的腳本 | hangar lane、capacity 負責人 | (c)+(e) | 重複的多步 shell 變成一支腳本，帶 usage 範例（hangar 只能從 cookys-openclaw 讀，本席不碰） |
| fleet hook stop 的判定 | fleet lane | 與 01M7XQVB 對接 | 判定在 fleet 二進位內 |

## 4. 分段與上線

時間為台北時間。fleet 單號欄先填「待開」，開單後回填。依賴欄寫前置段。

| 段 | 內容 | 大小 | 上線日 | fleet 單號 | 依賴 | 驗收 |
|---|---|---|---|---|---|---|
| P0 | 量測腳本 `scripts/wasted-turns-report.js` 與測試；先跑本席，再發給各席各跑一次；排前 N 名 | M | 2026-11-22 | 待開 | 無 | 見 §5 |
| P1 | 修前基準：全機隊每席跑一次，結果 JSON 進 `docs/plans/evidence/2026-11-21-wasted-turns/`；確認 PM 席重算結果對得上 98/511 | S | 2026-11-23 | 待開 | P0 | KR1 的「修前」欄有數 |
| P2 | 拒絕訊息附可貼指令（做法 (e)）：bash-launch-rules、dispatch-model-guard、fleet-send-work-order-guard、pii-read-guard、scheduled-wakeup-guard、foreman-guard；spike：在沙箱確認 PreToolUse hook 能否回傳改寫後的輸入以支援 (d)，不能就維持 (e) | M | 2026-11-25 | 待開 | P0 | 每個被改的 hook 一個負控制測試；訊息中的指令被測試直接執行並通過同一個 guard |
| P3 | Stop hook 誤擋：以 P1 的各 Stop hook 擋回次數與 `OWNER-GUARD-FALSE-POSITIVE` 紀錄決定收緊或刪（做法 (e)/(f)） | M | 2026-11-26 | 待開（與 01M7XQVB 合併） | P1、01M7XQVB | 誤擋樣本進測試；PM 判定刪除項 |
| P4 | 查 help 的來源：`scripts/open-decision.js`、`decision-ledger.js`、`request-decision.js`、`run-ledger.sh` 的用法錯誤印完整範例；新增 `scripts/brief-head.sh`（做法 (c)） | S | 2026-11-27 | 待開 | P0 | 對應腳本的負控制：缺必填欄位時輸出含可貼指令且退出碼固定 |
| P5 | 重複多步 shell 的清單（P0 輸出第五類）→ 逐項腳本化或進既有腳本；超過兩次手跑的才做 | S | 2026-11-30 | 待開 | P1 | 每項附腳本與測試；清單中未做的標明理由 |
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
  4. `error_retry`：tool_result 為錯誤，且之後三輪內出現同一工具、同一指令首詞的再試。
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
  4. Stop hook：hook 側歸 autopilot，判定側歸 fleet，雙方都記在 01M7XQVB 單上，不另開第二張。

## 5. Test / validation

- script-gated：§4.1 全部測試；每個 P2/P3/P4 被改的 hook 或腳本的負控制測試；`bash scripts/sync-all.sh --check`；`node scripts/affected-suites.js` 選出的套件。
- 人為判定：P3 的「誤擋」與「刪除」由 PM 判；§3.2 外部項目的做法由各 lane 判。
- 真用驗收（Done = used）：P7 在 live 以實際席位跑 `--self`，貼出該席修前修後同一欄位的對照一行；gate 類改動各做一次反向探測（故意違規，確認仍被擋，且訊息的指令貼上後通過）。

## 6. Risks + inversion

- 做法反了：把 guard 放寬而不是改訊息，白跑數字下降但真問題漏過。緩解：Global Constraints 禁放寬；每個改動附負控制。
- 數字自欺：修後樣本太短或席位工作類型不同。緩解：修前修後用同一支腳本、同窗口天數，並列出 `turns_total`；兩次都要 >= 300 輪才採計。
- (d) 自動修正改變模型原意（例如改寫後的指令與原本意圖不同）。緩解：P2 spike 只允許 bare-ls 這類改寫唯一的規則；其餘維持 (e)。
- 工具清單中途變動使快取整段重寫，反而增加成本。緩解：所有工具類變更只在 session 開頭生效。
- 拒絕訊息變長，每次被擋多吃 token。緩解：訊息只附一條指令，不附說明段。
- 保證失敗的情況：修前基準沒量就開改。P1 為所有改動段的前置。

## 7. Out of scope

- 不改任何 guard 的 deny/allow 判定（除 §2.6 所述 spike）。
- 不改 fleet、hangar、capacity 與其他 repo 的程式。
- 不建 hosted CI；不 bump 版號。
- 不分析別席的訊息內容。
- 不新增 skill（做法 (b) 本次沒有項目選用：沒有一項是「偶爾才需要、又說不完一行」）。若 P1 資料顯示某類 help 查詢集中在單一流程，再回頭評估。

## 8. Open questions

1. `bash-footgun-guard` 與 `command hook` 的來源 hook 在哪個外部 repo 或 plugin？（本 repo 搜不到；請 PM 指派查證，影響單項最大的 12 次。）
2. PM 單「command hook 5 共 4」是 5 還是 4？P0 重算後以腳本為準，需 PM 確認是否接受。
3. PreToolUse hook 回傳改寫後輸入是否被 harness 支援？由 P2 spike 在沙箱回答，不需 PM 決定，列出只為透明。

## Review log

- R0 author：autopilot planner（本檔）。frozen rubric：`docs/plans/2026-11-21-wasted-turns.rubric.md`。
- plan-review-manifest：待 PM 決定是否送審；`logical_plan_id: 2026-11-21-wasted-turns`。
