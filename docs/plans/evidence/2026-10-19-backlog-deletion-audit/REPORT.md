# BACKLOG 誤刪與被埋 plan 稽核報告

稽核基準：develop @ 6f46a571c。唯讀；未改任何 repo 檔案、未 commit、未跑測試套件。
因此所有「已完成」的證據是 CHANGELOG 版本段、merge commit、程式碼或測試檔存在，不是重現執行。標「未確認」處不猜。
子稽核的逐列明細：`c/ d/ e/ g/` 底下的 `rows.tsv`、`sidecars.tsv` 與各自的 `REPORT.md`，plan 部分在 `f/buried-plans.md`、`f/archived-59.md`。

## 1. 一句話結論

roundtable 不是個案：5f3aa3b1d 是用腳本規則（Pointer 指到既存 plan／evidence 就刪列）一次刪 77 列，沒有逐列比對、沒有 receipt，其中 15 列 Status 是 open，至少 roundtable 2 列確定誤刪、另有約 11 列疑似未做完；加上之後 10-18 連旁註檔一起刪（95 個）與零星的列刪除，目前確認的「工作沒完成、觸發沒人追」共約 25 項，另有 3 份 plan 整份被埋、3 份半埋；所有項目都不擋別的工作，重要性集中在中低。

## 2. 刪除機制（附證據）

**5f3aa3b1d（2026-09-20，release v2.36.78）：是腳本規則自動刪，不是人工逐列判斷。**

- commit 訊息自述：「BACKLOG is a queue … one-time cleanup BACKLOG 216→139, 59 plans archived」（`git show 5f3aa3b1d -s`）。CHANGELOG `## v2.36.78`（CHANGELOG.md:1347 起）寫明新規則：「Pointer 指到既存 plan（本檔／sidecar／evidence dir）或 Status shipped/dropped 的列**刪除**，沒有保留期，歷史在 git」，並說明這次是「`--fix` 刪列」的一次清理（刪 77）。
- 腳本：`git show 5f3aa3b1d:scripts/check-plan-graduation.js`。
  - 檔頭 10–15 行：`backlog_row_has_plan`＝列的 Pointer「resolves to ANY path whose stem belongs to a plan that exists — the plan file itself, a sidecar, or anything under its `docs/plans/evidence/<stem>/` dir」。
  - 檔頭 16–17 行：`backlog_row_done`＝Status 以 shipped/dropped 開頭。
  - 檔頭 18–19 行：`backlog_title_closed_status_open`＝標題含 `~~`、CLOSED、SHIPPED、FIXED v、LANDED 但 Status 仍 open（檔頭 `Known limitations` 自承是純子字串比對，沒有字界）。
  - 檔頭 42 行起：`--fix` 直接刪這三類違規列。`planStemForPointer()`（原檔 436 行起）只做字串形狀比對與檔案存在檢查，**沒有任何一處檢查 plan 是否出貨，也沒有檢查 plan 是否承載列的 Trigger**。
- references/backlog-entry.md 的 Done handling（原檔 21 行）：「a row whose Pointer already resolves to an existing `docs/plans/*.md` is redundant with that plan the moment the plan exists. The fix is deleting the row」。也就是把「指向 plan」直接當成「已被 plan 接管」。
- 77 列的實際構成（我用 `git show 5f3aa3b1d^:docs/BACKLOG.md` 與 `5f3aa3b1d:docs/BACKLOG.md` 逐列比對得出）：**62 列 Status 為 shipped（命中 `backlog_row_done`）、15 列 Status 為 open**。15 列 open 中：13 列 Pointer 指向 plan 或 plan 的 evidence 目錄（命中 `backlog_row_has_plan`），2 列（openclaw 主訴求列、foreman context 列）因標題含 CLOSED／`~~` 命中 `backlog_title_closed_status_open`。
- receipt：commit 檔案清單（`git show 5f3aa3b1d --stat`）沒有任何刪除清單、對照表或 receipt。QC-Verdict 寫的是「second-family review of the full gate diff」：審的是腳本，不是這 77 列的內容。測試 `hooks/tests/check-plan-graduation.test.sh` 驗的是腳本在合成資料上的行為。
- 刪列時沒有比對「是否真的完成」：沒有，見第 6 節。

