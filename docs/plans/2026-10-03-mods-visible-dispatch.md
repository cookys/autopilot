# Plan — Mods 進 autopilot 本體：看得見的派工、owner review 網頁、事件核心、`autopilot.progress/1` 快照
> Status: R2 — under plan review（fable 修稿；原稿在 depth-0 scratchpad，作為出處）/ Owner: cookys / Branch: `feat/mods-visible-dispatch`（未建）/ Frame: autopilot 這一半；radar（跨專案）另案
> 日期 2026-10-03。R0 SHA256 `6f43308d…`；astra R0 審查 `4a46589b…`（9 🟠 3 🟡）；R1 SHA256 `e5192f1e…`；astra R1 確認 `4e35c87a…`（7 到位、5 部分到位、新 N01／N02）。R2 只動 R-A03／R-A04／R-A06／N01／N02 五處，處置在 Review log。證據標記：[V-file] 讀檔、[V-run] 本機跑過、[peer] 機隊自述未獨立查證、[SPIKE] 未驗證。
> 落地程序：複製到 `docs/plans/2026-10-03-mods-visible-dispatch.md` → `node scripts/check-plan-graduation.js --register-template 2026-10-03-mods-visible-dispatch` → 列貼進 `docs/projects/INDEX.md`（Version `active`）→ 寫 `plan-review-manifest` → 才能送 `dispatch-plan-review.js`。

## 0. Context / thesis
- owner 已決：mods 放 autopilot 本體；terminal 優先、desktop Code tab 要優雅降級；wake-self 是開關、預設只通知、閒置才喚、低優先；第一個 mod = MINOR（plugin.json 現為 2.36.114 → 2.37.0）；跨專案 cockpit／gantt／排程／quota 不是 autopilot，autopilot 只發佈 `autopilot.progress/1`；「dom-depth-0」= 只在某 depth-0 宣告「沒事可跑」時才跑的 portfolio 重排器。
- 輸入：四份研究（`docs/plans/research/2026-10-03-*.md`、owner 七頁 review 調查）、fable 提案、astra R0 審查、機隊問卷 11 份：**10 個專案沒有 gantt、沒有派工儀表板；revival.3d 自述有一套在用的靜態 gantt／status 頁（`scripts/reports/experience-audit/`，`execution-status.json` schemaVersion 1 → `build.mjs` → 候選目錄 smoke → 原子 mv、舊版 `.prev`、LAN http.server）[peer]**。owner 對它的硬性要求直接寫進 §2.5。
- 論點：**一個生產者、三個讀者。** 生產者是既有 `autopilot status` CLI 的投影（只合成 manifest／ledger／receipt／git 的事實，不判定）；讀者是 mod 面板、腳本產生並自動重發佈的靜態 review 頁、之後的 radar。live 狀態落 tmpfs，里程碑才匯出；頁面照 owner 既有版型。

## 1. Problem
owner 看不到派工在跑什麼、跑多久、最後結果，只能問或等通知；每回合的 project／phase／result／視覺比對散在 log、receipt、evidence 目錄，沒有一頁可 review（owner 原話「驗收給比較頁，不要用問的」）；fleet 看不到專案層的閒置／需要 owner（`State.summary` 全機隊看不到）。

## 2. OKR / KRs
O：owner 不用問「怎麼這麼慢」就知道誰在跑、跑多久、最後 rc；每回合一頁可 review 且每階段自動刷新；radar 有快照可吃。
- KR1（P1）：真跑一次 `/l5`，band 在 ≤ 15 s 內顯示 live run 數、最老 elapsed、session cost、context %；派出／`.exit` 落地／review receipt／task receipt 四個事件各自在 ≤ 30 s 內觸發頁面重發佈（refresh 看到新內容）。
- KR2（P1）：§4 P1 的負對照全綠；`grep -r "prompt.submit\|asUser\|process.spawn" mods/` 空。
- KR3（P2）：classic hook 每次 hook 區間的 p50／p95 有基線 JSON；正對照（已知 200 ms 延遲）量得到、負對照（hook 數 = 0）允許差近零。
- KR4（P3）：事件核心 `--once` 在 CC-有-mod、CC-無-mod、Codex 三種環境印同一組事件行；預設設定下 `$.prompt.submit` 呼叫數 = 0（mock 計數）；宣告 `nothing_left` 後新 run 一開始就被標 `superseded`。
- KR5（P4）：固定時計、同輸入重播兩次，`progress.json` 去掉 freshness envelope 後的 canonical payload byte-identical；真實 heartbeat 下 `published_at` 單調遞增而 payload 不變；重排器在 fake `child_process`／PATH 假 `fleet` 下零呼叫。

