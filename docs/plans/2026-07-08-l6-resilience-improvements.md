# /l6 韌性改善 plan v2 — durable orchestrator state machine（dogfood）

> 2026-07-08。v1（5 個獨立 patch）經 hetero 三家族 loop-review（codex/agy/MiniMax）一致判 FIX-THEN-SHIP/RECONSIDER：**5 patch 治標，根因＝缺統一 orchestrator 狀態機 + single-source-of-truth**。Board 裁決：**全做 R0 狀態機地基**，R1–R5 重寫為其上的 transition handler。狀態：**v2 待 hetero 確認一輪 → 收斂後 /l6 實作**。

## 設計原則（三家族共識）

1. **git commit = 工作真相；run-ledger = orchestration 狀態真相；result JSON 只是 artifact**（寫失敗不等於工作沒做）。
2. **process liveness 靠 heartbeat + `kill -0` + PID file，不靠 `ps` 輪詢**。
3. **所有跨行程資源（worktree/branch/merge）競爭同一 `flock`；stage 用 generation/lease token fencing**——resume bump generation，stale holder 只能寫 `stale_ignored`，不能覆寫 canonical。
4. **模型家族去相關 與 spec 敵對性 是正交兩軸**，分開處理。

## R0 — durable run-ledger + stage state machine（地基，先做）

- **檔（新）**：`scripts/run-ledger.sh`（append-only ledger CRUD + lease/nonce + `flock` + atomic write-temp-then-rename）；`references/orchestrator-state-machine.md`（狀態機契約）。
- **Ledger**：每個 run 一份 append-only 檔（on disk，survive 行程死）。記錄每個 stage 的 state（`pending/leased/committed/reviewed/verified/merged/stale_ignored/quarantined`）、generation、nonce、heartbeat ts、git ref/sha、worktree path。
- **狀態機**：stage transition 只能經 ledger；讀 ledger 決定下一步（非讀 result JSON）。terminal state 才可 GC。
- **liveness**：每個 detached child 定期寫 heartbeat 到 ledger；watchdog＝heartbeat stale + `kill -0` 失敗 → 標 dead → 觸發 recovery。
- **驗收**：kill 任一 stage 行程於任意點（含 git commit 中途），ledger 仍可判定該 stage 真實狀態；無 corrupt canonical。

## R1 — dispatch 自帶 detach（handler on R0）

- **檔**：`scripts/dispatch-hetero.sh`/`dispatch-review.sh`/`dispatch-author.sh`/`bin/autopilot.js`。
- **做**：長跑階段 `setsid` detach 為預設（`DISPATCH_DETACH=0` fallback），子行程向 ledger 寫 heartbeat + 原子寫結果；不與呼叫端 bash task 同生死。孤兒偵測由 R0 watchdog 負責（非 caller）。
- **驗收**：呼叫端 <900s 被 kill，子 dispatch 仍完成、heartbeat 持續、結果原子落地、ledger 標 committed。
- **依賴**：R0（heartbeat/atomic write/watchdog）。

## R2 — misplaced-writes typed protocol violation（handler）

- **檔**：`bin/autopilot.js`（engine no_op 判定）。
- **做**：impl 回報的檔案集合做**靜態檢查**：任一 ∉ `--cwd` → 回 typed `phase:"misplaced_writes"`（含病因提示 hardcoded-path），**絕不靜默 no_op 略過 review**。另涵蓋 split-brain：review git commit 了但 outcome JSON 沒寫 → ledger（非 result JSON）判定 review 已跑，不重跑。
- **驗收**：構造 impl 寫到 `--cwd` 外 → typed 錯誤；構造 outcome-write-fail → ledger 正確判 reviewed。
- **依賴**：R0（ledger 判定）。可獨立於 R1/R3 先做。

## R3 — 冪等 foreman-death recovery（handler）