**後續疊加：b9caa7db6（2026-10-18）** 依 owner 裁定（card d-af2d9417）「旁註檔隨列一起刪」，刪掉 95 個 `docs/backlog/*.md`（理由：BACKLOG 沒有任何列提到它們）。其中約 29 個正是 5f3aa3b1d 刪列後才變孤兒的，所以第一次刪列時的內容（open 列的 Context／Trigger 全文）就在這裡永久離開工作樹，只剩 git 歷史。

## 3. C 類誤刪清單

### 3.1 commit 5f3aa3b1d（77 列）分類結果

| 類別 | 列數 | 說明 |
|---|---|---|
| A 已完成 | 60 | Status shipped 且我查到版本段／merge。逐列：版本都存在於 CHANGELOG（`grep '^## v<ver>'` 全中，`/tmp/.../rows5f.txt` 與 `chk.js` 的關鍵字重疊檢查），6c77dc6b（docs 規則 §38）、v2.35.5 merge d5408f5ef（wall cap 與 grant replay 兩列）、`tests-only` 列亦各自有對應。抽查 v2.36.33、v2.36.72、v2.36.50、v2.36.37 段落內容與列相符。 |
| A（Status open 但實為已關） | 1 | foreman context 列：標題已刪除線，CLOSED 2026-09-05 v2.36.1（`tmpfs live file` 路徑，plan 已歸檔）。 |
| B 已轉移 | 2 | 「Contract-first escalation … class (a) REMAINS OPEN」→ HEAD 的 BL-0035（Trigger-Type owner，docs/BACKLOG.md:177）；「Roster qualification remaining legs」的 brain re-sit 部分 → 「Brain-seat sittings in the shipped qualification defaults」（docs/BACKLOG.md:205）。 |
| C 被埋（確認） | 2 | roundtable 兩列。 |
| C 疑似（程式碼現況仍見該缺陷，未重現） | 9 | 見下表。 |
| C 低（殘項沒人追） | 1（另 explorer 為跨類，見下） | openclaw 兩個副作用（g 組 C1 亦獨立得出）；explorer suite 殘項見表 3.2 #13。 |
| 未確認 | 2 | `_pf_err` 洩漏（現況 `scripts/dispatch-review.sh:365,385` 兩個分支都已 `rm -f`，疑已修）；codex 回 qc panel pin（觸發日 2026-09-19 16:26 已過，`.claude/review-loop-config.md:57` 現有 gpt-5.6-sol 席，無法判斷是否已走完 live cleanroom 驗證）。 |

說明：Roster qualification 那一列（原 Status shipped）一列兼跨兩類：brain re-sit 部分算 B，explorer suite 部分算 C 低，計數時只算一次（歸 B，explorer 另在表 3.2 #13 列出）。77 列＝A 60＋已關 1＋B 2＋C 確認 2＋openclaw C 低 1＋疑似 9＋未確認 2。

### 3.2 C 類逐項（5f3aa3b1d）

建議 Trigger-Type 取自 `references/backlog-entry.md` 的 `date:YYYY-MM-DD｜owner｜event｜ready｜peer`。Source 欄是原列 Source。

