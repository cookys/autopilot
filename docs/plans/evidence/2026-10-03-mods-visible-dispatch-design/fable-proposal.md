# fable 提案：工作回合紀錄（work-round record）→ 一個生產者、三個消費者

> 狀態：唯讀研究提案，未改 repo。2026-10-03。作者：fable session（claude-fable-5-1，aimax395）。
> 證據標記：[V-file] 讀 repo 檔或 CC 2.1.288 plugin-authoring 型別檔；[V-run] 本機跑過；[SPIKE] 未驗證。

## 0. 三句話答案

(a) **資料模型**：不開新 store。定義一份**派生的** `work-round.json`（schema `autopilot.work-round/1`），由既有的 `autopilot status` CLI 多一個子命令投影出來：dispatch manifest＋`dispatch-status.js --list`（已是派工樹）、run-ledger 的 stage 時戳、engine 的 `controller_progress_receipt`／`implementation_campaign_terminal`／`task_status_receipt`、hetero-review-loop 的 phase receipt、git、evidence 目錄。**render 走「腳本產靜態 HTML」**，mod pane 只是讀 JSON 畫原生元素，Artifact 只是把同一份 HTML 再發佈一次；cockpit 的 `progress.json` 是同一支腳本的第二個投影、同一組 `phase` enum。

(b) **視覺比對**：截圖對（before/after）＋機械算的像素 diff，以 evidence 目錄的固定子目錄落地，每張都綁拍攝時的 commit SHA；同一頁的同一個 phase 區塊裡並排放「截圖對／像素 diff／程式碼 diff」。mod 面板依 surface 降級：terminal 用 `Image`（kitty/Ghostty 才有圖、其他畫 alt），desktop 沒有 `Image` 只有 `Svg`，所以 desktop 畫 SVG gantt＋數字＋連結，不畫 PNG。

(c) **不重做**：既有 11 個機制全部當**來源**或**消費者**，一個都不換；真正新增只有一個 `autopilot status work-round` 子命令（投影）＋三支腳本（HTML、截圖對、localhost 靜態伺服）＋一個薄 mod（純讀者）。`watch-foreman.js`／Monitor 路徑原樣保留當無 mod 的 fallback。

## 1. 「回合」是什麼（命名先避開既有詞）

一回合 = 一次有邊界的 orchestration run：一個 `/l3–/l6` run、一個 managed campaign（mission root run id）、或 dev-flow 一個 L-size phase（branch 建立→landing）。一個 project 可以有多回合；id 用既有識別（campaign id／dispatch `root_run_id`／branch＋起始 commit），不發明新 id。

**命名**：repo 裡 `round` 已經是 quality-pipeline re-review loop 的用語（`diff-since-last-round.sh` 的「fix round」）[V-file]，所以本提案的檔案叫 **`work-round.json`**（schema `autopilot.work-round/1`），re-review 的 round 是某個 phase 內的 `results[].cycle`，兩者不混。

## 2. (a) 資料模型：`work-round.json` 是投影，不是帳本