- **檔**：`skills/l6/references/full-dispatch-pipeline.md` + `skills/ceo-agent/references/level-front-door.md`（outcome→action table 增 recovery 分支）+ `scripts/run-ledger.sh` 的 resume 子命令。
- **做**：foreman `failed`/`killed` → depth-0 標準 recovery：(a) 讀 ledger 定位最後 committed stage；(b) resume **冪等**（nonce-guarded，重複 resume 不重複 merge）；(c) git-ref `flock` 防與殘留 child 競爭；(d) review 未完成則補單輪 dispatch-review。resume 前 bump generation，fence 掉 stale child。
- **驗收**：模擬 foreman 中途死 + 殘留 child 晚到 → resume 冪等、無 double-merge、stale child 寫 `stale_ignored`。
- **依賴**：R0（lease/nonce/ref-lock）。

## R4 — quota-reset preflight resume（handler）

- **檔**：`skills/ceo-agent/references/level-front-door.md`（budget/中斷節）+ ledger resume。
- **做**：session-limit 死亡 → 保留原始錯誤字串 + 解析 reset time → ScheduleWakeup 於 `reset + buffer + jitter` → **醒來先發便宜 API probe（1-token）**探 quota；成功才 resume（走 R3 冪等路徑），429 則 exponential backoff 重排。解析失敗 fallback 手動 escalate。
- **驗收**：中斷→排程→probe→（成功 resume / 429 backoff）流程可執行；probe 失敗不會 heavy-resume 再撞 limit。
- **依賴**：R3（冪等 resume）先就位，否則排程放大重複執行。

## R5 — risk-triggered hybrid inner review（選項 C，正交於 R0–R4）

- **檔**：`scripts/dispatch-review.sh`（或 engine review 呼叫點）+ `references/review-loop-config.md` + 一個 diff-classifier。
- **做**：
  - **家族去相關恆開**：內層 reviewer 維持與 implementer 不同家族（implementer=gpt-5.3-codex-spark/OpenAI → 內層 reviewer=agy/Google）。
  - **敵對性 risk-tiered**：diff-classifier（path/keyword regex：`auth`/`tenant_id`/§2e gate/money/`stripe`/schema/migration/sync cursor/watermark）命中 → 內層 review prompt **動態升級載入對應領域敵對 checklist**；未命中 → 輕量 sanity pass。
  - **deep random sampling**：低風險項按比例隨機抽做 full 敵對 review，防 classifier 漏判。
  - depth-0 三家族 panel 維持為 **authoritative 整合審查**（跨分支語義耦合，classifier 看不到）。
- **驗收**：敏感路徑 diff 自動升級 + 抓到植入的 tenant/authz bug；非敏感 diff 走輕量；sampling 命中率記錄。
- **依賴**：無（正交，可與 R0 並行）。

## GC 安全（貫穿）

GC 只讀 ledger（非 result JSON）；清理前必須：terminal state + 無 active lease + worktree clean 或 diff 已 archive + branch 已被 target contains。不確定狀態進 **quarantine 不刪**。

## 實作排序（依賴鏈，三家族一致）

```
R0 (ledger/lease/atomic/heartbeat/flock)  ← 地基，最先
 ├─ R2 (typed misplaced-writes)           ← 可早做，依賴 R0 判定
 ├─ R3 (idempotent resume + ref-lock)     ← 依賴 R0
 │    └─ R1 (detach default-on)           ← 依賴 R0 watchdog + R3 recovery
 │         └─ R4 (quota scheduled resume) ← 依賴 R3 冪等
 └─ R5 (risk-triggered hybrid)            ← 正交，可並行
GC 規則隨 R0 ledger 一起定義。
```

## 非目標
- 不改 Anthropic 帳號 rate limit（改不動）；不改 Claude Code Bash timeout 語義（R1 detach 繞過）。
- 不追求分散式共識（單機多行程，`flock` + git-ref 足夠）。

## 交付後
- autopilot repo（dogfood）；merge develop → dev symlink 即生效 → 下次 /l6 受惠。

---

## v3 — R0 spec 硬化（round-2 hetero review 收斂，3 家族一致 FIX-THEN-SHIP）

Round-2 確認 v2 結構正確、無需 RECONSIDER；以下為 R0/R5 必納 spec 細節（實作前定型）：