| # | 原標題（縮） | 為什麼算誤刪 | 重要性 | 建議 Trigger-Type |
|---|---|---|---|---|
| 1 | roundtable Phase 1 — `/roundtable` skill | Status open、Effort L、Source operator 2026-09-19（owner 說「先寫成 plan 留 backlog，多經歷幾輪再繼續」）。plan 狀態欄寫「parked in BACKLOG until ≥3 more manual rooms」，但承載它的列被刪；INDEX 只有 active 無 Trigger。CHANGELOG 無 roundtable、無 skills/roundtable，確定沒出貨。**確認被埋。** | 中（owner 親自要求留著） | event（≥3 場 room 或 owner 點名要 skill）；Pointer 不要再指 plan 檔，否則下次 `--fix` 又刪 |
| 2 | roundtable — 非 Claude seat 要走 switchboard courier handle | Status open、Effort S、Source Phase 0 finding F1，Trigger「下一場 room 有非 Claude harness」。Pointer 指 evidence 目錄，被視為 plan 而刪。 | 低到中 | event |
| 3 | openclaw 回報的兩個副作用 (a) 拒絕時報 released 但 durable 狀態留 `live_lease` (b) `verify_cmd` 繼承的 PATH 缺工具該歸 precondition | 主訴求 v2.36.28 已出貨，標題含 CLOSED 讓整列被刪，(a)(b) 仍開。Source peer（openclaw）。HEAD 只剩 docs/plans/2026-09-12-integration-ledger-and-marker-gates.md:118 一句 "Logged, out of scope"，指向已刪的旁註檔。(a) 可能被 v2.36.71 部分覆蓋，未確認。peer 的重現檔在其主機。 | 中 | peer |
| 4 | Managed rail: already-scrambled carry-only ledger segments cannot project（reader recovery） | Status open、Effort L，Source 2026-09-16 l5 plan（writer-only 先出貨，reader 刻意留後）。HEAD 無追蹤；歸檔 plan 與 evidence 才有。CHANGELOG v2.36.78 之前之後均無 reader recovery。 | 中（L、host 帳本已受影響） | event（host 帳本出現 `event input artifact must match …`） |
| 5 | Managed rail: `no_verdict` 使 phase 停在 REVIEWING，`--resume` 拒絕 | Status open、M，1b-B campaign 實測。`grep` HEAD 的 CHANGELOG 查無後續修復。 | 中 | event |
| 6 | Managed rail: `changed_files >= max_changed_files` 在 hand 動了所有 sealed path 時拒絕 repair | Status open、Fix。`src/engine/autopilot-engine.js:8479` 仍有 `campaign mutation budget exhausted`。docs/plans/2026-09-17-blind-review-cleanroom-intake.md:202 仍只是提及。 | 中低 | event |
| 7 | `next-touch-validation.test.sh` 在 rail 的 detached 驗證 checkout 讀 `symbolic-ref HEAD` 必紅 | Status open、S。`hooks/tests/next-touch-validation.test.sh:1765` 仍有 `symbolic-ref -q --short HEAD`；是否仍在 detached 下紅：未確認（不能跑）。 | 低 | event |
| 8 | Managed rail: red `campaign_verification` 只留 digest，失敗指令與輸出遺失 | Status open、S。HEAD 查無修復（`keeps only digests` 零命中）。 | 中低 | event |
| 9 | Managed rail: graph-check 放行 `max_wall_seconds` 到 14400，契約 schema 上限 7200，intake 燒掉一次 grant | Status open、Fix。`schemas/mission-execution-graph.schema.json:147` 仍是 14400，`schemas/implementation-campaign-contract.schema.json:112` 仍是 7200，**不一致仍在**。docs/plans/2026-09-17-blind-review-packet-engine.md:216 提及為 "Rail defect (2)"。 | 中（會燒 grant） | event |
| 10 | Managed rail: ADJUDICATING／VERTICAL_VERIFICATION resume 在 git-drift 檢查前就花掉 Mission claim | Status open、S，Source plan §6（被 rubric R6 排除）。只在已歸檔的 disposition-resume-scope-sha 計畫裡。 | 低 | event |
| 11 | Managed rail: reviewer 自撤 MUST-FIX 且重用 finding id 被當 no_verdict | Status open、S。`src/engine/product-review-normalizer.js:47` 仍有 `duplicate product review finding` 拒絕。 | 低 | event |
| 12 | Managed rail 不傳 scorecard scope 檔，`fallback_ladder` 永遠是 `[]` | Status open、S。是否仍在：未確認（v2.36.46 選了常設 pin 的修法，沒有讓 rail 傳 scope 檔；`src/engine/autopilot-engine.js` 內 `--check-scorecard` 路徑仍在）。 | 低 | event |
| 13 | Roster qualification 剩 Explorer formal suite | 原列 Trigger「Explorer formal suite — before autonomous routing claims for that role」。HEAD 的 BACKLOG 無 explorer 字樣，其他 plan 只當範圍外。 | 低 | event |

