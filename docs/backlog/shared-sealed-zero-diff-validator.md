# Shared sealed zero-diff validator

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: When the zero-diff schema next changes or a fourth production consumer is introduced.
- **Context**: Move sealed zero-diff receipt validation into one deterministic shared helper consumed by shell, Engine, and runner boundaries.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b
## engine implement-review：verify_pass=false 非阻塞、可在 reviewer SHIP 下收斂
- **Context**: 2026-07-24 codepower /l6 P0a run（foreman-p0a-1784819842）兩度實測：U3 與 qc-fix round 的全部 verify_round 皆 `verify_pass:false`，loop 仍以 reviewer SHIP-AS-IS 收斂並回報 committed。實際缺陷（AppSurface class TS2322、AppButton disabled bg、8 個測試紅）全靠 foreman 自驗第二層攔下。root cause 候選：verify-first wiring 只在 roster 發 `verify_first:true` 時 gating，未發時 verify 結果純 telemetry。**Fix 方向**：loop 收斂條件改為 `reviewer SHIP ∧ (verify_pass ∨ verify 缺席原因白名單)`，verify 紅=強制 rework round；至少在 run summary 對 `verify_pass:false + converged` 發 WARNING。
- **Trigger**: 下次動 engine implement-review 收斂邏輯或 resolve-review-loop verify 欄位時。

## engine implement-review：campaign-contract fresh 路徑 Work Order 自鎖（codepower /l6 P4 實測）
- **Context**: 2026-07-31 codepower P4 foreman（p4-foreman-20260731）：`engine implement-review --campaign-contract` 在 `dispatch_implementation` 確定性回 `continuation admission: reconcile receipt is required`，`leaf_runs.total=0`。根因 `src/engine/autopilot-engine.js` ~3494-3541（blame 全屬 `d151f202` Work Order v2）：campaign contract ⇒ durable ⇒ `createWorkOrder=true`，`hasActiveRootWorkOrders` 枚舉到自建/殘留 nonterminal controller WO ⇒ `missionActive` ⇒ `requireReconcile` ⇒ fresh campaign 被要求 PostCompact reconcile receipt。八項合法解法窮盡（含 3 個全新 campaign id、乾淨 `AUTOPILOT_DISPATCH_RUNS_DIR`、`compaction-rehydrate reconcile` 鑄 receipt → `durable campaign already exists` → `campaign resume` → `campaign_state_lease_open` 死巷）。**無 work-order list/dispose CLI 可清殘留**。當次以 pin v2.32.57-era（`349e2420`）engine 繞過續跑。
- **Fix 方向**: (a) fresh-create 路徑排除自建 WO 於枚舉外或同 run 自動鑄 receipt；(b) 提供 work-order 檢視/處置 CLI；(c) `campaign_state_lease_open` 的 lease 釋放路徑。
- **Trigger**: 下次動 continuation admission / Work Order lifecycle 時。

## codex live-spend probe 必須 `--model` 指定 roster implementer（per-model quota pools 假綠燈）
- **Context**: 2026-07-31 codepower P4 U2 實測：probe 用 codex CLI 預設模型（gpt-5.5）回 PROBE_OK，實際 dispatch 的 `gpt-5.3-codex-spark` 池已 rate_limited → dispatch 跑 342s 中斷、產物 broken-by-construction（registry 註冊了 4 個不存在的 loader）。`status --help` 明寫 quota 是 per-MODEL pools——不帶 `--model` 的 probe 驗不到 dispatch 會用的池。既有 capability 成功先例（2026-07-30 16:00 foreman-p15b）同樣未帶 `--model`，此洞是繼承性的。
- **Fix 方向**: probe SOP 與 capability 記錄格式強制 `--model <roster implementer_engine>`；engine dispatch 前的 preflight 亦同。
- **Trigger**: 下次動 live-spend probe / capability 記錄 / engine preflight 時。
