# HANDOFF — dispatch-branch-lifecycle（2026-07-14，T2 context-budget 觸發）

> 本 handoff 由 context-budget T2（150k）逼出。CEO 模式進行中（Board 指令：plan → hetero loop review → 實作修好）。

## 目標
把 codex-worktree audit §5 的 autopilot 側修法做完：session-end 整合候選 gate + `scripts/reap-dispatch-branches.sh`（preserve-first）+ 中間輪收斂 + orphan-log 小修 — plan 已寫好（DRAFT），**下一步是 P1 hetero loop review 收斂**，然後實作。

## 現況
- Branch `feature/dispatch-branch-lifecycle` @ `57b92e9`（tree 乾淨；base = develop `0cfb021`）。
- DONE：CEO 啟動參數（just-results / Hold / no-go=TWGameProject 不動）；L-1.5 scope audit（見專案 README 表格）；專案 scaffold（README + INDEX 進行中 row + tree shadow init）；**P0 plan 完成** → `docs/plans/2026-07-14-dispatch-branch-lifecycle.md`（DRAFT，含完整 §2.5 Global Constraints / 4 Phases / inversion 表）。
- Task list（若 /clear 後仍在）：#16 L-1.5 ✅、#18 P0 ✅、#19 P1（下一個）、#20 P2、#21 P3、#22 L-5 finish-flow、#17 L-1.6 進行中。
- develop 側已完成（前段工作）：BACKLOG 兩新條目 + E1 證據 + 舊 docs/HANDOFF.md 消耗刪除（`0cfb021`）。

## 已決事項(不重議)
- Board 裁決：TWGameProject 殘骸全部擱置 — 本專案只出工具，絕不對該 repo 動手。
- Scope Hold：spawn_agent 納管、E1 gate、`unit-*`（dispatch-batch 所有）都 OUT（plan §7）。
- Plan 核心設計已定（見 plan §2.5/§4）：bash-only、preserve-first 不可豁免（create→verify→delete 嚴格順序）、gate read-only + sha-pinned `--ack`（`.git/autopilot-reap-ack`，新 commit 重新武裝）、anchored dated branch grammar（lookalike 不得匹配）、無新 config/hook、版號 v2.32.28 PATCH。
- 引擎現實：codex quota 死至 2026-07-20、grok 402 ⇒ review 面 = agy（`--model "Gemini 3.5 Flash (High)"`）+ cc-shim `--endpoint glm|minimax`（endpoints 已驗活：`node bin/autopilot.js endpoints list` → glm/minimax 都 ✓）。

## 下一步
1. **P1 hetero loop review**：先 `scripts/dispatch-review.sh --help` 確認 flags（勿憑記憶），把 plan 全文當 diff-file 餵 2 家族（agy Gemini + cc-shim glm 或 minimax）做設計審；prompt 過 `scripts/check-dispatch-suppression.sh`；findings → 改 plan → 再審，直到無未決 Critical/Major；每輪記入 plan 的 Review log 節。
2. P2 實作（TDD，Phase A→B→C→D 照 plan §4 的 acceptance 清單）；P3 對實作 diff 再跑 hetero review loop；L-5 invoke autopilot:finish-flow（merge develop 在 CEO DOA 內）。
3. 收尾時 BACKLOG「Dispatch-branch lifecycle」條目標 shipped、本 HANDOFF.md 刪除。

## 驗證方式
- plan 存在且為 DRAFT：`head -3 docs/plans/2026-07-14-dispatch-branch-lifecycle.md`。
- checkpoint：`git log --oneline -2` 應含 `57b92e9`（P0）與 base `0cfb021`。
- P1 完成的定義：plan Review log 有 ≥1 輪跨家族審查記錄且 Status 改為 CONVERGED。

## Read-order
1. docs/plans/2026-07-14-dispatch-branch-lifecycle.md — 要被審的 plan 本體
2. docs/projects/2026-07-14-dispatch-branch-lifecycle/README.md — OKR/scope/phase 狀態
3. /home/twgs-dev/reports/2026-07-14-codex-worktree-audit.md — 事實依據（§5 修法、§1 殘骸清單）
4. references/blind-dispatch.md — P1 dispatch prompt 紀律

## 陷阱
- **`git stash pop` 禁用**（使用者長駐 wip stash@{0}）；臨時 checkout 用 `git worktree add --detach`。
- 這台 /tmp 多使用者共用：新測試一律 `mktemp -d`，勿寫死路徑（BACKLOG l1-flaky 教訓）；`engine-scorecard.test.sh` case 13 在 develop 上 PRE_EXISTING 紅。
- `tree.js emit` 要完整 JSON envelope：`{schema_version,ts,node,type,...}` 四欄缺一不可（本 session 踩過「event is not valid JSON」）。
- CEO 模式規則仍生效：merge develop 前必過 quality gate；suppression linter 檢查所有 dispatch prompt；depth-0 不得把 Fable 派出去。
- context-budget hooks 是 warn 模式 opt-in（本 handoff 就是 T2 逼出來的）— 新 session 若又觸發，照樣寫 handoff 再 /clear。
