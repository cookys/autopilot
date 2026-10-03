# Plan — Mods 進 autopilot 本體：看得見的派工、owner review 網頁、事件核心、`autopilot.progress/1` 快照
> Status: R4 — FROZEN 2026-10-03 (G1+G2 CONDITIONAL; depth-0 accepted both G2 blockers and verified the bounded repair: per-project `runs/paths/<project_key>.json`, CLI-written `$HOME/.autopilot/live-pointer.json` read via `$.env.get("HOME")`, S2 spike + fallback) / Owner: cookys / Branch: `feat/mods-visible-dispatch`（未建）/ Frame: autopilot 這一半；radar（跨專案）另案
> 日期 2026-10-03。R0 SHA256 `6f43308d…`；astra R0 審查 `4a46589b…`（9 🟠 3 🟡）；R1 SHA256 `e5192f1e…`；astra R1 確認 `4e35c87a…`（7 到位、5 部分到位、新 N01／N02）。R2 只動 R-A03／R-A04／R-A06／N01／N02 五處。R3 處理 G1：3 條 blocking＋9 條 non-blocking；引用改為「檔案:符號」。R4 只處理 G2：2 條 blocking（R5 `paths` 跨專案互蓋、R4 mod 找路徑的機制）＋ 6 條便宜 non-blocking，不重開已處置項目。證據標記：[V-file] 讀檔、[V-run] 本機跑過、[peer] 機隊自述未獨立查證、[SPIKE] 未驗證。
> 落地程序：複製到 `docs/plans/2026-10-03-mods-visible-dispatch.md` → `node scripts/check-plan-graduation.js --register-template 2026-10-03-mods-visible-dispatch` → 列貼進 `docs/projects/INDEX.md`（Version `active`）→ 寫 `plan-review-manifest` → 才能送 `dispatch-plan-review.js`。

## 0. Context / thesis
- owner 已決：mods 放 autopilot 本體；terminal 優先、desktop Code tab 要優雅降級；wake-self 是開關、預設只通知、閒置才喚、低優先；第一個 mod = MINOR（plugin.json 現為 2.36.114 → 2.37.0）；跨專案 cockpit／gantt／排程／quota 不是 autopilot，autopilot 只發佈 `autopilot.progress/1`；「dom-depth-0」= 只在某 depth-0 宣告「沒事可跑」時才跑的 portfolio 重排器。
- 輸入：四份研究（`docs/plans/research/2026-10-03-*.md`、owner 七頁 review 調查）、fable 提案、astra R0 審查、機隊問卷 11 份：**10 個專案沒有 gantt、沒有派工儀表板；revival.3d 自述有一套在用的靜態 gantt／status 頁（`scripts/reports/experience-audit/`，`execution-status.json` schemaVersion 1 → `build.mjs` → 候選目錄 smoke → 原子 mv、舊版 `.prev`、LAN http.server）[peer]**。owner 對它的硬性要求直接寫進 §2.5。
- 論點：**一個生產者、三個讀者。** 生產者是既有 `autopilot status` CLI 的投影（只合成 manifest／ledger／receipt／git 的事實，不判定）；讀者是 mod 面板、腳本產生並自動重發佈的靜態 review 頁、之後的 radar。live 狀態落 tmpfs，里程碑才匯出；頁面照 owner 既有版型。

## 1. Problem
owner 看不到派工在跑什麼、跑多久、最後結果，只能問或等通知；每回合的 project／phase／result／視覺比對散在 log、receipt、evidence 目錄，沒有一頁可 review（owner 原話「驗收給比較頁，不要用問的」）；fleet 看不到專案層的閒置／需要 owner（`State.summary` 全機隊看不到）。

## 2. OKR / KRs
O：owner 不用問「怎麼這麼慢」就知道誰在跑、跑多久、最後 rc；每回合一頁可 review 且每階段自動刷新；radar 有快照可吃。
- KR1（P1）：真跑一次 `/l5`，band 在 ≤ 20 s 內（watcher 10 s ＋ mod 5 s ＋ 發佈）顯示 live run 數、最老 elapsed、stalled、session cost、context %；派出／`.exit` 落地／review receipt／task receipt 四個事件各自在 ≤ 30 s 內觸發頁面重發佈（refresh 看到新內容）。
- KR2（P1）：§4 P1 的負對照全綠；`grep -r "prompt.submit\|asUser\|process.spawn" mods/` 空。
- KR3（P2）：classic hook 每次 hook 區間的 p50／p95 有基線 JSON；正對照（已知 200 ms 延遲）量得到、負對照（hook 數 = 0）允許差近零。
- KR4（P3）：事件核心 `--once` 在 CC-有-mod、CC-無-mod、Codex 三種環境印同一組事件行；預設設定下 `$.prompt.submit` 呼叫數 = 0（mock 計數）；宣告 `nothing_left` 後新 run 一開始就被標 `superseded`。
- KR5（P4）：固定時計、同輸入重播兩次，`progress.json` 去掉 freshness envelope 後的 canonical payload byte-identical；真實 heartbeat 下 `published_at` 單調遞增而 payload 不變；重排器在 fake `child_process`／PATH 假 `fleet` 下零呼叫。

## 2.5 Global Constraints (copied verbatim into every dispatch)
- Node ≥ 20.10，只用 built-ins；**git ≥ 2.31**（`rev-parse --path-format=absolute`，`repoIdentity()` 與 shell 版共同依賴；更舊的 git 以具名失敗回報，見 P1a）；mod 以 TS 放 `mods/`，CC 專屬；mod 沙箱無 Node，不得 `require` repo lib；mod 只讀兩個 env 名（`$.env.get("HOME")`、`$.env.get("XDG_RUNTIME_DIR")`，字面名稱、`claude plugin validate` 會列出 [V-file types `env.get`]），其餘路徑一律來自 CLI 寫的 pointer（§2.8）；P1 的 mod 只讀檔，不起程序（`$.process` 是 CLI-only 且 spawn 的子程序隨迴圈／reload 死亡 [V-file types process]）。
- 身分只用既有 key，照 §2.7 的關聯表：project = `repo_identity`（`git-common-dir:<realpath(git-common-dir)>`，`src/status/task-runtime.js:repoIdentity()`，已 export [V-file]）；**`project_key` = `sha256(repo_identity)` 前 16 個 hex**，只由 CLI 算（`src/status/project-key.js:projectKey()`），寫進 envelope、session-mode marker 與 `runs/paths/<project_key>.json`，mod 只讀、永不自己推導（§2.8）；執行根 = `root_run_id`；工作單位 = Work Order `root_run_id + graph_node + attempt`（`src/engine/controller-execution.js:canonicalWorkOrder` 的身分檢查 [V-file]）；campaign 兩個 namespace `mission_campaign_id` / `icc_campaign_id` 永不合併（`task-runtime.js:resolveCampaignBinding` [V-file]）。時間窗、branch、名稱只能當顯示過濾並標示為過濾，絕不當身分；沒有執行根的回合顯示 `unbound`，不猜。
- 兩條狀態軸永不混：**執行軸** `running | exited | unknown`（來源 enum 原樣）；**驗收軸** `accepted | rejected | unknown`（只來自 `autopilot status task --root-run-id` 的 `task_status_receipt`：`src/status/cli.js` 的 `sub === 'task'` 分支＋`collectTask`，`schemas/task-status.schema.json` 的 `acceptance_verdict` enum [V-file]）。review receipt 只顯示為該 gate 的結果；投影合成事實，不判定轉換、不產生 verdict、不提升層級。
- 新投影欄位 unknown 一律 `null`、絕不填 0；既有來源的 `'unknown'` enum 原樣保留。每個 datum 帶 `source`、`fact_at`（來源事件時間）、`observed_at`（生產者最後重查時間）；快照另帶 `published_at`。
- 實際進度（%、完成／未完成數）只來自 depth-0 核證過的 receipt（`controller_progress_receipt` 凍結分母、`task_status_receipt`），不來自 process monitor；派工表是 telemetry，頁面上必須標「執行狀態，不是進度」。
- 頁面首屏固定：一句結論＋是否需要決定 → 總進度 %（分母未凍結則顯示「分母未凍結 · n done」）、完成／未完成數、每個 deliverable 的 % → 狀態計數（兩軸分列）。「規劃」與「實際」分開兩段畫。
- live 投影寫 `scripts/lib/live-state-dir.js` 解析的 tmpfs base（本機 `/run/user/1000/autopilot` [V-run]）；**每個 project 一支 watcher 當唯一 writer**（由 `flock(1)` 包住的程序持 `runs/<project_key>.lock`，前提與退路見 P1a「鎖的前提」），它產出所有 scope 檔、`progress.json` 與 heartbeat；project index 發佈另有一把鎖 `review/<project_key>.index.lock`，手動 renderer 也要拿；durable 匯出只在里程碑（phase 結束、回合結束、`declare-idle`），落 `docs/plans/evidence/<date>-<job>/`。
- 頁面只由 `scripts/render-review-page.js` 從 JSON 產生，不手寫、數字不重打；served root 預設 `~/.autopilot/review/<project_key>/`，不從 checkout 提供；發佈順序 候選目錄 → smoke → 原子 rename → 舊版 `.prev`；`python3 -m http.server --bind 127.0.0.1 <port>`。
- 給 owner 看的圖，交付前實作者先自己截圖看過；比對頁的每張圖先派一個獨立審圖席（model: sonnet）逐張看過並留紀錄（revival.3d 教訓：leaf 把全黑畫面判 ACCEPT）；審圖席是程序，不是 gate。
- severity 只用 🔴 Critical／🟠 Major／🟡 Minor／🔵 Suggestion；ADR-0001：不加 hash chain／attestation，頁面只列可重推的證據（路徑、commit、sha256）。
- P1–P2 任何程式路徑不得出現 `$.prompt.submit`／`asUser`（grep 閘）；wake 預設 `notify`；`mods/` 不進 codex／opencode 鏡像；mod 不寫 repo 檔。
- 本 plan 不做：像素 diff、各專案截圖工具、gantt 時間軸 render、跨專案排程、quota、auth／TLS、guard 搬 function hook、Artifact 發佈功能。

