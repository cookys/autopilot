# HANDOFF — dispatch-branch-lifecycle（2026-07-14，T2 context-budget 觸發）

> 本 handoff 由 context-budget T2（150k）逼出。CEO 模式進行中（Board 指令：plan → hetero loop review → 實作修好）。

## 目標
把 codex-worktree audit §5 的 autopilot 側修法做完：session-end 整合候選 gate + `scripts/reap-dispatch-branches.sh`（preserve-first）+ 中間輪收斂 + orphan-log 小修。P2/P3 已完成；**下一步交還 depth 0 跑 L-5 authoritative QC、merge、archive**。

## 現況
- Branch `feature/dispatch-branch-lifecycle` @ `72b32bea`，P1 tracking changes staged；`origin/develop` 另有 1 個新 handoff commit，P1 commit 後同步。
- DONE：CEO 啟動參數（just-results / Hold / no-go=TWGameProject 不動）；L-1.5 scope audit（見專案 README 表格）；專案 scaffold（README + INDEX 進行中 row + tree shadow init）；**P0 plan 完成** → `docs/plans/2026-07-14-dispatch-branch-lifecycle.md`（DRAFT，含完整 §2.5 Global Constraints / 4 Phases / inversion 表）。
- Phase state：L-1.5 / L-1.6 / P0 / P1 / P2 / P3 ✅；L-5 由 depth 0 執行。
- develop 側已完成（前段工作）：BACKLOG 兩新條目 + E1 證據 + 舊 docs/HANDOFF.md 消耗刪除（`0cfb021`）。

## 已決事項(不重議)
- Board 裁決：TWGameProject 殘骸全部擱置 — 本專案只出工具，絕不對該 repo 動手。
- Scope Hold：spawn_agent 納管、E1 gate、`unit-*`（dispatch-batch 所有）都 OUT（plan §7）。
- Plan 核心設計已定（見 plan §2.5/§4）：bash-only、preserve-first 不可豁免（create→verify→delete 嚴格順序）、gate read-only + sha-pinned `--ack`（`.git/autopilot-reap-ack`，新 commit 重新武裝）、anchored dated branch grammar（lookalike 不得匹配）、無新 config/hook、版號 v2.32.37 PATCH（2026-07-15 合流時 canonical 已出貨 v2.32.35、v2.32.36 已由 queued 專案保留；原 target v2.32.28 也已被 foreman-sensing 出貨使用）。
- 引擎現實：codex quota 死至 2026-07-20、grok 402 ⇒ review 面 = agy（`--model "Gemini 3.5 Flash (High)"`）+ cc-shim `--endpoint glm|minimax`（endpoints 已驗活：`node bin/autopilot.js endpoints list` → glm/minimax 都 ✓）。

## P2 evidence（2026-07-15）

- Verification author: configured GLM-5.2 endpoint API 529 twice; Board-approved temporary roster override produced a strict-roster `cc-shim/MiniMax-M3@high` artifact; config restored byte-identically.
- Recovery provenance note: the temporary `/tmp/dispatch-author-log-6GM37V` artifact was no longer present when generation 2 adopted git truth; it was not reconstructed. The durable ledger, runner/model provenance, converged plan, and executable tests remain the evidence rail.
- Implementer: canonical `gpt-5.3-codex-spark@high` was attempted twice without creating a worktree; both stalled with zero artifacts. Board authorized foreman-native fallback for this unit.
- Tests: qualified base+test-only orphan-GC RED (`RED_RC=1`, two behavior assertions) captured; GREEN = dispatch GC 23 assertions + reaper 35 assertions. Full suite 139/142 files green; all three nonzero groups reproduced on immutable `8250dc9` and are outside the diff. Portability 13/17 with all four nonzero checks likewise reproduced on base; deterministic canonical/payload/version gates pass.
- Constraints preserved: no TWGameProject residue cleanup, no archive-tag merge, no push, no direct develop edits, protected temp plan twin and pre-existing stash untouched.

## 下一步
1. P1 已完成：5 external generations（Gemini + GLM），無未決 Critical/Major；詳見 plan Review log。
2. **L-5 下一步**：由 depth 0 invoke `autopilot:finish-flow`，跑 authoritative QC + merge develop + archive；P3 final Gemini structured verdict 與 Grok raw wrapped verdict 均為 `SHIP-AS-IS`，無未決 Critical/Major。
3. 收尾時 BACKLOG「Dispatch-branch lifecycle」條目標 shipped、本 HANDOFF.md 刪除。

## 驗證方式
- plan 存在且為 CONVERGED：`head -3 docs/plans/2026-07-14-dispatch-branch-lifecycle.md`。
- checkpoint：`git log --oneline -2` 應含 `72b32bea`（develop sync merge）與其前置 P0 history。
- P1 完成：plan Review log 有跨家族審查記錄且 Status = CONVERGED。

## Read-order
1. docs/plans/2026-07-14-dispatch-branch-lifecycle.md — 已收斂的 implementation spec
2. docs/projects/2026-07-14-dispatch-branch-lifecycle/README.md — OKR/scope/phase 狀態
3. /home/twgs-dev/reports/2026-07-14-codex-worktree-audit.md — 事實依據（§5 修法、§1 殘骸清單）
4. references/blind-dispatch.md — P1 dispatch prompt 紀律

## 陷阱
- **`git stash pop` 禁用**（使用者長駐 wip stash@{0}）；臨時 checkout 用 `git worktree add --detach`。
- 這台 /tmp 多使用者共用：新測試一律 `mktemp -d`，勿寫死路徑（BACKLOG l1-flaky 教訓）；`engine-scorecard.test.sh` case 13 在 develop 上 PRE_EXISTING 紅。
- `tree.js emit` 要完整 JSON envelope：`{schema_version,ts,node,type,...}` 四欄缺一不可（本 session 踩過「event is not valid JSON」）。
- CEO 模式規則仍生效：merge develop 前必過 quality gate；suppression linter 檢查所有 dispatch prompt；depth-0 不得把 Fable 派出去。
- context-budget hooks 是 warn 模式 opt-in（本 handoff 就是 T2 逼出來的）— 新 session 若又觸發，照樣寫 handoff 再 /clear。