```
{
  "schema": "autopilot.work-round/1",
  "generated_at": "<iso>", "valid_for_s": 30,
  "producer": { "version": "<plugin.json>", "commit": "<HEAD>", "branch": "...", "dirty": false },
  "project": { "id": "<remote slug>", "name": "...", "plan_path": "docs/plans/...", "project_dir": "docs/projects/...", "index_row": "<INDEX.md 列文字>" },
  "work_round": { "id": "...", "kind": "l3|l4|l5|l6|campaign|dev-flow", "started_at": "...", "ended_at": null,
               "status": "planning|implementing|verifying|reviewing|awaiting_disposition|landing|done|failed|parked|blocked",
               "progress": { "completed": 3, "remaining": 2, "denominator_frozen": true, "percent": 60, "eta_basis": "..." } },
  "phases": [ { "id": "p2", "name": "implement", "status": "planned|running|done|failed|parked|skipped",
                "started_at": "...", "ended_at": null,
                "owner": { "engine": "codex", "model": "...", "runner": "...", "seat": "implementer" },
                "source": { "kind": "campaign_receipt|run_ledger|tree_event|git", "path": "...", "pointer": "<stage|node|sha>" },
                "work_units": [ "<work-unit id>" ] } ],
  "dispatches": [ { "run_id": "...", "parent_run_id": null, "root_run_id": "...", "depth": 0,
                    "role": "...", "runner": "...", "model": "...", "phase_ref": "p2",
                    "started_at": "...", "ended_at": null,
                    "alive": true, "last_event_age_s": 12, "stall": false, "log_path": "...", "manifest_path": "..." } ],
  "results": [ { "kind": "test|review|qc|integration|release|residue", "verdict": "pass|fail|no_verdict",
                 "severity": { "critical": 0, "major": 1, "minor": 3, "suggestion": 2 }, "path": "...", "phase_ref": "p3" } ],
  "visuals": [ { "id": "home-desktop", "label": "...", "phase_ref": "p2",
                 "before": { "path": "...", "commit": "<sha>", "taken_at": "...", "viewport": "1440x900" },
                 "after":  { "path": "...", "commit": "<sha>", "taken_at": "...", "viewport": "1440x900" },
                 "diff":   { "path": "...", "changed_px": 1234, "pct": 0.8 } } ],
  "cost": { "session_usd": null, "host_today_usd": null, "context_pct": null },
  "needs_human": { "flag": false, "reason": null, "since": null },
  "links": { "evidence_dir": "docs/plans/evidence/<date>-<work-round>/", "page": "http://localhost:<port>/<project>/<work-round>/", "receipt": "..." },
  "evidence": { "derivation": "autopilot status work-round", "sources": [ "...每個欄位的來源檔..." ] }
}
```

規則：
- **每個欄位都可從 `evidence.sources` 重推**（ADR-0001：這是 telemetry，永遠不是 verdict 輸入；頁面與面板是「看」，不是「判」）。
- **unknown 一律 `null`，絕不填 0**（沿用 fleet receipt 與 `dispatch-status.js` 的誠實原則）。
- severity 只用統一四級 🔴🟠🟡🔵。
- `generated_at`＋`valid_for_s`：讀者過期就標 stale，只提醒不阻擋（repo 規則：到期只提醒）。
- 檔案小：目標 < 256 KB，大東西（log、diff 全文、截圖）只放路徑，因為 mod `$.fs.read` 上限 4 MiB [V-file]，hub body-limit 也沒讀過大小。

### 落地位置（兩層，沿用既有慣例）

| 層 | 路徑 | 寫入時機 | 依據 |
|---|---|---|---|
| live | `<live-base>/work-round/<project_id>/<round_id>.json`（tmpfs，`scripts/lib/live-state-dir.js`；本機 [V-run] 解析到 `/run/user/1000/autopilot`，旁邊已有 `context/`、`context-budget/`、`run-approval/` 等同族子目錄） | 每 tick（≤ 5 s）或每個來源檔 mtime 變動時，atomic rename | repo 規則「live 狀態檔落 tmpfs」 |
| durable | `docs/plans/evidence/<date>-<work-round>/work-round.json`（＋`visual/`） | phase 轉換與回合結束時 | 既有 evidence 目錄慣例（看 `2026-10-01-grok-4.7-low-seats/` 的 layout） |
| cockpit 投影 | `autopilot status work-round --projection progress` → `progress.json`（位置依 cockpit study §6） | 同 durable | fleet-cockpit-boundary-study §6 的 schema；`phase` enum 共用 |

### Render：三個消費者讀同一份 JSON