## 2.6 Change-policy decisions
- **Compatibility impact**: `published-compatible` — `autopilot status runs --json` 陣列形狀不變、只加欄；`--watch --out` 的 envelope 是新契約；三個 dispatcher 的 manifest 加 additive 欄 `repo_identity`（舊 manifest 缺欄 → `project: null`，顯示 `unscoped`）；新子命令 `work-round`、`declare-idle`；`hooks/hooks.json` 加頂層 `modules`（`scripts/check-hook-inventory.js:stemsFromHookBlock` 只走 `hooksJson.hooks` [V-file]）；`progress/1`、`compare-record/1`、`runs-live/1` 皆 additive。
- **Dependency decision**: `platform/stdlib` — Node built-ins、python3 `http.server`、CC mods API（early access，隨 CC 2.1.288）。不引 npm 套件；資產只用 `fs.copyFileSync`，不引影像庫。

## 2.7 身分與關聯表（A01；每個新契約都照這張 join）
| 實體 | canonical key | 來源 | 關聯 |
|---|---|---|---|
| project | `repo_identity` | `task-runtime.js:repoIdentity()`；manifest 新欄；`task_status_receipt.repo_identity` | 身分 |
| project（檔名用） | `project_key` = `sha256(repo_identity)[0:16]` | `src/status/project-key.js:projectKey()`；envelope `scope.project_key`；session-mode marker；`runs/paths/<project_key>.json` | 所有檔名／鎖名的第一段；同一 repo 的所有 worktree 同一 key（common dir 共用） |
| scope（檔名用） | `scope_key` = `project_key`（root 為 null）或 `project_key--root_run_id` | runs-watch | 唯一的第二段寫法；全文不再使用 `repo_key`；`--project` 接受 `project_key`（16 hex）或完整 `repo_identity` 字串，CLI 正規化成 `project_key` |
| 執行根（= job／回合） | `root_run_id` | manifest `root_run_id`；`status task --root-run-id` | 一個 job = 一個 root；campaign 是否對應此 root 由 receipt 的 binding 欄證實，不假設 |
| campaign | `mission_campaign_id`、`icc_campaign_id` | task-runtime | 兩欄並列顯示，永不折成一欄 |
| deliverable | `graph_node`（＝`controller_progress_receipt.deliverable_id`） | controller receipt、graph | 分母來自 `frozen_denominator_digest`；retry 不加分母 |
| attempt／repair／gate | Work Order `root_run_id + graph_node + attempt`、`work_order_id`；review `receipt-<phase>.json` 的 `chain[]{generation, base, head}` | engine、hetero-review-loop | 掛在 deliverable 下 |
| dispatch run | `run_id`（樹：`parent_run_id`／`depth`） | manifest | 掛在 root 下 |
| candidate | `candidate_commit`、`candidate_tree_sha` | `task_status_receipt` | receipt 顯示前必須與 job 的 candidate 相符，否則標「舊候選」 |
| README Phase 表 | 無 key | `docs/projects/<proj>/README.md` | **display-only**，不進分母、不進 percent |
| dev-flow 回合（無 engine） | 無 root → `job_id: null` | — | 顯示 `unbound`；要有 job 就在 `session-mode.js set` 時配 `root_run_id`（`AUTOPILOT_ROOT_RUN_ID`，既有慣例） |

## 2.8 `project_key` 的推導與 mod 的解析（G1 R1）
- 推導只在 CLI：`repo_identity = "git-common-dir:" + realpath(git rev-parse --path-format=absolute --git-common-dir)`；`project_key = sha256(repo_identity).hex[0:16]`。linked worktree 的 `repo_root` 不等於 `repo_identity`，但 common dir 相同 → 同一 `project_key`；這就是不用 `repo_root` 當 key 的原因。
- 寫入三處：(1) `runs-live/1` envelope `scope {project_key, repo_identity, root_run_id|null}`；(2) `scripts/session-mode.js set` 的 marker 新增 `repo_identity`、`project_key`（additive）；(3) watcher 每次 heartbeat 從 `git worktree list --porcelain` 重寫**自己專案那一份** `<live-base>/runs/paths/<project_key>.json`：`{ "<realpath(worktree 根)>": {project_key, repo_identity}, … }`（含主 worktree），在既有 project lock 之下 atomic rename——沒有跨專案共用檔，所以多專案 watcher 並行不會互蓋（G2 R5）；mod 用 `$.fs.list("<live-base>/runs/paths")` 列出全部、逐檔讀（檔數 = 專案數，每檔 < 4 KB）、合併後取最長前綴。
- mod 找路徑的機制（G2 R4）：mod 不自己算 live base（那條鏈在 `live-state-dir.js:resolveLiveDir` 有五層候選與 tmpfs 判定，沙箱無法重現）。**pointer 檔**：`scripts/session-mode.js set` 與 watcher 啟動時都寫 `$HOME/.autopilot/live-pointer.json`（atomic rename）`{schema:"autopilot.live-pointer/1", live_base:"<resolveLiveDir()>", autopilot_home:"<HOME>/.autopilot", written_at}`；mod 用 `$.env.get("HOME")` [V-file] 組出這一個固定位置，之後所有絕對路徑都從 pointer 取。`XDG_RUNTIME_DIR` 只當 pointer 缺席時的提示（band 文字），不用來推路徑。S2 新增兩個問題：terminal／desktop 下 `$.env.get("HOME")` 是否有值；pointer 檔是否可讀。**S2 失敗（HOME 取不到）的退路**：`session-mode.js set` 改在 `$.session.root()` 可達的位置放同一份 pointer，`<repo_root>/.autopilot/live-pointer.json`，**只在** `git check-ignore -q .autopilot/live-pointer.json` 成立時才寫（不弄髒 checkout；autopilot 自己的 repo 要把它加進 `.gitignore`）；mod 讀 `${await $.session.root()}/.autopilot/live-pointer.json`（`session.root()` 是 session 的專案根 [V-file]）。兩個 pointer 都沒有 → band `no pointer · run: autopilot status runs --watch`，其餘功能不受影響（classic 路徑照常）。
- mod 解析 project／root（不跑 git、不算 hash）：(a) `$.session.id()` [V-file types `session.id`] → 讀 `<autopilot_home>/session-mode/<sid>.json` 的 `project_key`、`root_run_id`（marker 由 CLI 寫，含 `expires_at`；`AUTOPILOT_ROOT_RUN_ID` 由 `set` 寫入 marker，mod 不讀它）；(b) 否則 `$.session.cwd()` → `$.fs.stat(cwd, {resolve: true}).realPath` → 在 `<live_base>/runs/paths/*.json` 合併結果找最長前綴；(c) 都沒有 → band `no project · run: autopilot status runs --watch`。
- 測試：`project-key.test.sh`：主 worktree、symlink 路徑、linked worktree 三種 cwd 得到同一 `project_key`；兩個不同 repo 不同 key；`paths/*.json` 合併後最長前綴對子目錄 cwd 正確；marker 缺 `project_key`（舊版）→ 走 (b)；pointer 缺 → `no pointer`；`live-pointer.test.sh`：`set` 寫 pointer 且 `live_base` 等於 `resolveLiveDir()`；check-ignore 不成立時不寫 repo-local pointer。