## 2.5 Global Constraints (copied verbatim into every dispatch)
- Node ≥ 20.10，只用 built-ins；mod 以 TS 放 `mods/`，CC 專屬；mod 沙箱無 Node，不得 `require` repo lib；P1 的 mod 只讀檔，不起程序（`$.process` 是 CLI-only 且 spawn 的子程序隨迴圈／reload 死亡 [V-file types process]）。
- 身分只用既有 key，照 §2.7 的關聯表：project = `repo_identity`（`git-common-dir:<realpath>`，`src/status/task-runtime.js` `repoIdentity()` [V-file L36–46]）；執行根 = `root_run_id`；工作單位 = Work Order `root_run_id + graph_node + attempt`（`src/engine/controller-execution.js` [V-file ~L1626]）；campaign 兩個 namespace `mission_campaign_id` / `icc_campaign_id` 永不合併 [V-file task-runtime L98–99]。時間窗、branch、名稱只能當顯示過濾並標示為過濾，絕不當身分；沒有執行根的回合顯示 `unbound`，不猜。
- 兩條狀態軸永不混：**執行軸** `running | exited | unknown`（來源 enum 原樣）；**驗收軸** `accepted | rejected | unknown`（只來自 `autopilot status task --root-run-id` 的 `task_status_receipt` [V-file cli.js L432–445、schema L56–58]）。review receipt 只顯示為該 gate 的結果；投影合成事實，不判定轉換、不產生 verdict、不提升層級。
- 新投影欄位 unknown 一律 `null`、絕不填 0；既有來源的 `'unknown'` enum 原樣保留。每個 datum 帶 `source`、`fact_at`（來源事件時間）、`observed_at`（生產者最後重查時間）；快照另帶 `published_at`。
- 實際進度（%、完成／未完成數）只來自 depth-0 核證過的 receipt（`controller_progress_receipt` 凍結分母、`task_status_receipt`），不來自 process monitor；派工表是 telemetry，頁面上必須標「執行狀態，不是進度」。
- 頁面首屏固定：一句結論＋是否需要決定 → 總進度 %（分母未凍結則顯示「分母未凍結 · n done」）、完成／未完成數、每個 deliverable 的 % → 狀態計數（兩軸分列）。「規劃」與「實際」分開兩段畫。
- live 投影寫 `scripts/lib/live-state-dir.js` 解析的 tmpfs base（本機 `/run/user/1000/autopilot` [V-run]）；**每個 project 一支 watcher 當唯一 writer**（flock `runs/<project_key>.lock`），它產出所有 scope 檔、`progress.json` 與 heartbeat；project index 發佈另有一把鎖 `review/<project_key>.index.lock`，手動 renderer 也要拿；durable 匯出只在里程碑（phase 結束、回合結束、`declare-idle`），落 `docs/plans/evidence/<date>-<job>/`。
- 頁面只由 `scripts/render-review-page.js` 從 JSON 產生，不手寫、數字不重打；served root 預設 `~/.autopilot/review/<project_key>/`，不從 checkout 提供；發佈順序 候選目錄 → smoke → 原子 rename → 舊版 `.prev`；`python3 -m http.server --bind 127.0.0.1 <port>`。
- 給 owner 看的圖，交付前實作者先自己截圖看過；比對頁的每張圖先派一個獨立審圖席（model: sonnet）逐張看過並留紀錄（revival.3d 教訓：leaf 把全黑畫面判 ACCEPT）；審圖席是程序，不是 gate。
- severity 只用 🔴 Critical／🟠 Major／🟡 Minor／🔵 Suggestion；ADR-0001：不加 hash chain／attestation，頁面只列可重推的證據（路徑、commit、sha256）。
- P1–P2 任何程式路徑不得出現 `$.prompt.submit`／`asUser`（grep 閘）；wake 預設 `notify`；`mods/` 不進 codex／opencode 鏡像；mod 不寫 repo 檔。
- 本 plan 不做：像素 diff、各專案截圖工具、gantt 時間軸 render、跨專案排程、quota、auth／TLS、guard 搬 function hook、Artifact 發佈功能。

## 2.6 Change-policy decisions
- **Compatibility impact**: `published-compatible` — `autopilot status runs --json` 陣列形狀不變、只加欄；`--watch --out` 的 envelope 是新契約；三個 dispatcher 的 manifest 加 additive 欄 `repo_identity`（舊 manifest 缺欄 → `project: null`，顯示 `unscoped`）；新子命令 `work-round`、`declare-idle`；`hooks/hooks.json` 加頂層 `modules`（`check-hook-inventory.js` 只走 `hooksJson.hooks` [V-file L103]）；`progress/1`、`compare-record/1`、`runs-live/1` 皆 additive。
- **Dependency decision**: `platform/stdlib` — Node built-ins、python3 `http.server`、CC mods API（early access，隨 CC 2.1.288）。不引 npm 套件；資產只用 `fs.copyFileSync`，不引影像庫。

## 2.7 身分與關聯表（A01；每個新契約都照這張 join）
| 實體 | canonical key | 來源 | 關聯 |
|---|---|---|---|
| project | `repo_identity` | `repoIdentity(repo)`；manifest 新欄；`task_status_receipt.repo_identity` | 所有 scope 的第一段 |
| 執行根（= job／回合） | `root_run_id` | manifest `root_run_id`；`status task --root-run-id` | 一個 job = 一個 root；campaign 是否對應此 root 由 receipt 的 binding 欄證實，不假設 |
| campaign | `mission_campaign_id`、`icc_campaign_id` | task-runtime | 兩欄並列顯示，永不折成一欄 |
| deliverable | `graph_node`（＝`controller_progress_receipt.deliverable_id`） | controller receipt、graph | 分母來自 `frozen_denominator_digest`；retry 不加分母 |
| attempt／repair／gate | Work Order `root_run_id + graph_node + attempt`、`work_order_id`；review `receipt-<phase>.json` 的 `chain[]{generation, base, head}` | engine、hetero-review-loop | 掛在 deliverable 下 |
| dispatch run | `run_id`（樹：`parent_run_id`／`depth`） | manifest | 掛在 root 下 |
| candidate | `candidate_commit`、`candidate_tree_sha` | `task_status_receipt` | receipt 顯示前必須與 job 的 candidate 相符，否則標「舊候選」 |
| README Phase 表 | 無 key | `docs/projects/<proj>/README.md` | **display-only**，不進分母、不進 percent |
| dev-flow 回合（無 engine） | 無 root → `job_id: null` | — | 顯示 `unbound`；要有 job 就在 `session-mode.js set` 時配 `root_run_id`（`AUTOPILOT_ROOT_RUN_ID`，既有慣例） |