另有兩項我未能判定、但值得 owner 單獨看一眼：#14 `dispatch-review` cleanroom `_pf_err` 洩漏（疑已修）；#15 Codex 回 qc panel pin 交換（觸發日已過，等 live cleanroom verdict）。

## 3.3 其他大量刪除的 C 類（由子稽核得出，我抽查了 4e86b6658 與 9d0fbc9bc 的說法）

| 來源 commit | 原標題 | 為什麼算 | 重要性 | Source | 建議 Trigger-Type |
|---|---|---|---|---|---|
| 41f1bff64（連同 sidecar `live-state-dir-context-budget-test-strength-…-of.md`） | A stale topology tuple derails a plan-review loop（topology 記了失效的 `qwen3.8-max-preview@qoderclicn`，wrapper exit 3 且 stdout/stderr 皆空） | 2026-09-14 遷移 e70de5492 把舊 BACKLOG 尾端四段整段倒進最後一個 sidecar，從此只活在該檔；41f1bff64 刪檔時沒檢查。兩個緩解（`resolve-dispatch-topology.js` 用 `--list-models` 驗證；wrapper 露出 runner stderr）HEAD 皆未做。 | 中（M） | self | event |
| 41f1bff64（同上） | `consult_dispatch` 在 qc panel 吃光 roster 後沒席位 | `scripts/resolve-review-loop.sh:1305-1313` 仍退到 `sonnet/high@claude-native`，`dispatch-consult.sh` 隨後拒絕。 | 中（S） | self | event |
| 061cc11c7 | BL-0026 per-hook × per-harness 支援矩陣附驗證日期 | 只做一半：腳本出貨但所有格都是「未驗證」，60 天過期檢查沒進 preflight／CI。 | 中（S，Source owner 2026-09-07） | owner | date／event |
| 7c82382a6 | BL-0020 openclaw：agy flash/low implementer no-go | 弱 C。peer 的 `Reply: none` 從未回覆；事實只存在這一列。 | 低 | peer | peer |
| e05a1edc3（連同 sidecar `v2-34-37-first-pass-review-cut-list.md`） | BL-0039 旁註 (7)(8)：instant2 fixture 重錨、filter 不驗 engine/runner/role | 本體修了，旁註兩項被連檔刪除。 | 低 | self | event |
| 5d0b29c1d | Engine-routing axis — evidence bar for ANY model→worktype default | 「站著的規則」，證據只在個人 memory，repo 搜不到，現行 `Domain-aware routing` 列（docs/BACKLOG.md:374）失去先決條件。 | 中（規則類） | self | event |
| 5d0b29c1d | 官方 codex plugin 作同級 consult 通道的 Spike | consult 通道已出貨，`/codex:review` 校準與 `rescue --write` 沙箱姿態無後繼列。 | 低 | self | event |
| 5d0b29c1d | PostToolUse dispatch dies after `/clear` | 文件出貨，偵測 spike 與上游回報沒做。 | 低 | self | event |
| 5d0b29c1d | Investigate `/reload-plugins` hook count discrepancy | 外觀問題，S 級調查從未做。 | 低 | self | event |
| 5d0b29c1d | agy install symlinked-dest self-copy truncation 上游回報 | 需 owner 帳號與身分同意才能送。 | 低 | self | owner |
| 5d0b29c1d | dispatch 大型 calibration scratch 改走非配額路徑（usrquota 事故 (d)） | (d) 沒做；repo 找不到產生 `swe-calibrate-*` 的腳本，可能已不存在。 | 低 | self | event |
| a1cc180cb（10-19） | BL-0109 mods P1a 殘項：watcher roots set 無上限（P3 負責） | 見第 5 節。 | 低（🔵 級） | self | event（P3 開始） |
| f2955b99e（10-13）旁註 `shared-sealed-zero-diff-validator.md` | `engine implement-review` 的 `verify_pass=false` 不阻塞，可在 reviewer SHIP 下收斂 | 2026-07-24 codepower 實測；`src/engine/autopilot-engine.js:12117-12175` 仍會以 `convergenceReason='reviewer'` 收斂（g 組讀碼，未執行）。 | 中低 | peer（codepower） | event |
| b9caa7db6 旁註 `v2-36-112-review-follow-ups.md` 等 | 一批 🔵 殘項（`RUN_LEDGER_MAX_ROTATIONS` 讀 sweep 環境、symlink 逃逸拒絕、B3 拒絕碼無測試等） | HEAD 無追蹤。 | 低 | self | event |
| b9caa7db6 旁註（另 4 個，Effort S） | `--min-reviewed-seats` 多席執行測試、`campaignControl.initial_state` 命名、governance CLI 拒絕訊息 UX、等 | g 組列為 C 低。 | 低 | self | event |

