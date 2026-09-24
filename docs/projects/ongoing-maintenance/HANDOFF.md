## 目標
接續 autopilot 維護。2026-09-24 這個 session（opus）把 09-21 backlog bundle 剩下的 wave-1b 共 10 列做完，出貨 **v2.36.95**（`41f1bff6`）。
09-21 那份 handoff 裡的事項都已結案：wave-1 在 v2.36.81 落地，depth-0 委派閘門在 v2.36.82 出貨，wave-1b 就是這次。

## 鐵律（沿用 owner 09-21 的規定）
- depth-0 只做三件事：讀報告、下裁決、派工。產品碼、落地、release 都交給工頭（sonnet Agent，在 clone 裡做）。
- BACKLOG 是佇列：有 plan 或已出貨就刪列。plan 要登記在 INDEX（`active`）。🔵 不進 BACKLOG。
- rail 有缺陷時，一律先出 Fix 版再重派，或依文件降級。

## 現況（HEAD `41f1bff6` = v2.36.95 已 push）
1. **09-21 的 backlog bundle 只剩 B1 `review-loop-resolver-a`（wave 2）**，plan 在 `docs/plans/_archive/2026/09/2026-09-21-backlog-review-loop-resolver-a.md`，INDEX 標 `active`。
   其餘 5 個 bundle 的 plan 都已歸檔到 `docs/plans/_archive/2026/09/`。
2. **平行派工配方**：證據與教訓在 `docs/plans/evidence/2026-09-24-backlog-wave-1b/README.md`。重點有兩條：
   - clone-local 的 shadow commit 要一開始就寫進 brief，不能事後用訊息補，工頭會（也應該）拒收。
   - 每列的 Verify 要涵蓋它所改契約的使用端套件，不能只跑 bundle 套件。
3. v2.36.95 最終審查留了三個 🔵：
   - `--exclude` 白名單判定過寬；
   - `runnerConsumesEffort` 的名單與 probe 的 `_EFFORT_CONSUMER` 是兩份手抄；
   - `admit-backlog-follow-ups` 的 finally 裡 releaseLock 沒有 try/catch。
   照規則不進 BACKLOG，有人碰到這些檔案時順手處理。
4. 停放：
   - `origin/main` 大幅落後 develop，等 owner 決定；
   - `stash@{0}`（evidence-discipline §20/§21，需要 QC 才能進 protected references/）別動；
   - `check-plan-graduation` 有 44 條 `plan_reference_dangling`，這次之前就存在、不擋；
   - 一個 5 天前的 `dispatch-review` 測試 mock node 程序（`/tmp/autopilot-test-dispatch-review-6PySJr`）還活著，owner 決定要不要清。

## 驗證方式
- `git status --short` 空；
- `git log --oneline -1` 是 v2.36.95 或其後；
- `node scripts/check-plan-graduation.js --repo-root . --json` 的 exit 為 0；
- `bash scripts/preflight-release.sh` 通過。

## 陷阱
- 引用改寫別碰 sha-bound plan（`docs/mission-*-sources.json` 封印的）。
- zsh 的 `set -- $var` 不會切詞，要用 `bash -c`。
- 工頭停車後不會被自己的背景工作叫醒：depth-0 要自己設 dead-man，時間到去看 git，再用 `SendMessage` 戳它。
- 1M session 沒有 statusline tee 時，context-budget 會在約 150K 報假 T2（v2.36.89 的 `statusline-live-tee.js` 可以修）。
