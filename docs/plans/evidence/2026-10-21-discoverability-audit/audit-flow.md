# 可發現性盤點：flow 組

範圍：CLAUDE.md 的「Mission, campaign & session state」「Worktree & branch lifecycle」「Diff scanning & anti-gaming」「Verification & review synthesis」「Task tree & risk」五組，共 97 項（含 lib/）。
其中 17 項第一輪已判（session-mode、stage-advance、stage-graph、decision-ledger、probe-unknown、record-integration、check-containment、check-inputs-landed、watch-foreman、agent-liveness-check、check-stall-fuse、build-rehydration-bundle、run-approval、task-card、compaction-rehydrate、open-decision、pin-evidence-anchors），直接引用第一輪結論、不重列。本輪判 80 項。

## 白話總結

這五組比 mods 那邊健康很多：80 項裡有 53 項入口有教或自動被呼叫。真正的缺口集中在兩處：(1) 「該叫 agent 跑、卻只剩一列表格、沒有任何步驟或自動呼叫端」的測試作弊／驗證類腳本；(2) 幾支沒有任何人會跑的孤兒腳本。

計數（本輪 80 項）：

| 類 | 數量 | 備註 |
|----|------|------|
| A 自動 | 11 | |
| B 入口有教 | 47 | 其中 5 項是「B 但弱」，放進主表 |
| C 只有事後提醒 | 0 | 本組沒有只靠 hook 擋下才講的 |
| D 找不到 | 1 | admit-backlog-follow-ups.js |
| E 不需 agent | 16 | 內部 lib、桌面按鈕、一次性測試輔助 |
| F 死碼嫌疑 | 5 | |

最嚴重的 3 項：

1. `check-test-integrity.sh`／`check-holdout-coverage.sh`／`verify-red-green.sh`：全 repo 沒有任何自動呼叫端，quality-pipeline 的「步驟」段也沒叫 agent 在哪一步跑，只剩 Available Scripts 表一列。而表上說「esp. delegated / `/l5` hetero dispatch」，l5／l6／dev-flow／ceo-agent 的 SKILL 與 references 對 `check-test-integrity` 零命中。委派實作者改壞測試正是它要擋的事。
2. `next-pick.js`：只有 `skills/next/SKILL.md:122` 的小節有教，而那一節自己寫的是「CEO／l4–l6 idle transition 的自主路徑」；ceo-agent、l3–l6 完全沒指過來。CEO 閒下來時沒人告訴 depth-0 要跑它，改靠判斷力挑下一件事，既不進決策帳，也不遵守「L/XL、urgent、board、hard-problem 一律先問」的規則。
3. `admit-backlog-follow-ups.js`：把 review 組合／campaign 收據的 follow-up 寫進 BACKLOG 的唯一機制，入口零命中（`references/reviewer-mvp-portfolio.md` 只說「LSM P4 是 admit 的權威」，沒點名腳本）。結果是 follow-up 要靠 agent 手寫 BACKLOG 列，繞過指紋去重、藍色嚴重度排除、必須有 Trigger 這三條規則。

---

## 主表

排序：agent 會做錯／漏掉保護的在前，其次是孤兒。