## 3. File-structure map
| 檔 | 責任 | Phase |
|---|---|---|
| `scripts/lib/repo-identity.sh`（新）＋`scripts/dispatch-hetero.sh`、`dispatch-review.sh`、`dispatch-author.sh` | 一個 shell 函式 `repo_identity_of <dir>`（與 `task-runtime.js:repoIdentity()` 位元相等）；三個 rail source 它寫 manifest `repo_identity`（優先序 `REPO_ROOT`（`--repo-root`）→ `CONSUMING_REPO_ROOT`（cwd 的 git toplevel）→ `null`） | P1a |
| `src/status/project-key.js`（新） | `projectKey(repo_identity)`；被 runs-watch、session-mode、renderer 共用 | P1a |
| `src/status/cli.js` | `runs` 加欄、`--project`／`--root`、`--since`（標示過濾）、round-robin enrich、`--watch --out --render`；新子命令 `declare-idle`、`work-round` | P1a, P3, P4 |
| `src/status/runs-watch.js`（新） | project 級唯一 writer（由 `flock(1)` 包住）、依 scope 分檔的 `runs-live/1` envelope（含 `stall`、`sessions{}` cost 彙總）、`paths.json`、heartbeat（runs 60 s／progress 120 s，不分 live 或 idle）、觸發 render、`--stop`／`--idle-exit`、版本目錄＋`current` 指標切換 | P1a, P1b, P4 |
| `src/status/work-round.js`（新） | `autopilot.work-round/1` 投影＋`--projection progress`＋heartbeat | P4 |
| `scripts/render-review-page.js`（新） | JSON → `/<date>/<job>/index.html`＋專案 `index.html`；bundle 資產；smoke | P1b |
| `scripts/session-mode.js` | marker 加 `repo_identity`、`project_key`、`root_run_id`；`set` 時寫 `$HOME/.autopilot/live-pointer.json`（S2 失敗時另寫 repo-local pointer，需 check-ignore）；`set` 時起 project watcher（`setsid nohup flock -n <lock> node …`，lock 已被持有就不起、印持有者 pid）；`set`／`retire` 時 supersede 閒置宣告 | P1a, P3 |
| `mods/live/{register.ts, band.tsx, pane.tsx, live.test.ts}`（新） | band（runs＋cost＋context）／pane／toast；只讀 | P1c |
| `hooks/hooks.json` | 頂層 `"modules": ["../mods/live/register.ts"]`（S1=yes 時） | P1d |
| `hooks/idle-observe.js`（新，default-on） | classic `Stop` 的 `background_tasks`／`session_crons` 皆空 → 以 `lib/jsonl-store.js` append 一列到 `idle/<project_key>/declarations.jsonl`（hook 是 Node、不在沙箱，用 `project-key.js` 從 cwd 算 key） | P3 |
| `scripts/check-hook-inventory.js`、`sync-codex-plugin-skills.sh`、`sync-opencode-plugin.sh`、`sync-version.js`、`.claude-plugin/plugin.json`、`CLAUDE.md` | 認得 `modules`；鏡像排除 `mods/`；2.37.0；semver 表加「new mod surface → MINOR」 | P1d |
| `schemas/{compare-record, runs-live, idle-declaration, work-round, progress}.schema.json`（新） | 契約 | P1b, P1a, P3, P4 |
| `references/review-page.md`、`references/mods.md`（新） | 頁面契約（版型、URL、兩軸 chip 映射、serve 指令、LAN 風險、審圖席）；mod 包裝與 surface 降級表、spike 結果 | P1b, P0 |
| `scripts/wake-events.js`、`scripts/lib/wake-{policy,sinks,template}.js`（新） | 事件核心，sinks 只有 `notify` | P3 |
| `scripts/benchmark-hook-latency.js`（新；或擴充 `benchmark-hook-multiplexer.js`） | hook 延遲基線＋正負對照 | P2 |
| `scripts/portfolio-replan.js`（新） | 閒置觸發的重排器，只出提案 | P4 |
| `hooks/tests/{repo-identity-parity, manifest-repo-identity, project-key, status-runs-fields, runs-watch, runs-watch-lock, render-review-page, idle-observe, declare-idle, wake-events, work-round, portfolio-replan}.test.sh` | 腳本側測試 | 各 phase |
| `docs/scripts-inventory.md`、`CLAUDE.md` 分組清單、`CHANGELOG.md`、`docs/projects/INDEX.md`、`docs/plans/evidence/2026-10-03-mods-spikes/` | 四處接線＋證據 | 各 phase |

## 4. Phases
依賴：P0 → P1a → P1b → P1c → P1d → （P2 ∥ P3）→ P4。dev-flow size：P0 S、P1a L、P1b L、P1c L、P1d S、P2 S、P3 L、P4 L（每個子 phase 一個 PR、各自可獨立出貨）。

### P0 Spikes（S）— 交付前置 vs 探索分開
| # | 問題 | 怎麼驗 | 性質 |
|---|---|---|---|
| S1 | `hooks/hooks.json` 同時有 `modules` 與 classic hooks，真實載入兩邊都跑？對象是真的 autopilot 套件，不是最小範例 | mod `session.start` 寫一行到 live；同 session 的 classic `Stop` 照常寫 `costs.jsonl` | 前置 |
| S2 | 每個 surface 的**完整資料供應路徑**，覆蓋 P1c 會讀的全部檔：`<live-base>/runs/<scope_key>.json`、`<live-base>/runs/paths/<project_key>.json`、`<live-base>/context/<sid>.json`、`~/.autopilot/session-mode/<sid>.json`、SSD 退路 `~/.autopilot/review/<project_key>/live/runs.<scope_key>.json`（home 目錄可讀？大小？權限？）；`$.session.id()`／`$.session.cwd()`／`$.session.root()`／`$.fs.stat(...,{resolve:true}).realPath` 的值；**`$.env.get("HOME")` 在 terminal 與 desktop 是否有值、`$HOME/.autopilot/live-pointer.json` 是否可讀**（G2 R4，失敗退路見 §2.8）；`$.fs.list("<live_base>/runs/paths")` 可否列目錄；desktop host 的路徑解析是否相同。mod **不讀** `~/.claude/metrics/costs.jsonl`（可能超過 `$.fs.read` 4 MiB 上限），cost 由 watcher 彙總進 envelope | terminal 與 desktop 各讀一次，印長度與 errno | 前置（合併原 S2＋S5 的資料面） |
| S5 | 兩段：(a) mod 生命週期：reload 後 `$.clock.every` 重建、`session.end` 後不殘留；(b) **真實啟動路徑** `session-mode.js set` → detached watcher → envelope 落地（`writer.pid` 等於持鎖程序）→ kill 後 lock 釋放 → 再 `set` 重起 | (a) `claude plugin test` 迴圈 `['terminal','desktop']`＋真 session reload；(b) 用 `AUTOPILOT_LIVE_DIR` fixture 真跑一次 | 前置 |
| S6 | `benchmark-hook-multiplexer.js` 的 registration selector（`scripts/benchmark-hook-multiplexer.js` 讀 `hooks/hooks.json`＋`opt-in-manifest.json` 後 `direct.push` 的挑選段）[V-file] 能否覆蓋全部 classic hooks | 讀程式＋試跑一個非 opt-in hook | 前置（P2） |
| S3 | desktop `Svg` 131072 字元放得下 40 列？ | 量長度 | 探索（本 plan 不畫 timeline） |
| S4 | owner 終端 `Image {file}` | 畫一張 PNG | 探索（P1c 不用 Image，不佔 owner gate） |
- 驗收：每格一行 verdict（yes／no／partial）＋原始輸出，落 `docs/plans/evidence/2026-10-03-mods-spikes/S<n>.md`。
- **S1 = no 的處置**（A10）：classic 功能完整不變、mod 標 `unavailable`；「同 repo 第二個 plugin」是另一個包裝決策（D4，要實測一次安裝），不是自動等價退路。
- 負對照：語法錯的 `register.ts` → 錯誤有紀錄（transcript 或 debug log）且 classic 訊號照常；不綁死 `refused` 字串。