另有「未確認」：902542671 的 Pre-existing red suites（`qualification-scorecard-tools` r51/r52 沒有 commit 點名修，請 owner 單跑一次）；f2955b99e 的 suite oracle lock 第二例、`dispatch-watch` 腳本是否被替代物等價取代；5d0b29c1d 的 Depth-0 loop hardening 與 OS-sandboxed hetero reviewer（cc-shim／grok 仍 best-effort）。

另一件小事（我自己查到）：`CLAUDE.md:124` 仍寫「details in `docs/backlog/hooks-tests-run-sh-is-red-on-develop-sealed-campaign-verify-cmd-is-unsatisfiable.md`」，該檔已在 a1cc180cb 被刪，**參照懸空**。`docs/projects/INDEX.md:531` 對 Fable skills absorption 列仍寫 "tracked in docs/BACKLOG.md"，亦已不實。

## 4. 被埋掉的 plan

來源：`f/buried-plans.md`（檢查了 docs/plans 頂層 65 份狀態欄不是 shipped 的主 plan，HANDOFF.md 無一追蹤；INDEX 自 v2.36.80 起每份 plan 都有登記列，但列只寫 `active`，沒有 Trigger，所以「INDEX 有列」不算被追蹤）。其餘約 43 份只是狀態欄過期（實已出貨）、約 10 份已有 BL 列、5 份屬手冊／調研／已棄。

**整份被埋（3 份，其中 2 份是同一件事）**

| plan | 狀態欄 | 未完成 | 建議補回 |
|---|---|---|---|
| docs/plans/2026-09-19-roundtable.md | Phase 0 done，parked in BACKLOG until ≥3 more manual rooms | Phase 1（L）、Phase 2（S，hangar 跨 repo 慣例）、Phase 3（relay 層 room，plan 內寫 "deferred; BACKLOG"，BACKLOG 已無） | 見 3.2 的 #1、#2 |
| docs/plans/2026-08-26-cursor-cli-adaptor.md 與 2026-09-02-cursor-transport-fallback.md | adaptor 狀態欄過期（rail 已出貨 Phase 1-4）；fallback：Phases 1-4 shipped，Phase 5 BLOCKED | cursor implementer 資格考刻意未跑；cursor 席位准入被擋（`UNQUALIFIED_RUNNERS="cursor"`，cursor-agent 無法強制 tool-deny）。BACKLOG 無任何 cursor 列 | 一列：Trigger「cursor-agent 發新版且宣稱有 catch-all deny／可攜 sandbox，重跑 docs/plans/evidence/2026-08-29-cursor-containment-probe 的 18 個探針；或 owner 授權花錢跑 Stage-1」，event，Effort M（f 組推估，未確認） |

