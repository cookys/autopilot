# 決策卡可靠度計畫（fleet 單 `01M85R7AXE`）

- **Fleet 單號**：`01M85R7AXE`（`Fleet-Task: 01M85R7AXE9FSA18144YSCS57G`）
- **目標上線日**：2026-11-26（先過本計畫三件與回歸測試，再恢復其他卡片功能擴充）
- **依據**：[synthesis.md](/docs/plans/evidence/2026-11-24-pm-mech-judgment/synthesis.md#L25)（第 25、111、125–126 行）

---

## 一、目標與里程碑

先修決策卡可靠度再加功能（[synthesis.md](/docs/plans/evidence/2026-11-24-pm-mech-judgment/synthesis.md#L25)）：消滅重問卡、`verify_failed` 與新增未送達，讓面板「看不見」與訊息「送不到」可各自獨立定位。

| 里程碑 | 目標 | 驗收基準 | 預計完成 |
|---|---|---|---|
| M1 | 重開防呆、自動轉送與對應回歸測試（T1、T2、T5a） | 已答卡重開被擋並回顯原答案；答覆帶請求 id 自動轉送；T5a（重開防呆與 `from_request` 轉送案例）全綠 | 2026-11-25 |
| M2 | 故障分診、分診／狀態機回歸與介面交付（T3、T4、T5b） | 「看不見／送不到」分診上線；T5b（分診、`verify_failed` 狀態機與可見性事故案例）全綠；未送達 119 介面需求交付 hangar／fleet 線 | 2026-11-26 |

---

## 二、範圍（三件事）

1. **已答的卡拒絕重開並回顯原答案**
   - `scripts/open-decision.js` 在 `open`（含 `openDecision`）寫入前，除現行 live-card 去重外，需檢查同題或同指紋之 `closed`／`pending_dispatch`／`awaiting_operator_action` 已答卡片；若命中，拒絕重開（非零退出碼）並於 stderr／JSON 回顯原卡 `id`、`status`、`answer` 與 `closed_at`（[open-decision.js](/scripts/open-decision.js#L43-L45)）。
   - **比對鍵（v1）**：正規化規則為「去空白與標點、轉小寫、取前 120 字」，指紋欄位集合為「標題或問題字串＋`executor`＋`category`」。誤擋時的逃生口為 `--supersede <card id>` 且必須附寫理由。
2. **答覆帶請求 id 自動轉送**
   - `scripts/open-decision.js` 已支援 `--from-request <r-id>` 儲存 `from_request`（[open-decision.js](/scripts/open-decision.js#L146)），`deliverAnswer` 亦會將面板已核實答覆經 `fleet send <executor>` 派送（[open-decision.js](/scripts/open-decision.js#L103-L110)）。補齊當卡片帶有 `from_request` 時，答覆結案／派送路徑自動帶出請求 id 並轉送至原請求方（`scripts/request-decision.js` 對應端點）。
   - **可信身分與狀態轉移**：`from_request` 只是請求 id（r-id）。本 repo 內 `scripts/request-decision.js` 沒有 r-id 對應請求方位址的紀錄（未查到），所以 T2 第一步改為在 `open` 當下，由 `open-decision.js` 以呼叫端 session 的 `fleet whoami` 取得位址，與 r-id 一起存為 `from_request_addr`；位址來自呼叫端自己的認證身分，不由 r-id 反查，因此冒用他人的 r-id 也只會轉回冒用者自己。代理開卡時轉送收件者即代理者（v1 已知限制）。轉送在「答覆核實且主派送成功」之後才執行，轉送成功條件為 `fleet send` 回傳 `message_id`。成功寫 `forward_status=sent`、`forward_message_id`；失敗寫 `forward_status=failed`、`forward_error` 與 `forward_attempts`；卡片自己的 `closed`／`dispatched` 狀態一律不動；重試入口為 `open-decision.js forward <card id>`；沒有 `from_request` 的卡寫 `forward_status=skipped_no_requester`，不算失敗，也不列為負控制案例。
3. **「看不見」和「送不到」分開診斷，並查清未送達 119 的分型**
   - **看不見（面板／作用域層）**：`src/status/card-visibility.js`、`src/status/decision-input.js`、`src/status/scope-key.js` 與 `BL-0337` 跨 repo marker 漂移（[open-decision.js](/scripts/open-decision.js#L48-L51)）。
   - **送不到（派送／courier 層）**：`deliverAnswer`、`scripts/lib/fleet-decision.js`、`hooks/advisory-relay.js`、`redeliver`（[open-decision.js](/scripts/open-decision.js#L22)）。
   - **未送達 119 分型（hangar／fleet 線介面需求，本 repo 不實作對方端）**：要求 hangar／fleet 端對 119 筆「回覆未送達」（[synthesis.md](/docs/plans/evidence/2026-11-24-pm-mech-judgment/synthesis.md#L24)）提供結構化分型回執（欄位：`card_id`、`answer_id`、`failure_class` 列舉如 `courier_unreachable` / `verify_failed` / `target_offline` / `scope_mismatch`、`http_or_exit_code`、`timestamp`），供本端診斷工具消費。

---

## 三、不做什麼

- 不在本單實作 hangar／fleet 端修復（只交付 119 分型介面需求）。
- 不新增常駐守護進程或定時輪詢（沿用 `open-decision.js` 無 daemon 原則，[open-decision.js](/scripts/open-decision.js#L77)）。
- 不修改 L6 雙席或卡片語意／分類規則（[synthesis.md](/docs/plans/evidence/2026-11-24-pm-mech-judgment/synthesis.md#L132)）。
- 不放寬 `--not-authorized`、DOA 邊界或 `--target` 生產環境拒絕閘（[open-decision.js](/scripts/open-decision.js#L53-L60)）。

---

## 四、子工作切分（每件 ≤ S）

| ID | 子工作 | 規模 | 里程碑 | 合併順序／相依 | 主要檔案（各自修改函式區） |
|---|---|---|---|---|---|
| T1 | 已答卡拒絕重開＋回顯原答案 | S | M1 | 序列 1（T1→T2→T3 依序合併，合併前 rebase） | `scripts/open-decision.js`（開卡去重區） |
| T2 | 答覆帶 `from_request` 自動轉送 | S | M1 | 序列 2（依序接在 T1 後合併，合併前 rebase） | `scripts/open-decision.js`（`deliverAnswer` 轉送區）、`scripts/request-decision.js` |
| T3 | 「看不見」vs「送不到」分診腳本／診斷輸出 | S | M2 | 序列 3（依序接在 T2 後合併，合併前 rebase） | `scripts/open-decision.js`（診斷子命令）、`src/status/card-visibility.js` |
| T4 | 未送達 119 分型介面規格文件（交 hangar／fleet） | XS | M2 | 獨立（不改 `open-decision.js`） | `docs/` 介面規格（不改對方 repo） |
| T5a | 重開防呆與 `from_request` 轉送回歸測試 | S | M1 | 依賴 T1、T2 | `tests/`（對應測試檔，路徑依實作選定） |
| T5b | 分診、`verify_failed` 狀態機與可見性事故回歸測試 | S | M2 | 依賴 T3 | `tests/`（對應測試檔，路徑依實作選定） |

---

## 五、驗收與負控制（刻意違規必須被擋）

| ID | 正向驗收 | 負控制（刻意違規必須被擋） |
|---|---|---|
| T1 | 對已 `closed` 卡以相同問題重開，指令失敗且回顯原 `id`、`answer`、`closed_at` | 刻意傳入既有的 `--not-duplicate-of`（`open-decision.js` L11、L156；只用來放行「未決的相似卡」並要附 `--not-duplicate-reason`）試圖繞過已答卡檢查 → 仍必須被擋；已答卡只能走 `--supersede <card id>` 並寫理由 |
| T2 | 帶 `from_request` 的卡經面板核實答覆並主派送成功後，自動轉送 `from_request_addr`，成功時記 `forward_status=sent` 與 `forward_message_id`；無 `from_request` 的卡記 `skipped_no_requester` | 刻意把 `from_request_addr` 設成不存在的位址 → `forward_status=failed`、`forward_error` 有值、`forward_attempts` 遞增，卡片仍是 `closed`／`dispatched`，不得靜默吞掉；`forward <card id>` 重試入口在位址修正後轉為 `sent` |
| T3 | 模擬「面板無顯示但資料存在」與「`fleet send` 失敗」，分診明確輸出不同故障類別 | 刻意讓 `card-visibility` 與 `deliverAnswer` 同時異常 → 必須各自報錯，不可合併為單一模糊錯誤 |
| T4 | hangar／fleet 介面需求含 119 分型欄位、列舉與對照範例；驗證器落在 T3：診斷工具讀入回執時檢查欄位，缺欄回報 `malformed` 類別 | 缺 `failure_class` 或 `card_id` 的回執 → T3 診斷工具必須回報 `malformed`，不可當成有效分型 |
| T5a | 4 張重問卡與 `from_request` 轉送案例在測試套件全綠 | 刻意拿掉 T1 防呆或偽造 `from_request`／略過 `message_id` 檢查 → 測試必須轉紅（失敗） |
| T5b | 5 張 `verify_failed`、分診輸出與可見性事故案例在測試套件全綠 | 刻意模擬 `verify` exit 7／非 `{ok:true}` 回應或「面板兩度顯示沒有待決卡」情境 → 狀態機必須轉紅且不得誤標 `closed` |

---

## 六、現成回歸案例轉測試設計

- **來源**：[synthesis.md](/docs/plans/evidence/2026-11-24-pm-mech-judgment/synthesis.md#L25) 記載「4 張重問卡；5 張卡一次 `verify_failed`；面板兩度顯示沒有待決卡」。
- **原始卡號與日誌**：取得路徑為 PM 席的 `askpm.jsonl` 與 repo 內 `open-decision` 的卡片狀態檔（本 worktree 內**未查到**實際路徑）。負責人：本席（`autopilot--claude`）。停損：T5 開工前 1 個工作日內取不到真實 id，就把這兩組案例降為合成 fixture，並在計畫與 commit 訊息明講「未以真實案例驗證」。
- **轉測試方式**：
  1. **4 張重問卡 → 重開防呆回歸測試（T5a）**：以 4 組「已 `closed` 含 `answer` 的卡片 fixture」作為前置狀態，呼叫 `open-decision.js open` 重送同題，斷言 exit code 非 0、不寫入新卡、輸出含原 `answer`。
  2. **5 張 `verify_failed` → 核實與重送狀態機測試（T5b）**：以 stub `fleet` CLI 模擬 `verify` 失敗（非 0 exit）與 `fleet send` 非 `{ok:true,"message_id":...}`，斷言卡片維持 `pending_dispatch`、寫入 `dispatch_error` 與遞增 `dispatch_attempts`、絕不誤標 `closed`（[open-decision.js](/scripts/open-decision.js#L107)）。
  3. **可見性事故（「面板兩度顯示沒有待決卡」）→ T5b 案例**：列為 T5b 的一個真實案例或其降級合成案例，模擬資料存在但面板顯示為空，驗證分診工具能獨立報出面板／作用域層異常。

---

## 七、風險

| 風險 | 影響 | 緩解方式 |
|---|---|---|
| 已答卡去重過嚴誤擋合理後續追問 | 操作員無法開新卡 | v1 僅比對正規化後「標題或問題字串＋`executor`＋`category`」，誤擋時可用 `--supersede <card id>` 並寫理由放行 |
| hangar／fleet 119 分型尚未上線 | 歷史 119 筆無法自動回溯 | T4 先交付介面契約；本端先對新增未送達強制寫入 `dispatch_error` |
| 原始 4＋5 案例 fixture 缺具體 ID | 測試可能只測到合成資料 | T5 開工前 1 個工作日內由 `autopilot--claude` 自 `askpm.jsonl` 與卡片狀態檔抽取；逾期未取得即降為合成 fixture 並明講「未以真實案例驗證」 |
