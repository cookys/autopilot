# Plan — plan-to-tasks：計畫凍結後自動開子單、派工標頭與 Fleet-Task 閘、收尾目檢分流

> Status: draft（待 plan loop）/ Owner: autopilot--claude / Branch: feat/plan-to-tasks（每 phase 另開 feat/ptt-pN）/ Frame: PM 單 01M88GP63J9GTMXM23MNW5HSRK（M，已 accepted）

## 0. Context / thesis

PM 單要三件事：計畫變成機器可讀的 phase 表並自動開單；所有 lane 的背景引擎派工在沒有有效 open 單號時零花費擋下；收尾把「merged → live pin → Used 證據」三格和目檢分流變成程式。現況盤點（原檔可重查）：
- 單號閘：`scripts/dispatch-author.sh:1146-1164` 已呼叫 `scripts/lib/fleet-task-ref.js pm-check`，但 `fleet-task-ref.js:146` 在非 PM console 直接放行（exempt: non-pm-console）。`scripts/dispatch-hetero.sh` 沒有 pm-check，只有 `:3626` 的 resolve-parent（`|| true`）。`dispatch-plan-review.js:2235`、`hetero-review-loop.js:1262` 同樣走 resolvePmGate。`hooks/dispatch-model-guard.js:307-340` 的 `checkPmFleetTask` 只管 PM console。
- 計畫凍結：`dispatch-plan-review.js` 首次封存發 `[stage:plan/frozen] <path>@<sha>`；`rubric-freeze.js` 只做位元組 seal。腳本與 hook 內沒有建立 fleet 子單的程式，`scripts/lib/fleet-task.js` 只有 show/progress/dispatchEnding/blocked。`fleet dispatch` 已支援 `--parent`、`--queue --after <id>`、`--size`、`--kind`，所以建子單與依賴不需要改 fleet。
- `references/plan-template.md` 的 `## 4. Phases` 只有文字，沒有機器可讀表也沒有 lint。
- 收尾：`skills/finish-flow/SKILL.md` 第 7 項 Usage evidence 有 `Used:` 格式但無程式檢查；`scripts/open-decision.js` 已有 `--kind look` 與 `--look-target`。
- 既有 opt-in 閘 `pm-dispatch-plan-guard`、`work-order-adopt` 已由 b445c9192 啟用，不重寫。

## 1. Problem

計畫寫完到變成可追蹤的子單，靠人手逐張開、逐張派，會漏、會晚、會空檔；背景引擎在非 PM 席可以無單號開跑而花費；收尾的 live 與目檢判斷靠記憶。目標是讓「凍結 → 子單 → 派工 → 收尾」都由腳本驅動，人只判斷。

## 2. OKR / KRs

