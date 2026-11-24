# Plan — PM 席 200k 自動 handoff、/clear 與 `fleet pm resume` 拉回狀態（做法二）

> Status: Draft (R0) | Owner: autopilot--claude | Fleet-Task: 01M85T56P7V70X8HJ7WN0HMYE0（PM 裁定 01M85PYJ3S 第 2 點）| Frame: 做法二（無人值守 /clear + resume）| 上線日：Phase 1–2 目標 2026-11-27 台北，Phase 3 要等 PM 席下次自然到 200k，日期以實測為準

---

## 0. Context / thesis

依 [synthesis.md](../../docs/plans/evidence/2026-11-24-pm-mech-judgment/synthesis.md) 第四節第 4 項與第五節：PM 席在 200k 門檻若只靠「提醒操作員手動 `/clear` 或重啟」（做法一），會卡在人工按鍵與交接摩擦；而直接壓縮後首回合目前約 136,747 tokens（[synthesis.md](../../docs/plans/evidence/2026-11-24-pm-mech-judgment/synthesis.md) §一），且 `fleet pm resume` 已有 26 次真實使用，但強制壓縮驗收與交接停寫舊路徑尚未收尾。

本計畫定義**做法二**：當 PM 席 context 達門檻（約 200k）時，不靠操作員按鍵，由系統自動寫出含操作員最近的話與未完成事項的 handoff、觸發 `/clear`、再用 `fleet pm resume` 拉回狀態並重掛 cron。只有在下次 PM 席實測達 200k 跑一次真 `/clear` 且清完第一回合 ≤ 95k 時，才切換為預設；未通過則維持做法一。

### 現有零件盤點（已存在）

| 零件 | 現況與位置 | 與做法二的關係 |
|---|---|---|
| Context 量測與門檻觸發 | [`hooks/context-budget.js`](../../hooks/context-budget.js)（PostToolUse，讀 transcript `message.usage` 與 live 檔，支援 T1/T2/T3 與 `landFire` 狀態檔） | 已有真實 token 量測與 `landFire` 記錄；但註解明寫 `/clear is a USER action`，目前只做 stderr 提醒 |
| Stop 交接閘 | [`hooks/context-land-gate.js`](../../hooks/context-land-gate.js)（Stop hook，比對 `landFire` 與 handoff mtime） | 對非 PM 席自動 `fleet dispatch` 給 hangar；對 `pm` 席目前只組 `read <path> 接續` 要模型轉交操作員（L133–L145） |
| Handoff 格式與寫入流程 | [`skills/handoff/SKILL.md`](../../skills/handoff/SKILL.md)（Write Mode / Resume Mode） | 定義了 `目標 / 現況 / 已決事項 / 下一步 / 驗證方式 / Read-order / 陷阱` 與 `$XDG_RUNTIME_DIR/autopilot/handoff/<sid>.md` 路徑；目前無「操作員最近的話」欄位 |
| 旁側大腦與狀態拉回 | `fleet pm resume`（見 [synthesis.md](../../docs/plans/evidence/2026-11-24-pm-mech-judgment/synthesis.md) §一，已有 26 次真實使用） | 可拉回旁側大腦狀態，但 CLI 旗標與 `/clear` 後自動呼叫接線方式「待查」 |

### 缺口清單（待補）

1. **無人觸發 `/clear` 機制**：從 `context-budget` / `context-land-gate` 偵測達標後，如何不靠操作員按鍵對 PM 席送出 `/clear`（例如透過 tmux / fleet host / harness 控制面，「待查」實際支援介面）。
2. **Handoff 結構擴充（操作員最近的話＋未完成事項）**：腳本化寫入 handoff 時，需自動擷取操作員最近一次原話與當前未完成事項，不依賴模型在 Stop 前手寫。
3. **`/clear` 後自動 `fleet pm resume` 與 cron 重掛**：`/clear` 清空 session 後，需有自動化接線執行 `fleet pm resume` 並重新掛回 PM 席所需的 cron 排程。
4. **首回合 ≤ 95k 實測與切換閘**：定義做法一（預設）與做法二（實驗開關）的切換旗標，並在下次 PM 達 200k 時完成真 `/clear` 實測驗收。

---

## 1. Problem

PM 席在長對話接近 200k tokens 時，依賴操作員手動 `/clear` 與貼上 `read <path> 接續` 會造成中斷延遲與漏接；做法二要讓 PM 席在無人值守下自動完成「寫 handoff → `/clear` → `fleet pm resume` → 重掛 cron」，同時確保清完第一回合 context ≤ 95k，否則不切為預設。

---

## 2. OKR / KRs（上線條件，逐條可驗收）