## 3. File-structure map
| 檔 | 責任 | Phase |
|---|---|---|
| `scripts/dispatch-hetero.sh`、`dispatch-review.sh`、`dispatch-author.sh` | manifest 加 `repo_identity`（由 `CONSUMING_REPO_ROOT`／`REPO_ROOT` 算 `git-common-dir:<realpath>`） | P1a |
| `src/status/cli.js` | `runs` 加欄、`--project`／`--root`、`--since`（標示過濾）、round-robin enrich、`--watch --out --render`；新子命令 `declare-idle`、`work-round` | P1a, P3, P4 |
| `src/status/runs-watch.js`（新） | project 級唯一 writer（flock）、依 scope 分檔的 `runs-live/1` envelope、heartbeat（runs 60 s／progress 120 s，不分 live 或 idle）、觸發 render、`--stop`／`--idle-exit`、版本目錄＋`current` 指標切換 | P1a, P1b, P4 |
| `src/status/work-round.js`（新） | `autopilot.work-round/1` 投影＋`--projection progress`＋heartbeat | P4 |
| `scripts/render-review-page.js`（新） | JSON → `/<date>/<job>/index.html`＋專案 `index.html`；bundle 資產；smoke | P1b |
| `scripts/session-mode.js` | `set` 時起 project watcher（`setsid nohup`，lock 已被持有就不起、印持有者 pid）；`set`／`retire` 時 supersede 閒置宣告 | P1a, P3 |
| `mods/live/{register.ts, band.tsx, pane.tsx, live.test.ts}`（新） | band（runs＋cost＋context）／pane／toast；只讀 | P1c |
| `hooks/hooks.json` | 頂層 `"modules": ["../mods/live/register.ts"]`（S1=yes 時） | P1d |
| `hooks/idle-observe.js`（新，default-on） | classic `Stop` 的 `background_tasks`／`session_crons` 皆空 → live `idle/<repo_key>/<sid>.observed.json` | P3 |
| `scripts/check-hook-inventory.js`、`sync-codex-plugin-skills.sh`、`sync-opencode-plugin.sh`、`sync-version.js`、`.claude-plugin/plugin.json`、`CLAUDE.md` | 認得 `modules`；鏡像排除 `mods/`；2.37.0；semver 表加「new mod surface → MINOR」 | P1d |
| `schemas/{compare-record, runs-live, idle-declaration, work-round, progress}.schema.json`（新） | 契約 | P1b, P1a, P3, P4 |
| `references/review-page.md`、`references/mods.md`（新） | 頁面契約（版型、URL、兩軸 chip 映射、serve 指令、LAN 風險、審圖席）；mod 包裝與 surface 降級表、spike 結果 | P1b, P0 |
| `scripts/wake-events.js`、`scripts/lib/wake-{policy,sinks,template}.js`（新） | 事件核心，sinks 只有 `notify` | P3 |
| `scripts/benchmark-hook-latency.js`（新；或擴充 `benchmark-hook-multiplexer.js`） | hook 延遲基線＋正負對照 | P2 |
| `scripts/portfolio-replan.js`（新） | 閒置觸發的重排器，只出提案 | P4 |
| `hooks/tests/{manifest-repo-identity, status-runs-fields, runs-watch, render-review-page, idle-observe, declare-idle, wake-events, work-round, portfolio-replan}.test.sh` | 腳本側測試 | 各 phase |
| `docs/scripts-inventory.md`、`CLAUDE.md` 分組清單、`CHANGELOG.md`、`docs/projects/INDEX.md`、`docs/plans/evidence/2026-10-03-mods-spikes/` | 四處接線＋證據 | 各 phase |

## 4. Phases
依賴：P0 → P1a → P1b → P1c → P1d → （P2 ∥ P3）→ P4。

### P0 Spikes（S）— 交付前置 vs 探索分開
| # | 問題 | 怎麼驗 | 性質 |
|---|---|---|---|
| S1 | `hooks/hooks.json` 同時有 `modules` 與 classic hooks，真實載入兩邊都跑？對象是真的 autopilot 套件，不是最小範例 | mod `session.start` 寫一行到 live；同 session 的 classic `Stop` 照常寫 `costs.jsonl` | 前置 |
| S2 | 每個 surface 的**完整資料供應路徑**：`$.fs.read` 讀 `<live-base>/runs/<scope>.json`（真實 envelope、大小、權限）與 SSD 退路 `~/.autopilot/review/<project_key>/live/runs.json`；desktop host 的路徑解析是否相同 | terminal 與 desktop 各讀一次，印長度與 errno | 前置（合併原 S2＋S5 的資料面） |
| S5 | 兩段：(a) mod 生命週期：reload 後 `$.clock.every` 重建、`session.end` 後不殘留；(b) **真實啟動路徑** `session-mode.js set` → detached watcher → envelope 落地（`writer.pid` 等於持鎖程序）→ kill 後 lock 釋放 → 再 `set` 重起 | (a) `claude plugin test` 迴圈 `['terminal','desktop']`＋真 session reload；(b) 用 `AUTOPILOT_LIVE_DIR` fixture 真跑一次 | 前置 |
| S6 | `benchmark-hook-multiplexer.js` 的 registration selector [V-file L93–125] 能否覆蓋全部 classic hooks | 讀程式＋試跑一個非 opt-in hook | 前置（P2） |
| S3 | desktop `Svg` 131072 字元放得下 40 列？ | 量長度 | 探索（本 plan 不畫 timeline） |
| S4 | owner 終端 `Image {file}` | 畫一張 PNG | 探索（P1c 不用 Image，不佔 owner gate） |
- 驗收：每格一行 verdict（yes／no／partial）＋原始輸出，落 `docs/plans/evidence/2026-10-03-mods-spikes/S<n>.md`。
- **S1 = no 的處置**（A10）：classic 功能完整不變、mod 標 `unavailable`；「同 repo 第二個 plugin」是另一個包裝決策（D4，要實測一次安裝），不是自動等價退路。
- 負對照：語法錯的 `register.ts` → 錯誤有紀錄（transcript 或 debug log）且 classic 訊號照常；不綁死 `refused` 字串。