| # | 名稱 | 它做什麼 | agent 何時該用 | 判定＋證據 | 建議放進哪個入口 | 不用會怎樣 |
|---|------|----------|----------------|------------|------------------|------------|
| 1 | `scripts/check-test-integrity.sh` | 讀 git 物件（不讀 worker 自述）檢查 `base..head` 是否刪除、skip、solo、弱化既有測試，或把 fixture／設定逃逸出測試 | 委派實作（/l5、/l6、hetero hands）收貨後、合併前 | **B 但弱**。唯一指示是 `skills/quality-pipeline/SKILL.md:49` 表格列「After impl, before merge — esp. delegated / /l5」與 `references/test-integrity-gate.md:20`。QP 的步驟段（第 95–175 行）沒有一步呼叫它。零自動呼叫端：`grep -rn "check-test-integrity" src hooks scripts bin .githooks`（排除測試與 config-keys）只剩 `scripts/replay-test-integrity.js:12` 與 lib 自己。`grep -rn "check-test-integrity\|test-integrity" skills/dev-flow skills/l5 skills/l6 skills/ceo-agent skills/finish-flow agents` 只命中 `ceo-agent/references/depth0-control-loop.md:252`（提到一個 BACKLOG）與 `level-front-door.md:377`（block-mode override 延後），都不是「何時跑」 | `skills/l5/references/hetero-impl-loop.md` 的收貨步驟（hands 回來、合併前）加一行 `check-test-integrity.sh validate --range <base>..<head>`；`skills/quality-pipeline/SKILL.md` 步驟段在 Tests 之後加一步；dev-flow 的 finish 節點引用 | 實作者刪測試或加 skip 讓綠燈，depth-0 只看到綠。evidence-discipline §58 記的 300 套件盲點就是這類 |
| 2 | `scripts/check-holdout-coverage.sh`（含 `probe-mutation.js`、`verify-strength.js`） | 高風險 diff（`classify-diff-risk.sh` 報 adversarial_review）要求有 SHA 綁定的突變／強度探針收據，缺、壞、過期一律擋 | 高風險 diff 實作後、合併前 | **B 但弱**。`skills/quality-pipeline/SKILL.md:48` 表格列、`references/four-layer-design.md:25`。無自動呼叫端：`grep -rn "check-holdout-coverage" src hooks scripts bin .githooks` 排除測試後零命中。`probe-mutation.js`／`verify-strength.js` 自身屬 A（被它呼叫：`check-holdout-coverage.sh:63,68`）| QP 步驟段：先 `classify-diff-risk.sh`，報 high 才跑 holdout；同在 l5／l6 收貨步驟 | 高風險改動（四層設計的 K3）沒有保留集驗證，只剩實作者自己看過的測試 |
| 3 | `scripts/verify-red-green.sh` | 在隔離的 detached worktree 證明：新測試在 head 為綠、在 base+tests 為紅（否則測試沒測到改動） | 新增或修改測試後，判斷這些測試是不是真有作用 | **B 但弱，且觸發條件含糊**。`skills/quality-pipeline/SKILL.md:52` 寫「When judging whether new tests actually test the change」，`references/test-policy.md:57-59` 有指令。沒有「哪個尺寸、哪一步必跑」；零自動呼叫端（`grep -rn "verify-red-green" src hooks scripts bin` 排除測試：`scripts/` 內只有 lib 自己） | `test-policy.md` 與 QP Tests 步驟寫明觸發條件（例：diff 新增測試檔且為 M 以上）；`skills/test-strategy/SKILL.md` 同樣沒有任何腳本（見下方備註） | 新測試恆綠（空斷言、測錯東西）過關 |
| 4 | `scripts/next-pick.js` | `parse` 從 docs/BACKLOG.md 抽候選列，`pick` 以確定性規則排序（使用者類別權重優先、L/XL／urgent／board／hard-problem 一律先問），結果連同 pick-record 寫進決策帳 | CEO／l4–l6 在沒有使用者下自行挑下一件事（idle transition） | **B 但只教一半**。唯一入口 `skills/next/SKILL.md:120-132`（自主 auto-pick 小節）。呼叫端應是 depth-0，但 `grep -rniE "idle transition\|auto-pick\|next-pick\|autopilot:next" skills/ceo-agent skills/l3 skills/l4 skills/l5 skills/l6 agents` 僅命中 `depth0-control-loop.md:400,412`（說決策帳要記 auto-pick，沒說用哪支）、`level-front-door.md:49`（task-class）。程式端只有讀取方（`src/status/decisions-sidecar.js:84`、`sources-manifest.js:68`、`check-blueprint-conformance.js:61`），沒有任何程式或 hook 呼叫 pick | `skills/ceo-agent/references/depth0-control-loop.md` §6（決策帳）旁加一句「idle 要自己挑下一件事，跑 `next-pick.js parse` → `pick`」；l4–l6 front door 同步指向 | CEO 自行用判斷挑任務：無決策帳紀錄、不守 ask-first 規則、面板「自動裁決」那條永遠空 |
| 5 | `scripts/admit-backlog-follow-ups.js` | 從規範化的 review 組合或通過 schema／digest／panel 驗證的 campaign 收據，把 follow-up 寫進 BACKLOG：指紋去重、拒 🔵、拒無 Trigger | 一輪 review 或 campaign 結束、要把剩餘 follow-up 轉成 BACKLOG 列時 | **D**。`grep -rn "admit-backlog-follow-ups" skills agents AGENTS.md references src hooks bin`（排除測試與 inventory）零命中；程式端只有 `scripts/dispatch-experience-critic.sh:14` 一句註解說「本檔不用它」。`references/reviewer-mvp-portfolio.md:95` 說 LSM P4 才是 admit 權威，但沒有任何入口點名這支。對照：`depth0-control-loop.md:517-519` 教的是「brain 手動把 accepted rows append 到 docs/BACKLOG.md」 | `skills/ceo-agent/references/depth0-control-loop.md` 第 517–519 行改成「用 `admit-backlog-follow-ups.js --input <portfolio|campaign.json> --backlog docs/BACKLOG.md --current-ticket <id>`」；`references/reviewer-mvp-portfolio.md` §Backlog candidates 加指令 | BACKLOG 列手寫：重複、含 🔵 噪音、缺 Trigger，違反 check-backlog-entries 的規則 |
| 6 | `scripts/check-dispatch-suppression.sh` | 掃任何 dispatch prompt 有沒有「教 reviewer 少報／預先定嚴重度」的壓制語法，exit 1 要剝掉重派 | 每次派 reviewer 前（含第 1 輪；`check-redispatch-prompt.sh` 只管第 2 輪起） | **B 但弱，且沒有人跑**。唯一入口 `references/blind-dispatch.md:250`（寫「runs on any dispatch prompt」）。QP 的 Available Scripts 表列了 `check-redispatch-prompt.sh`（第 44 行）卻漏了這支。`grep -rn "check-dispatch-suppression" src scripts hooks bin` 排除測試只剩兩個姊妹腳本的註解（`check-redispatch-prompt.sh:25`、`check-blind-evidence.sh:10`）；`dispatch-review.sh`／`dispatch-hetero.sh` 都不呼叫它 | QP 表加一列；`skills/ceo-agent/references/depth0-control-loop.md` 派 reviewer 前的預檢段（第 257 行 `check-blind-evidence.sh` 旁）加並列一行 | 派工 prompt 夾帶「這類算 minor」之類話術時無人攔，reviewer 被帶偏 |
| 7 | `scripts/ladder-run.sh` | 驗收委派階梯（T0→T1→T2）的一輪：實作 → 去相關隔離 verify → 發出 QC 事件 → 抽樣旗標 → 晉升「建議」 | 看來是外部消費端專案（標頭寫 fuchikoma 的 `docs/ladder/state.json`、llm-playground 的 qc_metric.py）的驗收實驗 | **F**。`grep -rn "ladder-run" skills agents AGENTS.md references src hooks bin scripts`（排除自身與測試）：只有 `scripts/tmp-residue-allowlist.json:107`。入口零命中；只有 `docs/ladder-run.md` 與 inventory | 若確定是外部專案專用，從 CLAUDE.md 清單移到「opt-in／external」並在標頭寫明；若已不用，退役 | 不用不會怎樣；但它佔著 Verification 清單，讓人以為 QC 階梯在運作 |
| 8 | `scripts/qc-metric-emit.js` | 把一筆 QC 審查事件 append 到 llm-playground 擁有的逃逸率 JSONL 存放區（沒設 store 就 no-op） | 標頭說「depth-0 QC panel run 與 publish hetero-review run 可以記錄」 | **F，且與文件不符**。inventory 與標頭都說 emit site 有 depth-0 QC panel，但 `grep -n "metric" scripts/qc-panel.js` 零命中；`grep -rn "qc-metric-emit\|QC_METRIC_STORE" src hooks skills references agents scripts/qc-panel.js scripts/dispatch-*.sh bin` 零命中，只有 `ladder-run.sh:215,306` 呼叫 | 要嘛把 qc-panel 接上（若量測仍要），要嘛改 inventory 與標頭說明目前只有 ladder-run 會 emit | 逃逸率量測沒有資料來源，晉升閘門（見項 7）是空的。這是「寫好卻沒接線」的典型 |
| 9 | `scripts/check-escalation-coverage.js` | 檢查 escalation 帳（`docs/projects/<proj>/tree/events.jsonl`）五個出口點（playbook_no_match、adjudication_unvalidatable、panel_irreversible_disagreement、plan_revision_trip、depth0_override）的覆蓋，`--gate` 可當閘門 | quality-floor 專案的 retro／驗收時 | **F**。`grep -rn "check-escalation-coverage" skills agents references src hooks bin scripts`（排除自身）：只有 `hooks/tests/check-escalation-coverage.test.sh`。入口零命中，無程式呼叫端。`skills/retro/SKILL.md:31` 與 `skills/distill/SKILL.md:100` 教的是 `tree.js escalations`，沒提這支 | 若 quality-floor 仍活著：`skills/retro/SKILL.md:31` 旁加 `--gate`；否則退役 | 不跑就不知道 escalation 帳是否漏記某個出口 |
| 10 | `scripts/validate-next-touch-reservation.js`、`scripts/validate-next-touch-terminal.js` | next-touch 計畫專用的只讀授權檢查：保留（pre-spend）與終結（merge 前）兩道 | 只在 `docs/plans/2026-08-03-next-touch-debt-retirement.md:77,316` 的步驟裡 | **F**（計畫專屬 CLI）。`grep -rn "validate-next-touch" src bin hooks scripts skills agents references`（排除自身與測試）零命中。對應專案已歸檔（`docs/projects/_archive/2026/08/2026-08-03-next-touch-debt-retirement/`），但計畫檔還在 `docs/plans/` 未歸檔 | 計畫若已出貨，走 plan-graduation 歸檔，並從 CLAUDE.md 清單移除這兩個與 `next-touch-validation.js`（或標示為歸檔計畫專用） | 無（沒人會跑），但佔清單、誤導「mission 結尾要跑這兩支」 |