**半埋（3 份：INDEX 進行中表有列，但只寫 active，plan 內有未做 phase 且原 BACKLOG 列已被 gate 刪）**

| plan | 未做且無追蹤 | 建議 |
|---|---|---|
| docs/plans/2026-10-03-mods-visible-dispatch.md | P2（hook 延遲先量）、P3（`wake-events`、idle）、P4（`portfolio-replan`、work-round）；相關腳本皆不存在，plan 內無「不做」裁決；可能已被 stage-graph 路線取代：未確認 | 一列「mods P2–P4 做或撤」，owner，Effort L |
| docs/plans/2026-10-13-dispatch-tree.md | step 5 與 R 被 D0 探針擋住（row h、row d2 對 kimi/agy/opencode not_run）；僅 fleet step 有 BL-0144 | event，Effort M |
| docs/plans/2026-10-13-workflow-snapshot-at-compaction.md | P3（`/handoff` 讀快照、dev-flow 呼叫 task-card）deferred，原列在 0a9c9efac 被刪；BL-0147 不涵蓋 | owner，Effort S |

**59 份被 5f3aa3b1d 歸檔的 plan**（`f/archived-59.md`，全數逐份看過）：51 份出貨（約 20 份狀態欄過期寫 Proposal／Draft，歸檔正確）、4 份刻意縮減出貨（skill-leverage-extraction、parallel-read-fanout、review-verify-barrier、trust-tiered-review-policy）、1 份未確認、3 份可疑：
- `2026-05-14-eval-router-judge`：Proposal，CHANGELOG 只說寫了 plan，harness 沒建，BACKLOG 無追蹤（INDEX 把它標成 "referenced in CHANGELOG"，等於當成已吸收）。重要性低。
- `2026-06-23-l4-l5-dep-graph-fanout`：DESCOPED，CHANGELOG 命中只是分支名；/l5 異質 fan-out 由 BL-0070 追蹤，**不算被埋**。
- `2026-09-04-default-dispatch-topology`：P0–P4 於 v2.35.16 出貨，P5「逐主機 rollout（cuda 優先）」無追蹤。低到中。
- 未確認：`2026-07-02-engine-capability-state`，CHANGELOG 命中都只是別的版本引用其腳本，無法證明 R0 整份範圍被執行。

## 5. 2026-10-19 當天刪除逐列核對