### P1 看得見（L）
**P1a 生產者：manifest 加 scope、`status runs` 補欄、單一 writer watcher（S→L）**
- 現況 [V-file src/status/cli.js L152–174]：`--list` ＋ 固定順序前 8 個 live run 的 `--run` enrich；`--list` 不含 `started_epoch/ended_epoch/ledger/stage/final_status` [V-file dispatch-status.js L897–911]，新欄要直接讀 manifest。
- manifest（三個 dispatcher）加 `repo_identity`；`hooks/tests/manifest-repo-identity.test.sh` 斷言三種 role 都寫、舊 manifest 缺欄不炸。
- `runs --json` 每列加：`elapsed_s`、`rc`（`ledger` 非 null 時讀 `<ledger>.results/<run_id>.<stage>.exit`，否則 null）、`final_status`、`project`（`repo_identity`｜null）、`source {manifest, status_probe, exit_file}`、`fact_at`（manifest `started_at`／`ended_at`）、`observed_at`、`probe_age_s`（距上次 `--run` 探測；從未探測 → null 且 `alive: null`）。選擇器：`--project <repo_identity>`（只匹配有欄的 manifest）、`--root <root_run_id>`、`--since <iso>`（輸出頂層 `filter: {since}`，標示為顯示過濾）。
- enrich：`--enrich-cap N`（預設 8）＋**有界輪轉**：每 tick 從上次停點續探，所有 live run 在 `ceil(live/N)` tick 內都被探到一次；未探測列保留上次值與其 `observed_at`，不得顯示為已確認 running。
- watcher `src/status/runs-watch.js`（`autopilot status runs --watch --project <key> --interval 10 [--render <out-root>] [--idle-exit 3600] | --stop`）：**writer 粒度 = project**，一支程序先 `flock -n <live-base>/runs/<project_key>.lock`，拿不到就印持有者 pid、以 `writer_busy` 退出 0（本 session 只讀）。輸出**依 scope 分檔**：`runs/<project_key>.json`（全部）＋每個觀測到的 root 一份 `runs/<project_key>--<root_run_id>.json`；SSD 退路同樣分檔 `~/.autopilot/review/<project_key>/live/runs.<scope_key>.json`。envelope `{schema:"autopilot.runs-live/1", scope:{repo_identity, root_run_id|null}, published_at, valid_for_s:180, writer:{pid, session_id, started_at}, runs:[…]}`；reader 必須核對 `envelope.scope` 等於自己要的 scope，不符視同缺檔。變更時立刻發佈；無變更每 60 s heartbeat（只動 `published_at`，有效期 180 s = 三倍餘裕；`observed_at` 只在真的重查來源時更新）；atomic rename。
- watcher 生命週期（R-A04，手動恢復，不加 service manager）：**存活單位是 project、而非 session**。退出條件只有三個：(1) `--stop`（核對 lock 持有者 pid 後送 SIGTERM，收到後最後發佈一次 `writer: null, exit_reason: "stopped"`）；(2) `--idle-exit N`（預設 3600 s）：連續 N 秒 scope 內 `confirmed_live = 0 且 unknown = 0`，**且**該 repo 沒有任何未過期的 `~/.autopilot/session-mode/<sid>.json` marker → 最後發佈 `writer: null, exit_reason: "idle_exit"` 後 exit 0（有活躍 session 就一直心跳，含 idle／blocked 專案）；(3) 啟動失敗（live dir 不可寫、manifest 目錄不存在）→ exit 非 0、stderr 一行、不留 lock（flock 隨 fd 釋放）。crash：lock 由 OS 釋放，下一次 `session-mode.js set` 或手動 `--watch` 重取；reader 離開不影響 writer；第二 session 以 `writer_busy` 退成 reader 後，若 writer 死亡其 band 顯示 `unavailable · run: autopilot status runs --watch --project <key>`，由人或下一次 `set` 重起。日誌 `~/.autopilot/review/<project_key>/live/watcher.log`。
- 誰起 watcher：`scripts/session-mode.js set`（/l3–/l6 入口）用 `setsid nohup` 起一支（lock 已被持有則不起，印持有者 pid）；dev-flow 無 level 時 depth-0 跑 band／renderer 印出的指令。mod 不起程序（A04）。
- 驗收：`status-runs-fields.test.sh`（fixture manifest 目錄 + `.exit`）五個新欄齊全、`rc` 整數、`--root` 只留該樹、人類輸出不變；`runs-watch.test.sh`：9 個 live fixture 在 2 tick 內全部 `probe_age_s` 非 null；兩個 watcher 同 project 第二個 `writer_busy`（保留）；**同 repo 兩個 root 並行**：兩份 scope 檔與兩份 SSD 退路各自存在且 `envelope.scope` 正確、index 兩個 job 都在、互不覆蓋；fake clock：無 live run 但 watcher 活著推進 300 s → `published_at` 更新、payload 不變、reader 判 fresh；heartbeat 排程晚 30 s → 仍 fresh（180 s 餘裕）；停掉 producer → 超過 180 s 判 stale；發佈時間更新不改 `observed_at`；真實啟動路徑（S5b）：`session-mode.js set` → 2 tick 內 envelope 出現且 `writer.pid` 為持鎖程序 → kill → lock 可取 → 再 `set` 重起；`--idle-exit 1` 且無 marker → exit 0 且 `writer: null`；有未過期 marker → 不退出；啟動失敗（manifest 目錄不存在）→ 非 0 且 lock 已釋放。
- 負對照：manifest 無終態而 `--run` 回 `exited` → `rc: null, phase: exited`，不是 running；同 branch 同起點兩個 root 各自成 job；兩 repo 的 manifest 混在同目錄時 `--project` 只取己方、無欄的列進 `unscoped` 不進任何專案；舊 session 殘留 lock（持有者已死）→ `flock -n` 可取得（flock 隨 fd 釋放，不留殘鎖）；兩 reader 剩一個、最後一個 reader 離開 → writer 照常心跳直到 `--idle-exit` 條件成立。

