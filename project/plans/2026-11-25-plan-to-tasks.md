# Plan — plan-to-tasks：凍結後自動開子單、全 lane Fleet-Task 閘、收尾目檢分流

> Status: R1（折入 G1 十二條 blocker）/ Owner: autopilot--claude / Branch: feat/plan-to-tasks / Frame: PM 單 01M88GP63J9GTMXM23MNW5HSRK（M）

## 0. Context

現況（原檔可重查）：`scripts/dispatch-author.sh:1146-1164` 呼叫 `scripts/lib/fleet-task-ref.js pm-check`，但 `fleet-task-ref.js:146` 在非 PM console 放行；`scripts/dispatch-hetero.sh` 無 pm-check（只有 `:3626` resolve-parent）；`hooks/dispatch-model-guard.js:307-340 checkPmFleetTask` 只管 PM console。凍結訊息是 `dispatch-plan-review.js` 發的 `[stage:plan/frozen] <path>@<sha>`；腳本內沒有建子單的程式；`fleet dispatch` 已有 `--parent`、`--queue --after <id>`（可重複）、`--size`、`--kind`。`references/plan-template.md` §4 無機器可讀表。`scripts/open-decision.js` 已有 `--kind look --look-target`。`pm-dispatch-plan-guard`、`work-order-adopt` 已由 b445c9192 啟用，不重寫。

## 1. Problem

計畫到子單靠人手，會漏會晚；背景引擎在非 PM 席可無單號開跑而花費；收尾的 live 與目檢判斷靠記憶。

## 2. KRs

