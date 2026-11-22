# Plan - 小模型工具考試：基準量測、題庫與自動重考門檻

> Status: draft. Owner: autopilot lane. Fleet-Task: 01M7XHMY5F3301Z20ZX5G1KSQV. Frame: 只寫計畫，本次不改任何腳本或工具。

## 0. Context / thesis

營運者提出的需求原文：「派小模型使用工具，要讓她一次就對之類的?」

小模型（如 `haiku` 與本地閘道 `auto`）在呼叫工具時，若工具說明不清、參數命名不一致、或錯誤訊息未附下一步，就會反覆試錯或查 `--help`。本計畫建立一套「小模型工具考試」機制：在沙箱環境中，讓小模型僅憑工具說明、`--help` 與工具卡（不讀原始碼）回答實務情境題，量測首次答對率與 token 消耗，作為工具說明與錯誤訊息改寫的驗收依據。

與 `docs/plans/2026-11-21-wasted-turns.md`（白跑輪數改善計畫）之分工：
- **白跑輪數計畫**負責「真實逐字稿量測」（從 session transcript 統計白跑輪與 context 成本）。
- **本計畫（小模型考試）**負責「受控沙箱考試」（用固定情境題考小模型，驗證工具說明與錯誤訊息是否足夠清楚）。兩者互補，不重複量測逐字稿。

## 1. Problem

要解決的是「小模型第一次呼叫工具就出錯」的問題。目標是讓小模型僅靠工具對外暴露的介面（description、`--help`、tool card），就能在第一次呼叫時給出正確參數與指令，減少試錯輪數與 token 消耗。

## 2. OKR / KRs

- **KR1**：納入首波考試的每個工具，均完成 3–5 題實務情境題庫，並於修前跑出基準成績（P1）。
- **KR2（目標門檻，屬假設待驗證）**：修後重考時，每個工具的**首次答對率 >= 90%**，且**每題平均 token 數至少減半**（相較 P1 基準）。
  - *假設說明*：90% 首次答對率與 token 減半為工程假設目標；實際可行性與各工具基準落差，待 P1 基準量測完成後再行檢視與校準。
- **KR3**：建立可重複執行的考試腳本 `scripts/tool-exam.js`（本計畫僅規劃，不實作），並接入 `scripts/affected-suites.js`，在工具說明或參數變更時自動重考，分數下降則阻擋合併。

## 2.5 Global Constraints (copied verbatim into every dispatch)