- **KR1（觸發不靠操作員按）**：PM 席 context 達設定門檻（約 200k）時，系統在無任何操作員鍵盤輸入下，於 1 個工作週期內自動完成 handoff 寫入並觸發 `/clear`。
- **KR2（handoff 帶操作員最近的話與未完成事項）**：自動產出的 handoff 檔必含「操作員最近的話」（原話或可追溯引用）與「未完成事項」清單，且 `context-land-gate` 驗收通過（mtime ≥ `landFire.at`）。
- **KR3（cron 重掛）**：`/clear` 完成並執行 `fleet pm resume` 後，PM 席原掛載的 cron 任務已自動恢復運作，無須人工重建。
- **KR4（200k 真 `/clear` 實測 ≤ 95k 才切預設）**：在下次 PM 席實戰達 200k 時執行一次真 `/clear`，清完後第一回合 context 用量 ≤ 95k tokens 才將做法二切換為預設；若 > 95k 或任一環節失敗，維持做法一為預設。

---

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10 (do not use APIs added after 20.10).
- All hooks must remain fail-open (exit 0 on unexpected error) and never break non-PM seats.
- 事實不確定（例如 `fleet pm resume` 完整參數、PM 席 `/clear` 外部注入介面、cron 註冊清單位置）須先查證再實作，禁止編造指令或路徑。
- 做法二未通過 KR4 真 `/clear`（第一回合 ≤ 95k）前，預設開關必須維持做法一。