**P1b `scripts/render-review-page.js`＋自動重發佈（L）**
- 輸入：`--runs <runs-live.json>`、`--root <root_run_id>`（有 root 時 renderer 自己呼叫 `autopilot status task --root-run-id <id> --json` 取驗收軸；review receipt 從 manifest `ledger` 旁的 `receipt-<phase>.json` 發現，每份帶 `branch/phase_base_sha/chain[]` 與 job 的 `candidate_commit` 比對）、`--compare <dir>`（compare-record 目錄）、`--job <id>`、`--date`、`--project <key>`、`--out-root ~/.autopilot/review/<project_key>`。**沒有 `--results` 任意路徑清單**（A02）。
- 版型（owner 七頁調查 §3＋revival.3d 硬性要求，順序固定）：① 標題＋`updated <published_at> @ <commit>` ② 一句結論（只抄 `acceptance_verdict`；無 receipt → 固定句「本回合尚無驗收 verdict；下表是執行狀態，不是進度」）＋「知會／需要你決定」 ③ 需決定時：問題、三選項各附後果、「這份裁決不授權的事」 ④ **進度首屏**：總 %（分母凍結才算）、完成／未完成數、每 deliverable %（來源 `controller_progress_receipt`）；「規劃」（graph／README，display-only）與「實際」（receipt）分兩段 ⑤ 證據：compare 並排圖（同 scene 同 viewport、原圖可點、審圖席紀錄連結）、指標表含 delta ⑥ 派工表（標「執行狀態，不是進度」）：run_id、role、runner/model、started、elapsed、phase、rc、final_status、`probe_age_s`、`UNVERIFIED` ⑦ gate 結果表：每份 review receipt 一列（phase、generation、base→head、verdict、是否匹配當前 candidate；不匹配標「舊候選」；同 scope 衝突兩列都列並標 `CONFLICT`） ⑧ `<details>` 工程細節 ⑨ footer：來源路徑、commit、sha256、「這頁不主張的事」。
- 兩軸 chip 映射（A12，寫進 `references/review-page.md`）：執行軸 `running→RUNNING`、`exited→EXITED`、`unknown→UNKNOWN`；驗收軸 `accepted→ACCEPTED`、`rejected→REJECTED`、`unknown→PENDING`；`can_close=false` 且 accepted → `ACCEPTED · 未收尾`。索引第一行兩軸分列：`執行 RUNNING n · EXITED n · UNKNOWN n ｜ 驗收 ACCEPTED n · REJECTED n · PENDING n`。
- 發佈（A05／N01）：job 目錄是**不可變版本目錄＋原子指標**：`<out-root>/<date>/<job>/v-<published_at 緊湊格式>/`（候選，與其他版本平行，不在被替換的目錄裡）→ smoke（HTML 可解析、九段都在、所有 `src/href` 相對且檔案存在）→ 切換指標：建暫時 symlink `current.tmp-<pid>` 指向新版本目錄，再 `rename(current.tmp, current)`（symlink 的 rename 是單一原子系統呼叫；`current` 從頭到尾可讀，不存在缺頁窗口）→ 保留前一版本目錄一代、刪更舊的與殘留候選。URL 固定 `/<date>/<job>/current/index.html`（python `http.server` 跟隨 symlink）。rollback = 把 `current` 用同一招指回前一版本。首次發佈：無 `current` 則同樣經 tmp→rename 建立。失敗：smoke 不過或切換前中斷 → `current` 仍指舊版、候選目錄留到下次發佈清掉、stderr 一行。專案 `index.html` 用同樣的 `v-*/`＋`current` 做法，發佈時先 `flock` **project 級** `<live-base>/review/<project_key>.index.lock`（與 runs writer lock 不同一把；手動跑 renderer 也要拿），index 只連 `…/<job>/current/`。Windows 無 symlink 不在本 plan 支援範圍。
- 觸發：watcher 的 `--render` 在 (a) 新 manifest、(b) `.exit` 落地、(c) `receipt-<phase>.json` 出現或 mtime 變、(d) `task_status_receipt` 變 時 debounce 5 s 後重發佈；手動 `render-review-page.js` 同一路徑。
- bundle（A05／D1）：compare-record 引用的圖以 `fs.copyFileSync` 複製進 `<job>/assets/<sha256 前 12>.<ext>`，頁面只用相對 URL；原圖缺 → 圖位顯示「asset missing · sha256 …」不是破圖；served root 是 durable review 存放處，預設保留 90 天（`render-review-page.js --reap --days`），git 的 evidence 目錄只收 `compare-record.json`＋≤ 200 KB 預覽圖（預覽由專案產，renderer 不做影像）。
- compare-record（`schema: compare-record/1`）：`id, scene, viewport | camera, renderer | browser, fixture, capture_method`（如 `page.screenshot`、`__rw3d_webgpu.capture`）、`before {commit, dirty, path, sha256, taken_at}`, `after {…}`, `metrics[{name, kind（如 luma_roi）, before, after, delta, unit}]`, `images {before, after, overlay?}`, `image_review {by, at, notes[]}`（審圖席）、`observer_note {text, by}`；**沒有 verdict 欄**。
- 驗收：`render-review-page.test.sh`：fixture → HTML 九段；索引兩軸計數；相對路徑；固定時計同輸入 byte-identical；grep 不到 manifest 自由文字欄；三情境：首次發佈 → `current` 建立；第二次更新 → `current` 指新版、舊版仍在；在 smoke 與切換之間注入失敗 → `current` 仍指舊版、無懸空 symlink、索引未變；兩個 job 同時發佈 → index 鎖序列化、兩列都在；真跑：開頁後 run 結束／receipt 到達，refresh 看到新內容（KR1）。版型由實作者先自截（390px 用 viewport 模擬、LAN 實機由 owner 看）。
- 負對照：`rc=0` 無 receipt → 執行軸 `EXITED`、驗收軸 `PENDING`，絕無 `ACCEPTED`；錯 root 的 PASS receipt 不出現；舊 SHA 的 PASS 標「舊候選」；review PASS 但 task rejected → 結論句是 rejected；accepted 但 `can_close=false` → 標「未收尾」；compare-record `dirty: true` → `UNVERIFIED` chip；兩 job 同時 render 索引不漏列。

**P1c mod `live`（L）**
- `register.ts`：`session.start` → `$.clock.every(10000)`：讀 `<live-base>/runs/<project_key>--<root_run_id>.json`（scope 由 `~/.autopilot/session-mode/<sid>.json` 的 `repo_root`＋`AUTOPILOT_ROOT_RUN_ID` 推；無 root → 讀 `runs/<project_key>.json`）；S2 退路讀同 scope 的 SSD 檔 `live/runs.<scope_key>.json`；讀到的 `envelope.scope` 不等於自己要的 → 視同缺檔；兩個檔都沒有或 `published_at` 超過 `valid_for_s`（180 s）→ band `stale`／`unavailable · run: autopilot status runs --watch --project <key>`。
- band：`running N · oldest HH:MM · stalled K · last rc <n|unknown> · $<session_usd> / host $<today> · ctx <pct>%`（cost 讀 `~/.claude/metrics/costs.jsonl` 依 `session` 與日期加總、context 讀 `<live-base>/context/<sid>.json` `used_percentage` [V-file live-state-dir]；各帶 as_of；缺 → `—`；按 sid 取，不借用他 session）（A09）。
- pane（只在 `e.viewport.isFullscreen` 且 ≥ 144 欄自動開）：派工表＋gate 表＋`Link` 到 review 頁（`http://localhost:<port>/<date>/<job>/`）；desktop 同內容，樹無 `Image`；`claude -p` 不畫。toast：執行軸或驗收軸變化各一則。
- 驗收：`mods/live/live.test.ts` 迴圈 `['terminal','desktop']`：mount band 餵 fixture envelope；真跑 `/l5`（KR1）。
- 負對照：`grep -r "prompt.submit\|asUser\|process.spawn\|process.run" mods/` 空；100 欄不開 pane；desktop 樹無 `Image`；envelope 過期 → `stale`；JSON 壞 → `unreadable` 不 throw；兩 session 同 repo 各自 band 顯示各自 sid 的 cost／ctx；舊 envelope 不因 mod 重讀而變 fresh（fresh 只看 `published_at`）。