### P1 看得見（L）
**P1a 生產者：manifest 加 scope、`status runs` 補欄、單一 writer watcher（L）**
- 現況 [V-file `src/status/cli.js:collectRuns`]：`--list` ＋ 固定順序前 8 個 live run 的 `--run` enrich（已含 `phase/alive/stall/last_event_age_s`）；`--list`（`scripts/dispatch-status.js` 的 `--list` 分支）不含 `started_epoch/ended_epoch/ledger/stage/final_status`，新欄要直接讀 manifest。
- manifest 加 `repo_identity`（G1 R2）：新 `scripts/lib/repo-identity.sh` 提供 `repo_identity_of <dir>`：`common=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir)`（與 Node 版同一旗標，主 worktree 也拿到絕對路徑）→ `canon=$(cd "$common" && pwd -P)` → 印 `git-common-dir:$canon`；任一步失敗：stderr 一行 `repo-identity: git rev-parse --path-format failed (git <version>; need >= 2.31)`、印空，manifest 寫 `repo_identity: null, repo_identity_source: "git_rev_parse_failed"`（具名失敗，不是默默 null；`--project` 過濾時這些列進 `unscoped`）。三個 rail 都 source 它，取值優先序 `REPO_ROOT`（`--repo-root` 明示）→ `CONSUMING_REPO_ROOT`（cwd 的 `git rev-parse --show-toplevel`）→ `null`，三個 rail 各自把選到的來源寫進 manifest `repo_identity_source`。測試兩支：`repo-identity-parity.test.sh` 用四個 fixture（主 worktree、經 symlink 的路徑、`git worktree add` 的 linked worktree、子目錄 cwd）比對 shell 輸出與 `node -e 'require("./src/status/task-runtime.js").repoIdentity(dir)'` **位元相等**；第五個 fixture 用 PATH 上的假 `git`（拒絕 `--path-format`）斷言 shell 與 Node 同時得到 null、shell 有 stderr 診斷、manifest `repo_identity_source` 為 `git_rev_parse_failed`；首個 P1a PR 先確認三個 rail 的 `write_manifest` test seam 存在，沒有就在同 PR 加；`manifest-repo-identity.test.sh` 用各 rail 的 test seam 跑到 `write_manifest`，斷言三種 role 都寫、`REPO_ROOT` 優先於 `CONSUMING_REPO_ROOT`、舊 manifest 缺欄不炸。
- `runs --json` 每列加：`elapsed_s`、`rc`（`ledger` 非 null 時讀 `<ledger>.results/<run_id>.<stage>.exit`，否則 null）、`final_status`、`project`（`repo_identity`｜null）、`stall`（來自 `--run` 探測的 `stall`，`--stall-secs 180`，純執行 telemetry、report-only；未探測 → null）、`source {manifest, status_probe, exit_file}`、`fact_at`（manifest `started_at`／`ended_at`）、`observed_at`、`probe_age_s`（距上次 `--run` 探測；從未探測 → null 且 `alive: null`）。選擇器：`--project <repo_identity>`（只匹配有欄的 manifest）、`--root <root_run_id>`、`--since <iso>`（輸出頂層 `filter: {since}`，標示為顯示過濾）。
- enrich：`--enrich-cap N`（預設 8）＋**有界輪轉**：每 tick 從上次停點續探，所有 live run 在 `ceil(live/N)` tick 內都被探到一次；未探測列保留上次值與其 `observed_at`，不得顯示為已確認 running。
- watcher `src/status/runs-watch.js`（`autopilot status runs --watch --project <key> --interval 10 [--render <out-root>] [--idle-exit 3600] | --stop`）：**writer 粒度 = project**，一支程序先 `flock -n <live-base>/runs/<project_key>.lock`，拿不到就印持有者 pid、以 `writer_busy` 退出 0（本 session 只讀）。輸出**依 scope 分檔**：`runs/<project_key>.json`（全部）＋每個觀測到的 root 一份 `runs/<project_key>--<root_run_id>.json`；SSD 退路同樣分檔 `~/.autopilot/review/<project_key>/live/runs.<scope_key>.json`。envelope `{schema:"autopilot.runs-live/1", scope:{project_key, repo_identity, root_run_id|null}, published_at, valid_for_s:180, writer:{pid, session_id, started_at}, runs:[…], counts:{confirmed_live, exited, unknown, fresh_bound_s}, sessions:{<sid>:{session_usd, as_of}}, host_today_usd, host_today_as_of}`（**`counts` 由 watcher 算一次、所有消費者只讀它**（G2 R3）：`fresh_bound_s = 2 × interval × ceil(live_candidates / enrich_cap)`；`exited` = `phase === "exited"` 或 `ended_at`／`final_status` 非 null；`confirmed_live` = 其餘列中 `alive === true` 且 `probe_age_s <= fresh_bound_s`；`unknown` = 其餘列；三者加總等於 `runs.length`；cost 由 watcher 從 `~/.claude/metrics/costs.jsonl` 彙總：`session_usd` = 該 `session` 的 `cost_usd` 總和、`host_today_usd` = 今日所有列總和，列欄位見 `hooks/cost-tracker.js` 寫入格式 [V-file]；mod 不碰 costs.jsonl）；同一 tick 在同一把 project lock 下重寫 `runs/paths/<project_key>.json`（只動自己那份）；reader 必須核對 `envelope.scope` 等於自己要的 scope，不符視同缺檔。變更時立刻發佈；無變更每 60 s heartbeat（只動 `published_at`，有效期 180 s = 三倍餘裕；`observed_at` 只在真的重查來源時更新）；atomic rename。
- watcher 生命週期（R-A04，手動恢復，不加 service manager）：**存活單位是 project、而非 session**。退出條件只有三個：(1) `--stop`（核對 lock 持有者 pid 後送 SIGTERM，收到後最後發佈一次 `writer: null, exit_reason: "stopped"`）；(2) `--idle-exit N`（預設 3600 s）：連續 N 秒 envelope `counts.confirmed_live = 0 且 counts.unknown = 0`，**且**該 repo（marker 的 `project_key` 相同）沒有任何未過期的 `~/.autopilot/session-mode/<sid>.json` marker（**未過期** = marker 存在、JSON 可讀、`expires_at > now`；`scripts/session-mode.js` 的 `DEFAULT_TTL_HOURS = 24` [V-file]，`clear`／`retire` 會移除；所以 watcher 最久在最後一個 session 死後 24 h 才自動退出，上界明確、可用 `--stop` 提前）→ 最後發佈 `writer: null, exit_reason: "idle_exit"` 後 exit 0（有活躍 session 就一直心跳，含 idle／blocked 專案）；(3) 啟動失敗（live dir 不可寫、manifest 目錄不存在）→ exit 非 0、stderr 一行、不留 lock（flock 隨 fd 釋放）。crash：lock 由 OS 釋放，下一次 `session-mode.js set` 或手動 `--watch` 重取；reader 離開不影響 writer；第二 session 以 `writer_busy` 退成 reader 後，若 writer 死亡其 band 顯示 `unavailable · run: autopilot status runs --watch --project <key>`，由人或下一次 `set` 重起。日誌 `~/.autopilot/review/<project_key>/live/watcher.log`。
- 鎖的前提與退路（G1 R5）：Node 沒有 flock，所以**鎖由 `flock(1)` 持有**：啟動指令固定為 `setsid nohup flock -n <live-base>/runs/<project_key>.lock node bin/autopilot.js status runs --watch …`；`flock(1)` 開鎖檔、取鎖後 `exec` 成 node，fd 跨 exec 保留，程序死亡（含 crash、SIGKILL）時 kernel 釋放，這是 crash 恢復唯一依據。前提：(a) `flock(1)`（util-linux）在 PATH——`run-ledger.sh` 與 `dispatch-status.js:probeLock` 已依賴它；缺 → watcher 以 `flock_unavailable` 退出 2、band 顯示 unavailable，**不退回純 lockfile**（lockfile 不會在 crash 時釋放，會破壞恢復保證）；(b) 鎖檔在本機檔案系統（tmpfs 或 `~/.autopilot` 的本機磁碟；`live-state-dir.js` 不會給網路路徑）；(c) watcher 用 `child_process.spawn` 起的探測子程序不繼承鎖 fd（libuv 在子程序只保留 stdio 0–2）。「持有者 pid」不是從 flock 查的（flock 沒有查詢介面）：holder 取鎖後自己把 `writer.pid` 寫進 envelope；`--stop` 讀 envelope 的 pid，核對 `/proc/<pid>/cmdline` 含 `status runs --watch` 與同一 `--project <key>` 才送 SIGTERM，pid 不在就只報告；「鎖是否被持有」用 `flock -n <lock> true` 的 exit code 探測（同 `dispatch-status.js` 的作法）。測試 `runs-watch-lock.test.sh`：kill -9 watcher → 1 s 內 `flock -n` 可取；watcher 活著時 spawn 一個長命子程序再 kill watcher → 鎖仍釋放（子程序未繼承）；PATH 無 `flock` → exit 2 且無鎖檔殘留；envelope pid 被改成別的程序 → `--stop` 拒絕。
- 誰起 watcher：`scripts/session-mode.js set`（/l3–/l6 入口）用 `setsid nohup` 起一支（lock 已被持有則不起，印持有者 pid）；dev-flow 無 level 時 depth-0 跑 band／renderer 印出的指令。mod 不起程序（A04）。
- 驗收：`status-runs-fields.test.sh`（fixture manifest 目錄 + `.exit`）五個新欄齊全、`rc` 整數、`--root` 只留該樹、人類輸出不變；`runs-watch.test.sh`：9 個 live fixture 在 2 tick 內全部 `probe_age_s` 非 null；兩個 watcher 同 project 第二個 `writer_busy`（保留）；**同 repo 兩個 root 並行**：兩份 scope 檔與兩份 SSD 退路各自存在且 `envelope.scope` 正確、index 兩個 job 都在、互不覆蓋；**兩個專案的 watcher 並行**（G2 R5）：各自心跳 10 次後 `runs/paths/<A>.json` 與 `runs/paths/<B>.json` 都完整、合併後兩個 realpath 都查得到、互不覆蓋；`counts` 三數加總等於列數、未探測列落在 `unknown`；fake clock：無 live run 但 watcher 活著推進 300 s → `published_at` 更新、payload 不變、reader 判 fresh；heartbeat 排程晚 30 s → 仍 fresh（180 s 餘裕）；停掉 producer → 超過 180 s 判 stale；發佈時間更新不改 `observed_at`；真實啟動路徑（S5b）：`session-mode.js set` → 2 tick 內 envelope 出現且 `writer.pid` 為持鎖程序 → kill → lock 可取 → 再 `set` 重起；`--idle-exit 1` 且無 marker → exit 0 且 `writer: null`；有未過期 marker → 不退出；啟動失敗（manifest 目錄不存在）→ 非 0 且 lock 已釋放。
- 負對照：manifest 無終態而 `--run` 回 `exited` → `rc: null, phase: exited`，不是 running；同 branch 同起點兩個 root 各自成 job；兩 repo 的 manifest 混在同目錄時 `--project` 只取己方、無欄的列進 `unscoped` 不進任何專案；舊 session 殘留 lock（持有者已死）→ `flock -n` 可取得（flock 隨 fd 釋放，不留殘鎖）；兩 reader 剩一個、最後一個 reader 離開 → writer 照常心跳直到 `--idle-exit` 條件成立。

