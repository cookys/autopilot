## 目標
接續 autopilot 維護。2026-09-20 本 session 出貨 v2.36.76（readiness 重試）、v2.36.77（2-D D2 snapshot-contract）、v2.36.78（lifecycle 硬閘門＋一次清理）。

## 現況（HEAD = v2.36.78，已 push；marker 已 clear；樹乾淨）
- **2-D D2 已 integrated**（`ece2db2c`，record-integration merge receipt 在 evidence dir）。attempt 3 在 rail 死於缺陷 #4（repair scope 從審查 claim 文字抓路徑，抓不到就 terminal_stop）→ 依文件降 l3、sonnet 工頭在 clone 修、fable 二家審全 diff SHIP-AS-IS。BACKLOG 已登缺陷 #4（🟠，有 trigger）。
- **D1 lineage 未開始**：同 plan bytes、amend `intent.objective`、新 graph；plan `docs/plans/2026-09-19-blind-review-2d-overlap.md` 因 active routing sources 豁免歸檔（`plan_active_lineage`）。開 D1 前先修 rail 缺陷 #4，否則 must-fix 沒路徑又燒 attempt。
- **lifecycle 閘門**（v2.36.78）：`scripts/check-plan-graduation.js`，release 前 `--fix`；BACKLOG 216→139；59 個 plan 歸檔到 `docs/plans/_archive/`；**39 個孤兒 plan 只列不動，等 owner 裁決**（`node scripts/check-plan-graduation.js --repo-root . --json | jq '.violations[]|select(.code=="plan_orphan")'`）；`plan_reference_dangling` 21 組 report-only（多為 fixture 假路徑與早已不存在的舊 plan）。
- **peer 308-0c** 的 `task/308-backlog-46-rail-gaps` 二家審 FIX-THEN-SHIP（2🟠3🟡，envelope 在本 session scratchpad `r308/review.json`），peer 正在 rebase 到 develop 修 5 項；回新 sha 後複審 → 自己的 PATCH（v2.36.79）。
- 殘留：`hl/hp/ht` 已刪（pin scan 0）；仍留 `feat/cursor-transport-fallback`、`feat/qualification-feed-adopt`、`fix/consult-grader-c4c5-overstrict`、`worktree-agent-a9cff81d3ca98762e`（8/29–9/4，未合併 1–6 commit，來歷不明，等 owner）；`stash@{0}` 別動。
- BACKLOG 候選（未登）：readiness probe 同 tuple 跨角色重複探測（Qwen 兩席各探一次）；`hooks/tests/run.sh dispatch-foreman` 在乾淨 develop 也紅（308 回報，NODE_OPTIONS preload 在 $TEST_TMP 中途消失）。evidence-discipline 補 §42（契約變更的消費者 grep 要含 `src/`＋`scripts/`）。

## 已決事項(不重議)
- owner 指示：CEO/l6 模式，depth-0 只派遣與決策，驗收派人；rail 缺陷一律 Fix 版再重派（或依文件降級）。
- BACKLOG 是佇列（有 plan／shipped 就刪，無保留期）；campaign 工作以 plan 當 project、出貨即歸檔；🔵 不進 BACKLOG。

## 下一步
1. 308 分支複審＋合併（v2.36.79）。2. 修 rail 缺陷 #4（v2.36.80）。3. D1 lineage。4. 孤兒 plan 與四條舊分支交 owner。

## 驗證方式
`git status --short` 空；`git log --oneline -1` = 5f3aa3b1 之上只有本 handoff/BACKLOG commit；`node scripts/check-plan-graduation.js --repo-root . --json | jq .exit` = 0；`node scripts/session-mode.js status` inactive。

## 陷阱
- 歸檔會改寫 dev-flow/ceo-agent SKILL.md 的 plan 路徑 → profiles 鏈重釘（`profiles-hash-repin` skill）；`codex-plugin-package.test.sh` 的 `path.join('docs','plans',…)` 要手改。
- reaper 對 rail 的 hands worktree 回 0 leaf，要自己 `git worktree remove`。