**P1d 包裝、閘門、版本（S，一個 commit）**
- 順序：`check-hook-inventory.js` 認得 `modules`（印 `mods: 1`，`--check` 獨立 tier）→ codex hook baseline 比對忽略 `modules` → `sync-opencode-plugin.sh` 排除 `mods/` → `hooks/hooks.json` 加鍵 → `sync-version.js --version 2.37.0 --hook-count 33` → CLAUDE.md semver 表加列 → plugin.json description → CHANGELOG → INDEX。
- 驗收：`scripts/sync-all.sh` 全綠；`grep -r mods platforms/codex/plugin platforms/opencode/plugin` 空；`preflight-release.sh` 過。負對照：`modules` 指到不存在的檔 → `claude plugin validate` 失敗。

### P2 hook 延遲先量（S）— 只量不搬
- 儀器（A08）：依 S6 決定沿用或新寫 `scripts/benchmark-hook-latency.js`（detached checkout、N = 30、固定 20 個 tool call 的 `claude -p` 工作負載、`--debug` 時戳取**每個 hook 區間**）。三臂：enabled（現狀）、positive-control（同 checkout 多掛一個 `sleep 0.2` 的 marker hook）、zero（配置後用 `--debug` 的 hook 行數確認實際執行 hook 數 = 0）。
- 輸出 `.autopilot/evidence/hook-latency-baseline.json`：`{commit, workload_sha, samples, arms{enabled, positive_control, zero} × per_event{p50_ms, p95_ms, hook_count, spawns}}`。
- 判準：儀器有效 ⇔ positive − zero 的 p95 ≥ 180 ms；有效後，enabled − zero 的 p95 每 call ≥ 150 ms 且 spawns ≥ 5 → 開「guard port」plan；否則不搬並結案。**enabled ≈ zero 是合法結論，不是儀器壞**。
- 負對照：zero 臂仍量到 hook 行 → 拒絕出結論；positive 量不到 → 拒絕出結論。

### P3 事件核心＋閒置（L）
- `scripts/wake-events.js --once|--watch`、`lib/wake-policy.js`（pure）、`lib/wake-sinks.js`（只 `notify`）、`lib/wake-template.js`：wake design §1.2 事件檔 `autopilot.wake-event/1`（`facts` 只允許 enum／id／數字）。來源：manifest 終態、`.exit`、review receipt、`git ls-remote` pushed、cost／context 門檻、`liveness.stall`（report-only）。
- 閒置兩種分欄、都不推論（A07）：
  - 觀察 `hooks/idle-observe.js`：classic `Stop` 的 `background_tasks` 與 `session_crons` 皆 `[]` [V-file types Stop input] → `idle/<repo_key>/<sid>.observed.json {observed: bool, source: 'stop_hook', observed_at}`；只代表「這個 session 現在沒背景工作」。
  - 宣告 `autopilot status declare-idle --reason nothing_left|blocked_on_owner|budget [--root <id>] [--note ≤200] | --clear`：`idle/<repo_key>/<sid>.declared.json {schema:'autopilot.idle-declaration/1', repo_identity, root_run_id|null, session_id（CLAUDE_CODE_SESSION_ID，缺則拒絕並要求 --session）, reason, declared_at, superseded_by: null}`。
  - 解除：watcher 看到該 `repo_identity` 新 manifest → 寫 `superseded_by: <run_id>`；`session-mode.js set`／`retire` → `superseded_by: 'session-mode:<level|retire>'`；`--clear` 手動。
  - project 層聚合（N02；由 watcher 寫進 `progress.json` 的 `idle`，每個輸入都列在 `idle.inputs` 供重推）：`idle.declarations[]` = 該 project 所有未 supersede 的宣告（各帶 session、root、reason）；`idle.live_runs = {confirmed_live, exited, unknown}`（`unknown` = 從未探測或 `alive: null` 的 run）；`idle.state` 取值與優先序：`blocked`（存在任一未 supersede 的 `blocked_on_owner` 或 `budget` 宣告，**阻塞宣告永遠壓過 `nothing_left`**；`idle.reason` 取阻塞的那個，兩種阻塞並存取 `blocked_on_owner`）＞ `active`（`confirmed_live > 0`）＞ `unknown`（`unknown > 0`，或 runs envelope 過期）＞ `idle`（全部宣告都是 `nothing_left`、至少一則的 root 等於當前執行根或 project 無 root、`confirmed_live = 0` 且 `unknown = 0` 且 envelope fresh）＞ `none`（無宣告）。「沒有 live run」只能由 `confirmed_live = 0 且 unknown = 0` 成立；confirmed 計數為零但有未探測 run 是 `unknown`，不是 idle。
- mod：事件 → toast／band 一列；`wake.mode` 讀 `~/.autopilot/config.json`，預設 `notify`；`self`／`route` 本 plan 回 `not_enabled_in_this_release`。
- 驗收：wake design P1 (a)–(f)；`declare-idle.test.sh`：宣告 → 新 manifest → `superseded_by` 填上；缺 session id → exit 2；三環境 `--once` 同事件行（KR4）。
- 負對照：manifest `error` 含 `ignore previous instructions` → facts／band 無此字串；喚醒 turn 的事件不再產事件；budget 檔壞 → 等同 `notify`；`nothing_left + blocked_on_owner` → `state: blocked`；`nothing_left + budget` → `state: blocked, reason: budget`；`nothing_left + 一個未探測 run` → `state: unknown`；`nothing_left` 單獨且 `confirmed_live = 0, unknown = 0` → `state: idle`；另一 session 仍有 confirmed live run → `active`；舊 session 重開不復活舊宣告；envelope 過期 → `unknown`。

