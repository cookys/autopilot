# Orchestrator state machine contract (R0→R1)

本文件是 R0→R5 handlers 的唯一行為規格。R1 以上 handler 僅需依照本契約實作，不需再查其他上下文。

## 1. Stage 狀態定義

允許的狀態集合：

- `pending`
- `leased`
- `committed`
- `reviewed`
- `verified`
- `merged`
- `stale_ignored`
- `quarantined`
- `dead`

`terminal` 指 `committed`、`reviewed`、`verified`、`merged`。  
`blocked` 指 `stale_ignored`、`quarantined`、`dead`。

## 2. 允許轉移（單步）

### 2.1 Stage transition matrix

`is_allowed_transition(current, to)` 必須成立。

| From      | Allowed `to` |
|-----------|--------------|
| `pending` | `leased`, `stale_ignored`, `dead` |
| `leased`  | `committed`, `reviewed`, `verified`, `merged`, `stale_ignored`, `dead` |
| `committed` | `reviewed`, `stale_ignored`, `dead` |
| `reviewed` | `verified`, `stale_ignored`, `dead` |
| `verified` | `merged`, `stale_ignored`, `dead` |
| `merged` | `merged`, `stale_ignored`, `dead` |
| `stale_ignored` | `stale_ignored`, `quarantined` |
| `quarantined` | `quarantined`, `dead` |
| `dead` | `dead` |

轉移規則：

- 若 `to` 的 rank 小於 `from`（不算 self）為 forbidden（需拒絕）。
- `current == to` 時可視為冪等（`already_applied`），只要 idempotency key 已套用時可回傳已完成。
- `generation/nonce` 不匹配會進入 `stale_ignored`，並回傳非零 code（legacy 只用於 late-writer）。

### 2.2 已知狀態輸入

- `stage-acquire` 可在新建或持續寫入時建立 `pending`/`leased`。
- `stage-apply` 必須先寫 journal，再轉到指定 terminal 狀態（如 `reviewed`）。
- `stage-probe` 只在 `leased` 上運作，將過期且存活者轉 `stale_ignored`，過期且不存活轉 `dead`。
- `stage-reconcile` 不直接改狀態；只回報 `resolved / incomplete / invalid_result / blocked / missing` 等。

## 3. Locking 併發規則（兩層鎖）

### 3.1 lock path 命名

- Run lock:
  - `run-lock: <ledger>.locks/run.<run_id>.lock`
- Resource lock:
  - `resource-lock: <ledger>.locks/res.<sha256(resource_id)>.lock`

### 3.2 全域 acquire order

1. 將 `resources` 去重並以字典序排序。
2. 依排序後順序逐一取得 resource lock（`resource-lock`）。
3. 全部 resource lock 取得成功後才取得 `run-lock`。
4. 進入關鍵區時持有「全部 resource lock + run-lock」。
5. 釋放順序為 run-lock 先放，資源鎖可任意順序釋放（建議逆序）。

### 3.3 死鎖防護

- 任何 handler 若已拿到 run-lock，必須在任何回傳點釋放所有 lock。
- 無法取得資源鎖時不得持有部分 lock 逸出。

## 4. side-effect journal idempotency

### 4.1 Journal row schema

Side-effect 需落 `kind=journal`，欄位至少包含：

- `run_id`, `stage`, `generation`, `nonce`
- `idempotency_key`
- `status`（至少 `applied` / `failed`）
- `op`, `payload`

### 4.2 Key 定義

- Key tuple = `(run_id, stage, generation, idempotency_key)`。
- 每個 tuple 僅允許一筆 `status="applied"` 的重放完成紀錄。
- 冪等檢查：
  - 若已有同 tuple 且 `status="applied"`，`journal-add`、`stage-apply`、`stage-transition` 同步返回 `{"status":"already_applied"}`。
  - 反之新增/更新為 `status="applied"`（或 caller 指定）。

## 5. `stage-probe` 的 stale 與 D-state 契約

`now - heartbeat_ts >= stale_seconds` 觸發 probe。

- holder 還活著:
  - `stale_ignored`
  - `reason="stale_writer_alive"`
  - 若傳 `--quarantine-on-stale-alive`，對該 stage 的每個 resource 進行 `resource-mark(quarantined)`
  - 進入 recovery 時不得假設舊 lock 已釋放，應走「新路徑」資源名（或重新評估資源可用性）
- holder 不活著:
  - `dead`
- `generation/nonce` 在 `stage-transition` 對不上時：
  - append `state=stale_ignored`, `reason=late_writer`
  - 返回碼非 0，後續 handler 可視為 stale 路徑被攔截

`D-state`（`quarantined`）處理原則：視作 terminal/blocked；Recovery handler 應改走替代資源，不可沿用原資源鎖名。

## 6. GC / 回收條件

只對 `terminal` 狀態可列入 GC 檢查清單。

`gc-check`（單 run）應判斷：

1. `state` 在 `committed|reviewed|verified|merged`
2. `is_process_alive(pid,start_time) == false`
3. 無未完成 side-effect（journal 中 `status != applied` 數量為 0）
4. worktree clean（`git status --porcelain == empty`）
5. 所有 resource 狀態為 `active`

不應 auto-delete 的狀態：

- `stale_ignored`
- `quarantined`
- `dead`

## 7. `stage-reconcile` 與 git-truth

輸入缺失 `result-json` 時，仍需：

- 若 stage state 已是 terminal，立即 `resolved/terminal_state`。
- 若 `git_sha` 可在 `git_dir` 驗證存在且可被 `git_ref` 或其 ancestor 覆蓋，回報 `resolved/git_truth`，`git_truth=true`。
- 否則為 `incomplete/missing_result` 或 `invalid_result`。

## 8. 持久化要求

`append` 與 `write` 皆需兩段落盤：

- `write-temp` 阶段：先落暫存檔、`fsync/sync`、再 rename
- `append` 階段：先落 ledger 暫存檔 `fsync/sync`、rename、最後落 `ledger` 目錄

若環境沒有 `fsync`，允許 fallback `sync`，並以註記標明 durability 降低（僅全域同步，不保證同 fd 同步語意）。