**P1b `scripts/render-review-page.js`＋自動重發佈（L）**
- 輸入：`--runs <runs-live.json>`、`--root <root_run_id>`（有 root 時 renderer 自己呼叫 `autopilot status task --root-run-id <id> --json` 取驗收軸；review receipt 從 manifest `ledger` 旁的 `receipt-<phase>.json` 發現，每份帶 `branch/phase_base_sha/chain[]` 與 job 的 `candidate_commit` 比對）、`--compare <dir>`（compare-record 目錄）、`--job <id>`、`--date`、`--project <key>`、`--out-root ~/.autopilot/review/<project_key>`。**沒有 `--results` 任意路徑清單**（A02）。
- 版型（owner 七頁調查 §3＋revival.3d 硬性要求，順序固定）：① 標題＋`updated <published_at> @ <commit>` ② 一句結論（只抄 `acceptance_verdict`；無 receipt → 固定句「本回合尚無驗收 verdict；下表是執行狀態，不是進度」）＋「知會／需要你決定」 ③ 需決定時：問題、三選項各附後果、「這份裁決不授權的事」 ④ **進度首屏**：總 %（分母凍結才算）、完成／未完成數、每 deliverable %（來源 `controller_progress_receipt`）；「規劃」（graph／README，display-only）與「實際」（receipt）分兩段 ⑤ 證據：compare 並排圖（同 scene 同 viewport、原圖可點、審圖席紀錄連結）、指標表含 delta ⑥ 派工表（標「執行狀態，不是進度」）：run_id、role、runner/model、started、elapsed、phase、rc、final_status、`probe_age_s`、`UNVERIFIED` ⑦ gate 結果表：每份 review receipt 一列（phase、generation、base→head、verdict、匹配狀態）。匹配規則（G1 R3、G2 R1）：join 只有兩個條件——receipt 來自這個 job 的 ledger 目錄（manifest `ledger` 旁的 `receipt-<phase>.json`，root 範圍的 key）**且**其最後一個 finalized `chain[].head` 是 `candidate_commit` 的祖先或相等（renderer 跑 `git merge-base --is-ancestor`；renderer 是 CLI，可跑 git）→ `MATCH`；head 不是祖先 → `舊候選`；**branch 只是顯示欄**：receipt `branch` 與 manifest `branch` 不同時列上加 `branch differs` chip，絕不因此隱藏或降級；**沒有 `task_status_receipt`（回合進行中常態）→ 沒有 candidate 可比，列標 `LIVE GATE · 未綁定候選`，只用 ledger 目錄歸屬篩選，不隱藏、不標舊**；同 phase 兩份 `MATCH` 且 verdict 不同 → 兩列都列、標 `CONFLICT` ⑧ `<details>` 工程細節 ⑨ footer：來源路徑、commit、sha256、「這頁不主張的事」。
- 兩軸 chip 映射（A12，寫進 `references/review-page.md`）：執行軸 `running→RUNNING`、`exited→EXITED`、`unknown→UNKNOWN`；驗收軸 `accepted→ACCEPTED`、`rejected→REJECTED`、`unknown→PENDING`；`can_close=false` 且 accepted → `ACCEPTED · 未收尾`。索引第一行兩軸分列：`執行 RUNNING n · EXITED n · UNKNOWN n ｜ 驗收 ACCEPTED n · REJECTED n · PENDING n`。
- 發佈（A05／N01）：job 目錄是**不可變版本目錄＋原子指標**：`<out-root>/<date>/<job>/v-<published_at 緊湊格式>/`（候選，與其他版本平行，不在被替換的目錄裡）→ smoke（HTML 可解析、九段都在、所有 `src/href` 相對且檔案存在）→ 切換指標：建暫時 symlink `current.tmp-<pid>` 指向新版本目錄，再 `rename(current.tmp, current)`（symlink 的 rename 是單一原子系統呼叫；`current` 從頭到尾可讀，不存在缺頁窗口）→ 保留前一版本目錄一代、刪更舊的與殘留候選。URL 固定 `/<date>/<job>/current/index.html`（python `http.server` 跟隨 symlink）。rollback = 把 `current` 用同一招指回前一版本。首次發佈：無 `current` 則同樣經 tmp→rename 建立。失敗：smoke 不過或切換前中斷 → `current` 仍指舊版、候選目錄留到下次發佈清掉、stderr 一行。**整個切換序列**（job 的 `current` 切換＋index 重產）都在 **project 級** `<live-base>/review/<project_key>.index.lock`（`flock(1)` 包住 renderer 程序，與 runs writer lock 不同一把；watcher 的 `--render` 與手動 renderer 都要拿）之下執行，版本目錄的建置可在鎖外；切換前比較 `published_at`：候選不比 `current` 目標新就放棄切換（單調保證，慢的那個不會蓋掉新的）。資產：`<job>/assets/<sha>.<ext>` 以內容定址、所有版本共用，頁面用 `../assets/<sha>.<ext>`（相對版本目錄，切換前後都解析到同一處）；reaper 只刪「沒有任何保留版本引用」的資產；舊版本目錄保留一代**且**切換後至少 10 分鐘才刪（開著舊頁的瀏覽器下一次 fetch 不會踩到被刪的目錄）。Windows 無 symlink 不在本 plan 支援範圍。
- 觸發：watcher 的 `--render` 在 (a) 新 manifest、(b) `.exit` 落地、(c) `receipt-<phase>.json` 出現或 mtime 變、(d) `task_status_receipt` 變 時 debounce 5 s 後重發佈；手動 `render-review-page.js` 同一路徑。
- bundle（A05／D1）：compare-record 引用的圖以 `fs.copyFileSync` 複製進 `<job>/assets/<sha256 前 12>.<ext>`，頁面只用相對 URL；原圖缺 → 圖位顯示「asset missing · sha256 …」不是破圖；served root 是 durable review 存放處，預設保留 90 天（`render-review-page.js --reap --days`），git 的 evidence 目錄只收 `compare-record.json`＋≤ 200 KB 預覽圖（預覽由專案產，renderer 不做影像）。
- compare-record（`schema: compare-record/1`）：`id, scene, viewport | camera, renderer | browser, fixture, capture_method`（如 `page.screenshot`、`__rw3d_webgpu.capture`）、`before {commit, dirty, path, sha256, taken_at}`, `after {…}`, `metrics[{name, kind（如 luma_roi）, before, after, delta, unit}]`, `images {before, after, overlay?}`, `image_review {by, at, notes[]}`（審圖席）、`observer_note {text, by}`；**沒有 verdict 欄**。
- 驗收：`render-review-page.test.sh`：fixture → HTML 九段；索引兩軸計數；相對路徑；固定時計同輸入 byte-identical；grep 不到 manifest 自由文字欄；三情境：首次發佈 → `current` 建立；第二次更新 → `current` 指新版、舊版仍在；在 smoke 與切換之間注入失敗 → `current` 仍指舊版、無懸空 symlink、索引未變；兩個 job 同時發佈 → index 鎖序列化、兩列都在；真跑：開頁後 run 結束／receipt 到達，refresh 看到新內容（KR1）。版型由實作者先自截（390px 用 viewport 模擬、LAN 實機由 owner 看）。
- 負對照：`rc=0` 無 receipt → 執行軸 `EXITED`、驗收軸 `PENDING`，絕無 `ACCEPTED`；錯 root 的 PASS receipt 不出現；舊 SHA 的 PASS 標「舊候選」；review PASS 但 task rejected → 結論句是 rejected；accepted 但 `can_close=false` → 標「未收尾」；compare-record `dirty: true` → `UNVERIFIED` chip；兩 job 同時 render 索引不漏列。