- **禁止讀原始碼**：受試模型（`haiku`、`auto`）僅可讀取工具的 description、`--help` 輸出與 tool card，嚴禁讀取任何工具原始碼。
- **沙箱隔離**：所有考試必須在沙箱環境（fake hub 或 `--dry-run`）執行，嚴禁連接或寫入真實 hub、真實 `~/.claude` 或真實任務狀態。
- **用量欄位口徑**：token 數一律只從 API / 執行結果的 usage 欄位讀取，絕不從訊息內容估算或讀取訊息內文。
- **先基準後改寫**：未完成該工具的 P1 修前基準考試前，不得以「通過考試」為由修改任何工具說明或參數。
- **不重複逐字稿量測**：本計畫不讀、不分析真實 session transcript（該項歸 `docs/plans/2026-11-21-wasted-turns.md`）。

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`。本計畫規劃新增題庫、沙箱測試腳本 `scripts/tool-exam.js` 及 `affected-suites.js` 掛鉤，不改變現有工具對外契約。
- **Dependency decision**: `none`（規劃階段無新增依賴；未來實作 `scripts/tool-exam.js` 沿用 Node 內建模組與既有派工／沙箱介面）。

## 3. File-structure map（規劃產物，本次不建立）

| 檔案 / 路徑 | 責任 | 狀態 |
|---|---|---|
| `scripts/tool-exam.js` | 可重複執行的考試主腳本：載入題庫、於沙箱派發 `haiku` / `auto`、讀取 usage 欄位計分、輸出成績與錯誤分類 | 規劃中（P0） |
| `scripts/fixtures/tool-exam/` | 各工具的 3–5 題實務情境題庫與預期動作／參數驗證規則 | 規劃中（P0） |
| `docs/plans/evidence/tool-exam/` | P1 修前基準與 P3 修後重考的成績 JSON 存證 | 規劃中（P1/P3） |
| `scripts/affected-suites.js` | 偵測工具說明或參數變更時，觸發 `scripts/tool-exam.js` 並於分數下降時阻擋合併 | 規劃中（P4） |

### 3.1 納入首波考試的工具範圍

每個工具設計 **3–5 題**實務情境題：
- **fleet MCP 工具與 `fleet` CLI**（例：「把這張單的期限延到明天並附理由」、「回覆這則訊息並綁單」）
- **`inbox-cli`**
- **`scripts/open-decision.js`**（例：「開一張兩個選項的卡」）
- **`ledger.sh`**
- **dispatch 家族**：`dispatch-hetero.sh`、`dispatch-author.sh`、`dispatch-panel.js`、`dispatch-consult.sh`

*後續波次（不在首波）*：hangar 相關腳本列為第二波，待首波流程穩定後再納入。

### 3.2 受試者與考場規格

- **受試模型**：`haiku`，以及本地閘道 `auto`。
- **考場（沙箱）**：使用 fake hub 或 `--dry-run` 模式，絕不碰真實 hub。
- **外部依賴（Fake Hub）**：
  - 取得方式：先向 fleet lane 詢問是否已有現成 fake hub；若無，則由本計畫單開前置任務建立最小 stub。
  - **此為顯性依賴（非假設）**，須有獨立 owner 與 fleet 單號，未就緒前不得進入 P1。

### 3.3 計分與錯誤分類

- **量化指標**：
  1. `first_try_correct_rate`：首次呼叫即符合預期動作與參數的比例。
  2. `mean_attempts`：每題平均嘗試次數。
  3. `tokens_per_question`：每題平均消耗 token 數（僅取 usage 欄位）。
- **錯誤分類**：
  1. `unclear_description`：工具或參數說明不清，導致模型選錯工具或填錯欄位。
  2. `error_without_next_step`：工具回傳錯誤訊息，但未提供可照打的下一步或正確範例。
  3. `inconsistent_param_names`：同類工具間參數命名不一致，導致模型猜錯參數名稱。

## 4. Phases

| 段 | 內容 | 大小 | 上線日 | fleet 單號 | 依賴 | 驗收 |
|---|---|---|---|---|---|---|
| P-dep | 向 fleet lane 確認 fake hub 是否存在；若無則建立最小 stub | S | 待排 | 待開 | 無 | 沙箱可攔截所有工具呼叫並回傳模擬結果，不碰真實 hub |
| P0 | 建立 `scripts/tool-exam.js` 與首波工具題庫（每工具 3–5 題）及計分邏輯 | M | 待排 | 待開 | P-dep | 腳本可在沙箱跑完一輪題庫，產出含 usage token 與三類錯誤分類的 JSON |
| P1 | 修前基準考試：`haiku` 與 `auto` 各跑一輪首波題庫，成績存入 `docs/plans/evidence/tool-exam/` | S | 待排 | 待開 | P0 | 每個首波工具均有修前基準 JSON；確認未讀原始碼 |
| P2 | 依 P1 錯誤分類修訂工具說明、`--help`、tool card 與錯誤訊息（對應白跑輪數計畫或各工具負責 lane） | M | 待排 | 待開 | P1 | 所有 P1 標記的 `unclear_description`、`error_without_next_step`、`inconsistent_param_names` 均有對應修訂 |
| P3 | 修後重考：以同一題庫重跑 `scripts/tool-exam.js`，與 P1 基準對照 | S | 待排 | 待開 | P2 | 每個工具首次答對率 >= 90% 且每題 token 數 <= P1 的 50%（或依 P1 校準後之門檻） |
| P4 | 將 `scripts/tool-exam.js` 接入 `scripts/affected-suites.js`（本 repo 無 hosted CI，掛於本地 affected-suites 檢查） | S | 待排 | 待開 | P3 | 工具說明或參數變更時自動觸發重考；分數下降時回傳非零退出碼阻擋合併 |

## 5. Test / validation

每個檢查皆須定義「防止的失敗（failure-to-prevent）」：

- **沙箱隔離檢查**：
  - *Failure-to-prevent*：防止考試腳本誤連真實 hub 或寫入真實任務狀態，導致汙染正式環境。
- **禁讀原始碼檢查**：
  - *Failure-to-prevent*：防止受試模型透過讀取實作原始碼「作弊」通過考試，掩蓋工具說明或 `--help` 不足的真實問題。
- **Usage 欄位計分檢查**：
  - *Failure-to-prevent*：防止腳本從訊息內文估算 token 數，造成計分失真或洩漏／依賴對話內容。
- **回歸阻擋檢查（`affected-suites.js` 掛鉤）**：
  - *Failure-to-prevent*：防止日後修改工具說明或參數命名時，未經重考即合併，導致小模型首次答對率無聲下降。

## 6. Risks + inversion

- **考題過於簡單或脫離實務**：若題庫只測基本 `--help`，無法反映真實派工情境。緩解：題庫必須來自真實操作情境（如延後期限並附理由、回覆訊息並綁單、開立雙選項決策卡）。
- **假設門檻不切實際**：90% 答對率或 token 減半在部分複雜工具上可能過嚴。緩解：於 §2 明示為假設，待 P1 基準產出後檢視數據再決定是否調整。
- **Fake hub 與真實 hub 行為落差**：stub 過度簡化可能漏掉真實錯誤碼。緩解：P-dep 優先向 fleet 取得現成 fake hub，若自建 stub 須對齊真實工具的參數驗證與錯誤格式。

## 7. Out of scope

- 本計畫不實作 `scripts/tool-exam.js` 程式碼（僅規劃）。
- 不納入 hangar 腳本於首波考試（列為後續波次）。
- 不建立 hosted CI（本 repo 無 hosted CI，重考掛鉤於 `scripts/affected-suites.js`）。
- 不分析真實 session transcript（歸 `docs/plans/2026-11-21-wasted-turns.md`）。

## 8. Open questions

1. fleet lane 是否已有現成的 fake hub 可供沙箱考試使用？（決定 P-dep 採用現成環境或自建 stub。）
2. `haiku` 與 `auto` 在各工具的 P1 基準差距若過大，是否分開設定通過門檻，或統一以較嚴者為準？

## Review log

- 草稿，待 plan loop。