| 消費者 | 怎麼畫 | 限制／降級 |
|---|---|---|
| **owner 的 review 網頁** | `scripts/render-work-round-page.js work-round.json → index.html`，單檔、inline CSS、inline SVG gantt、無 CDN；加 `--index` 產本機所有回合的索引頁 | 由 `scripts/serve-work-round-page.js` 以 Node 內建 `http` 在 `http://localhost:<port>` 提供，因為 mod 的 `Link` 只收 `https:` 或 `http://localhost` [V-file LinkProps]；`Markdown` 元素額外會畫 `file:` 連結 [V-file reference.md L95]，可當無伺服器時的退路 |
| **mod 面板**（CC 專屬增強層） | `$.fs.read` live 檔（[SPIKE]：型別說絕對路徑照用，但 `fs.*` hook 可限制；讀不到就退讀 `~/.autopilot/work-round/` 的 SSD 副本，投影同時寫兩份） → `AbovePrompt` band（跑中 hands 數、最老 elapsed、stall、cost/ctx）＋ `Pane`（phases 表、dispatches 表、results 的四級計數、`Link` 到網頁）；phase 轉換 `$.ui.toast` | 無 mod／Codex／OpenCode／agy：`watch-foreman.js` 與 Monitor 路徑原樣；`claude -p` 下 mod 惰性；寬 < 144 欄不開 pane 只畫 band [V-file] |
| **Artifact**（可選發佈） | 同一份 `index.html` 用 Artifact 工具發佈（私有、可手機看） | 只有 CC 有；不是來源、不是真相；預設關 |
| **cockpit**（之後） | 吃 `progress.json`，跨主機彙整 | 不在本提案範圍 |

生產者怎麼跑：`round-record.js --once`（任何 harness 隨時可叫）與 `--watch`（回合開始時由 dispatch rail／foreman 起一支背景 watcher，或由 mod `session.start` 用 `$.process.spawn` 起）。mod 自己**不跑投影邏輯**，每 tick 只讀檔，省掉每 tick 一次 spawn（mod 沙箱沒有 Node、不能 `require` repo lib [V-file]）。

## 3. (b) 視覺比對放進同一頁

### 來源（三類，各自用現成做法）

| 專案型態 | before/after 來源 | 既有做法 |
|---|---|---|
| web／文件站 | headless chromium `--screenshot`，base commit 與 head 各建一次（base 在暫時 worktree 建，不污染主 checkout） | `site-narrative-audit` skill 已有 chromium 探測與三視口配方（1440 桌機／手機／fold）[V-file] |
| TUI／CLI | `tmux capture-pane -p` 文字快照 → 以 `<pre>` 並排 | 文字 diff 即可，不需像素 diff |
| 非視覺（純腳本） | 無截圖；`visuals` 為空，區塊顯示「此回合無視覺產物」 | 不要硬塞 |

### 落地慣例

`docs/plans/evidence/<date>-<work-round>/visual/<id>/{before.png,after.png,diff.png,meta.json}`；`meta.json` 記 route、viewport、工具＋版本、各自的 commit SHA 與 `taken_at`。像素 diff 由 `scripts/visual-pair.js` 算（純 Node：zlib 解 PNG、逐像素比較、輸出 diff.png 與 `changed_px`/`pct`，不引外部套件，符合 dep-minimal 規則）。

### 頁面版面（每個 phase 一個區塊，三欄）

```
phase p2 · implement · codex/gpt-6-low · 00:12:34 · ✅
┌ before @abc123 ──┬ after @def456 ──┬ pixel diff 0.8% ─┐
│   [png]          │   [png]          │   [png]          │
└──────────────────┴──────────────────┴──────────────────┘
▸ code diff（diff-scope-report.sh 的範圍，折疊）
▸ results：review 🔴0 🟠1 🟡3 🔵2 · tests pass · integration receipt ✓
```

### mod 面板的降級（必須寫明，因為 owner 要 desktop 優雅降級）