**P1c mod `live`（L）**
- `register.ts`：`session.start` → `$.clock.every(5000)`（讀檔便宜；watcher 10 s ＋ mod 5 s ＋ 發佈 ≈ 最壞 15–20 s，KR1 定 20 s）：先讀 pointer（§2.8：`$.env.get("HOME")` → `live-pointer.json`；缺 → `no pointer`），再解析 `project_key` 與 `root_run_id`（marker → `paths/*.json` 合併 → none），再讀 `<live_base>/runs/<project_key>--<root_run_id>.json`（無 root → `runs/<project_key>.json`）；S2 退路讀同 scope 的 SSD 檔 `live/runs.<scope_key>.json`；讀到的 `envelope.scope` 不等於自己要的 → 視同缺檔；兩個檔都沒有或 `published_at` 超過 `valid_for_s`（180 s）→ band `stale`／`unavailable · run: autopilot status runs --watch --project <key>`。
- band：`running N · oldest HH:MM · stalled K · last rc <n|unknown> · $<session_usd> / host $<today> · ctx <pct>%`：`N` = envelope `counts.confirmed_live`（不自己算）；`stalled K` = envelope 中 `stall === true` 的列數（P1a 欄位，report-only，band 標 `(telemetry)`）；cost 兩個數直接讀 envelope 的 `sessions[<sid>]` 與 `host_today_usd`（sid 來自 `$.session.id()`）；context 讀 `<live-base>/context/<sid>.json` 的 `context_window.used_percentage`（`scripts/lib/live-state-dir.js:readLive` 的 schema [V-file]）；各帶 as_of；缺 → `—`；按 sid 取，不借用他 session（A09）。
- pane（只在 `e.viewport.isFullscreen` 且 ≥ 144 欄自動開）：派工表＋gate 表＋`Link` 到 review 頁（`http://localhost:<port>/<date>/<job>/`）；desktop 同內容，樹無 `Image`；`claude -p` 不畫。toast：執行軸或驗收軸變化各一則。
- 驗收：`mods/live/live.test.ts` 迴圈 `['terminal','desktop']`：mount band 餵 fixture envelope；真跑 `/l5` 一回合，band 在 ≤ 20 s 內出現（KR1，證據：時間戳截圖）；時間預算寫進 `references/review-page.md`。
- 負對照：`grep -r "prompt.submit\|asUser\|process.spawn\|process.run" mods/` 空；100 欄不開 pane；desktop 樹無 `Image`；envelope 過期 → `stale`；JSON 壞 → `unreadable` 不 throw；兩 session 同 repo 各自 band 顯示各自 sid 的 cost／ctx；舊 envelope 不因 mod 重讀而變 fresh（fresh 只看 `published_at`）。

**P1d 包裝、閘門、版本（S，一個 commit）**
- 順序：`check-hook-inventory.js` 認得 `modules`（印 `mods: 1`，`--check` 獨立 tier）→ codex hook baseline 比對忽略 `modules` → `sync-opencode-plugin.sh` 排除 `mods/` → `hooks/hooks.json` 加鍵 → `sync-version.js --version 2.37.0 --hook-count 32`（P1 不加 classic hook；`idle-observe` 在 P3 自己 bump） → CLAUDE.md semver 表加列 → plugin.json description → CHANGELOG → INDEX。
- 驗收：`scripts/sync-all.sh` 全綠；`grep -r mods platforms/codex/plugin platforms/opencode/plugin` 空；`preflight-release.sh` 過。負對照：`modules` 指到不存在的檔 → `claude plugin validate` 失敗。