---

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only` — 僅影響 PM 席（`pm--claude`）在啟用做法二開關時的 context 達標處置；非 PM 席維持既有 `context-land-gate` 派單給 hangar 的行為。
- **Dependency decision**: `none` — 沿用既有 Node.js 標準庫、`hooks/context-budget.js`、`hooks/context-land-gate.js` 與 `fleet` CLI，不新增外部套件。

---

## 3. File-structure map

| 檔案 | 責任 | 狀態 |
|---|---|---|
| `hooks/context-budget.js` | 量測 PM 席 context 達 ~200k 時記錄 `landFire` 並標記可觸發自動交接 | 既有（待擴充） |
| `hooks/context-land-gate.js` | PM 席完成 handoff 後，在做法二啟用時改走自動 `/clear` 派送而非轉交操作員 | 既有（待擴充） |
| `scripts/<pm-auto-handoff>.js`（名稱待查） | 機械化寫出含「操作員最近的話」與「未完成事項」的 handoff | 待新增 |
| `scripts/<pm-clear-resume>.sh`（名稱待查） | 執行 `/clear`、`fleet pm resume` 與 cron 重掛的接線腳本 | 待新增 |
| `~/.autopilot/config.json`（或對應設定） | 控制做法一 / 做法二切換旗標（預設做法一） | 待查確認 |

---

## 4. Phases（≤ M 子單切分，每單含真實使用證據與負控制）

### Phase 1 — 盤點與腳本化 handoff（含操作員最近的話＋未完成事項）
- **Size**: `S`
- **具體步驟**:
  1. 查證 PM 席對話紀錄中「操作員最近的話」與「未完成事項」的機械化擷取來源（「待查」實際路徑與欄位）。
  2. 新增腳本產生符合 [`skills/handoff/SKILL.md`](../../skills/handoff/SKILL.md) 格式的 handoff 檔，強制包含「操作員最近的話」與「未完成事項」兩段，寫入 `sessionHandoffPath(sid)`。
- **Acceptance**: 執行腳本後產出的 handoff 檔存在、mtime 更新，且包含非空的操作員最近的話與未完成事項。
- **真實使用證據**: 在 PM 席真實對話（非合成測試資料）上跑一次腳本，確認產出檔可被 `handoff` Resume Mode 正確讀取。
- **負控制**: 當對話紀錄缺失或無操作員發言時，腳本不得寫出空欄位冒充成功，應回傳非零 exit code 或明確標記 `missing_operator_utterance` 並保留做法一退路。

### Phase 2 — 無人觸發 `/clear` 與 `fleet pm resume` + cron 重掛接線
- **Size**: `M`
- **具體步驟**:
  1. 查證 PM 席 `/clear` 的外部觸發介面（tmux send-keys / fleet control / harness API，「待查」）與 `fleet pm resume` 完整參數（「待查」）。
  2. 查證 PM 席既有 cron 清單與重掛指令（「待查」）。
  3. 在 [`hooks/context-land-gate.js`](../../hooks/context-land-gate.js) 加入做法二開關檢查：當開關開啟且為 `pm` 席時，改為觸發「自動 `/clear` → `fleet pm resume` → cron 重掛」流程，不再要求模型轉交操作員按鍵。
- **Acceptance**: 開關開啟下，模擬達標後無操作員按鍵即完成 `/clear`、執行 `fleet pm resume` 並恢復 cron。
- **真實使用證據**: 在獨立的測試 session（或非峰值時段 PM 席）完成一次無按鍵 `/clear` + `fleet pm resume` + cron 重掛，留下含 timestamp 的執行紀錄。
- **負控制**:
  - 做法二開關關閉（預設）時，[`hooks/context-land-gate.js`](../../hooks/context-land-gate.js) 必須維持原行為（做法一），不得觸發 `/clear`。
  - 非 PM 席即使在相同條件下也不得走 PM 自動 `/clear` 路徑。

### Phase 3 — 200k 真 `/clear` 實測與預設切換閘
- **Size**: `S`
- **具體步驟**:
  1. 僅在 PM 席開啟做法二實驗開關，等待下次 PM 席自然運作達約 200k tokens。
  2. 觀察自動 handoff、`/clear`、`fleet pm resume` 與 cron 重掛全程執行。
  3. 量測 `/clear` 後第一回合的真實 context tokens（由 transcript `message.usage` 或 live 檔讀取）。
- **Acceptance**:
  - 觸發過程 0 次操作員按鍵（KR1）。
  - handoff 含操作員最近的話與未完成事項（KR2）。
  - cron 正常運作（KR3）。
  - 清完第一回合 context ≤ 95k tokens（KR4）。
- **真實使用證據**: 該次 200k 真 `/clear` 的 session ID、清前/清後第一回合 token 數、handoff 路徑與 cron 狀態紀錄。
- **負控制**: 若第一回合 > 95k tokens，或任一 KR1–KR3 失敗，**立即將開關切回做法一**，禁止將做法二設為預設。

---

## 5. Test / validation

- **人工 / 實戰閘（Human-gated）**: Phase 3 的 200k 真 `/clear` 實測與第一回合 ≤ 95k 判讀。
- **腳本閘（Script-gated）**:
  - 做法二開關預設為關閉（做法一）的設定檢查。
  - `hooks/context-budget.js` 與 `hooks/context-land-gate.js` 的既有回歸測試維持全綠。

---

## 6. Risks + inversion（什麼會保證失敗？怎麼防？）

| 風險 | 具體影響 | 緩解 / 防呆 |
|---|---|---|
| **`/clear` 後遺失狀態** | `/clear` 會清空對話記憶；若 handoff 漏掉操作員最近的話、未決事項或 `fleet pm resume` 未載入旁側大腦，PM 席會失憶或重複問操作員 | Phase 1 強制由腳本寫入「操作員最近的話＋未完成事項」；Phase 2 強制 `/clear` 後接 `fleet pm resume`；未完成前不切預設 |
| **cron 重掛失敗** | `/clear` 後若 cron 未重掛，PM 席的週期巡查或續跑會靜默停擺 | 在 `fleet pm resume` 後加一步 cron 狀態驗證；若重掛失敗，發送告警給操作員並退回做法一 |
| **清完第一回合仍 > 95k** | 目前壓縮後首回合約 136.7k（[synthesis.md](../../docs/plans/evidence/2026-11-24-pm-mech-judgment/synthesis.md) §一），若預載未先縮減，`/clear` 後仍可能超過 95k | KR4 硬性規定 ≤ 95k 才切預設，沒過就留做法一 |
| **誤觸發到非 PM 席** | 其他席位被誤 `/clear` 導致工作遺失 | 負控制限定僅 `pm` 席且顯式開啟做法二開關才生效 |

---

## 7. Out of scope

- 預載縮減（查清 72.7k 與縮掉 15–25k）的實作本體（屬另一條線，但影響 KR4 是否能過 95k）。
- 非 PM 席的自動 `/clear`（非 PM 席維持 `context-land-gate` 派單給 hangar）。
- 雙席拆分（L6）或定時換 session（已於 [synthesis.md](../../docs/plans/evidence/2026-11-24-pm-mech-judgment/synthesis.md) §五否決）。

---

## 8. Open questions（上線日與回退方式）

- **上線日**: 「待查」（需先完成 Phase 1–2，並等下次 PM 席自然達 200k 跑過 Phase 3 實測 ≤ 95k 後才正式切換為預設）。
- **回退方式**: 將做法二開關切回關閉（恢復預設做法一：達標寫 handoff 後由 `context-land-gate` 提示操作員手動處理），不需回滾程式即可立即止血。
- **待查項目**:
  1. PM 席無按鍵觸發 `/clear` 的實際控制介面（tmux / fleet / harness）。
  2. `fleet pm resume` 的完整 CLI 參數與可程式化呼叫方式。
  3. PM 席 cron 的註冊清單位置與重掛指令。

---

## Review log

- **R0 (2026-11-24)**: 初稿完成，依 `references/plan-template.md` 與 `synthesis.md` 撰寫，待補「待查」項目後進入審查。