### 備註：test-strategy 沒有點名任何腳本

`grep -noE "scripts/[A-Za-z0-9_./-]+" skills/test-strategy/SKILL.md` 零命中。該 skill 描述寫「regression scoping」，表格第 34 行只寫「Regression … Affected modules」，沒有指向 `affected-suites.js`（QP 表第 36 行與 `test-policy.md:89` 有教）；只有第 100 行一句 `autopilot:quality-pipeline` 的 See Also。建議在 regression 一列加 `scripts/affected-suites.js --base <ref> --head <ref>`。影響小（QP 路徑已覆蓋 M/L/XL），但單獨用 test-strategy 的 agent 會憑感覺選測試。

### 備註：特別點名的那批腳本現況

| 腳本 | 判定 | 觸發描述是否清楚 |
|------|------|------------------|
| `completeness-scan.sh` | B | 清楚：`skills/dev-flow/SKILL.md:330` 收尾清單、`skills/quality-pipeline/SKILL.md:132` 步驟、`references/completeness-gate.md:21-24` |
| `affected-suites.js` | B | 清楚：QP 表第 36 行「Tests step, M/L/XL and urgent: before running any test」、`test-policy.md:89-93`、l5 `hetero-impl-loop.md:130`、l6 `full-dispatch-pipeline.md:54` |
| `risk-counter.js` | B | 清楚：`skills/quality-pipeline/SKILL.md:187-200` 給事件對應表與停止條件 |
| `tree.js` | B | 清楚但限定：`skills/ceo-agent/SKILL.md:305`（L/XL init）、`:403-418`（各子命令）、`:435`；retro `:31`、distill `:100` |
| `check-test-integrity.sh` | B 弱 | 見主表 1 |
| `verify-red-green.sh` | B 弱 | 見主表 3 |
| `next-pick.js` | B 弱 | 見主表 4 |