| commit | 刪除列（BL-id） | 核對結果與證據 |
|---|---|---|
| a1cc180cb（054c4344b 的 closeout merge 內含；11 列＋11 個 sidecar） | BL-0022、0072、0074、0075、0076、0087、0122、0160、0201、0203 | **A 已完成（10）**。各有 merge：b79bca63f(0022)、f5aae62d7(0072)、abae3d36c(0074)、8930cd859(0075)、a007fa65e(0076)、16a406dc8(0087 option B)、a8dac5e62(0122)、36abe7bdd(0160)、6c5929433(0201/0203)。對應檔案／機制確認存在：`scripts/lib/gitconfig-containment.sh`、`hooks/tests/orchestration-oracle-isolation.test.sh`、`hooks/lib/brief-head.js`、`scripts/replay-test-integrity.js`、`hooks/tests/t7-config-fixture-clean.test.sh`、`src/merge/cli.js` 的 receipt-dir、`src/engine/review-increment.js` 的 `prior_path_removed`、`scripts/affected-suites.js --run`。CHANGELOG Unreleased 逐項有條目。 |
| 同上 | BL-0109 mods P1a known follow-ups | **C 低**。CHANGELOG 無此列的條目；列 Context 寫明「everything fixed except the watcher roots-set bound (P3 owns it)」，Trigger「P3 start」。HEAD 的 mods/live 只見 `MAX_CAMPAIGN_ROOTS = 8`（`mods/live/register.ts:60`，是另一件事），沒找到 watcher roots set 的上限。性質是 🔵（原 review 稱 harmless）。 |
| 8f70a7510 | BL-0050 outcome-shaped quality gate | **B**。內容轉到 docs/plans/2026-10-19-outcome-quality-gate.md（有 Source 句註明原列），INDEX 有列；功能已由 merge 9f1c1a2dc 出貨（opt-in，CHANGELOG 有條目）。注意：該 plan 狀態欄仍是 `active`（狀態過期），屬第 4 節那類。 |
| 7c4a31a1c（bl0212 merge）/ 517fbe910 | BL-0012 typed `worker_condition` | **A**。merge 517fbe910「dispatch rail emits a waiting condition」，由 bl0212 merge 時一併移除列與旁註檔。 |
| 621f61a37（closeout3） | BL-0212 next-pick 不看 Trigger | **A**。merge 7c4a31a1c 出貨 Trigger-Type 與 next-pick 排除邏輯。 |
| 6f46a571c（closeout4） | BL-0202 附錄重複列舉 | **A**。merge b8bdd61f3，CHANGELOG 有條目與測試。 |
| 同上 | BL-0027 Codex dev-mode hook entry | **A**。merge d997355a9，CHANGELOG 有條目。 |

10-19 當天未發現 open 工作被刪，唯一例外是 BL-0109（低）。同日另有 BL-0060、BL-0050 的 CHANGELOG 條目支撐 3dc4a426c／621f61a37 的收尾。

另提醒：4e86b6658（10-17）一個 commit 誤切 8 列（只該動 BL-0205），隔天由 53eafe87d 整份還原（commit 自認 "bad slice"）；這是靠偶然發現，沒有機制擋。9d0fbc9bc 有 1 列（context-budget no model-id window）是先刪後才緩解（2fafa2fa7 只加註解、v2.36.107 才緩解）。

## 6. 缺口分析：哪一步沒有比對

1. **刪除判準是「形狀」不是「事實」**。`backlog_row_has_plan` 只問「Pointer 解析到存在的 plan 檔／sidecar／evidence 目錄嗎」。它沒有問：plan 出貨了嗎？plan 有沒有帶走這一列的 Trigger？evidence 目錄裡的 README 是紀錄，不是追蹤者，卻被當作 plan 接管。
2. **Status 欄被當真，沒有第二來源比對**。62 列 shipped 沒有逐列對 CHANGELOG 或 merge（我事後比對大多正確，但 contract-first 那列 Status 標 shipped、標題卻寫 class (a) REMAINS OPEN，就是欄位與內容矛盾，腳本看不到）。
3. **標題子字串規則**（CLOSED、`~~`、SHIPPED）把「主訴求已關、副作用仍開」的列整列刪（openclaw、foreman context）。
4. **刪除沒有 receipt**。commit 沒有「被刪列 → 刪除依據（merge sha／plan 段落）」對照表；QC 審的是腳本。CHANGELOG 只記數量（刪 77）。要事後判斷刪得對不對，只能像這次一樣重做比對。
5. **旁註檔隨列刪（10-18 b9caa7db6）放大了後果**：列刪掉時還有旁註檔保留 Context；旁註檔也刪後，open 列的完整敘述只剩 git 歷史。遷移 e70de5492 還把四段舊內容倒進單一 sidecar，刪檔時無人檢查檔內有 `##` 子段。
6. **plan 側沒有反向約束**：plan 狀態欄 active／parked／Phase N done 時，沒有任何檢查要求有一列帶 Trigger 的 BACKLOG 列或 INDEX 欄位；INDEX 自 v2.36.80 起成登記簿，每份 plan 都有 `active` 列，這反而讓人誤以為被追蹤。
7. **其他大量刪除多是「依 plan／merge 訊息宣稱」做**：9d0fbc9bc 等沒有對照表，要靠 hands commit 訊息與 CHANGELOG 反推；除 5f3aa3b1d 外，抽查後這些 commit 的列幾乎都真的做完（A 類佔絕大多數），誤刪主要集中在「連旁註檔一起刪」與「改寫／縮小列時漏帶殘項」兩種形狀。