| surface | 能畫什麼 | 做法 |
|---|---|---|
| terminal（kitty／Ghostty） | `Image`（PNG ≤ 2 MiB、`{file}` 來源由終端自己讀） | 畫 `diff.png` 縮圖＋`alt` |
| terminal（其他終端） | `Image` 只畫 `alt` | 顯示 `changed_px`/`pct`＋`Link` |
| desktop | **沒有 `Image`**，有 `Svg`（≤ 128 K 字元） | SVG gantt＋數字＋`Link` 到網頁看圖；`Code format:'diff'` 畫前一個 hunk（上限 10,000 字元 [V-file CodeProps]），其餘「見網頁」 |
| vscode／mobile | 同 desktop 無 `Client`；mobile 無 Input/Select | 只讀：Markdown＋Link |

[V-file] 元素表：terminal 獨有 `Raster`/`Image`、遠端 surface 獨有 `Svg`（types `Elements`）。

## 4. (c) 不重做：既有機制逐一定位

| 既有機制 | 在本設計的角色 | 新增 |
|---|---|---|
| `scripts/dispatch-status.js`（manifest＋log 解析＋liveness，純 telemetry） | `dispatches[]` 唯一來源。**[V-run] `--list` 本機實跑**：輸出 JSON 陣列，每列 `run_id, role, runner, model, started_at, ended_at, parent_run_id, root_run_id, depth, manifest` —— 已經是一棵派工樹，gantt 的父子關係現成 | 無 |
| `scripts/run-ledger.sh`（foreman stage 狀態機；row kinds `stage/heartbeat/journal/worker_event/directive`，stage states `pending→leased→committed→reviewed→verified→merged`） | foreman 回合的 `phases[].started_at/ended_at`（= gantt 條）；`worker_event.condition`（working／waiting／blocked）→ `phases[].status` | 無 |
| **`src/status/cli.js` = `autopilot status [quota\|runs\|roster\|readiness\|task]`**（`runs` 就是包 `dispatch-status.js --list`） | **投影的自然歸宿**：優先做成 `autopilot status work-round` 子命令，而不是另開 `scripts/work-round-record.js`（見 §4 新增清單的改法） | 一個子命令 |
| `controller_progress_receipt`（`src/engine/controller-execution.js` `buildProgressReceipt`；`completed_deliverables / remaining_deliverables / frozen_denominator_digest / eta_basis / blocked_reason / phase`；**engine 今天就在 `appendRoundProgress` 追加這條流**，落在 `<git-common-dir>/autopilot/controller-authority/…/controller-durable.json`） | managed campaign 的 `work_round.progress`：**讀現成的流，不另起生產者**；**沿用它的「凍結分母」**，percent 只在分母凍結時才給，否則 `null`。只有 dev-flow 回合（沒有 engine）才退到 README Phase 表 | 無 |
| `implementation_campaign_terminal`／`_awaiting_disposition`／`_boundary_rejected`／`_failure`（`schemas/implementation-campaign-receipt.schema.json`；terminal 帶 `final_panel_seat_receipts[]`、`follow_up[]`、`unresolved_final_findings[]`） | `work_round.status` 終態＋`results[]` 的 final panel 列 | 無 |
| `implementation_campaign_status`（`autopilot campaign status`：`phase, activity, wall_seconds_remaining, leaf_runs{total,live,completed,dead,unknown}`） | campaign 進行中的 `work_round.status`／`dispatches` 彙總 | 無 |
| `task_status_receipt`（`autopilot status task --root-run-id`：`acceptance_verdict, pushed, product_merged, zero_residue, can_merge, can_close, failed_predicates`） | `results[].kind=release`＋頁面頂端的「能不能合／能不能關」 | 無 |
| hetero-review-loop phase ledger（`<ledger>/review-<phase>/g<N>/{range,findings,dispositions}.json`＋`receipt-<phase>.json`：`verdict, open_findings, chain[]`） | `results[].kind=review` 的唯一來源；四級計數從 `findings.json` 算 | 無 |
| `scripts/record-integration.js`（stdout 印 `merge_execution_receipt`，不落檔）、`lifecycle-residue-receipt.js`（`--out` 落檔） | `results[]` 的 integration／residue 列；integration 的那份由投影在 landing 時呼叫一次並存進 evidence 目錄 | 無 |
| `scripts/session-mode.js`（`~/.autopilot/session-mode/<sid>.json`：`level, started_at, expires_at`） | `work_round.kind`（l3–l6）與 `work_round.started_at` 的來源 | 無 |
| 專案 README 的 `\| Phase \| Status \|` 表（project-lifecycle 模板；歸檔例子加 `Size \| Evidence` 指到 `ledger/pN/`） | dev-flow 回合（沒有 engine receipt 時）的 `phases[]` 人工來源，`source.kind=project_readme` | 無 |
| `scripts/tree.js`（task-tree JSONL） | 可選的 `phases[].source.pointer`；**只在 `_archive/` 有 `events.jsonl`，現役專案沒有** [V-run find] → 不為此復活它 | 無 |
| `scripts/watch-foreman.js`、`wait-dispatch-results.js`、Monitor | 無 mod 的 fallback 消費者；band 只是同一批檔案的第二個讀者 | 無 |
| `scripts/lib/live-state-dir.js`（`context/<sid>.json` 由 `statusline-live-tee.js` 寫；**live 目錄裡沒有 cost 檔**，cost 在 `~/.claude/metrics/costs.jsonl`，Stop 時才寫） | live 檔位置；`cost.context_pct` 讀 live、`cost.*_usd` 讀 costs.jsonl（會落後一個 turn，頁面要標 `as_of`） | 無 |
| `docs/plans/evidence/`、`docs/projects/INDEX.md`、`ongoing-maintenance/` | durable 落地與 `project` 身份；頁面**連回**它們，不另建追蹤表 | evidence 子目錄多一個 `work-round.json`＋`visual/` |
| `scripts/diff-scope-report.sh`、`diff-since-last-round.sh` | 頁面的程式碼 diff 範圍 | 無 |
| `scripts/dispatch-experience-critic.sh`（結構上非阻斷的體驗批評席） | 之後可吃 `visual/` 當 `--evidence` | 無 |
| wake-mechanism-design（事件核心） | `phase.changed`／`work_round.ended` 可當事件來源；**wake policy 不放在 renderer** | 事件核心讀 work-round.json 即可 |
| fleet-cockpit-boundary-study `progress.json` | 同一支腳本的投影 | 無新 schema，共用 `phase` enum |