---

## 附錄（A／B／E，一行一項）

### 第一輪已判（17 項，引用不重查）
session-mode、stage-advance、stage-graph、decision-ledger、probe-unknown、record-integration、check-containment、check-inputs-landed、watch-foreman、agent-liveness-check、check-stall-fuse、build-rehydration-bundle、run-approval、task-card、compaction-rehydrate、open-decision、pin-evidence-anchors：見 `discover-audit.md`（pin-evidence-anchors 為 A：`repo-residue-sweep.js:911`、`reap-dispatch-branches.sh:1263`）。

### A 自動（11）
- implementation-campaign-check.js：`scripts/dispatch-hetero.sh:1223,1583` 呼叫；引擎失敗時提示 `src/engine/autopilot-engine.js:7944`；l5 教的是 `engine implement-review --campaign-contract`（`skills/l5/SKILL.md:18`）。
- write-task-status-input.js：`hooks/merge-task-status-lib.js:171` 以 detached spawn 呼叫。
- qc-evidence-status.js：`.githooks/pre-push:108` 與 `scripts/lib/qc-evidence.sh:3`；結果給 `src/status/qc-fact.js:7`、`mods/live/model.ts:587`。
- render-review-page.js：`src/status/runs-watch.js:458,490,502`、`compare-input.js:29`。
- verify-strength.js：`scripts/check-holdout-coverage.sh:68`。
- probe-mutation.js：`scripts/check-holdout-coverage.sh:63`。
- rubric-freeze.js：`scripts/dispatch-plan-review.js:72`、`scripts/lib/qualification-asset-seals.js:11`。
- probe-diff-domain.sh：`scripts/resolve-review-loop.sh:1734`。
- check-disjointness.sh：`scripts/dispatch-hetero.sh:4369,4435`。
- check-hands-commit.js：`scripts/dispatch-hetero.sh:4328`、`dispatch-foreman.sh:609`。
- classify-diff-risk.sh：`stage-advance.js:24,37` 經 `resolve-review-loop.sh`；dev-flow `SKILL.md:71` 也教。

