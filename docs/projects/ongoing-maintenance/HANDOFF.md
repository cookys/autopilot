## 目標
接續 autopilot 維護。2026-10-02 這個 session 出貨了 v2.36.105（測試套件寫入防護）；兩條線正在進行：測試套件加速、kimi/agy final-panel 隔離。

## 現況
- 分支 `develop`，v2.36.105 已發布並 push（release commit `a8e4045c`）；本檔所在的 closeout commit（evidence、BACKLOG 列、HANDOFF）疊在上面，HEAD 以 `git log --oneline -1` 為準。
- 主 checkout 的 local git 身分已清掉（從 09-04 起一直是 Test User，632 個 commit；`.mailmap` 已對回 cookys）。`/tmp/.git` 那個流浪空目錄已刪（它讓 3 支測試紅）。
- v2.36.105 出了三層防護：完整 `run.sh` 預設在拋棄式快照裡跑（`AUTOPILOT_TEST_SNAPSHOT=0` 可關）、外層對真 repo 做 config drift 偵測並還原（refs/工作區只警告）、`.githooks` 的 pre-commit／pre-merge-commit／pre-push 拒絕 test 字樣的 email（只看保留網域）。證據：`docs/plans/evidence/2026-10-02-test-suite-repo-write-containment/README.md`。
- **進行中 A — 測試加速**：五個 sonnet hand 平行在 clone `/tmp/claude-1000/-home-cookys-projects-autopilot/7236b3c6-6662-4434-ab03-07d7d2a66500/scratchpad/trwc/clone` 的 worktree `st-<unit>`、分支 `speed/<unit>`（dedupe、rrl、eq、dr、fgr），base `1aea60d3`（= v2.36.105 內容疊在 clone-local shadow `63c4caeb` 上，shadow 不能落地）。brief：`…/scratchpad/trwc/run/speed-common.md`。驗收重點：每個 unit 拆檔前後 assertion 總數相等。全部收下後：cherry-pick 到 origin/develop 上、`run.sh` 預設 worker 改 16、完整套件只跑一次、combined review、出 PATCH。診斷數據：resolve-review-loop 600–823 s（325 次 resolver × 2.5 s）、engine-qualify ~500 s、dispatch-review ~326 s、L1/L2 重複跑 `scripts/*.test.js` ~390 s。
- **進行中 B — kimi/agy final-panel 隔離**：spike 完成，plan 草稿在 `…/scratchpad/kimi-agy/2026-10-02-final-panel-kimi-agy-isolation.md`（含 `rubric.md`、`spike-log.md`）。結論：兩者在本機都能到 cleanroom（kimi 用 `tools: []` agent file；agy 沿用既有無工具 agent；工具關閉靠 post-run audit；agy 缺 `description` 會靜默退回有工具 agent）。待辦：搬進 `docs/plans/`、登 INDEX、連 BACKLOG 列、送 hetero plan review。operator 三題的預設（沒被推翻就照用）：post-run audit 即可、phase 5 每 runner 實打一次、intake 記版本只警告。

## 已決事項（不重議）
- depth-0 讀報告、下裁決、派工；落地前一定有一次 `origin/develop..HEAD` 的 combined review。
- **派工前先估規模**（operator 2026-10-02 兩度抱怨太久）：獨立的列平行派；大列或碰 signal/trap 的列 hand 用 sonnet；開工就報預估時長。
- **測試只重跑壞掉的或受影響的**；完整套件每次發版一次。
- peer 的回報／技術查詢直接處理（回覆、唯讀查證、登 BACKLOG），不先問 owner；改碼的修正照排序。
- kimi/agy 隔離排在測試加速之後；tier `none` 永不豁免。

## 下一步
1. 收測試加速五個 hand → 驗收 → 落地（見上）。
2. kimi/agy plan 入庫 → hetero plan review（≤G2）→ 實作。
3. BACKLOG 已觸發的 peer 列：`verification-author-pin-unreachable`（S）、`dispatch-author-kimi-timeout-not-forwarded`（S）、`context-budget-unknown-window-t2-on-1m-without-live-file`（S）。
4. v2.36.105 的 follow-up（CHANGELOG 列的 🟡/🔵、`P4 pgid` 偶發紅、`.opencode` 漂移列）。

## 驗證方式
- `git status --short` 乾淨；`git config --local --get user.email` 沒有值。
- `bash scripts/preflight-release.sh` 回報 v2.36.105 一致。
- `git -C <clone> branch --list 'speed/*' -v` 看得到五個 unit 的進度。

## 陷阱
- 這台 bwrap 不能巢狀（`apparmor_restrict_unprivileged_userns=1`）。
- 新的身分 gate 上線後，任何 test 字樣 email 都 commit／push 不進真 repo；clone 裡要用真身分。
- 背景 foreman 停車不會自己醒；dead-man 計時器要配合查行程，不只看 git。
- cost-tracker：這個 session 已超過 1 億 cache tokens，下一個 session 從本檔接手。