- KR1：真實計畫（fleet state-contract C2）走完 lint → 凍結 → 子單 → 第一張派出，零手開單。
- KR2：所有 lane 的 dispatch-author.sh / dispatch-hetero.sh 缺有效 open 單號 exit 2、零花費。
- KR3：finish 三格缺任一格非零；四類目檢情境一律 look，未知也 look。

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10，只用內建模組；不新增相依；不新增 trust machinery（ADR-0001）。
- 每道新閘或改閘附負控制（先紅後綠）與 live 反向探針（見 §5 矩陣），並寫明退役哪條規則。
- 單號判定：`not_found`／已 done|failed|cancelled → exit 2；`open|running|waiting|blocked` 為有效；fleet 或 hub 無回應（unavailable）→ fail-open 並 stderr 一行，與無效單號分開。
- 單號解析順序全 lane 相同：`--fleet-task` → env `AUTOPILOT_FLEET_TASK` → prompt 檔前 10 行 `Fleet-Task:` → 繼承父單；凍結前審查用計畫自己的單。
- 子單建立只經 `fleet dispatch`；測試用沙箱 HOME 與 stub fleet，不碰 live。

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`。非 PM 席原可無單號派工，改後被擋是本計畫要的行為；過渡旋鈕 `AUTOPILOT_FLEET_TASK_GATE=warn` 在 P4 預設 warn、P6 live 驗證後改 enforce 並同 commit 刪旋鈕。
- **Dependency decision**: `none`。

## 3. File-structure map

| 檔案 | 責任 |
|---|---|
| `references/plan-template.md` | §4 phases:v1 表定義，取代自由文字格式 |
| `scripts/check-plan-phases.js`（新） | phase 表 lint；由 `check-plan-graduation.js --register-template` 呼叫（只對新計畫） |
| `scripts/plan-to-tasks.js`（新） | 讀凍結 bytes、建子單；由 `dispatch-plan-review.js` 封存後呼叫（`--plan-to-tasks off` 可關；失敗不改審查判決，印出重跑指令） |
| `scripts/lib/fleet-task.js` | 新增 `create()`、`listChildren()` |
| `scripts/lib/fleet-task-ref.js`、`scripts/dispatch-hetero.sh`、`hooks/dispatch-model-guard.js` | 單一 pm-check；hetero 補閘；`checkPmFleetTask` 改呼叫它 |
| `scripts/finish-triage.js`（新）、`scripts/lib/look-classes.json`（新） | 三格檢查、look 分流、類別清單 |
| `skills/finish-flow/SKILL.md`、`skills/dev-flow/SKILL.md` | 改為呼叫腳本，刪對應口述（plan 節點加 plan-to-tasks 一行） |

## 4. Phases

<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|---|---|---|---|---|---|
| P1 | S | - | `bash scripts/tests/check-plan-phases.test.sh` rc=0（含缺欄、環、未知依賴三壞表 rc≠0） | no | phase 表與 lint |
| P2 | S | P1 | `bash scripts/tests/plan-to-tasks.test.sh` rc=0（stub fleet） | no | 凍結後開子單 |
| P3 | S | P2 | `bash scripts/tests/plan-to-tasks-join.test.sh` rc=0（三前置 join、重跑、中斷復原） | no | 依賴佇列驗證 |
| P4 | S | - | `bash hooks/tests/fleet-task-gate.test.sh` rc=0（含非 PM 席、hetero、unavailable、負控制） | no | 全 lane 單號閘 |
| P5 | S | - | `bash scripts/tests/finish-triage.test.sh` rc=0 | no | finish 三格與分流 |
| P6 | M | P3,P4,P5 | §5 矩陣每列 live 探針貼輸出；P4 旋鈕已刪 | yes | C2 真實驗收與 live 探針 |
<!-- /phases -->

**P1**：表以 `<!-- phases:v1 -->` 起止，欄位固定；lint 檢查表存在、id 唯一、depends_on 只能指向表中更前面的列（禁止前向引用；fixture：依賴列排在前置列之前 → rc≠0）、size∈{XS,S,M,L,XL}、depends_on 已存在且無環、acceptance_cmd 非空且無 TODO/TBD、needs_look∈{yes,no}。退役：§4 自由文字格式。

**P2**：`dispatch-plan-review.js` 封存時寫凍結收據 `<plan stem>.freeze-receipt.json`（`commit`、`path`、`sha256`＝該 commit 該路徑 bytes 的 sha256、`verdict`＝READY 或終局裁決通過）。`plan-to-tasks.js --receipt <file>`（自動與手動重跑相同）先驗：`git show <commit>:<path>` 的 sha256 等於收據、收據 verdict 通過、再跑 lint；任一不符 exit 1 且零 fleet 異動。沒有收據不能呼叫。取 `fleet claim plan-to-tasks:<sha256>` 序列化；依 phase 順序為每 phase 建一張子單，內文第一行 `Plan: <path>@<commit_sha> Phase: <id>`；無前置者直接派，有前置者 `--queue` 並對每個前置各給一個 `--after`（完整多前置）。完成判定＝凍結 phase id 與現有子單 `Phase:` 標記一對一（不是只看總數）；重跑只補缺的 id，中斷後可復原；不一對一則 exit 1 列出缺或多。建單依拓樸序（前置先建，表序為同層排序）。就緒由 fleet queue 單一負責，不另寫 advance 腳本。退役：人工逐張開單派單的口述。

**P3**：只做驗證：stub fleet 上三前置 join 在三張都 done 前不釋放、done 後恰釋放一次；並行跑兩個 plan-to-tasks.js 只建一組；中斷（建到一半 kill）後重跑補齊。

**P4**：`fleet-task-ref.js` 拿掉 non-pm-console 放行；`dispatch-hetero.sh` 在建 worktree 與啟引擎前呼叫同一 pm-check；`dispatch-author.sh`、`dispatch-plan-review.js`、`hetero-review-loop.js`、hook 共用 §2.5 的解析順序與狀態判定；保留 exempt 角色 `^(engine-qualify|probe-)`。更新既有測試的 stub fleet，使 P4 單獨進 develop 不紅。退役：`checkPmFleetTask` 的重複實作。

**P5**：`finish-triage.js --task <id> --sha <merged_sha>`。三格：merged＝`git merge-base --is-ancestor` 對 origin/develop；live pin＝單上有 `Pinned: <host> <sha16>`（sha16＝該 sha 前 16 碼），或 `Pin: not-needed <≥20 字理由>` 且該 sha 的 diff 不碰任何隨 plugin 出貨的路徑；live pin 的證據是 hangar 換版腳本寫的讀回檔（`Pinned: <host> <readback file>`；檔內 host 與完整 sha 前 16 碼須與該 sha 相符）。Used＝`Used: command <file>`（檔內有 `cmd:` 行、`rc=0`、含該 sha 前 16 碼）或 `Used: screenshot <png>`（PNG ≥ 2 KB，並有同名 `.meta` 記動作與該 sha16）；URL 不收（語法本身可偽造 sha）。`n/a|TBD|none|-`、空檔、sha 不符、rc≠0 一律拒，皆為負控制 fixture。分流：`look` 若下列任一成立——phase 表 `needs_look: yes`、diff 路徑命中 `look-classes.json` 的 UI／互動／對外類、diff 新增可執行檔、服務或 hook 註冊（`--diff-filter=A`，即首次上線）、單文有 `First-live: yes`；單或 diff 讀不到、類別不明一律 `look`（保守）。僅當全不成立且測試紅綠與反向探針收據齊才 `skip`。`finish-flow` Checklist 第 7 項改呼叫它。退役：該項口述判斷。

**P6**：以 fleet state-contract C2 走 P1→P5；對 §5 每列做 live 反向探針；把 P4 旋鈕改 enforce 並刪除。

## 5. Test / validation（gate → 負控制 → live 反向探針）

每列探針是 commit 進 `scripts/probes/<gate>.sh` 的腳本：先跑合法基準（必須成功），再做故意違規，斷言閘專屬錯誤字樣（P4 為 `fleet_task_gate`，不是參數錯誤），最後清理；零脈絡工程師直接執行。

| gate | 負控制（先紅） | live 反向探針（故意違規，預期） |
|---|---|---|
| P1 lint | 三種壞表 rc≠0 | 對真計畫副本刪一欄跑 `node scripts/check-plan-phases.js <file>` → rc≠0 |
| P2 完成判定 | stub 缺一張／多一張 → exit 1 | `scripts/probes/p2.sh`：用 receipt 的 sha256 與少一 phase 的 commit 不符 → exit 1、零 fleet 異動 |
| P3 join | 三前置少一張 done 時不釋放 | 真 fleet 上手動讓一前置不 done，確認後繼仍 queued |
| P4 單號 | 拔閘轉紅 | 非 PM 席不帶單號跑 `scripts/dispatch-hetero.sh` → exit 2 且無引擎行程；fleet 停掉時 → fail-open 一行 stderr |
| P5 三格 | 各格缺／填 `n/a`／sha 不符 → rc≠0 | 對一個 UI 變更 sha 跑 `node scripts/finish-triage.js` → `look`；對新增 hook 的 sha → `look`；拿掉 Used 行 → rc≠0 |

腳本可驗：P1–P5。需人看：P6 與 look 卡。

## 6. Risks + inversion

誤擋合法派工 → exempt 保留、P4 先 warn、各 lane 各跑一次正向派工。重跑重複開單 → claim 加一對一判定。凍結 bytes 漂移 → 只讀 commit sha 的 bytes。

## 7. Out of scope

UI viewport 截圖閘；plan loop g2 收斂改造；代換 hangar pin（只讀回確認）；回溯舊計畫。

## 8. Open questions

無（P6 目標定為 C2；fail-open 保留，見 §2.5）。

## Review log

- R0：2026-11-25 作者初稿。G1（astra STOP、argon CONDITIONAL，grok 因 402 額度用盡換 argon，零語義消費，狀態備份於 scratchpad）十二條 blocker 全部 accepted_blocker 並折入本版；兩條重疊（R1 idempotency／freeze 可判定，R5 stub／first-live）併入同一修補。