### B 入口有教（47，含主表已列的 5 項弱 B）
- check-blueprint-conformance.js：`skills/ceo-agent/references/depth0-control-loop.md:441,484`；也被 `dispatch-hetero.sh:1133` 自動呼叫。
- mission-routing-admission.js：`skills/dev-flow/SKILL.md:460`、`skills/ceo-agent/SKILL.md:505`、`skills/project-lifecycle/references/plan-bootstrap.md:49`。
- mission-execution-graph-check.js：`skills/l5/references/hetero-impl-loop.md:133`、`skills/dev-flow/references/card-relocated.md:88`。
- scaffold-mission.js：`skills/l5/references/hetero-impl-loop.md:127`。
- mission-terminal-reconcile.js：`skills/l5/references/hetero-impl-loop.md:159,276`。
- mission-convergence-check.js（薄包裝）：實際路徑是 `bin/autopilot.js mission …`（`bin/autopilot.js:41,427`），l5 教 `mission prepare`／`mission grant`（`hetero-impl-loop.md:201-202`）。包裝檔本身沒入口，但功能有教。
- run-ledger.sh：`skills/l6/references/full-dispatch-pipeline.md:115`。
- check-repair-scope.js：`skills/quality-pipeline/SKILL.md:43`。
- reap-dispatch-branches.sh：`skills/finish-flow/SKILL.md:98`。
- reap-dispatch-worktrees.sh：`skills/quality-pipeline/SKILL.md:53`。
- repo-residue-sweep.js：`skills/finish-flow/SKILL.md:67`、`skills/l5/references/hetero-impl-loop.md:249`。
- resolve-repo-placement.js：`skills/handoff/SKILL.md:36,38`。
- lifecycle-residue-receipt.js：`skills/quality-pipeline/SKILL.md:54`、`depth0-control-loop.md:355`。
- completeness-scan.sh：`skills/dev-flow/SKILL.md:330`、`skills/quality-pipeline/SKILL.md:38,132`。
- error-path-scan.sh：`skills/quality-pipeline/SKILL.md:39`、`references/completeness-gate.md:28`。
- secret-scan-diff.js：`skills/quality-pipeline/SKILL.md:40`、`references/completeness-gate.md:27`。
- check-redispatch-prompt.sh：`skills/quality-pipeline/SKILL.md:44`。
- check-backlog-entries.js：`skills/finish-flow/SKILL.md:68`、`skills/quality-pipeline/SKILL.md:35`。
- migrate-backlog-entries.js：`skills/next/SKILL.md:131`。
- diff-file-list.sh：`skills/quality-pipeline/SKILL.md:45`。
- diff-scope-report.sh：`skills/quality-pipeline/SKILL.md:46`。
- diff-since-last-round.sh：`skills/quality-pipeline/SKILL.md:56`。
- replay-test-integrity.js：`skills/quality-pipeline/references/test-integrity-gate.md:28`。
- scan-fixture-literals.js：`skills/quality-pipeline/SKILL.md:50`（也由 `dispatch-hetero.sh` 印出）。
- check-blind-evidence.sh：`depth0-control-loop.md:257`、`references/consult-discuss-seats.md:37`。
- check-test-outcome.js：`skills/quality-pipeline/SKILL.md:37`（opt-in）。
- dispatch-experience-critic.sh：`depth0-control-loop.md:510`。
- verify-preexisting.sh：`skills/quality-pipeline/SKILL.md:51`。
- adjudicate-findings.js：`skills/quality-pipeline/SKILL.md:41`。
- review-mvp-portfolio.js：`skills/quality-pipeline/SKILL.md:42`、`references/reviewer-mvp-portfolio.md`。
- qc-panel.js：`skills/quality-pipeline/SKILL.md:57`。
- calibration.sh：`skills/quality-pipeline/SKILL.md:58`、`skills/dev-flow/references/model-routing.md:141`。
- check-node-report.js：`skills/ceo-agent/SKILL.md:437`。
- check-loop-convergence.js：`skills/ceo-agent/references/level-front-door.md:249`、`references/hetero-dispatch.md:22`。
- check-foreman-polling.js：`skills/l6/references/full-dispatch-pipeline.md:78`、`skills/l5/references/hetero-impl-loop.md:61`。
- affected-suites.js：`skills/quality-pipeline/SKILL.md:36`、`references/test-policy.md:89`。
- plan-rubric-scaffold.js：`skills/dev-flow/references/hetero-loops.md:8`。
- hetero-review-loop.js：`skills/dev-flow/references/hetero-loops.md:14`、`stage-graph.md:71`。
- check-phase-review-receipt.js：`skills/dev-flow/SKILL.md:278-279`。
- tree.js：`skills/ceo-agent/SKILL.md:305,403-418,435`。
- risk-counter.js：`skills/quality-pipeline/SKILL.md:55,187-200`。
- hook-harness-matrix.js：`skills/harness-maintenance/SKILL.md:39`。
- 弱 B 五項（check-test-integrity.sh、check-holdout-coverage.sh、verify-red-green.sh、next-pick.js、check-dispatch-suppression.sh）：見主表 1–4、6。