### P2 hook 延遲先量（S）— 只量不搬
- 儀器（A08）：依 S6 決定沿用或新寫 `scripts/benchmark-hook-latency.js`（detached checkout、N = 30、固定 20 個 tool call 的 `claude -p` 工作負載、`--debug` 時戳取**每個 hook 區間**）。三臂：enabled（現狀）、positive-control（同 checkout 多掛一個 `sleep 0.2` 的 marker hook）、zero（配置後用 `--debug` 的 hook 行數確認實際執行 hook 數 = 0）。
- 輸出 `.autopilot/evidence/hook-latency-baseline.json`：`{commit, workload_sha, samples, arms{enabled, positive_control, zero} × per_event{p50_ms, p95_ms, hook_count, spawns}}`。
- 判準：儀器有效 ⇔ positive − zero 的 p95 ≥ 180 ms；有效後，enabled − zero 的 p95 每 call ≥ 150 ms 且 spawns ≥ 5 → 開「guard port」plan；否則不搬並結案。**enabled ≈ zero 是合法結論，不是儀器壞**。
- 負對照：zero 臂仍量到 hook 行 → 拒絕出結論；positive 量不到 → 拒絕出結論。

### P3 事件核心＋閒置（L）
- `scripts/wake-events.js --once|--watch`、`lib/wake-policy.js`（pure）、`lib/wake-sinks.js`（只 `notify`）、`lib/wake-template.js`：wake design §1.2 事件檔 `autopilot.wake-event/1`（`facts` 只允許 enum／id／數字）。來源：manifest 終態、`.exit`、review receipt、`git ls-remote` pushed、cost／context 門檻、`liveness.stall`（report-only）。
- 閒置兩種分欄、都不推論（A07）：
  - 觀察 `hooks/idle-observe.js`：classic `Stop` 的 `background_tasks` 與 `session_crons` 皆 `[]` [V-file types Stop input] → append `{kind:"observed", project_key, session_id, observed: bool, source: "stop_hook", at}`；只代表「這個 session 現在沒背景工作」。
  - 宣告 `autopilot status declare-idle --reason nothing_left|blocked_on_owner|budget [--root <id>] [--note ≤200] | --clear`：append `{kind:"declared", schema:"autopilot.idle-declaration/1", project_key, repo_identity, root_run_id|null, session_id（CLAUDE_CODE_SESSION_ID，缺則拒絕並要求 --session）, reason, at}`。
  - 寫入方式（G2 R5）：三個 writer（declare-idle CLI、watcher 的 supersede、`session-mode.js set`／`retire`／`--clear`）**都只 append** 到同一個 `<live_base>/idle/<project_key>/declarations.jsonl`，經 `scripts/lib/jsonl-store.js`（既有 flock＋PID 陳舊鎖破除＋原子 append [V-file header]）；沒有任何 read-modify-write，沒有 `superseded_by` 欄位被改寫。supersede 是一列 `{kind:"superseded", session_id, by:"<run_id>|session-mode:<level|retire>|clear", at}`；聚合時「宣告被 supersede」= 存在同 `session_id` 且 `at >= declared.at` 的 superseded 列。測試：三個 writer 並行各 append 50 列 → 檔案行數 150、每列可解析、無交錯。
  - 解除：watcher 看到該 `project_key` 新 manifest → append superseded `by: <run_id>`；`session-mode.js set`／`retire` → append `by: session-mode:<level|retire>`；`--clear` → append `by: clear`。
  - project 層聚合（N02；由 watcher 寫進 `progress.json` 的 `idle`，每個輸入都列在 `idle.inputs` 供重推）：`idle.declarations[]` = 該 project 所有未 supersede 的宣告（各帶 session、root、reason）；`idle.live_runs` = runs-live envelope 的 `counts`（watcher 算一次的 `{confirmed_live, exited, unknown}`，定義見 P1a；聚合不重算）；`idle.state` 取值與優先序：`blocked`（存在任一未 supersede 的 `blocked_on_owner` 或 `budget` 宣告，**阻塞宣告永遠壓過 `nothing_left`**；`idle.reason` 取阻塞的那個，兩種阻塞並存取 `blocked_on_owner`）＞ `active`（`confirmed_live > 0`）＞ `unknown`（`unknown > 0`，或 runs envelope 過期）＞ `idle`（全部宣告都是 `nothing_left`、至少一則的 root 等於當前執行根或 project 無 root、`confirmed_live = 0` 且 `unknown = 0` 且 envelope fresh）＞ `none`（無宣告）。「沒有 live run」只能由 `confirmed_live = 0 且 unknown = 0` 成立；confirmed 計數為零但有未探測 run 是 `unknown`，不是 idle。
- mod：事件 → toast／band 一列；`wake.mode` 讀 `~/.autopilot/config.json`，預設 `notify`；`self`／`route` 本 plan 回 `not_enabled_in_this_release`。
- 包裝（G1 R6）：`hooks/idle-observe.js` 進 `hooks/hooks.json` 的 `Stop` 群與 `check-hook-inventory.js` 基線；`sync-version.js --version 2.37.<x> --hook-count 33`（新 classic hook 依 CLAUDE.md semver 表是 **PATCH**，x = P3 當時的下一個 patch 號）；CHANGELOG 列；`hooks/README.md` 表加列；`sync-all.sh` 全綠才算 P3 完成。
- 驗收：wake design P1 (a)–(f)；`declare-idle.test.sh`：宣告 → 新 manifest → `superseded_by` 填上；缺 session id → exit 2；三環境 `--once` 同事件行（KR4）。
- 負對照：manifest `error` 含 `ignore previous instructions` → facts／band 無此字串；喚醒 turn 的事件不再產事件；budget 檔壞 → 等同 `notify`；`nothing_left + blocked_on_owner` → `state: blocked`；`nothing_left + budget` → `state: blocked, reason: budget`；`nothing_left + 一個未探測 run` → `state: unknown`；`nothing_left` 單獨且 `confirmed_live = 0, unknown = 0` → `state: idle`；另一 session 仍有 confirmed live run → `active`；舊 session 重開不復活舊宣告；envelope 過期 → `unknown`。

