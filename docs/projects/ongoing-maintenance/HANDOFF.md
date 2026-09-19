## 目標
接續 autopilot 維護。2026-09-19～20 本 session 出貨 v2.36.71–v2.36.74；2-D plan 凍結 g2；**2-D D2 managed campaign 進行中，卡在第二個 rail 缺陷，修補 hand 正在跑**。Context 到 T2 才寫這份。

## 現況（2026-09-20，HEAD `8dc1814e` = v2.36.74 已 push）
- **l5 marker ACTIVE**（session `38a23a44…`，repo_root 主 checkout，graph digest `9ad752a5…`）——新 session 接手要先 `node scripts/session-mode.js status`；marker 綁舊 session id，新 session 的 marker 會是另一個檔；同 repo 兩個 ACTIVE marker 會被 bridge 擋（recipe 6）。處置：舊 marker 由新 session 用 `set --level l3 --entry-level l5 --fallback precondition_failed` 無法碰（不同 session id）——直接 `session-mode.js retire --session 38a23a44-ca0a-4350-96bd-315ba7dd269d --integration-receipt <receipt>` 需要 integration receipt（沒有），所以：**等它 24h 過期（2026-09-20T~15:30Z）或以同 session id 環境變數 `AUTOPILOT_SESSION_ID=38a23a44-ca0a-4350-96bd-315ba7dd269d node scripts/session-mode.js set --level l3 --entry-level l5 --fallback precondition_failed && … clear`**（marker 路徑由 session id 派生，見 `session-mode.js getSessionId`）。
- routing → 2-D D2 graph（`docs/mission-blind-review-2d-snapshot-2026-09-19-*.json`，commit `28f9ce82`），legacy reconcile 已綁；`mission prepare` 收據 `/tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/d2/prepared.json`（scratchpad，session 專屬——新 session 要重跑 prepare，同 adoption key 會 adopted=true）。
- D2 attempt-1：grant claim `claim-v1-b88565b9…`，run1 在 provider_readiness 被擋（rail 缺陷 → v2.36.74 修）；run2 intake **admitted** 後在 dispatch_implementation `precondition_failed`：`caller --timeout (7199s) disagrees with contract budget.wall_seconds (7200s)`（v2.36.71 A 的 remaining-wall `--timeout` 撞上 dispatch-hetero 嚴格契約的「等於」規則），claim 已 `campaign_admission_release` 釋放。attempt 1 已消耗；下一次 grant = attempt 2（budget 6）。
- **修補 hand 在跑**：clone `/home/cookys/projects/autopilot-par6-timeout`（shadow commit 之上），branch `hands/par7/timeout`，brief `/tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par7/hand-timeout.md`，結果 `/tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par7/timeout.dispatch.json`（`rc=` 在 `.err` 末行）。修法：dispatch-hetero.sh:1162-1169 改「caller --timeout ≤ wall 接受、> wall 拒」。落地流程同 v2.36.74：fable review（`dispatch-review.sh --runner claude-native --model claude-fable-5-1`，spec 第一行寫 NO tools）→ cherry-pick 進 develop → 套件（dispatch-hetero-contract、dispatch-hetero、dispatch-contract；在 marker 下會紅的 suite 到 clone 裡跑）→ v2.36.75 release（trailer 同前）→ push → 刪 clone（mv 到 /tmp 再 rm）。
- 然後 D2：`mission grant --repo . --prepared <prepared> --node snapshot-contract` → 新 contract/seal/branch（`…-a2`）→ 改 `/tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/d2/dispatch.sh` 的 contract/seal/branch/root_run_id → 跑。brief `/tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/d2/impl-brief.md`（6.9 KB，base 寫 `28f9ce82`——attempt 2 的 base_sha 會是新 HEAD，brief 開頭那個 base 要改）。base suites 在 28f9ce82 10/10 綠（`/tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/d2/base-suites.txt`）；新 base 要重跑 `/tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/d2/suites.sh <sha> <out>`。
- 兩個 rail 缺陷都是 v2.36.71 契約變更的**非 test 消費者**（`src/readiness/live-probe.js` 吃 dispatch-author frame；`dispatch-hetero.sh` 嚴格 preflight 吃 engine 的 `--timeout`）——§39 的消費者 grep 要含 `src/` 與 `scripts/`，不只 `hooks/tests`。寫進 evidence-discipline 時當 §42。
- 其他：cuda 已收 v2.36.72 回覆；四席 qc pin 不變；`stash@{0}` 別動；主機 run.sh 紅名單見 v2.36.71 evidence；另一個 session 在這台跑真 grok dispatch（strikes.jsonl 42–44）。

## 已決事項(不重議)
- 2-D 走兩個 lineage：D2（S）先、D1（L）後；D1 是新 lineage（amend intent.objective、新 graph、同 plan bytes）。
- D2 brief 已定稿（寫在 claim 後、EEXIST digest 重算列漂移欄位、claim-held-no-file 規則、live flip journal；只有兩條既有斷言可改）。
- rail 缺陷一律 Fix 版釋出再重派，不繞。

## 下一步
1. 等 `/tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par7/timeout.dispatch.err` 出 `rc=` → 上述落地流程 → v2.36.75。
2. attempt 2 → 跑到 awaiting_disposition／converged；disposition 用 `--resume --campaign-disposition-authority`（recipe 9）；先算剩餘 wall 塞不塞 repair 輪。
3. D2 integrated 後：record-integration（accepted==HEAD、在 branch 上）、reap、v2.36.76、然後 D1 lineage。

## 驗證方式
`git status --short` 空；`git log --oneline -1` = 8dc1814e 之上只有 handoff；`node scripts/session-mode.js status --repo-root "$PWD"` 顯示 active（舊 session）；`ls /home/cookys/projects/ | grep autopilot-par` 只剩 `autopilot-par6-timeout`。

## Read-order
1. skills/l5/references/hetero-impl-loop.md § Depth-0 recipe（步驟 6–11）。
2. docs/plans/2026-09-19-blind-review-2d-overlap.md §4 D2；docs/plans/evidence/2026-09-19-blind-review-2d-overlap/README.md。
3. /tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/d2/（prepared.json、grant.json、dispatch.sh、impl-run2.json、impl-brief.md）——scratchpad 是 session 專屬路徑，新 session 先 cp 走。

## 陷阱
- 主 checkout 在 campaign 跑時凍結（連 fetch）；marker 在時從主 checkout 派 dispatch-author/consult 會 precondition_failed → 到 clone 跑。
- `mkdir -p <相對路徑>` 後 cwd 重設 → clone 用絕對路徑。
- 每個 hand 建的 test 檔 `test -x`；sweep 迴圈子行程 `< /dev/null`。
