# ledger.sh 寫入端擋寫：補丁規格（PM 在 PM 主機套用）

Fleet 單 01M883AEHTJWZH95JSY1MSKEFX；PM 裁定 A（11-25）。我的帳號讀不到 `/var/lib/pm-ledger`，也沒有 `ledger.sh`，所以本頁是規格，不是補丁檔。

## 為什麼 11-17 規則還是漏

閘（capacity `scripts/ar_gate.py` 的 `records_decided_no_task`）只認內文有 `task:<26 碼 ULID>` 或 `no-task:`。從 22 筆看漏的是三條路：
1. 內文寫成短碼（`task:01M7M2GT`、`task 01M7XRZ8`）：人看得懂，閘的 regex 要 26 碼，所以算沒綁。
2. 沒有標記就寫入（11-14 之後、尤其 11-24 的 `01M85QRJ`、`01M85QZK`、`01M85R6F`）：現行寫入端不拒絕缺標記的 decision。
3. 工單綁在別的 lane 看不到的地方，只寫「某 lane 的單」。
根因是寫入端只在事後被閘讀，沒有在寫入當下檢查。

## 補丁規格

**入口**：`ledger.sh` 寫 `kind=decision` 紀錄的那一條路徑（add／append 決策的子命令）。`kind` 非 decision 不檢查。

**檢查（寫入前，內文與參數合併判斷）**：
1. 內文必須含 `no-task:<非空理由>`，或含至少一個 `task:<26 碼 ULID>`。
2. 每個 `task:<ULID>` 必須解析得到既有工單：`fleet task show <ULID>` 退出碼 0。查不到、查詢逾時或 fleet 不可達都算失敗（fail-closed）。
3. 例外只有兩種，與閘一致：`--source "card d-xxxxxxxx"`（以卡片 id 追蹤）與 `--source history-claim*`（匯入歷史）。
4. 短碼（少於 26 碼）不算綁定，訊息要指出。

**拒寫行為**：不寫入任何檔、退出碼 3、不留半成品。stderr 訊息（照抄）：

```
ledger: 拒寫決策：缺工單綁定。請在內文加 task:<26碼工單號>（需查得到），或 no-task:<理由>。
  原因：<missing_marker | short_task_id:<原文> | task_not_found:<ULID> | fleet_unreachable>
  規則：capacity ar_gate 的「決定了但沒有 task」；任何已寫入的紀錄都不會被刪改。
```

**稽核**：每次拒寫在 ledger 的 ops log 追加一行 `ts \t refused \t reason`，每次以 `no-task:` 通過也追加一行 `ts \t exempt \t 理由`，方便 PM 每週看豁免的量與理由。

**負控制（套用時要跑）**：
- 缺標記的 decision 寫入 → 必須退出碼 3 且檔案未新增。
- 內文 `task:01M7M2GT`（短碼）→ 拒。
- 內文 `task:<不存在的 26 碼>` → 拒。
- 內文 `no-task:` 後面空白 → 拒。
- 合法 `task:<存在>` 與 `no-task:<理由>` → 通過。
- fleet 不可達時 → 拒（不是放行）。
- 套用前先備份 `ledger.sh`（`cp ledger.sh ledger.sh.bak.$(date +%s)`），回滾即還原該檔。

## 現存 22 筆

`project/plans/2026-11-25-decided-no-task-mapping.json` 是建議清單（每筆 `no_task` 並附理由；其中 5 筆短碼指到別 lane 的單，我這邊解析不到完整 ULID，PM 若查得到可改成 `task`）。`scripts/decided-no-task-bind.js` 唯讀地讀鏡像與此清單，印出每筆要補的標記行、稽核行與 before/after。補標記寫入帳本由 PM 在本機做；做完下一輪 AR 閘應為 0。