### P4 `work-round` 投影、`progress/1`、重排器（L）
- `autopilot status work-round --root <id> [--json]`（`--branch` 只是 selector：多個 root 時列候選並 exit 2，不猜）：合成 §2.7 的實體；`phases` 只來自 `controller_progress_receipt`（`src/engine/controller-execution.js:buildProgressReceipt`，凍結分母 [V-file]）與 run-ledger stage rows；README 表另放 `planned[]` display-only；percent 分母未凍結 → null。
- `--projection progress --out <repo>/.autopilot/progress.json`：cockpit study §6 欄位＋補 `idle {declared, reason, declared_by[], since, inputs}`、`run.heartbeat_at`；三個時間 `fact_at / observed_at / published_at`；**emit-on-change ＋ heartbeat**（R-A06：只要 project watcher 活著就每 120 s 重發，**不分有無 live run、idle 或 blocked**，只動 `published_at`；`valid_for_s: 300` 留 2.5 倍餘裕；stale 只在 producer 死後）；里程碑匯出 `docs/plans/evidence/<date>-<job>/work-round.json` 是靜態快照：`snapshot: true, valid_for_s: null`，reader 不對它判 stale。
- `scripts/portfolio-replan.js`（G1 R7 邊界）：只讀 `<root>/*/.autopilot/progress.json`，roots 來自 `~/.autopilot/config.json` 的 `replan.roots`（預設 `["~/projects"]`，`--roots` 可覆寫），拒絕 realpath 跳出 roots 的 symlink；不開其他檔、不跑 git、不讀 BACKLOG、不碰 fleet；測試用 fs spy 斷言開啟的路徑集合只含 `progress.json`。只對 `idle.state == 'idle'`（N02 聚合後）的專案跑，`blocked`／`unknown`／`active`／`none` 一律跳過並在輸出列出跳過原因；輸出提案 JSON；**不派工、不寫 BACKLOG、不送 fleet**。
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
| 發佈切換做不到原子／兩個 renderer 互蓋 | 版本目錄＋`current` symlink 的 tmp→rename；整個切換在 project index 鎖下；`published_at` 單調檢查；rollback 同招；三情境測試 |
| mod 推不出 project／推錯 worktree | `project_key` 只由 CLI 算並寫三處；mod 只查 marker 與 `paths/*.json`；三種 cwd 測試同 key |
| mod 找不到 live base／home | pointer 檔由 CLI 寫在 `$HOME/.autopilot/live-pointer.json`，mod 只讀 `$.env.get("HOME")`；S2 驗；失敗退路是 check-ignore 守住的 repo-local pointer，再不行就 `no pointer` 而 classic 照常 |
| 多專案 watcher 互蓋共用檔 | 沒有共用檔：`paths/<project_key>.json` 各寫各的，mod 合併；兩專案並行測試 |
| shell 與 Node 的 `repo_identity` 不一致 → `--project` 全空 | 同一旗標 `--path-format=absolute`＋`pwd -P`；parity 測試四 fixture 位元相等 |
| 沒有 `flock(1)` 或鎖檔在網路檔案系統 | 明確拒絕（`flock_unavailable`）不退回 lockfile；live dir 永遠本機 |
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
- R2 落地 `be21eac1`；G1（ticket `mods-g1`，`logical_plan_id` `mods-visible-dispatch-2026-10-03`，席位 `claude_architecture`=claude-fable-5-1、`glm_rails`=glm-5.2，兩席 CONDITIONAL；artifact `g1.out` plan_sha256 `10feaa98…`）。R3 處置（rubric id 依 G1 artifact）：
  - R1 blocking **接受**：新增 §2.8 定義 `project_key = sha256(repo_identity)[0:16]`、只由 CLI 算、寫進 envelope／marker／`paths.json`；mod 解析改走 `$.session.id()`→marker、`$.session.cwd()`→`realPath`→`paths.json`，不跑 git、不讀 env；linked worktree 同 key 的理由寫明；`project-key.test.sh`。
  - R2 blocking **接受**：新 `scripts/lib/repo-identity.sh`（同旗標 `--path-format=absolute`＋`pwd -P`），三個 rail 共用，優先序 `REPO_ROOT`→`CONSUMING_REPO_ROOT`→`null` 並寫 `repo_identity_source`；`repo-identity-parity.test.sh` 四 fixture 與 `task-runtime.js:repoIdentity()`（已 export）位元相等；`manifest-repo-identity.test.sh` 走 rail 的 `write_manifest`。
  - R5 blocking **接受**：鎖由 `flock(1)` 包住程序持有（exec 保留 fd、crash 由 kernel 釋放）；前提三條（`flock` 在 PATH、本機 FS、子程序不繼承）與退路（缺 flock → 拒絕，不退回 lockfile）；持有者 pid 來自 envelope 而非 flock 查詢，`--stop` 核對 `/proc/<pid>/cmdline`；`runs-watch-lock.test.sh` 四案。
  - R5 non-blocking（per-job 切換未序列化）**接受**：整個切換序列在 project index 鎖下＋`published_at` 單調檢查。
  - R5 non-blocking（切換後舊頁資產／reap race）**接受**：資產內容定址、版本共用、`../assets/` 相對路徑切換前後同解析；reaper 只刪無引用資產；舊版本保留一代且 ≥ 10 分鐘。
  - R3 non-blocking（`stalled K` 無來源）**接受**：P1a 加 `stall` 欄（`--run` 探測、report-only），band 標 telemetry。
  - R3 non-blocking（舊候選／CONFLICT 規則）**接受**：匹配規則寫成 branch 相等＋`merge-base --is-ancestor`；無 task receipt 時第三標籤 `LIVE GATE · 未綁定候選`。
  - R4 non-blocking（S2 只驗 runs-live）**接受**：S2 擴到 P1c 讀的全部檔與 `$.session.id()/cwd()`；cost 改由 watcher 彙總進 envelope，mod 不讀 costs.jsonl（4 MiB 上限）。
  - R6 non-blocking（KR1 15 s vs 兩層 10 s）**接受**：mod 改 5 s、KR1 改 ≤ 20 s，預算寫進 references。
  - R6 non-blocking（hook 數 33 vs P3 新 hook）**接受**：P1d 用 32；P3 自己 bump 33＋sync-version＋CHANGELOG＋inventory 基線。
  - R5 non-blocking（`--idle-exit` 的 marker 過期未定義）**接受**：未過期 = `expires_at > now`（`DEFAULT_TTL_HOURS = 24`）且未被 `clear`/`retire` 移除；上界 24 h、可 `--stop`。
  - R7 future（replanner 跨專案邊界）**接受**：roots 來自 config、拒絕跳出 roots 的 symlink、只開 `progress.json`、fs spy 測試。
  - R1 non-blocking（[V-file] 無法在 review checkout 重驗）**不當缺陷、照 depth-0 要求處理**：全文 `[V-file]` 引用改為「檔案:符號」，不再只寫行號；plan 本身仍不釘 commit（引用的符號在 `be21eac1` 的 develop 可查）。
  - R6 non-blocking（phase 無 size）**不當缺陷，順手補**：§4 開頭加一行 dev-flow size（原本各 phase 標題已帶 S／L）。
  - glm_rails 兩條（R5／R6 正面評價）：無動作。
- R3 落地 `7ea5dbf3`；G2（generation 2，terminal，兩席 CONDITIONAL，plan_sha256 `f7685420…`）。R4 處置（標籤照 G2 artifact；freeze 前最後一次有界修補，不重開已處置項）：
  - R5 blocking（`paths.json` 跨專案互蓋）**接受**：選 (a) 依 project 分檔 `runs/paths/<project_key>.json`，在既有 project lock 下寫；mod `$.fs.list` 合併後取最長前綴；S2 加 `$.fs.list` 問題；兩專案 watcher 並行測試。
  - R4 blocking（mod 怎麼找 tmpfs base 與 `~/.autopilot`）**接受**：機制 = CLI 寫 `$HOME/.autopilot/live-pointer.json`（`live_base`、`autopilot_home`），mod 只用 `$.env.get("HOME")`（types 有 `env.get`，字面名稱、validate 會列）組出固定位置；§2.5 的「不讀 env」改為「只讀 HOME／XDG_RUNTIME_DIR 兩個名」；S2 列為 spike；失敗退路 = `session-mode set` 在 `$.session.root()` 下寫 repo-local pointer（check-ignore 守住），再失敗 band `no pointer`、classic 照常。
  - R1 non-blocking（三種 key 寫法）**接受**：§2.7 新增 `scope_key` 列並定義；全文 `repo_key` → `project_key`；`--project` 接受 key 或完整 `repo_identity`；`idle-observe.js` 用 `project-key.js` 算。
  - R1 non-blocking（MATCH 把 branch 當身分）**接受**：join = ledger 目錄歸屬＋merge-base 祖先；branch 只顯示 `branch differs` chip。
  - R2 non-blocking（git ≥ 2.31 默默 null）**接受**：§2.5 寫 git ≥ 2.31；shell 失敗 stderr 診斷＋`repo_identity_source: git_rev_parse_failed`；假 git fixture 斷言兩側同時 null；首個 PR 先確認 `write_manifest` seam。
  - R3 non-blocking（`confirmed_live` 未定義）**接受**：envelope 加 `counts {confirmed_live, exited, unknown, fresh_bound_s}` 由 watcher 算一次，公式寫在 P1a；band、`--idle-exit`、`idle.state` 都只讀它。
  - R5 non-blocking（declaration 三個 writer）**接受**：改成單一 append-only `declarations.jsonl`，經既有 `lib/jsonl-store.js`；supersede 是一列而非改欄；三 writer 並行測試。
  - R6 non-blocking（P1a size、P3 版本層級）**接受**：P1a 標題改 L；P3 新 classic hook 依 CLAUDE.md 為 PATCH `2.37.x`。
- 待：R4 落地 → freeze → 進入實作（P0 spike 先行）。