### P4 `work-round` 投影、`progress/1`、重排器（L）
- `autopilot status work-round --root <id> [--json]`（`--branch` 只是 selector：多個 root 時列候選並 exit 2，不猜）：合成 §2.7 的實體；`phases` 只來自 `controller_progress_receipt`（凍結分母 [V-file controller-execution.js L451–499]）與 run-ledger stage rows；README 表另放 `planned[]` display-only；percent 分母未凍結 → null。
- `--projection progress --out <repo>/.autopilot/progress.json`：cockpit study §6 欄位＋補 `idle {declared, reason, declared_by[], since, inputs}`、`run.heartbeat_at`；三個時間 `fact_at / observed_at / published_at`；**emit-on-change ＋ heartbeat**（R-A06：只要 project watcher 活著就每 120 s 重發，**不分有無 live run、idle 或 blocked**，只動 `published_at`；`valid_for_s: 300` 留 2.5 倍餘裕；stale 只在 producer 死後）；里程碑匯出 `docs/plans/evidence/<date>-<job>/work-round.json` 是靜態快照：`snapshot: true, valid_for_s: null`，reader 不對它判 stale。
- `scripts/portfolio-replan.js`：讀 `~/projects/*/.autopilot/progress.json`，只對 `idle.state == 'idle'`（N02 聚合後）的專案跑，`blocked`／`unknown`／`active`／`none` 一律跳過並在輸出列出跳過原因；輸出提案 JSON；**不派工、不寫 BACKLOG、不送 fleet**。
- 驗收：`work-round.test.sh` fixture 投影過 schema；缺來源 fixture → 對應欄 `null`、有效零 fixture → `0`（A11）；KR5 的三個斷言；重排器測試用假 `child_process` 與 PATH 上的假 `fleet`／`dispatch-*` 記錄 argv，斷言零呼叫（grep 只當輔助）。
- 負對照：同 deliverable 兩 attempts 分母不變；Mission 與 ICC id 不同時兩欄並列；README 改標題後 execution id／分母／歸屬不變；`blocked`／`unknown` 專案不進重排且輸出寫明原因；fake clock：idle 專案而 watcher 活著推進 600 s → `progress.json` fresh；watcher 停 → 300 s 後 stale；缺 receipt → `results: []` 且 `round.status.source='manifest_only'`。

## 5. Test / validation
- 腳本閘：各 `hooks/tests/*.test.sh`；`claude plugin test mods/live`；`sync-all.sh`；`validate-json-schema.js`；grep 閘（`prompt.submit`、`asUser`、`process.spawn`）。
- 真跑（evidence）：P1 `/l5` 一回合＋band 時戳＋四個觸發各一次 refresh 截圖；P3 三環境 `--once`；P4 一次 managed campaign 的投影與 `progress.json` heartbeat 紀錄。
- human-gated：owner 在 LAN 實機看頁面版型一次；D1–D4 裁決。
- 不算證據：綠燈 suite 沒真跑派工、mod 在 `claude -p` 的沉默、`State.summary`、「腳本存在」、peer 自述（revival.3d 的系統未經本次核驗）。

## 6. Risks + inversion
| 失敗方式 | 緩解 |
|---|---|
| mods API（early access）改名 | `references/mods.md` 釘版本；mod 失效只影響面板，腳本／頁面／投影不依賴 mod |
| 面板或頁面成為第二個 verdict 來源 | 兩軸規則；結論句只抄 task receipt；負對照 `rc=0` 無 ACCEPTED |
| 多 session／多 root 互相覆蓋 live 檔或 index | project 級唯一 writer＋依 scope 分檔＋reader 核對 `envelope.scope`；index 另一把 project 鎖；mod 只讀；`writer_busy` 退出 |
| watcher 死了沒人重起 | 三個退出條件寫死；crash 由 OS 釋放 lock；band 印重起指令；下一次 `session-mode set` 自動重起 |
| 發佈切換做不到原子 | 版本目錄＋`current` symlink 的 tmp→rename；rollback 同招；三情境測試 |
| 第 9 個 run 永遠沒探測 | 有界輪轉＋`probe_age_s`；未探測不算 running |
| JSON 更新但頁面不動 | watcher `--render` 四觸發＋debounce；smoke→原子 rename→`.prev` |
| 資產搬走頁面破圖 | bundle 複製進 `<job>/assets/`；缺則顯示 missing＋sha |
| 有效期 vs 心跳間隔 | runs 60 s／180 s、progress 120 s／300 s，皆 ≥ 2.5 倍餘裕；idle／blocked 也心跳；stale 只在 producer 死後 |
| 宣告閒置後忙碌或被阻塞的專案被重排 | supersede 規則＋阻塞宣告壓過 `nothing_left`＋`unknown` 不算無工作＋inputs 可重推 |
| P2 把低開銷判成儀器壞 | 正對照／零臂取代「disabled 必須顯著低」 |
| served root 列目錄、明文 HTTP | 預設 127.0.0.1；root 不含 checkout；風險寫進 references |
| `hooks.json` 加 `modules` 弄壞鏡像／inventory | P1d 先改閘再加鍵；S1=no 走 A10 處置 |

## 7. Out of scope（只留介面契約）
- radar（跨專案彙整、歷史、gantt 時間軸、排程、quota）：介面 = `<repo>/.autopilot/progress.json`（`autopilot.progress/1`，含 heartbeat）＋ collector plugin；autopilot 不送訊息。
- gantt／timeline render：資料已在 `phases[]` 時戳與 manifest 樹；revival.3d 的規則（規劃／實際分開、只吃核證快照、每階段刷新）已吸收進 §2.5，但畫圖不在本 plan。
- 各專案截圖工具、像素 diff、overlay、預覽合成圖：各專案產，只要寫出 `compare-record/1`。
- wake-self／wake-remote 喚醒邏輯；guard 搬 function hook；http.server auth／TLS；Artifact 發佈功能（D2 只決定預設，功能另案；若日後發佈，evidence 目錄的 `work-round.json` 記 `renders: [url]`）。