### E 不需 agent（16）
- check-plan-authority-ownership.js：預設吃已歸檔 mission-convergence-portfolio 的 manifest（`scripts/check-plan-authority-ownership.js:63-70`），只有 `hooks/tests/mission-authority-ownership.test.sh` 用；測試輔助。
- next-touch-validation.js：只是上面兩支 validate-next-touch 的共用函式庫（`validate-next-touch-reservation.js:3`），歸檔計畫專用。
- prune-plugin-cache.js：面板「清理」按鈕（`mods/live/register.ts:606-608` CLEAN_SCRIPTS），給 owner。
- lib/stage-write.js：`src/engine/autopilot-engine.js:4864,6758`、`scripts/lib/headless-seat-derive.js:11`。
- lib/worktree-reap.sh：`scripts/dispatch-hetero.sh:413`、`dispatch-foreman.sh:248`。
- lib/worktree-intent.sh：`scripts/dispatch-hetero.sh:487`、`dispatch-foreman.sh:107`。
- lib/prune-tmp-residue.sh：被 dispatch-hetero／review／author／explore 啟動時 source（`dispatch-review.sh:177`、`dispatch-author.sh:145`）。
- lib/worktree-activity.js：`scripts/watch-foreman.js:38`、`agent-liveness-check.js:57`、`run-ledger.sh:2104`。
- lib/tmp-residue.js：`references/hetero-dispatch.md:650` 說明讀取器；`finish-flow/SKILL.md:67` 引用。
- lib/tmp-residue-registry.json：`check-tmp-residue-registry.js` 閘門的資料檔。
- lib/test-integrity-l1.py：`check-test-integrity.sh:234` 的引擎。
- lib/qc-evidence.sh：`.githooks/pre-push` 與 `qc-evidence-status.js:26`。
- lib/review-chain-derive.js：`scripts/check-phase-review-receipt.js:27`。
- lib/review-packets.js：`scripts/check-phase-review-receipt.js:30`。
- lib/exclude-allowlist.js：`check-phase-review-receipt.js:29`、`hetero-review-loop.js:129`。
- lib/seat-id-guard.js：`scripts/hetero-review-loop.js:16`。

### F 死碼嫌疑（5）：見主表 7–10（ladder-run.sh、qc-metric-emit.js、check-escalation-coverage.js、validate-next-touch-reservation.js、validate-next-touch-terminal.js）。

### D 找不到（1）：見主表 5（admit-backlog-follow-ups.js）。

## 方法備註
- 入口範圍：`skills agents AGENTS.md references src/hooks/handlers/session-start.js`（references 為 repo 根目錄的 `references/`，已確認 blind-dispatch.md、probe-playbook.md、reviewer-mvp-portfolio.md、evidence-discipline.md 都被 SKILL 或 agents 連到）。
- 呼叫端範圍：`scripts hooks src bin mods .githooks`，排除 `tests/`、`*.test.*`、`platforms/`（鏡像）與 `config-keys.json`（只是設定索引）。
- 沒有執行任何腳本，只讀標頭與 grep。
- 掃描輔助檔在 scratchpad（`flow-names.txt`、`flow-scan.sh`、`flow-g.sh`、`ref.sh`）；注意 scratchpad 的 `g.sh` 被另一組覆寫過，本組後半改用 `flow-g.sh`。