## 7. 建議的防範機制（只列候選，不做）

- 候選 1：`backlog_row_has_plan` 改成只在「plan 已出貨（CHANGELOG 已釋出段命中）或 plan 內含該列 Trigger 原文／Trigger-Type」時才刪；否則改成報告，不刪。
- 候選 2：任何 Status ≠ shipped/dropped 的列被刪，要求 `--fix` 產出 receipt（列 id、標題、Trigger、刪除依據：merge sha 或承接位置）並入 commit；沒有依據就拒絕。
- 候選 3：刪除前把 Status shipped 與 CHANGELOG／merge 做第二來源比對（至少版本段存在且與標題關鍵字有交集——我事後用過的 `chk.js` 即是簡版）。
- 候選 4：去掉標題子字串規則，只信 Status 欄。
- 候選 5：plan 側閘門：狀態欄為 active／parked／partial／Phase N done 的 plan，要求 BACKLOG 有帶 Trigger 的列指向它，或 INDEX 進行中表有 Trigger 欄；INDEX 登記簿加 Trigger／Next 欄。
- 候選 6：旁註檔刪除檢查：檔內有未結的 `##` 子段或 Trigger 時，必須先證明已進列／plan，才允許隨列刪；遷移時一律一列一檔，不允許把多段倒進同一 sidecar。
- 候選 7：負控制（CLAUDE.md 規則）：在 `check-plan-graduation.test.sh` 植入「Status open、Pointer 指向未出貨 plan、Trigger 不在 plan」的列，要求 `--fix` 後它必須存活，先紅後綠。
- 候選 8：一支定期稽核腳本，掃 `git log -p -- docs/BACKLOG.md`，列出所有「被刪時 Status ≠ shipped」的列，與 receipt 對照，缺 receipt 的報給 owner。
- 候選 9：plan 狀態欄與 CHANGELOG 同步（約 43 份 plan 狀態欄過期，讓人分不出「過期」與「被埋」）。
- 候選 10：修懸空參照（`CLAUDE.md:124`、`docs/projects/INDEX.md:531`），並把 `check-claude-md-inventory.js` 類的存在性檢查擴到指向 `docs/backlog/` 的連結。

## 附：方法與限制

- 5f3aa3b1d 的 77 列由我直接比對 `5f3aa3b1d^` 與 `5f3aa3b1d` 的 `docs/BACKLOG.md` 取得；子稽核各自以相同工具（`rows.js`）處理其餘 commit，C 組（Sep-Oct）10 個、D 組（Oct 13-17）17 個、E 組（Jun-Aug）10 個，加上 G 組 95 個旁註檔，以及 F 組 plan 稽核。
- 沒有執行任何測試套件與重現，所以「疑似未修」皆是「現況程式碼仍見該行為」而非「已重現」。
- 子稽核對 B 類只確認「搬到哪」與「後來下場」；對 5d0b29c1d 維持原標題但內文被改寫的列，未比對改寫前後的觸發條件是否保留。
- 我沒有逐個覆驗子稽核的所有 A 類結論，只抽查 4e86b6658／53eafe87d、9d0fbc9bc 的先刪後修說法、BL-0035/0070 等追蹤列的存在。