- KR1：真實計畫（建議 fleet state-contract C2 或 codeforge R1 改版）走完 phase 表 → lint → 凍結 → 開齊子單 → 派第一張，過程零手開單。
- KR2：所有 lane 的 dispatch-author.sh / dispatch-hetero.sh 缺有效 open 單號時 exit 2，花費為 0（反向探針實測）。
- KR3：finish 三格缺任一格時 finish 檢查腳本回非零；UI／互動／對外／首次上線類自動開 look 卡，純內部且紅綠與反向探針齊者免目檢。

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10，只用內建模組；不新增相依。
- 不新增 trust machinery（hash chain、event ledger、attestation），驗證靠獨立重算（ADR-0001）。
- 每道新閘或改閘要附負控制（故意違規先紅再綠）與 live 反向探針，並寫明取代或退役哪條散落規則。
- fleet 不可用時閘 fail-open 並寫 stderr 一行（沿用現行 `unavailable` 語意）；不因 fleet 故障把派工擋死。
- 不用 `$(...)`／`$VAR` 當 rm 目標；測試用沙箱 HOME 或暫存目錄，不碰 live 設定。
- 子單建立只經 `fleet dispatch`（`--parent`、`--queue --after`），不直接改 fleet 內部狀態。

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`。受影響的是 autopilot 自己的派工腳本與 finish-flow；非 PM 席原本可無單號派工，改後會被擋，這是本計畫要的行為，用 `AUTOPILOT_FLEET_TASK_GATE=warn` 當一個版本的過渡旋鈕，之後移除旋鈕（不留墊片）。
- **Dependency decision**: `none`。

## 3. File-structure map

| 檔案 | 責任 |
|---|---|
| `references/plan-template.md` | §4 Phases 加機器可讀表欄位定義 |
| `scripts/check-plan-phases.js`（新） | 解析並 lint phase 表 |
| `scripts/plan-to-tasks.js`（新） | 凍結收據成立後開子單、派第一張、子單 done 後派下一張 |
| `scripts/lib/fleet-task.js` | 新增 `create()` 包裝 `fleet dispatch --parent --queue --after` |
| `scripts/lib/fleet-task-ref.js` | 拿掉 non-pm-console 放行，保留 exempt 角色與 inherited |
| `scripts/dispatch-hetero.sh` | 補 pm-check（零花費 exit 2） |
| `hooks/dispatch-model-guard.js` | 退役 `checkPmFleetTask` 重複檢查，改呼叫同一個 pm-check |
| `scripts/finish-triage.js`（新） | 三格檢查與目檢分流 |
| `skills/finish-flow/SKILL.md` | Checklist 改為呼叫 finish-triage.js |
| `hooks/tests/`、`scripts/tests/` | 各 phase 的測試與負控制 |

## 4. Phases

phase 表（機器可讀；欄位順序固定，`|` 分隔，lint 由 P1 提供）：

<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|---|---|---|---|---|---|
| P1 | S | - | `node scripts/check-plan-phases.js project/plans/2026-11-25-plan-to-tasks.md` rc=0 且壞表負控制 rc≠0 | no | 計畫模板加 phase 表與 lint |
| P2 | S | P1 | `node scripts/plan-to-tasks.js --plan <path> --dry-run` 印出子單數＝phase 數；`--apply` 對 stub fleet 開單且 depends_on 正確 | no | 凍結後自動開子單並派第一張 |
| P3 | S | P2 | `bash scripts/tests/plan-to-tasks-next.test.sh` 綠；子單 done 的 stub 事件觸發下一張派工 | no | 子單 done 自動派下一張 |
| P4 | S | - | `bash hooks/tests/fleet-task-gate.test.sh` 綠；非 PM 席缺單號 exit 2 零花費；負控制拔閘轉紅 | no | 全 lane 單號 pre-spend 閘 |
| P5 | S | - | `node scripts/finish-triage.js --self-test` 綠；缺格 rc≠0；四類目檢情境各開 look 卡（stub） | no | finish 三格與目檢分流 |
| P6 | M | P3,P4,P5 | 真實計畫走完 1→3，交件附計畫 sha、凍結收據、各閘反向探針輸出 | yes | 真實計畫驗收與 live 反向探針 |
<!-- /phases -->

各 phase 步驟：

**P1**：在 `references/plan-template.md` §4 加「phase 表」小節：以 `<!-- phases:v1 -->` 起、`<!-- /phases -->` 止，欄位同上；`needs_look` 為 yes/no；`depends_on` 為逗號分隔 id 或 `-`。`scripts/check-plan-phases.js` 檢查：表存在、id 唯一、size∈{XS,S,M,L,XL}、depends_on 指向已存在 id 且無環、acceptance_cmd 非空且不含 TODO/TBD。取代：`## 4. Phases` 的純文字自由格式（舊計畫不回溯，lint 只對新計畫的 `--register-template` 後啟用）。負控制：缺欄、環、未知依賴三個壞表各 rc≠0。