## 8. Open questions（owner 才能答；附預設）
| # | 問題 | 建議預設 | 替代 | 為什麼 |
|---|---|---|---|---|
| D1 | 里程碑匯出的圖放哪、留多久 | 原圖與 bundle 留 `~/.autopilot/review/<project_key>/`（durable，預設 90 天後才 reap）；git 只收 `compare-record.json`＋≤ 200 KB 預覽 | 全進 git（上限或 LFS） | 圖量大（8460 一回合 135 張）；sha256 可比對但不能重建 bytes，所以 served root 要當 durable 存放處 |
| D2 | review 頁預設公開發佈？ | 預設只有 localhost；LAN bind 是文件化選項；Artifact 不在本 plan | 預設發 Artifact | 頁含內部路徑與 commit；owner 現行全是 LAN http.server；手機看要 LAN bind，127.0.0.1 看不到 |
| D3 | 回合邊界 | 一個 job = 一個執行根 `root_run_id`；campaign 兩 id 並列顯示、不當同義詞；無 root 的 dev-flow 回合 `unbound`，要有 job 就在 `session-mode.js set` 配 `AUTOPILOT_ROOT_RUN_ID` | dev-flow 每 phase 一 job | astra A01；`branch@start-sha` 會把同起點兩次執行合併 |
| D4 | S1 = no 時要不要同 repo 第二個 plugin | 不要；classic 完整、mod `unavailable` | 第二 plugin（要實測一次安裝） | owner 要一次安裝；資料夾同 repo ≠ 同 plugin |

## Review log
- R0 2026-10-03 fable 起草（SHA256 `6f43308d…`）；未註冊。
- astra R0 advisory review（SHA256 `4a46589b…`，repo HEAD `9ebea928`）處置：
  - A01 🟠 **接受**：新增 §2.7 關聯表；§2.5 身分條改寫；D3 改執行根；`branch@start-sha` 移除；README 表 display-only；P4 `--branch` 只當 selector。
  - A02 🟠 **接受**：P1b 移除 `--results`；驗收軸只走 `autopilot status task --root-run-id`；review receipt 綁 candidate 比對、舊候選／衝突明示；負對照六條全收。
  - A03 🟠 **接受**：manifest 加 `repo_identity`（三 dispatcher additive）；scope_key＋flock 單一 writer；有界輪轉 enrich＋`probe_age_s`；`unscoped` 不入專案。
  - A04 🟠 **接受**：mod 不起程序；watcher 由 `session-mode.js set` 起（lock 保證單一）；S2／S5 重寫成資料供應路徑與生命週期實測。
  - A05 🟠 **接受**：watcher `--render` 四觸發＋debounce；候選目錄→smoke→原子 rename→`.prev`；bundle 複製資產；90 天保留；失敗保舊頁。
  - A06 🟠 **接受**：`fact_at/observed_at/published_at` 三時間；`runs-live/1` envelope；heartbeat；KR5 改為固定時計 canonical payload 比對；`runs --json` 陣列形狀不變。
  - A07 🟠 **接受**：宣告帶 repo／root／session；supersede 三條規則；`idle` 欄進 progress（含 inputs）；觀察與宣告分欄；重排只吃 `nothing_left && live=0`。
  - A08 🟠 **接受**：三臂（enabled／positive-control／zero）；儀器有效判準改為正對照量得到；低開銷是合法結論。
  - A09 🟠 **接受**：P1c band 加 session cost／host today／context %，來源與 as_of 釘清；KR1 補。
  - A10 🟡 **接受**：S1=no 退路改為 classic 完整＋mod unavailable；第二 plugin 列為 D4。
  - A11 🟡 **接受**：null／0 用 fixture 斷言；重排器用假 `child_process`／PATH 假 binary 記 argv；grep 降為輔助。
  - A12 🟡 **接受**：兩軸 chip 映射表；索引兩軸分列；null 規則限新投影欄。
  - Spike 取捨：S3／S4 降探索；S2＋S5 擴成前置；S1 負對照不綁字串；S6 保留。D1／D2／D3 依建議改寫（D2 不再承諾 `--publish-artifact`）。
  - 晚到問卷（revival.3d／stranity-board／hangar [peer]）：§0「沒人有 gantt」改為 10/11；owner 硬性要求進 §2.5；發佈順序採 revival.3d 的 候選目錄→smoke→原子 mv→`.prev`；compare-record 加 `capture_method`、`metrics[].kind`、`image_review`。
- astra R1 確認（SHA256 `4e35c87a…`）：A01／A02／A08／A09／A10／A11／A12 到位，不重開。R2 處置（只動五處、不新增 phase）：
  - R-A03 🟠 **接受**：writer 粒度改為 project（一支 watcher 產全部 scope 檔），live 與 SSD 退路皆依 scope 分檔、reader 核對 `envelope.scope`；index 發佈另加 project 級 `index.lock`，手動 renderer 也拿；補「同 repo 兩 root 並行」測試，保留同 project `writer_busy` 測試。
  - R-A04 🟠 **接受**：存活單位 = project；退出條件三個（`--stop`、`--idle-exit` 需無 live、無 unknown、無未過期 session-mode marker、啟動失敗）；crash 由 OS 釋放 lock，恢復走手動指令或下一次 `set`，不加 service manager；S5 加 (b) 真實啟動路徑測試；負對照補啟動即退出、writer 死亡、兩 reader 剩一、最後 reader 離開。
  - R-A06 🟠 **接受**：runs heartbeat 60 s／`valid_for_s` 180 s；progress heartbeat 120 s／300 s 且不分 live／idle／blocked；里程碑快照 `snapshot: true, valid_for_s: null` 不判 stale；fake clock 三案（健康 idle observer、producer 停、心跳晚 30 s）；發佈時間不改 `observed_at`。
  - N01 🟠 **接受**：候選改為與版本平行的 `v-<ts>/` 目錄，切換用 `current` symlink 的 tmp→rename（單一原子系統呼叫，無缺頁窗口）；rollback 同招；三情境測試；URL 改 `/<date>/<job>/current/index.html`；index 同做法。
  - N02 🟠 **接受**：project 層 `idle.state` 五值與優先序（阻塞宣告壓過 `nothing_left`；`unknown` run 不算無工作；envelope 過期 → unknown）；重排只吃 `idle.state == idle`；補四個混合宣告負對照。
- 待：astra 確認 R2 五處 → depth-0 落地註冊 → `plan-review-manifest` → 異家 plan review G1（最多 G2）。