真正新增（全是 shipped code → PATCH；mod 面板算不算新 user-facing surface 是 owner 的版本政策決定，PR1 Q5）：

1. **投影**：優先做成 `autopilot status work-round [--root-run-id|--campaign|--branch] [--watch] [--projection progress]`（`src/status/` 已有 `runs/task/quota` 三個同型投影，`runs` 就是包 `dispatch-status.js --list`）；不想碰 `src/` 才退而求其次開 `scripts/work-round-record.js`。
2. `scripts/render-work-round-page.js`：JSON → 單檔 HTML（＋`--index`）。
3. `scripts/visual-pair.js`：截圖對＋像素 diff＋`meta.json`。
4. `scripts/serve-work-round-page.js`：localhost 靜態伺服（Node 內建 `http`）。
5. `mods/autopilot-work-round/`：薄讀者（band＋pane＋toast），不含任何投影或政策邏輯。

每支都要走 CLAUDE.md「新增腳本四處接線」。盤點確認 repo 裡**沒有任何** visual diff／screenshot／playwright／gantt／timeline 的實作（只有 config glob 與研究文件的提案），所以第 2–4 項是真的新，不是重做。

## 5. Gantt 位（等機隊回覆再填）

時間軸資料 = `phases[].started_at/ended_at`＋`dispatches[]` 的 manifest 時戳；HTML 與 desktop pane 畫 inline SVG，terminal pane 畫文字條。機隊的 gantt 做法進來後只換 render 層，不動 schema。

## 6. 給 owner 的決定（不是我能定的）