### 液性判定（修 C1）
- process liveness ＝ **PID + start_time（proc 啟動時戳）雙驗**，防 pid 回收後被別的行程複用而誤判存活。
- heartbeat 有 stale threshold：threshold 內 = 健康、不算孤兒；逾 threshold 且 PID+start_time 驗證已死 → watchdog `kill -9`（連帶 OS 自動釋放其持有的 flock，解死鎖）。

### recovery reconciliation（修 C2）
- 任何 stage 被判「未完成」前，必須 **ledger vs git-truth（ref/sha contains）vs side-effect journal 三方對帳**：被砍 child 若已 commit / 已產生外部 side-effect，recovery **採用**之，不重做。
- side-effect journal 納入 R0：外部寫（cockpit/network/檔案）記入 ledger，供 reconciliation 查。

### flock 定錨（修 C3）
- **per-run 單鎖**（明確 granularity，避免多鎖階層死鎖）。acquisition timeout 殺掉的 holder 要走 C2 reconciliation，不可直接視為「未做」。

### 原子性（M1/M2）
- result：write-temp → fsync → rename（單一原子路徑，不與 append 混用）。
- ledger append：fsync + 大小上限/rotation。

### GC terminal predicate（硬化）
- terminal-for-GC 必須全部滿足：side-effects reconciled + target contains（或 diff archived）+ external dirty paths resolved + **process absent（PID+start_time 消失，或 kill 後 grace 過）**。
- `stale_ignored` / `quarantined` / `dead` 一律**不可** auto-delete；D-state（uninterruptible sleep）→ quarantine。quarantine 有 TTL。

### R5 classifier 補強（shared-infra 漏判）
- 除敏感 path/keyword 外，**shared infra / config / generated types / contracts / concurrency / serialization / db helper / feature flag / clock-timezone 一律升級敵對 review**（regex 抓不到間接語義風險）。
- sampling 改 **stratified + adversarial**；depth-0 panel 發現的漏判**回寫 classifier**（閉環學習）。

### R4 probe budget
- 1-token preflight probe 走 **separate budget pool**（或明記主 budget 扣量），不佔實作 quota。

### 排序補充
- R0 必須先含：side-effect journal + global resource lock + lease-expiry semantics + GC predicate。否則 R2/R3 掛在不完整 ledger 上。

---

## v4 — 鎖分層 + stale-alive/D-state transition（round-3 codex holdout 收斂）

Round-3：agy + MiniMax SHIP-AS-IS；codex FIX-THEN-SHIP 三點（真缺口，本節修）：

### 鎖分層（修 C3 矛盾）
v3「per-run 單鎖」與「global resource lock」矛盾——per-run 鎖保護不了**跨 run** 的 shared 資源。定型為**兩層**：
- **per-run lock**：僅序列化「同一 run 自己的 stage」。
- **resource-scoped 全域 lock**（保護 shared git-ref / target branch / worktree / merge）：跨 run 共享、**只在該 critical op 期間持有**、單一全域 acquire 順序（避免多鎖階層死鎖）。per-run lock **不得**當 shared 資源的唯一防線。merge/branch/ref 寫一律先取 resource lock。

### stale-but-alive / D-state holder transition（修死鎖洞）
heartbeat stale 但 PID+start_time **仍存活** 的 holder，明確狀態機：
1. stale+alive → 送 `SIGTERM` → grace 窗；
2. 仍活 → `SIGKILL`；
3. **仍活或 D-state（uninterruptible sleep，持 flock 且 `kill -9` 不釋放）** → 標該 **resource `quarantined`**，recovery **禁止假設 lock 已釋放**；改走**新資源路徑**（新 worktree/branch）或 escalate operator cleanup。永不 recover 到可能仍被鎖的資源上。

### C2/probe 冪等
reconciliation + preflight-probe 路徑本身冪等：probe/retry 不得重觸已 applied 的 side-effect；reconciliation 一律經 side-effect journal 採用既有結果，不重放。