**P2**：`scripts/lib/fleet-task.js` 新增 `create({parent, size, kind, after, text})`，包 `fleet dispatch <executor> --queue --after <id> --parent <id> --size <size> --kind impl <text>`。`plan-to-tasks.js` 讀凍結訊息 `[stage:plan/frozen] <path>@<sha>`，以 `git show <sha>:<path>` 取該版 phase 表（不讀工作樹），每 phase 一張子單，文字含 `Plan: <path>@<sha>`、`Phase: <id>`、acceptance_cmd，depends_on 對映 `--after`。凍結成立條件＝子單數等於 phase 數，不等則 exit 1 並列出缺的 id。冪等：以 `Plan@sha + Phase id` 在既有子單搜尋，已存在不重開。

**P3**：`plan-to-tasks.js --advance` 由 `fleet watch --until` 或 stage-advance 掛的 waiter 觸發：讀子單狀態，某 phase done 後若其後繼的全部前置皆 done，派下一張並 `fleet task update` 一行。取代：人工「做完再手動派下一張」的口頭規則。

**P4**：`fleet-task-ref.js` 的 pm-check 拿掉 `non-pm-console` 放行；`dispatch-hetero.sh` 在建立 worktree 與呼叫引擎之前呼叫 pm-check，失敗 exit 2；`checkPmFleetTask` 改為呼叫同一函式（去重）。保留：exempt 角色 `^(engine-qualify|probe-)`、inherited、bin-stub；fleet 不可用維持 fail-open（見 §2.5）。過渡旋鈕 `AUTOPILOT_FLEET_TASK_GATE=warn` 一個版本後移除。live 反向探針：在非 PM 席故意不帶 Fleet-Task 跑 dispatch-hetero，確認 exit 2 且無引擎行程啟動。

**P5**：`scripts/finish-triage.js` 輸入 task id 與 merged sha，檢查三格：merged（sha 在 develop）、live pin（hangar pin 讀回等於該 sha 或明列「不需上線」理由）、Used 證據行存在。分流：變更路徑落在 UI／互動／對外／首次上線清單（清單在腳本頂端常數）→ 呼叫 `open-decision.js open --kind look --look-target <JSON>` 附截圖路徑；純內部且測試紅綠與反向探針收據齊 → 輸出 `look: skip` 讓 task_result 直接交。`skills/finish-flow/SKILL.md` Checklist 第 7 項改為執行此腳本，刪掉重複的口述判斷。

**P6**：用真實計畫（fleet state-contract C2 或 codeforge R1 改版，由 PM 指定一個）走 P1→P5 全流程；對 P2（凍結缺一張子單）、P4（無單號）、P5（缺 Used）各做一次 live 反向探針並貼輸出。

## 5. Test / validation

腳本可驗：P1–P5 各有測試與負控制（先紅後綠）。需人看：P6 的真實計畫走完結果與 look 卡內容，以及 PM 驗收。全 affected-suites 在合併前跑，full suite 只在發版前跑。

## 6. Risks + inversion

- 閘放寬到所有 lane 後，某 lane 的合法背景派工被誤擋 → 緩解：exempt 角色保留、`warn` 過渡旋鈕、反向探針之外再跑一次各 lane 的正向派工。
- 要保證失敗：讓子單建立不冪等（重跑重複開單）→ P2 以 Plan@sha+Phase id 查重，並有重跑負控制。
- 子單文字與計畫版本漂移 → 只讀凍結 sha 的 bytes，不讀工作樹。
- fleet 故障時全擋 → fail-open 保留並有 stderr 紀錄。

## 7. Out of scope

UI viewport 截圖閘；plan loop g2 收斂改造；把 hangar pin 流程自動化（只讀回確認，不代換 pin）；回溯改寫舊計畫的 phase 區。

## 8. Open questions

- fail-open 要保留還是改 fail-closed？本計畫取保留（§2.5），如 PM 要改請在 plan loop 後指示。
- P6 的真實計畫由 PM 指定 C2 或 R1。

## Review log

- R0 author：autopilot--claude，2026-11-25。manifest 與 rubric 待 plan loop 建立（chair astra，非 Claude 兩家各一票）。