1. 截圖進 git 的大小政策：每張上限／LFS／或放 `~/.autopilot/evidence/` 只在 work-round.json 留路徑提示。
2. localhost 伺服器壽命：每個 session 起一支，還是 systemd user unit 常駐。
3. Artifact 發佈預設開或關。
4. 你用的終端是哪一個（kitty／Ghostty 才看得到 `Image`）。
5. 回合邊界：一個 campaign = 一回合，還是 dev-flow 的每個 phase 各一回合。

## 7. 待 spike（寫進 docs 前不得當事實）

- ~~`dispatch-status.js --list` 的機器可讀輸出形狀~~ → 已實跑，見 §4 表第一列。`--run <id>` 的 status 物件（`alive/stall/last_event_age_s/tokens`）形狀由 header 文件化 [V-file]，`alive` 三態 true/false/null。
- `$.fs.read` 能否讀 `$XDG_RUNTIME_DIR` 下的 tmpfs 檔（型別說絕對路徑照用，但 `fs.*` hook 可限制）。
- `Image {file}` 在 owner 實際終端的行為；desktop pane 的 `Svg` 上限夠不夠一張 gantt。
- `modules`＋classic hooks 同檔載入（PR1 已列）。

## 8. 追問：P1 派工面板最小版，不等完整 schema 行不行（2026-10-03 回 autopilot--claude）

**行，而且 run-ledger 可以先不碰。** 「誰在跑／跑多久／最後 rc」三欄的來源都在 manifest 目錄：

| 欄 | 來源 | 注意 |
|---|---|---|
| 誰在跑 | `dispatch-status.js --list`（`run_id, role, runner, model, parent_run_id, root_run_id, depth`）[V-run] | 目錄是 7 天保留，本機現在 112 份 manifest；manifest **沒有 session id、沒有 repo id**（`branch/worktree` 在 author／review run 是 null）→ 要先過濾：`root_run_id`（depth-0 自己知道）或 `started_epoch` 時窗 |
| 跑多久 | manifest `started_epoch`；live 用 now−started，exited 用 `ended_epoch−started_epoch` | — |
| 活著嗎 | `dispatch-status.js --run <id>`：`phase running\|exited\|unknown`、`alive`（三態）、`last_event_age_s`、`stall` | 每次探測 = `flock -n`＋`systemctl is-active`＋`git status`＋`git diff`（4 個 spawn，timeout 5/10 s）→ **只對 `ended_at==null` 的 run 探測**，exited 的直接讀 manifest；tick 10–15 s，結果寫 cache，band 只讀 cache |
| 最後 rc | manifest `final_status`（implementer：`committed/dirty/failure/engine_unavailable/boundary_rejected/<strict-postcheck>`；author：`authored`）[V-file dispatch-hetero.sh L4584–4653]；foreman 管的 run 另有 `<ledger>.results/<run_id>.<stage>.exit`（真 exit code，detach 最後原子寫） | `manifest_finalize` 是 **best-effort**：dispatcher 被殺時 `ended_at/final_status` 留 null → 面板要把「null 且 liveness 說 exited」顯示成 `rc=unknown`，不能顯示成「還在跑」 |

做法：MVP 的輸出就是 work-round 的 `dispatches[]` 子集，**欄位名完全相同**（`run_id, parent_run_id, root_run_id, depth, role, runner, model, started_at, ended_at, alive, last_event_age_s, stall, final_status, log_path, manifest_path`），之後整份 schema 長出來時這段原封不動塞進去，不是拋棄式。靜態 HTML 同一份 JSON 畫一張表；mod band 畫 `running N · oldest HH:MM · stalled K · last rc`。

run-ledger 只在想看「foreman 現在在哪個 stage」時才需要（`watch-foreman.js --once` 的 SNAPSHOT 是文字行不是 JSON，`--ledger` 必填）；hand 層級的三欄用不到它，P1 可以留到有 /l4–/l6 需求再加。
